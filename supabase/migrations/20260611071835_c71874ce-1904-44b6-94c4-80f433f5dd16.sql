ALTER TABLE public.mock_exam_attempt_part2_solutions
  ADD COLUMN IF NOT EXISTS hide_ai_feedback boolean NOT NULL DEFAULT false;