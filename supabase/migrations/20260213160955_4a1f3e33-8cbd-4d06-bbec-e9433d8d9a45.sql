
CREATE OR REPLACE FUNCTION public.update_lesson_series(
  _root_lesson_id uuid,
  _lesson_type text DEFAULT NULL,
  _subject text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _student_id uuid DEFAULT NULL,
  _tutor_student_id uuid DEFAULT NULL,
  _apply_time_shift boolean DEFAULT false,
  _shift_minutes integer DEFAULT 0
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _updated_count integer;
  _tutor_id uuid;
BEGIN
  -- Verify the caller owns this lesson series
  SELECT t.id INTO _tutor_id
  FROM tutor_lessons l
  JOIN tutors t ON t.id = l.tutor_id
  WHERE l.id = _root_lesson_id AND t.user_id = auth.uid();

  IF _tutor_id IS NULL THEN
    RAISE EXCEPTION 'Access denied or lesson not found';
  END IF;

  -- Update matching lessons in the series (root + children) that are still booked
  UPDATE tutor_lessons
  SET
    lesson_type = COALESCE(_lesson_type, lesson_type),
    subject = COALESCE(_subject, subject),
    notes = COALESCE(_notes, notes),
    student_id = COALESCE(_student_id, student_id),
    tutor_student_id = COALESCE(_tutor_student_id, tutor_student_id),
    start_at = CASE
      WHEN _apply_time_shift AND _shift_minutes != 0
      THEN start_at + (_shift_minutes || ' minutes')::interval
      ELSE start_at
    END,
    updated_at = now()
  WHERE (id = _root_lesson_id OR parent_lesson_id = _root_lesson_id)
    AND status = 'booked';

  GET DIAGNOSTICS _updated_count = ROW_COUNT;
  RETURN _updated_count;
END;
$$;
