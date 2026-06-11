-- 2026-06-11: per-task курирование Части 2 репетитором — флаг скрытия AI разбора.
--
-- Запрос Елены: «опция удалить/не показывать ученику комментарий от Сократа (AI),
-- если мне не понравился — к задачам Части 2». Репетитор курирует, что видит
-- ученик по каждой задаче Части 2: может скрыть AI разбор (feedback) и/или
-- написать свой комментарий (tutor_comment, уже существует).
--
-- hide_ai_feedback = true → ученик НЕ видит AI разбор (feedback из ai_draft_json)
-- ПОСЛЕ approval. Default false = AI показан (вау «уже проверено AI»). Независим
-- от tutor_comment — оба блока (AI разбор + комментарий репетитора) могут
-- сосуществовать у ученика. Reveal только post-approval (rule 45 state-aware):
-- pre-approval AI разбор показывается «предварительно» без изменений.
--
-- Anti-leak: флаг управляет ТОЛЬКО полем `feedback`. comment_for_tutor / flags /
-- elements_check / confidence НИКОГДА не доходят до ученика независимо от флага.
--
-- Table-level GRANT (authenticated + service_role, миграции 20260508120000 /
-- 20260514140000) автоматически покрывает новую колонку — column-grant whitelist
-- на этой таблице нет. RLS row-scoped — не трогаем. Идемпотентно.

ALTER TABLE public.mock_exam_attempt_part2_solutions
  ADD COLUMN IF NOT EXISTS hide_ai_feedback BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.mock_exam_attempt_part2_solutions.hide_ai_feedback IS
  'Per-task tutor curation (2026-06-11): true → ученик НЕ видит AI разбор (feedback) post-approval. Default false. Независим от tutor_comment (оба блока могут сосуществовать). Anti-leak: управляет только feedback, не comment_for_tutor/flags/elements_check.';

-- Validation:
-- SELECT column_name, data_type, column_default FROM information_schema.columns
--   WHERE table_name = 'mock_exam_attempt_part2_solutions' ORDER BY ordinal_position;
