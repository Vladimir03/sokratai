-- Поворот фото на 90° в кабинете репетитора (волна 1, план 1-ancient-quokka).
CREATE TABLE IF NOT EXISTS public.photo_orientations (
  ref text PRIMARY KEY,
  degrees smallint NOT NULL DEFAULT 0
    CONSTRAINT chk_photo_orientation_degrees CHECK (degrees IN (0, 90, 180, 270)),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.photo_orientations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.photo_orientations FROM PUBLIC;
REVOKE ALL ON public.photo_orientations FROM anon, authenticated;
GRANT ALL ON public.photo_orientations TO service_role;

CREATE OR REPLACE FUNCTION public.photo_orientations_get(p_refs text[])
RETURNS TABLE (ref text, degrees smallint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT po.ref, po.degrees
  FROM public.photo_orientations po
  WHERE po.ref = ANY (p_refs[1:200])
    AND auth.uid() IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.photo_orientations_set(p_ref text, p_degrees int)
RETURNS smallint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_norm smallint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Нужно войти в аккаунт, чтобы повернуть фото.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_tutor(v_uid) THEN
    RAISE EXCEPTION 'Поворачивать фото может только репетитор.'
      USING ERRCODE = '42501';
  END IF;

  IF p_ref IS NULL OR length(p_ref) = 0 OR length(p_ref) > 1024 THEN
    RAISE EXCEPTION 'Некорректная ссылка на фото.'
      USING ERRCODE = '22023';
  END IF;

  v_norm := (((p_degrees % 360) + 360) % 360)::smallint;
  IF v_norm NOT IN (0, 90, 180, 270) THEN
    RAISE EXCEPTION 'Поворот возможен только шагом 90°.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.photo_orientations (ref, degrees, updated_by, updated_at)
  VALUES (p_ref, v_norm, v_uid, now())
  ON CONFLICT (ref) DO UPDATE
    SET degrees = EXCLUDED.degrees,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at;

  RETURN v_norm;
END;
$$;

GRANT EXECUTE ON FUNCTION public.photo_orientations_get(text[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.photo_orientations_get(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.photo_orientations_get(text[]) FROM anon;

GRANT EXECUTE ON FUNCTION public.photo_orientations_set(text, int) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.photo_orientations_set(text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.photo_orientations_set(text, int) FROM anon;

COMMENT ON TABLE public.photo_orientations IS
  'Угол показа фото (0/90/180/270) по storage-ref. Файл не перезаписывается: '
  'угол применяется transform''ом на клиенте и запекается в пиксели только '
  'при рендере размеченной картинки. Доступ ТОЛЬКО через photo_orientations_get/set — '
  'список ref''ов не отдаётся никому (anti-leak, rule 40).';