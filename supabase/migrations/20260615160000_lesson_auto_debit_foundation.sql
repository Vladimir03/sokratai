-- Phase 2b (Stage A — АДДИТИВНО): редактируемая стоимость занятия (B0) + авто-списание прошедших (B1).
-- План: ~/.claude/plans/1-glowing-spindle.md (Phase 2b). Money-critical. Зависит от ledger-хелперов
-- (`_sync_lesson_debit`/`_reverse_lesson_debit` — идемпотентные, amount-aware, advisory-lock).
--
-- Эта миграция ТОЛЬКО добавляет (новые функции). Не трогает `complete_lesson_and_create_payment` и
-- кредит-сторону (2a). Безопасно вместе с 2a: авто-debit использует `_sync_lesson_debit` → на занятии,
-- у которого debit уже есть (из complete/seed) той же суммы, это no-op; на прошедшем «booked» без debit —
-- создаёт debit (намеренно). Заморозку payment-статусов и /pay-reframe делает Stage B (отдельно).
--
-- Биллинг cost-driven: эффективная стоимость = COALESCE(override `payment_amount`, derived rate×duration).
-- override 0 = явный waive (реверс debit). NULL override + нет ставки → не списываем (skip). Будущие — skip.

-- ─── Эффективные стоимости занятия по ученикам (group → по участникам; individual → по ученику) ──
-- derived зеркалит src/lib/paymentAmount.ts::calculateLessonPaymentAmount (ROUND(dur/60 * rate/100)).
CREATE OR REPLACE FUNCTION public._lesson_effective_costs(_lesson_id uuid)
RETURNS TABLE(tutor_student_id uuid, amount integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _is_group boolean; _dur int;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.tutor_lesson_participants p WHERE p.lesson_id = _lesson_id) INTO _is_group;
  SELECT duration_min INTO _dur FROM public.tutor_lessons WHERE id = _lesson_id;

  IF _is_group THEN
    RETURN QUERY
      SELECT p.tutor_student_id,
             COALESCE(
               p.payment_amount,
               CASE WHEN ts.hourly_rate_cents IS NULL OR ts.hourly_rate_cents <= 0 OR COALESCE(_dur,0) <= 0
                    THEN NULL
                    ELSE ROUND((_dur::numeric / 60) * (ts.hourly_rate_cents::numeric / 100))::int END
             )
      FROM public.tutor_lesson_participants p
      JOIN public.tutor_students ts ON ts.id = p.tutor_student_id
      WHERE p.lesson_id = _lesson_id;
  ELSE
    RETURN QUERY
      SELECT l.tutor_student_id,
             COALESCE(
               l.payment_amount,
               CASE WHEN ts.hourly_rate_cents IS NULL OR ts.hourly_rate_cents <= 0 OR COALESCE(l.duration_min,0) <= 0
                    THEN NULL
                    ELSE ROUND((l.duration_min::numeric / 60) * (ts.hourly_rate_cents::numeric / 100))::int END
             )
      FROM public.tutor_lessons l
      JOIN public.tutor_students ts ON ts.id = l.tutor_student_id
      WHERE l.id = _lesson_id AND l.tutor_student_id IS NOT NULL;
  END IF;
END $$;

-- ─── B1: авто-списание прошедших занятий (cost-driven, status-independent) ──────
-- Скан end ≤ now в окне [now−60д, now] (сид покрыл более старую историю). Идемпотентно (повторный прогон
-- = no-op). Per-lesson EXCEPTION → одно битое занятие не валит прогон (mirror tutor_confirm_lessons).
CREATE OR REPLACE FUNCTION public.tutor_auto_debit_due_lessons(_tutor_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _lesson RECORD; _cost RECORD; _actor uuid;
  _debited int := 0; _reversed int := 0; _errors int := 0;
BEGIN
  FOR _lesson IN
    SELECT l.id, l.tutor_id
    FROM public.tutor_lessons l
    WHERE (_tutor_id IS NULL OR l.tutor_id = _tutor_id)
      AND l.start_at + make_interval(mins => COALESCE(l.duration_min, 60)) <= now()
      AND l.start_at >= now() - interval '60 days'
    -- status-independent: booked / completed / cancelled — все списываются по своей стоимости.
    -- Удалённые занятия физически отсутствуют (tutor_delete_lessons) → не попадают.
  LOOP
    BEGIN
      _actor := COALESCE(auth.uid(), (SELECT user_id FROM public.tutors WHERE id = _lesson.tutor_id));
      FOR _cost IN SELECT * FROM public._lesson_effective_costs(_lesson.id) LOOP
        IF _cost.amount IS NULL THEN
          CONTINUE;                                              -- нет ставки/override → не считаем, не трогаем
        ELSIF _cost.amount <= 0 THEN
          PERFORM public._reverse_lesson_debit(_lesson.id, _cost.tutor_student_id);  -- цена 0 = waive
          _reversed := _reversed + 1;
        ELSE
          PERFORM public._sync_lesson_debit(_lesson.id, _cost.tutor_student_id, _lesson.tutor_id, _cost.amount, _actor);
          _debited := _debited + 1;
        END IF;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      _errors := _errors + 1;                                    -- LEDGER_DEBIT_RACE и пр. → ретрай следующим тиком
    END;
  END LOOP;
  RETURN jsonb_build_object('debited', _debited, 'reversed', _reversed, 'errors', _errors);
END $$;

-- ─── Клиентский scoped-вариант (lazy reconcile на загрузке расписания) ──────────
CREATE OR REPLACE FUNCTION public.tutor_sync_my_due_debits()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tutor_id uuid;
BEGIN
  SELECT id INTO _tutor_id FROM public.tutors WHERE user_id = auth.uid();
  IF _tutor_id IS NULL THEN RETURN jsonb_build_object('debited',0,'reversed',0,'errors',0); END IF;
  RETURN public.tutor_auto_debit_due_lessons(_tutor_id);        -- scoped по своему tutor_id → чужих не трогает
END $$;

-- ─── B0: редактируемая стоимость занятия / участника (+ пересчёт списания) ──────
-- override `payment_amount` (0 = waive). Если занятие уже прошло → сразу пересинк debit (immediate recompute).
CREATE OR REPLACE FUNCTION public.tutor_set_lesson_cost(_lesson_id uuid, _amount integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tutor_id uuid; _student uuid; _is_past boolean;
BEGIN
  IF _amount IS NULL OR _amount < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  SELECT l.tutor_id, l.tutor_student_id,
         (l.start_at + make_interval(mins => COALESCE(l.duration_min,60)) <= now())
    INTO _tutor_id, _student, _is_past
  FROM public.tutor_lessons l JOIN public.tutors t ON t.id = l.tutor_id
  WHERE l.id = _lesson_id AND t.user_id = auth.uid();
  IF _tutor_id IS NULL THEN RAISE EXCEPTION 'NOT_OWNED'; END IF;
  IF _student IS NULL THEN RAISE EXCEPTION 'GROUP_LESSON'; END IF;  -- группа → tutor_set_participant_cost

  UPDATE public.tutor_lessons SET payment_amount = _amount WHERE id = _lesson_id;

  IF _is_past THEN
    IF _amount <= 0 THEN PERFORM public._reverse_lesson_debit(_lesson_id, _student);
    ELSE PERFORM public._sync_lesson_debit(_lesson_id, _student, _tutor_id, _amount, auth.uid()); END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'recomputed', _is_past);
END $$;

CREATE OR REPLACE FUNCTION public.tutor_set_participant_cost(
  _lesson_id uuid, _tutor_student_id uuid, _amount integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tutor_id uuid; _is_past boolean;
BEGIN
  IF _amount IS NULL OR _amount < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  SELECT l.tutor_id, (l.start_at + make_interval(mins => COALESCE(l.duration_min,60)) <= now())
    INTO _tutor_id, _is_past
  FROM public.tutor_lessons l JOIN public.tutors t ON t.id = l.tutor_id
  WHERE l.id = _lesson_id AND t.user_id = auth.uid();
  IF _tutor_id IS NULL THEN RAISE EXCEPTION 'NOT_OWNED'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tutor_lesson_participants
    WHERE lesson_id = _lesson_id AND tutor_student_id = _tutor_student_id
  ) THEN RAISE EXCEPTION 'PARTICIPANT_NOT_FOUND'; END IF;

  UPDATE public.tutor_lesson_participants SET payment_amount = _amount
   WHERE lesson_id = _lesson_id AND tutor_student_id = _tutor_student_id;

  IF _is_past THEN
    IF _amount <= 0 THEN PERFORM public._reverse_lesson_debit(_lesson_id, _tutor_student_id);
    ELSE PERFORM public._sync_lesson_debit(_lesson_id, _tutor_student_id, _tutor_id, _amount, auth.uid()); END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'recomputed', _is_past);
END $$;

-- ─── GRANTs ─────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public._lesson_effective_costs(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tutor_auto_debit_due_lessons(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tutor_sync_my_due_debits() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tutor_set_lesson_cost(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tutor_set_participant_cost(uuid, uuid, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public._lesson_effective_costs(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.tutor_auto_debit_due_lessons(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.tutor_sync_my_due_debits() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tutor_set_lesson_cost(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tutor_set_participant_cost(uuid, uuid, integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
