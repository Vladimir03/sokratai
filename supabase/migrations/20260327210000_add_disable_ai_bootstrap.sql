-- TASK-0B: Allow tutors to disable AI bootstrap intro message per assignment
ALTER TABLE homework_tutor_assignments
  ADD COLUMN IF NOT EXISTS disable_ai_bootstrap boolean NOT NULL DEFAULT false;
