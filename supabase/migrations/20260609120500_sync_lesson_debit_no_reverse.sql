-- Student balance ledger — Phase 2a, TASK-3 re-review (P2). SPEC v6.
-- CREATE OR REPLACE _sync_lesson_debit to make it single-responsibility: it ONLY ever SETS
-- a positive lesson-debit (idempotent + amount-aware). The amount<=0 branch no longer
-- reverses — it is a pure no-op (RETURN NULL). Reversal lives SOLELY in _reverse_lesson_debit
-- (delete/revert; future edit-списание path). This resolves the misleading contract flagged
-- in review AND makes the "re-complete-to-0 does NOT reverse" invariant STRUCTURAL — no longer
-- dependent on the callers gating the call behind `IF amount > 0`.
-- No behavior change for current callers (complete_lesson_and_create_payment /
-- update_group_participant_payment_status only ever call with amount > 0). Idempotent; safe
-- whether or not 20260609120400 has been applied.

CREATE OR REPLACE FUNCTION public._sync_lesson_debit(
  _lesson_id uuid, _tutor_student_id uuid, _tutor_id uuid, _amount integer, _actor uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _existing public.tutor_ledger_entries; _owner_tutor uuid; _new_id uuid;
BEGIN
  -- P0: self-serialize per (lesson, student) — transaction-scoped, auto-released at commit.
  PERFORM pg_advisory_xact_lock(hashtext(_lesson_id::text), hashtext(_tutor_student_id::text));

  -- P1: authoritative tutor_id = the student's owner (rule 40); validate the caller's.
  SELECT tutor_id INTO _owner_tutor FROM public.tutor_students WHERE id = _tutor_student_id;
  IF _owner_tutor IS NULL THEN RAISE EXCEPTION 'STUDENT_NOT_FOUND'; END IF;
  IF _tutor_id IS NOT NULL AND _tutor_id IS DISTINCT FROM _owner_tutor THEN
    RAISE EXCEPTION 'STUDENT_TUTOR_MISMATCH';
  END IF;

  -- amount<=0 → pure no-op. _sync only ever SETS a positive lesson-debit; it never reverses.
  -- Removing a charge (no-show / set-to-0) is done via _reverse_lesson_debit (delete/revert)
  -- or the future edit-списание path — NOT here. This keeps "re-complete-to-0 doesn't reverse"
  -- structural rather than callsite-gated.
  IF _amount IS NULL OR _amount <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO _existing FROM public.tutor_ledger_entries
   WHERE source_lesson_id = _lesson_id AND tutor_student_id = _tutor_student_id
     AND source_kind = 'lesson' AND kind = 'debit' AND reversed_by_entry_id IS NULL
   FOR UPDATE;

  IF FOUND THEN
    IF _existing.amount = _amount THEN
      RETURN _existing.id;                            -- same → no-op (idempotent re-complete)
    END IF;
    PERFORM public._reverse_ledger_entry(_existing.id, 'reverse: сумма списания изменена', _actor);
  END IF;

  INSERT INTO public.tutor_ledger_entries
    (tutor_id, tutor_student_id, kind, amount, occurred_on, source_kind, source_lesson_id, created_by)
  VALUES (_owner_tutor, _tutor_student_id, 'debit', _amount,
          COALESCE((SELECT start_at::date FROM public.tutor_lessons WHERE id = _lesson_id), CURRENT_DATE),
          'lesson', _lesson_id, _actor)
  ON CONFLICT (source_lesson_id, tutor_student_id)
    WHERE source_kind = 'lesson' AND kind = 'debit' AND reversed_by_entry_id IS NULL
  DO NOTHING
  RETURNING id INTO _new_id;

  IF _new_id IS NULL THEN
    -- Unreachable under the advisory lock, but never leave a silent mismatch (P0).
    SELECT * INTO _existing FROM public.tutor_ledger_entries
     WHERE source_lesson_id = _lesson_id AND tutor_student_id = _tutor_student_id
       AND source_kind = 'lesson' AND kind = 'debit' AND reversed_by_entry_id IS NULL;
    IF _existing.id IS NULL THEN
      RAISE EXCEPTION 'LEDGER_DEBIT_LOST lesson=% student=%', _lesson_id, _tutor_student_id;
    END IF;
    IF _existing.amount IS DISTINCT FROM _amount THEN
      RAISE EXCEPTION 'LEDGER_DEBIT_RACE active=% wanted=%', _existing.amount, _amount;
    END IF;
    RETURN _existing.id;
  END IF;
  RETURN _new_id;
END $$;

REVOKE ALL ON FUNCTION public._sync_lesson_debit(uuid, uuid, uuid, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._sync_lesson_debit(uuid, uuid, uuid, integer, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
