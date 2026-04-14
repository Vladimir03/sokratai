-- Unify homework_tutor_assignments.subject CHECK constraint with canonical
-- subject ids introduced in commit e57cada ("subjects unification"), plus
-- preserve all legacy ids used by VALID_SUBJECTS_UPDATE in homework-api
-- edge function so edits of existing assignments do not fail.
--
-- Before this migration the constraint only accepted:
--   ('math', 'physics', 'history', 'social', 'english', 'cs', 'french', 'chemistry')
-- which rejects new canonical ids like 'maths', 'informatics', 'russian',
-- 'literature', 'spanish', 'biology', 'geography', 'other' sent by the
-- tutor homework create flow, causing "Failed to create assignment".

ALTER TABLE public.homework_tutor_assignments
  DROP CONSTRAINT IF EXISTS homework_tutor_assignments_subject_check;

ALTER TABLE public.homework_tutor_assignments
  ADD CONSTRAINT homework_tutor_assignments_subject_check
  CHECK (subject IN (
    -- Canonical modern ids (src/types/homework.ts SUBJECTS + VALID_SUBJECTS_CREATE)
    'maths', 'physics', 'informatics',
    'russian', 'literature', 'history', 'social',
    'english', 'french', 'spanish',
    'chemistry', 'biology', 'geography',
    'other',
    -- Legacy ids preserved for backward compat with existing rows and with
    -- VALID_SUBJECTS_UPDATE in supabase/functions/homework-api/index.ts
    'math', 'cs', 'rus', 'algebra', 'geometry'
  ));
