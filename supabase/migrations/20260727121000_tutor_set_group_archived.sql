-- =============================================================================
-- Управление группами/метками (запрос Егора #39, звонок Дианы 2026-07-27):
-- архив и восстановление группы одной атомарной операцией.
--
-- Почему RPC, а не два клиентских UPDATE: архив обязан снять и группу, и все её
-- активные membership'ы ОДНОЙ транзакцией — двухшаговая клиентская запись под
-- RU-DPI рискует полу-архивом (группа скрыта, ученики «в никуда» с активными
-- membership'ами, счётчики врут).
--
-- Семантика:
--  - Удаления групп НЕТ вообще — только мягкий архив (FK-ссылки живут:
--    tutor_lessons.group_source_tutor_group_id, homework_tutor_assignments
--    .source_group_id). Архив скрывает групповой чат из списка «Чаты»
--    (tutor-student-chat-api фильтрует is_primary AND is_active) — история
--    остаётся в БД и возвращается при восстановлении.
--  - Восстановление membership'ы НЕ возвращает (состав пересобирается руками) —
--    честно сказано в UI.
--  - Восстановление при живой одноимённой активной группе → unique-индекс
--    tutor_groups_unique_active_name (20260727120000) → чистая ошибка NAME_TAKEN.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.tutor_set_group_archived(
  _tutor_group_id uuid,
  _archived boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _tutor_id uuid;
  _deactivated_members int := 0;
BEGIN
  -- Ownership: группа принадлежит текущему репетитору (FK-дрейф rule 60:
  -- tutor_groups.tutor_id → tutors.id, конверсия через tutors.user_id).
  SELECT g.tutor_id INTO _tutor_id
  FROM tutor_groups g
  JOIN tutors t ON t.id = g.tutor_id
  WHERE g.id = _tutor_group_id
    AND t.user_id = auth.uid();

  IF _tutor_id IS NULL THEN RAISE EXCEPTION 'NOT_OWNED' USING ERRCODE = '42501'; END IF;

  IF _archived THEN
    UPDATE tutor_groups
    SET is_active = false
    WHERE id = _tutor_group_id;

    WITH d AS (
      UPDATE tutor_group_memberships
      SET is_active = false
      WHERE tutor_group_id = _tutor_group_id
        AND is_active = true
      RETURNING id
    )
    SELECT count(*) INTO _deactivated_members FROM d;
  ELSE
    BEGIN
      UPDATE tutor_groups
      SET is_active = true
      WHERE id = _tutor_group_id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'NAME_TAKEN' USING ERRCODE = '23505';
    END;
    -- membership'ы намеренно не восстанавливаются.
  END IF;

  RETURN jsonb_build_object('ok', true, 'deactivated_members', _deactivated_members);
END;
$$;

REVOKE ALL ON FUNCTION public.tutor_set_group_archived(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tutor_set_group_archived(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.tutor_set_group_archived(uuid, boolean) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
