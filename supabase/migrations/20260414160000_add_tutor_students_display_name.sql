-- Add tutor-curated display name for students. Used as the primary source
-- for AI-prompt student name and for tutor-facing UI overrides.
-- Falls back to profiles.username at read time (resolveStudentDisplayName
-- in supabase/functions/homework-api/index.ts). Nullable by design —
-- tutor sets this explicitly in TutorStudentProfile UI when needed.

ALTER TABLE public.tutor_students
  ADD COLUMN IF NOT EXISTS display_name TEXT NULL;

COMMENT ON COLUMN public.tutor_students.display_name IS
  'Tutor-curated display name for the student. Primary source for AI prompts and tutor UI overrides. Nullable — falls back to profiles.username when empty.';
