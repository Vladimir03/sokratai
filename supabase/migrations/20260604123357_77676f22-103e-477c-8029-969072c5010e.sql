-- 20260604130000_update_lesson_series_duration: add _duration_min parameter
DROP FUNCTION IF EXISTS public.update_lesson_series(uuid, uuid, timestamptz, text, text, text, uuid, uuid, boolean, integer);

CREATE OR REPLACE FUNCTION public.update_lesson_series(
  _root_lesson_id uuid,
  _selected_lesson_id uuid,
  _from_start_at timestamptz,
  _lesson_type text DEFAULT NULL,
  _subject text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _student_id uuid DEFAULT NULL,
  _tutor_student_id uuid DEFAULT NULL,
  _apply_time_shift boolean DEFAULT false,
  _shift_minutes integer DEFAULT 0,
  _duration_min integer DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tutor_id uuid;
  _updated_count integer := 0;
BEGIN
  SELECT tutor_id INTO _tutor_id FROM public.tutor_lessons WHERE id = _selected_lesson_id;
  IF _tutor_id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tutors WHERE id = _tutor_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'NOT_OWNED';
  END IF;

  WITH upd AS (
    UPDATE public.tutor_lessons
    SET
      lesson_type = COALESCE(_lesson_type, lesson_type),
      subject = COALESCE(_subject, subject),
      notes = COALESCE(_notes, notes),
      student_id = COALESCE(_student_id, student_id),
      tutor_student_id = COALESCE(_tutor_student_id, tutor_student_id),
      duration_min = COALESCE(_duration_min, duration_min),
      start_at = CASE WHEN _apply_time_shift THEN start_at + make_interval(mins => _shift_minutes) ELSE start_at END,
      updated_at = now()
    WHERE tutor_id = _tutor_id
      AND (id = _root_lesson_id OR series_root_id = _root_lesson_id)
      AND start_at >= _from_start_at
      AND status = 'booked'
    RETURNING 1
  )
  SELECT count(*) INTO _updated_count FROM upd;

  RETURN _updated_count;
END;
$$;

REVOKE ALL ON FUNCTION public.update_lesson_series(uuid, uuid, timestamptz, text, text, text, uuid, uuid, boolean, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_lesson_series(uuid, uuid, timestamptz, text, text, text, uuid, uuid, boolean, integer, integer) TO authenticated, service_role;

-- 20260604140000_tutor_lesson_participant_crud
CREATE OR REPLACE FUNCTION public.tutor_add_lesson_participant(
  _lesson_id uuid,
  _tutor_student_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tutor_id uuid;
  _status text;
  _is_group boolean;
  _student_id uuid;
  _hourly_rate integer;
  _duration integer;
BEGIN
  SELECT tl.tutor_id, tl.status, (tl.group_session_id IS NOT NULL OR tl.group_source_tutor_group_id IS NOT NULL OR tl.tutor_student_id IS NULL), tl.duration_min
    INTO _tutor_id, _status, _is_group, _duration
  FROM public.tutor_lessons tl
  WHERE tl.id = _lesson_id;

  IF _tutor_id IS NULL THEN RAISE EXCEPTION 'NOT_OWNED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tutors WHERE id = _tutor_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'NOT_OWNED';
  END IF;
  IF NOT _is_group THEN RAISE EXCEPTION 'NOT_GROUP'; END IF;
  IF _status <> 'booked' THEN RAISE EXCEPTION 'NOT_BOOKED'; END IF;

  SELECT ts.student_id, ts.hourly_rate_cents INTO _student_id, _hourly_rate
  FROM public.tutor_students ts
  WHERE ts.id = _tutor_student_id AND ts.tutor_id = _tutor_id;

  IF _student_id IS NULL THEN RAISE EXCEPTION 'INVALID_STUDENT'; END IF;

  INSERT INTO public.tutor_lesson_participants (lesson_id, tutor_student_id, student_id, payment_amount)
  VALUES (
    _lesson_id,
    _tutor_student_id,
    _student_id,
    CASE WHEN _hourly_rate IS NOT NULL AND _duration IS NOT NULL
      THEN (_hourly_rate * _duration / 60)::integer
      ELSE NULL END
  )
  ON CONFLICT (lesson_id, tutor_student_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.tutor_remove_lesson_participant(
  _lesson_id uuid,
  _tutor_student_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tutor_id uuid;
  _status text;
  _is_group boolean;
  _remaining integer;
BEGIN
  SELECT tl.tutor_id, tl.status, (tl.group_session_id IS NOT NULL OR tl.group_source_tutor_group_id IS NOT NULL OR tl.tutor_student_id IS NULL)
    INTO _tutor_id, _status, _is_group
  FROM public.tutor_lessons tl
  WHERE tl.id = _lesson_id;

  IF _tutor_id IS NULL THEN RAISE EXCEPTION 'NOT_OWNED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tutors WHERE id = _tutor_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'NOT_OWNED';
  END IF;
  IF NOT _is_group THEN RAISE EXCEPTION 'NOT_GROUP'; END IF;
  IF _status <> 'booked' THEN RAISE EXCEPTION 'NOT_BOOKED'; END IF;

  SELECT count(*) INTO _remaining FROM public.tutor_lesson_participants WHERE lesson_id = _lesson_id;
  IF _remaining <= 1 THEN RAISE EXCEPTION 'LAST_PARTICIPANT'; END IF;

  DELETE FROM public.tutor_lesson_participants
  WHERE lesson_id = _lesson_id AND tutor_student_id = _tutor_student_id;
END;
$$;

REVOKE ALL ON FUNCTION public.tutor_add_lesson_participant(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tutor_remove_lesson_participant(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_add_lesson_participant(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tutor_remove_lesson_participant(uuid, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';