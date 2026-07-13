-- M1
CREATE TABLE IF NOT EXISTS public.tutor_student_conversations (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_student_id          UUID NOT NULL UNIQUE REFERENCES public.tutor_students(id) ON DELETE CASCADE,
  last_message_at           TIMESTAMPTZ,
  last_message_preview      TEXT,
  last_message_sender       TEXT CHECK (last_message_sender IN ('tutor','student','assistant')),
  tutor_last_read_at        TIMESTAMPTZ,
  student_last_read_at      TIMESTAMPTZ,
  tutor_unread_count        INTEGER NOT NULL DEFAULT 0,
  student_unread_count      INTEGER NOT NULL DEFAULT 0,
  tutor_last_notified_at    TIMESTAMPTZ,
  student_last_notified_at  TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS update_tsc_updated_at ON public.tutor_student_conversations;
CREATE TRIGGER update_tsc_updated_at BEFORE UPDATE ON public.tutor_student_conversations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE IF NOT EXISTS public.tutor_student_chat_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.tutor_student_conversations(id) ON DELETE CASCADE,
  sender_role     TEXT NOT NULL CHECK (sender_role IN ('tutor','student','assistant')),
  author_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  content         TEXT NOT NULL DEFAULT '' CHECK (char_length(content) <= 4000),
  attachment_url  TEXT,
  client_msg_id   UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tscm_conv_created
  ON public.tutor_student_chat_messages (conversation_id, created_at DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tscm_client_msg
  ON public.tutor_student_chat_messages (conversation_id, client_msg_id)
  WHERE client_msg_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.is_chat_conversation_member(_conversation_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tutor_student_conversations c
    JOIN public.tutor_students ts ON ts.id = c.tutor_student_id
    LEFT JOIN public.tutors t ON t.id = ts.tutor_id
    WHERE c.id = _conversation_id
      AND (ts.student_id = auth.uid() OR t.user_id = auth.uid())
  );
$$;
REVOKE ALL ON FUNCTION public.is_chat_conversation_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_chat_conversation_member(uuid) TO authenticated, service_role;

ALTER TABLE public.tutor_student_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tutor_student_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "TSC conversations select by member" ON public.tutor_student_conversations;
CREATE POLICY "TSC conversations select by member" ON public.tutor_student_conversations
  FOR SELECT TO authenticated USING (public.is_chat_conversation_member(id));

DROP POLICY IF EXISTS "TSC messages select by member" ON public.tutor_student_chat_messages;
CREATE POLICY "TSC messages select by member" ON public.tutor_student_chat_messages
  FOR SELECT TO authenticated USING (public.is_chat_conversation_member(conversation_id));

REVOKE ALL ON public.tutor_student_conversations FROM anon, authenticated;
REVOKE ALL ON public.tutor_student_chat_messages FROM anon, authenticated;
GRANT SELECT ON public.tutor_student_conversations TO authenticated;
GRANT SELECT ON public.tutor_student_chat_messages TO authenticated;
GRANT ALL ON public.tutor_student_conversations TO service_role;
GRANT ALL ON public.tutor_student_chat_messages TO service_role;

CREATE OR REPLACE FUNCTION public.tsc_post_message(
  _conversation_id uuid, _sender_role text, _author_user_id uuid,
  _content text, _attachment_url text, _client_msg_id uuid, _preview text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.tutor_student_chat_messages%ROWTYPE;
BEGIN
  INSERT INTO public.tutor_student_chat_messages
    (conversation_id, sender_role, author_user_id, content, attachment_url, client_msg_id)
  VALUES (_conversation_id, _sender_role, _author_user_id, _content, _attachment_url, _client_msg_id)
  ON CONFLICT (conversation_id, client_msg_id) WHERE client_msg_id IS NOT NULL
  DO NOTHING RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    SELECT * INTO v_row FROM public.tutor_student_chat_messages
    WHERE conversation_id = _conversation_id AND client_msg_id = _client_msg_id;
    IF v_row.id IS NULL THEN RAISE EXCEPTION 'TSC_POST_CONFLICT_LOST'; END IF;
    RETURN jsonb_build_object('message', to_jsonb(v_row), 'deduped', true);
  END IF;

  UPDATE public.tutor_student_conversations
  SET last_message_preview = CASE WHEN last_message_at IS NULL OR v_row.created_at >= last_message_at THEN _preview ELSE last_message_preview END,
      last_message_sender = CASE WHEN last_message_at IS NULL OR v_row.created_at >= last_message_at THEN _sender_role ELSE last_message_sender END,
      last_message_at = GREATEST(COALESCE(last_message_at, v_row.created_at), v_row.created_at),
      tutor_unread_count = CASE WHEN _sender_role IN ('student','assistant') THEN tutor_unread_count + 1 ELSE tutor_unread_count END,
      student_unread_count = CASE WHEN _sender_role IN ('tutor','assistant') THEN student_unread_count + 1 ELSE student_unread_count END
  WHERE id = _conversation_id;

  RETURN jsonb_build_object('message', to_jsonb(v_row), 'deduped', false);
END;
$$;
REVOKE ALL ON FUNCTION public.tsc_post_message(uuid, text, uuid, text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tsc_post_message(uuid, text, uuid, text, text, uuid, text) TO service_role;

-- M2 realtime
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='tutor_student_chat_messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tutor_student_chat_messages;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='tutor_student_conversations') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tutor_student_conversations;
  END IF;
END $$;

-- M3 storage policies (bucket already created privately via storage tool)
DROP POLICY IF EXISTS "tutor-chat-uploads member upload own" ON storage.objects;
CREATE POLICY "tutor-chat-uploads member upload own" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'tutor-chat-uploads'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND public.is_chat_conversation_member(((storage.foldername(name))[1])::uuid)
    AND (SELECT count(*) FROM storage.objects o
         WHERE o.bucket_id = 'tutor-chat-uploads'
           AND o.name LIKE ((storage.foldername(name))[1] || '/%')) < 300
  );

DROP POLICY IF EXISTS "tutor-chat-uploads member read" ON storage.objects;
CREATE POLICY "tutor-chat-uploads member read" ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'tutor-chat-uploads'
    AND public.is_chat_conversation_member(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "tutor-chat-uploads uploader delete own" ON storage.objects;
CREATE POLICY "tutor-chat-uploads uploader delete own" ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'tutor-chat-uploads'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND public.is_chat_conversation_member(((storage.foldername(name))[1])::uuid)
  );

-- M4 analytics events whitelist expansion
ALTER TABLE public.analytics_events DROP CONSTRAINT IF EXISTS analytics_events_event_name_check;
ALTER TABLE public.analytics_events ADD CONSTRAINT analytics_events_event_name_check CHECK (event_name IN (
  'tutor_first_student_added','invite_generated','tutor_first_homework_created',
  'homework_sent_to_student','student_received_and_opened','invite_claimed',
  'student_first_login','student_registered','student_first_homework_opened',
  'student_first_submission','tutor_payment_created','tutor_payment_succeeded',
  'tutor_demo_check_viewed','tutor_demo_check_ran',
  'chat_first_message_sent','tutor_chat_ai_ran','student_chat_ai_ran'
));
