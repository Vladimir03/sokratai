ALTER TABLE public.tutor_students
  ADD COLUMN IF NOT EXISTS display_name TEXT NULL;

COMMENT ON COLUMN public.tutor_students.display_name IS
  'Tutor-curated display name for the student. Primary source for AI prompts and tutor UI overrides. Nullable — falls back to profiles.username when empty.';