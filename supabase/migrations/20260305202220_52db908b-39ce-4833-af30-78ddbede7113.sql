
-- Apply key pending migrations (idempotent)

-- Block A: max_attempts, nullable telegram_chat_id, group_id, index
ALTER TABLE public.homework_tutor_assignments
  ADD COLUMN IF NOT EXISTS max_attempts INT NOT NULL DEFAULT 3;

ALTER TABLE public.homework_tutor_submissions
  ALTER COLUMN telegram_chat_id DROP NOT NULL;

ALTER TABLE public.homework_tutor_assignments
  ADD COLUMN IF NOT EXISTS group_id UUID NULL REFERENCES public.tutor_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_hw_student_assignments_student_id
  ON public.homework_tutor_student_assignments(student_id);

-- Homework Builder: answer_type column
ALTER TABLE public.homework_tutor_submission_items
  ADD COLUMN IF NOT EXISTS answer_type TEXT NULL
    CHECK (answer_type IN ('text', 'image', 'pdf'));

-- Validation trigger (updated version without max_attempts column reference)
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

-- Homework-submissions bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('homework-submissions', 'homework-submissions', false)
ON CONFLICT (id) DO NOTHING;

-- Scoped upload policy for homework-submissions
DROP POLICY IF EXISTS "HW student submissions upload" ON storage.objects;
DROP POLICY IF EXISTS "HW submissions upload scoped" ON storage.objects;

CREATE POLICY "HW submissions upload scoped"
  ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'homework-submissions'
    AND auth.uid() IS NOT NULL
    AND COALESCE(array_length(storage.foldername(name), 1), 0) >= 2
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND EXISTS (
      SELECT 1
      FROM public.homework_tutor_student_assignments hsa
      JOIN public.homework_tutor_assignments a ON a.id = hsa.assignment_id
      WHERE hsa.student_id = auth.uid()
        AND hsa.assignment_id::text = (storage.foldername(name))[2]
        AND a.status IN ('active', 'closed')
    )
  );

-- Scoped read policy for homework-submissions
DROP POLICY IF EXISTS "HW student submissions read" ON storage.objects;
DROP POLICY IF EXISTS "HW submissions read scoped" ON storage.objects;

CREATE POLICY "HW submissions read scoped"
  ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'homework-submissions'
    AND auth.uid() IS NOT NULL
    AND COALESCE(array_length(storage.foldername(name), 1), 0) >= 2
    AND (
      (
        (storage.foldername(name))[1] = auth.uid()::text
        AND EXISTS (
          SELECT 1
          FROM public.homework_tutor_student_assignments hsa
          JOIN public.homework_tutor_assignments a ON a.id = hsa.assignment_id
          WHERE hsa.student_id = auth.uid()
            AND hsa.assignment_id::text = (storage.foldername(name))[2]
            AND a.status IN ('active', 'closed')
        )
      )
      OR EXISTS (
        SELECT 1
        FROM public.homework_tutor_assignments a
        WHERE a.id::text = (storage.foldername(name))[2]
          AND a.tutor_id = auth.uid()
      )
    )
  );

-- CRITICAL FIX: Allow assigned students to READ task images from homework-task-images bucket
-- Currently only tutors can read their own folder. Students need to see task condition images.
DROP POLICY IF EXISTS "HW task images student read" ON storage.objects;

CREATE POLICY "HW task images student read"
  ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'homework-task-images'
    AND EXISTS (
      SELECT 1
      FROM public.homework_tutor_tasks t
      JOIN public.homework_tutor_student_assignments sa ON sa.assignment_id = t.assignment_id
      WHERE sa.student_id = auth.uid()
        AND t.task_image_url IS NOT NULL
    )
  );
