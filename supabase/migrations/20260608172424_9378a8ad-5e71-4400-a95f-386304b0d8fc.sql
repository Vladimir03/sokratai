ALTER TABLE public.mock_exam_attempt_part1_answers
  ADD COLUMN IF NOT EXISTS tutor_comment TEXT NULL;

COMMENT ON COLUMN public.mock_exam_attempt_part1_answers.tutor_comment IS
  'Per-KIM комментарий репетитора к ответу Части 1 (AC-P11). Виден ученику в результате пробника.';