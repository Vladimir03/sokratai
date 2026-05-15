-- Phase 6 Round 3 (2026-05-15) — P0 fix from ChatGPT-5.5 review.
-- ============================================================================
-- mock-exam-grade::handleGrade использует `updated_at` для stale-lock detection
-- в CAS claim (Round 2 fix #1). Но base schema `mock_exam_attempts` (миграция
-- `20260508120000`) её НЕ содержит — только `created_at`. Round 2 commit
-- (`33e5490`) на проде сломает grading на первом DB call:
--
--   SELECT ..., updated_at FROM mock_exam_attempts WHERE id=?  → DB ERROR
--
-- Этот fix добавляет колонку + BEFORE UPDATE trigger чтобы значение
-- автоматически обновлялось на ЛЮБОЙ UPDATE row (не только в CAS path).
--
-- Backward compat: ADD COLUMN IF NOT EXISTS + DEFAULT now() → existing rows
-- получают timestamp = migration apply time. Это OK для stale detection: на
-- момент apply'а ни один grader не работает (нужен deploy gap), так что все
-- attempts с `status='ai_checking'` если есть — реально stale, и
-- STALE_LOCK_AGE_MS=120s срабатывает корректно.
-- ============================================================================

BEGIN;

-- 1. Колонка.
ALTER TABLE public.mock_exam_attempts
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

COMMENT ON COLUMN public.mock_exam_attempts.updated_at IS
  'Auto-maintained by BEFORE UPDATE trigger. Used by mock-exam-grade CAS claim '
  'для stale-lock detection (STALE_LOCK_AGE_MS=120s) — если status=ai_checking '
  'и updated_at < 120s назад → concurrent grader, return 202 ALREADY_GRADING.';

-- 2. Trigger function (idempotent CREATE OR REPLACE).
CREATE OR REPLACE FUNCTION public.set_mock_exam_attempts_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 3. Trigger (idempotent — drop + create).
DROP TRIGGER IF EXISTS trg_mock_exam_attempts_updated_at
  ON public.mock_exam_attempts;
CREATE TRIGGER trg_mock_exam_attempts_updated_at
  BEFORE UPDATE ON public.mock_exam_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_mock_exam_attempts_updated_at();

COMMIT;
