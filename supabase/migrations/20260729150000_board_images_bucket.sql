-- Картинки на доске (Фаза 2а, W2.1.1). Bucket + storage-RLS.
--
-- ⚠️ Lovable-quirk (rule 100): INSERT INTO storage.buckets в миграции НЕ
-- применяется — bucket создаётся ВРУЧНУЮ в дашборде (или агентом Lovable),
-- с параметрами ниже. INSERT оставлен как документация намерения и для
-- локальных/чистых сред, где он работает. ПОЛИТИКИ применяются нормально.
--
-- Параметры бакета: private, file_size_limit = 10 МБ (клиент жмёт до ~4 МБ
-- через compressForUpload, лимит — страховка), mime image/*.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'board-images',
  'board-images',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Путь: tutor/{auth.uid()}/{boardId}/{fileId}.jpg — зеркало модели
-- lesson-materials (миграция 20260602140100). Владелец пути = загрузивший.
-- Студенческий upload появится в Фазе 2б отдельным путём student/{uid}/...
-- и пойдёт через edge (право «мел» проверяет сервер, не storage-политика).

DROP POLICY IF EXISTS "board-images tutor insert own" ON storage.objects;
CREATE POLICY "board-images tutor insert own"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'board-images'
    AND (storage.foldername(name))[1] = 'tutor'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "board-images tutor read own" ON storage.objects;
CREATE POLICY "board-images tutor read own"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'board-images'
    AND (storage.foldername(name))[1] = 'tutor'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "board-images tutor delete own" ON storage.objects;
CREATE POLICY "board-images tutor delete own"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'board-images'
    AND (storage.foldername(name))[1] = 'tutor'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );
