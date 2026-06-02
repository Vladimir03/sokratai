
-- ============ 20260602140000: tutor_lesson_materials ============
CREATE TABLE IF NOT EXISTS public.tutor_lesson_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id uuid NOT NULL REFERENCES public.tutors(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES public.tutor_lessons(id) ON DELETE CASCADE,
  group_session_id uuid NULL,
  material_kind text NOT NULL CHECK (material_kind IN ('recording', 'pdf', 'homework_ref')),
  url text NULL,
  homework_assignment_id uuid NULL
    REFERENCES public.homework_tutor_assignments(id) ON DELETE CASCADE,
  title text NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  CONSTRAINT chk_kind_payload CHECK (
    (material_kind = 'recording'    AND url IS NOT NULL) OR
    (material_kind = 'pdf'          AND url IS NOT NULL) OR
    (material_kind = 'homework_ref' AND homework_assignment_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_tlm_lesson  ON public.tutor_lesson_materials(lesson_id);
CREATE INDEX IF NOT EXISTS idx_tlm_session ON public.tutor_lesson_materials(group_session_id)
  WHERE group_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tlm_tutor   ON public.tutor_lesson_materials(tutor_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tlm_one_hw_per_lesson
  ON public.tutor_lesson_materials(lesson_id)
  WHERE material_kind = 'homework_ref';

CREATE OR REPLACE FUNCTION public.student_can_see_lesson(_lesson_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tutor_lessons l
    WHERE l.id = _lesson_id AND l.student_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.tutor_lesson_participants p
    WHERE p.lesson_id = _lesson_id AND p.student_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.student_can_see_lesson(uuid) TO authenticated;

ALTER TABLE public.tutor_lesson_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY tlm_tutor_select ON public.tutor_lesson_materials
  FOR SELECT TO authenticated
  USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

REVOKE ALL ON public.tutor_lesson_materials FROM anon, authenticated;
GRANT SELECT (
  id, lesson_id, group_session_id, material_kind, url,
  homework_assignment_id, title, sort_order, created_at
) ON public.tutor_lesson_materials TO authenticated;
GRANT ALL ON public.tutor_lesson_materials TO service_role;

COMMENT ON TABLE public.tutor_lesson_materials IS
  'schedule-materials: recording URL / PDF / homework_ref attached to a tutor_lessons row (or group via group_session_id). Read via service_role edge; RLS is defense-in-depth.';

-- ============ 20260602140200: tighten homework_ref student RLS ============
CREATE OR REPLACE FUNCTION public.student_assigned_to_homework(_assignment_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.homework_tutor_student_assignments sa
    WHERE sa.assignment_id = _assignment_id AND sa.student_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.student_assigned_to_homework(uuid) TO authenticated;

CREATE POLICY tlm_student_select ON public.tutor_lesson_materials
  FOR SELECT TO authenticated
  USING (
    public.student_can_see_lesson(lesson_id)
    AND (
      material_kind <> 'homework_ref'
      OR homework_assignment_id IS NULL
      OR public.student_assigned_to_homework(homework_assignment_id)
    )
  );

-- ============ 20260602140100: storage.objects policies for lesson-materials ============
-- (bucket itself is created via the storage_create_bucket tool)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='lesson-materials tutor upload own') THEN
    CREATE POLICY "lesson-materials tutor upload own"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'lesson-materials'
        AND (storage.foldername(name))[1] = 'tutor'
        AND (storage.foldername(name))[2] = auth.uid()::text
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='lesson-materials tutor read own') THEN
    CREATE POLICY "lesson-materials tutor read own"
      ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = 'lesson-materials'
        AND (storage.foldername(name))[1] = 'tutor'
        AND (storage.foldername(name))[2] = auth.uid()::text
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='lesson-materials tutor update own') THEN
    CREATE POLICY "lesson-materials tutor update own"
      ON storage.objects FOR UPDATE TO authenticated
      USING (
        bucket_id = 'lesson-materials'
        AND (storage.foldername(name))[1] = 'tutor'
        AND (storage.foldername(name))[2] = auth.uid()::text
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='lesson-materials tutor delete own') THEN
    CREATE POLICY "lesson-materials tutor delete own"
      ON storage.objects FOR DELETE TO authenticated
      USING (
        bucket_id = 'lesson-materials'
        AND (storage.foldername(name))[1] = 'tutor'
        AND (storage.foldername(name))[2] = auth.uid()::text
      );
  END IF;
END $$;
