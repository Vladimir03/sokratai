-- KB Moderation Pipeline: Create moderator folders + promote_folder_to_catalog RPC

-- 1. Create folders for Egor
DO $folders$ DECLARE
  _egor_id UUID;
  _drafts_folder_id UUID;
  _ready_folder_id UUID;
BEGIN
  SELECT id INTO _egor_id
  FROM auth.users
  WHERE email = 'egor.o.blinov@gmail.com'
  LIMIT 1;

  IF _egor_id IS NULL THEN
    RAISE NOTICE 'User egor.o.blinov@gmail.com not found — skipping folder creation';
    RETURN;
  END IF;

  SELECT id INTO _drafts_folder_id
  FROM public.kb_folders
  WHERE owner_id = _egor_id AND name = 'Черновики для сократа' AND parent_id IS NULL
  LIMIT 1;

  IF _drafts_folder_id IS NULL THEN
    INSERT INTO public.kb_folders (owner_id, parent_id, name, sort_order)
    VALUES (_egor_id, NULL, 'Черновики для сократа', 0)
    RETURNING id INTO _drafts_folder_id;
    RAISE NOTICE 'Created folder "Черновики для сократа": %', _drafts_folder_id;
  ELSE
    RAISE NOTICE 'Folder "Черновики для сократа" already exists: %', _drafts_folder_id;
  END IF;

  SELECT id INTO _ready_folder_id
  FROM public.kb_folders
  WHERE owner_id = _egor_id AND name = 'сократ' AND parent_id IS NULL
  LIMIT 1;

  IF _ready_folder_id IS NULL THEN
    INSERT INTO public.kb_folders (owner_id, parent_id, name, sort_order)
    VALUES (_egor_id, NULL, 'сократ', 1)
    RETURNING id INTO _ready_folder_id;
    RAISE NOTICE 'Created folder "сократ": %', _ready_folder_id;
  ELSE
    RAISE NOTICE 'Folder "сократ" already exists: %', _ready_folder_id;
  END IF;

END $folders$;


-- 2. RPC: promote_folder_to_catalog
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

  IF _folder_owner != _caller_id THEN
    RAISE EXCEPTION 'Only folder owner can promote tasks';
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

GRANT EXECUTE ON FUNCTION public.promote_folder_to_catalog TO authenticated;

COMMENT ON FUNCTION public.promote_folder_to_catalog IS
  'Promotes all tasks in a personal folder to the public Каталог Сократа. '
  'Sets owner_id=NULL, assigns topic_id/subtopic_id, clears folder_id. '
  'Only the folder owner can call this.';