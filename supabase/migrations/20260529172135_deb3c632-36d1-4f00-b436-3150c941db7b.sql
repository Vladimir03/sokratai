-- Add 'speaking' to allowed task_kind values
ALTER TABLE public.homework_tutor_tasks DROP CONSTRAINT IF EXISTS homework_tutor_tasks_task_kind_check;
ALTER TABLE public.homework_tutor_tasks ADD CONSTRAINT homework_tutor_tasks_task_kind_check
  CHECK (task_kind = ANY (ARRAY['numeric'::text, 'extended'::text, 'proof'::text, 'speaking'::text]));

-- Add feature flag for voice speaking on tutors
ALTER TABLE public.tutors ADD COLUMN IF NOT EXISTS feature_voice_speaking_enabled boolean NOT NULL DEFAULT false;