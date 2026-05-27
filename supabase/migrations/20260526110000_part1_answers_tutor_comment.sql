-- AC-P11 (2026-05-26): Tutor comment to Часть 1 KIM-level answers.
--
-- Trigger: репетитор просил «оставлять комментарий к конкретной задаче, который
-- видит ученик» (mirror Часть 2 `tutor_comment` field). Текущий schema только
-- содержит earned_score + student_answer + score_source — нет места для tutor
-- commentary.
--
-- New column:
--   tutor_comment TEXT NULL — opцional; max length 600 chars enforced на backend.
--   Видим ученику в `StudentMockExamResult.Part1Card` row под balance.
--
-- Backward compat: existing rows получают NULL по DEFAULT. Frontend type
-- расширяется как `string | null`. Никакой data migration.

ALTER TABLE public.mock_exam_attempt_part1_answers
  ADD COLUMN IF NOT EXISTS tutor_comment TEXT NULL;

COMMENT ON COLUMN public.mock_exam_attempt_part1_answers.tutor_comment IS
  'AC-P11 (2026-05-26): optional tutor comment к конкретной задаче Часть 1. Видим ученику в StudentMockExamResult Part1Card post-approval. Max 600 chars (backend validation). Default NULL.';
