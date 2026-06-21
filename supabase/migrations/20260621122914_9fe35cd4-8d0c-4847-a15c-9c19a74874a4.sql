
CREATE TABLE IF NOT EXISTS public.kb_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  subject text NOT NULL DEFAULT 'physics',
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject, name)
);

GRANT SELECT ON public.kb_sources TO authenticated;
GRANT ALL ON public.kb_sources TO service_role;

ALTER TABLE public.kb_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kb_sources_read_authenticated"
  ON public.kb_sources
  FOR SELECT
  TO authenticated
  USING (true);

CREATE OR REPLACE FUNCTION public.kb_sources_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_kb_sources_updated_at ON public.kb_sources;
CREATE TRIGGER trg_kb_sources_updated_at
  BEFORE UPDATE ON public.kb_sources
  FOR EACH ROW EXECUTE FUNCTION public.kb_sources_set_updated_at();

-- RPCs (moderator-only)
CREATE OR REPLACE FUNCTION public.kb_mod_create_source(
  _name text,
  _subject text DEFAULT 'physics',
  _sort_order integer DEFAULT 100
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
  VALUES (trim(_name), coalesce(_subject, 'physics'), coalesce(_sort_order, 100))
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.kb_mod_update_source(
  _id uuid,
  _name text,
  _sort_order integer DEFAULT NULL
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
     SET name = COALESCE(trim(_name), name),
         sort_order = COALESCE(_sort_order, sort_order)
   WHERE id = _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.kb_mod_delete_source(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'moderator') THEN
    RAISE EXCEPTION 'Only moderators can manage sources';
  END IF;
  DELETE FROM public.kb_sources WHERE id = _id;
END;
$$;

REVOKE ALL ON FUNCTION public.kb_mod_create_source(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kb_mod_update_source(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kb_mod_delete_source(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kb_mod_create_source(text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kb_mod_update_source(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kb_mod_delete_source(uuid) TO authenticated;

-- Seed
INSERT INTO public.kb_sources (name, subject, sort_order) VALUES
  ('ФИПИ', 'physics', 10),
  ('Демидова М.Ю.', 'physics', 20),
  ('Лукашева Е.В.', 'physics', 30),
  ('Камзеева Е.Е.', 'physics', 40),
  ('Решу ЕГЭ', 'physics', 50),
  ('Другой', 'physics', 999)
ON CONFLICT (subject, name) DO NOTHING;

NOTIFY pgrst, 'reload schema';
