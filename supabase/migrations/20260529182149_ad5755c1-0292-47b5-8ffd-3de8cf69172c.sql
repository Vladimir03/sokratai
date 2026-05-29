ALTER TABLE public.homework_tutor_tasks ADD COLUMN IF NOT EXISTS cefr_level text;
ALTER TABLE public.homework_tutor_tasks DROP CONSTRAINT IF EXISTS homework_tutor_tasks_cefr_level_check;
ALTER TABLE public.homework_tutor_tasks ADD CONSTRAINT homework_tutor_tasks_cefr_level_check CHECK (cefr_level IS NULL OR cefr_level IN ('A2','B1','B2','C1'));