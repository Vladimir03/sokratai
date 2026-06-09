-- Student balance ledger — Phase 2a, TASK-2 (helpers + client RPC, NEW code only).
-- SPEC v4. Units: RUBLES integer. All write helpers SECURITY DEFINER (ledger table REVOKEd).
-- Errors: short codes (client maps to RU, rule 97 — mirror schedule RPCs like HAS_PAID_PAYMENT).
--
-- Helpers (internal, used by client RPC + TASK-3 payment-write RPCs):
--   _reverse_ledger_entry(_entry_id,_note,_actor)  — append offsetting + mark original; no-op-safe.
--   _reverse_lesson_debit(_lesson_id,_student)      — find active lesson-debit → reverse.
--   _sync_lesson_debit(_lesson_id,_student,_tutor,_amount,_actor) — idempotent + amount-aware.
-- Client RPC:
--   tutor_record_topup(...)         — пополнение (credit).
--   tutor_reverse_ledger_entry(...) — ручной reverse (UI).

-- ─── Core reverse (append-only, no-op-safe) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public._reverse_ledger_entry(_entry_id uuid, _note text, _actor uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _orig public.tutor_ledger_entries; _new_id uuid;
BEGIN
  SELECT * INTO _orig FROM public.tutor_ledger_entries WHERE id = _entry_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;            -- gone
  IF _orig.reversed_by_entry_id IS NOT NULL THEN RETURN NULL; END IF;  -- already reversed (AC-12 no-op)

  INSERT INTO public.tutor_ledger_entries
    (tutor_id, tutor_student_id, kind, amount, occurred_on, source_kind, reverses_entry_id, note, created_by)
  VALUES
    (_orig.tutor_id, _orig.tutor_student_id,
     CASE WHEN _orig.kind = 'debit' THEN 'credit' ELSE 'debit' END,
     _orig.amount, CURRENT_DATE, 'adjustment', _entry_id, _note, _actor)
  ON CONFLICT (reverses_entry_id) WHERE reverses_entry_id IS NOT NULL DO NOTHING
  RETURNING id INTO _new_id;

  IF _new_id IS NULL THEN RETURN NULL; END IF;       -- concurrent reverse won the race → no-op

  UPDATE public.tutor_ledger_entries SET reversed_by_entry_id = _new_id WHERE id = _entry_id;
  RETURN _new_id;
END $$;

-- ─── Reverse the active lesson-debit of a lesson (for delete/revert + edit) ────
CREATE OR REPLACE FUNCTION public._reverse_lesson_debit(_lesson_id uuid, _tutor_student_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _debit_id uuid;
BEGIN
  SELECT id INTO _debit_id FROM public.tutor_ledger_entries
   WHERE source_lesson_id = _lesson_id AND tutor_student_id = _tutor_student_id
     AND source_kind = 'lesson' AND kind = 'debit' AND reversed_by_entry_id IS NULL
   LIMIT 1;
  IF _debit_id IS NULL THEN RETURN NULL; END IF;     -- no-op (AC-11)
  RETURN public._reverse_ledger_entry(_debit_id, 'reverse: занятие отменено/удалено', NULL);
END $$;

-- ─── Idempotent + amount-aware lesson-debit sync (called from payment-write RPC, TASK-3) ──
CREATE OR REPLACE FUNCTION public._sync_lesson_debit(
  _lesson_id uuid, _tutor_student_id uuid, _tutor_id uuid, _amount integer, _actor uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _existing public.tutor_ledger_entries; _new_id uuid;
BEGIN
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
  VALUES (_tutor_id, _tutor_student_id, 'debit', _amount,
          COALESCE((SELECT start_at::date FROM public.tutor_lessons WHERE id = _lesson_id), CURRENT_DATE),
          'lesson', _lesson_id, _actor)
  ON CONFLICT (source_lesson_id, tutor_student_id)
    WHERE source_kind = 'lesson' AND kind = 'debit' AND reversed_by_entry_id IS NULL
  DO NOTHING
  RETURNING id INTO _new_id;
  RETURN _new_id;
END $$;

-- Helpers internal only (called by SECURITY DEFINER RPCs which run as owner).
REVOKE ALL ON FUNCTION public._reverse_ledger_entry(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._reverse_lesson_debit(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._sync_lesson_debit(uuid, uuid, uuid, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._reverse_ledger_entry(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._reverse_lesson_debit(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._sync_lesson_debit(uuid, uuid, uuid, integer, uuid) TO service_role;

-- ─── Client RPC: пополнение (credit) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tutor_record_topup(
  _tutor_student_id uuid, _amount integer, _occurred_on date DEFAULT NULL, _note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tutor_id uuid; _id uuid;
BEGIN
  IF NOT public.owns_tutor_student(_tutor_student_id) THEN
    RAISE EXCEPTION 'NOT_OWNED';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;
  SELECT tutor_id INTO _tutor_id FROM public.tutor_students WHERE id = _tutor_student_id;
  IF _tutor_id IS NULL THEN RAISE EXCEPTION 'STUDENT_NOT_FOUND'; END IF;

  INSERT INTO public.tutor_ledger_entries
    (tutor_id, tutor_student_id, kind, amount, occurred_on, source_kind, note, created_by)
  VALUES (_tutor_id, _tutor_student_id, 'credit', _amount,
          COALESCE(_occurred_on, CURRENT_DATE), 'topup', _note, auth.uid())
  RETURNING id INTO _id;
  RETURN _id;
END $$;

-- ─── Client RPC: reverse записи (UI) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tutor_reverse_ledger_entry(_entry_id uuid, _note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sid uuid; _new_id uuid;
BEGIN
  SELECT tutor_student_id INTO _sid FROM public.tutor_ledger_entries WHERE id = _entry_id;
  IF _sid IS NULL THEN RAISE EXCEPTION 'ENTRY_NOT_FOUND'; END IF;
  IF NOT public.owns_tutor_student(_sid) THEN RAISE EXCEPTION 'NOT_OWNED'; END IF;

  _new_id := public._reverse_ledger_entry(_entry_id, _note, auth.uid());
  IF _new_id IS NULL THEN RAISE EXCEPTION 'ALREADY_REVERSED'; END IF;  -- concurrent / repeated
  RETURN _new_id;
END $$;

REVOKE ALL ON FUNCTION public.tutor_record_topup(uuid, integer, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tutor_reverse_ledger_entry(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_record_topup(uuid, integer, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tutor_reverse_ledger_entry(uuid, text) TO authenticated, service_role;
