-- ═══════════════════════════════════════════════════════════════════
-- Homework 2.0 Schema Changes
-- Sprint 2.0: templates, materials, delivery tracking, attempts,
--             reminder log, rubric per task
-- ═══════════════════════════════════════════════════════════════════

-- ─── Feature 4: Attempts / Retries ───────────────────────────────
-- Add attempt_no (default 1 so all existing rows get attempt_no = 1)
ALTER TABLE public.homework_tutor_submissions
  ADD COLUMN IF NOT EXISTS attempt_no INT NOT NULL DEFAULT 1;

-- Drop old unique that allowed only one submission per student
ALTER TABLE public.homework_tutor_submissions
  DROP CONSTRAINT IF EXISTS homework_tutor_submissions_assignment_student_unique;

-- New unique allows up to N attempts per student per assignment
ALTER TABLE public.homework_tutor_submissions
  ADD CONSTRAINT homework_tutor_submissions_attempt_unique
  UNIQUE (assignment_id, student_id, attempt_no);

-- Index for "get latest attempt" queries
CREATE INDEX IF NOT EXISTS idx_hw_tutor_submissions_latest_attempt
  ON public.homework_tutor_submissions(assignment_id, student_id, attempt_no DESC);

-- ─── Feature 3: Delivery tracking ────────────────────────────────
ALTER TABLE public.homework_tutor_student_assignments
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'delivered', 'failed_not_connected', 'failed_blocked_or_other')),
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

CREATE POLICY "HW template select own"
  ON public.homework_tutor_templates
  FOR SELECT TO authenticated
  USING (tutor_id = auth.uid());

CREATE POLICY "HW template insert own"
  ON public.homework_tutor_templates
  FOR INSERT TO authenticated
  WITH CHECK (tutor_id = auth.uid());

CREATE POLICY "HW template update own"
  ON public.homework_tutor_templates
  FOR UPDATE TO authenticated
  USING (tutor_id = auth.uid())
  WITH CHECK (tutor_id = auth.uid());

CREATE POLICY "HW template delete own"
  ON public.homework_tutor_templates
  FOR DELETE TO authenticated
  USING (tutor_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_hw_tutor_templates_tutor
  ON public.homework_tutor_templates(tutor_id, subject);

-- ─── Feature 2: Materials ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.homework_tutor_materials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES public.homework_tutor_assignments(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('pdf', 'image', 'link')),
  storage_ref   TEXT NULL,  -- storage://bucket/objectPath (pdf or image)
  url           TEXT NULL,  -- for type = 'link' (or signed URL cache, not canonical)
  title         TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hw_materials_storage_or_url CHECK (
    (type = 'link' AND url IS NOT NULL AND storage_ref IS NULL)
    OR (type IN ('pdf', 'image') AND storage_ref IS NOT NULL)
  )
);

ALTER TABLE public.homework_tutor_materials ENABLE ROW LEVEL SECURITY;

-- Tutor can CRUD materials for their own assignments
CREATE POLICY "HW materials select by tutor"
  ON public.homework_tutor_materials
  FOR SELECT TO authenticated
  USING (public.is_assignment_tutor(assignment_id));

CREATE POLICY "HW materials insert by tutor"
  ON public.homework_tutor_materials
  FOR INSERT TO authenticated
  WITH CHECK (public.is_assignment_tutor(assignment_id));

CREATE POLICY "HW materials delete by tutor"
  ON public.homework_tutor_materials
  FOR DELETE TO authenticated
  USING (public.is_assignment_tutor(assignment_id));

-- Students can read materials for their assigned active/closed assignments
CREATE POLICY "HW materials select by assigned student"
  ON public.homework_tutor_materials
  FOR SELECT TO authenticated
  USING (
    public.is_assignment_student(assignment_id)
    AND EXISTS (
      SELECT 1 FROM public.homework_tutor_assignments a
      WHERE a.id = homework_tutor_materials.assignment_id
        AND a.status IN ('active', 'closed')
    )
  );

CREATE INDEX IF NOT EXISTS idx_hw_tutor_materials_assignment
  ON public.homework_tutor_materials(assignment_id);

-- Storage bucket for materials (tutor-uploaded PDFs / images)
INSERT INTO storage.buckets (id, name, public)
VALUES ('homework-materials', 'homework-materials', false)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- Tutors can upload materials (path: materials/{tutor_id}/{uuid}.ext)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND schemaname = 'storage'
      AND policyname = 'HW materials upload by tutor owner'
  ) THEN
    CREATE POLICY "HW materials upload by tutor owner"
      ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'homework-materials'
        AND owner = auth.uid()
      );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND schemaname = 'storage'
      AND policyname = 'HW materials read authenticated'
  ) THEN
    -- Students access materials via signed URLs (generated server-side).
    -- Allow any authenticated user to read; signed URLs provide time-limited access.
    CREATE POLICY "HW materials read authenticated"
      ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'homework-materials');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND schemaname = 'storage'
      AND policyname = 'HW materials delete by owner'
  ) THEN
    CREATE POLICY "HW materials delete by owner"
      ON storage.objects
      FOR DELETE TO authenticated
      USING (bucket_id = 'homework-materials' AND owner = auth.uid());
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
-- Service role bypasses RLS. No user-facing access needed for this internal log.
-- Add a minimal policy so RLS doesn't silently block service role (it doesn't, but for clarity):
CREATE POLICY "HW reminder log service only"
  ON public.homework_tutor_reminder_log
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_hw_reminder_log_assignment_student
  ON public.homework_tutor_reminder_log(assignment_id, student_id);
