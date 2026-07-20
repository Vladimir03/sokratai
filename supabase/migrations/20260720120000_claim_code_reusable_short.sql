-- ============================================================================
-- Claim-код ученика: короткий 8-символьный + многоразовый до регистрации (№43)
-- ============================================================================
-- Запрос Егора (№43, J2): «максимально короткий ник, который ученик легко вобьёт
-- или скопирует» + «персональная ссылка должна быть многоразовой». Решения
-- владельца 2026-07-20 (план ~/.claude/plans/1-rustling-key.md):
--   • короткий код = вход (ссылка ИЛИ ввод кода на /login);
--   • многоразовый ДО установки почты+пароля (student-register /
--     student-set-password обнуляют claim_token — «код умирает»);
--   • TTL снят — граница безопасности = гейт «зарегистрирован», не время.
--
-- Изменения vs 20260701160000:
--   1. Гейт STUDENT_ALREADY_ACTIVE: был `last_sign_in_at IS NOT NULL` — ЭТО
--      создавало lockout (заходивший-но-незарегистрированный плейсхолдер терял
--      сессию → репетитор не мог выдать новый код → ученик заблокирован).
--      Теперь «зарегистрирован» = реальный email И был вход (оба через AND):
--      temp-email + вход = застрявший плейсхолдер → выпускаем; реальный email
--      без входа = email проставлен репетитором/connect-by-email ДО claim →
--      выпускаем; реальный email + вход = сам владеет аккаунтом → блок.
--      Идентификатор исключения СОХРАНЁН (ConnectStudentSheet матчит по regex).
--   2. Формат: 8 символов из алфавита referral_code (без путающих I/L/O/0/1,
--      прецедент generate_referral_code, 20260716120000). student-claim принимает
--      ОБА формата (legacy 32-hex ссылки в обороте работают). Legacy-токен
--      ротируется в короткий при следующем открытии ConnectStudentSheet
--      (репетитор в этот момент видит новый код; принято владельцем).
--   3. TTL убран: короткий код возвращается идемпотентно без проверки возраста.
--
-- ПОРЯДОК ДЕПЛОЯ (КРИТИЧНО): применять ТОЛЬКО после того, как edge student-claim
-- с dual-format (пуш 8e4f4aa) реально задеплоен — иначе RPC начнёт выдавать
-- коды, которые старый edge отвергает по TOKEN_RE.
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
  v_email         text;
  v_last_sign_in  timestamptz;
  v_new_token     text;
  v_exists        boolean;
  v_hex           text;
  v_i             int;
  -- Алфавит referral_code (31 символ, без путающих I/L/O/0/1).
  v_alphabet      constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  -- Офсеты hex-пар gen_random_uuid, МИНУЯ фиксированные ниблы UUIDv4
  -- (позиция 13 = версия '4', позиция 17 = variant) — иначе часть символов
  -- кода теряла бы энтропию. 8 пар × полный случайный байт → mod 31.
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

  -- Гейт «зарегистрирован» (фикс lockout №43): блок ТОЛЬКО когда ученик сам
  -- владеет аккаунтом (реальный email И был вход). Зеркала: student-claim POST.
  SELECT u.email, u.last_sign_in_at INTO v_email, v_last_sign_in
  FROM auth.users u WHERE u.id = v_student_id;
  IF v_last_sign_in IS NOT NULL AND v_email IS NOT NULL
     AND v_email NOT LIKE '%@temp.sokratai.ru' THEN
    RAISE EXCEPTION 'STUDENT_ALREADY_ACTIVE';
  END IF;

  -- Короткий код уже есть → идемпотентный возврат (TTL снят — решение владельца).
  IF v_token IS NOT NULL AND length(v_token) = 8 THEN
    RETURN v_token;
  END IF;

  -- NULL или legacy 32-hex → минт короткого кода (legacy ротируется).
  -- gen_random_uuid() (pg_catalog, всегда на search_path) — НЕ pgcrypto
  -- (урок 20260701160000).
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
    EXIT WHEN NOT v_exists; -- collision retry; partial unique index — backstop
  END LOOP;

  -- CAS против конкурентного минта (два открытых sheet'а): обновляем, только
  -- если токен не изменился с момента чтения. IS NOT DISTINCT FROM — NULL-safe.
  -- + анти-воскрешение (ревью 5.6 P2 #2): student-register мог завершиться
  -- МЕЖДУ гейтом выше и этим UPDATE (погасив токен и сделав аккаунт
  -- зарегистрированным) — без re-check'а CAS NULL→short «воскресил» бы код.
  -- Registered-условие повторяется атомарно внутри WHERE.
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

  -- Проигравший гонку → перечитать и вернуть актуальный.
  SELECT claim_token INTO v_token FROM public.tutor_students WHERE id = p_tutor_student_id;
  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.tutor_ensure_student_claim_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_ensure_student_claim_token(uuid) TO authenticated;

-- Семантика колонки изменилась (комментарий применённой миграции 20260701120000
-- не редактируем — additive-only): фиксируем новую here.
COMMENT ON COLUMN public.tutor_students.claim_token IS
  'Код входа ученика (короткий 8-симв. UPPERCASE или legacy 32-hex). МНОГОРАЗОВЫЙ '
  'до регистрации: НЕ обнуляется при claim (student-claim), гаснет при установке '
  'почты+пароля (student-register / student-set-password). TTL нет — гейт '
  '«зарегистрирован» (реальный email И last_sign_in_at) в RPC + student-claim. '
  'Решение владельца 2026-07-20, запрос №43.';
