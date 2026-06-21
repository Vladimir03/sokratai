
DROP FUNCTION IF EXISTS public.kb_mod_create_source(text, text, integer);
DROP FUNCTION IF EXISTS public.kb_mod_update_source(uuid, text, integer);
DROP FUNCTION IF EXISTS public.kb_mod_delete_source(uuid);

CREATE OR REPLACE FUNCTION public.kb_mod_create_source(
  p_name text,
  p_subject text DEFAULT 'physics',
  p_sort_order integer DEFAULT 100
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'moderator') THEN
    RAISE EXCEPTION 'Only moderators can manage sources';
  END IF;
  INSERT INTO public.kb_sources (name, subject, sort_order)
  VALUES (trim(p_name), coalesce(p_subject, 'physics'), coalesce(p_sort_order, 100))
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.kb_mod_update_source(
  p_id uuid,
  p_name text DEFAULT NULL,
  p_sort_order integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'moderator') THEN
    RAISE EXCEPTION 'Only moderators can manage sources';
  END IF;
  UPDATE public.kb_sources
     SET name = COALESCE(trim(p_name), name),
         sort_order = COALESCE(p_sort_order, sort_order)
   WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.kb_mod_delete_source(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'moderator') THEN
    RAISE EXCEPTION 'Only moderators can manage sources';
  END IF;
  DELETE FROM public.kb_sources WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.kb_mod_create_source(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kb_mod_update_source(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kb_mod_delete_source(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kb_mod_create_source(text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kb_mod_update_source(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kb_mod_delete_source(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
