CREATE OR REPLACE FUNCTION public.tutor_ensure_student_claim_token(
  p_tutor_student_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tutor_pk_id   uuid;
  v_owns          boolean;
  v_student_id    uuid;
  v_token         text;
  v_email         text;
  v_last_sign_in  timestamptz;
  v_new_token     text;
  v_exists        boolean;
  v_hex           text;
  v_i             int;
  v_alphabet      constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_offsets       constant int[] := ARRAY[1,3,5,7,9,11,19,21];
BEGIN
  SELECT id INTO v_tutor_pk_id FROM public.tutors WHERE user_id = auth.uid();
  IF v_tutor_pk_id IS NULL THEN
    RAISE EXCEPTION 'TUTOR_NOT_FOUND';
  END IF;

  SELECT (tutor_id = v_tutor_pk_id), student_id, claim_token
    INTO v_owns, v_student_id, v_token
  FROM public.tutor_students
  WHERE id = p_tutor_student_id;

  IF v_owns IS NULL THEN
    RAISE EXCEPTION 'STUDENT_NOT_FOUND';
  END IF;
  IF v_owns IS NOT TRUE THEN
    RAISE EXCEPTION 'NOT_OWNED';
  END IF;

  SELECT u.email, u.last_sign_in_at INTO v_email, v_last_sign_in
  FROM auth.users u WHERE u.id = v_student_id;
  IF v_last_sign_in IS NOT NULL AND v_email IS NOT NULL
     AND v_email NOT LIKE '%@temp.sokratai.ru' THEN
    RAISE EXCEPTION 'STUDENT_ALREADY_ACTIVE';
  END IF;

  IF v_token IS NOT NULL AND length(v_token) = 8 THEN
    RETURN v_token;
  END IF;

  LOOP
    v_hex := replace(gen_random_uuid()::text, '-', '');
    v_new_token := '';
    FOREACH v_i IN ARRAY v_offsets LOOP
      v_new_token := v_new_token ||
        substr(v_alphabet, (('x' || substr(v_hex, v_i, 2))::bit(8)::int % 31) + 1, 1);
    END LOOP;
    SELECT EXISTS(
      SELECT 1 FROM public.tutor_students WHERE claim_token = v_new_token
    ) INTO v_exists;
    EXIT WHEN NOT v_exists;
  END LOOP;

  UPDATE public.tutor_students
    SET claim_token = v_new_token,
        claim_token_created_at = now()
    WHERE id = p_tutor_student_id
      AND claim_token IS NOT DISTINCT FROM v_token
      AND NOT EXISTS (
        SELECT 1 FROM auth.users u
        WHERE u.id = v_student_id
          AND u.last_sign_in_at IS NOT NULL
          AND u.email IS NOT NULL
          AND u.email NOT LIKE '%@temp.sokratai.ru'
      )
    RETURNING claim_token INTO v_token;

  IF v_token IS NOT NULL THEN
    BEGIN
      INSERT INTO public.analytics_events (event_name, tutor_id, tutor_student_id, source)
      VALUES ('invite_generated', v_tutor_pk_id, p_tutor_student_id, 'gate');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    RETURN v_token;
  END IF;

  SELECT claim_token INTO v_token FROM public.tutor_students WHERE id = p_tutor_student_id;
  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.tutor_ensure_student_claim_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_ensure_student_claim_token(uuid) TO authenticated;

COMMENT ON COLUMN public.tutor_students.claim_token IS
  'Код входа ученика (короткий 8-симв. UPPERCASE или legacy 32-hex). МНОГОРАЗОВЫЙ '
  'до регистрации: НЕ обнуляется при claim (student-claim), гаснет при установке '
  'почты+пароля (student-register / student-set-password). TTL нет — гейт '
  '«зарегистрирован» (реальный email И last_sign_in_at) в RPC + student-claim. '
  'Решение владельца 2026-07-20, запрос №43.';