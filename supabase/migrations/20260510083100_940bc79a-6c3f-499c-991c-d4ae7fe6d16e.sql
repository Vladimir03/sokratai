-- Migration 1: add task_kind
ALTER TABLE public.homework_tutor_tasks
  ADD COLUMN IF NOT EXISTS task_kind text;

ALTER TABLE public.homework_tutor_tasks
  DROP CONSTRAINT IF EXISTS homework_tutor_tasks_task_kind_check;

ALTER TABLE public.homework_tutor_tasks
  ADD CONSTRAINT homework_tutor_tasks_task_kind_check
    CHECK (task_kind IN ('numeric', 'extended', 'proof'));

UPDATE public.homework_tutor_tasks
  SET task_kind = CASE
    WHEN check_format = 'short_answer' THEN 'numeric'
    WHEN check_format = 'detailed_solution' THEN 'extended'
    ELSE 'extended'
  END
  WHERE task_kind IS NULL;

ALTER TABLE public.homework_tutor_tasks
  ALTER COLUMN task_kind SET NOT NULL;

ALTER TABLE public.homework_tutor_tasks
  ALTER COLUMN task_kind SET DEFAULT 'extended';

COMMENT ON COLUMN public.homework_tutor_tasks.task_kind IS
  'Task kind для student SubmitSheet shape: numeric (Часть 1, только числовой ответ), extended (Часть 2, число + фото решения), proof (Часть 2 доказательство, только фото). Backfilled from check_format. Default extended.';

-- Migration 2: submission_payload + extended message_kind CHECK
ALTER TABLE public.homework_tutor_thread_messages
  ADD COLUMN IF NOT EXISTS submission_payload jsonb NULL;

COMMENT ON COLUMN public.homework_tutor_thread_messages.submission_payload IS
  'For message_kind=submission: structured JSON {numeric: string, photos: string[], text: string, voice_ref?: string|null}.';

ALTER TABLE public.homework_tutor_thread_messages
  DROP CONSTRAINT IF EXISTS homework_tutor_thread_messages_message_kind_check;

ALTER TABLE public.homework_tutor_thread_messages
  ADD CONSTRAINT homework_tutor_thread_messages_message_kind_check
    CHECK (
      message_kind IS NULL OR message_kind IN (
        'answer','hint_request','question','bootstrap','ai_reply','system',
        'check_result','hint_reply','tutor_message','tutor_note','submission'
      )
    );