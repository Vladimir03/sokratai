-- =============================================================================
-- schedule-materials — tighten student RLS for homework_ref (anti-leak, review #2)
--
-- The canonical student read-path (student-lessons-api, service_role) already
-- scopes homework_ref to the assigned student (omits it otherwise). But the
-- defense-in-depth RLS policy `tlm_student_select` previously let ANY lesson
-- participant SELECT a `homework_ref` row — exposing the homework_assignment_id
-- (an opaque UUID) of a ДЗ assigned to a *different* group member via direct
-- PostgREST. No title/content leaked and opening it 404s (link-ownership, rule 40),
-- but defense-in-depth must match the feed. Restrict homework_ref rows to the
-- assigned student only.
--
-- SECURITY DEFINER helper (mirror student_can_see_lesson, migration 20260602140000):
-- a plain `authenticated` subquery on homework_tutor_student_assignments could
-- false-negative under that table's own RLS — the definer helper avoids it.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.student_assigned_to_homework(_assignment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.homework_tutor_student_assignments sa
    WHERE sa.assignment_id = _assignment_id
      AND sa.student_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.student_assigned_to_homework(uuid) TO authenticated;

DROP POLICY IF EXISTS tlm_student_select ON public.tutor_lesson_materials;

CREATE POLICY tlm_student_select ON public.tutor_lesson_materials
  FOR SELECT TO authenticated
  USING (
    public.student_can_see_lesson(lesson_id)
    AND (
      material_kind <> 'homework_ref'
      OR homework_assignment_id IS NULL
      OR public.student_assigned_to_homework(homework_assignment_id)
    )
  );
