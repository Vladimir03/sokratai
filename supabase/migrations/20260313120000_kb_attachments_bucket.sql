-- KB Attachments: Storage bucket for task images in Knowledge Base
-- Path convention: {auth.uid()}/{uuid}.{ext}

INSERT INTO storage.buckets (id, name, public)
VALUES ('kb-attachments', 'kb-attachments', false)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- Tutor can upload under own folder
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND schemaname = 'storage'
      AND policyname = 'KB attachments upload own'
  ) THEN
    CREATE POLICY "KB attachments upload own"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'kb-attachments'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END $$;

-- All authenticated users can read (students need access for homework display)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND schemaname = 'storage'
      AND policyname = 'KB attachments read auth'
  ) THEN
    CREATE POLICY "KB attachments read auth"
      ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'kb-attachments');
  END IF;
END $$;

-- Owner can update own files (replace image)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND schemaname = 'storage'
      AND policyname = 'KB attachments update own'
  ) THEN
    CREATE POLICY "KB attachments update own"
      ON storage.objects FOR UPDATE TO authenticated
      USING (
        bucket_id = 'kb-attachments'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END $$;

-- Owner can delete own files
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND schemaname = 'storage'
      AND policyname = 'KB attachments delete own'
  ) THEN
    CREATE POLICY "KB attachments delete own"
      ON storage.objects FOR DELETE TO authenticated
      USING (
        bucket_id = 'kb-attachments'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END $$;
