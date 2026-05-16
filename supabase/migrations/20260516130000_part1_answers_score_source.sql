-- Mock Exams v1 — score_source column для mock_exam_attempt_part1_answers
-- (TASK-16-R2 fix #1, 2026-05-16).
--
-- Problem (ChatGPT-5.5 review Finding #1):
--   runPart1OCR в mock-exam-grade использует `earned_score IS NOT NULL` как
--   signal "tutor preserved row". Но первый OCR run сам пишет earned_score для
--   всех 20 KIM → второй OCR run видит все 20 rows non-null → skip всех KIM →
--   retry не работает (ai_part1_ocr_json обновился, но scores остались stale).
--
-- Fix: явный enum `score_source` различающий 4 источника записи:
--   - 'ocr'              — runPart1OCR (Gemini OCR + deterministic checker)
--   - 'tutor'            — handlePart1ManualScore (ручная правка в Part1BlankReviewPanel)
--   - 'finalize_default' — handlePart1Finalize INSERT-on-missing (0 для пустых KIM)
--   - 'student_form'     — student form-mode submit auto-check
--
-- Retry-safe contract: `runPart1OCR` теперь skip'ит только rows со
-- `score_source = 'tutor'` (Vladimir manual edits). OCR-scored rows
-- перезаписываются freshly. Manual finalize defaults и student form rows
-- тоже перезаписываются если photo content поменялся.
--
-- Backfill strategy (КРИТИЧНО):
--   Существующие rows (pilot Egor 2026-05-15 + любые pre-migration данные)
--   могут содержать tutor edits, которые мы не хотим затереть. Backfill всех
--   pre-existing rows как 'tutor' — safest default. Production-impact = 0 для
--   tutor (его правки preserved); minor cost = первый retry-ocr на pre-migration
--   attempt'ах не сможет обновить старые OCR scores. Acceptable.
--
-- CLAUDE.md §11: `mock_exam_attempt_part1_answers` имеет updated_at — миграция
-- может SET updated_at = now() при backfill (но мы не меняем contentual data,
-- только добавляем metadata col, поэтому updated_at не трогаем).

BEGIN;

-- 1. Add column with default 'ocr' for new INSERTs (backend контролирует value
--    через explicit upsert payloads — default используется только если backend
--    забыл указать; production code всегда указывает).
ALTER TABLE public.mock_exam_attempt_part1_answers
  ADD COLUMN IF NOT EXISTS score_source TEXT NOT NULL DEFAULT 'ocr'
  CHECK (score_source IN ('ocr', 'tutor', 'finalize_default', 'student_form'));

-- 2. Backfill: ALL pre-existing rows как 'tutor' — safest default.
--    Иначе retry на pilot attempt'ах попытается перезаписать tutor edits.
UPDATE public.mock_exam_attempt_part1_answers
SET score_source = 'tutor'
WHERE score_source = 'ocr'; -- default только что выставлен — rolls back до 'tutor' для backfill

COMMENT ON COLUMN public.mock_exam_attempt_part1_answers.score_source IS
  'Source of earned_score value. ocr = runPart1OCR; tutor = handlePart1ManualScore; finalize_default = handlePart1Finalize INSERT-on-missing; student_form = form-mode auto-check on submit. Используется в runPart1OCR для skip-condition: только score_source=tutor preserved при retry.';

COMMIT;

-- Validation:
-- SELECT score_source, COUNT(*) FROM public.mock_exam_attempt_part1_answers GROUP BY score_source;
-- Expected after backfill: все rows = 'tutor' (если есть pre-existing data).
-- Going forward: новые rows будут с правильными source values per backend handler.
