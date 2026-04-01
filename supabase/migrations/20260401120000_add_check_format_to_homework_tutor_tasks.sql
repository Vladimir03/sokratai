-- Add check_format column to homework_tutor_tasks
-- Values: 'short_answer' (default, КИМ part 1) or 'detailed_solution' (КИМ part 2)
-- See: docs/delivery/features/check-format/spec.md

ALTER TABLE homework_tutor_tasks
  ADD COLUMN check_format text NOT NULL DEFAULT 'short_answer';

ALTER TABLE homework_tutor_tasks
  ADD CONSTRAINT homework_tutor_tasks_check_format_check
  CHECK (check_format IN ('short_answer', 'detailed_solution'));
