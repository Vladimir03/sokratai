-- =============================================================================
-- Migration: Tutor Profile infrastructure (Phase 1, P0-1)
-- =============================================================================

-- 1. Storage bucket: avatars (public, 2 MB cap, image/jpeg|png|webp only)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- 2. Storage policies for bucket 'avatars'
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Avatars insert by owner folder'
  ) THEN
    CREATE POLICY "Avatars insert by owner folder"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Avatars update by owner folder'
  ) THEN
    CREATE POLICY "Avatars update by owner folder"
      ON storage.objects FOR UPDATE TO authenticated
      USING (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = auth.uid()::text
      )
      WITH CHECK (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Avatars delete by owner folder'
  ) THEN
    CREATE POLICY "Avatars delete by owner folder"
      ON storage.objects FOR DELETE TO authenticated
      USING (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END$$;

-- 3. profiles: avatar_url + gender (nullable, additive)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS gender     TEXT CHECK (gender IN ('male', 'female'));

-- 4. tutors: gender (nullable, additive)
ALTER TABLE public.tutors
  ADD COLUMN IF NOT EXISTS gender TEXT CHECK (gender IN ('male', 'female'));

-- 5. tutors RLS: extend SELECT visibility (will be reverted in next migration)
ALTER TABLE public.tutors ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tutors'
      AND policyname = 'Authenticated can view tutor profiles'
  ) THEN
    CREATE POLICY "Authenticated can view tutor profiles"
      ON public.tutors FOR SELECT TO authenticated
      USING (true);
  END IF;
END$$;

-- =============================================================================
-- Migration: Revert broad SELECT policy on tutors (security fix from review)
-- =============================================================================
DROP POLICY IF EXISTS "Authenticated can view tutor profiles" ON public.tutors;