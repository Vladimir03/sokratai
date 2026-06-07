CREATE OR REPLACE FUNCTION public.tutor_get_invite_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tutor_id UUID;
  v_code TEXT;
  v_new_code TEXT;
  v_exists BOOLEAN;
BEGIN
  SELECT id, invite_code INTO v_tutor_id, v_code
  FROM public.tutors WHERE user_id = auth.uid();

  IF v_tutor_id IS NULL THEN
    RAISE EXCEPTION 'TUTOR_NOT_FOUND';
  END IF;

  IF v_code IS NOT NULL AND length(trim(v_code)) > 0 THEN
    RETURN v_code;
  END IF;

  LOOP
    v_new_code := public.generate_invite_code();
    SELECT EXISTS(SELECT 1 FROM public.tutors WHERE invite_code = v_new_code) INTO v_exists;
    EXIT WHEN NOT v_exists;
  END LOOP;

  UPDATE public.tutors
    SET invite_code = v_new_code
    WHERE id = v_tutor_id AND invite_code IS NULL
    RETURNING invite_code INTO v_code;

  IF v_code IS NOT NULL AND length(trim(v_code)) > 0 THEN
    RETURN v_code;
  END IF;

  SELECT invite_code INTO v_code FROM public.tutors WHERE id = v_tutor_id;
  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.tutor_get_invite_code() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_get_invite_code() TO authenticated;

COMMENT ON FUNCTION public.tutor_get_invite_code() IS
  'Возвращает invite_code текущего репетитора (auth.uid()); генерирует и сохраняет, если NULL.';

ALTER TABLE public.tutors ALTER COLUMN mini_groups_enabled SET DEFAULT true;

UPDATE public.tutors SET mini_groups_enabled = true
  WHERE mini_groups_enabled IS DISTINCT FROM true;