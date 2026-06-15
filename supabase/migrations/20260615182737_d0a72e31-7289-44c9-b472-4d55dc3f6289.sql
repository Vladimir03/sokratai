-- Student balance ledger — Phase 2b (partial cutover): lesson-payment CREDITS.

CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_active_lesson_credit
  ON public.tutor_ledger_entries (source_lesson_id, tutor_student_id)
  WHERE source_kind = 'lesson' AND kind = 'credit' AND reversed_by_entry_id IS NULL;

ALTER TABLE public.tutor_ledger_entries
  ADD COLUMN IF NOT EXISTS source_payment_id uuid REFERENCES public.tutor_payments(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_manual_payment_credit_once
  ON public.tutor_ledger_entries (source_payment_id)
  WHERE source_payment_id IS NOT NULL AND kind = 'credit';

CREATE OR REPLACE FUNCTION public._reverse_lesson_credit(_lesson_id uuid, _tutor_student_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _credit_id uuid;
BEGIN
  SELECT id INTO _credit_id FROM public.tutor_ledger_entries
   WHERE source_lesson_id = _lesson_id AND tutor_student_id = _tutor_student_id
     AND source_kind = 'lesson' AND kind = 'credit' AND reversed_by_entry_id IS NULL
   LIMIT 1;
  IF _credit_id IS NULL THEN RETURN NULL; END IF;
  RETURN public._reverse_ledger_entry(_credit_id, 'reverse: оплата за занятие снята', NULL);
END $$;

CREATE OR REPLACE FUNCTION public._sync_lesson_credit(
  _lesson_id uuid, _tutor_student_id uuid, _tutor_id uuid, _amount integer, _actor uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _existing public.tutor_ledger_entries; _owner_tutor uuid; _new_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(_lesson_id::text), hashtext(_tutor_student_id::text));

  SELECT tutor_id INTO _owner_tutor FROM public.tutor_students WHERE id = _tutor_student_id;
  IF _owner_tutor IS NULL THEN RAISE EXCEPTION 'STUDENT_NOT_FOUND'; END IF;
  IF _tutor_id IS NOT NULL AND _tutor_id IS DISTINCT FROM _owner_tutor THEN
    RAISE EXCEPTION 'STUDENT_TUTOR_MISMATCH';
  END IF;

  IF _amount IS NULL OR _amount <= 0 THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tutor_ledger_entries d
    WHERE d.source_lesson_id = _lesson_id AND d.tutor_student_id = _tutor_student_id
      AND d.source_kind = 'lesson' AND d.kind = 'debit' AND d.reversed_by_entry_id IS NULL
      AND d.amount = _amount
  ) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO _existing FROM public.tutor_ledger_entries
   WHERE source_lesson_id = _lesson_id AND tutor_student_id = _tutor_student_id
     AND source_kind = 'lesson' AND kind = 'credit' AND reversed_by_entry_id IS NULL
   FOR UPDATE;

  IF FOUND THEN
    IF _existing.amount = _amount THEN
      RETURN _existing.id;
    END IF;
    PERFORM public._reverse_ledger_entry(_existing.id, 'reverse: сумма оплаты изменена', _actor);
  END IF;

  INSERT INTO public.tutor_ledger_entries
    (tutor_id, tutor_student_id, kind, amount, occurred_on, source_kind, source_lesson_id, created_by)
  VALUES (_owner_tutor, _tutor_student_id, 'credit', _amount,
          COALESCE((SELECT start_at::date FROM public.tutor_lessons WHERE id = _lesson_id), CURRENT_DATE),
          'lesson', _lesson_id, _actor)
  ON CONFLICT (source_lesson_id, tutor_student_id)
    WHERE source_kind = 'lesson' AND kind = 'credit' AND reversed_by_entry_id IS NULL
  DO NOTHING
  RETURNING id INTO _new_id;

  IF _new_id IS NULL THEN
    SELECT * INTO _existing FROM public.tutor_ledger_entries
     WHERE source_lesson_id = _lesson_id AND tutor_student_id = _tutor_student_id
       AND source_kind = 'lesson' AND kind = 'credit' AND reversed_by_entry_id IS NULL;
    IF _existing.id IS NULL THEN
      RAISE EXCEPTION 'LEDGER_CREDIT_LOST lesson=% student=%', _lesson_id, _tutor_student_id;
    END IF;
    IF _existing.amount IS DISTINCT FROM _amount THEN
      RAISE EXCEPTION 'LEDGER_CREDIT_RACE active=% wanted=%', _existing.amount, _amount;
    END IF;
    RETURN _existing.id;
  END IF;
  RETURN _new_id;
END $$;

CREATE OR REPLACE FUNCTION public._credit_manual_payment(
  _payment_id uuid, _tutor_student_id uuid, _tutor_id uuid, _amount integer, _actor uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _owner_tutor uuid; _new_id uuid;
BEGIN
  SELECT tutor_id INTO _owner_tutor FROM public.tutor_students WHERE id = _tutor_student_id;
  IF _owner_tutor IS NULL THEN RAISE EXCEPTION 'STUDENT_NOT_FOUND'; END IF;
  IF _tutor_id IS NOT NULL AND _tutor_id IS DISTINCT FROM _owner_tutor THEN
    RAISE EXCEPTION 'STUDENT_TUTOR_MISMATCH';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RETURN NULL; END IF;

  INSERT INTO public.tutor_ledger_entries
    (tutor_id, tutor_student_id, kind, amount, occurred_on, source_kind, source_payment_id, note, created_by)
  VALUES (_owner_tutor, _tutor_student_id, 'credit', _amount, CURRENT_DATE, 'adjustment', _payment_id,
          'оплата (Telegram /pay)', _actor)
  ON CONFLICT (source_payment_id)
    WHERE source_payment_id IS NOT NULL AND kind = 'credit'
  DO NOTHING
  RETURNING id INTO _new_id;
  RETURN _new_id;
END $$;

CREATE OR REPLACE FUNCTION public.tutor_reverse_ledger_entry(_entry_id uuid, _note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sid uuid; _sk text; _slid uuid; _new_id uuid;
BEGIN
  SELECT tutor_student_id, source_kind, source_lesson_id INTO _sid, _sk, _slid
    FROM public.tutor_ledger_entries WHERE id = _entry_id;
  IF _sid IS NULL THEN RAISE EXCEPTION 'ENTRY_NOT_FOUND'; END IF;
  IF NOT public.owns_tutor_student(_sid) THEN RAISE EXCEPTION 'NOT_OWNED'; END IF;
  IF _sk = 'lesson' AND _slid IS NOT NULL THEN RAISE EXCEPTION 'LESSON_ENTRY_NOT_REVERSIBLE'; END IF;

  _new_id := public._reverse_ledger_entry(_entry_id, _note, auth.uid());
  IF _new_id IS NULL THEN RAISE EXCEPTION 'ALREADY_REVERSED'; END IF;
  RETURN _new_id;
END $$;

CREATE OR REPLACE FUNCTION public.tutor_received_payments_summary(
  _from date DEFAULT NULL, _to date DEFAULT NULL, _student_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _tutor_id uuid; _total bigint; _count bigint;
BEGIN
  SELECT id INTO _tutor_id FROM public.tutors WHERE user_id = auth.uid();
  IF _tutor_id IS NULL THEN RETURN jsonb_build_object('total', 0, 'count', 0); END IF;

  SELECT COALESCE(SUM(amount), 0), COUNT(*) INTO _total, _count
  FROM public.tutor_ledger_entries
  WHERE tutor_id = _tutor_id
    AND kind = 'credit'
    AND reverses_entry_id IS NULL
    AND reversed_by_entry_id IS NULL
    AND (_student_id IS NULL OR tutor_student_id = _student_id)
    AND (_from IS NULL OR occurred_on >= _from)
    AND (_to IS NULL OR occurred_on <= _to);

  RETURN jsonb_build_object('total', _total, 'count', _count);
END $$;

REVOKE ALL ON FUNCTION public.tutor_received_payments_summary(date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_received_payments_summary(date, date, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public._reverse_lesson_credit(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._sync_lesson_credit(uuid, uuid, uuid, integer, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._credit_manual_payment(uuid, uuid, uuid, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._reverse_lesson_credit(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._sync_lesson_credit(uuid, uuid, uuid, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._credit_manual_payment(uuid, uuid, uuid, integer, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.tutor_reverse_ledger_entry(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_reverse_ledger_entry(uuid, text) TO authenticated, service_role;