-- Migration 1: Update update_lesson_series RPC to support selected+future pattern
DROP FUNCTION IF EXISTS public.update_lesson_series(uuid, text, text, text, uuid, uuid, boolean, integer);

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
  -- Only update the selected lesson and future ones (by start_at >= _from_start_at)
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
    AND status = 'booked'
    AND start_at >= _from_start_at;

  GET DIAGNOSTICS _updated_count = ROW_COUNT;
  RETURN _updated_count;
END;
$$;

-- Migration 2: Cleanup orphan recurring lessons
-- Fix any lessons that have is_recurring=true but no parent and no children
UPDATE tutor_lessons
SET is_recurring = false, recurrence_rule = NULL
WHERE is_recurring = true
  AND parent_lesson_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM tutor_lessons children
    WHERE children.parent_lesson_id = tutor_lessons.id
  );