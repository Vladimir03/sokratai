
-- ─── Feature 4: Attempts / Retries ───────────────────────────────
ALTER TABLE public.homework_tutor_submissions
  ADD COLUMN IF NOT EXISTS attempt_no INT NOT NULL DEFAULT 1;

ALTER TABLE public.homework_tutor_submissions
  DROP CONSTRAINT IF EXISTS homework_tutor_submissions_assignment_student_unique;

ALTER TABLE public.homework_tutor_submissions
  ADD CONSTRAINT homework_tutor_submissions_attempt_unique
  UNIQUE (assignment_id, student_id, attempt_no);

CREATE INDEX IF NOT EXISTS idx_hw_tutor_submissions_latest_attempt
  ON public.homework_tutor_submissions(assignment_id, student_id, attempt_no DESC);

-- ─── Feature 3: Delivery tracking ────────────────────────────────
ALTER TABLE public.homework_tutor_student_assignments
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS delivery_error_code TEXT NULL;

-- ─── Feature 8: Rubric per task ──────────────────────────────────
ALTER TABLE public.homework_tutor_tasks
  ADD COLUMN IF NOT EXISTS rubric_text TEXT NULL;

-- ─── Feature 1: Templates ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.homework_tutor_templates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  subject    TEXT NOT NULL CHECK (subject IN ('math', 'physics', 'history', 'social', 'english', 'cs')),
  topic      TEXT NULL,
  tags       TEXT[] NOT NULL DEFAULT '{}',
  tasks_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.homework_tutor_templates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'HW template select own' AND tablename = 'homework_tutor_templates') THEN
    CREATE POLICY "HW template select own" ON public.homework_tutor_templates FOR SELECT TO authenticated USING (tutor_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'HW template insert own' AND tablename = 'homework_tutor_templates') THEN
    CREATE POLICY "HW template insert own" ON public.homework_tutor_templates FOR INSERT TO authenticated WITH CHECK (tutor_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'HW template update own' AND tablename = 'homework_tutor_templates') THEN
    CREATE POLICY "HW template update own" ON public.homework_tutor_templates FOR UPDATE TO authenticated USING (tutor_id = auth.uid()) WITH CHECK (tutor_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'HW template delete own' AND tablename = 'homework_tutor_templates') THEN
    CREATE POLICY "HW template delete own" ON public.homework_tutor_templates FOR DELETE TO authenticated USING (tutor_id = auth.uid());
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_hw_tutor_templates_tutor
  ON public.homework_tutor_templates(tutor_id, subject);

-- ─── Feature 2: Materials ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.homework_tutor_materials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES public.homework_tutor_assignments(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('pdf', 'image', 'link')),
  storage_ref   TEXT NULL,
  url           TEXT NULL,
  title         TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hw_materials_storage_or_url CHECK (
    (type = 'link' AND url IS NOT NULL AND storage_ref IS NULL)
    OR (type IN ('pdf', 'image') AND storage_ref IS NOT NULL)
  )
);

ALTER TABLE public.homework_tutor_materials ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'HW materials select by tutor' AND tablename = 'homework_tutor_materials') THEN
    CREATE POLICY "HW materials select by tutor" ON public.homework_tutor_materials FOR SELECT TO authenticated USING (public.is_assignment_tutor(assignment_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'HW materials insert by tutor' AND tablename = 'homework_tutor_materials') THEN
    CREATE POLICY "HW materials insert by tutor" ON public.homework_tutor_materials FOR INSERT TO authenticated WITH CHECK (public.is_assignment_tutor(assignment_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'HW materials delete by tutor' AND tablename = 'homework_tutor_materials') THEN
    CREATE POLICY "HW materials delete by tutor" ON public.homework_tutor_materials FOR DELETE TO authenticated USING (public.is_assignment_tutor(assignment_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'HW materials select by assigned student' AND tablename = 'homework_tutor_materials') THEN
    CREATE POLICY "HW materials select by assigned student" ON public.homework_tutor_materials FOR SELECT TO authenticated USING (
      public.is_assignment_student(assignment_id) AND EXISTS (
        SELECT 1 FROM public.homework_tutor_assignments a WHERE a.id = homework_tutor_materials.assignment_id AND a.status IN ('active', 'closed')
      )
    );
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_hw_tutor_materials_assignment
  ON public.homework_tutor_materials(assignment_id);

-- Storage bucket for materials
INSERT INTO storage.buckets (id, name, public)
VALUES ('homework-materials', 'homework-materials', false)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'HW materials upload by tutor owner') THEN
    CREATE POLICY "HW materials upload by tutor owner" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'homework-materials' AND owner = auth.uid());
  END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'HW materials read authenticated') THEN
    CREATE POLICY "HW materials read authenticated" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'homework-materials');
  END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'HW materials delete by owner') THEN
    CREATE POLICY "HW materials delete by owner" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'homework-materials' AND owner = auth.uid());
  END IF;
END$$;

-- ─── Feature 5: Reminder log ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.homework_tutor_reminder_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES public.homework_tutor_assignments(id) ON DELETE CASCADE,
  student_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL CHECK (reminder_type IN ('24h', '1h', 'manual')),
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hw_reminder_log_unique UNIQUE (assignment_id, student_id, reminder_type)
);

ALTER TABLE public.homework_tutor_reminder_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'HW reminder log service only' AND tablename = 'homework_tutor_reminder_log') THEN
    CREATE POLICY "HW reminder log service only" ON public.homework_tutor_reminder_log FOR ALL TO authenticated USING (false) WITH CHECK (false);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_hw_reminder_log_assignment_student
  ON public.homework_tutor_reminder_log(assignment_id, student_id);
