-- Adds unread-tracking column for the «Последние диалоги» block on /tutor/home.
--
-- Product spec: docs/delivery/features/tutor-dashboard-v2/phase-1-follow-up-recent-dialogs.md
-- (Phase 1 follow-up after TASK-6).
--
-- Semantics: the tutor «просмотрел» thread when they load it through the
-- guided chat viewer on /tutor/homework/:id?student=:sid. At that point
-- the frontend POSTs to /threads/:id/viewed-by-tutor which sets this
-- timestamp. The /tutor/home RecentDialogsBlock surfaces unread=true when
-- last_student_message_at > tutor_last_viewed_at (NULL → treated as never
-- viewed, so every pre-migration thread surfaces as unread until first
-- visit — intentional, not a bug).

ALTER TABLE public.homework_tutor_threads
  ADD COLUMN IF NOT EXISTS tutor_last_viewed_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.homework_tutor_threads.tutor_last_viewed_at IS
  'Timestamp of the last tutor visit to this guided chat thread. '
  'Updated via POST /threads/:id/viewed-by-tutor from GuidedThreadViewer. '
  'Used by the «Последние диалоги» block on /tutor/home to show the '
  'unread indicator when last_student_message_at > tutor_last_viewed_at. '
  'NULL means the tutor has never opened the thread (treated as unread).';

-- Partial index supports the recent-dialogs aggregation query, which
-- scans threads with last_student_message_at DESC per tutor.
CREATE INDEX IF NOT EXISTS idx_homework_tutor_threads_student_message_desc
  ON public.homework_tutor_threads (student_assignment_id, last_student_message_at DESC)
  WHERE last_student_message_at IS NOT NULL;
