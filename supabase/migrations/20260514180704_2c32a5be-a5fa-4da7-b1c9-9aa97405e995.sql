-- Migration 1: 20260514130000_attempt_answer_method.sql
BEGIN;

ALTER TABLE public.mock_exam_attempts
  ADD COLUMN IF NOT EXISTS answer_method TEXT NULL
    CHECK (answer_method IS NULL OR answer_method IN ('blank', 'form'));

COMMENT ON COLUMN public.mock_exam_attempts.answer_method IS
  'Выбор способа ответа для Части 1 (per-attempt, выбирает сам ученик в UI). NULL = ещё не выбрал (modal появится). blank = ФИПИ бланк от руки + фото; form = цифровой ввод inputs. Не путать с assignment.mode (tutor info + manual_entry flow).';

ALTER TABLE public.mock_exam_attempts
  ADD COLUMN IF NOT EXISTS part1_blank_photo_url TEXT NULL;

COMMENT ON COLUMN public.mock_exam_attempts.part1_blank_photo_url IS
  'Optional fallback: ученик загрузил фото своих ответов Часть 1 в свободной форме (не на ФИПИ бланке). Single ref storage://mock-exam-blanks/{userId}/{attemptId}/part1-{uuid}.ext. Отдельно от blank_photo_url (=ФИПИ бланк) чтобы tutor мог различить.';

ALTER TABLE public.mock_exam_attempts
  ADD COLUMN IF NOT EXISTS part2_bulk_photo_urls TEXT NULL;

COMMENT ON COLUMN public.mock_exam_attempts.part2_bulk_photo_urls IS
  'Optional bulk upload фото решений Части 2 — single ref OR JSON-array string (dual-format invariant как task_image_url). До 7 фото. Не заменяет per-task `mock_exam_attempt_part2_solutions.photo_url` — tutor видит оба пути в review.';

UPDATE public.mock_exam_attempts a
SET answer_method = CASE
  WHEN asg.mode = 'blank' THEN 'blank'
  WHEN asg.mode = 'form' THEN 'form'
  ELSE NULL
END
FROM public.mock_exam_assignments asg
WHERE a.assignment_id = asg.id
  AND a.answer_method IS NULL
  AND asg.mode IN ('blank', 'form');

COMMIT;

-- Migration 2: 20260514130100_mock_exam_variant_pdf.sql
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
      ON storage.objects FOR SELECT
      TO public
      USING (bucket_id = 'mock-exam-variant-pdfs');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='mock_exam_variant_pdfs_service_role_write') THEN
    CREATE POLICY "mock_exam_variant_pdfs_service_role_write"
      ON storage.objects FOR INSERT
      TO service_role
      WITH CHECK (bucket_id = 'mock-exam-variant-pdfs');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='mock_exam_variant_pdfs_service_role_update') THEN
    CREATE POLICY "mock_exam_variant_pdfs_service_role_update"
      ON storage.objects FOR UPDATE
      TO service_role
      USING (bucket_id = 'mock-exam-variant-pdfs');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='mock_exam_variant_pdfs_service_role_delete') THEN
    CREATE POLICY "mock_exam_variant_pdfs_service_role_delete"
      ON storage.objects FOR DELETE
      TO service_role
      USING (bucket_id = 'mock-exam-variant-pdfs');
  END IF;
END $$;

COMMIT;