
ALTER TABLE public.kb_tasks
  ADD COLUMN IF NOT EXISTS difficulty smallint
  CHECK (difficulty IS NULL OR (difficulty BETWEEN 1 AND 5));

DROP FUNCTION IF EXISTS public.kb_resync_task(uuid);
DROP FUNCTION IF EXISTS public.kb_publish_task(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.kb_publish_task(
  _source_task_id uuid,
  _topic_id uuid,
  _subtopic_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _src public.kb_tasks%ROWTYPE;
  _new_id uuid;
  _existing_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'moderator') THEN
    RAISE EXCEPTION 'Only moderators can publish tasks';
  END IF;

  SELECT * INTO _src FROM public.kb_tasks WHERE id = _source_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source task not found';
  END IF;

  SELECT published_task_id INTO _existing_id FROM public.kb_tasks WHERE id = _source_task_id;
  IF _existing_id IS NOT NULL THEN
    RETURN _existing_id;
  END IF;

  INSERT INTO public.kb_tasks (
    topic_id, subtopic_id, folder_id, owner_id,
    exam, kim_number, primary_score, difficulty,
    text, answer, solution, answer_format, check_format,
    source_label, attachment_url, solution_attachment_url,
    source_task_id, fingerprint, moderation_status,
    published_by, published_at
  ) VALUES (
    _topic_id, _subtopic_id, NULL, NULL,
    _src.exam, _src.kim_number, _src.primary_score, _src.difficulty,
    _src.text, _src.answer, _src.solution, _src.answer_format, _src.check_format,
    _src.source_label, _src.attachment_url, _src.solution_attachment_url,
    _source_task_id, _src.fingerprint, 'active',
    auth.uid(), now()
  )
  RETURNING id INTO _new_id;

  UPDATE public.kb_tasks SET published_task_id = _new_id WHERE id = _source_task_id;

  INSERT INTO public.kb_moderation_log (action, task_id, source_task_id, moderator_id, details)
  VALUES ('publish', _new_id, _source_task_id, auth.uid(), jsonb_build_object('topic_id', _topic_id, 'subtopic_id', _subtopic_id));

  RETURN _new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.kb_resync_task(_source_task_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _src public.kb_tasks%ROWTYPE;
  _pub_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'moderator') THEN
    RAISE EXCEPTION 'Only moderators can resync';
  END IF;

  SELECT * INTO _src FROM public.kb_tasks WHERE id = _source_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source task not found';
  END IF;

  _pub_id := _src.published_task_id;
  IF _pub_id IS NULL THEN
    RAISE EXCEPTION 'Task is not published';
  END IF;

  UPDATE public.kb_tasks SET
    exam = _src.exam,
    kim_number = _src.kim_number,
    primary_score = _src.primary_score,
    difficulty = _src.difficulty,
    text = _src.text,
    answer = _src.answer,
    solution = _src.solution,
    answer_format = _src.answer_format,
    check_format = _src.check_format,
    source_label = _src.source_label,
    attachment_url = _src.attachment_url,
    solution_attachment_url = _src.solution_attachment_url,
    fingerprint = _src.fingerprint,
    updated_at = now()
  WHERE id = _pub_id;

  INSERT INTO public.kb_moderation_log (action, task_id, source_task_id, moderator_id, details)
  VALUES ('resync', _pub_id, _source_task_id, auth.uid(), '{}'::jsonb);

  RETURN _pub_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_kb_after_update_moderation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.published_task_id IS NOT NULL AND NEW.source_task_id IS NULL THEN
    UPDATE public.kb_tasks SET
      exam = NEW.exam,
      kim_number = NEW.kim_number,
      primary_score = NEW.primary_score,
      difficulty = NEW.difficulty,
      text = NEW.text,
      answer = NEW.answer,
      solution = NEW.solution,
      answer_format = NEW.answer_format,
      check_format = NEW.check_format,
      source_label = NEW.source_label,
      attachment_url = NEW.attachment_url,
      solution_attachment_url = NEW.solution_attachment_url,
      fingerprint = NEW.fingerprint,
      updated_at = now()
    WHERE id = NEW.published_task_id;
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
