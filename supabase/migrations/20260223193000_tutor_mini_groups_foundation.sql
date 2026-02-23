-- =============================================
-- PR-G1: Tutor mini-groups foundation (MVP UX-first)
-- Additive, backward-compatible schema changes only
-- =============================================

-- 1) Global feature toggle on tutor profile
ALTER TABLE public.tutors
ADD COLUMN IF NOT EXISTS mini_groups_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tutors.mini_groups_enabled IS
  'Feature toggle: enables mini-group UX for tutor cabinet';

-- 2) Group profiles
CREATE TABLE IF NOT EXISTS public.tutor_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id UUID NOT NULL REFERENCES public.tutors(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  short_name TEXT,
  color TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT tutor_groups_name_not_blank CHECK (char_length(trim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_tutor_groups_tutor_id
  ON public.tutor_groups(tutor_id);
CREATE INDEX IF NOT EXISTS idx_tutor_groups_tutor_active
  ON public.tutor_groups(tutor_id, is_active);

ALTER TABLE public.tutor_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tutors can view own groups"
  ON public.tutor_groups FOR SELECT
  USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

CREATE POLICY "Tutors can insert own groups"
  ON public.tutor_groups FOR INSERT
  WITH CHECK (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

CREATE POLICY "Tutors can update own groups"
  ON public.tutor_groups FOR UPDATE
  USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

CREATE POLICY "Tutors can delete own groups"
  ON public.tutor_groups FOR DELETE
  USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

DROP TRIGGER IF EXISTS update_tutor_groups_updated_at ON public.tutor_groups;
CREATE TRIGGER update_tutor_groups_updated_at
  BEFORE UPDATE ON public.tutor_groups
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tutor_groups TO authenticated;

-- 3) Memberships: one active group per tutor_student in MVP
CREATE TABLE IF NOT EXISTS public.tutor_group_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id UUID NOT NULL REFERENCES public.tutors(id) ON DELETE CASCADE,
  tutor_student_id UUID NOT NULL REFERENCES public.tutor_students(id) ON DELETE CASCADE,
  tutor_group_id UUID NOT NULL REFERENCES public.tutor_groups(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tutor_group_memberships_tutor_id
  ON public.tutor_group_memberships(tutor_id);
CREATE INDEX IF NOT EXISTS idx_tutor_group_memberships_student
  ON public.tutor_group_memberships(tutor_student_id);
CREATE INDEX IF NOT EXISTS idx_tutor_group_memberships_group
  ON public.tutor_group_memberships(tutor_group_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tutor_group_memberships_student_group_unique
  ON public.tutor_group_memberships(tutor_student_id, tutor_group_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tutor_group_memberships_active_student_unique
  ON public.tutor_group_memberships(tutor_student_id)
  WHERE is_active = true;

ALTER TABLE public.tutor_group_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tutors can view own group memberships"
  ON public.tutor_group_memberships FOR SELECT
  USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

CREATE POLICY "Tutors can insert own group memberships"
  ON public.tutor_group_memberships FOR INSERT
  WITH CHECK (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

CREATE POLICY "Tutors can update own group memberships"
  ON public.tutor_group_memberships FOR UPDATE
  USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

CREATE POLICY "Tutors can delete own group memberships"
  ON public.tutor_group_memberships FOR DELETE
  USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

DROP TRIGGER IF EXISTS update_tutor_group_memberships_updated_at ON public.tutor_group_memberships;
CREATE TRIGGER update_tutor_group_memberships_updated_at
  BEFORE UPDATE ON public.tutor_group_memberships
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tutor_group_memberships TO authenticated;
