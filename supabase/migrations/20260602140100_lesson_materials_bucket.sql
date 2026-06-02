-- =============================================================================
-- schedule-materials P0 — lesson-materials Storage bucket (TASK-1)
-- Spec: docs/delivery/features/schedule-materials/spec.md §5.2
--
-- PDF notes only. Path: tutor/{auth.uid()}/{lessonId}/{uuid}.pdf
--   → (storage.foldername(name))[1] = 'tutor', [2] = auth.uid()::text.
-- Tutor CRUD own folder; NO student policy — students never read the bucket
-- directly. PDFs are served to students via signed URL from student-lessons-api
-- (public=false enforces this). Pattern: 20260313120000_kb_attachments_bucket.sql,
-- extended to the tutor/{uid}/… two-segment scope.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('lesson-materials', 'lesson-materials', false, 20971520, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Tutor uploads under their own folder.
CREATE POLICY "lesson-materials tutor upload own"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'lesson-materials'
    AND (storage.foldername(name))[1] = 'tutor'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- Tutor reads own folder (defense-in-depth; students get signed URLs from the edge).
CREATE POLICY "lesson-materials tutor read own"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'lesson-materials'
    AND (storage.foldername(name))[1] = 'tutor'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- Tutor updates own folder.
CREATE POLICY "lesson-materials tutor update own"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'lesson-materials'
    AND (storage.foldername(name))[1] = 'tutor'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- Tutor deletes own folder (the edge also deletes via service_role on DELETE material).
CREATE POLICY "lesson-materials tutor delete own"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'lesson-materials'
    AND (storage.foldername(name))[1] = 'tutor'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );
