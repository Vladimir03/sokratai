ALTER TABLE public.homework_tutor_student_assignments
  ADD COLUMN IF NOT EXISTS tutor_overall_comment TEXT NULL,
  ADD COLUMN IF NOT EXISTS tutor_overall_comment_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS tutor_overall_comment_by UUID NULL;

COMMENT ON COLUMN public.homework_tutor_student_assignments.tutor_overall_comment IS
  'Общий комментарий репетитора ко всему ДЗ для этого ученика (per-student wrap-up). Student-visible by design.';
COMMENT ON COLUMN public.homework_tutor_student_assignments.tutor_overall_comment_at IS
  'Когда комментарий последний раз сохранён/изменён. NULL = комментария нет.';
COMMENT ON COLUMN public.homework_tutor_student_assignments.tutor_overall_comment_by IS
  'Audit: auth.users.id репетитора. TUTOR-ONLY, не возвращается клиенту.';