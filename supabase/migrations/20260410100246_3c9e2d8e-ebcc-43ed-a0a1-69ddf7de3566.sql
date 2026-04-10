
-- Add task_id column to homework_tutor_thread_messages (nullable, references homework_tutor_tasks)
ALTER TABLE public.homework_tutor_thread_messages
  ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES public.homework_tutor_tasks(id);

-- Add current_task_id column to homework_tutor_threads (nullable, references homework_tutor_tasks)
ALTER TABLE public.homework_tutor_threads
  ADD COLUMN IF NOT EXISTS current_task_id UUID REFERENCES public.homework_tutor_tasks(id);

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
