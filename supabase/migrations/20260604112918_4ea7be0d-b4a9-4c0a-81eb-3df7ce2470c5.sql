CREATE OR REPLACE FUNCTION public.tutor_delete_lessons(_lesson_id UUID, _scope TEXT DEFAULT 'this')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _tutor_id UUID; _root_id UUID; _from_start TIMESTAMPTZ; _is_recurring BOOLEAN;
  _delete_ids UUID[]; _paid_count INT; _pending_removed INT := 0; _deleted_count INT := 0; _new_root UUID;
BEGIN
  IF _scope NOT IN ('this','this_and_following','all') THEN RAISE EXCEPTION 'INVALID_SCOPE' USING ERRCODE='22023'; END IF;
  SELECT t.id, COALESCE(l.parent_lesson_id, l.id), l.start_at, COALESCE(l.is_recurring,false)
    INTO _tutor_id, _root_id, _from_start, _is_recurring
  FROM public.tutor_lessons l JOIN public.tutors t ON t.id = l.tutor_id
  WHERE l.id = _lesson_id AND t.user_id = auth.uid();
  IF _tutor_id IS NULL THEN RAISE EXCEPTION 'NOT_OWNED' USING ERRCODE='42501'; END IF;
  IF _is_recurring AND _scope='all' THEN
    SELECT array_agg(id) INTO _delete_ids FROM public.tutor_lessons
      WHERE tutor_id=_tutor_id AND (id=_root_id OR parent_lesson_id=_root_id);
  ELSIF _is_recurring AND _scope='this_and_following' THEN
    SELECT array_agg(id) INTO _delete_ids FROM public.tutor_lessons
      WHERE tutor_id=_tutor_id AND (id=_root_id OR parent_lesson_id=_root_id) AND (id=_lesson_id OR start_at>=_from_start);
  ELSE _delete_ids := ARRAY[_lesson_id]; END IF;
  SELECT count(*) INTO _paid_count FROM public.tutor_payments WHERE lesson_id = ANY(_delete_ids) AND status='paid';
  IF _paid_count > 0 THEN RAISE EXCEPTION 'HAS_PAID_PAYMENT' USING ERRCODE='22023'; END IF;
  WITH del AS (DELETE FROM public.tutor_payments WHERE lesson_id=ANY(_delete_ids) AND status IN ('pending','overdue') RETURNING 1)
    SELECT count(*) INTO _pending_removed FROM del;
  IF _root_id = ANY(_delete_ids) THEN
    SELECT id INTO _new_root FROM public.tutor_lessons
      WHERE tutor_id=_tutor_id AND (id=_root_id OR parent_lesson_id=_root_id) AND NOT (id=ANY(_delete_ids))
      ORDER BY start_at ASC LIMIT 1;
    IF _new_root IS NOT NULL THEN
      UPDATE public.tutor_lessons SET parent_lesson_id=NULL WHERE id=_new_root;
      UPDATE public.tutor_lessons SET parent_lesson_id=_new_root
        WHERE tutor_id=_tutor_id AND parent_lesson_id=_root_id AND id<>_new_root AND NOT (id=ANY(_delete_ids));
    END IF;
  END IF;
  WITH del AS (DELETE FROM public.tutor_lessons WHERE id=ANY(_delete_ids) AND tutor_id=_tutor_id RETURNING 1)
    SELECT count(*) INTO _deleted_count FROM del;
  RETURN jsonb_build_object('deleted', _deleted_count, 'pending_payments_removed', _pending_removed);
END; $$;
REVOKE ALL ON FUNCTION public.tutor_delete_lessons(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_delete_lessons(UUID, TEXT) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';