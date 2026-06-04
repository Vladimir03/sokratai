-- =============================================================================
-- Schedule parity Round B1 — allow editing lesson DURATION across a series.
--
-- update_lesson_series previously updated lesson_type/subject/notes/student/
-- time-shift but NOT duration_min. The edit form now exposes «Длительность», so
-- the series RPC gains an optional _duration_min (COALESCE → unchanged when NULL).
-- Adds an 11th parameter → must DROP the old 10-arg signature first.
-- =============================================================================

DROP FUNCTION IF EXISTS public.update_lesson_series(UUID, UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, UUID, UUID, BOOLEAN, INTEGER);

CREATE OR REPLACE FUNCTION public.update_lesson_series(
  _root_lesson_id UUID,
  _selected_lesson_id UUID,
  _from_start_at TIMESTAMPTZ,
  _lesson_type TEXT DEFAULT NULL,
  _subject TEXT DEFAULT NULL,
  _notes TEXT DEFAULT NULL,
  _student_id UUID DEFAULT NULL,
  _tutor_student_id UUID DEFAULT NULL,
  _apply_time_shift BOOLEAN DEFAULT false,
  _shift_minutes INTEGER DEFAULT 0,
  _duration_min INTEGER DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _updated_count INTEGER;
  _tutor_id UUID;
BEGIN
  SELECT t.id INTO _tutor_id
  FROM tutor_lessons l
  JOIN tutors t ON t.id = l.tutor_id
  WHERE l.id = _root_lesson_id
    AND t.user_id = auth.uid();

  IF _tutor_id IS NULL THEN
    RAISE EXCEPTION 'Access denied or lesson not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM tutor_lessons l
    WHERE l.id = _selected_lesson_id
      AND l.tutor_id = _tutor_id
      AND (l.id = _root_lesson_id OR l.parent_lesson_id = _root_lesson_id)
  ) THEN
    RAISE EXCEPTION 'Selected lesson is not part of the series';
  END IF;

  UPDATE tutor_lessons
  SET
    lesson_type = COALESCE(_lesson_type, lesson_type),
    subject = COALESCE(_subject, subject),
    notes = COALESCE(_notes, notes),
    student_id = COALESCE(_student_id, student_id),
    tutor_student_id = COALESCE(_tutor_student_id, tutor_student_id),
    duration_min = COALESCE(_duration_min, duration_min),
    start_at = CASE
      WHEN _apply_time_shift AND _shift_minutes <> 0
      THEN start_at + make_interval(mins => _shift_minutes)
      ELSE start_at
    END,
    updated_at = now()
  WHERE tutor_id = _tutor_id
    AND status = 'booked'
    AND (id = _root_lesson_id OR parent_lesson_id = _root_lesson_id)
    AND (id = _selected_lesson_id OR start_at >= _from_start_at);

  GET DIAGNOSTICS _updated_count = ROW_COUNT;
  RETURN _updated_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_lesson_series(UUID, UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, UUID, UUID, BOOLEAN, INTEGER, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';
