-- TASK-9 — tutor SELECT access to guided-chat analytics tables.
--
-- Context: base migration 20260306100000_guided_homework_threads.sql enabled
-- RLS on homework_tutor_threads + homework_tutor_task_states but only created
-- policies for students and (later via 20260320154843) for admins. Tutor-side
-- reads were silently returning zero rows, which broke
-- `useTutorStudentActivity` on /tutor/home (the «Активность учеников»
-- block) — all students showed as «Неактивен» with empty weekly strip /
-- hwAvg / hwTrend even when they had active guided threads.
--
-- This migration is the analogue of
-- 20260406173000_enable_tutor_realtime_read_homework_thread_messages.sql
-- (which added tutor SELECT on homework_tutor_thread_messages) but for the
-- parent threads table and the task_states progress table.
--
-- Additive + idempotent (drop-if-exists + create). Does NOT touch student
-- or admin policies; does NOT grant UPDATE/INSERT/DELETE to tutor (FOR
-- SELECT only). Ownership chain: thread → student_assignment → assignment
-- where assignment.tutor_id = auth.uid().
--
-- Spec: docs/delivery/features/tutor-dashboard-v2/phase-1-follow-up-student-activity.md

-- ─── Threads ───────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "HW tutor threads select by assignment owner"
  ON public.homework_tutor_threads;

CREATE POLICY "HW tutor threads select by assignment owner"
  ON public.homework_tutor_threads
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.homework_tutor_student_assignments sa
      JOIN public.homework_tutor_assignments a
        ON a.id = sa.assignment_id
      WHERE sa.id = homework_tutor_threads.student_assignment_id
        AND a.tutor_id = auth.uid()
    )
  );

-- ─── Task states ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "HW tutor task_states select by assignment owner"
  ON public.homework_tutor_task_states;

CREATE POLICY "HW tutor task_states select by assignment owner"
  ON public.homework_tutor_task_states
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.homework_tutor_threads th
      JOIN public.homework_tutor_student_assignments sa
        ON sa.id = th.student_assignment_id
      JOIN public.homework_tutor_assignments a
        ON a.id = sa.assignment_id
      WHERE th.id = homework_tutor_task_states.thread_id
        AND a.tutor_id = auth.uid()
    )
  );
