-- Homework Builder production hardening:
-- - enforce positive max_attempts
-- - restrict homework-submissions upload/read policies to assigned students and owning tutors

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'homework_tutor_assignments_max_attempts_positive'
      AND conrelid = 'public.homework_tutor_assignments'::regclass
  ) THEN
    ALTER TABLE public.homework_tutor_assignments
      ADD CONSTRAINT homework_tutor_assignments_max_attempts_positive
      CHECK (max_attempts > 0);
  END IF;
END$$;

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
