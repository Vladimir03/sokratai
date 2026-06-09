-- Student balance ledger — Phase 2a, TASK-3 review round (fixes). SPEC v5.
-- CREATE OR REPLACE of _sync_lesson_debit ONLY (idempotent; safe whether or not the
-- original 20260609120100 has been applied). Closes the TASK-3 Codex findings:
--   P0  — self-serialize per (lesson, student) via pg_advisory_xact_lock so concurrent
--         amount-changes can never leave a ledger/payment mismatch, regardless of caller
--         (current callers also serialize via the tutor_payments row lock — this is
--         defense-in-depth + future-caller safety); never return a silent NULL on a
--         conflict-with-different-amount — RAISE loudly.
--   P1  — derive the AUTHORITATIVE tutor_id from tutor_students (rule 40 FK-drift) and
--         validate the caller-passed _tutor_id; RAISE on mismatch. Insert uses the derived id.
-- amount<=0-on-existing-debit (re-complete to 0) is intentionally NOT auto-reversed here
-- (mirrors frozen payment behavior — the payment row is likewise not removed); the undo
-- path is delete/revert (reverses) or the future edit-списание path (Parking Lot). The
-- first-time amount<=0 case correctly creates no debit.

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

  -- amount<=0 (no charge / no-show) → reverse any active debit, create none.
  IF _amount IS NULL OR _amount <= 0 THEN
    PERFORM public._reverse_lesson_debit(_lesson_id, _tutor_student_id);
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
