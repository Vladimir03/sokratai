-- Mock Exams v1 — PDF задач варианта (download for students)
-- ----------------------------------------------------------------------
-- Pilot polish Phase 2 (Vladimir feedback 2026-05-14):
-- Ученик хочет скачать задачи варианта как PDF чтобы решать «как на
-- настоящем ЕГЭ» (на распечатке вместо экрана). Добавляем:
--   1. mock_exam_variants.variant_pdf_url — public URL на PDF
--   2. Storage bucket `mock-exam-variant-pdfs` (public-read)
--
-- PDF файл загружается отдельно Vladimir-ом через Lovable Studio
-- (см. spec.md §7 Rollout). Эта миграция только добавляет колонку
-- и bucket; UPDATE variant_pdf_url для variant 1 — отдельная
-- миграция 20260514130200_variant1_pdf_backfill.sql.
--
-- Idempotent.

BEGIN;

-- ============================================================
-- 1. Колонка variant_pdf_url
-- ============================================================
ALTER TABLE public.mock_exam_variants
  ADD COLUMN IF NOT EXISTS variant_pdf_url TEXT NULL;

COMMENT ON COLUMN public.mock_exam_variants.variant_pdf_url IS
  'Public URL на PDF с задачами варианта (storage://mock-exam-variant-pdfs/...). Ученик скачивает в начале пробника. NULL = нет PDF для этого варианта; UI скрывает кнопку download.';

-- ============================================================
-- 2. Storage bucket для PDF задач (public-read)
-- ============================================================
-- Bucket публичный по дизайну — PDF с задачами не sensitive content
-- (ответы и solution_text всё равно tutor-only через RLS на таблицах).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'mock-exam-variant-pdfs',
  'mock-exam-variant-pdfs',
  true,
  10485760,  -- 10 MB cap
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- RLS policies для public read; write только service_role.
CREATE POLICY "mock_exam_variant_pdfs_public_read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'mock-exam-variant-pdfs');

CREATE POLICY "mock_exam_variant_pdfs_service_role_write"
  ON storage.objects FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'mock-exam-variant-pdfs');

CREATE POLICY "mock_exam_variant_pdfs_service_role_update"
  ON storage.objects FOR UPDATE
  TO service_role
  USING (bucket_id = 'mock-exam-variant-pdfs');

CREATE POLICY "mock_exam_variant_pdfs_service_role_delete"
  ON storage.objects FOR DELETE
  TO service_role
  USING (bucket_id = 'mock-exam-variant-pdfs');

COMMIT;

-- Validation:
-- SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'mock-exam-variant-pdfs';
-- Expected: 1 row, public=true, file_size_limit=10485760.
--
-- SELECT COUNT(*) FROM pg_policies
-- WHERE tablename = 'objects' AND policyname LIKE 'mock_exam_variant_pdfs%';
-- Expected: 4 (1 public read + 3 service_role write/update/delete).
