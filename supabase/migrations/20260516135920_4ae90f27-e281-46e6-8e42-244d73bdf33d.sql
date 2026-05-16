-- Tutor Force-Complete for guided homework tasks (2026-05-16)
ALTER TABLE public.homework_tutor_task_states
  ADD COLUMN IF NOT EXISTS tutor_force_completed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS tutor_force_completed_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.homework_tutor_task_states.tutor_force_completed_at IS
  'When set, the task was manually closed by tutor (not by AI CORRECT verdict). Distinguishes tutor force-complete from AI-completed for student UI badge + tutor reopen eligibility.';
COMMENT ON COLUMN public.homework_tutor_task_states.tutor_force_completed_by IS
  'Audit trail. Tutor-only — strip from student-visible task_state via stripStudentSensitiveTaskStateFields.';