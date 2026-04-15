ALTER TABLE public.homework_tutor_assignments
  DROP CONSTRAINT IF EXISTS homework_tutor_assignments_subject_check;

ALTER TABLE public.homework_tutor_assignments
  ADD CONSTRAINT homework_tutor_assignments_subject_check
  CHECK (subject IN (
    'maths', 'physics', 'informatics',
    'russian', 'literature', 'history', 'social',
    'english', 'french', 'spanish',
    'chemistry', 'biology', 'geography',
    'other',
    'math', 'cs', 'rus', 'algebra', 'geometry'
  ));