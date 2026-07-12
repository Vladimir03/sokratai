-- ============================================================================
-- Чат репетитор ↔ ученик — foundation (M1)
-- ============================================================================
-- Telegram-like 1:1 чат, беседа = 1:1 с линком tutor_students (lazy-create).
-- План: ~/.claude/plans/functional-frolicking-flute.md
--
-- Инварианты:
--   • ВСЕ записи — только через edge `tutor-student-chat-api` (service_role):
--     никаких INSERT/UPDATE/DELETE политик для authenticated — денорм-счётчики
--     и превью нельзя подделать клиентом.
--   • SELECT для обеих сторон через SECURITY DEFINER helper (rule 40: raw JOIN
--     в USING() ломается под RLS промежуточных таблиц; у tutor_students НЕТ
--     student-SELECT политики).
--   • Галочки ✓✓ — watermark-модель Telegram: сообщение «прочитано» ⇔
--     created_at <= peer_last_read_at. Без per-message флагов.
--   • FK-дрейф (rule 40): tutor_students.tutor_id → tutors.id, НЕ auth.users.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tutor_student_conversations (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_student_id          UUID NOT NULL UNIQUE
                              REFERENCES public.tutor_students(id) ON DELETE CASCADE,
  -- денорм для списка чатов (single writer = edge fn, дрейфа нет):
  last_message_at           TIMESTAMPTZ,
  last_message_preview      TEXT,
  last_message_sender       TEXT CHECK (last_message_sender IN ('tutor','student','assistant')),
  -- галочки прочтения (watermark):
  tutor_last_read_at        TIMESTAMPTZ,
  student_last_read_at      TIMESTAMPTZ,
  -- бейджи непрочитанных (сбрасываются атомарно вместе с read_at):
  tutor_unread_count        INTEGER NOT NULL DEFAULT 0,
  student_unread_count      INTEGER NOT NULL DEFAULT 0,
  -- троттлинг уведомлений (максимум 1 за 5 мин на получателя на беседу):
  tutor_last_notified_at    TIMESTAMPTZ,
  student_last_notified_at  TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.tutor_student_conversations IS
  'Беседа репетитор↔ученик, 1:1 с tutor_students. Записи только через edge tutor-student-chat-api (service_role). Чат-фича 2026-07-12.';

DROP TRIGGER IF EXISTS update_tsc_updated_at ON public.tutor_student_conversations;
CREATE TRIGGER update_tsc_updated_at
  BEFORE UPDATE ON public.tutor_student_conversations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE IF NOT EXISTS public.tutor_student_chat_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL
                    REFERENCES public.tutor_student_conversations(id) ON DELETE CASCADE,
  sender_role     TEXT NOT NULL CHECK (sender_role IN ('tutor','student','assistant')),
  author_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- NULL для assistant
  content         TEXT NOT NULL DEFAULT '' CHECK (char_length(content) <= 4000),
  -- dual-format (single storage:// ref ИЛИ JSON-array) — читать через parseAttachmentUrls:
  attachment_url  TEXT,
  -- идемпотентный retry оптимистичной отправки:
  client_msg_id   UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.tutor_student_chat_messages IS
  'Сообщения чата репетитор↔ученик (+ ответы @СократAI как sender_role=assistant). Append-only, записи только через edge.';

-- пагинация + подсчёт непрочитанных:
CREATE INDEX IF NOT EXISTS idx_tscm_conv_created
  ON public.tutor_student_chat_messages (conversation_id, created_at DESC, id DESC);
-- дедуп повторной отправки того же client_msg_id:
CREATE UNIQUE INDEX IF NOT EXISTS uq_tscm_client_msg
  ON public.tutor_student_chat_messages (conversation_id, client_msg_id)
  WHERE client_msg_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- SECURITY DEFINER membership helper — единственный гейт чтения.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_chat_conversation_member(_conversation_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tutor_student_conversations c
    JOIN public.tutor_students ts ON ts.id = c.tutor_student_id
    LEFT JOIN public.tutors t ON t.id = ts.tutor_id
    WHERE c.id = _conversation_id
      AND (ts.student_id = auth.uid() OR t.user_id = auth.uid())
  );
$$;

REVOKE ALL ON FUNCTION public.is_chat_conversation_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_chat_conversation_member(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- RLS: SELECT-only для участников; все write — service_role (edge).
-- ----------------------------------------------------------------------------
ALTER TABLE public.tutor_student_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tutor_student_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "TSC conversations select by member" ON public.tutor_student_conversations;
CREATE POLICY "TSC conversations select by member"
  ON public.tutor_student_conversations FOR SELECT TO authenticated
  USING (public.is_chat_conversation_member(id));

DROP POLICY IF EXISTS "TSC messages select by member" ON public.tutor_student_chat_messages;
CREATE POLICY "TSC messages select by member"
  ON public.tutor_student_chat_messages FOR SELECT TO authenticated
  USING (public.is_chat_conversation_member(conversation_id));

REVOKE ALL ON public.tutor_student_conversations FROM anon, authenticated;
REVOKE ALL ON public.tutor_student_chat_messages FROM anon, authenticated;
GRANT SELECT ON public.tutor_student_conversations TO authenticated;
GRANT SELECT ON public.tutor_student_chat_messages TO authenticated;
GRANT ALL ON public.tutor_student_conversations TO service_role;
GRANT ALL ON public.tutor_student_chat_messages TO service_role;

-- ----------------------------------------------------------------------------
-- Атомарная вставка сообщения + денорм в ОДНОЙ транзакции (ревью ChatGPT-5.6 P1:
-- две транзакции = поздний денорм откатывал preview назад; сбой денорма терял
-- обновление списка; markRead между insert и денормом давал ложный unread).
--   • идемпотентность: ON CONFLICT по partial-unique (conversation_id,
--     client_msg_id) → возвращаем существующую строку, денорм НЕ повторяем;
--   • preview/sender/at обновляются ТОЛЬКО если сообщение не старее текущего
--     (монотонность при конкурентных отправках);
--   • счётчики непрочитанных инкрементятся всегда (SQL-выражением, без
--     read-modify-write гонки); assistant инкрементит ОБОИХ.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tsc_post_message(
  _conversation_id uuid,
  _sender_role text,
  _author_user_id uuid,
  _content text,
  _attachment_url text,
  _client_msg_id uuid,
  _preview text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.tutor_student_chat_messages%ROWTYPE;
BEGIN
  INSERT INTO public.tutor_student_chat_messages
    (conversation_id, sender_role, author_user_id, content, attachment_url, client_msg_id)
  VALUES
    (_conversation_id, _sender_role, _author_user_id, _content, _attachment_url, _client_msg_id)
  ON CONFLICT (conversation_id, client_msg_id) WHERE client_msg_id IS NOT NULL
  DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    -- Дедуп (retry той же отправки): вернуть существующую строку без денорма.
    SELECT * INTO v_row
    FROM public.tutor_student_chat_messages
    WHERE conversation_id = _conversation_id AND client_msg_id = _client_msg_id;
    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'TSC_POST_CONFLICT_LOST';
    END IF;
    RETURN jsonb_build_object('message', to_jsonb(v_row), 'deduped', true);
  END IF;

  UPDATE public.tutor_student_conversations
  SET last_message_preview = CASE
        WHEN last_message_at IS NULL OR v_row.created_at >= last_message_at
          THEN _preview ELSE last_message_preview END,
      last_message_sender = CASE
        WHEN last_message_at IS NULL OR v_row.created_at >= last_message_at
          THEN _sender_role ELSE last_message_sender END,
      last_message_at = GREATEST(COALESCE(last_message_at, v_row.created_at), v_row.created_at),
      tutor_unread_count = CASE
        WHEN _sender_role IN ('student','assistant') THEN tutor_unread_count + 1
        ELSE tutor_unread_count END,
      student_unread_count = CASE
        WHEN _sender_role IN ('tutor','assistant') THEN student_unread_count + 1
        ELSE student_unread_count END
  WHERE id = _conversation_id;

  RETURN jsonb_build_object('message', to_jsonb(v_row), 'deduped', false);
END;
$$;

REVOKE ALL ON FUNCTION public.tsc_post_message(uuid, text, uuid, text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tsc_post_message(uuid, text, uuid, text, text, uuid, text) TO service_role;
