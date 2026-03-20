
-- Admin SELECT policies for homework tables
CREATE POLICY "Admin select homework_tutor_threads"
ON public.homework_tutor_threads FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR is_admin_email(auth.uid()));

CREATE POLICY "Admin select homework_tutor_thread_messages"
ON public.homework_tutor_thread_messages FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR is_admin_email(auth.uid()));

CREATE POLICY "Admin select homework_tutor_task_states"
ON public.homework_tutor_task_states FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR is_admin_email(auth.uid()));

CREATE POLICY "Admin select homework_tutor_assignments"
ON public.homework_tutor_assignments FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR is_admin_email(auth.uid()));

CREATE POLICY "Admin select homework_tutor_student_assignments"
ON public.homework_tutor_student_assignments FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR is_admin_email(auth.uid()));

CREATE POLICY "Admin select homework_tutor_submissions"
ON public.homework_tutor_submissions FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR is_admin_email(auth.uid()));

CREATE POLICY "Admin select homework_tutor_tasks"
ON public.homework_tutor_tasks FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR is_admin_email(auth.uid()));
