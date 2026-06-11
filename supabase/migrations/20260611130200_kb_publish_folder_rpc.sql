-- ══════════════════════════════════════════════════════════════
-- kb_publish_folder_to_catalog — публикация личной папки в каталог
--
-- Модель source→copy (НЕ destructive promote_folder_to_catalog):
-- личная папка модератора остаётся редактируемым источником, каталог —
-- её опубликованная проекция. Для каждой задачи папки проставляем
-- тему/подтему и зовём существующий kb_publish_task (копирует whitelist
-- колонок БЕЗ рубрики — rule 50, fingerprint-dedup, audit-лог).
-- Уже опубликованные (published_task_id IS NOT NULL) — пропускаем
-- (идемпотентная повторная публикация после добавления задач).
-- ══════════════════════════════════════════════════════════════

BEGIN;

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
    SELECT id, published_task_id
    FROM public.kb_tasks
    WHERE folder_id = p_folder_id AND owner_id = _caller
    ORDER BY created_at
  LOOP
    IF _task.published_task_id IS NOT NULL THEN
      _skipped := _skipped + 1;
      CONTINUE;
    END IF;

    -- Проставляем тему/подтему на источник и нормализуем exam/kim по теме:
    --  • subtopic_id = p_subtopic_id напрямую (НЕ COALESCE) — иначе осталась бы
    --    подтема от старой темы (review P2-1).
    --  • exam = exam темы (NULL у олимпиадных); kim_number обнуляем у олимпиадных
    --    (review P2-2) — иначе экзам-задачи выпадали из поиска, а у олимпиадных
    --    оставался КИМ-маркер.
    UPDATE public.kb_tasks
    SET topic_id    = p_topic_id,
        subtopic_id = p_subtopic_id,
        exam        = _topic_exam,
        kim_number  = CASE WHEN _topic_kind = 'olympiad' THEN NULL ELSE kim_number END,
        updated_at  = NOW()
    WHERE id = _task.id;

    -- Папка может лежать в дереве «сократ» → UPDATE выше уже мог авто-опубликовать
    -- задачу через CASE A триггера trg_fn_kb_after_update_moderation. Перечитываем
    -- published_task_id и зовём kb_publish_task ТОЛЬКО если ещё NULL — иначе он
    -- упадёт «already published» и откатит весь батч (review P1-2).
    SELECT published_task_id INTO _pub FROM public.kb_tasks WHERE id = _task.id;
    IF _pub IS NULL THEN
      PERFORM public.kb_publish_task(_task.id);
    END IF;
    _published := _published + 1;
  END LOOP;

  -- Папка «помнит» тему публикации → повторная публикация в один клик.
  UPDATE public.kb_folders
  SET catalog_topic_id = p_topic_id,
      catalog_subtopic_id = p_subtopic_id
  WHERE id = p_folder_id;

  published_count := _published;
  skipped_count := _skipped;
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.kb_publish_folder_to_catalog(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kb_publish_folder_to_catalog(UUID, UUID, UUID) TO authenticated;

-- ── Broaden resync: правка опубликованного источника синхронит каталог
--    из ЛЮБОЙ папки (раньше — только из дерева «сократ»).
--    CASE A (auto-publish при переносе в «сократ») НЕ трогаем.
--    kb_resync_task сам проверяет коллизии fingerprint (RAISE при дубле).
CREATE OR REPLACE FUNCTION public.trg_fn_kb_after_update_moderation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Prevent recursive trigger calls
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;

  -- CASE A: Task moved into сократ tree → auto-publish (unchanged)
  IF NEW.published_task_id IS NULL
    AND NEW.topic_id IS NOT NULL
    AND kb_is_in_socrat_tree(NEW.folder_id)
    AND has_role(NEW.owner_id, 'moderator')
    AND (
      OLD.folder_id IS DISTINCT FROM NEW.folder_id
      OR (OLD.topic_id IS NULL AND NEW.topic_id IS NOT NULL)
    )
  THEN
    PERFORM kb_publish_task(NEW.id);
    RETURN NEW;
  END IF;

  -- CASE B: Published source edited → resync (из любой папки, не только сократ)
  IF NEW.published_task_id IS NOT NULL
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

COMMIT;
