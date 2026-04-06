ALTER TABLE homework_tutor_assignments
  ADD COLUMN IF NOT EXISTS exam_type VARCHAR NOT NULL DEFAULT 'ege';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'homework_tutor_assignments_exam_type_check'
  ) THEN
    ALTER TABLE homework_tutor_assignments
      ADD CONSTRAINT homework_tutor_assignments_exam_type_check
      CHECK (exam_type IN ('ege', 'oge'));
  END IF;
END
$$;
