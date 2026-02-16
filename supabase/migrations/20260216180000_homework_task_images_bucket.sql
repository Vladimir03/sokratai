-- Sprint L2: Storage bucket for tutor homework task images
-- Path convention: tutor/{auth.uid()}/{uuid}.{ext}

INSERT INTO storage.buckets (id, name, public)
VALUES ('homework-task-images', 'homework-task-images', false)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- Policy: tutor can upload task images under their own folder
CREATE POLICY "HW task images upload own"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'homework-task-images'
  AND (storage.foldername(name))[1] = 'tutor'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- Policy: tutor can read their own task images
CREATE POLICY "HW task images read own"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'homework-task-images'
  AND (storage.foldername(name))[1] = 'tutor'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- Policy: tutor can update their own task images
CREATE POLICY "HW task images update own"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'homework-task-images'
  AND (storage.foldername(name))[1] = 'tutor'
  AND (storage.foldername(name))[2] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'homework-task-images'
  AND (storage.foldername(name))[1] = 'tutor'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- Policy: tutor can delete their own task images
CREATE POLICY "HW task images delete own"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'homework-task-images'
  AND (storage.foldername(name))[1] = 'tutor'
  AND (storage.foldername(name))[2] = auth.uid()::text
);
