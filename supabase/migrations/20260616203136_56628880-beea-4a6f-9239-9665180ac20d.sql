-- 20260615190000_lesson_billing_cutover_b4.sql
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
  LOOP
    BEGIN
      _actor := COALESCE(auth.uid(), (SELECT user_id FROM public.tutors WHERE id = _lesson.tutor_id));
      IF EXISTS (SELECT 1 FROM public.tutor_lesson_participants p WHERE p.lesson_id = _lesson.id) THEN
        FOR _student IN
          SELECT tutor_student_id FROM public.tutor_lesson_participants WHERE lesson_id = _lesson.id
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

CREATE OR REPLACE FUNCTION public.tutor_ids_with_due_lessons()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT l.tutor_id FROM public.tutor_lessons l
  WHERE l.start_at + make_interval(mins => COALESCE(l.duration_min, 60)) <= now()
    AND l.start_at >= now() - interval '60 days';
$$;
REVOKE ALL ON FUNCTION public.tutor_ids_with_due_lessons() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_ids_with_due_lessons() TO service_role;

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
    SELECT 1 FROM public.tutor_lesson_participants
    WHERE lesson_id = _lesson_id AND tutor_student_id = _tutor_student_id
  ) THEN RAISE EXCEPTION 'PARTICIPANT_NOT_FOUND'; END IF;

  UPDATE public.tutor_lesson_participants SET payment_amount = _amount
   WHERE lesson_id = _lesson_id AND tutor_student_id = _tutor_student_id;
  PERFORM public._apply_lesson_debit_from_current_cost(_lesson_id, _tutor_student_id, auth.uid());
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.tutor_set_lesson_cost(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tutor_set_participant_cost(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_set_lesson_cost(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tutor_set_participant_cost(uuid, uuid, integer) TO authenticated, service_role;

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
  _participant record;
  _actor uuid;
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

  UPDATE public.tutor_lessons
  SET
    status = 'completed',
    payment_status = _payment_status,
    payment_amount = CASE WHEN NOT _is_group THEN _amount ELSE NULL END,
    paid_at = CASE WHEN _payment_status IN ('paid', 'paid_earlier') THEN NOW() ELSE NULL END,
    payment_reminder_sent = true
  WHERE id = _lesson_id;

  IF _is_group THEN
    FOR _participant IN
      SELECT p.tutor_student_id FROM public.tutor_lesson_participants p WHERE p.lesson_id = _lesson_id
    LOOP
      PERFORM public._apply_lesson_debit_from_current_cost(_lesson_id, _participant.tutor_student_id, _actor);
      UPDATE public.tutor_lesson_participants
      SET payment_status = _payment_status,
          paid_at = CASE WHEN _payment_status IN ('paid', 'paid_earlier') THEN NOW() ELSE NULL END
      WHERE lesson_id = _lesson_id AND tutor_student_id = _participant.tutor_student_id;
    END LOOP;
  ELSIF _tutor_student_id IS NOT NULL THEN
    PERFORM public._apply_lesson_debit_from_current_cost(_lesson_id, _tutor_student_id, _actor);
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_lesson_and_create_payment(uuid, integer, text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_group_participant_payment_status(
  _lesson_id uuid,
  _tutor_student_id uuid,
  _payment_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE _tutor_id uuid; _lesson_status text; _participant_amount integer; _paid_at timestamptz;
BEGIN
  IF _payment_status NOT IN ('pending', 'paid') THEN
    RETURN jsonb_build_object('ok', false, 'status', NULL, 'amount', NULL, 'paid_at', NULL,
      'error_code', 'INVALID_PAYMENT_STATUS');
  END IF;

  SELECT t.id, l.status INTO _tutor_id, _lesson_status
  FROM public.tutor_lessons l JOIN public.tutors t ON t.id = l.tutor_id
  WHERE l.id = _lesson_id AND t.user_id = auth.uid();
  IF _tutor_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', NULL, 'amount', NULL, 'paid_at', NULL,
      'error_code', 'LESSON_NOT_FOUND_OR_FORBIDDEN');
  END IF;
  IF _lesson_status <> 'completed' THEN
    RETURN jsonb_build_object('ok', false, 'status', NULL, 'amount', NULL, 'paid_at', NULL,
      'error_code', 'LESSON_NOT_COMPLETED');
  END IF;

  SELECT p.payment_amount INTO _participant_amount
  FROM public.tutor_lesson_participants p
  WHERE p.lesson_id = _lesson_id AND p.tutor_student_id = _tutor_student_id;

  IF _participant_amount IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.tutor_lesson_participants p
    WHERE p.lesson_id = _lesson_id AND p.tutor_student_id = _tutor_student_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'status', NULL, 'amount', NULL, 'paid_at', NULL,
      'error_code', 'PARTICIPANT_NOT_FOUND');
  END IF;

  _paid_at := CASE WHEN _payment_status = 'paid' THEN NOW() ELSE NULL END;

  UPDATE public.tutor_lesson_participants
  SET payment_status = _payment_status, paid_at = _paid_at
  WHERE lesson_id = _lesson_id AND tutor_student_id = _tutor_student_id;

  RETURN jsonb_build_object('ok', true, 'status', _payment_status, 'amount', _participant_amount,
    'paid_at', _paid_at, 'error_code', NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_group_participant_payment_status(uuid, uuid, text)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.tutor_confirm_lessons(jsonb) FROM authenticated;

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