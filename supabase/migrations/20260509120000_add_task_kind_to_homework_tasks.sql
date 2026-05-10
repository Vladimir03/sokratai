-- Add task_kind enum column to homework_tutor_tasks.
--
-- Назначение:
--   task_kind управляет формой SubmitSheet на новом student-side screen:
--     - 'numeric'  → только числовой ответ (Часть 1 ЕГЭ / short_answer)
--     - 'extended' → числовой ответ + фото решения от руки (Часть 2 ЕГЭ / detailed_solution)
--     - 'proof'    → только фото доказательства (Часть 2, manual mark тутором — Phase 2 UI)
--
-- Backfill для existing rows:
--   short_answer       → numeric
--   detailed_solution  → extended
--   (любое другое)     → extended (safe default)
--
-- Spec: docs/delivery/features/student-homework-problem-screen/spec.md §5 (Data Model), AC-1.
-- Phase: 1 (DB foundation, TASK-1).
--
-- Idempotent: безопасно прогонять повторно.
--   - ADD COLUMN IF NOT EXISTS защищает повторный add
--   - DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT даёт идемпотентный CHECK
--   - UPDATE ... WHERE task_kind IS NULL не перетирает уже-classified rows
--   - SET NOT NULL / SET DEFAULT — no-op если уже применено
--
-- Additive only: никаких DROP/RENAME существующих columns. RLS, indexes, triggers не тронуты.

-- 1. Add column as nullable, чтобы прогнать backfill.
ALTER TABLE public.homework_tutor_tasks
  ADD COLUMN IF NOT EXISTS task_kind text;

-- 2. CHECK constraint (idempotent через DROP IF EXISTS + ADD).
ALTER TABLE public.homework_tutor_tasks
  DROP CONSTRAINT IF EXISTS homework_tutor_tasks_task_kind_check;

ALTER TABLE public.homework_tutor_tasks
  ADD CONSTRAINT homework_tutor_tasks_task_kind_check
    CHECK (task_kind IN ('numeric', 'extended', 'proof'));

-- 3. Backfill (idempotent — затрагивает только строки с NULL).
UPDATE public.homework_tutor_tasks
  SET task_kind = CASE
    WHEN check_format = 'short_answer' THEN 'numeric'
    WHEN check_format = 'detailed_solution' THEN 'extended'
    ELSE 'extended'
  END
  WHERE task_kind IS NULL;

-- 4. Lock down: NOT NULL + DEFAULT для новых строк.
ALTER TABLE public.homework_tutor_tasks
  ALTER COLUMN task_kind SET NOT NULL;

ALTER TABLE public.homework_tutor_tasks
  ALTER COLUMN task_kind SET DEFAULT 'extended';

COMMENT ON COLUMN public.homework_tutor_tasks.task_kind IS
  'Task kind для student SubmitSheet shape: numeric (Часть 1, только числовой ответ), extended (Часть 2, число + фото решения), proof (Часть 2 доказательство, только фото). Backfilled from check_format (short_answer→numeric, detailed_solution→extended). Default extended для новых строк. See docs/delivery/features/student-homework-problem-screen/spec.md §5.';
