-- Phase 2b — B4 (cutover): заморозка `tutor_payments` + cost-driven списание + фиксы ревью.
-- План: ~/.claude/plans/1-glowing-spindle.md. Money-critical. ОБЯЗАТЕЛЬНОЕ независимое ревью.
--
-- Закрывает находки ревью Stage A:
--  P1 — overcharge через 0-amount no-show (`tutor_confirm_lessons`/group-toggle): теперь `complete`
--       и авто-debit на цене 0 → `_reverse_lesson_debit` (waive), а не «пропустить, оставить debit».
--       + REVOKE `tutor_confirm_lessons` FROM authenticated (UI удалён).
--  TOCTOU — эффективная цена читается ПОД advisory-lock в `_apply_lesson_debit_from_current_cost`;
--       и cron, и setters, и complete зовут его → нет окна «cron внёс старую цену».
--  P2 — счётчик `processed` (не врёт на no-op); per-tutor cron (в edge — отдельные транзакции).
--
-- Заморозка: `complete_lesson_and_create_payment` / `update_group_participant_payment_status` больше НЕ
-- пишут в `tutor_payments` и не зовут credit-on-paid (2a). Деньги: занятие списывается (debit) по цене,
-- полученные оплаты = topup (credit). `/pay`-бот (B5) — отдельный кусок, деплоить вместе.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Централизованное применение списания по ТЕКУЩЕЙ цене ПОД lock'ом (TOCTOU-safe)
-- ════════════════════════════════════════════════════════════════════════════
-- Читает override (участник ∥ занятие) ∥ derived (rate×duration) ПОД advisory-lock, затем sync/reverse.
-- Будущее (end>now) → no-op. Цена 0 → reverse (waive). NULL (нет ставки/override) → skip.
CREATE OR REPLACE FUNCTION public._apply_lesson_debit_from_current_cost(
  _lesson_id uuid, _tutor_student_id uuid, _actor uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tutor_id uuid; _dur int; _is_past boolean; _rate int;
  _part_override int; _lesson_override int; _has_part boolean := false; _override int; _cost int;
BEGIN
  -- Тот же lock, что у _sync_lesson_debit (реентерабелен) → cron/setters/complete/cancel сериализуются,
  -- цена читается консистентно с применением.
  PERFORM pg_advisory_xact_lock(hashtext(_lesson_id::text), hashtext(_tutor_student_id::text));

  SELECT l.tutor_id, l.duration_min, l.payment_amount,
         (l.start_at + make_interval(mins => COALESCE(l.duration_min, 60)) <= now())
    INTO _tutor_id, _dur, _lesson_override, _is_past
  FROM public.tutor_lessons l WHERE l.id = _lesson_id;
  IF _tutor_id IS NULL THEN RETURN; END IF;     -- занятие удалено
  IF NOT _is_past THEN RETURN; END IF;          -- будущее → не списываем

  -- эффективная цена = COALESCE(override участника, override занятия, derived rate×duration).
  SELECT payment_amount, true INTO _part_override, _has_part
  FROM public.tutor_lesson_participants
  WHERE lesson_id = _lesson_id AND tutor_student_id = _tutor_student_id;

  IF _has_part IS TRUE THEN
    _override := COALESCE(_part_override, _lesson_override);            -- группа: участник ∥ занятие
  ELSE
    IF NOT EXISTS (                                                     -- индивид: ученик привязан?
      SELECT 1 FROM public.tutor_lessons
      WHERE id = _lesson_id AND tutor_student_id = _tutor_student_id
    ) THEN RETURN; END IF;                                             -- ученик не на этом занятии
    _override := _lesson_override;                                     -- индивид: override занятия
  END IF;

  SELECT hourly_rate_cents INTO _rate FROM public.tutor_students WHERE id = _tutor_student_id;
  _cost := COALESCE(_override,
    CASE WHEN _rate IS NULL OR _rate <= 0 OR COALESCE(_dur, 0) <= 0 THEN NULL
         ELSE ROUND((_dur::numeric / 60) * (_rate::numeric / 100))::int END);

  IF _cost IS NULL THEN
    RETURN;                                                                   -- нет ставки/override → skip
  ELSIF _cost <= 0 THEN
    PERFORM public._reverse_lesson_debit(_lesson_id, _tutor_student_id);       -- waive (P1 reverse-on-0)
  ELSE
    PERFORM public._sync_lesson_debit(_lesson_id, _tutor_student_id, _tutor_id, _cost, _actor);
  END IF;
END $$;

REVOKE ALL ON FUNCTION public._apply_lesson_debit_from_current_cost(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._apply_lesson_debit_from_current_cost(uuid, uuid, uuid) TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Авто-списание — через _apply (TOCTOU-safe) + счётчик `processed` (P2)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.tutor_auto_debit_due_lessons(_tutor_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _lesson RECORD; _student RECORD; _actor uuid; _processed int := 0; _errors int := 0;
BEGIN
  FOR _lesson IN
    SELECT l.id, l.tutor_id, l.tutor_student_id
    FROM public.tutor_lessons l
    WHERE (_tutor_id IS NULL OR l.tutor_id = _tutor_id)
      AND l.start_at + make_interval(mins => COALESCE(l.duration_min, 60)) <= now()
      AND l.start_at >= now() - interval '60 days'
  LOOP
    BEGIN
      _actor := COALESCE(auth.uid(), (SELECT user_id FROM public.tutors WHERE id = _lesson.tutor_id));
      IF EXISTS (SELECT 1 FROM public.tutor_lesson_participants p WHERE p.lesson_id = _lesson.id) THEN
        FOR _student IN
          SELECT tutor_student_id FROM public.tutor_lesson_participants WHERE lesson_id = _lesson.id
        LOOP
          PERFORM public._apply_lesson_debit_from_current_cost(_lesson.id, _student.tutor_student_id, _actor);
          _processed := _processed + 1;
        END LOOP;
      ELSIF _lesson.tutor_student_id IS NOT NULL THEN
        PERFORM public._apply_lesson_debit_from_current_cost(_lesson.id, _lesson.tutor_student_id, _actor);
        _processed := _processed + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      _errors := _errors + 1;                                                  -- одно занятие не валит прогон
    END;
  END LOOP;
  RETURN jsonb_build_object('processed', _processed, 'errors', _errors);
END $$;

REVOKE ALL ON FUNCTION public.tutor_auto_debit_due_lessons(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_auto_debit_due_lessons(uuid) TO service_role;

-- Список туторов с «созревшими» занятиями — для per-tutor cron (edge зовёт RPC по каждому отдельно).
CREATE OR REPLACE FUNCTION public.tutor_ids_with_due_lessons()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT l.tutor_id FROM public.tutor_lessons l
  WHERE l.start_at + make_interval(mins => COALESCE(l.duration_min, 60)) <= now()
    AND l.start_at >= now() - interval '60 days';
$$;
REVOKE ALL ON FUNCTION public.tutor_ids_with_due_lessons() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_ids_with_due_lessons() TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Setters — через _apply (TOCTOU-safe: цена читается под lock'ом после UPDATE)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.tutor_set_lesson_cost(_lesson_id uuid, _amount integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tutor_id uuid; _student uuid;
BEGIN
  IF _amount IS NULL OR _amount < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  SELECT l.tutor_id, l.tutor_student_id INTO _tutor_id, _student
  FROM public.tutor_lessons l JOIN public.tutors t ON t.id = l.tutor_id
  WHERE l.id = _lesson_id AND t.user_id = auth.uid();
  IF _tutor_id IS NULL THEN RAISE EXCEPTION 'NOT_OWNED'; END IF;
  IF _student IS NULL THEN RAISE EXCEPTION 'GROUP_LESSON'; END IF;

  UPDATE public.tutor_lessons SET payment_amount = _amount WHERE id = _lesson_id;
  PERFORM public._apply_lesson_debit_from_current_cost(_lesson_id, _student, auth.uid());  -- no-op если будущее
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.tutor_set_participant_cost(
  _lesson_id uuid, _tutor_student_id uuid, _amount integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tutor_id uuid;
BEGIN
  IF _amount IS NULL OR _amount < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  SELECT l.tutor_id INTO _tutor_id
  FROM public.tutor_lessons l JOIN public.tutors t ON t.id = l.tutor_id
  WHERE l.id = _lesson_id AND t.user_id = auth.uid();
  IF _tutor_id IS NULL THEN RAISE EXCEPTION 'NOT_OWNED'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tutor_lesson_participants p
    JOIN public.tutor_students ts ON ts.id = p.tutor_student_id AND ts.tutor_id = _tutor_id
    WHERE p.lesson_id = _lesson_id AND p.tutor_student_id = _tutor_student_id
  ) THEN RAISE EXCEPTION 'PARTICIPANT_NOT_FOUND'; END IF;

  UPDATE public.tutor_lesson_participants SET payment_amount = _amount
   WHERE lesson_id = _lesson_id AND tutor_student_id = _tutor_student_id;
  -- _sync_lesson_debit внутри _apply дополнительно валидирует STUDENT_TUTOR_MISMATCH.
  PERFORM public._apply_lesson_debit_from_current_cost(_lesson_id, _tutor_student_id, auth.uid());
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.tutor_set_lesson_cost(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tutor_set_participant_cost(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_set_lesson_cost(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tutor_set_participant_cost(uuid, uuid, integer) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. complete_lesson_and_create_payment — ЗАМОРОЗКА (без tutor_payments + без credit-on-paid)
--    verbatim база из 20260615182853 + cost-driven debit через _apply (reverse-on-0, P1).
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.complete_lesson_and_create_payment(
  _lesson_id uuid,
  _amount integer,
  _payment_status text DEFAULT 'pending',
  _tutor_telegram_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  _tutor_id uuid;
  _tutor_student_id uuid;
  _is_group boolean;
  _participant record;
  _actor uuid;
BEGIN
  IF _tutor_telegram_id IS NOT NULL THEN
    SELECT t.id, l.tutor_student_id INTO _tutor_id, _tutor_student_id
    FROM public.tutors t JOIN public.tutor_lessons l ON l.tutor_id = t.id
    WHERE l.id = _lesson_id AND t.telegram_id = _tutor_telegram_id;
  ELSE
    SELECT t.id, l.tutor_student_id INTO _tutor_id, _tutor_student_id
    FROM public.tutors t JOIN public.tutor_lessons l ON l.tutor_id = t.id
    WHERE l.id = _lesson_id AND t.user_id = auth.uid();
  END IF;

  IF _tutor_id IS NULL THEN
    RETURN false;
  END IF;

  _actor := COALESCE(auth.uid(), (SELECT user_id FROM public.tutors WHERE id = _tutor_id));

  SELECT EXISTS (
    SELECT 1 FROM public.tutor_lesson_participants WHERE lesson_id = _lesson_id
  ) INTO _is_group;

  -- payment_status/paid_at — back-compat поля (per-lesson статуса оплаты больше нет в UI). Для индивидуального
  -- занятия фиксируем override = _amount (включая 0 = waive), чтобы авто-debit читал ту же цену.
  UPDATE public.tutor_lessons
  SET
    status = 'completed',
    payment_status = _payment_status,
    payment_amount = CASE WHEN NOT _is_group THEN _amount ELSE NULL END,
    paid_at = CASE WHEN _payment_status IN ('paid', 'paid_earlier') THEN NOW() ELSE NULL END,
    payment_reminder_sent = true
  WHERE id = _lesson_id;

  IF _is_group THEN
    FOR _participant IN
      SELECT p.tutor_student_id FROM public.tutor_lesson_participants p WHERE p.lesson_id = _lesson_id
    LOOP
      -- cost-driven: списание по текущей цене участника (0 → reverse, >0 → sync), под lock'ом.
      PERFORM public._apply_lesson_debit_from_current_cost(_lesson_id, _participant.tutor_student_id, _actor);
      UPDATE public.tutor_lesson_participants
      SET payment_status = _payment_status,
          paid_at = CASE WHEN _payment_status IN ('paid', 'paid_earlier') THEN NOW() ELSE NULL END
      WHERE lesson_id = _lesson_id AND tutor_student_id = _participant.tutor_student_id;
    END LOOP;
  ELSIF _tutor_student_id IS NOT NULL THEN
    PERFORM public._apply_lesson_debit_from_current_cost(_lesson_id, _tutor_student_id, _actor);
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_lesson_and_create_payment(uuid, integer, text, text)
  TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. update_group_participant_payment_status — косметика (без денег)
--    Per-lesson статус оплаты убран; debit следует за ЦЕНОЙ участника (setParticipantCost/авто-debit),
--    не за этим тумблером. Оставляем как cosmetic-сеттер до удаления UI (point 3); БЕЗ tutor_payments/credit.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.update_group_participant_payment_status(
  _lesson_id uuid,
  _tutor_student_id uuid,
  _payment_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE _tutor_id uuid; _lesson_status text; _participant_amount integer; _paid_at timestamptz;
BEGIN
  IF _payment_status NOT IN ('pending', 'paid') THEN
    RETURN jsonb_build_object('ok', false, 'status', NULL, 'amount', NULL, 'paid_at', NULL,
      'error_code', 'INVALID_PAYMENT_STATUS');
  END IF;

  SELECT t.id, l.status INTO _tutor_id, _lesson_status
  FROM public.tutor_lessons l JOIN public.tutors t ON t.id = l.tutor_id
  WHERE l.id = _lesson_id AND t.user_id = auth.uid();
  IF _tutor_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', NULL, 'amount', NULL, 'paid_at', NULL,
      'error_code', 'LESSON_NOT_FOUND_OR_FORBIDDEN');
  END IF;
  IF _lesson_status <> 'completed' THEN
    RETURN jsonb_build_object('ok', false, 'status', NULL, 'amount', NULL, 'paid_at', NULL,
      'error_code', 'LESSON_NOT_COMPLETED');
  END IF;

  SELECT p.payment_amount INTO _participant_amount
  FROM public.tutor_lesson_participants p
  WHERE p.lesson_id = _lesson_id AND p.tutor_student_id = _tutor_student_id;

  IF _participant_amount IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.tutor_lesson_participants p
    WHERE p.lesson_id = _lesson_id AND p.tutor_student_id = _tutor_student_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'status', NULL, 'amount', NULL, 'paid_at', NULL,
      'error_code', 'PARTICIPANT_NOT_FOUND');
  END IF;

  _paid_at := CASE WHEN _payment_status = 'paid' THEN NOW() ELSE NULL END;

  -- Только cosmetic-статус. Деньги НЕ трогаем (debit следует за ценой, не за этим флагом).
  UPDATE public.tutor_lesson_participants
  SET payment_status = _payment_status, paid_at = _paid_at
  WHERE lesson_id = _lesson_id AND tutor_student_id = _tutor_student_id;

  RETURN jsonb_build_object('ok', true, 'status', _payment_status, 'amount', _participant_amount,
    'paid_at', _paid_at, 'error_code', NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_group_participant_payment_status(uuid, uuid, text)
  TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. REVOKE tutor_confirm_lessons FROM authenticated (UI удалён; defense-in-depth P1)
-- ════════════════════════════════════════════════════════════════════════════
-- ConfirmLessonsSheet удалён; bulk-подтверждение не нужно (авто-debit). Стейл-вкладка старого бандла
-- больше не сможет дёрнуть RPC (fail-loud). complete уже reverse-on-0, так что это belt-and-suspenders.
REVOKE EXECUTE ON FUNCTION public.tutor_confirm_lessons(jsonb) FROM authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Отмена занятия с суммой списания (immediate, не past-gated) — individual
-- ════════════════════════════════════════════════════════════════════════════
-- Vladimir: «при отмене списывается сумма, которую репетитор введёт (0 = не списывать)».
-- Детерминированно и СРАЗУ (в отличие от _apply, который ждёт окончания) — отменённое = должок сейчас.
-- Группа → GROUP_LESSON (отмена группы + стоимость по участнику = per-participant cost editor).
CREATE OR REPLACE FUNCTION public.tutor_cancel_lesson_with_charge(_lesson_id uuid, _amount integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tutor_id uuid; _student uuid; _is_group boolean;
BEGIN
  IF _amount IS NULL OR _amount < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  SELECT l.tutor_id, l.tutor_student_id INTO _tutor_id, _student
  FROM public.tutor_lessons l JOIN public.tutors t ON t.id = l.tutor_id
  WHERE l.id = _lesson_id AND t.user_id = auth.uid();
  IF _tutor_id IS NULL THEN RAISE EXCEPTION 'NOT_OWNED'; END IF;

  SELECT EXISTS (SELECT 1 FROM public.tutor_lesson_participants WHERE lesson_id = _lesson_id) INTO _is_group;
  IF _is_group THEN RAISE EXCEPTION 'GROUP_LESSON'; END IF;
  IF _student IS NULL THEN RAISE EXCEPTION 'NO_STUDENT'; END IF;

  -- Тот же 2-key lock, что у _apply/_sync/_reverse (реентерабелен в этой txn) → сериализует с cron
  -- авто-debit'ом (P0 fix): иначе нулевой reverse расходился с параллельным _apply и оставлял
  -- устаревший active debit на «прощённом» отменённом занятии.
  PERFORM pg_advisory_xact_lock(hashtext(_lesson_id::text), hashtext(_student::text));

  UPDATE public.tutor_lessons
  SET status = 'cancelled', cancelled_by = 'tutor', cancelled_at = now(), payment_amount = _amount
  WHERE id = _lesson_id;

  IF _amount > 0 THEN
    PERFORM public._sync_lesson_debit(_lesson_id, _student, _tutor_id, _amount, auth.uid());  -- immediate
  ELSE
    PERFORM public._reverse_lesson_debit(_lesson_id, _student);                                -- не списывать
  END IF;

  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.tutor_cancel_lesson_with_charge(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_cancel_lesson_with_charge(uuid, integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
