-- Fix: 42P17 infinite recursion в RLS policy для mock_exam_assignments.
--
-- Проблема:
--   Когда student делает SELECT с JOIN'ом mock_exam_attempts → mock_exam_assignments:
--   1. RLS на mock_exam_attempts проверяет student_id = auth.uid() (простой)
--   2. RLS на mock_exam_assignments проверяет EXISTS (SELECT FROM mock_exam_attempts ...)
--   3. Этот EXISTS триггерит RLS на mock_exam_attempts, который снова идёт в #2
--   PostgreSQL детектит цикл → ERROR 42P17
--
-- Решение: SECURITY DEFINER функция обходит RLS внутри своего тела.
-- Тот же паттерн используется в homework_tutor_threads / task_states (rule 40).
--
-- Spec: docs/delivery/features/mock-exams-v1/spec.md AC-6, AC-7

-- ============================================================
-- 1. SECURITY DEFINER helper — проверка что student назначен на assignment
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_student_assigned_to_mock_exam(_assignment_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.mock_exam_attempts
    WHERE assignment_id = _assignment_id
      AND student_id = auth.uid()
  )
$$;

COMMENT ON FUNCTION public.is_student_assigned_to_mock_exam IS
  'SECURITY DEFINER helper: bypass RLS чтобы проверить связь student → assignment без recursion. Используется в RLS policy mock_exam_assignments student_select.';

-- Revoke from PUBLIC, grant only to authenticated (defense in depth).
REVOKE ALL ON FUNCTION public.is_student_assigned_to_mock_exam(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_student_assigned_to_mock_exam(uuid) TO authenticated;

-- ============================================================
-- 2. Replace recursive policy с не-recursive через helper
-- ============================================================

DROP POLICY IF EXISTS "Mock assignments student select assigned" ON public.mock_exam_assignments;

CREATE POLICY "Mock assignments student select assigned"
  ON public.mock_exam_assignments
  FOR SELECT
  TO authenticated
  USING (public.is_student_assigned_to_mock_exam(id));

COMMENT ON POLICY "Mock assignments student select assigned" ON public.mock_exam_assignments IS
  'Student видит свои назначения. Использует SECURITY DEFINER helper чтобы избежать infinite recursion при JOIN на mock_exam_attempts.';
