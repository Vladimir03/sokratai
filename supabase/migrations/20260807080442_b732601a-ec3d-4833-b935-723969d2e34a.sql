CREATE OR REPLACE FUNCTION public.tutor_auto_debit_due_lessons(_tutor_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _lesson RECORD; _student RECORD; _actor uuid; _processed int := 0; _errors int := 0;
BEGIN
  FOR _lesson IN
    SELECT l.id, l.tutor_id, l.tutor_student_id
    FROM public.tutor_lessons l
    WHERE (_tutor_id IS NULL OR l.tutor_id = _tutor_id)
      AND l.start_at + make_interval(mins => COALESCE(l.duration_min, 60)) <= now()
      AND l.start_at >= now() - interval '60 days'
    ORDER BY l.id
  LOOP
    BEGIN
      _actor := COALESCE(auth.uid(), (SELECT user_id FROM public.tutors WHERE id = _lesson.tutor_id));
      IF EXISTS (SELECT 1 FROM public.tutor_lesson_participants p WHERE p.lesson_id = _lesson.id) THEN
        FOR _student IN
          SELECT tutor_student_id FROM public.tutor_lesson_participants
          WHERE lesson_id = _lesson.id
          ORDER BY tutor_student_id
        LOOP
          PERFORM public._apply_lesson_debit_from_current_cost(_lesson.id, _student.tutor_student_id, _actor);
          _processed := _processed + 1;
        END LOOP;
      ELSIF _lesson.tutor_student_id IS NOT NULL THEN
        PERFORM public._apply_lesson_debit_from_current_cost(_lesson.id, _lesson.tutor_student_id, _actor);
        _processed := _processed + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      _errors := _errors + 1;
    END;
  END LOOP;
  RETURN jsonb_build_object('processed', _processed, 'errors', _errors);
END $$;

REVOKE ALL ON FUNCTION public.tutor_auto_debit_due_lessons(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_auto_debit_due_lessons(uuid) TO service_role;

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
  _is_group boolean;
  _actor uuid;
  _locked_students uuid[];
  _s uuid;
BEGIN
  IF _tutor_telegram_id IS NOT NULL THEN
    SELECT t.id, l.tutor_student_id INTO _tutor_id, _tutor_student_id
    FROM public.tutors t JOIN public.tutor_lessons l ON l.tutor_id = t.id
    WHERE l.id = _lesson_id AND t.telegram_id = _tutor_telegram_id;
  ELSE
    SELECT t.id, l.tutor_student_id INTO _tutor_id, _tutor_student_id
    FROM public.tutors t JOIN public.tutor_lessons l ON l.tutor_id = t.id
    WHERE l.id = _lesson_id AND t.user_id = auth.uid();
  END IF;

  IF _tutor_id IS NULL THEN
    RETURN false;
  END IF;

  _actor := COALESCE(auth.uid(), (SELECT user_id FROM public.tutors WHERE id = _tutor_id));

  SELECT EXISTS (
    SELECT 1 FROM public.tutor_lesson_participants WHERE lesson_id = _lesson_id
  ) INTO _is_group;

  IF _is_group THEN
    SELECT ARRAY(
      SELECT p.tutor_student_id FROM public.tutor_lesson_participants p
      WHERE p.lesson_id = _lesson_id ORDER BY p.tutor_student_id
    ) INTO _locked_students;
  ELSIF _tutor_student_id IS NOT NULL THEN
    _locked_students := ARRAY[_tutor_student_id];
  ELSE
    _locked_students := ARRAY[]::uuid[];
  END IF;
  FOREACH _s IN ARRAY _locked_students LOOP
    PERFORM pg_advisory_xact_lock(hashtext(_lesson_id::text), hashtext(_s::text));
  END LOOP;

  UPDATE public.tutor_lessons
  SET
    status = 'completed',
    payment_status = _payment_status,
    payment_amount = CASE WHEN NOT _is_group THEN _amount ELSE NULL END,
    paid_at = CASE WHEN _payment_status IN ('paid', 'paid_earlier') THEN NOW() ELSE NULL END,
    payment_reminder_sent = true
  WHERE id = _lesson_id;

  FOREACH _s IN ARRAY _locked_students LOOP
    PERFORM public._apply_lesson_debit_from_current_cost(_lesson_id, _s, _actor);
    IF _is_group THEN
      UPDATE public.tutor_lesson_participants
      SET payment_status = _payment_status,
          paid_at = CASE WHEN _payment_status IN ('paid', 'paid_earlier') THEN NOW() ELSE NULL END
      WHERE lesson_id = _lesson_id AND tutor_student_id = _s;
    END IF;
  END LOOP;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_lesson_and_create_payment(uuid, integer, text, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';