
-- 1. Add answer_type column to submission items
ALTER TABLE public.homework_tutor_submission_items
  ADD COLUMN IF NOT EXISTS answer_type TEXT NULL
    CHECK (answer_type IN ('text', 'image', 'pdf'));

-- 2. Server-side trigger: validate deadline and max_attempts on submission INSERT
CREATE OR REPLACE FUNCTION public.validate_homework_submission()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_deadline     TIMESTAMPTZ;
  v_max_attempts INT := 3;
  v_attempt_count INT;
BEGIN
  SELECT deadline
    INTO v_deadline
    FROM public.homework_tutor_assignments
   WHERE id = NEW.assignment_id;

  IF v_deadline IS NOT NULL AND now() > v_deadline THEN
    RAISE EXCEPTION 'DEADLINE_PASSED';
  END IF;

  SELECT COUNT(*)
    INTO v_attempt_count
    FROM public.homework_tutor_submissions
   WHERE assignment_id = NEW.assignment_id
     AND student_id = NEW.student_id;

  IF v_attempt_count >= v_max_attempts THEN
    RAISE EXCEPTION 'MAX_ATTEMPTS_REACHED';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_homework_submission
  ON public.homework_tutor_submissions;

CREATE TRIGGER trg_validate_homework_submission
  BEFORE INSERT ON public.homework_tutor_submissions
  FOR EACH ROW EXECUTE FUNCTION public.validate_homework_submission();

-- 3. homework-submissions bucket for student file uploads (images + PDFs)
INSERT INTO storage.buckets (id, name, public)
VALUES ('homework-submissions', 'homework-submissions', false)
ON CONFLICT (id) DO NOTHING;

-- Students can upload into their own folder ({student_id}/...)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND schemaname = 'storage'
      AND policyname = 'HW student submissions upload'
  ) THEN
    CREATE POLICY "HW student submissions upload"
      ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'homework-submissions'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END$$;

-- Authenticated users can read (signed URLs provide time-limited access)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND schemaname = 'storage'
      AND policyname = 'HW student submissions read'
  ) THEN
    CREATE POLICY "HW student submissions read"
      ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'homework-submissions');
  END IF;
END$$;
