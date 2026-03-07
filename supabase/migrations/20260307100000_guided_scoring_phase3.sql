-- Phase 3: AI Orchestration + Scoring
-- Extends homework_tutor_task_states with scoring and evaluation columns

-- 1. Scoring columns on task_states
ALTER TABLE homework_tutor_task_states
  ADD COLUMN IF NOT EXISTS available_score    NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS earned_score       NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS wrong_answer_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hint_count         INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS await_mode         TEXT NOT NULL DEFAULT 'answer',
  ADD COLUMN IF NOT EXISTS context_summary    TEXT,
  ADD COLUMN IF NOT EXISTS last_ai_feedback   TEXT;

-- await_mode check constraint (separate statement for IF NOT EXISTS safety)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'homework_tutor_task_states_await_mode_check'
  ) THEN
    ALTER TABLE homework_tutor_task_states
      ADD CONSTRAINT homework_tutor_task_states_await_mode_check
      CHECK (await_mode IN ('answer', 'question'));
  END IF;
END $$;

-- 2. Ensure message_kind column exists on thread_messages (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'homework_tutor_thread_messages'
      AND column_name = 'message_kind'
  ) THEN
    ALTER TABLE homework_tutor_thread_messages
      ADD COLUMN message_kind TEXT;
  END IF;
END $$;
