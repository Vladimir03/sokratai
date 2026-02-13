-- Bulk update helper for recurring lesson series
-- Applies metadata updates and optional time shift to booked future lessons.

CREATE OR REPLACE FUNCTION public.update_lesson_series(
  _root_lesson_id UUID,
  _lesson_type TEXT DEFAULT NULL,
  _subject TEXT DEFAULT NULL,
  _notes TEXT DEFAULT NULL,
  _student_id UUID DEFAULT NULL,
  _tutor_student_id UUID DEFAULT NULL,
  _apply_time_shift BOOLEAN DEFAULT false,
  _shift_minutes INTEGER DEFAULT 0
)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _updated_count INTEGER;
BEGIN
  UPDATE public.tutor_lessons AS l
  SET
    lesson_type = COALESCE(_lesson_type, l.lesson_type),
    subject = COALESCE(_subject, l.subject),
    notes = COALESCE(_notes, l.notes),
    student_id = COALESCE(_student_id, l.student_id),
    tutor_student_id = COALESCE(_tutor_student_id, l.tutor_student_id),
    start_at = CASE
      WHEN _apply_time_shift THEN l.start_at + make_interval(mins => _shift_minutes)
      ELSE l.start_at
    END,
    updated_at = now()
  WHERE (l.id = _root_lesson_id OR l.parent_lesson_id = _root_lesson_id)
    AND l.status = 'booked'
    AND l.start_at >= now();

  GET DIAGNOSTICS _updated_count = ROW_COUNT;
  RETURN _updated_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_lesson_series(UUID, TEXT, TEXT, TEXT, UUID, UUID, BOOLEAN, INTEGER) TO authenticated;
