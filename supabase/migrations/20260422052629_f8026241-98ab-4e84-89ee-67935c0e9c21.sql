ALTER TABLE public.homework_tutor_threads
  ADD COLUMN IF NOT EXISTS tutor_last_viewed_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.homework_tutor_threads.tutor_last_viewed_at IS
  'Timestamp of the last tutor visit to this guided chat thread. '
  'Updated via POST /threads/:id/viewed-by-tutor from GuidedThreadViewer. '
  'Used by the «Последние диалоги» block on /tutor/home to show the '
  'unread indicator when last_student_message_at > tutor_last_viewed_at. '
  'NULL means the tutor has never opened the thread (treated as unread).';

CREATE INDEX IF NOT EXISTS idx_homework_tutor_threads_student_message_desc
  ON public.homework_tutor_threads (student_assignment_id, last_student_message_at DESC)
  WHERE last_student_message_at IS NOT NULL;