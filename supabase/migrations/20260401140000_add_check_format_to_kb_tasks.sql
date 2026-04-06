-- Add check_format column to kb_tasks (Phase 2: KB integration)
-- Mirrors the same field from homework_tutor_tasks

ALTER TABLE kb_tasks
  ADD COLUMN check_format text DEFAULT NULL;

ALTER TABLE kb_tasks
  ADD CONSTRAINT kb_tasks_check_format_check
  CHECK (check_format IS NULL OR check_format IN ('short_answer', 'detailed_solution'));
