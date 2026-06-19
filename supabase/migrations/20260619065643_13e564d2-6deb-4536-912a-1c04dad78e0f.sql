-- 20260618120000_tutor_groups_primary_and_tags.sql
-- Additive migration: primary group flag + tags support.

ALTER TABLE public.tutor_groups
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT true;

DROP INDEX IF EXISTS public.idx_tutor_group_memberships_active_student_unique;

CREATE OR REPLACE FUNCTION public.tutor_group_memberships_single_primary_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_primary boolean;
  _conflict_count int;
BEGIN
  IF NEW.is_active IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  SELECT g.is_primary INTO _is_primary
  FROM public.tutor_groups g
  WHERE g.id = NEW.tutor_group_id;

  IF _is_primary IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO _conflict_count
  FROM public.tutor_group_memberships m
  JOIN public.tutor_groups g ON g.id = m.tutor_group_id
  WHERE m.tutor_student_id = NEW.tutor_student_id
    AND m.is_active = true
    AND g.is_primary = true
    AND m.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF _conflict_count > 0 THEN
    RAISE EXCEPTION 'student already has an active primary group'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tutor_group_memberships_single_primary_guard
  ON public.tutor_group_memberships;

CREATE TRIGGER tutor_group_memberships_single_primary_guard
BEFORE INSERT OR UPDATE ON public.tutor_group_memberships
FOR EACH ROW
EXECUTE FUNCTION public.tutor_group_memberships_single_primary_guard();

NOTIFY pgrst, 'reload schema';
