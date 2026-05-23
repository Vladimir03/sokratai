-- Allow half-integer max_score values (1.5, 2.5, 12.5 etc.) for ФИПИ ЕГЭ tasks
-- where official rubrics give half-step max scores (CLAUDE.md §19 + §40-homework
-- «Score step invariant»: existing override step is 0.1 in task_states; max_score
-- step is 0.5 — tutors type round half-step scores).
--
-- INT → NUMERIC(6,1) cast is transparent: existing INT 12 becomes 12.0, and
-- PostgREST trims trailing zero so frontend sees "12" / "12.5" naturally.
-- DEFAULT 1 keeps backward compat for HWDrawer KB-bulk inserts that omit the
-- field (see HWDrawer.tsx — tutorTasks payload doesn't set max_score).
-- task_states scoring columns are already numeric(5,2) — compatible.
-- templates.tasks_json is JSONB, transparent to int/decimal in JSON.

ALTER TABLE public.homework_tutor_tasks
  ALTER COLUMN max_score TYPE numeric(6,1) USING max_score::numeric(6,1);

ALTER TABLE public.homework_tutor_tasks
  ALTER COLUMN max_score SET DEFAULT 1;

COMMENT ON COLUMN public.homework_tutor_tasks.max_score IS
  'Maximum score for the task. Step 0.5 (e.g. 1, 1.5, 12, 12.5). Stored as numeric(6,1).';
