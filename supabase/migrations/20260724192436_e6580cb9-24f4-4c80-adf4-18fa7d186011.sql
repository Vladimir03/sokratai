-- 1. Колонки work_mode
ALTER TABLE public.homework_tutor_assignments
  ADD COLUMN IF NOT EXISTS work_mode text NOT NULL DEFAULT 'homework'
  CHECK (work_mode IN ('homework', 'independent'));

ALTER TABLE public.homework_tutor_templates
  ADD COLUMN IF NOT EXISTS work_mode text NOT NULL DEFAULT 'homework'
  CHECK (work_mode IN ('homework', 'independent'));

-- 2. Helper
CREATE OR REPLACE FUNCTION public.hw_thread_verdicts_visible(_thread_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    has_role(auth.uid(), 'admin'::app_role)
    OR is_admin_email(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM homework_tutor_threads t
      JOIN homework_tutor_student_assignments sa ON sa.id = t.student_assignment_id
      JOIN homework_tutor_assignments a ON a.id = sa.assignment_id
      WHERE t.id = _thread_id
        AND (
          a.work_mode <> 'independent'
          OR t.status = 'completed'
          OR a.tutor_id = auth.uid()
        )
    );
$$;

REVOKE ALL ON FUNCTION public.hw_thread_verdicts_visible(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hw_thread_verdicts_visible(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.hw_thread_verdicts_visible(uuid) TO authenticated, service_role;

-- 3. RESTRICTIVE-политики
DROP POLICY IF EXISTS hw_independent_verdict_block_messages ON public.homework_tutor_thread_messages;
CREATE POLICY hw_independent_verdict_block_messages
  ON public.homework_tutor_thread_messages
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    role IN ('user', 'tutor')
    OR public.hw_thread_verdicts_visible(thread_id)
  );

DROP POLICY IF EXISTS hw_independent_verdict_block_task_states ON public.homework_tutor_task_states;
CREATE POLICY hw_independent_verdict_block_task_states
  ON public.homework_tutor_task_states
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (public.hw_thread_verdicts_visible(thread_id));