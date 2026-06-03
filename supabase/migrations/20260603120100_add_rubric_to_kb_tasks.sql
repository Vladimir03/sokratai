-- ══════════════════════════════════════════════════════════════
-- KB tasks: rubric (grading criteria) as a first-class task field
--
-- Context: tutors reported "added a task from the base — the criteria didn't
-- attach". The KB had no rubric storage (rubric was deemed homework-specific),
-- so import forced an empty rubric and save-back never persisted it. For
-- language tutors (Эмилия / DELF) the criteria ARE intrinsic to the task.
--
-- Decision (owner, 2026-06-03): rubric travels in «Моя база» (personal base):
-- copied on import (KB → homework draft) and persisted on save-back
-- (homework → KB), but NEVER into the shared Каталог Сократа.
--
-- This migration ONLY adds storage columns. It deliberately does NOT touch the
-- moderation publish/resync functions (kb_publish_task / kb_resync_task,
-- 20260318150000) — they copy an EXPLICIT column list without rubric, so a
-- catalog copy (owner_id IS NULL) keeps rubric_text = NULL. Personal rows are
-- visible only to their owner via RLS (owner_id = auth.uid()). Result: rubric
-- stays private to «Моя база», zero catalog leak.
--
-- Dual-format (single storage ref OR JSON array) — same convention as
-- homework_tutor_tasks.rubric_image_urls. Read via parseAttachmentUrls().
-- Additive only; backward-compatible.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.kb_tasks
  ADD COLUMN IF NOT EXISTS rubric_text text,
  ADD COLUMN IF NOT EXISTS rubric_image_urls text;

COMMENT ON COLUMN public.kb_tasks.rubric_text IS
  'Grading criteria (rubric). Personal base only — never copied into the public catalog by the moderation triggers. Mirrors homework_tutor_tasks.rubric_text.';
COMMENT ON COLUMN public.kb_tasks.rubric_image_urls IS
  'Rubric photos (dual-format storage refs, limit 3). Personal base only; excluded from catalog publish. Read via parseAttachmentUrls().';
