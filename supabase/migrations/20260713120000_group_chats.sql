-- ============================================================================
-- Групповые чаты — обобщение чата репетитор↔ученик (kind='group')
-- ============================================================================
-- Группа = учебная tutor_groups (is_primary=true). Членство чата НЕ копируется —
-- выводится ЖИВЬЁМ из tutor_group_memberships(is_active) + tutor_students
-- (archived_at IS NULL) внутри SECURITY DEFINER is_chat_conversation_member:
-- убрали из группы → мгновенно теряет доступ ко всей истории; добавили →
-- видит всю историю. tutor_chat_members — per-member СОСТОЯНИЕ (прочитано/
-- unread/троттлинг уведомлений), НЕ членство.
--
-- Direct-чаты продолжают жить на двухпартийных колонках (tutor_*/student_*) —
-- НЕ мигрируем (работают в проде); гибрид зафиксирован в rule 100.
-- План: ~/.claude/plans/virtual-giggling-duckling.md (решения владельца 2026-07-13).
-- ============================================================================

-- ── 1) tutor_student_conversations: kind + группа + автор последнего сообщения ──

ALTER TABLE public.tutor_student_conversations
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'direct'
    CHECK (kind IN ('direct', 'group'));

ALTER TABLE public.tutor_student_conversations
  ADD COLUMN IF NOT EXISTS tutor_group_id UUID NULL
    REFERENCES public.tutor_groups(id) ON DELETE CASCADE;

-- «Вы:» в превью списка групповых чатов (sender_role='student' не различает
-- учеников группы). Пишется тем же монотонным CASE, что и preview.
ALTER TABLE public.tutor_student_conversations
  ADD COLUMN IF NOT EXISTS last_message_author_user_id UUID NULL;

ALTER TABLE public.tutor_student_conversations
  ALTER COLUMN tutor_student_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_tsc_kind_target'
      AND conrelid = 'public.tutor_student_conversations'::regclass
  ) THEN
    ALTER TABLE public.tutor_student_conversations
      ADD CONSTRAINT chk_tsc_kind_target CHECK (
        (kind = 'direct' AND tutor_student_id IS NOT NULL AND tutor_group_id IS NULL) OR
        (kind = 'group'  AND tutor_group_id  IS NOT NULL AND tutor_student_id IS NULL)
      );
  END IF;
END $$;

-- НЕ partial: PostgREST upsert(onConflict:'tutor_group_id') генерит
-- ON CONFLICT (tutor_group_id) без WHERE — partial-индекс не инферится.
-- NULL'ы (direct-беседы) в UNIQUE не конфликтуют — обычного индекса достаточно.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tsc_group
  ON public.tutor_student_conversations (tutor_group_id);

-- ── 2) tutor_chat_members — per-member состояние (НЕ членство) ──────────────

CREATE TABLE IF NOT EXISTS public.tutor_chat_members (
  conversation_id UUID NOT NULL
    REFERENCES public.tutor_student_conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_read_at     TIMESTAMPTZ,
  unread_count     INTEGER NOT NULL DEFAULT 0,
  last_notified_at TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_id)
);

COMMENT ON TABLE public.tutor_chat_members IS
  'Per-member состояние групповых чатов (last_read_at/unread/троттлинг). НЕ источник членства — членство живьём из tutor_group_memberships. Записи только через edge tutor-student-chat-api (service_role).';

DROP TRIGGER IF EXISTS update_tcm_updated_at ON public.tutor_chat_members;
CREATE TRIGGER update_tcm_updated_at
  BEFORE UPDATE ON public.tutor_chat_members
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.tutor_chat_members ENABLE ROW LEVEL SECURITY;

-- Члены видят read-state друг друга — нужно для ✓✓ «прочитал хотя бы один».
DROP POLICY IF EXISTS "TCM select by member" ON public.tutor_chat_members;
CREATE POLICY "TCM select by member"
  ON public.tutor_chat_members FOR SELECT TO authenticated
  USING (public.is_chat_conversation_member(conversation_id));

REVOKE ALL ON public.tutor_chat_members FROM anon, authenticated;
GRANT SELECT ON public.tutor_chat_members TO authenticated;
GRANT ALL ON public.tutor_chat_members TO service_role;

-- Realtime: живые бейджи (user_id=eq.me в списке) + ✓✓ (conversation_id=eq.X
-- в открытой беседе). Идемпотентный guard — mirror 20260712150100.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'tutor_chat_members'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tutor_chat_members;
  END IF;
END $$;

-- ── 3) is_chat_conversation_member — ветка group (живое членство) ───────────

CREATE OR REPLACE FUNCTION public.is_chat_conversation_member(_conversation_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  -- direct: прежний JOIN (для групповых бесед tutor_student_id NULL → false).
  SELECT EXISTS (
    SELECT 1
    FROM public.tutor_student_conversations c
    JOIN public.tutor_students ts ON ts.id = c.tutor_student_id
    LEFT JOIN public.tutors t ON t.id = ts.tutor_id
    WHERE c.id = _conversation_id
      AND (ts.student_id = auth.uid() OR t.user_id = auth.uid())
  )
  -- group: репетитор-владелец ИЛИ активный не-архивный член группы (живьём).
  OR EXISTS (
    SELECT 1
    FROM public.tutor_student_conversations c
    JOIN public.tutor_groups g ON g.id = c.tutor_group_id
    LEFT JOIN public.tutors t ON t.id = g.tutor_id
    WHERE c.id = _conversation_id
      AND (
        t.user_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.tutor_group_memberships m
          JOIN public.tutor_students ms ON ms.id = m.tutor_student_id
          WHERE m.tutor_group_id = g.id
            AND m.is_active
            AND ms.student_id = auth.uid()
            AND ms.archived_at IS NULL
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_chat_conversation_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_chat_conversation_member(uuid) TO authenticated, service_role;

-- ── 4) tsc_post_message — ветка по kind (direct-путь = прежнее поведение) ───
-- group: денорм без двухпартийных счётчиков + fan-out unread в tutor_chat_members
-- (все текущие получатели, кроме автора; assistant → все) + watermark автора
-- (написал = прочитал). Мини-группы ≤ ~15 — fan-out тривиален в транзакции.

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
  v_kind text;
  v_group_id uuid;
BEGIN
  SELECT kind, tutor_group_id INTO v_kind, v_group_id
  FROM public.tutor_student_conversations
  WHERE id = _conversation_id;
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'TSC_CONVERSATION_NOT_FOUND';
  END IF;

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

  IF v_kind = 'group' THEN
    -- Денорм списка (монотонный preview/sender/author, как в direct).
    UPDATE public.tutor_student_conversations
    SET last_message_preview = CASE
          WHEN last_message_at IS NULL OR v_row.created_at >= last_message_at
            THEN _preview ELSE last_message_preview END,
        last_message_sender = CASE
          WHEN last_message_at IS NULL OR v_row.created_at >= last_message_at
            THEN _sender_role ELSE last_message_sender END,
        last_message_author_user_id = CASE
          WHEN last_message_at IS NULL OR v_row.created_at >= last_message_at
            THEN _author_user_id ELSE last_message_author_user_id END,
        last_message_at = GREATEST(COALESCE(last_message_at, v_row.created_at), v_row.created_at)
    WHERE id = _conversation_id;

    -- Fan-out unread всем ТЕКУЩИМ получателям (живое членство), кроме автора;
    -- assistant (_author_user_id NULL) инкрементит всех. Watermark-гард (ревью
    -- 5.6 р.2 #3): конкурентный markRead мог закоммититься с last_read_at >=
    -- created_at ДО fan-out — тогда сообщение уже «прочитано» и инкремент дал
    -- бы ложный бейдж 1.
    INSERT INTO public.tutor_chat_members (conversation_id, user_id, unread_count)
    SELECT _conversation_id, r.uid, 1
    FROM (
      SELECT t.user_id AS uid
      FROM public.tutor_groups g
      JOIN public.tutors t ON t.id = g.tutor_id
      WHERE g.id = v_group_id
      UNION
      SELECT ms.student_id
      FROM public.tutor_group_memberships m
      JOIN public.tutor_students ms ON ms.id = m.tutor_student_id
      WHERE m.tutor_group_id = v_group_id
        AND m.is_active
        AND ms.archived_at IS NULL
    ) r
    WHERE r.uid IS DISTINCT FROM _author_user_id
    ON CONFLICT (conversation_id, user_id)
    DO UPDATE SET unread_count = CASE
      WHEN public.tutor_chat_members.last_read_at IS NOT NULL
        AND public.tutor_chat_members.last_read_at >= v_row.created_at
        THEN public.tutor_chat_members.unread_count
      ELSE public.tutor_chat_members.unread_count + 1
    END;

    -- Watermark автора: написал = прочитал до этого момента.
    IF _author_user_id IS NOT NULL THEN
      INSERT INTO public.tutor_chat_members (conversation_id, user_id, last_read_at, unread_count)
      VALUES (_conversation_id, _author_user_id, v_row.created_at, 0)
      ON CONFLICT (conversation_id, user_id)
      DO UPDATE SET
        last_read_at = GREATEST(COALESCE(public.tutor_chat_members.last_read_at, EXCLUDED.last_read_at), EXCLUDED.last_read_at),
        unread_count = 0;
    END IF;
  ELSE
    -- direct: прежний денорм (двухпартийные счётчики) + author-колонка.
    UPDATE public.tutor_student_conversations
    SET last_message_preview = CASE
          WHEN last_message_at IS NULL OR v_row.created_at >= last_message_at
            THEN _preview ELSE last_message_preview END,
        last_message_sender = CASE
          WHEN last_message_at IS NULL OR v_row.created_at >= last_message_at
            THEN _sender_role ELSE last_message_sender END,
        last_message_author_user_id = CASE
          WHEN last_message_at IS NULL OR v_row.created_at >= last_message_at
            THEN _author_user_id ELSE last_message_author_user_id END,
        last_message_at = GREATEST(COALESCE(last_message_at, v_row.created_at), v_row.created_at),
        tutor_unread_count = CASE
          WHEN _sender_role IN ('student','assistant') THEN tutor_unread_count + 1
          ELSE tutor_unread_count END,
        student_unread_count = CASE
          WHEN _sender_role IN ('tutor','assistant') THEN student_unread_count + 1
          ELSE student_unread_count END
    WHERE id = _conversation_id;
  END IF;

  RETURN jsonb_build_object('message', to_jsonb(v_row), 'deduped', false);
END;
$$;

REVOKE ALL ON FUNCTION public.tsc_post_message(uuid, text, uuid, text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tsc_post_message(uuid, text, uuid, text, text, uuid, text) TO service_role;
