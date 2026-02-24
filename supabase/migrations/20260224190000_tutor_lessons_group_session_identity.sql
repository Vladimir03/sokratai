-- =============================================
-- PR-G3B1: Stable mini-group session identity on tutor_lessons
-- Additive, backward-compatible schema changes only
-- =============================================

ALTER TABLE public.tutor_lessons
ADD COLUMN IF NOT EXISTS group_session_id UUID,
ADD COLUMN IF NOT EXISTS group_source_tutor_group_id UUID REFERENCES public.tutor_groups(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS group_title_snapshot TEXT,
ADD COLUMN IF NOT EXISTS group_size_snapshot INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tutor_lessons_group_size_snapshot_check'
      AND conrelid = 'public.tutor_lessons'::regclass
  ) THEN
    ALTER TABLE public.tutor_lessons
      ADD CONSTRAINT tutor_lessons_group_size_snapshot_check
      CHECK (group_size_snapshot IS NULL OR group_size_snapshot > 0);
  END IF;
END
$$;

COMMENT ON COLUMN public.tutor_lessons.group_session_id IS
  'Shared identity for one logical mini-group session spanning multiple per-student lessons';
COMMENT ON COLUMN public.tutor_lessons.group_source_tutor_group_id IS
  'Source tutor_group id used when the mini-group session was created';
COMMENT ON COLUMN public.tutor_lessons.group_title_snapshot IS
  'Snapshot of mini-group title at creation time to preserve historical UX';
COMMENT ON COLUMN public.tutor_lessons.group_size_snapshot IS
  'Snapshot of participant count at creation time';

CREATE INDEX IF NOT EXISTS idx_tutor_lessons_group_session
  ON public.tutor_lessons(tutor_id, group_session_id)
  WHERE group_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tutor_lessons_group_slot
  ON public.tutor_lessons(tutor_id, start_at, group_session_id)
  WHERE group_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_tutor_lessons_group_session_member
  ON public.tutor_lessons(tutor_id, group_session_id, tutor_student_id)
  WHERE group_session_id IS NOT NULL AND tutor_student_id IS NOT NULL;
