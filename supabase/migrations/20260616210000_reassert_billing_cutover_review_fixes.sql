-- Phase 2b — RE-ASSERT review fixes (money-critical). НЕ задеплоено.
--
-- ПРИЧИНА: Lovable при синке/деплое заново «захватил» B4 (`20260615190000`) под своим таймстампом
-- `20260616203136_…` из ПРОМЕЖУТОЧНОГО состояния (P1 уже был, но P0#1 и P2 — ещё нет). Его копия имеет
-- БОЛЬШИЙ таймстамп → при прогоне миграций выигрывает и МОЛЧА откатывает два money-critical фикса
-- ревью ChatGPT-5.5:
--   • P0#1 — advisory-lock в `tutor_cancel_lesson_with_charge` (без него нулевой reverse расходится с
--     параллельным cron-`_apply` → устаревший active debit на «прощённом» отменённом занятии).
--   • P2  — ownership-JOIN на `tutor_students` в `tutor_set_participant_cost` (нулевой/reverse-путь иначе
--     не валидирует, что участник принадлежит тутору).
-- P1 (`_apply` COALESCE participant∥lesson∥derived) в копии Lovable присутствует, но re-assert'им и его —
-- идемпотентно, гарантирует канонический body. Эта миграция имеет таймстамп ПОЗЖЕ всех копий Lovable
-- (`…203204`) → выигрывает; после её прогона БД содержит фиксы, и будущие захваты Lovable будут уже
-- корректны (Lovable снимает состояние БД).
--
-- VERBATIM из `20260615190000_lesson_billing_cutover_b4.sql` (canonical). Все три — CREATE OR REPLACE,
-- идемпотентны. Edge-функции (telegram-bot/payment-reminder, P0#2) Lovable не трогал — там фиксы целы.

-- ── P1: _apply_lesson_debit_from_current_cost (TOCTOU-safe, cost=COALESCE(participant, lesson, derived)) ──
CREATE OR REPLACE FUNCTION public._apply_lesson_debit_from_current_cost(
  _lesson_id uuid, _tutor_student_id uuid, _actor uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tutor_id uuid; _dur int; _is_past boolean; _rate int;
  _part_override int; _lesson_override int; _has_part boolean := false; _override int; _cost int;
BEGIN
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

-- ── P2: tutor_set_participant_cost (ownership через tutor_students) ──
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
REVOKE ALL ON FUNCTION public.tutor_set_participant_cost(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_set_participant_cost(uuid, uuid, integer) TO authenticated, service_role;

-- ── P0#1: tutor_cancel_lesson_with_charge (immediate debit ПОД 2-key advisory-lock) ──
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
  -- устаревший active debit на «прощённом» занятии.
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
