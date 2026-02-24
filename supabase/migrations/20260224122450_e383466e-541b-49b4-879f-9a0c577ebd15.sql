-- Add group session identity columns to tutor_lessons
ALTER TABLE public.tutor_lessons
  ADD COLUMN IF NOT EXISTS group_session_id uuid DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS group_source_tutor_group_id uuid DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS group_title_snapshot text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS group_size_snapshot smallint DEFAULT NULL;

-- Index for fast group-session lookups
CREATE INDEX IF NOT EXISTS idx_tutor_lessons_group_session_id
  ON public.tutor_lessons (group_session_id)
  WHERE group_session_id IS NOT NULL;

-- FK to tutor_groups (nullable, no cascade delete — snapshot survives group deletion)
ALTER TABLE public.tutor_lessons
  DROP CONSTRAINT IF EXISTS tutor_lessons_group_source_tutor_group_id_fkey;

ALTER TABLE public.tutor_lessons
  ADD CONSTRAINT tutor_lessons_group_source_tutor_group_id_fkey
  FOREIGN KEY (group_source_tutor_group_id) REFERENCES public.tutor_groups(id)
  ON DELETE SET NULL;