-- ============================================================================
-- ФИКС (critical): tutor_ensure_student_claim_token падал в рантайме
-- ============================================================================
-- Баг: RPC генерил токен через `gen_random_bytes(16)` (pgcrypto). На Supabase
-- pgcrypto живёт в схеме `extensions`, а функция объявлена с `SET search_path =
-- public` → unqualified `gen_random_bytes` НЕ находится → RPC бросает ошибку →
-- «Не удалось подготовить ссылку» в ConnectStudentSheet (гейт + карточка ученика).
--
-- Симптом: любой плейсхолдер без токена (bulk-added «Петя»/«Катя») → LOOP →
-- gen_random_bytes → runtime error.
--
-- Фикс: `replace(gen_random_uuid()::text, '-', '')` — 32 hex, `gen_random_uuid`
-- в `pg_catalog` (всегда на search_path, не зависит от pgcrypto). Формат
-- совместим с TOKEN_RE `/^[a-f0-9]{32}$/i` (student-claim) и с connect-student-email
-- (`crypto.randomUUID().replace(/-/g,'')`). Логика/гейты не меняются.
--
-- Migration `20260701120000` уже применён в проде → не правим его (drift), а
-- CREATE OR REPLACE новой миграцией (привилегии от первой сохраняются).
-- ============================================================================

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
  v_token_created timestamptz;
  v_last_sign_in  timestamptz;
  v_new_token     text;
  v_exists        boolean;
  v_ttl           interval := interval '30 days';
BEGIN
  SELECT id INTO v_tutor_pk_id FROM public.tutors WHERE user_id = auth.uid();
  IF v_tutor_pk_id IS NULL THEN
    RAISE EXCEPTION 'TUTOR_NOT_FOUND';
  END IF;

  SELECT (tutor_id = v_tutor_pk_id), student_id, claim_token, claim_token_created_at
    INTO v_owns, v_student_id, v_token, v_token_created
  FROM public.tutor_students
  WHERE id = p_tutor_student_id;

  IF v_owns IS NULL THEN
    RAISE EXCEPTION 'STUDENT_NOT_FOUND';
  END IF;
  IF v_owns IS NOT TRUE THEN
    RAISE EXCEPTION 'NOT_OWNED';
  END IF;

  -- Не выдавать токен уже активному аккаунту (impersonation, P0).
  SELECT last_sign_in_at INTO v_last_sign_in FROM auth.users WHERE id = v_student_id;
  IF v_last_sign_in IS NOT NULL THEN
    RAISE EXCEPTION 'STUDENT_ALREADY_ACTIVE';
  END IF;

  -- Действующий НЕ истёкший токен → вернуть.
  IF v_token IS NOT NULL AND v_token_created IS NOT NULL
     AND v_token_created > now() - v_ttl THEN
    RETURN v_token;
  END IF;

  -- Генерим/ротируем. gen_random_uuid() (pg_catalog) вместо gen_random_bytes
  -- (pgcrypto/extensions, off search_path) — ФИКС рантайм-ошибки.
  LOOP
    v_new_token := replace(gen_random_uuid()::text, '-', ''); -- 32 hex
    SELECT EXISTS(
      SELECT 1 FROM public.tutor_students WHERE claim_token = v_new_token
    ) INTO v_exists;
    EXIT WHEN NOT v_exists;
  END LOOP;

  UPDATE public.tutor_students
    SET claim_token = v_new_token,
        claim_token_created_at = now()
    WHERE id = p_tutor_student_id
      AND (claim_token IS NULL
           OR claim_token_created_at IS NULL
           OR claim_token_created_at <= now() - v_ttl)
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
