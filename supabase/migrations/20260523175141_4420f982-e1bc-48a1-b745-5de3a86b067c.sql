ALTER TABLE public.homework_tutor_tasks
  ALTER COLUMN max_score TYPE numeric(6,1) USING max_score::numeric(6,1);

ALTER TABLE public.homework_tutor_tasks
  ALTER COLUMN max_score SET DEFAULT 1;

COMMENT ON COLUMN public.homework_tutor_tasks.max_score IS
  'Maximum score for the task. Step 0.5 (e.g. 1, 1.5, 12, 12.5). Stored as numeric(6,1).';