-- Homework Results v2, TASK-1
-- Add nullable score columns to guided homework task states.

ALTER TABLE public.homework_tutor_task_states
  ADD COLUMN IF NOT EXISTS ai_score numeric(5,2),
  ADD COLUMN IF NOT EXISTS ai_score_comment text,
  ADD COLUMN IF NOT EXISTS tutor_score_override numeric(5,2),
  ADD COLUMN IF NOT EXISTS tutor_score_override_comment text,
  ADD COLUMN IF NOT EXISTS tutor_score_override_at timestamptz,
  ADD COLUMN IF NOT EXISTS tutor_score_override_by uuid REFERENCES auth.users(id);
