ALTER TABLE public.homework_tutor_assignments
  DROP CONSTRAINT IF EXISTS homework_tutor_assignments_subject_check;

ALTER TABLE public.homework_tutor_assignments
  ADD CONSTRAINT homework_tutor_assignments_subject_check
  CHECK (subject IN ('math', 'physics', 'history', 'social', 'english', 'cs', 'french', 'chemistry'));