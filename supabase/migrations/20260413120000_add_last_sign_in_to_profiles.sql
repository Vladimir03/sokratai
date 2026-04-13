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
