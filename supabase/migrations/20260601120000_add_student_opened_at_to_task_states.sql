-- Adds a genuine "student opened this task's statement" timestamp for the
-- «Последние действия учеников» event feed on /tutor/home.
--
-- Product spec: docs/delivery/features/tutor-dashboard-v2/phase-1-follow-up-recent-dialogs.md
-- (v2.0 — event-feed redesign).
--
-- Why this column exists: opening a task used to leave NO database trace
-- (pure frontend navigation). The recent-dialogs handler approximated "opened"
-- from max(task_states.updated_at), but provisionGuidedThread eagerly creates
-- task_states at assignment time with updated_at = now() — so a merely-assigned,
-- never-opened homework falsely surfaced as «Открыл задачу №N». This column is
-- the real signal: it is set the first time the student loads the task's problem
-- screen (handleGetStudentProblem), and only then.
--
-- Service-role only: written in handleGetStudentProblem and read in
-- handleGetRecentDialogs (both run with service_role). It is NOT added to the
-- authenticated column-GRANT whitelist and NOT exposed in any student-facing
-- SELECT / THREAD_SELECT (mirror of tutor_force_completed_by — tutor analytics,
-- not student-visible). No backfill: historical opens are unknown and stay NULL;
-- we only need the signal going forward.

ALTER TABLE public.homework_tutor_task_states
  ADD COLUMN IF NOT EXISTS student_opened_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.homework_tutor_task_states.student_opened_at IS
  'Timestamp of the first time the student opened this task''s problem screen. '
  'Set once (IS NULL guard) by handleGetStudentProblem in the homework-api edge '
  'function. Drives the «Открыл условие задачи» event in the /tutor/home recent '
  'activity feed and lets the tutor distinguish "opened but did not solve" from '
  '"never opened". Service-role only — never granted to authenticated, never '
  'returned to the student. NULL means the student has not opened the task yet.';

-- The recent-dialogs handler reads this column via the REST API (supabase-js)
-- right after deploy; force a PostgREST schema-cache reload so the new column
-- is exposed immediately and we avoid a "column does not exist" race in the
-- deploy window (mirrors prior migrations).
NOTIFY pgrst, 'reload schema';
