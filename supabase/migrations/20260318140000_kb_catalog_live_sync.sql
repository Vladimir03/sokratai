-- ══════════════════════════════════════════════════════════════
-- KB Catalog Live Sync (Variant A)
--
-- Задачи из папок «сократ» модераторов автоматически видны
-- в Каталоге Сократа. Правки в папке → мгновенно в каталоге.
--
-- Модераторы:
--   - egor.o.blinov@gmail.com
--   - kamchatkinvova@gmail.com
--
-- Архитектура:
--   RPC fetch_catalog_tasks_v2(topic_id) — SECURITY DEFINER
--   Возвращает UNION каталожных задач + задач из «сократ» папок
-- ══════════════════════════════════════════════════════════════

-- 1. Создаём папки для второго модератора (kamchatkinvova@gmail.com)
DO $folders$ DECLARE
  _mod_id UUID;
  _drafts_id UUID;
  _ready_id UUID;
BEGIN
  SELECT id INTO _mod_id
  FROM auth.users
  WHERE email = 'kamchatkinvova@gmail.com'
  LIMIT 1;

  IF _mod_id IS NULL THEN
    RAISE NOTICE 'User kamchatkinvova@gmail.com not found — skipping folder creation';
    RETURN;
  END IF;

  -- Папка "Черновики для сократа"
  SELECT id INTO _drafts_id
  FROM public.kb_folders
  WHERE owner_id = _mod_id AND name = 'Черновики для сократа' AND parent_id IS NULL
  LIMIT 1;

  IF _drafts_id IS NULL THEN
    INSERT INTO public.kb_folders (owner_id, parent_id, name, sort_order)
    VALUES (_mod_id, NULL, 'Черновики для сократа', 0)
    RETURNING id INTO _drafts_id;
    RAISE NOTICE 'Created "Черновики для сократа" for kamchatkinvova: %', _drafts_id;
  END IF;

  -- Папка "сократ"
  SELECT id INTO _ready_id
  FROM public.kb_folders
  WHERE owner_id = _mod_id AND name = 'сократ' AND parent_id IS NULL
  LIMIT 1;

  IF _ready_id IS NULL THEN
    INSERT INTO public.kb_folders (owner_id, parent_id, name, sort_order)
    VALUES (_mod_id, NULL, 'сократ', 1)
    RETURNING id INTO _ready_id;
    RAISE NOTICE 'Created "сократ" for kamchatkinvova: %', _ready_id;
  END IF;

END $folders$;


-- 2. RPC: fetch_catalog_tasks_v2
--    Возвращает задачи из каталога (owner_id IS NULL)
--    + задачи из папок «сократ» модераторов (рекурсивно, включая подпапки)
--    SECURITY DEFINER — обходит RLS для чтения чужих задач

CREATE OR REPLACE FUNCTION public.fetch_catalog_tasks_v2(p_topic_id UUID)
RETURNS SETOF public.kb_tasks
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH moderator_ids AS (
    SELECT id FROM auth.users
    WHERE email IN ('egor.o.blinov@gmail.com', 'kamchatkinvova@gmail.com')
  ),
  -- Рекурсивно собираем все «сократ» папки и их подпапки
  socrat_folder_tree AS (
    -- Корневые папки «сократ» модераторов
    SELECT f.id
    FROM kb_folders f
    JOIN moderator_ids m ON f.owner_id = m.id
    WHERE f.name = 'сократ' AND f.parent_id IS NULL

    UNION ALL

    -- Подпапки рекурсивно
    SELECT child.id
    FROM kb_folders child
    JOIN socrat_folder_tree parent ON child.parent_id = parent.id
  )
  -- Каталожные задачи (классические, owner_id = NULL)
  SELECT t.* FROM kb_tasks t
  WHERE t.topic_id = p_topic_id AND t.owner_id IS NULL

  UNION ALL

  -- Задачи из «сократ» папок модераторов (live-sync)
  SELECT t.* FROM kb_tasks t
  WHERE t.topic_id = p_topic_id
    AND t.folder_id IN (SELECT id FROM socrat_folder_tree)

  ORDER BY created_at;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_catalog_tasks_v2(UUID) TO authenticated;

COMMENT ON FUNCTION public.fetch_catalog_tasks_v2 IS
  'Returns catalog tasks (owner_id=NULL) + tasks from moderator «сократ» folders (live-sync). '
  'Moderators: egor.o.blinov@gmail.com, kamchatkinvova@gmail.com. '
  'Tasks in «сократ» are visible in real-time — no promote step needed.';


-- 3. Обновляем promote_folder_to_catalog — расширяем на двух модераторов
--    Теперь не только владелец, но и любой из модераторов может промоутить свою папку
--    (promote остаётся как fallback для финализации)

CREATE OR REPLACE FUNCTION public.promote_folder_to_catalog(
  p_folder_id UUID,
  p_topic_id UUID,
  p_subtopic_id UUID DEFAULT NULL,
  p_source_label TEXT DEFAULT NULL
)
RETURNS TABLE(promoted_count INT, task_ids UUID[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller_id UUID;
  _folder_owner UUID;
  _folder_name TEXT;
  _promoted UUID[];
  _count INT;
BEGIN
  _caller_id := auth.uid();
  IF _caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT owner_id, name INTO _folder_owner, _folder_name
  FROM public.kb_folders
  WHERE id = p_folder_id;

  IF _folder_owner IS NULL THEN
    RAISE EXCEPTION 'Folder % not found', p_folder_id;
  END IF;

  -- Проверка: вызывающий = владелец папки
  IF _folder_owner != _caller_id THEN
    RAISE EXCEPTION 'Only folder owner can promote tasks';
  END IF;

  -- Проверка: вызывающий — модератор
  IF NOT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = _caller_id
    AND email IN ('egor.o.blinov@gmail.com', 'kamchatkinvova@gmail.com')
  ) THEN
    RAISE EXCEPTION 'Only designated moderators can promote tasks to catalog';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.kb_topics WHERE id = p_topic_id) THEN
    RAISE EXCEPTION 'Topic % not found', p_topic_id;
  END IF;

  IF p_subtopic_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.kb_subtopics
      WHERE id = p_subtopic_id AND topic_id = p_topic_id
    ) THEN
      RAISE EXCEPTION 'Subtopic % not found in topic %', p_subtopic_id, p_topic_id;
    END IF;
  END IF;

  WITH promoted AS (
    UPDATE public.kb_tasks
    SET
      owner_id = NULL,
      folder_id = NULL,
      topic_id = p_topic_id,
      subtopic_id = COALESCE(p_subtopic_id, subtopic_id),
      source_label = COALESCE(p_source_label, source_label, 'demidova_2025'),
      updated_at = NOW()
    WHERE folder_id = p_folder_id
      AND owner_id = _folder_owner
    RETURNING id
  )
  SELECT ARRAY_AGG(id), COUNT(*)::INT
  INTO _promoted, _count
  FROM promoted;

  promoted_count := COALESCE(_count, 0);
  task_ids := COALESCE(_promoted, ARRAY[]::UUID[]);

  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.promote_folder_to_catalog IS
  'Promotes all tasks in a personal folder to the public Каталог Сократа. '
  'Sets owner_id=NULL, assigns topic_id/subtopic_id, clears folder_id. '
  'Only designated moderators who own the folder can call this. '
  'Moderators: egor.o.blinov@gmail.com, kamchatkinvova@gmail.com.';
