-- ============================================================================
-- Чат репетитор ↔ ученик — realtime publication (M2)
-- ============================================================================
-- messages → INSERT-события (новые пузыри в открытой беседе);
-- conversations → UPDATE-события (живые ✓✓, бейджи, пересортировка списка
-- одной RLS-скоупленной подпиской). Идемпотентный guard — mirror 20260406123813.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'tutor_student_chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tutor_student_chat_messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'tutor_student_conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tutor_student_conversations;
  END IF;
END $$;
