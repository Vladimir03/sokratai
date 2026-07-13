-- ============================================================================
-- Фикс: рекурсия RLS-политики бакета tutor-chat-uploads (баг превью 2026-07-13)
-- ============================================================================
-- Count-подзапрос к storage.objects ВНУТРИ INSERT-политики на storage.objects
-- (кап 300 объектов/беседу из ревью 5.6) вызывает Postgres 42P17 «infinite
-- recursion detected in policy» → storage-api отдавал 400
-- DatabaseInvalidObjectDefinition на КАЖДЫЙ upload — фото в чат не отправлялись.
--
-- Лечение (стандартный паттерн): счётчик выносим в SECURITY DEFINER-хелпер —
-- он выполняется от владельца (bypass RLS) → политика не ре-входит в саму себя.
-- Семантика капа не меняется: 300 объектов на папку беседы.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tsc_chat_upload_count(_conversation_folder text)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int
  FROM storage.objects
  WHERE bucket_id = 'tutor-chat-uploads'
    AND name LIKE _conversation_folder || '/%';
$$;

REVOKE ALL ON FUNCTION public.tsc_chat_upload_count(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tsc_chat_upload_count(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "tutor-chat-uploads member upload own" ON storage.objects;
CREATE POLICY "tutor-chat-uploads member upload own"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'tutor-chat-uploads'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND public.is_chat_conversation_member(((storage.foldername(name))[1])::uuid)
    AND public.tsc_chat_upload_count((storage.foldername(name))[1]) < 300
  );
