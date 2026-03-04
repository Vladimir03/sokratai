-- Block A: Homework Builder schema updates

-- 1) max_attempts on assignments
ALTER TABLE public.homework_tutor_assignments
  ADD COLUMN IF NOT EXISTS max_attempts INT NOT NULL DEFAULT 3;

-- 2) telegram_chat_id -> nullable for web submissions
ALTER TABLE public.homework_tutor_submissions
  ALTER COLUMN telegram_chat_id DROP NOT NULL;

-- 3) group assignment support
ALTER TABLE public.homework_tutor_assignments
  ADD COLUMN IF NOT EXISTS group_id UUID NULL REFERENCES public.tutor_groups(id) ON DELETE SET NULL;

-- 4) index for student assignment listing
CREATE INDEX IF NOT EXISTS idx_hw_student_assignments_student_id
  ON public.homework_tutor_student_assignments(student_id);
