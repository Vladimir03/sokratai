CREATE OR REPLACE FUNCTION public.kb_publish_folder_to_catalog(
  p_folder_id UUID,
  p_topic_id UUID,
  p_subtopic_id UUID DEFAULT NULL
)
RETURNS TABLE(published_count INT, skipped_count INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _caller UUID;
  _folder_owner UUID;
  _topic_kind TEXT;
  _topic_exam exam_type;
  _task RECORD;
  _pub UUID;
  _published INT := 0;
  _skipped INT := 0;
BEGIN
  _caller := public.kb_require_moderator();

  SELECT owner_id INTO _folder_owner FROM public.kb_folders WHERE id = p_folder_id;
  IF _folder_owner IS NULL THEN
    RAISE EXCEPTION 'Папка не найдена';
  END IF;
  IF _folder_owner <> _caller THEN
    RAISE EXCEPTION 'Публиковать можно только свою папку';
  END IF;

  SELECT kind, exam INTO _topic_kind, _topic_exam FROM public.kb_topics WHERE id = p_topic_id;
  IF _topic_kind IS NULL THEN
    RAISE EXCEPTION 'Тема не найдена';
  END IF;
  IF p_subtopic_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.kb_subtopics WHERE id = p_subtopic_id AND topic_id = p_topic_id
  ) THEN
    RAISE EXCEPTION 'Подтема не относится к выбранной теме';
  END IF;

  FOR _task IN
    SELECT id, published_task_id, topic_id, subtopic_id
    FROM public.kb_tasks
    WHERE folder_id = p_folder_id AND owner_id = _caller
    ORDER BY created_at
  LOOP
    IF _task.published_task_id IS NOT NULL THEN
      IF _task.topic_id IS DISTINCT FROM p_topic_id
         OR _task.subtopic_id IS DISTINCT FROM p_subtopic_id THEN
        UPDATE public.kb_tasks
        SET topic_id    = p_topic_id,
            subtopic_id = p_subtopic_id,
            exam        = _topic_exam,
            kim_number  = CASE WHEN _topic_kind = 'olympiad' THEN NULL ELSE kim_number END,
            updated_at  = NOW()
        WHERE id = _task.id;
        _published := _published + 1;
      ELSE
        _skipped := _skipped + 1;
      END IF;
      CONTINUE;
    END IF;

    UPDATE public.kb_tasks
    SET topic_id    = p_topic_id,
        subtopic_id = p_subtopic_id,
        exam        = _topic_exam,
        kim_number  = CASE WHEN _topic_kind = 'olympiad' THEN NULL ELSE kim_number END,
        updated_at  = NOW()
    WHERE id = _task.id;

    SELECT published_task_id INTO _pub FROM public.kb_tasks WHERE id = _task.id;
    IF _pub IS NULL THEN
      PERFORM public.kb_publish_task(_task.id);
    END IF;
    _published := _published + 1;
  END LOOP;

  UPDATE public.kb_folders
  SET catalog_topic_id = p_topic_id,
      catalog_subtopic_id = p_subtopic_id
  WHERE id = p_folder_id;

  published_count := _published;
  skipped_count := _skipped;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kb_publish_folder_to_catalog(UUID, UUID, UUID) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kb_publish_folder_to_catalog(UUID, UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kb_publish_folder_to_catalog(UUID, UUID, UUID) FROM anon;