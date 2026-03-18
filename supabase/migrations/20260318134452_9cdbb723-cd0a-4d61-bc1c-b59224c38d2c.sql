-- KB Catalog Live Sync: folders for second moderator + fetch_catalog_tasks_v2

-- 1. Create folders for second moderator (already done in previous migration if user exists)
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
    RAISE NOTICE 'User kamchatkinvova@gmail.com not found — skipping';
    RETURN;
  END IF;

  SELECT id INTO _drafts_id FROM public.kb_folders
  WHERE owner_id = _mod_id AND name = 'Черновики для сократа' AND parent_id IS NULL LIMIT 1;
  IF _drafts_id IS NULL THEN
    INSERT INTO public.kb_folders (owner_id, parent_id, name, sort_order)
    VALUES (_mod_id, NULL, 'Черновики для сократа', 0);
  END IF;

  SELECT id INTO _ready_id FROM public.kb_folders
  WHERE owner_id = _mod_id AND name = 'сократ' AND parent_id IS NULL LIMIT 1;
  IF _ready_id IS NULL THEN
    INSERT INTO public.kb_folders (owner_id, parent_id, name, sort_order)
    VALUES (_mod_id, NULL, 'сократ', 1);
  END IF;
END $folders$;


-- 2. RPC: fetch_catalog_tasks_v2 with WITH RECURSIVE
CREATE OR REPLACE FUNCTION public.fetch_catalog_tasks_v2(p_topic_id UUID)
RETURNS SETOF public.kb_tasks
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE moderator_ids AS (
    SELECT id FROM auth.users
    WHERE email IN ('egor.o.blinov@gmail.com', 'kamchatkinvova@gmail.com')
  ),
  socrat_folder_tree AS (
    SELECT f.id
    FROM kb_folders f
    JOIN moderator_ids m ON f.owner_id = m.id
    WHERE f.name = 'сократ' AND f.parent_id IS NULL
    UNION ALL
    SELECT child.id
    FROM kb_folders child
    JOIN socrat_folder_tree parent ON child.parent_id = parent.id
  )
  SELECT t.* FROM kb_tasks t
  WHERE t.topic_id = p_topic_id AND t.owner_id IS NULL

  UNION ALL

  SELECT t.* FROM kb_tasks t
  WHERE t.topic_id = p_topic_id
    AND t.folder_id IN (SELECT id FROM socrat_folder_tree)

  ORDER BY created_at;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_catalog_tasks_v2(UUID) TO authenticated;