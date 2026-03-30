-- Fix: include attachment_url in fingerprint to prevent false duplicates

-- 1) Update fingerprint function to include attachment_url
CREATE OR REPLACE FUNCTION public.kb_normalize_fingerprint(p_text TEXT, p_answer TEXT, p_attachment_url TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT md5(
    regexp_replace(lower(COALESCE(p_text, '')), '\s+', '', 'g')
    || '::' ||
    regexp_replace(lower(COALESCE(p_answer, '')), '\s+', '', 'g')
    || '::' ||
    COALESCE(p_attachment_url, '')
  );
$$;

-- 2) Update kb_publish_task to pass attachment_url
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
  SELECT * INTO _src FROM kb_tasks WHERE id = p_source_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source task % not found', p_source_task_id;
  END IF;
  IF _src.topic_id IS NULL THEN
    RAISE EXCEPTION 'Cannot publish task without topic_id';
  END IF;
  IF _src.published_task_id IS NOT NULL THEN
    RAISE EXCEPTION 'Task % is already published as %', p_source_task_id, _src.published_task_id;
  END IF;

  _fp := kb_normalize_fingerprint(_src.text, _src.answer, _src.attachment_url);
  _fp_hash := ('x' || left(md5(_fp), 16))::BIT(64)::BIGINT;
  PERFORM pg_advisory_xact_lock(_fp_hash);

  SELECT id INTO _existing_id
  FROM kb_tasks
  WHERE fingerprint = _fp AND owner_id IS NULL AND moderation_status = 'active'
  LIMIT 1;

  IF _existing_id IS NOT NULL THEN
    _status := 'hidden_duplicate';
    _reason := 'duplicate of ' || _existing_id::TEXT;
  END IF;

  INSERT INTO kb_tasks (
    topic_id, subtopic_id, owner_id, folder_id,
    exam, kim_number, primary_score,
    text, answer, solution, answer_format,
    source_label, attachment_url, solution_attachment_url,
    source_task_id, fingerprint, moderation_status, hidden_reason,
    published_by, published_at, created_at, updated_at
  ) VALUES (
    _src.topic_id, _src.subtopic_id, NULL, NULL,
    _src.exam, _src.kim_number, _src.primary_score,
    _src.text, _src.answer, _src.solution, _src.answer_format,
    _src.source_label, _src.attachment_url, _src.solution_attachment_url,
    p_source_task_id, _fp, _status, _reason,
    _src.owner_id, NOW(), NOW(), NOW()
  )
  RETURNING id INTO _new_id;

  UPDATE kb_tasks SET published_task_id = _new_id, updated_at = NOW()
  WHERE id = p_source_task_id;

  INSERT INTO kb_moderation_log (action, task_id, source_task_id, moderator_id, details)
  VALUES ('publish', _new_id, p_source_task_id, _src.owner_id,
    jsonb_build_object('fingerprint', _fp, 'status', _status, 'hidden_reason', _reason));

  RETURN _new_id;
END;
$$;

-- 3) Update kb_resync_task to pass attachment_url
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
  SELECT * INTO _src FROM kb_tasks WHERE id = p_source_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source task % not found', p_source_task_id;
  END IF;

  _pub_id := _src.published_task_id;
  IF _pub_id IS NULL THEN RETURN; END IF;

  _new_fp := kb_normalize_fingerprint(_src.text, _src.answer, _src.attachment_url);
  SELECT fingerprint INTO _old_fp FROM kb_tasks WHERE id = _pub_id;

  IF _new_fp IS DISTINCT FROM _old_fp THEN
    _fp_hash := ('x' || left(md5(_new_fp), 16))::BIT(64)::BIGINT;
    PERFORM pg_advisory_xact_lock(_fp_hash);
    SELECT id INTO _existing_id FROM kb_tasks
    WHERE fingerprint = _new_fp AND owner_id IS NULL AND moderation_status = 'active' AND id != _pub_id
    LIMIT 1;
    IF _existing_id IS NOT NULL THEN
      RAISE EXCEPTION 'Edit blocked: fingerprint collision with task %', _existing_id;
    END IF;
  END IF;

  UPDATE kb_tasks SET
    topic_id = _src.topic_id, subtopic_id = _src.subtopic_id,
    exam = _src.exam, kim_number = _src.kim_number, primary_score = _src.primary_score,
    text = _src.text, answer = _src.answer, solution = _src.solution,
    answer_format = _src.answer_format, source_label = _src.source_label,
    attachment_url = _src.attachment_url, solution_attachment_url = _src.solution_attachment_url,
    fingerprint = _new_fp, updated_at = NOW()
  WHERE id = _pub_id;

  INSERT INTO kb_moderation_log (action, task_id, source_task_id, moderator_id, details)
  VALUES ('resync', _pub_id, p_source_task_id, _src.owner_id,
    jsonb_build_object('old_fingerprint', _old_fp, 'new_fingerprint', _new_fp));
END;
$$;

-- 4) Update block-dup trigger to include attachment_url
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

  IF NEW.text IS NOT DISTINCT FROM OLD.text
    AND NEW.answer IS NOT DISTINCT FROM OLD.answer
    AND NEW.attachment_url IS NOT DISTINCT FROM OLD.attachment_url
  THEN
    RETURN NEW;
  END IF;

  _new_fp := kb_normalize_fingerprint(NEW.text, NEW.answer, NEW.attachment_url);
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

-- 5) Recompute fingerprints on ALL catalog tasks
UPDATE kb_tasks
SET fingerprint = kb_normalize_fingerprint(text, answer, attachment_url),
    updated_at = NOW()
WHERE owner_id IS NULL
  AND fingerprint IS NOT NULL;

-- 6) Retroactively unhide false duplicates
UPDATE kb_tasks
SET moderation_status = 'active',
    hidden_reason = NULL,
    updated_at = NOW()
WHERE owner_id IS NULL
  AND moderation_status = 'hidden_duplicate'
  AND NOT EXISTS (
    SELECT 1 FROM kb_tasks other
    WHERE other.fingerprint = kb_tasks.fingerprint
      AND other.owner_id IS NULL
      AND other.moderation_status = 'active'
      AND other.id != kb_tasks.id
  );