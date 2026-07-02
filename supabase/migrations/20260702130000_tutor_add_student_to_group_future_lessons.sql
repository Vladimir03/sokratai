-- =============================================================================
-- Roster-driven group propagation (2026-07-02) — add a student to ALL future
-- booked lessons of a LEARNING group in one call.
--
-- Use case (Elena, pilot): a new student joins a mini-group. Adding them to the
-- group ROSTER (tutor_group_memberships) does NOT reach already-created lessons,
-- and the single-lesson tutor_add_lesson_participant (mig 20260604140000) only
-- touches one occurrence. This RPC back-fills every future booked lesson linked
-- to the group via tutor_lessons.group_source_tutor_group_id.
--
-- Scope: FUTURE (start_at >= now()) BOOKED unified group lessons only. Past
-- lessons are untouched (a past occurrence would create a hanging debit — rule 60
-- "будущее → нет debit"). Idempotent: skips lessons where the student is already
-- a participant. Rows only — NO ledger/payments writes (debit is created later on
-- completion via _apply_lesson_debit / complete_lesson_and_create_payment).
--
-- Money: payment_amount is RUBLES, per-lesson (occurrences may differ in
-- duration), frozen at add-time from tutor_students.hourly_rate_cents — mirror
-- tutor_add_lesson_participant / calculateLessonPaymentAmount exactly. NULL/0
-- rate → 0 (waive), but the student is STILL added (roster membership is the point).
--
-- Ownership: tutor_groups.tutor_id → tutors.id (FK drift, rule 40). Only
-- is_primary=true (learning) groups host lessons; tags (is_primary=false) raise.
--
-- Remove-symmetry (tutor_remove_student_from_group_future_lessons) is DEFERRED to
-- v2 (harder money guards: skip paid, never empty a lesson). The single-lesson
-- tutor_remove_lesson_participant covers "oops, not this occurrence".
-- =============================================================================

CREATE OR REPLACE FUNCTION public.tutor_add_student_to_group_future_lessons(
  _tutor_group_id uuid,
  _tutor_student_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _tutor_id uuid;
  _is_primary boolean;
  _student_profile uuid;
  _rate int;
  _future_count int := 0;
  _added_count int := 0;
BEGIN
  -- 1) Ownership + is_primary guard: group belongs to this tutor AND is a LEARNING
  --    group. Tags (is_primary=false) never host lessons (rule 60, mig 20260618120000).
  SELECT g.tutor_id, g.is_primary
    INTO _tutor_id, _is_primary
  FROM tutor_groups g
  JOIN tutors t ON t.id = g.tutor_id
  WHERE g.id = _tutor_group_id
    AND t.user_id = auth.uid();

  IF _tutor_id IS NULL THEN RAISE EXCEPTION 'NOT_OWNED' USING ERRCODE = '42501'; END IF;
  IF _is_primary IS NOT TRUE THEN RAISE EXCEPTION 'NOT_LEARNING_GROUP' USING ERRCODE = '22023'; END IF;

  -- 2) Student must belong to the same tutor (anti-injection). Freeze rate now.
  --    student_id (profile) may be NULL for name-only students (mirror add_participant).
  SELECT ts.student_id, ts.hourly_rate_cents
    INTO _student_profile, _rate
  FROM tutor_students ts
  WHERE ts.id = _tutor_student_id
    AND ts.tutor_id = _tutor_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_STUDENT' USING ERRCODE = '22023'; END IF;

  -- 3) Serialize concurrent roster adds for the same (group, student). Mirror
  --    ledger RPC lock style; cheap, whole op is short.
  PERFORM pg_advisory_xact_lock(hashtext(_tutor_group_id::text), hashtext(_tutor_student_id::text));

  -- 4) Target = this group's FUTURE BOOKED unified lessons, minus ones where the
  --    student is already a participant. payment_amount frozen per-lesson
  --    (duration × rate); NULL/0 → 0 (waive) but still inserted.
  WITH target AS (
    SELECT l.id AS lesson_id, l.duration_min
    FROM tutor_lessons l
    WHERE l.group_source_tutor_group_id = _tutor_group_id
      AND l.tutor_id = _tutor_id
      AND l.status = 'booked'
      AND l.start_at >= now()
      AND l.group_session_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM tutor_lesson_participants p
        WHERE p.lesson_id = l.id AND p.tutor_student_id = _tutor_student_id
      )
  ),
  ins AS (
    INSERT INTO tutor_lesson_participants (lesson_id, tutor_student_id, student_id, payment_amount)
    SELECT tg.lesson_id, _tutor_student_id, _student_profile,
           GREATEST(COALESCE(ROUND((tg.duration_min::numeric / 60) * (_rate::numeric / 100))::int, 0), 0)
    FROM target tg
    ON CONFLICT (lesson_id, tutor_student_id) DO NOTHING
    RETURNING lesson_id
  )
  SELECT count(*) INTO _added_count FROM ins;

  -- 5) Recompute group_size_snapshot on this group's future booked lessons.
  UPDATE tutor_lessons l
  SET group_size_snapshot = (SELECT count(*) FROM tutor_lesson_participants p WHERE p.lesson_id = l.id)
  WHERE l.group_source_tutor_group_id = _tutor_group_id
    AND l.tutor_id = _tutor_id
    AND l.status = 'booked'
    AND l.start_at >= now();

  -- 6) Total future booked unified lessons of this group (for "added N of M" UX).
  SELECT count(*) INTO _future_count
  FROM tutor_lessons l
  WHERE l.group_source_tutor_group_id = _tutor_group_id
    AND l.tutor_id = _tutor_id
    AND l.status = 'booked'
    AND l.start_at >= now()
    AND l.group_session_id IS NOT NULL;

  RETURN jsonb_build_object('ok', true, 'added_count', _added_count, 'future_count', _future_count);
END;
$$;

REVOKE ALL ON FUNCTION public.tutor_add_student_to_group_future_lessons(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_add_student_to_group_future_lessons(uuid, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
