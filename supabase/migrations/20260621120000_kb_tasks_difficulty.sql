-- ══════════════════════════════════════════════════════════════
-- kb_tasks.difficulty — уровень сложности олимпиадной задачи (1–5)
--
-- Запрос Егора Блинова: у олимпиадных задач аналог № КИМ — уровень
-- сложности 1–5, который ОДНОВРЕМЕННО является баллом за задачу.
-- (1 — очень лёгкая = 1 балл … 5 — очень сложная = 5 баллов.)
--
-- Аддитивно. difficulty — КЛАССИФИКАЦИЯ (не рубрика) → безопасно копировать
-- в каталог при публикации. Поэтому добавляем её в column-lists
-- kb_publish_task / kb_resync_task + в условие resync-триггера (CASE B),
-- иначе опубликованные олимпиадные задачи теряли бы сложность в каталоге.
--
-- Базовые версии функций — последние на момент написания:
--   kb_publish_task / kb_resync_task → 20260330130615 (3-арг fingerprint)
--   trg_fn_kb_after_update_moderation → 20260611130200/181252 (broadened resync)
-- Тела скопированы verbatim, добавлено ТОЛЬКО difficulty (без регрессий).
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- 1) Колонка
ALTER TABLE public.kb_tasks ADD COLUMN IF NOT EXISTS difficulty SMALLINT;

DO $$ BEGIN
  ALTER TABLE public.kb_tasks
    ADD CONSTRAINT kb_tasks_difficulty_check CHECK (difficulty IS NULL OR difficulty BETWEEN 1 AND 5);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.kb_tasks.difficulty IS
  'Уровень сложности олимпиадной задачи 1–5 (= балл за задачу). NULL для ЕГЭ/ОГЭ (там балл по № КИМ).';

-- 2) kb_publish_task — добавлен difficulty в INSERT (column + value).
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
    exam, kim_number, primary_score, difficulty,
    text, answer, solution, answer_format,
    source_label, attachment_url, solution_attachment_url,
    source_task_id, fingerprint, moderation_status, hidden_reason,
    published_by, published_at, created_at, updated_at
  ) VALUES (
    _src.topic_id, _src.subtopic_id, NULL, NULL,
    _src.exam, _src.kim_number, _src.primary_score, _src.difficulty,
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

-- 3) kb_resync_task — добавлен difficulty в UPDATE.
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
    difficulty = _src.difficulty,
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

-- 4) resync-триггер: правка ТОЛЬКО difficulty опубликованного источника тоже
--    синхронит каталог. Базовая версия — 20260611181252; добавлено ОДНО условие.
CREATE OR REPLACE FUNCTION public.trg_fn_kb_after_update_moderation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NEW.published_task_id IS NULL
    AND NEW.topic_id IS NOT NULL
    AND kb_is_in_socrat_tree(NEW.folder_id)
    AND has_role(NEW.owner_id, 'moderator')
    AND (OLD.folder_id IS DISTINCT FROM NEW.folder_id OR (OLD.topic_id IS NULL AND NEW.topic_id IS NOT NULL))
  THEN PERFORM kb_publish_task(NEW.id); RETURN NEW; END IF;
  IF NEW.published_task_id IS NOT NULL
    AND (NEW.text IS DISTINCT FROM OLD.text
      OR NEW.answer IS DISTINCT FROM OLD.answer
      OR NEW.solution IS DISTINCT FROM OLD.solution
      OR NEW.answer_format IS DISTINCT FROM OLD.answer_format
      OR NEW.exam IS DISTINCT FROM OLD.exam
      OR NEW.kim_number IS DISTINCT FROM OLD.kim_number
      OR NEW.primary_score IS DISTINCT FROM OLD.primary_score
      OR NEW.difficulty IS DISTINCT FROM OLD.difficulty
      OR NEW.topic_id IS DISTINCT FROM OLD.topic_id
      OR NEW.subtopic_id IS DISTINCT FROM OLD.subtopic_id
      OR NEW.source_label IS DISTINCT FROM OLD.source_label
      OR NEW.attachment_url IS DISTINCT FROM OLD.attachment_url
      OR NEW.solution_attachment_url IS DISTINCT FROM OLD.solution_attachment_url)
  THEN PERFORM kb_resync_task(NEW.id); RETURN NEW; END IF;
  RETURN NEW;
END; $$;

COMMIT;
