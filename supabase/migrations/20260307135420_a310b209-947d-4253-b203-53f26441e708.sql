-- Phase 4: Tutor Participation

ALTER TABLE homework_tutor_thread_messages
  ADD COLUMN IF NOT EXISTS author_user_id UUID,
  ADD COLUMN IF NOT EXISTS visible_to_student BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE homework_tutor_threads
  ADD COLUMN IF NOT EXISTS last_student_message_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_tutor_message_at TIMESTAMPTZ;

ALTER TABLE homework_tutor_thread_messages
  DROP CONSTRAINT IF EXISTS homework_tutor_thread_messages_role_check;
ALTER TABLE homework_tutor_thread_messages
  ADD CONSTRAINT homework_tutor_thread_messages_role_check
  CHECK (role IN ('user', 'assistant', 'system', 'tutor'));

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

CREATE INDEX IF NOT EXISTS idx_thread_messages_visible
  ON homework_tutor_thread_messages(thread_id, visible_to_student, created_at);