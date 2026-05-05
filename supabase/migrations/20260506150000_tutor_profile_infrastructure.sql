-- =============================================================================
-- Migration: Tutor Profile infrastructure (Phase 1, P0-1)
-- Spec:  docs/delivery/features/tutor-profile/spec.md (v0.2)
-- Tasks: docs/delivery/features/tutor-profile/tasks.md TASK-1
-- =============================================================================
-- What this migration does:
--   1. Creates public storage bucket 'avatars' (≤ 2 MB, jpeg/png/webp).
--   2. Adds path-scoped RLS policies on storage.objects for that bucket
--      (insert/update/delete restricted to owner's first-folder = auth.uid()).
--      SELECT policy не нужна — bucket public.
--   3. Adds nullable columns to profiles:
--        - avatar_url TEXT
--        - gender TEXT CHECK ('male'|'female')
--      (used by Phase 5 student-side avatars; columns added now to keep
--       migrations consolidated.)
--   4. Adds nullable column to tutors:
--        - gender TEXT CHECK ('male'|'female')
--      (avatar_url already exists from migration 20260117213552.)
--   5. Adds a new broad SELECT policy on tutors so any authenticated user
--      (i.e. students) can read tutor name/avatar/gender for the
--      guided-chat identity rendering. Old narrow SELECT policies stay
--      intact — PostgreSQL OR-combines permissive policies.
--
-- What this migration does NOT touch:
--   - Existing INSERT/UPDATE policies on tutors (already enforce
--     user_id = auth.uid(); UPDATE without explicit WITH CHECK uses USING
--     as WITH CHECK per Postgres semantics — equivalent to spec).
--   - RLS or policies on profiles, homework_tutor_*, kb_*, tutor_students.
--   - Storage bucket file_size_limit / mime types if 'avatars' already
--     exists (we use ON CONFLICT DO NOTHING per spec; re-apply config
--     manually via Dashboard if needed).
--
-- Idempotency: every block is guarded with IF NOT EXISTS / DO blocks
-- checking pg_policies. Safe to re-run.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Storage bucket: avatars (public, 2 MB cap, image/jpeg|png|webp only)
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  2097152,                                                    -- 2 * 1024 * 1024
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;


-- -----------------------------------------------------------------------------
-- 2. Storage policies for bucket 'avatars'
--    Path convention: avatars/<user_id>/<uuid>.jpg
--    Owner can write only into their own folder; reads are public via bucket.
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
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
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
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
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
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


-- -----------------------------------------------------------------------------
-- 3. profiles: avatar_url + gender (nullable, additive)
--    Used by Phase 5 (student avatars in tutor-side viewer). Added now to
--    avoid a second migration touching the same table later.
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS gender     TEXT CHECK (gender IN ('male', 'female'));


-- -----------------------------------------------------------------------------
-- 4. tutors: gender (nullable, additive)
--    avatar_url already exists from migration 20260117213552 — not touched.
-- -----------------------------------------------------------------------------
ALTER TABLE public.tutors
  ADD COLUMN IF NOT EXISTS gender TEXT CHECK (gender IN ('male', 'female'));


-- -----------------------------------------------------------------------------
-- 5. tutors RLS: extend SELECT visibility for guided-chat avatars
--
--    Existing SELECT policies (kept intact):
--      - "Tutors can view own profile"           USING (auth.uid() = user_id)
--      - "Anyone can view tutor by booking_link" USING (booking_link IS NOT NULL)
--      - "Anyone can view tutor by invite_code"  USING (invite_code IS NOT NULL)
--
--    New broad SELECT for authenticated users (students need to render the
--    tutor's name + avatar + gender alongside the tutor's messages in
--    guided chat — see spec.md AC-4, AC-5, AC-6). PostgreSQL OR-combines
--    permissive SELECT policies, so adding this strictly extends visibility
--    without weakening any existing constraint on writes.
--
--    INSERT and UPDATE policies are NOT modified — existing policies
--    ("Tutors can insert own profile" / "Tutors can update own profile")
--    already enforce user_id = auth.uid(). Postgres uses USING as the
--    implicit WITH CHECK on UPDATE when the latter is omitted, so the
--    existing policy is functionally equivalent to spec requirement.
-- -----------------------------------------------------------------------------

-- ENABLE RLS is idempotent (no-op if already enabled by 20260117213552).
ALTER TABLE public.tutors ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'tutors'
      AND policyname = 'Authenticated can view tutor profiles'
  ) THEN
    CREATE POLICY "Authenticated can view tutor profiles"
      ON public.tutors FOR SELECT TO authenticated
      USING (true);
  END IF;
END$$;


-- -----------------------------------------------------------------------------
-- Notes for follow-up tasks
-- -----------------------------------------------------------------------------
-- TASK-2: tutorProfileApi will UPSERT ON CONFLICT (user_id) — tutors_user_id_unique
-- already exists (from 20260117213552), no extra index needed.
-- TASK-3/4: UserAvatar + AvatarUpload write to path 'avatars/<user_id>/<uuid>.jpg'
-- which the policies above gate.
-- TASK-7: handleGetThread will SELECT name, avatar_url, gender FROM tutors
-- — relies on the new "Authenticated can view tutor profiles" SELECT policy
--   (or service_role bypass; either works).
