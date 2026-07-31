ALTER TABLE public.homework_tutor_thread_messages
  DROP CONSTRAINT IF EXISTS homework_tutor_thread_messages_message_kind_check;

ALTER TABLE public.homework_tutor_thread_messages
  ADD CONSTRAINT homework_tutor_thread_messages_message_kind_check
    CHECK (
      message_kind IS NULL OR message_kind IN (
        'answer','hint_request','question','bootstrap','ai_reply','system',
        'check_result','hint_reply','tutor_message','tutor_note','submission',
        'check_failed','photo_annotation'
      )
    );

CREATE OR REPLACE FUNCTION public.photo_orientations_set(p_ref text, p_degrees int)
RETURNS smallint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_norm smallint;
  v_bucket text;
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

  IF p_ref NOT LIKE 'storage://%/%' THEN
    RAISE EXCEPTION 'Некорректная ссылка на фото.'
      USING ERRCODE = '22023';
  END IF;

  v_bucket := split_part(substring(p_ref from 11), '/', 1);
  IF v_bucket NOT IN ('homework-images', 'mock-exam-photos', 'tutor-student-chat') THEN
    RAISE EXCEPTION 'Это изображение нельзя поворачивать.'
      USING ERRCODE = '42501';
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

GRANT EXECUTE ON FUNCTION public.photo_orientations_set(text, int) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.photo_orientations_set(text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.photo_orientations_set(text, int) FROM anon;