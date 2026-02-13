-- Cleanup legacy "false series":
-- root lessons marked as recurring but without any child lessons.

UPDATE public.tutor_lessons root
SET
  is_recurring = false,
  recurrence_rule = NULL,
  updated_at = now()
WHERE root.is_recurring = true
  AND root.parent_lesson_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.tutor_lessons child
    WHERE child.parent_lesson_id = root.id
  );
