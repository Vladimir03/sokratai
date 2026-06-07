-- =============================================
-- tutor_get_invite_code() — быстрый, надёжный путь получить invite_code
-- для текущего репетитора. Генерирует + персистит код, если он почему-то NULL.
--
-- Зачем: вкладка «По ссылке» в «Добавить ученика» раньше читала invite_code
-- из тяжёлого запроса профиля репетитора (['tutor','profile']), который под
-- RU DPI зависает на минуты → бесконечная «Загрузка кода приглашения…».
-- Эта RPC — лёгкий single-row путь, не зависящий от профиля.
-- SECURITY DEFINER + ownership по auth.uid() внутри (rule 96 #10).
-- =============================================

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
  SELECT id, invite_code
    INTO v_tutor_id, v_code
  FROM public.tutors
  WHERE user_id = auth.uid();

  IF v_tutor_id IS NULL THEN
    RAISE EXCEPTION 'TUTOR_NOT_FOUND';
  END IF;

  IF v_code IS NOT NULL AND length(trim(v_code)) > 0 THEN
    RETURN v_code;
  END IF;

  -- Code missing (legacy/edge case): generate a unique one and persist it
  -- ATOMICALLY. The conditional UPDATE (... AND invite_code IS NULL) ensures
  -- only one of two concurrent callers wins; the loser re-reads the persisted
  -- code instead of returning its own (now-discarded) value. Без этого гонка
  -- двух параллельных вызовов отдавала бы клиенту невалидный код.
  LOOP
    v_new_code := public.generate_invite_code();
    SELECT EXISTS(SELECT 1 FROM public.tutors WHERE invite_code = v_new_code)
      INTO v_exists;
    EXIT WHEN NOT v_exists;
  END LOOP;

  UPDATE public.tutors
    SET invite_code = v_new_code
    WHERE id = v_tutor_id AND invite_code IS NULL
    RETURNING invite_code INTO v_code;

  IF v_code IS NOT NULL AND length(trim(v_code)) > 0 THEN
    RETURN v_code; -- we won the race
  END IF;

  -- Another caller filled it first — return the persisted value.
  SELECT invite_code INTO v_code FROM public.tutors WHERE id = v_tutor_id;
  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.tutor_get_invite_code() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_get_invite_code() TO authenticated;

COMMENT ON FUNCTION public.tutor_get_invite_code() IS
  'Возвращает invite_code текущего репетитора (auth.uid()); генерирует и сохраняет, если NULL.';
