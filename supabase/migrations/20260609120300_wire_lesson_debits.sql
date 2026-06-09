-- Student balance ledger — Phase 2a, TASK-3: wire ledger debits into the money chokepoints.
-- SPEC v4 / AC-3/11/14/15. ⚠️ REPRODUCTION of frozen money RPCs (rule 10) — bodies copied
-- VERBATIM from their latest definitions; the ONLY additions are marked `-- TASK-3` (an _actor
-- var + PERFORM _sync_lesson_debit / _reverse_ledger_entry). Payment/group/return behavior is
-- unchanged. MANDATORY Codex review of this diff before deploy.
--
-- Covered payment-write sites (grep INSERT INTO tutor_payments, active defs — AC-15):
--   * complete_lesson_and_create_payment (20260224220000) — group loop + individual.
--   * update_group_participant_payment_status (20260224220000) — participant status path.
--   tutor_confirm_lessons (bulk) reuses complete_lesson_and_create_payment → covered transitively.
-- Reverse sites: tutor_delete_lessons (20260604120000), tutor_revert_lesson (20260602191806).
-- Older payment-INSERT migrations (20260220*/20260224123937/20260224142103) are superseded by
-- the above CREATE OR REPLACE definitions and are NOT active.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. complete_lesson_and_create_payment — verbatim + _sync_lesson_debit
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
  _resolved_amount integer;
  _payment_row_status text;
  _is_group boolean;
  _participant record;
  _actor uuid;                              -- TASK-3 (ledger created_by)
BEGIN
  IF _tutor_telegram_id IS NOT NULL THEN
    SELECT t.id, l.tutor_student_id
      INTO _tutor_id, _tutor_student_id
    FROM public.tutors t
    JOIN public.tutor_lessons l ON l.tutor_id = t.id
    WHERE l.id = _lesson_id
      AND t.telegram_id = _tutor_telegram_id;
  ELSE
    SELECT t.id, l.tutor_student_id
      INTO _tutor_id, _tutor_student_id
    FROM public.tutors t
    JOIN public.tutor_lessons l ON l.tutor_id = t.id
    WHERE l.id = _lesson_id
      AND t.user_id = auth.uid();
  END IF;

  IF _tutor_id IS NULL THEN
    RETURN false;
  END IF;

  _actor := COALESCE(auth.uid(), (SELECT user_id FROM public.tutors WHERE id = _tutor_id));  -- TASK-3

  SELECT EXISTS (
    SELECT 1 FROM public.tutor_lesson_participants WHERE lesson_id = _lesson_id
  ) INTO _is_group;

  _payment_row_status := CASE
    WHEN _payment_status IN ('paid', 'paid_earlier') THEN 'paid'
    ELSE 'pending'
  END;

  UPDATE public.tutor_lessons
  SET
    status = 'completed',
    payment_status = _payment_status,
    payment_amount = CASE WHEN NOT _is_group THEN
      CASE WHEN _amount IS NOT NULL AND _amount > 0 THEN _amount ELSE NULL END
    ELSE NULL END,
    paid_at = CASE
      WHEN _payment_status IN ('paid', 'paid_earlier') THEN NOW()
      ELSE NULL
    END,
    payment_reminder_sent = true
  WHERE id = _lesson_id;

  IF _is_group THEN
    FOR _participant IN
      SELECT p.tutor_student_id, p.payment_amount
      FROM public.tutor_lesson_participants p
      WHERE p.lesson_id = _lesson_id
    LOOP
      IF _participant.payment_amount IS NOT NULL AND _participant.payment_amount > 0 THEN
        INSERT INTO public.tutor_payments (
          lesson_id, tutor_student_id, amount, status, due_date, paid_at
        ) VALUES (
          _lesson_id,
          _participant.tutor_student_id,
          _participant.payment_amount,
          _payment_row_status,
          CURRENT_DATE,
          CASE WHEN _payment_status IN ('paid', 'paid_earlier') THEN NOW() ELSE NULL END
        )
        ON CONFLICT (lesson_id, tutor_student_id)
          WHERE lesson_id IS NOT NULL AND tutor_student_id IS NOT NULL
        DO UPDATE SET
          amount = EXCLUDED.amount,
          status = EXCLUDED.status,
          due_date = EXCLUDED.due_date,
          paid_at = EXCLUDED.paid_at;

        PERFORM public._sync_lesson_debit(  -- TASK-3
          _lesson_id, _participant.tutor_student_id, _tutor_id, _participant.payment_amount, _actor);
      END IF;

      UPDATE public.tutor_lesson_participants
      SET
        payment_status = _payment_status,
        paid_at = CASE WHEN _payment_status IN ('paid', 'paid_earlier') THEN NOW() ELSE NULL END
      WHERE lesson_id = _lesson_id
        AND tutor_student_id = _participant.tutor_student_id;
    END LOOP;
  ELSE
    _resolved_amount := CASE
      WHEN _amount IS NOT NULL AND _amount > 0 THEN _amount
      ELSE NULL
    END;

    IF _resolved_amount IS NOT NULL AND _tutor_student_id IS NOT NULL THEN
      INSERT INTO public.tutor_payments (
        lesson_id, tutor_student_id, amount, status, due_date, paid_at
      ) VALUES (
        _lesson_id,
        _tutor_student_id,
        _resolved_amount,
        _payment_row_status,
        CURRENT_DATE,
        CASE WHEN _payment_status IN ('paid', 'paid_earlier') THEN NOW() ELSE NULL END
      )
      ON CONFLICT (lesson_id, tutor_student_id)
        WHERE lesson_id IS NOT NULL AND tutor_student_id IS NOT NULL
      DO UPDATE SET
        amount = EXCLUDED.amount,
        status = EXCLUDED.status,
        due_date = EXCLUDED.due_date,
        paid_at = EXCLUDED.paid_at;

      PERFORM public._sync_lesson_debit(  -- TASK-3
        _lesson_id, _tutor_student_id, _tutor_id, _resolved_amount, _actor);
    END IF;
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_lesson_and_create_payment(uuid, integer, text, text)
  TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. update_group_participant_payment_status — verbatim + _sync_lesson_debit
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
DECLARE
  _tutor_id uuid;
  _lesson_status text;
  _payment_row_status text;
  _participant_amount integer;
  _paid_at timestamptz;
  _actor uuid;                              -- TASK-3
BEGIN
  IF _payment_status NOT IN ('pending', 'paid') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', NULL,
      'amount', NULL,
      'paid_at', NULL,
      'error_code', 'INVALID_PAYMENT_STATUS'
    );
  END IF;

  SELECT t.id, l.status
    INTO _tutor_id, _lesson_status
  FROM public.tutor_lessons l
  JOIN public.tutors t ON t.id = l.tutor_id
  WHERE l.id = _lesson_id
    AND t.user_id = auth.uid();

  IF _tutor_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', NULL,
      'amount', NULL,
      'paid_at', NULL,
      'error_code', 'LESSON_NOT_FOUND_OR_FORBIDDEN'
    );
  END IF;

  _actor := COALESCE(auth.uid(), (SELECT user_id FROM public.tutors WHERE id = _tutor_id));  -- TASK-3

  IF _lesson_status <> 'completed' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', NULL,
      'amount', NULL,
      'paid_at', NULL,
      'error_code', 'LESSON_NOT_COMPLETED'
    );
  END IF;

  SELECT p.payment_amount
    INTO _participant_amount
  FROM public.tutor_lesson_participants p
  WHERE p.lesson_id = _lesson_id
    AND p.tutor_student_id = _tutor_student_id;

  IF _participant_amount IS NULL AND NOT EXISTS (
    SELECT 1
    FROM public.tutor_lesson_participants p
    WHERE p.lesson_id = _lesson_id
      AND p.tutor_student_id = _tutor_student_id
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', NULL,
      'amount', NULL,
      'paid_at', NULL,
      'error_code', 'PARTICIPANT_NOT_FOUND'
    );
  END IF;

  _payment_row_status := CASE
    WHEN _payment_status = 'paid' THEN 'paid'
    ELSE 'pending'
  END;
  _paid_at := CASE
    WHEN _payment_status = 'paid' THEN NOW()
    ELSE NULL
  END;

  UPDATE public.tutor_lesson_participants
  SET
    payment_status = _payment_status,
    paid_at = _paid_at
  WHERE lesson_id = _lesson_id
    AND tutor_student_id = _tutor_student_id;

  IF _participant_amount IS NOT NULL AND _participant_amount > 0 THEN
    INSERT INTO public.tutor_payments (
      lesson_id, tutor_student_id, amount, status, due_date, paid_at
    ) VALUES (
      _lesson_id,
      _tutor_student_id,
      _participant_amount,
      _payment_row_status,
      CURRENT_DATE,
      _paid_at
    )
    ON CONFLICT (lesson_id, tutor_student_id)
      WHERE lesson_id IS NOT NULL AND tutor_student_id IS NOT NULL
    DO UPDATE SET
      amount = EXCLUDED.amount,
      status = EXCLUDED.status,
      due_date = EXCLUDED.due_date,
      paid_at = EXCLUDED.paid_at;

    PERFORM public._sync_lesson_debit(  -- TASK-3
      _lesson_id, _tutor_student_id, _tutor_id, _participant_amount, _actor);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', _payment_status,
    'amount', _participant_amount,
    'paid_at', _paid_at,
    'error_code', NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_group_participant_payment_status(uuid, uuid, text)
  TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. tutor_delete_lessons — verbatim + reverse lesson-debits before row delete
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.tutor_delete_lessons(
  _lesson_id UUID,
  _scope TEXT DEFAULT 'this'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _tutor_id UUID;
  _root_id UUID;
  _from_start TIMESTAMPTZ;
  _is_recurring BOOLEAN;
  _delete_ids UUID[];
  _paid_count INT;
  _pending_removed INT := 0;
  _deleted_count INT := 0;
  _new_root UUID;
  _led RECORD;                              -- TASK-3
BEGIN
  IF _scope NOT IN ('this', 'this_and_following', 'all') THEN
    RAISE EXCEPTION 'INVALID_SCOPE' USING ERRCODE = '22023';
  END IF;

  -- Ownership + series anchor.
  SELECT t.id, COALESCE(l.parent_lesson_id, l.id), l.start_at, COALESCE(l.is_recurring, false)
    INTO _tutor_id, _root_id, _from_start, _is_recurring
  FROM public.tutor_lessons l
  JOIN public.tutors t ON t.id = l.tutor_id
  WHERE l.id = _lesson_id
    AND t.user_id = auth.uid();

  IF _tutor_id IS NULL THEN
    RAISE EXCEPTION 'NOT_OWNED' USING ERRCODE = '42501';
  END IF;

  -- Resolve the delete set by scope (series expansion only for recurring lessons).
  IF _is_recurring AND _scope = 'all' THEN
    SELECT array_agg(id) INTO _delete_ids
    FROM public.tutor_lessons
    WHERE tutor_id = _tutor_id
      AND (id = _root_id OR parent_lesson_id = _root_id);
  ELSIF _is_recurring AND _scope = 'this_and_following' THEN
    SELECT array_agg(id) INTO _delete_ids
    FROM public.tutor_lessons
    WHERE tutor_id = _tutor_id
      AND (id = _root_id OR parent_lesson_id = _root_id)
      AND (id = _lesson_id OR start_at >= _from_start);
  ELSE
    _delete_ids := ARRAY[_lesson_id];
  END IF;

  -- MONEY GUARD: never orphan paid money. Block if any affected lesson is paid.
  SELECT count(*) INTO _paid_count
  FROM public.tutor_payments
  WHERE lesson_id = ANY (_delete_ids)
    AND status = 'paid';

  IF _paid_count > 0 THEN
    RAISE EXCEPTION 'HAS_PAID_PAYMENT' USING ERRCODE = '22023';
  END IF;

  -- Reverse unpaid (pending/overdue) payments for the affected lessons.
  WITH del AS (
    DELETE FROM public.tutor_payments
    WHERE lesson_id = ANY (_delete_ids)
      AND status IN ('pending', 'overdue')
    RETURNING 1
  )
  SELECT count(*) INTO _pending_removed FROM del;

  -- TASK-3: reverse active ledger lesson-debits BEFORE the lesson rows are deleted
  -- (source_lesson_id → SET NULL on delete would otherwise lose the link).
  FOR _led IN
    SELECT id FROM public.tutor_ledger_entries
    WHERE source_lesson_id = ANY (_delete_ids)
      AND source_kind = 'lesson' AND kind = 'debit' AND reversed_by_entry_id IS NULL
  LOOP
    PERFORM public._reverse_ledger_entry(_led.id, 'reverse: занятие удалено', NULL);
  END LOOP;

  -- Re-parent survivors if we are deleting the series root (avoid SET-NULL orphans).
  IF _root_id = ANY (_delete_ids) THEN
    SELECT id INTO _new_root
    FROM public.tutor_lessons
    WHERE tutor_id = _tutor_id
      AND (id = _root_id OR parent_lesson_id = _root_id)
      AND NOT (id = ANY (_delete_ids))
    ORDER BY start_at ASC
    LIMIT 1;

    IF _new_root IS NOT NULL THEN
      UPDATE public.tutor_lessons SET parent_lesson_id = NULL WHERE id = _new_root;
      UPDATE public.tutor_lessons
      SET parent_lesson_id = _new_root
      WHERE tutor_id = _tutor_id
        AND parent_lesson_id = _root_id
        AND id <> _new_root
        AND NOT (id = ANY (_delete_ids));
    END IF;
  END IF;

  -- Delete the rows (participants + materials cascade — desired for a true delete).
  WITH del AS (
    DELETE FROM public.tutor_lessons
    WHERE id = ANY (_delete_ids)
      AND tutor_id = _tutor_id
    RETURNING 1
  )
  SELECT count(*) INTO _deleted_count FROM del;

  RETURN jsonb_build_object(
    'deleted', _deleted_count,
    'pending_payments_removed', _pending_removed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.tutor_delete_lessons(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_delete_lessons(UUID, TEXT) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. tutor_revert_lesson — verbatim + reverse lesson-debits
-- ════════════════════════════════════════════════════════════════════════════
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
  _led RECORD;                              -- TASK-3
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

  -- TASK-3: reverse active ledger lesson-debits for this lesson (charge undone).
  FOR _led IN
    SELECT id FROM public.tutor_ledger_entries
    WHERE source_lesson_id = p_lesson_id
      AND source_kind = 'lesson' AND kind = 'debit' AND reversed_by_entry_id IS NULL
  LOOP
    PERFORM public._reverse_ledger_entry(_led.id, 'reverse: занятие отменено (revert)', NULL);
  END LOOP;

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

NOTIFY pgrst, 'reload schema';
