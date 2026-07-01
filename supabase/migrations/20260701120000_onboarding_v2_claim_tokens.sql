-- ============================================================================
-- Онбординг-активация v2 — per-student claim token (хэндофф репетитор → ученик)
-- ============================================================================
-- Create-then-claim: репетитор заводит плейсхолдер по имени (контакт NULL),
-- система выдаёт per-student claim-токен. Ученик открывает ссылку/QR →
-- edge `student-claim` минтит беспарольную сессию для ЭТОГО плейсхолдера и
-- авто-привязывает без апрува.
--
-- Инварианты (rule 96):
--   • Токен — bearer, ОДНОРАЗОВЫЙ: edge `student-claim` обнуляет claim_token
--     при первом успешном минте (claimed_at := now()). Persistent session
--     (supabaseClient: persistSession) проносит ученика через регистрацию без
--     повторного клика. НЕ вечный login-link.
--   • Короткоживущий: claim_token_created_at + TTL-проверка в edge (30 дней).
--   • Запись токена ТОЛЬКО через SECURITY DEFINER RPC (ownership по auth.uid()).
--   • FK-drift (rule 40): tutor_students.tutor_id → tutors.id (PK), НЕ auth.users.id.
-- ============================================================================

ALTER TABLE public.tutor_students
  ADD COLUMN IF NOT EXISTS claim_token            text,
  ADD COLUMN IF NOT EXISTS claim_token_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_at             timestamptz,
  ADD COLUMN IF NOT EXISTS claim_channel          text;

-- Уникальность токена + быстрый lookup в edge (только не-NULL: после consume → NULL).
CREATE UNIQUE INDEX IF NOT EXISTS idx_tutor_students_claim_token
  ON public.tutor_students (claim_token)
  WHERE claim_token IS NOT NULL;

COMMENT ON COLUMN public.tutor_students.claim_token IS
  'Per-student bearer claim-токен (одноразовый, обнуляется edge при первом минте). rule 96.';
COMMENT ON COLUMN public.tutor_students.claimed_at IS
  'Когда ученик впервые claim''нул запись (минт сессии). NULL = не подключился.';

-- ============================================================================
-- RPC: tutor_ensure_student_claim_token(p_tutor_student_id)
-- Возвращает действующий claim-токен ученика; генерит-если-NULL атомарно.
-- Паттерн tutor_get_invite_code (20260607120000): conditional UPDATE против гонки.
-- Ownership: вызывающий репетитор должен владеть строкой (tutor_students.tutor_id
-- = tutors.id текущего auth.uid()). SECURITY DEFINER (rule 96 #10).
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
  -- Резолв PK репетитора (FK-drift: tutor_students.tutor_id → tutors.id).
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

  -- P0 (review round 2): НЕ выдавать claim-токен аккаунту, который уже
  -- аутентифицировался (last_sign_in_at IS NOT NULL) — иначе репетитор мог бы
  -- повторно сминтить сессию уже зарегистрированного/активного ученика
  -- (post-activation impersonation, в обход пароля/OTP). Плейсхолдер (создан
  -- admin.createUser, ни разу не входил) имеет NULL. SECURITY DEFINER
  -- (owner=postgres) читает auth.users.
  SELECT last_sign_in_at INTO v_last_sign_in FROM auth.users WHERE id = v_student_id;
  IF v_last_sign_in IS NOT NULL THEN
    RAISE EXCEPTION 'STUDENT_ALREADY_ACTIVE';
  END IF;

  -- Действующий НЕ истёкший токен → вернуть (идемпотентно).
  IF v_token IS NOT NULL AND v_token_created IS NOT NULL
     AND v_token_created > now() - v_ttl THEN
    RETURN v_token;
  END IF;

  -- Иначе генерим/ротируем (токен NULL ИЛИ истёк — review P1c). Race-safe
  -- conditional UPDATE: матчим только NULL/истёкший токен → победитель получает
  -- RETURNING, проигравший (уже заменён) re-read'ит актуальный.
  LOOP
    v_new_token := encode(gen_random_bytes(16), 'hex'); -- 32 hex, unguessable
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
    -- Телеметрия воронки: invite_generated при минте токена (QR/копировать-путь).
    BEGIN
      INSERT INTO public.analytics_events (event_name, tutor_id, tutor_student_id, source)
      VALUES ('invite_generated', v_tutor_pk_id, p_tutor_student_id, 'gate');
    EXCEPTION WHEN OTHERS THEN
      NULL; -- телеметрия не должна ломать выдачу токена
    END;
    RETURN v_token; -- выиграли гонку
  END IF;

  -- Другой вызов записал первым — вернуть персистнутое.
  SELECT claim_token INTO v_token FROM public.tutor_students WHERE id = p_tutor_student_id;
  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.tutor_ensure_student_claim_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_ensure_student_claim_token(uuid) TO authenticated;

COMMENT ON FUNCTION public.tutor_ensure_student_claim_token(uuid) IS
  'Per-student claim-токен (генерит-если-NULL, атомарно). Ownership по auth.uid() (tutors.id). Онбординг v2.';
