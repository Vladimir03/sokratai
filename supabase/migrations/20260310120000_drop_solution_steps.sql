-- Drop the solution_steps column from homework_tutor_tasks.
-- This field is no longer used in the UI or AI prompts.
ALTER TABLE public.homework_tutor_tasks DROP COLUMN IF EXISTS solution_steps;
