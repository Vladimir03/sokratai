-- 2026-06-08: добавляем колонку tutor_comment в mock_exam_attempt_part1_answers.
--
-- Контекст: UI Части 1 (TutorMockExamReview drill-down dialog) имеет поле
-- «Комментарий ученику», а handlePart1ManualScore (mock-exam-tutor-api) пишет его
-- в mock_exam_attempt_part1_answers.tutor_comment — НО колонки не существовало
-- (tutor_comment был только на mock_exam_attempt_part2_solutions; см. базовую
-- схему 20260508120000 — единственная доп-колонка part1 = score_source в
-- 20260516130000). Последствия:
--   * WRITE: сохранение балла+комментария падало → 500 «Failed to persist manual
--     score» (весь UPSERT ронялся на несуществующей колонке → балл тоже не
--     сохранялся).
--   * READ: `SELECT … tutor_comment` ронялся (PostgREST «column does not exist»),
--     ошибка глоталась (читали только data) → part1Rows=null → ответы Части 1 =
--     «без ответа» у ученика И репетитора (form-режим). Blank выживал на OCR.
--
-- Колонка nullable, student-visible by design (ученик видит комментарий
-- репетитора в результате пробника, AC-P11). Table-level GRANT
-- (authenticated + service_role, миграции 20260508120000 / 20260514140000)
-- автоматически покрывает новую колонку — column-grant whitelist на этой таблице
-- нет. Идемпотентно (ADD COLUMN IF NOT EXISTS).

ALTER TABLE public.mock_exam_attempt_part1_answers
  ADD COLUMN IF NOT EXISTS tutor_comment TEXT NULL;

COMMENT ON COLUMN public.mock_exam_attempt_part1_answers.tutor_comment IS
  'Per-KIM комментарий репетитора к ответу Части 1 (AC-P11). Виден ученику в результате пробника. Добавлена 2026-06-08 — раньше колонки не было, из-за чего WRITE падал «Failed to persist manual score», а READ ронялся в «без ответа».';

-- Validation:
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'mock_exam_attempt_part1_answers' ORDER BY ordinal_position;
