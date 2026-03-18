-- KB Moderation V2: Source→Copy Model

-- 1) New columns on kb_tasks
ALTER TABLE public.kb_tasks ADD COLUMN IF NOT EXISTS published_task_id UUID
  REFERENCES public.kb_tasks(id) ON DELETE SET NULL;

ALTER TABLE public.kb_tasks ADD COLUMN IF NOT EXISTS source_task_id UUID
  REFERENCES public.kb_tasks(id) ON DELETE SET NULL;

ALTER TABLE public.kb_tasks ADD COLUMN IF NOT EXISTS fingerprint TEXT;

DO $$ BEGIN
  ALTER TABLE public.kb_tasks ADD COLUMN moderation_status TEXT NOT NULL DEFAULT 'active';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.kb_tasks ADD COLUMN hidden_reason TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.kb_tasks ADD COLUMN published_by UUID REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.kb_tasks ADD COLUMN published_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Constraint (idempotent)
DO $$ BEGIN
  ALTER TABLE public.kb_tasks ADD CONSTRAINT kb_tasks_moderation_status_check
    CHECK (moderation_status IN ('active', 'hidden_duplicate', 'unpublished'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2) Indexes
CREATE INDEX IF NOT EXISTS idx_kb_tasks_fingerprint
  ON public.kb_tasks(fingerprint) WHERE fingerprint IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_tasks_unique_source
  ON public.kb_tasks(source_task_id) WHERE source_task_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_tasks_unique_published
  ON public.kb_tasks(published_task_id) WHERE published_task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kb_tasks_moderation_status
  ON public.kb_tasks(moderation_status) WHERE owner_id IS NULL;

-- 3) Fingerprint normalization function
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

-- 4) Helper: check if folder is in socrat tree
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
    IF _parent_id IS NULL THEN
      RETURN _name = 'сократ' AND has_role(_owner_id, 'moderator');
    END IF;
    _current_id := _parent_id;
    _depth := _depth + 1;
    IF _depth > 20 THEN RETURN FALSE; END IF;
  END LOOP;
END;
$$;

-- 5) Core publish logic
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

  _fp := kb_normalize_fingerprint(_src.text, _src.answer);
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

-- 6) Core resync logic
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
  IF NOT FOUND THEN RAISE EXCEPTION 'Source task % not found', p_source_task_id; END IF;

  _pub_id := _src.published_task_id;
  IF _pub_id IS NULL THEN RETURN; END IF;

  _new_fp := kb_normalize_fingerprint(_src.text, _src.answer);
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