-- Phase 4: Tutor Participation for Guided Homework Chat
-- Adds tutor messaging, hidden notes, and task reset support.

-- 1a. New columns on homework_tutor_thread_messages
ALTER TABLE homework_tutor_thread_messages
  ADD COLUMN IF NOT EXISTS author_user_id UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS visible_to_student BOOLEAN NOT NULL DEFAULT true;

-- 1b. New columns on homework_tutor_threads
ALTER TABLE homework_tutor_threads
  ADD COLUMN IF NOT EXISTS last_student_message_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_tutor_message_at TIMESTAMPTZ;

-- 1c. Add 'tutor' to the role CHECK constraint
--     Existing: inline CHECK (role IN ('user', 'assistant', 'system'))
--     PostgreSQL auto-names inline checks: <table>_<column>_check
ALTER TABLE homework_tutor_thread_messages
  DROP CONSTRAINT IF EXISTS homework_tutor_thread_messages_role_check;
ALTER TABLE homework_tutor_thread_messages
  ADD CONSTRAINT homework_tutor_thread_messages_role_check
  CHECK (role IN ('user', 'assistant', 'system', 'tutor'));

-- 1d. Update student RLS: filter out hidden notes (visible_to_student = false)
DROP POLICY IF EXISTS "student_read_own_thread_messages" ON homework_tutor_thread_messages;
CREATE POLICY "student_read_own_thread_messages" ON homework_tutor_thread_messages
  FOR SELECT USING (
    visible_to_student = true
    AND thread_id IN (
      SELECT t.id FROM homework_tutor_threads t
      JOIN homework_tutor_student_assignments sa ON sa.id = t.student_assignment_id
      WHERE sa.student_id = auth.uid()
    )
  );

-- 1e. Index for efficient tutor message queries
CREATE INDEX IF NOT EXISTS idx_thread_messages_visible
  ON homework_tutor_thread_messages(thread_id, visible_to_student, created_at);
