ALTER TABLE public.homework_tutor_task_states
  ADD COLUMN IF NOT EXISTS student_opened_at timestamptz NULL;

NOTIFY pgrst, 'reload schema';