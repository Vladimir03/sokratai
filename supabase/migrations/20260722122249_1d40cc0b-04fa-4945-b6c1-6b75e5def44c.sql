CREATE OR REPLACE FUNCTION public.kb_ensure_moderator_folders(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.kb_folders
     WHERE owner_id = p_user_id AND parent_id IS NULL AND name = 'сократ'
  ) THEN
    INSERT INTO public.kb_folders (owner_id, parent_id, name, sort_order)
    VALUES (p_user_id, NULL, 'сократ', 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.kb_folders
     WHERE owner_id = p_user_id AND parent_id IS NULL
       AND lower(name) = lower('Черновики для сократа')
  ) THEN
    INSERT INTO public.kb_folders (owner_id, parent_id, name, sort_order)
    VALUES (p_user_id, NULL, 'Черновики для сократа', 0);
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.kb_ensure_moderator_folders(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kb_ensure_moderator_folders(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kb_ensure_moderator_folders(UUID) TO service_role;

DO $backfill$
DECLARE _uid UUID; _n INT := 0;
BEGIN
  FOR _uid IN
    SELECT DISTINCT user_id FROM public.user_roles WHERE role = 'moderator'::public.app_role
  LOOP
    PERFORM public.kb_ensure_moderator_folders(_uid);
    _n := _n + 1;
  END LOOP;
  RAISE NOTICE 'kb_ensure_moderator_folders applied to % moderator(s)', _n;
END $backfill$;

CREATE OR REPLACE FUNCTION public.trg_fn_kb_moderator_folders()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'moderator'::public.app_role THEN
    BEGIN
      PERFORM public.kb_ensure_moderator_folders(NEW.user_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'kb_ensure_moderator_folders failed for %: %', NEW.user_id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_kb_moderator_folders ON public.user_roles;
CREATE TRIGGER trg_kb_moderator_folders
AFTER INSERT ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_kb_moderator_folders();
