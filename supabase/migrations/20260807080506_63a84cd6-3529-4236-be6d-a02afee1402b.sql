CREATE OR REPLACE FUNCTION public.tutor_cancel_lesson_with_charge(_lesson_id uuid, _amount integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tutor_id uuid; _student uuid; _fresh_student uuid; _is_group boolean;
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

  SELECT l.tutor_student_id INTO _fresh_student
  FROM public.tutor_lessons l WHERE l.id = _lesson_id;
  IF _fresh_student IS NULL OR _fresh_student IS DISTINCT FROM _student THEN
    RAISE EXCEPTION 'LEDGER_CONFLICT';
  END IF;

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

GRANT EXECUTE ON FUNCTION public.tutor_cancel_lesson_with_charge(uuid, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.tutor_cancel_lesson_with_charge(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tutor_cancel_lesson_with_charge(uuid, integer) FROM anon;

NOTIFY pgrst, 'reload schema';