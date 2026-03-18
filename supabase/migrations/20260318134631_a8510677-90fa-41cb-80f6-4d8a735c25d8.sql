-- KB Moderation V2 part 2: Triggers, RPCs, audit log, RLS

-- 7) BEFORE UPDATE trigger: block duplicate edits
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
  IF NEW.published_task_id IS NULL THEN RETURN NEW; END IF;
  IF NOT kb_is_in_socrat_tree(NEW.folder_id) THEN RETURN NEW; END IF;
  IF NEW.text IS NOT DISTINCT FROM OLD.text AND NEW.answer IS NOT DISTINCT FROM OLD.answer THEN
    RETURN NEW;
  END IF;

  _new_fp := kb_normalize_fingerprint(NEW.text, NEW.answer);
  _pub_id := NEW.published_task_id;
  _fp_hash := ('x' || left(md5(_new_fp), 16))::BIT(64)::BIGINT;
  PERFORM pg_advisory_xact_lock(_fp_hash);

  SELECT id INTO _existing_id FROM kb_tasks
  WHERE fingerprint = _new_fp AND owner_id IS NULL AND moderation_status = 'active' AND id != _pub_id
  LIMIT 1;

  IF _existing_id IS NOT NULL THEN
    RAISE EXCEPTION 'KB_DUPLICATE_BLOCKED: edit creates duplicate of task %. Save cancelled.', _existing_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_kb_before_update_block_dup ON public.kb_tasks;
CREATE TRIGGER trg_kb_before_update_block_dup
  BEFORE UPDATE ON public.kb_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_kb_before_update_block_dup();

-- 8) AFTER UPDATE trigger: auto-publish + auto-resync
CREATE OR REPLACE FUNCTION public.trg_fn_kb_after_update_moderation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;

  IF NEW.published_task_id IS NULL
    AND NEW.topic_id IS NOT NULL
    AND kb_is_in_socrat_tree(NEW.folder_id)
    AND has_role(NEW.owner_id, 'moderator')
    AND (OLD.folder_id IS DISTINCT FROM NEW.folder_id OR (OLD.topic_id IS NULL AND NEW.topic_id IS NOT NULL))
  THEN
    PERFORM kb_publish_task(NEW.id);
    RETURN NEW;
  END IF;

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

DROP TRIGGER IF EXISTS trg_kb_after_update_moderation ON public.kb_tasks;
CREATE TRIGGER trg_kb_after_update_moderation
  AFTER UPDATE ON public.kb_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_kb_after_update_moderation();

-- 9) AFTER INSERT trigger: auto-publish for tasks created directly in socrat
CREATE OR REPLACE FUNCTION public.trg_fn_kb_after_insert_moderation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
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

DROP TRIGGER IF EXISTS trg_kb_after_insert_moderation ON public.kb_tasks;
CREATE TRIGGER trg_kb_after_insert_moderation
  AFTER INSERT ON public.kb_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_kb_after_insert_moderation();

-- 10) RPC: Unpublish
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
  IF _caller_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT has_role(_caller_id, 'moderator') THEN RAISE EXCEPTION 'Only moderators can unpublish tasks'; END IF;

  SELECT * INTO _pub FROM kb_tasks WHERE id = p_published_task_id;
  IF NOT FOUND OR _pub.owner_id IS NOT NULL THEN
    RAISE EXCEPTION 'Published task % not found in catalog', p_published_task_id;
  END IF;

  UPDATE kb_tasks SET moderation_status = 'unpublished',
    hidden_reason = 'Unpublished by moderator ' || _caller_id::TEXT, updated_at = NOW()
  WHERE id = p_published_task_id;

  UPDATE kb_tasks SET published_task_id = NULL, updated_at = NOW()
  WHERE published_task_id = p_published_task_id;

  INSERT INTO kb_moderation_log (action, task_id, source_task_id, moderator_id, details)
  VALUES ('unpublish', p_published_task_id, _pub.source_task_id, _caller_id,
    jsonb_build_object('previous_status', _pub.moderation_status));
END;
$$;

GRANT EXECUTE ON FUNCTION public.kb_mod_unpublish(UUID) TO authenticated;

-- 11) RPC: Reassign
CREATE OR REPLACE FUNCTION public.kb_mod_reassign(p_published_task_id UUID, p_new_source_task_id UUID)
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
  IF _caller_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT has_role(_caller_id, 'moderator') THEN RAISE EXCEPTION 'Only moderators can reassign source tasks'; END IF;

  SELECT * INTO _pub FROM kb_tasks WHERE id = p_published_task_id;
  IF NOT FOUND OR _pub.owner_id IS NOT NULL THEN
    RAISE EXCEPTION 'Published task % not found in catalog', p_published_task_id;
  END IF;

  SELECT * INTO _new_src FROM kb_tasks WHERE id = p_new_source_task_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'New source task % not found', p_new_source_task_id; END IF;
  IF _new_src.owner_id IS NULL OR NOT has_role(_new_src.owner_id, 'moderator') THEN
    RAISE EXCEPTION 'New source task must belong to a moderator';
  END IF;
  IF NOT kb_is_in_socrat_tree(_new_src.folder_id) THEN
    RAISE EXCEPTION 'New source task must be in a сократ folder';
  END IF;
  IF _new_src.published_task_id IS NOT NULL AND _new_src.published_task_id != p_published_task_id THEN
    RAISE EXCEPTION 'New source task is already linked to another published task %', _new_src.published_task_id;
  END IF;

  IF _pub.source_task_id IS NOT NULL THEN
    UPDATE kb_tasks SET published_task_id = NULL, updated_at = NOW() WHERE id = _pub.source_task_id;
  END IF;

  UPDATE kb_tasks SET published_task_id = p_published_task_id, updated_at = NOW() WHERE id = p_new_source_task_id;
  UPDATE kb_tasks SET source_task_id = p_new_source_task_id, updated_at = NOW() WHERE id = p_published_task_id;

  PERFORM kb_resync_task(p_new_source_task_id);

  INSERT INTO kb_moderation_log (action, task_id, source_task_id, moderator_id, details)
  VALUES ('reassign', p_published_task_id, p_new_source_task_id, _caller_id,
    jsonb_build_object('old_source_task_id', _pub.source_task_id, 'new_source_task_id', p_new_source_task_id));
END;
$$;

GRANT EXECUTE ON FUNCTION public.kb_mod_reassign(UUID, UUID) TO authenticated;

-- 12) Audit log table
CREATE TABLE IF NOT EXISTS public.kb_moderation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  task_id UUID,
  source_task_id UUID,
  moderator_id UUID NOT NULL REFERENCES auth.users(id),
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kb_mod_log_task ON public.kb_moderation_log(task_id);
CREATE INDEX IF NOT EXISTS idx_kb_mod_log_moderator ON public.kb_moderation_log(moderator_id);
CREATE INDEX IF NOT EXISTS idx_kb_mod_log_created ON public.kb_moderation_log(created_at);

ALTER TABLE public.kb_moderation_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "KB mod log select moderators" ON public.kb_moderation_log;
CREATE POLICY "KB mod log select moderators"
  ON public.kb_moderation_log FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'moderator'));

GRANT SELECT ON public.kb_moderation_log TO authenticated;

-- 13) Update fetch_catalog_tasks_v2: only active catalog tasks
CREATE OR REPLACE FUNCTION public.fetch_catalog_tasks_v2(p_topic_id UUID)
RETURNS SETOF public.kb_tasks
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.* FROM kb_tasks t
  WHERE t.topic_id = p_topic_id AND t.owner_id IS NULL AND t.moderation_status = 'active'
  ORDER BY t.created_at;
$$;

-- 14) Update view: filter by moderation_status
CREATE OR REPLACE VIEW public.kb_topics_with_counts AS
SELECT
  t.id, t.name, t.section, t.exam, t.kim_numbers, t.sort_order, t.created_at,
  COALESCE(tc.task_count, 0)::INTEGER AS task_count,
  COALESCE(mc.material_count, 0)::INTEGER AS material_count,
  ARRAY(SELECT s.name FROM public.kb_subtopics s WHERE s.topic_id = t.id ORDER BY s.sort_order) AS subtopic_names
FROM public.kb_topics t
LEFT JOIN (
  SELECT topic_id, COUNT(*)::INTEGER AS task_count FROM public.kb_tasks
  WHERE owner_id IS NULL AND moderation_status = 'active' GROUP BY topic_id
) tc ON tc.topic_id = t.id
LEFT JOIN (
  SELECT topic_id, COUNT(*)::INTEGER AS material_count FROM public.kb_materials
  WHERE owner_id IS NULL GROUP BY topic_id
) mc ON mc.topic_id = t.id;

-- 15) Assign moderator roles
DO $roles$
DECLARE
  _user_id UUID;
  _emails TEXT[] := ARRAY['egor.o.blinov@gmail.com', 'kamchatkinvova@gmail.com'];
  _email TEXT;
BEGIN
  FOREACH _email IN ARRAY _emails LOOP
    SELECT id INTO _user_id FROM auth.users WHERE email = _email LIMIT 1;
    IF _user_id IS NOT NULL THEN
      INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, 'moderator')
      ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
  END LOOP;
END $roles$;

-- 16) Update promote_folder_to_catalog with has_role
CREATE OR REPLACE FUNCTION public.promote_folder_to_catalog(
  p_folder_id UUID, p_topic_id UUID, p_subtopic_id UUID DEFAULT NULL, p_source_label TEXT DEFAULT NULL
)
RETURNS TABLE(promoted_count INT, task_ids UUID[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _caller_id UUID; _folder_owner UUID; _promoted UUID[]; _count INT;
BEGIN
  _caller_id := auth.uid();
  IF _caller_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT owner_id INTO _folder_owner FROM public.kb_folders WHERE id = p_folder_id;
  IF _folder_owner IS NULL THEN RAISE EXCEPTION 'Folder % not found', p_folder_id; END IF;
  IF _folder_owner != _caller_id THEN RAISE EXCEPTION 'Only folder owner can promote tasks'; END IF;
  IF NOT has_role(_caller_id, 'moderator') THEN RAISE EXCEPTION 'Only moderators can promote tasks to catalog'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.kb_topics WHERE id = p_topic_id) THEN RAISE EXCEPTION 'Topic % not found', p_topic_id; END IF;

  IF p_subtopic_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.kb_subtopics WHERE id = p_subtopic_id AND topic_id = p_topic_id) THEN
      RAISE EXCEPTION 'Subtopic % not found in topic %', p_subtopic_id, p_topic_id;
    END IF;
  END IF;

  WITH promoted AS (
    UPDATE public.kb_tasks SET
      owner_id = NULL, folder_id = NULL, topic_id = p_topic_id,
      subtopic_id = COALESCE(p_subtopic_id, subtopic_id),
      source_label = COALESCE(p_source_label, source_label, 'demidova_2025'),
      moderation_status = 'active', updated_at = NOW()
    WHERE folder_id = p_folder_id AND owner_id = _folder_owner
    RETURNING id
  )
  SELECT ARRAY_AGG(id), COUNT(*)::INT INTO _promoted, _count FROM promoted;

  promoted_count := COALESCE(_count, 0);
  task_ids := COALESCE(_promoted, ARRAY[]::UUID[]);
  RETURN NEXT;
END;
$$;

-- 17) GRANTs
GRANT EXECUTE ON FUNCTION public.kb_normalize_fingerprint(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kb_is_in_socrat_tree(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.kb_publish_task(UUID) FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.kb_resync_task(UUID) FROM PUBLIC, authenticated;

-- 18) Tighten RLS
DROP POLICY IF EXISTS "KB tasks select public or own" ON public.kb_tasks;
CREATE POLICY "KB tasks select public or own"
  ON public.kb_tasks FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR (owner_id IS NULL AND (moderation_status = 'active' OR has_role(auth.uid(), 'moderator')))
  );