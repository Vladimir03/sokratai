CREATE OR REPLACE FUNCTION public.tutor_set_lesson_cost_series(
  _lesson_id uuid, _amount integer, _scope text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tutor_id uuid; _student uuid; _root uuid; _anchor timestamptz;
  _ids uuid[]; _id uuid; _updated int := 0;
BEGIN
  IF _amount IS NULL OR _amount < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF _scope NOT IN ('this_and_following', 'all') THEN RAISE EXCEPTION 'INVALID_SCOPE'; END IF;

  SELECT l.tutor_id, l.tutor_student_id, COALESCE(l.parent_lesson_id, l.id), l.start_at
    INTO _tutor_id, _student, _root, _anchor
  FROM public.tutor_lessons l JOIN public.tutors t ON t.id = l.tutor_id
  WHERE l.id = _lesson_id AND t.user_id = auth.uid();
  IF _tutor_id IS NULL THEN RAISE EXCEPTION 'NOT_OWNED'; END IF;
  IF _student IS NULL THEN RAISE EXCEPTION 'GROUP_LESSON'; END IF;

  SELECT ARRAY(
    SELECT l.id FROM public.tutor_lessons l
    WHERE l.tutor_id = _tutor_id
      AND (l.id = _root OR l.parent_lesson_id = _root)
      AND l.tutor_student_id = _student
      AND l.status IN ('booked', 'completed')
      AND (_scope = 'all' OR l.id = _lesson_id OR l.start_at >= _anchor)
    ORDER BY l.id
  ) INTO _ids;
  IF COALESCE(array_length(_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'NOT_OWNED'; END IF;

  FOREACH _id IN ARRAY _ids LOOP
    PERFORM pg_advisory_xact_lock(hashtext(_id::text), hashtext(_student::text));
    UPDATE public.tutor_lessons
       SET payment_amount = _amount
     WHERE id = _id
       AND tutor_student_id = _student
       AND status IN ('booked', 'completed');
    IF FOUND THEN
      PERFORM public._apply_lesson_debit_from_current_cost(_id, _student, auth.uid());
      _updated := _updated + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'updated', _updated);
END $$;

CREATE OR REPLACE FUNCTION public.tutor_set_participant_cost_series(
  _lesson_id uuid, _tutor_student_id uuid, _amount integer, _scope text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tutor_id uuid; _root uuid; _anchor timestamptz;
  _ids uuid[]; _id uuid; _status text; _updated int := 0;
BEGIN
  IF _amount IS NULL OR _amount < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF _scope NOT IN ('this_and_following', 'all') THEN RAISE EXCEPTION 'INVALID_SCOPE'; END IF;

  SELECT l.tutor_id, COALESCE(l.parent_lesson_id, l.id), l.start_at
    INTO _tutor_id, _root, _anchor
  FROM public.tutor_lessons l JOIN public.tutors t ON t.id = l.tutor_id
  WHERE l.id = _lesson_id AND t.user_id = auth.uid();
  IF _tutor_id IS NULL THEN RAISE EXCEPTION 'NOT_OWNED'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tutor_lesson_participants p
    JOIN public.tutor_students ts ON ts.id = p.tutor_student_id AND ts.tutor_id = _tutor_id
    WHERE p.lesson_id = _lesson_id AND p.tutor_student_id = _tutor_student_id
  ) THEN RAISE EXCEPTION 'PARTICIPANT_NOT_FOUND'; END IF;

  SELECT ARRAY(
    SELECT l.id FROM public.tutor_lessons l
    JOIN public.tutor_lesson_participants p
      ON p.lesson_id = l.id AND p.tutor_student_id = _tutor_student_id
    WHERE l.tutor_id = _tutor_id
      AND (l.id = _root OR l.parent_lesson_id = _root)
      AND l.status IN ('booked', 'completed')
      AND (_scope = 'all' OR l.id = _lesson_id OR l.start_at >= _anchor)
    ORDER BY l.id
  ) INTO _ids;
  IF COALESCE(array_length(_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'PARTICIPANT_NOT_FOUND'; END IF;

  FOREACH _id IN ARRAY _ids LOOP
    PERFORM pg_advisory_xact_lock(hashtext(_id::text), hashtext(_tutor_student_id::text));
    SELECT l.status INTO _status
      FROM public.tutor_lessons l WHERE l.id = _id FOR UPDATE;
    IF _status IS NULL OR _status NOT IN ('booked', 'completed') THEN
      CONTINUE;
    END IF;
    UPDATE public.tutor_lesson_participants p
       SET payment_amount = _amount
     WHERE p.lesson_id = _id
       AND p.tutor_student_id = _tutor_student_id;
    IF FOUND THEN
      PERFORM public._apply_lesson_debit_from_current_cost(_id, _tutor_student_id, auth.uid());
      _updated := _updated + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'updated', _updated);
END $$;

GRANT EXECUTE ON FUNCTION public.tutor_set_lesson_cost_series(uuid, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tutor_set_participant_cost_series(uuid, uuid, integer, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.tutor_set_lesson_cost_series(uuid, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tutor_set_participant_cost_series(uuid, uuid, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tutor_set_lesson_cost_series(uuid, integer, text) FROM anon;
REVOKE ALL ON FUNCTION public.tutor_set_participant_cost_series(uuid, uuid, integer, text) FROM anon;

CREATE OR REPLACE FUNCTION public.tutor_set_lesson_cost(_lesson_id uuid, _amount integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tutor_id uuid; _student uuid;
BEGIN
  IF _amount IS NULL OR _amount < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  SELECT l.tutor_id, l.tutor_student_id INTO _tutor_id, _student
  FROM public.tutor_lessons l JOIN public.tutors t ON t.id = l.tutor_id
  WHERE l.id = _lesson_id AND t.user_id = auth.uid();
  IF _tutor_id IS NULL THEN RAISE EXCEPTION 'NOT_OWNED'; END IF;
  IF _student IS NULL THEN RAISE EXCEPTION 'GROUP_LESSON'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(_lesson_id::text), hashtext(_student::text));

  UPDATE public.tutor_lessons SET payment_amount = _amount WHERE id = _lesson_id;
  PERFORM public._apply_lesson_debit_from_current_cost(_lesson_id, _student, auth.uid());
  RETURN jsonb_build_object('ok', true);
END $$;

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

  PERFORM pg_advisory_xact_lock(hashtext(_lesson_id::text), hashtext(_tutor_student_id::text));

  UPDATE public.tutor_lesson_participants SET payment_amount = _amount
   WHERE lesson_id = _lesson_id AND tutor_student_id = _tutor_student_id;
  PERFORM public._apply_lesson_debit_from_current_cost(_lesson_id, _tutor_student_id, auth.uid());
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.tutor_set_lesson_cost(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tutor_set_participant_cost(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_set_lesson_cost(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tutor_set_participant_cost(uuid, uuid, integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';