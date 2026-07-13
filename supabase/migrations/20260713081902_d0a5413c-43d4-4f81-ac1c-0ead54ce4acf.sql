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