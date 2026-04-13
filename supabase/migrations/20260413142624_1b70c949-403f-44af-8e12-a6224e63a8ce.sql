-- Migration 1: Add last_sign_in_at to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz DEFAULT NULL;

CREATE OR REPLACE FUNCTION public.sync_last_sign_in()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NEW.last_sign_in_at IS DISTINCT FROM OLD.last_sign_in_at THEN
    UPDATE public.profiles
    SET last_sign_in_at = NEW.last_sign_in_at
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_sync_last_sign_in'
      AND tgrelid = 'auth.users'::regclass
  ) THEN
    CREATE TRIGGER trg_sync_last_sign_in
      AFTER UPDATE OF last_sign_in_at ON auth.users
      FOR EACH ROW
      EXECUTE FUNCTION public.sync_last_sign_in();
  END IF;
END
$$;

UPDATE public.profiles
SET last_sign_in_at = au.last_sign_in_at
FROM auth.users au
WHERE public.profiles.id = au.id
  AND au.last_sign_in_at IS NOT NULL;

-- Migration 2: get_students_real_email_flags RPC
CREATE OR REPLACE FUNCTION public.get_students_real_email_flags(student_ids uuid[])
RETURNS TABLE(student_id uuid, has_real_email boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN QUERY
  SELECT au.id AS student_id,
         (au.email IS NOT NULL AND au.email NOT LIKE '%@temp.sokratai.ru') AS has_real_email
  FROM auth.users au
  WHERE au.id = ANY(student_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.get_students_real_email_flags(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_students_real_email_flags(uuid[]) TO authenticated;