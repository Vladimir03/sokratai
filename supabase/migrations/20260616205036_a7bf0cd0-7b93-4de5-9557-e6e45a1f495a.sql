CREATE OR REPLACE FUNCTION public._apply_lesson_debit_from_current_cost(
  _lesson_id uuid, _tutor_student_id uuid, _actor uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tutor_id uuid; _dur int; _is_past boolean; _rate int;
  _part_override int; _lesson_override int; _has_part boolean := false; _override int; _cost int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(_lesson_id::text), hashtext(_tutor_student_id::text));

  SELECT l.tutor_id, l.duration_min, l.payment_amount,
         (l.start_at + make_interval(mins => COALESCE(l.duration_min, 60)) <= now())
    INTO _tutor_id, _dur, _lesson_override, _is_past
  FROM public.tutor_lessons l WHERE l.id = _lesson_id;
  IF _tutor_id IS NULL THEN RETURN; END IF;
  IF NOT _is_past THEN RETURN; END IF;

  SELECT payment_amount, true INTO _part_override, _has_part
  FROM public.tutor_lesson_participants
  WHERE lesson_id = _lesson_id AND tutor_student_id = _tutor_student_id;

  IF _has_part IS TRUE THEN
    _override := COALESCE(_part_override, _lesson_override);
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.tutor_lessons
      WHERE id = _lesson_id AND tutor_student_id = _tutor_student_id
    ) THEN RETURN; END IF;
    _override := _lesson_override;
  END IF;

  SELECT hourly_rate_cents INTO _rate FROM public.tutor_students WHERE id = _tutor_student_id;
  _cost := COALESCE(_override,
    CASE WHEN _rate IS NULL OR _rate <= 0 OR COALESCE(_dur, 0) <= 0 THEN NULL
         ELSE ROUND((_dur::numeric / 60) * (_rate::numeric / 100))::int END);

  IF _cost IS NULL THEN
    RETURN;
  ELSIF _cost <= 0 THEN
    PERFORM public._reverse_lesson_debit(_lesson_id, _tutor_student_id);
  ELSE
    PERFORM public._sync_lesson_debit(_lesson_id, _tutor_student_id, _tutor_id, _cost, _actor);
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._apply_lesson_debit_from_current_cost(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._apply_lesson_debit_from_current_cost(uuid, uuid, uuid) TO service_role;

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

  UPDATE public.tutor_lesson_participants SET payment_amount = _amount
   WHERE lesson_id = _lesson_id AND tutor_student_id = _tutor_student_id;
  PERFORM public._apply_lesson_debit_from_current_cost(_lesson_id, _tutor_student_id, auth.uid());
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.tutor_set_participant_cost(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_set_participant_cost(uuid, uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tutor_cancel_lesson_with_charge(_lesson_id uuid, _amount integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tutor_id uuid; _student uuid; _is_group boolean;
BEGIN
  IF _amount IS NULL OR _amount < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  SELECT l.tutor_id, l.tutor_student_id INTO _tutor_id, _student
  FROM public.tutor_lessons l JOIN public.tutors t ON t.id = l.tutor_id
  WHERE l.id = _lesson_id AND t.user_id = auth.uid();
  IF _tutor_id IS NULL THEN RAISE EXCEPTION 'NOT_OWNED'; END IF;

  SELECT EXISTS (SELECT 1 FROM public.tutor_lesson_participants WHERE lesson_id = _lesson_id) INTO _is_group;
  IF _is_group THEN RAISE EXCEPTION 'GROUP_LESSON'; END IF;
  IF _student IS NULL THEN RAISE EXCEPTION 'NO_STUDENT'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(_lesson_id::text), hashtext(_student::text));

  UPDATE public.tutor_lessons
  SET status = 'cancelled', cancelled_by = 'tutor', cancelled_at = now(), payment_amount = _amount
  WHERE id = _lesson_id;

  IF _amount > 0 THEN
    PERFORM public._sync_lesson_debit(_lesson_id, _student, _tutor_id, _amount, auth.uid());
  ELSE
    PERFORM public._reverse_lesson_debit(_lesson_id, _student);
  END IF;

  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.tutor_cancel_lesson_with_charge(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_cancel_lesson_with_charge(uuid, integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';