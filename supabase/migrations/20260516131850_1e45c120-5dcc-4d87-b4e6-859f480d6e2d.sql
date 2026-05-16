BEGIN;

ALTER TABLE public.mock_exam_variants
  ADD COLUMN IF NOT EXISTS variant_pdf_url TEXT NULL;

COMMENT ON COLUMN public.mock_exam_variants.variant_pdf_url IS
  'Public URL на PDF с задачами варианта (storage://mock-exam-variant-pdfs/...). Ученик скачивает в начале пробника. NULL = нет PDF для этого варианта; UI скрывает кнопку download.';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'mock-exam-variant-pdfs',
  'mock-exam-variant-pdfs',
  true,
  10485760,
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='mock_exam_variant_pdfs_public_read') THEN
    CREATE POLICY "mock_exam_variant_pdfs_public_read"
      ON storage.objects FOR SELECT TO public
      USING (bucket_id = 'mock-exam-variant-pdfs');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='mock_exam_variant_pdfs_service_role_write') THEN
    CREATE POLICY "mock_exam_variant_pdfs_service_role_write"
      ON storage.objects FOR INSERT TO service_role
      WITH CHECK (bucket_id = 'mock-exam-variant-pdfs');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='mock_exam_variant_pdfs_service_role_update') THEN
    CREATE POLICY "mock_exam_variant_pdfs_service_role_update"
      ON storage.objects FOR UPDATE TO service_role
      USING (bucket_id = 'mock-exam-variant-pdfs');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='mock_exam_variant_pdfs_service_role_delete') THEN
    CREATE POLICY "mock_exam_variant_pdfs_service_role_delete"
      ON storage.objects FOR DELETE TO service_role
      USING (bucket_id = 'mock-exam-variant-pdfs');
  END IF;
END $$;

COMMIT;