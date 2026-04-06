-- Drop classic homework mode entirely
-- ──────────────────────────────────────
-- Removes: homework_tutor_submissions, homework_tutor_submission_items tables
-- Removes: homework_tutor_assignments.workflow_mode column (+ CHECK constraint)
-- Removes: validate_homework_submission() trigger function (no longer referenced)
-- Backfills: guided threads + task_states for every existing student assignment
--            that was created under classic mode and therefore has no thread yet.
--
-- Classic mode (photo/text upload + AI OCR check) has been fully replaced by
-- guided_chat workflow. All edge function endpoints, frontend UI, and Telegram
-- bot state machines for classic mode have been removed in the same changeset.
--
-- CASCADE drops dependent objects (RLS policies, triggers, constraints, indexes,
-- and foreign keys from other tables that reference the dropped tables). It does
-- NOT rewrite data in other tables — we have verified no runtime FK into
-- homework_tutor_submissions remains.

BEGIN;

-- 0. Backfill guided threads for every existing student assignment that does
--    not yet have one. Without this, students on existing assignments created
--    in classic mode would see "Домашнее задание пока недоступно" after the
--    frontend switch. We provision a thread per student_assignment and an
--    active task_state row per task. Idempotent: ON CONFLICT DO NOTHING both
--    for the thread (UNIQUE student_assignment_id) and task_states
--    (UNIQUE thread_id,task_id).
INSERT INTO public.homework_tutor_threads (student_assignment_id, status, current_task_order)
SELECT sa.id, 'active', 1
FROM public.homework_tutor_student_assignments sa
LEFT JOIN public.homework_tutor_threads t ON t.student_assignment_id = sa.id
WHERE t.id IS NULL
ON CONFLICT (student_assignment_id) DO NOTHING;

INSERT INTO public.homework_tutor_task_states
  (thread_id, task_id, status, attempts, available_score)
SELECT
  t.id AS thread_id,
  task.id AS task_id,
  'active' AS status,
  0 AS attempts,
  COALESCE(task.max_score, 1) AS available_score
FROM public.homework_tutor_threads t
JOIN public.homework_tutor_student_assignments sa ON sa.id = t.student_assignment_id
JOIN public.homework_tutor_tasks task ON task.assignment_id = sa.assignment_id
LEFT JOIN public.homework_tutor_task_states ts
  ON ts.thread_id = t.id AND ts.task_id = task.id
WHERE ts.id IS NULL
ON CONFLICT (thread_id, task_id) DO NOTHING;

-- 1. Drop classic-mode tables. CASCADE removes dependent RLS policies,
--    triggers (including trg_validate_homework_submission), check/unique
--    constraints, indexes, and any FK constraints in other tables that
--    referenced the dropped tables. Dependent FK *columns* are NOT dropped —
--    only the constraints on them. We have verified no runtime FK into
--    homework_tutor_submissions remains.
DROP TABLE IF EXISTS public.homework_tutor_submission_items CASCADE;
DROP TABLE IF EXISTS public.homework_tutor_submissions CASCADE;

-- 2. Drop the trigger function (no longer referenced once the tables are gone)
DROP FUNCTION IF EXISTS public.validate_homework_submission() CASCADE;

-- 3. Remove workflow_mode column from assignments. The CHECK constraint is
--    auto-dropped together with the column.
ALTER TABLE public.homework_tutor_assignments
  DROP COLUMN IF EXISTS workflow_mode;

COMMIT;
