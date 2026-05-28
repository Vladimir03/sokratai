ALTER TABLE public.homework_tutor_task_states ADD COLUMN IF NOT EXISTS ai_criteria_json JSONB NULL;
GRANT SELECT (ai_criteria_json) ON public.homework_tutor_task_states TO authenticated;