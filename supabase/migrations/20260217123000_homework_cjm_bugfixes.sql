-- Fix Sprint (CJM tutor homework):
-- 1) Ensure homework-task-images bucket and policies exist in a stable, idempotent way.
-- 2) Backfill legacy rows: assignments with linked students must be active for Telegram visibility.

-- Ensure bucket exists and stays private.
INSERT INTO storage.buckets (id, name, public)
VALUES ('homework-task-images', 'homework-task-images', false)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = EXCLUDED.public;

-- Recreate policies idempotently to avoid drift between environments.
DROP POLICY IF EXISTS "HW task images upload own" ON storage.objects;
DROP POLICY IF EXISTS "HW task images read own" ON storage.objects;
DROP POLICY IF EXISTS "HW task images update own" ON storage.objects;
DROP POLICY IF EXISTS "HW task images delete own" ON storage.objects;

CREATE POLICY "HW task images upload own"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'homework-task-images'
  AND (storage.foldername(name))[1] = 'tutor'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

CREATE POLICY "HW task images read own"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'homework-task-images'
  AND (storage.foldername(name))[1] = 'tutor'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

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

CREATE POLICY "HW task images delete own"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'homework-task-images'
  AND (storage.foldername(name))[1] = 'tutor'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- Backfill: if assignment has at least one linked student, it must be active.
-- This unblocks /homework visibility for already assigned students.
UPDATE public.homework_tutor_assignments AS a
SET status = 'active'
WHERE
  a.status = 'draft'
  AND EXISTS (
    SELECT 1
    FROM public.homework_tutor_student_assignments AS sa
    WHERE sa.assignment_id = a.id
  );
