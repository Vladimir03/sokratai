-- Backfill guided threads for student assignments without one
INSERT INTO public.homework_tutor_threads (student_assignment_id, status, current_task_order)
SELECT sa.id, 'active', 1
FROM public.homework_tutor_student_assignments sa
LEFT JOIN public.homework_tutor_threads t ON t.student_assignment_id = sa.id
WHERE t.id IS NULL
ON CONFLICT (student_assignment_id) DO NOTHING;

-- Backfill task states for threads missing them
INSERT INTO public.homework_tutor_task_states
  (thread_id, task_id, status, attempts, available_score)
SELECT
  t.id AS thread_id,
  task.id AS task_id,
  'active' AS status,
  0 AS attempts,
  COALESCE(task.max_score, 1) AS available_score
FROM public.homework_tutor_threads t
JOIN public.homework_tutor_student_assignments sa ON sa.id = t.student_assignment_id
JOIN public.homework_tutor_tasks task ON task.assignment_id = sa.assignment_id
LEFT JOIN public.homework_tutor_task_states ts
  ON ts.thread_id = t.id AND ts.task_id = task.id
WHERE ts.id IS NULL
ON CONFLICT (thread_id, task_id) DO NOTHING;

-- Drop classic-mode tables
DROP TABLE IF EXISTS public.homework_tutor_submission_items CASCADE;
DROP TABLE IF EXISTS public.homework_tutor_submissions CASCADE;

-- Drop the trigger function
DROP FUNCTION IF EXISTS public.validate_homework_submission() CASCADE;

-- Remove workflow_mode column
ALTER TABLE public.homework_tutor_assignments
  DROP COLUMN IF EXISTS workflow_mode;