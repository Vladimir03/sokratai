DROP POLICY IF EXISTS "HW tutor thread messages select by assignment owner"
  ON public.homework_tutor_thread_messages;

CREATE POLICY "HW tutor thread messages select by assignment owner"
  ON public.homework_tutor_thread_messages
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
      WHERE th.id = homework_tutor_thread_messages.thread_id
        AND a.tutor_id = auth.uid()
        AND public.is_tutor_of_student(sa.student_id)
    )
  );