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