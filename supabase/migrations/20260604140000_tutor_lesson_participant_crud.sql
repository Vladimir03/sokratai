-- =============================================================================
-- Schedule parity Round B2 — add/remove participants on an existing GROUP lesson.
--
-- Use case (Egor): a student from another group joins this group occurrence, or
-- two groups merge for one session. tutor_lesson_participants has NO client
-- write RLS policy (service_role only), so these SECURITY DEFINER RPCs are the
-- ONLY client-callable path. Ownership via tutor_lessons.tutor_id → tutors.id.
--
-- Scope v1: existing unified group lessons (group_session_id set), booked only.
-- Individual→group conversion + series-wide roster changes are deferred (v2
-- unification). Money: payment_amount is RUBLES (mirror calculateLessonPaymentAmount
-- = round((dur/60)*(rate_cents/100))); the charge itself is created later on
-- completion via complete_lesson_and_create_payment, only for booked lessons.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.tutor_add_lesson_participant(
  _lesson_id uuid,
  _tutor_student_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _tutor_id uuid;
  _status text;
  _duration int;
  _gsid uuid;
  _student_profile uuid;
  _amount int;
BEGIN
  SELECT l.tutor_id, l.status, l.duration_min, l.group_session_id
    INTO _tutor_id, _status, _duration, _gsid
  FROM tutor_lessons l
  JOIN tutors t ON t.id = l.tutor_id
  WHERE l.id = _lesson_id
    AND t.user_id = auth.uid();

  IF _tutor_id IS NULL THEN RAISE EXCEPTION 'NOT_OWNED' USING ERRCODE = '42501'; END IF;
  IF _status <> 'booked' THEN RAISE EXCEPTION 'NOT_BOOKED' USING ERRCODE = '22023'; END IF;
  IF _gsid IS NULL THEN RAISE EXCEPTION 'NOT_GROUP' USING ERRCODE = '22023'; END IF;

  -- The student must belong to this tutor (anti-injection). student_id (profile)
  -- may be NULL for name-only students — allowed.
  SELECT ts.student_id,
         ROUND((_duration::numeric / 60) * (ts.hourly_rate_cents::numeric / 100))::int
    INTO _student_profile, _amount
  FROM tutor_students ts
  WHERE ts.id = _tutor_student_id
    AND ts.tutor_id = _tutor_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_STUDENT' USING ERRCODE = '22023'; END IF;

  INSERT INTO tutor_lesson_participants (lesson_id, tutor_student_id, student_id, payment_amount)
  VALUES (_lesson_id, _tutor_student_id, _student_profile, GREATEST(COALESCE(_amount, 0), 0))
  ON CONFLICT (lesson_id, tutor_student_id) DO NOTHING;

  UPDATE tutor_lessons
  SET group_size_snapshot = (SELECT count(*) FROM tutor_lesson_participants WHERE lesson_id = _lesson_id)
  WHERE id = _lesson_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.tutor_remove_lesson_participant(
  _lesson_id uuid,
  _tutor_student_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _tutor_id uuid;
  _status text;
  _count int;
  _deleted int := 0;
BEGIN
  SELECT l.tutor_id, l.status
    INTO _tutor_id, _status
  FROM tutor_lessons l
  JOIN tutors t ON t.id = l.tutor_id
  WHERE l.id = _lesson_id
    AND t.user_id = auth.uid();

  IF _tutor_id IS NULL THEN RAISE EXCEPTION 'NOT_OWNED' USING ERRCODE = '42501'; END IF;
  IF _status <> 'booked' THEN RAISE EXCEPTION 'NOT_BOOKED' USING ERRCODE = '22023'; END IF;

  SELECT count(*) INTO _count FROM tutor_lesson_participants WHERE lesson_id = _lesson_id;
  IF _count <= 1 THEN RAISE EXCEPTION 'LAST_PARTICIPANT' USING ERRCODE = '22023'; END IF;

  WITH del AS (
    DELETE FROM tutor_lesson_participants
    WHERE lesson_id = _lesson_id AND tutor_student_id = _tutor_student_id
    RETURNING 1
  )
  SELECT count(*) INTO _deleted FROM del;

  UPDATE tutor_lessons
  SET group_size_snapshot = (SELECT count(*) FROM tutor_lesson_participants WHERE lesson_id = _lesson_id)
  WHERE id = _lesson_id;

  RETURN jsonb_build_object('ok', true, 'removed', _deleted);
END;
$$;

REVOKE ALL ON FUNCTION public.tutor_add_lesson_participant(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tutor_remove_lesson_participant(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_add_lesson_participant(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tutor_remove_lesson_participant(uuid, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
