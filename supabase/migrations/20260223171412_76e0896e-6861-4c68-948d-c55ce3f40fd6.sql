
-- Add mini_groups_enabled column to tutors table
ALTER TABLE public.tutors ADD COLUMN IF NOT EXISTS mini_groups_enabled boolean NOT NULL DEFAULT false;

-- Create tutor_groups table
CREATE TABLE IF NOT EXISTS public.tutor_groups (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tutor_id uuid NOT NULL REFERENCES public.tutors(id) ON DELETE CASCADE,
  name text NOT NULL,
  short_name text,
  color text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tutor_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tutors can manage their own groups"
  ON public.tutor_groups
  FOR ALL
  USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()))
  WITH CHECK (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

-- Create tutor_group_memberships table
CREATE TABLE IF NOT EXISTS public.tutor_group_memberships (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tutor_id uuid NOT NULL REFERENCES public.tutors(id) ON DELETE CASCADE,
  tutor_student_id uuid NOT NULL REFERENCES public.tutor_students(id) ON DELETE CASCADE,
  tutor_group_id uuid NOT NULL REFERENCES public.tutor_groups(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tutor_student_id, tutor_group_id)
);

ALTER TABLE public.tutor_group_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tutors can manage their own group memberships"
  ON public.tutor_group_memberships
  FOR ALL
  USING (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()))
  WITH CHECK (tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid()));

-- Trigger for updated_at on tutor_groups
CREATE TRIGGER update_tutor_groups_updated_at
  BEFORE UPDATE ON public.tutor_groups
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Trigger for updated_at on tutor_group_memberships
CREATE TRIGGER update_tutor_group_memberships_updated_at
  BEFORE UPDATE ON public.tutor_group_memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
