-- Phase 3: AI Orchestration + Scoring

ALTER TABLE homework_tutor_task_states
  ADD COLUMN IF NOT EXISTS available_score    NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS earned_score       NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS wrong_answer_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hint_count         INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS await_mode         TEXT NOT NULL DEFAULT 'answer',
  ADD COLUMN IF NOT EXISTS context_summary    TEXT,
  ADD COLUMN IF NOT EXISTS last_ai_feedback   TEXT;

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