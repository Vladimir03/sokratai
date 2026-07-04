
-- 20260630160000_add_ai_reference_solution_to_homework_tasks.sql
ALTER TABLE public.homework_tutor_tasks
  ADD COLUMN IF NOT EXISTS ai_reference_solution jsonb;

-- 20260630170000_column_grants_homework_tutor_tasks_anti_leak.sql
-- Revoke blanket SELECT from authenticated; grant only safe (student-visible) columns.
REVOKE SELECT ON public.homework_tutor_tasks FROM authenticated;

GRANT SELECT (
  id,
  assignment_id,
  order_num,
  task_text,
  task_image_url,
  max_score,
  check_format,
  task_kind,
  kim_number,
  cefr_level
) ON public.homework_tutor_tasks TO authenticated;

-- service_role keeps full access (edge functions)
GRANT ALL ON public.homework_tutor_tasks TO service_role;
