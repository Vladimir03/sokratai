-- Mock Exams v1 — Storage buckets (TASK-2 prerequisite for seed).
--
-- Создаём 4 bucket-а сразу — TASK-4/TASK-12 не понадобится отдельная миграция:
--   1. mock-exam-variant-tasks (private) — картинки задач варианта (графики, схемы).
--      Default fallback для parseStorageRef в supabase/functions/mock-exam-public/
--      (TASK-6, см. CLAUDE.md §10).
--   2. mock-exam-blanks (private) — фото заполненного бланка от ученика
--      (бланк-режим). TASK-12 path: {studentId}/{attemptId}/blank-{uuid}.{ext}.
--   3. mock-exam-part2-photos (private) — фото решений Части 2 от ученика.
--      TASK-12 path: {studentId}/{attemptId}/{kim}/{uuid}.{ext}.
--   4. mock-exam-blank-templates (public-read) — PDF templates бланка ФИПИ для
--      скачивания учеником. Без PII, public OK.
--
-- Vladimir загружает variant images + blank PDF template через Lovable Cloud
-- Studio UI. Student photos uploads — через edge function под service_role.
-- RLS policies ниже защищают direct PostgREST/Storage API доступ.
--
-- Spec: docs/delivery/features/mock-exams-v1/spec.md §3.1 (бланк-режим default)
-- Tasks: docs/delivery/features/mock-exams-v1/tasks.md (TASK-12 Storage paths §216-217)

-- =====================================================================
-- 1. mock-exam-variant-tasks — приватные task images per variant
-- =====================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('mock-exam-variant-tasks', 'mock-exam-variant-tasks', false)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- Authenticated read: любой залогиненный tutor/student может читать (через
-- signed URL). Содержание задач не PII; защита от crawling — signed URL TTL.
CREATE POLICY "Mock variant tasks authenticated read"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'mock-exam-variant-tasks');

-- Write — только service_role (Lovable Studio UI / edge functions).

-- =====================================================================
-- 2. mock-exam-blanks — фото заполненного бланка ученика (private)
-- =====================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('mock-exam-blanks', 'mock-exam-blanks', false)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- Path convention: {studentId}/{attemptId}/blank-{uuid}.{ext}
-- foldername(name)[1] == auth.uid()::text gates ownership.
CREATE POLICY "Mock blanks student upload own"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'mock-exam-blanks'
    AND owner = auth.uid()
    AND COALESCE(array_length(storage.foldername(name), 1), 0) >= 2
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Mock blanks student read own"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'mock-exam-blanks'
    AND COALESCE(array_length(storage.foldername(name), 1), 0) >= 2
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Tutor reads через signed URLs из edge function под service_role (bypass RLS).

-- =====================================================================
-- 3. mock-exam-part2-photos — фото решений Части 2 (private)
-- =====================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('mock-exam-part2-photos', 'mock-exam-part2-photos', false)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

CREATE POLICY "Mock part2 photos student upload own"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'mock-exam-part2-photos'
    AND owner = auth.uid()
    AND COALESCE(array_length(storage.foldername(name), 1), 0) >= 3
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Mock part2 photos student read own"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'mock-exam-part2-photos'
    AND COALESCE(array_length(storage.foldername(name), 1), 0) >= 3
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- =====================================================================
-- 4. mock-exam-blank-templates — PDF templates бланка ФИПИ (public-read)
-- =====================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('mock-exam-blank-templates', 'mock-exam-blank-templates', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- public=true → anonymous SELECT через
-- https://<project>.supabase.co/storage/v1/object/public/mock-exam-blank-templates/<file>
-- Содержимое — публичные PDF без PII; дополнительные policies не нужны.
