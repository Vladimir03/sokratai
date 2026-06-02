-- =============================================================================
-- schedule-materials P0 — tutor_lesson_materials (TASK-1)
-- Spec: docs/delivery/features/schedule-materials/spec.md §5.2
--
-- Materials attached to a lesson: a recording URL, a PDF note, or a soft link
-- to an existing homework assignment (homework_ref). Read-path is the
-- service_role edge (student-lessons-api / lesson-materials-api); RLS below is
-- defense-in-depth only. Additive, backward-compatible.
--
-- Two deviations from the spec's literal SQL (both correctness fixes):
--   1. Student visibility resolves through tutor_lesson_participants, because a
--      unified mini-group is ONE tutor_lessons row (student_id NULL) + N
--      participant rows — the spec's group_session_id/student_id subquery is
--      dead for groups. Membership goes through a SECURITY DEFINER helper
--      (mirror owns_lesson, migration 20260224123937) since participants has
--      tutor-only RLS.
--   2. homework_assignment_id FK is ON DELETE CASCADE (not SET NULL): SET NULL
--      would leave a homework_ref row with NULL id, silently violating
--      chk_kind_payload (Postgres skips CHECK re-validation on FK cascade).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tutor_lesson_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id uuid NOT NULL REFERENCES public.tutors(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES public.tutor_lessons(id) ON DELETE CASCADE,
  group_session_id uuid NULL,
  material_kind text NOT NULL CHECK (material_kind IN ('recording', 'pdf', 'homework_ref')),
  url text NULL,
  homework_assignment_id uuid NULL
    REFERENCES public.homework_tutor_assignments(id) ON DELETE CASCADE,
  title text NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  CONSTRAINT chk_kind_payload CHECK (
    (material_kind = 'recording'    AND url IS NOT NULL) OR
    (material_kind = 'pdf'          AND url IS NOT NULL) OR
    (material_kind = 'homework_ref' AND homework_assignment_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_tlm_lesson  ON public.tutor_lesson_materials(lesson_id);
CREATE INDEX IF NOT EXISTS idx_tlm_session ON public.tutor_lesson_materials(group_session_id)
  WHERE group_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tlm_tutor   ON public.tutor_lesson_materials(tutor_id);

-- 1:1 homework_ref per lesson (spec §3 "ДЗ = 1"): authoritative guard against
-- a double-POST race; the edge also pre-checks for a clean 409 message.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tlm_one_hw_per_lesson
  ON public.tutor_lesson_materials(lesson_id)
  WHERE material_kind = 'homework_ref';

-- ── Membership helper (mirror owns_lesson; required because tutor_lesson_participants
--    has tutor-only RLS — a plain `authenticated` subquery returns ∅ for groups). ──
CREATE OR REPLACE FUNCTION public.student_can_see_lesson(_lesson_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tutor_lessons l
    WHERE l.id = _lesson_id AND l.student_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.tutor_lesson_participants p
    WHERE p.lesson_id = _lesson_id AND p.student_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.student_can_see_lesson(uuid) TO authenticated;

-- ── RLS (defense-in-depth; canonical read-path is the service_role edge) ──
ALTER TABLE public.tutor_lesson_materials ENABLE ROW LEVEL SECURITY;

-- Tutor reads own (FK: tutor_id → tutors.id).
CREATE POLICY tlm_tutor_select ON public.tutor_lesson_materials
  FOR SELECT TO authenticated
  USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

-- Student reads materials of lessons they attend (individual + group via helper).
CREATE POLICY tlm_student_select ON public.tutor_lesson_materials
  FOR SELECT TO authenticated
  USING (public.student_can_see_lesson(lesson_id));

-- No INSERT/UPDATE/DELETE policies → writes only via service_role edge.

-- ── GRANT-whitelist (mirror rule 40 / migration 20260516120100) ──
-- REVOKE ALL strips Supabase default grants (incl. client writes); re-GRANT only
-- the student-safe columns to authenticated. Excludes tutor_id + created_by.
-- service_role keeps full access (bypasses RLS + column grants). Clients must
-- never select('*') on this table — it errors on the revoked columns.
REVOKE ALL ON public.tutor_lesson_materials FROM anon, authenticated;
GRANT SELECT (
  id,
  lesson_id,
  group_session_id,
  material_kind,
  url,
  homework_assignment_id,
  title,
  sort_order,
  created_at
) ON public.tutor_lesson_materials TO authenticated;

COMMENT ON TABLE public.tutor_lesson_materials IS
  'schedule-materials: recording URL / PDF / homework_ref attached to a tutor_lessons row (or group via group_session_id). Read via service_role edge; RLS is defense-in-depth.';
