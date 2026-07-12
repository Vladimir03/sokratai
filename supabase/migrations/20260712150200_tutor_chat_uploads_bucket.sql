-- ============================================================================
-- Чат репетитор ↔ ученик — storage bucket для фото (M3)
-- ============================================================================
-- Новый ПРИВАТНЫЙ bucket: существующий chat-images не подходит — его SELECT
-- owner-folder-only (20251105145430), вторая сторона беседы не увидела бы фото.
-- Путь: {conversation_id}/{uploader_uid}/{fileId}.{ext}
--   → (storage.foldername(name))[1] = conversation_id, [2] = auth.uid().
-- Лимиты энфорсятся БАКЕТОМ (rule 98 паттерн): 10 МБ, только изображения.
-- Чтение: обе стороны беседы подписывают URL клиентом (createSignedUrl под
-- своим JWT → требует SELECT по RLS ниже; RU-safe через api.sokratai.ru).
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tutor-chat-uploads', 'tutor-chat-uploads', false, 10485760,
  ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif']
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Загрузка: только участник беседы, только в свою подпапку.
-- Кап 300 объектов на беседу (ревью 5.6 P1: без него участник мог заливать
-- неограниченно файлов по 10 МБ, не отправляя сообщений — storage-abuse).
-- COUNT по LIKE-префиксу сканирует строки только этого bucket'а — на пилотном
-- объёме дёшево; TTL-cleanup неприкреплённых объектов — follow-up.
DROP POLICY IF EXISTS "tutor-chat-uploads member upload own" ON storage.objects;
CREATE POLICY "tutor-chat-uploads member upload own"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'tutor-chat-uploads'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND public.is_chat_conversation_member(((storage.foldername(name))[1])::uuid)
    AND (
      SELECT count(*)
      FROM storage.objects o
      WHERE o.bucket_id = 'tutor-chat-uploads'
        AND o.name LIKE ((storage.foldername(name))[1] || '/%')
    ) < 300
  );

-- Чтение: любой участник беседы (нужно для createSignedUrl обеими сторонами).
DROP POLICY IF EXISTS "tutor-chat-uploads member read" ON storage.objects;
CREATE POLICY "tutor-chat-uploads member read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'tutor-chat-uploads'
    AND public.is_chat_conversation_member(((storage.foldername(name))[1])::uuid)
  );

-- Удаление: только загрузивший (чистка после неудачной отправки).
DROP POLICY IF EXISTS "tutor-chat-uploads uploader delete own" ON storage.objects;
CREATE POLICY "tutor-chat-uploads uploader delete own"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'tutor-chat-uploads'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND public.is_chat_conversation_member(((storage.foldername(name))[1])::uuid)
  );
