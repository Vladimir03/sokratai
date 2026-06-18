
-- ============ 1) homework_folders ============
CREATE TABLE IF NOT EXISTS public.homework_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.homework_folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.homework_tutor_assignments
  ADD COLUMN IF NOT EXISTS folder_id UUID
  REFERENCES public.homework_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_homework_folders_tutor ON public.homework_folders(tutor_id);
CREATE INDEX IF NOT EXISTS idx_homework_folders_parent ON public.homework_folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_hw_assignments_folder ON public.homework_tutor_assignments(folder_id);

ALTER TABLE public.homework_folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "HW folders select own" ON public.homework_folders;
CREATE POLICY "HW folders select own" ON public.homework_folders
  FOR SELECT TO authenticated USING (tutor_id = auth.uid());
DROP POLICY IF EXISTS "HW folders insert own" ON public.homework_folders;
CREATE POLICY "HW folders insert own" ON public.homework_folders
  FOR INSERT TO authenticated WITH CHECK (tutor_id = auth.uid());
DROP POLICY IF EXISTS "HW folders update own" ON public.homework_folders;
CREATE POLICY "HW folders update own" ON public.homework_folders
  FOR UPDATE TO authenticated USING (tutor_id = auth.uid())
  WITH CHECK (tutor_id = auth.uid());
DROP POLICY IF EXISTS "HW folders delete own" ON public.homework_folders;
CREATE POLICY "HW folders delete own" ON public.homework_folders
  FOR DELETE TO authenticated USING (tutor_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.homework_folders TO authenticated;
GRANT ALL ON public.homework_folders TO service_role;

-- Helper used by guard trigger (migration 140000). Source migration referenced it; install here.
CREATE OR REPLACE FUNCTION public.homework_folder_owned_by(_folder_id UUID, _tutor_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.homework_folders
    WHERE id = _folder_id AND tutor_id = _tutor_id
  );
$$;

-- ============ 2) lesson_materials_multi_homework ============
DROP INDEX IF EXISTS public.uq_tlm_one_hw_per_lesson;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tlm_one_hw_pair_per_lesson
  ON public.tutor_lesson_materials (lesson_id, homework_assignment_id)
  WHERE material_kind = 'homework_ref';

-- ============ 3) tutor_students_archived_at ============
ALTER TABLE public.tutor_students
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL;
CREATE INDEX IF NOT EXISTS idx_tutor_students_tutor_active
  ON public.tutor_students(tutor_id)
  WHERE archived_at IS NULL;

-- ============ 4) homework_assignment_folder_owner_guard ============
CREATE OR REPLACE FUNCTION public.hw_assignment_folder_owner_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.folder_id IS NOT NULL
     AND NOT public.homework_folder_owned_by(NEW.folder_id, NEW.tutor_id) THEN
    RAISE EXCEPTION 'folder_id % does not belong to assignment owner', NEW.folder_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hw_assignment_folder_owner_guard ON public.homework_tutor_assignments;
CREATE TRIGGER trg_hw_assignment_folder_owner_guard
  BEFORE INSERT OR UPDATE OF folder_id ON public.homework_tutor_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.hw_assignment_folder_owner_guard();

NOTIFY pgrst, 'reload schema';
