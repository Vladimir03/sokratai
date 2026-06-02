-- =============================================================================
-- schedule-bulk-complete CC-A — atomic confirm + revert RPCs
-- Spec: docs/delivery/features/schedule-bulk-complete/spec.md
--
-- Презумптивное подтверждение прошедших занятий. Деньги (tutor_payments)
-- создаются ТОЛЬКО этими RPC (вызов с клиента на «Подтвердить»), не молча.
-- Переиспользуют существующую complete_lesson_and_create_payment (group-aware,
-- ON CONFLICT (lesson_id, tutor_student_id), миграция 20260224220000) — её НЕ меняем.
-- Client-callable (как complete_lesson_and_create_payment): ownership внутри по auth.uid().
-- amount = РУБЛИ (как calculateLessonPaymentAmount / tutor_payments.amount CHECK > 0).
-- =============================================================================

-- ── 1. Bulk confirm ──────────────────────────────────────────────────────────
-- p_lessons = [{ lesson_id, amount?, participants?: [{tutor_student_id, amount}] }]
-- Individual: amount (0 → completed без платежа). Group: per-participant amount
-- (0 = «не был» → платёж не создаётся). Per-lesson подтранзакция: ошибка одного
-- занятия не валит остальные. Только status='booked' + lesson_type='regular'.
CREATE OR REPLACE FUNCTION public.tutor_confirm_lessons(p_lessons jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _item jsonb;
  _lesson_id uuid;
  _amount integer;
  _participant jsonb;
  _is_group boolean;
  _eligible boolean;
  _results jsonb := '[]'::jsonb;
  _confirmed int := 0;
  _skipped int := 0;
BEGIN
  IF p_lessons IS NULL OR jsonb_typeof(p_lessons) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD';
  END IF;

  FOR _item IN SELECT * FROM jsonb_array_elements(p_lessons)
  LOOP
    BEGIN
      _lesson_id := (_item->>'lesson_id')::uuid;

      -- ownership + eligibility (owned by auth.uid(), booked, regular)
      SELECT true INTO _eligible
      FROM public.tutor_lessons l
      JOIN public.tutors t ON t.id = l.tutor_id
      WHERE l.id = _lesson_id
        AND t.user_id = auth.uid()
        AND l.status = 'booked'
        AND l.lesson_type = 'regular';

      IF _eligible IS NOT TRUE THEN
        _results := _results || jsonb_build_object('lesson_id', _lesson_id, 'status', 'skipped', 'reason', 'not_eligible');
        _skipped := _skipped + 1;
        CONTINUE;
      END IF;

      _is_group := EXISTS (SELECT 1 FROM public.tutor_lesson_participants WHERE lesson_id = _lesson_id);

      IF _is_group AND (_item ? 'participants') AND jsonb_typeof(_item->'participants') = 'array' THEN
        -- apply edited per-participant amounts (0 = «не был» → complete skips payment)
        FOR _participant IN SELECT * FROM jsonb_array_elements(_item->'participants')
        LOOP
          UPDATE public.tutor_lesson_participants
          SET payment_amount = GREATEST(0, COALESCE((_participant->>'amount')::integer, 0))
          WHERE lesson_id = _lesson_id
            AND tutor_student_id = (_participant->>'tutor_student_id')::uuid;
        END LOOP;
        PERFORM public.complete_lesson_and_create_payment(_lesson_id, 0, 'pending');
      ELSE
        _amount := GREATEST(0, COALESCE((_item->>'amount')::integer, 0));
        PERFORM public.complete_lesson_and_create_payment(_lesson_id, _amount, 'pending');
      END IF;

      _results := _results || jsonb_build_object('lesson_id', _lesson_id, 'status', 'ok');
      _confirmed := _confirmed + 1;
    EXCEPTION WHEN OTHERS THEN
      -- per-lesson savepoint rollback; continue with the rest
      _results := _results || jsonb_build_object('lesson_id', _lesson_id, 'status', 'error', 'reason', SQLERRM);
      _skipped := _skipped + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('confirmed', _confirmed, 'skipped', _skipped, 'results', _results);
END;
$$;

REVOKE ALL ON FUNCTION public.tutor_confirm_lessons(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_confirm_lessons(jsonb) TO authenticated, service_role;

-- ── 2. Revert (undo, AC-5) ─────────────────────────────────────────────────────
-- Откат подтверждённого занятия: удаляет ТОЛЬКО pending-платежи (полученные/paid
-- сохраняем — нельзя терять деньги; флаг had_paid → UI предупредит), занятие → cancelled.
CREATE OR REPLACE FUNCTION public.tutor_revert_lesson(p_lesson_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _owned boolean;
  _deleted_pending int := 0;
  _had_paid boolean := false;
BEGIN
  SELECT true INTO _owned
  FROM public.tutor_lessons l
  JOIN public.tutors t ON t.id = l.tutor_id
  WHERE l.id = p_lesson_id
    AND t.user_id = auth.uid()
    AND l.status = 'completed';

  IF _owned IS NOT TRUE THEN
    RAISE EXCEPTION 'NOT_OWNED_OR_NOT_COMPLETED';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.tutor_payments WHERE lesson_id = p_lesson_id AND status = 'paid'
  ) INTO _had_paid;

  WITH del AS (
    DELETE FROM public.tutor_payments
    WHERE lesson_id = p_lesson_id AND status = 'pending'
    RETURNING 1
  )
  SELECT count(*) INTO _deleted_pending FROM del;

  UPDATE public.tutor_lessons
  SET status = 'cancelled',
      cancelled_by = 'tutor',
      cancelled_at = now(),
      payment_status = 'unpaid',
      payment_amount = NULL,
      paid_at = NULL,
      payment_reminder_sent = false
  WHERE id = p_lesson_id;

  UPDATE public.tutor_lesson_participants
  SET payment_status = 'unpaid', paid_at = NULL
  WHERE lesson_id = p_lesson_id;

  RETURN jsonb_build_object('ok', true, 'deleted_pending', _deleted_pending, 'had_paid', _had_paid);
END;
$$;

REVOKE ALL ON FUNCTION public.tutor_revert_lesson(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_revert_lesson(uuid) TO authenticated, service_role;
