-- =============================================================================
-- Ссылка саморегистрации в ГРУППУ (звонок Дианы 2026-07-27, повторено 4 раза;
-- обещано Владимиром). Ученик идёт по sokratai.ru/invite/{invite_code}?g={join_code}
-- → обычный invite-флоу (claim-invite) + автоматический membership в учебную
-- группу. «Зачем я буду их сама туда заносить? Я отправляю ссылку, и они все
-- регистрируются сразу в нужную группу».
--
-- join_code — bearer (кто знает код, тот вступает в группу): не логировать
-- (rule 96 №10), отзыв = regenerate (старая ссылка умирает мгновенно).
-- =============================================================================

ALTER TABLE public.tutor_groups ADD COLUMN IF NOT EXISTS join_code text;

CREATE UNIQUE INDEX IF NOT EXISTS tutor_groups_join_code_unique
  ON public.tutor_groups (join_code)
  WHERE join_code IS NOT NULL;

-- Выдать (или пересоздать) join-код группы. Только владелец, только активная
-- УЧЕБНАЯ группа (метки не собирают учеников по ссылке). _regenerate=true =
-- отзыв старой ссылки.
CREATE OR REPLACE FUNCTION public.tutor_ensure_group_join_code(
  _tutor_group_id uuid,
  _regenerate boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _current text;
  _is_primary boolean;
  _is_active boolean;
  _candidate text;
  _attempt int := 0;
BEGIN
  SELECT g.join_code, g.is_primary, g.is_active
    INTO _current, _is_primary, _is_active
  FROM tutor_groups g
  JOIN tutors t ON t.id = g.tutor_id
  WHERE g.id = _tutor_group_id
    AND t.user_id = auth.uid();

  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_OWNED' USING ERRCODE = '42501'; END IF;
  IF _is_primary IS NOT TRUE THEN RAISE EXCEPTION 'NOT_LEARNING_GROUP' USING ERRCODE = '22023'; END IF;
  IF _is_active IS NOT TRUE THEN RAISE EXCEPTION 'GROUP_ARCHIVED' USING ERRCODE = '22023'; END IF;

  IF _current IS NOT NULL AND NOT _regenerate THEN
    RETURN _current;
  END IF;

  LOOP
    _attempt := _attempt + 1;
    -- 12 hex-символов ≈ 48 бит энтропии — достаточно для bearer-ссылки группы.
    _candidate := substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 12);
    BEGIN
      UPDATE tutor_groups SET join_code = _candidate WHERE id = _tutor_group_id;
      RETURN _candidate;
    EXCEPTION WHEN unique_violation THEN
      IF _attempt >= 5 THEN RAISE; END IF;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.tutor_ensure_group_join_code(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tutor_ensure_group_join_code(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.tutor_ensure_group_join_code(uuid, boolean) TO authenticated, service_role;

-- Имя группы для незалогиненной InvitePage (?g=…): прямой SELECT tutor_groups
-- анону закрыт RLS. Bearer-семантика: знание join_code раскрывает ТОЛЬКО
-- название группы (имя репетитора страница уже знает по invite_code).
CREATE OR REPLACE FUNCTION public.get_group_join_info(_join_code text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'group_name', COALESCE(NULLIF(trim(g.short_name), ''), g.name)
  )
  FROM tutor_groups g
  WHERE g.join_code = _join_code
    AND g.join_code IS NOT NULL
    AND g.is_active = true
    AND g.is_primary = true
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_group_join_info(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_group_join_info(text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
