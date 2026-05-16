BEGIN;

ALTER TABLE public.homework_tutor_tasks
  ADD COLUMN IF NOT EXISTS kim_number INT NULL;

COMMENT ON COLUMN public.homework_tutor_tasks.kim_number IS
  'Optional KIM-style task number (1-26 для ЕГЭ физики, 1-19 для математики и т.д.). NULL для обычных tutor задач без привязки к КИМ. Используется subject-rubric layer (_shared/subject-rubrics/index.ts) для per-KIM specific methodology в AI prompts.';

COMMIT;