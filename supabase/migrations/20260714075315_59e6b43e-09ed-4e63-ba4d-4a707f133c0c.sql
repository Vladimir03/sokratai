-- Add A1 to the allowed CEFR levels (2026-07-14, запрос Эмилии, FR/DELF).
--
-- Раньше уровни CEFR ограничивались A2/B1/B2/C1. Добавляем DELF A1.
-- Additive: расширяем оба CHECK, добавляя 'A1'. Idempotent (DROP/ADD).
-- Existing rows не затрагиваются (A2/B1/B2/C1/NULL по-прежнему валидны).

-- 1. homework_tutor_tasks.cefr_level
ALTER TABLE public.homework_tutor_tasks
  DROP CONSTRAINT IF EXISTS homework_tutor_tasks_cefr_level_check;

ALTER TABLE public.homework_tutor_tasks
  ADD CONSTRAINT homework_tutor_tasks_cefr_level_check
    CHECK (cefr_level IS NULL OR cefr_level IN ('A1', 'A2', 'B1', 'B2', 'C1'));

COMMENT ON COLUMN public.homework_tutor_tasks.cefr_level IS
  'Явный уровень CEFR (A1/A2/B1/B2/C1) от тутора («Уровень» selector). NULL = auto-detect из task_text. Форсит уровень языковой рубрики в resolveSubjectRubric. Только foreign-language subjects (french/english/spanish).';

-- 2. kb_tasks.cefr_level (unified-task-model — задача Базы несёт AI-настройку)
ALTER TABLE public.kb_tasks
  DROP CONSTRAINT IF EXISTS kb_tasks_cefr_level_check;

ALTER TABLE public.kb_tasks
  ADD CONSTRAINT kb_tasks_cefr_level_check
    CHECK (cefr_level IS NULL OR cefr_level IN ('A1', 'A2', 'B1', 'B2', 'C1'));