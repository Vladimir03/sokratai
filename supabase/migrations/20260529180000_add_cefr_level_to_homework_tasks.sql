-- Add explicit CEFR level to homework tasks (CEFR-level fix, 2026-05-29).
--
-- Bug (репортер — Эмилия, FR/DELF): письменные работы всех уровней проверялись
-- по критериям B1. Причина: уровень определялся ТОЛЬКО эвристикой из task_text
-- (cefr-detector.ts) с дефолтом B1, а явно указанный тутором уровень/критерии
-- нигде не хранились. Плюс для французского не было A2-рубрики вообще.
--
-- Fix: явное поле `cefr_level`, которое тьютор выставляет селектором «Уровень»
-- в конструкторе. Когда задано — форсит уровень языковой рубрики в
-- `resolveSubjectRubric` (overrides text-эвристику + дефолт B1). NULL =
-- auto-detect (прежнее поведение, backward-compatible).
--
-- Additive, nullable, no default → существующие задачи не меняют поведение
-- (NULL → auto-detect как раньше). Idempotent (ADD COLUMN IF NOT EXISTS +
-- DROP/ADD CONSTRAINT). Без drop/rename существующих колонок.

ALTER TABLE public.homework_tutor_tasks
  ADD COLUMN IF NOT EXISTS cefr_level text;

ALTER TABLE public.homework_tutor_tasks
  DROP CONSTRAINT IF EXISTS homework_tutor_tasks_cefr_level_check;

ALTER TABLE public.homework_tutor_tasks
  ADD CONSTRAINT homework_tutor_tasks_cefr_level_check
    CHECK (cefr_level IS NULL OR cefr_level IN ('A2', 'B1', 'B2', 'C1'));

COMMENT ON COLUMN public.homework_tutor_tasks.cefr_level IS
  'Явный уровень CEFR (A2/B1/B2/C1) от тутора («Уровень» selector). NULL = auto-detect из task_text. Форсит уровень языковой рубрики в resolveSubjectRubric (CEFR-level fix 2026-05-29). Только foreign-language subjects (french/english/spanish).';
