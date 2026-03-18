-- ══════════════════════════════════════════════════════════════
-- KB Moderation V2: Source→Public Copy Model
--
-- Replaces Variant A (live-sync) with canonical public copies:
--   - Source task lives in moderator's «сократ» folder
--   - Canonical copy has owner_id=NULL, linked via source_task_id
--   - Auto-publish on move to «сократ», auto-resync on edit
--   - Fingerprint dedup with advisory locks
--   - Role-based auth via has_role(uid, 'moderator')
--
-- Additive migration — no destructive changes to existing data.
-- ══════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════
-- 1) New columns on kb_tasks
-- ════════════════════════════════════════════

-- Source task → its canonical public copy
ALTER TABLE public.kb_tasks ADD COLUMN published_task_id UUID
  REFERENCES public.kb_tasks(id) ON DELETE SET NULL;

-- Canonical public copy → its source task
ALTER TABLE public.kb_tasks ADD COLUMN source_task_id UUID
  REFERENCES public.kb_tasks(id) ON DELETE SET NULL;

-- Normalized text+answer hash for dedup
ALTER TABLE public.kb_tasks ADD COLUMN fingerprint TEXT;

-- Moderation lifecycle
ALTER TABLE public.kb_tasks ADD COLUMN moderation_status TEXT
  NOT NULL DEFAULT 'active';

ALTER TABLE public.kb_tasks ADD COLUMN hidden_reason TEXT;

-- Who published and when
ALTER TABLE public.kb_tasks ADD COLUMN published_by UUID
  REFERENCES auth.users(id);

ALTER TABLE public.kb_tasks ADD COLUMN published_at TIMESTAMPTZ;

-- Constraint on moderation_status values
ALTER TABLE public.kb_tasks ADD CONSTRAINT kb_tasks_moderation_status_check
  CHECK (moderation_status IN ('active', 'hidden_duplicate', 'unpublished'));


-- ════════════════════════════════════════════
-- 2) Indexes
-- ════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_kb_tasks_fingerprint
  ON public.kb_tasks(fingerprint) WHERE fingerprint IS NOT NULL;

-- Partial UNIQUE indexes enforce one-to-one source↔public invariant
-- (also serve as lookup indexes — no separate non-unique index needed)
CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_tasks_unique_source
  ON public.kb_tasks(source_task_id) WHERE source_task_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_tasks_unique_published
  ON public.kb_tasks(published_task_id) WHERE published_task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kb_tasks_moderation_status
  ON public.kb_tasks(moderation_status) WHERE owner_id IS NULL;


-- ════════════════════════════════════════════
-- 3) Fingerprint normalization function
-- ════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.kb_normalize_fingerprint(p_text TEXT, p_answer TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT md5(
    regexp_replace(lower(COALESCE(p_text, '')), '\s+', '', 'g')
    || '::' ||
    regexp_replace(lower(COALESCE(p_answer, '')), '\s+', '', 'g')
  );
$$;


-- ════════════════════════════════════════════
-- 4) Helper: check if folder is in «сократ» tree of a moderator
--    Walks up the parent chain to find root folder named «сократ»
--    whose owner has the 'moderator' role.
-- ════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.kb_is_in_socrat_tree(p_folder_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _current_id UUID := p_folder_id;
  _parent_id UUID;
  _name TEXT;
  _owner_id UUID;
  _depth INT := 0;
BEGIN
  IF p_folder_id IS NULL THEN RETURN FALSE; END IF;

  LOOP
    SELECT parent_id, name, owner_id
    INTO _parent_id, _name, _owner_id
    FROM kb_folders WHERE id = _current_id;

    IF NOT FOUND THEN RETURN FALSE; END IF;

    -- Reached a root folder
    IF _parent_id IS NULL THEN
      RETURN _name = 'сократ' AND has_role(_owner_id, 'moderator');
    END IF;

    _current_id := _parent_id;
    _depth := _depth + 1;
    IF _depth > 20 THEN RETURN FALSE; END IF; -- safety: prevent infinite loop
  END LOOP;
END;
$$;


-- ════════════════════════════════════════════
-- 5) Core publish logic (SECURITY DEFINER)
--    Creates canonical public copy of a source task.
--    Returns the new canonical task id.
--    Handles fingerprint dedup with advisory lock.
-- ════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.kb_publish_task(p_source_task_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _src RECORD;
  _fp TEXT;
  _fp_hash BIGINT;
  _existing_id UUID;
  _new_id UUID;
  _status TEXT := 'active';
  _reason TEXT := NULL;
BEGIN
  -- Fetch source task
  SELECT * INTO _src FROM kb_tasks WHERE id = p_source_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source task % not found', p_source_task_id;
  END IF;

  -- Must have topic_id to publish
  IF _src.topic_id IS NULL THEN
    RAISE EXCEPTION 'Cannot publish task without topic_id';
  END IF;

  -- Must not already be published
  IF _src.published_task_id IS NOT NULL THEN
    RAISE EXCEPTION 'Task % is already published as %', p_source_task_id, _src.published_task_id;
  END IF;

  -- Compute fingerprint
  _fp := kb_normalize_fingerprint(_src.text, _src.answer);

  -- Advisory lock on fingerprint to prevent race conditions
  _fp_hash := ('x' || left(md5(_fp), 16))::BIT(64)::BIGINT;
  PERFORM pg_advisory_xact_lock(_fp_hash);

  -- Check for existing active published task with same fingerprint
  SELECT id INTO _existing_id
  FROM kb_tasks
  WHERE fingerprint = _fp
    AND owner_id IS NULL
    AND moderation_status = 'active'
  LIMIT 1;

  IF _existing_id IS NOT NULL THEN
    -- First published fingerprint wins; this one gets soft-hidden
    _status := 'hidden_duplicate';
    _reason := 'duplicate of ' || _existing_id::TEXT;
  END IF;

  -- Create canonical public copy
  INSERT INTO kb_tasks (
    topic_id, subtopic_id, owner_id, folder_id,
    exam, kim_number, primary_score,
    text, answer, solution, answer_format,
    source_label, attachment_url, solution_attachment_url,
    source_task_id, fingerprint, moderation_status, hidden_reason,
    published_by, published_at,
    created_at, updated_at
  ) VALUES (
    _src.topic_id, _src.subtopic_id, NULL, NULL,
    _src.exam, _src.kim_number, _src.primary_score,
    _src.text, _src.answer, _src.solution, _src.answer_format,
    _src.source_label, _src.attachment_url, _src.solution_attachment_url,
    p_source_task_id, _fp, _status, _reason,
    _src.owner_id, NOW(),
    NOW(), NOW()
  )
  RETURNING id INTO _new_id;

  -- Link source → published
  UPDATE kb_tasks
  SET published_task_id = _new_id, updated_at = NOW()
  WHERE id = p_source_task_id;

  -- Audit log
  INSERT INTO kb_moderation_log (action, task_id, source_task_id, moderator_id, details)
  VALUES (
    'publish', _new_id, p_source_task_id, _src.owner_id,
    jsonb_build_object(
      'fingerprint', _fp,
      'status', _status,
      'hidden_reason', _reason
    )
  );

  RETURN _new_id;
END;
$$;


-- ════════════════════════════════════════════
-- 6) Core resync logic (SECURITY DEFINER)
--    Syncs source task changes to its canonical copy.
--    Blocks if new fingerprint creates a duplicate.
-- ════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.kb_resync_task(p_source_task_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _src RECORD;
  _pub_id UUID;
  _new_fp TEXT;
  _old_fp TEXT;
  _fp_hash BIGINT;
  _existing_id UUID;
BEGIN
  -- Fetch source task
  SELECT * INTO _src FROM kb_tasks WHERE id = p_source_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source task % not found', p_source_task_id;
  END IF;

  _pub_id := _src.published_task_id;
  IF _pub_id IS NULL THEN RETURN; END IF; -- not published, nothing to sync

  -- Compute new fingerprint
  _new_fp := kb_normalize_fingerprint(_src.text, _src.answer);

  -- Get old fingerprint from canonical copy
  SELECT fingerprint INTO _old_fp FROM kb_tasks WHERE id = _pub_id;

  -- If fingerprint changed, check for collisions
  IF _new_fp IS DISTINCT FROM _old_fp THEN
    _fp_hash := ('x' || left(md5(_new_fp), 16))::BIT(64)::BIGINT;
    PERFORM pg_advisory_xact_lock(_fp_hash);

    -- Check for existing active published task with same NEW fingerprint (not self)
    SELECT id INTO _existing_id
    FROM kb_tasks
    WHERE fingerprint = _new_fp
      AND owner_id IS NULL
      AND moderation_status = 'active'
      AND id != _pub_id
    LIMIT 1;

    IF _existing_id IS NOT NULL THEN
      RAISE EXCEPTION 'Edit blocked: fingerprint collision with task %. Identical task already exists in catalog.',
        _existing_id;
    END IF;
  END IF;

  -- Sync fields to canonical copy
  UPDATE kb_tasks SET
    topic_id = _src.topic_id,
    subtopic_id = _src.subtopic_id,
    exam = _src.exam,
    kim_number = _src.kim_number,
    primary_score = _src.primary_score,
    text = _src.text,
    answer = _src.answer,
    solution = _src.solution,
    answer_format = _src.answer_format,
    source_label = _src.source_label,
    attachment_url = _src.attachment_url,
    solution_attachment_url = _src.solution_attachment_url,
    fingerprint = _new_fp,
    updated_at = NOW()
  WHERE id = _pub_id;

  -- Audit log
  INSERT INTO kb_moderation_log (action, task_id, source_task_id, moderator_id, details)
  VALUES (
    'resync', _pub_id, p_source_task_id, _src.owner_id,
    jsonb_build_object(
      'old_fingerprint', _old_fp,
      'new_fingerprint', _new_fp
    )
  );
END;
$$;


-- ════════════════════════════════════════════
-- 7) BEFORE UPDATE trigger: block duplicate edits
--    If a published task in сократ tree is edited such that
--    the new fingerprint collides — RAISE EXCEPTION (atomic block).
-- ════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trg_fn_kb_before_update_block_dup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_fp TEXT;
  _fp_hash BIGINT;
  _existing_id UUID;
  _pub_id UUID;
BEGIN
  -- Only relevant for source tasks with a published copy in сократ tree
  IF NEW.published_task_id IS NULL THEN RETURN NEW; END IF;
  IF NOT kb_is_in_socrat_tree(NEW.folder_id) THEN RETURN NEW; END IF;

  -- Only check if text or answer changed
  IF NEW.text IS NOT DISTINCT FROM OLD.text
    AND NEW.answer IS NOT DISTINCT FROM OLD.answer
  THEN
    RETURN NEW;
  END IF;

  -- Compute new fingerprint
  _new_fp := kb_normalize_fingerprint(NEW.text, NEW.answer);
  _pub_id := NEW.published_task_id;

  -- Advisory lock
  _fp_hash := ('x' || left(md5(_new_fp), 16))::BIT(64)::BIGINT;
  PERFORM pg_advisory_xact_lock(_fp_hash);

  -- Check for collision with another active published task (not own copy)
  SELECT id INTO _existing_id
  FROM kb_tasks
  WHERE fingerprint = _new_fp
    AND owner_id IS NULL
    AND moderation_status = 'active'
    AND id != _pub_id
  LIMIT 1;

  IF _existing_id IS NOT NULL THEN
    RAISE EXCEPTION 'KB_DUPLICATE_BLOCKED: edit creates duplicate of task %. Save cancelled.', _existing_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_kb_before_update_block_dup
  BEFORE UPDATE ON public.kb_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_kb_before_update_block_dup();


-- ════════════════════════════════════════════
-- 8) AFTER UPDATE trigger: auto-publish + auto-resync
-- ════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trg_fn_kb_after_update_moderation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Prevent recursive trigger calls
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;

  -- CASE A: Task moved into сократ tree → auto-publish
  IF NEW.published_task_id IS NULL
    AND NEW.topic_id IS NOT NULL
    AND kb_is_in_socrat_tree(NEW.folder_id)
    AND has_role(NEW.owner_id, 'moderator')
    AND (
      OLD.folder_id IS DISTINCT FROM NEW.folder_id  -- folder changed
      OR (OLD.topic_id IS NULL AND NEW.topic_id IS NOT NULL)  -- topic_id just set
    )
  THEN
    PERFORM kb_publish_task(NEW.id);
    RETURN NEW;
  END IF;

  -- CASE B: Published task edited inside сократ → auto-resync
  IF NEW.published_task_id IS NOT NULL
    AND kb_is_in_socrat_tree(NEW.folder_id)
    AND (
      NEW.text IS DISTINCT FROM OLD.text
      OR NEW.answer IS DISTINCT FROM OLD.answer
      OR NEW.solution IS DISTINCT FROM OLD.solution
      OR NEW.answer_format IS DISTINCT FROM OLD.answer_format
      OR NEW.exam IS DISTINCT FROM OLD.exam
      OR NEW.kim_number IS DISTINCT FROM OLD.kim_number
      OR NEW.primary_score IS DISTINCT FROM OLD.primary_score
      OR NEW.topic_id IS DISTINCT FROM OLD.topic_id
      OR NEW.subtopic_id IS DISTINCT FROM OLD.subtopic_id
      OR NEW.source_label IS DISTINCT FROM OLD.source_label
      OR NEW.attachment_url IS DISTINCT FROM OLD.attachment_url
      OR NEW.solution_attachment_url IS DISTINCT FROM OLD.solution_attachment_url
    )
  THEN
    PERFORM kb_resync_task(NEW.id);
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_kb_after_update_moderation
  AFTER UPDATE ON public.kb_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_kb_after_update_moderation();


-- ════════════════════════════════════════════
-- 9) AFTER INSERT trigger: auto-publish for tasks created directly in сократ
-- ════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trg_fn_kb_after_insert_moderation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Prevent recursive trigger calls
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;

  -- Auto-publish if created directly in сократ tree with topic_id
  IF NEW.topic_id IS NOT NULL
    AND NEW.published_task_id IS NULL
    AND NEW.owner_id IS NOT NULL
    AND kb_is_in_socrat_tree(NEW.folder_id)
    AND has_role(NEW.owner_id, 'moderator')
  THEN
    PERFORM kb_publish_task(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_kb_after_insert_moderation
  AFTER INSERT ON public.kb_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_kb_after_insert_moderation();


-- ════════════════════════════════════════════
-- 10) RPC: Unpublish a catalog task (moderator action)
-- ════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.kb_mod_unpublish(p_published_task_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller_id UUID;
  _pub RECORD;
BEGIN
  _caller_id := auth.uid();
  IF _caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT has_role(_caller_id, 'moderator') THEN
    RAISE EXCEPTION 'Only moderators can unpublish tasks';
  END IF;

  -- Fetch published task
  SELECT * INTO _pub FROM kb_tasks WHERE id = p_published_task_id;
  IF NOT FOUND OR _pub.owner_id IS NOT NULL THEN
    RAISE EXCEPTION 'Published task % not found in catalog', p_published_task_id;
  END IF;

  -- Mark as unpublished
  UPDATE kb_tasks SET
    moderation_status = 'unpublished',
    hidden_reason = 'Unpublished by moderator ' || _caller_id::TEXT,
    updated_at = NOW()
  WHERE id = p_published_task_id;

  -- Unlink source task (but don't delete)
  UPDATE kb_tasks SET
    published_task_id = NULL,
    updated_at = NOW()
  WHERE published_task_id = p_published_task_id;

  -- NOTE: hidden duplicates do NOT auto-restore (requirement #9)

  -- Audit log
  INSERT INTO kb_moderation_log (action, task_id, source_task_id, moderator_id, details)
  VALUES (
    'unpublish', p_published_task_id, _pub.source_task_id, _caller_id,
    jsonb_build_object('previous_status', _pub.moderation_status)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.kb_mod_unpublish(UUID) TO authenticated;


-- ════════════════════════════════════════════
-- 11) RPC: Reassign source task for a catalog entry (moderator action)
--     Allows any moderator to change which source task backs a catalog entry.
-- ════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.kb_mod_reassign(
  p_published_task_id UUID,
  p_new_source_task_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller_id UUID;
  _pub RECORD;
  _new_src RECORD;
BEGIN
  _caller_id := auth.uid();
  IF _caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT has_role(_caller_id, 'moderator') THEN
    RAISE EXCEPTION 'Only moderators can reassign source tasks';
  END IF;

  -- Validate published task
  SELECT * INTO _pub FROM kb_tasks WHERE id = p_published_task_id;
  IF NOT FOUND OR _pub.owner_id IS NOT NULL THEN
    RAISE EXCEPTION 'Published task % not found in catalog', p_published_task_id;
  END IF;

  -- Validate new source task
  SELECT * INTO _new_src FROM kb_tasks WHERE id = p_new_source_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'New source task % not found', p_new_source_task_id;
  END IF;

  -- New source must belong to a moderator
  IF _new_src.owner_id IS NULL OR NOT has_role(_new_src.owner_id, 'moderator') THEN
    RAISE EXCEPTION 'New source task must belong to a moderator';
  END IF;

  -- New source must be in a сократ tree
  IF NOT kb_is_in_socrat_tree(_new_src.folder_id) THEN
    RAISE EXCEPTION 'New source task must be in a сократ folder';
  END IF;

  IF _new_src.published_task_id IS NOT NULL AND _new_src.published_task_id != p_published_task_id THEN
    RAISE EXCEPTION 'New source task is already linked to another published task %', _new_src.published_task_id;
  END IF;

  -- Unlink old source
  IF _pub.source_task_id IS NOT NULL THEN
    UPDATE kb_tasks SET
      published_task_id = NULL,
      updated_at = NOW()
    WHERE id = _pub.source_task_id;
  END IF;

  -- Link new source → published
  UPDATE kb_tasks SET
    published_task_id = p_published_task_id,
    updated_at = NOW()
  WHERE id = p_new_source_task_id;

  -- Update published task's source link
  UPDATE kb_tasks SET
    source_task_id = p_new_source_task_id,
    updated_at = NOW()
  WHERE id = p_published_task_id;

  -- Resync catalog copy from new source content immediately
  PERFORM kb_resync_task(p_new_source_task_id);

  -- Audit log
  INSERT INTO kb_moderation_log (action, task_id, source_task_id, moderator_id, details)
  VALUES (
    'reassign', p_published_task_id, p_new_source_task_id, _caller_id,
    jsonb_build_object(
      'old_source_task_id', _pub.source_task_id,
      'new_source_task_id', p_new_source_task_id
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.kb_mod_reassign(UUID, UUID) TO authenticated;


-- ════════════════════════════════════════════
-- 12) Audit log table
-- ════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.kb_moderation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,  -- publish, resync, unpublish, reassign, hide_duplicate
  task_id UUID,          -- canonical (published) task
  source_task_id UUID,   -- source task in moderator's folder
  moderator_id UUID NOT NULL REFERENCES auth.users(id),
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kb_mod_log_task ON public.kb_moderation_log(task_id);
CREATE INDEX IF NOT EXISTS idx_kb_mod_log_moderator ON public.kb_moderation_log(moderator_id);
CREATE INDEX IF NOT EXISTS idx_kb_mod_log_created ON public.kb_moderation_log(created_at);

ALTER TABLE public.kb_moderation_log ENABLE ROW LEVEL SECURITY;

-- Only moderators can read audit log
CREATE POLICY "KB mod log select moderators"
  ON public.kb_moderation_log
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'moderator'));

GRANT SELECT ON public.kb_moderation_log TO authenticated;


-- ════════════════════════════════════════════
-- 13) Update fetch_catalog_tasks_v2: remove live-sync UNION
--     Now reads ONLY canonical public tasks (owner_id=NULL, active)
-- ════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fetch_catalog_tasks_v2(p_topic_id UUID)
RETURNS SETOF public.kb_tasks
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.*
  FROM kb_tasks t
  WHERE t.topic_id = p_topic_id
    AND t.owner_id IS NULL
    AND t.moderation_status = 'active'
  ORDER BY t.created_at;
$$;

COMMENT ON FUNCTION public.fetch_catalog_tasks_v2 IS
  'Returns catalog tasks (owner_id=NULL, moderation_status=active) for a topic. '
  'V2: canonical public copies only, no live-sync from personal folders.';


-- ════════════════════════════════════════════
-- 14) Update kb_topics_with_counts view: filter by moderation_status
-- ════════════════════════════════════════════

CREATE OR REPLACE VIEW public.kb_topics_with_counts AS
SELECT
  t.id,
  t.name,
  t.section,
  t.exam,
  t.kim_numbers,
  t.sort_order,
  t.created_at,
  COALESCE(tc.task_count, 0)::INTEGER AS task_count,
  COALESCE(mc.material_count, 0)::INTEGER AS material_count,
  ARRAY(
    SELECT s.name FROM public.kb_subtopics s
    WHERE s.topic_id = t.id ORDER BY s.sort_order
  ) AS subtopic_names
FROM public.kb_topics t
LEFT JOIN (
  SELECT topic_id, COUNT(*)::INTEGER AS task_count
  FROM public.kb_tasks
  WHERE owner_id IS NULL AND moderation_status = 'active'
  GROUP BY topic_id
) tc ON tc.topic_id = t.id
LEFT JOIN (
  SELECT topic_id, COUNT(*)::INTEGER AS material_count
  FROM public.kb_materials
  WHERE owner_id IS NULL
  GROUP BY topic_id
) mc ON mc.topic_id = t.id;


-- ════════════════════════════════════════════
-- 15) Assign moderator roles to existing users
--     Uses user_roles table + app_role enum (already exist)
-- ════════════════════════════════════════════

DO $roles$
DECLARE
  _user_id UUID;
  _emails TEXT[] := ARRAY['egor.o.blinov@gmail.com', 'kamchatkinvova@gmail.com'];
  _email TEXT;
BEGIN
  FOREACH _email IN ARRAY _emails LOOP
    SELECT id INTO _user_id FROM auth.users WHERE email = _email LIMIT 1;

    IF _user_id IS NOT NULL THEN
      INSERT INTO public.user_roles (user_id, role)
      VALUES (_user_id, 'moderator')
      ON CONFLICT (user_id, role) DO NOTHING;
      RAISE NOTICE 'Assigned moderator role to %', _email;
    ELSE
      RAISE NOTICE 'User % not found — skipping role assignment', _email;
    END IF;
  END LOOP;
END $roles$;


-- ════════════════════════════════════════════
-- 16) Update promote_folder_to_catalog: use has_role instead of email check
-- ════════════════════════════════════════════

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

  -- Role-based check (no hardcoded emails)
  IF NOT has_role(_caller_id, 'moderator') THEN
    RAISE EXCEPTION 'Only moderators can promote tasks to catalog';
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
      moderation_status = 'active',
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
  'FALLBACK: Promotes tasks directly to catalog (owner_id=NULL). '
  'Preferred flow: move to сократ folder → auto-publish via trigger. '
  'Use promote only when moderator leaves or catalog independence needed.';


-- ════════════════════════════════════════════
-- 17) GRANTs for new functions
-- ════════════════════════════════════════════

GRANT EXECUTE ON FUNCTION public.kb_normalize_fingerprint(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kb_is_in_socrat_tree(UUID) TO authenticated;

-- SECURITY: revoke direct access to internal publish/resync functions.
-- They are called only by trigger functions (which run as table owner / postgres),
-- never directly by authenticated clients.
REVOKE EXECUTE ON FUNCTION public.kb_publish_task(UUID) FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.kb_resync_task(UUID) FROM PUBLIC, authenticated;


-- ════════════════════════════════════════════
-- 18) Tighten RLS: hide non-active catalog tasks from non-moderators
--     Replaces the original "KB tasks select public or own" policy
--     from 20260312120000_kb_knowledge_base.sql
-- ════════════════════════════════════════════

DROP POLICY IF EXISTS "KB tasks select public or own" ON public.kb_tasks;

CREATE POLICY "KB tasks select public or own"
  ON public.kb_tasks
  FOR SELECT
  TO authenticated
  USING (
    -- Personal tasks: owner can see all their own tasks
    owner_id = auth.uid()
    -- Catalog tasks: non-moderators see only active; moderators see all
    OR (
      owner_id IS NULL
      AND (moderation_status = 'active' OR has_role(auth.uid(), 'moderator'))
    )
  );
