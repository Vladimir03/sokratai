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