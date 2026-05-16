REVOKE SELECT ON public.homework_tutor_task_states FROM anon, authenticated;

GRANT SELECT (
  id,
  thread_id,
  task_id,
  status,
  attempts,
  best_score,
  available_score,
  earned_score,
  wrong_answer_count,
  hint_count,
  await_mode,
  context_summary,
  last_ai_feedback,
  ai_score,
  tutor_score_override,
  tutor_score_override_comment,
  tutor_score_override_at,
  tutor_force_completed_at,
  created_at,
  updated_at
) ON public.homework_tutor_task_states TO authenticated;

COMMENT ON COLUMN public.homework_tutor_task_states.ai_score_comment IS
  'AI rationale for ai_score. Tutor-only — strip from student via stripStudentSensitiveTaskStateFields AND REVOKEd from authenticated at column level (see 20260516120100). Access only via service_role / edge functions.';
COMMENT ON COLUMN public.homework_tutor_task_states.tutor_score_override_by IS
  'Audit: tutor user_id who set the override. Tutor-only — column-level REVOKE from authenticated (see 20260516120100). Access only via service_role.';
COMMENT ON COLUMN public.homework_tutor_task_states.tutor_force_completed_by IS
  'Audit trail: tutor user_id who force-closed the task. Tutor-only — column-level REVOKE from authenticated (see 20260516120100). Access only via service_role.';