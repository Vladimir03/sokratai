-- Resync task_kind from check_format for all existing homework_tutor_tasks rows.
--
-- Bug 2026-05-12: tutor save paths in supabase/functions/homework-api/index.ts
-- (`handleCreateAssignment` + `handleUpdateAssignment` — 4 write-paths total)
-- wrote `check_format` but not `task_kind`, leaving rows with the DB default
-- `task_kind='extended'` even when tutor selected «Краткий ответ»
-- (`check_format='short_answer'`). Frontend `ProblemContext.tsx` reads
-- `task_kind` for the warn banner → all numeric tasks looked like extended
-- on the student side. Same issue affected HWDrawer client-side direct
-- INSERT path (`src/components/kb/HWDrawer.tsx`), which wrote neither
-- column.
--
-- Forward-fix landed in the same commit: backend write-paths now derive
-- `task_kind` from `check_format` via `deriveTaskKind()`; HWDrawer carries
-- `checkFormatSnapshot` through hwDraftStore and writes both columns.
--
-- This migration repairs already-affected rows. One-shot, no schema change.
-- Lovable Cloud auto-applies on push to main.

BEGIN;

UPDATE public.homework_tutor_tasks
   SET task_kind = 'numeric'
 WHERE check_format = 'short_answer'
   AND task_kind <> 'numeric';

UPDATE public.homework_tutor_tasks
   SET task_kind = 'extended'
 WHERE check_format = 'detailed_solution'
   AND task_kind <> 'extended';

-- Tasks where check_format IS NULL: leave task_kind as-is. Either it was
-- set explicitly (e.g. 'proof' for backend extensions), or it defaults to
-- 'extended' (safe fallback applied at INSERT time).

COMMIT;
