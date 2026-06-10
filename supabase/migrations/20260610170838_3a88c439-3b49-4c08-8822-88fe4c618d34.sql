ALTER TABLE public.tutor_ledger_entries
  ADD COLUMN IF NOT EXISTS replaces_entry_id uuid REFERENCES public.tutor_ledger_entries(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.tutor_ledger_entries.replaces_entry_id IS
  'Правка: эта запись заменяет указанную (та сторнирована в той же транзакции). Для collapse-отображения в ленте.';

CREATE INDEX IF NOT EXISTS idx_ledger_replaces
  ON public.tutor_ledger_entries (replaces_entry_id)
  WHERE replaces_entry_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tutor_edit_topup(
  _entry_id uuid, _new_amount integer, _occurred_on date DEFAULT NULL, _note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _orig public.tutor_ledger_entries; _rev uuid; _new_id uuid;
BEGIN
  SELECT * INTO _orig FROM public.tutor_ledger_entries WHERE id = _entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ENTRY_NOT_FOUND'; END IF;
  IF NOT public.owns_tutor_student(_orig.tutor_student_id) THEN RAISE EXCEPTION 'NOT_OWNED'; END IF;
  IF _orig.source_kind <> 'topup' OR _orig.kind <> 'credit' OR _orig.reverses_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'NOT_EDITABLE';
  END IF;
  IF _orig.reversed_by_entry_id IS NOT NULL THEN RAISE EXCEPTION 'ALREADY_REVERSED'; END IF;
  IF _new_amount IS NULL OR _new_amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  _rev := public._reverse_ledger_entry(_entry_id, 'исправлено', auth.uid());
  IF _rev IS NULL THEN RAISE EXCEPTION 'ALREADY_REVERSED'; END IF;

  INSERT INTO public.tutor_ledger_entries
    (tutor_id, tutor_student_id, kind, amount, occurred_on, source_kind, note, created_by, replaces_entry_id)
  VALUES (_orig.tutor_id, _orig.tutor_student_id, 'credit', _new_amount,
          COALESCE(_occurred_on, _orig.occurred_on), 'topup',
          COALESCE(_note, _orig.note), auth.uid(), _entry_id)
  RETURNING id INTO _new_id;
  RETURN _new_id;
END $$;

REVOKE ALL ON FUNCTION public.tutor_edit_topup(uuid, integer, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_edit_topup(uuid, integer, date, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';