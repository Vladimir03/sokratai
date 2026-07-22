-- ВОЛНА 7.1 — перепубликация папки в ДРУГУЮ тему = перенос (инцидент Светланы №2, 2026-07-22)
--
-- Инцидент: Светлана опубликовала папки «Задание 6/7 ОГЭ» (78 задач) в тему
-- «Математика ОГЭ», которая оказалась subject='physics' (создана 15.07 через
-- physics-дефолт TopicEditorModal — ловушка закрыта фронтом ВОЛНЫ 7) → задачи
-- жили во вкладке «Физика», невидимо для «Математики». Повторная публикация в
-- правильную тему «Алгебра» вернула «Все задачи папки уже в каталоге»:
-- kb_publish_folder_to_catalog СКИПАЛ уже-опубликованные задачи, даже если
-- выбранная тема ДРУГАЯ. Из UI исправить было невозможно.
--
-- Фикс: для уже-опубликованной задачи с темой ≠ выбранной — UPDATE источника
-- (та же нормализация topic/subtopic/exam/kim, что у свежей публикации) →
-- триггер CASE B (topic_id изменился) вызывает kb_resync_task → каталожная
-- копия ПЕРЕЕЗЖАЕТ в выбранную тему. Считается в published_count («попала в
-- эту тему»). Тема совпадает → прежний skip. Возвратный shape НЕ менялся.
--
-- Ментальная модель модератора: «опубликовать папку в тему X» = «задачи папки
-- должны оказаться в теме X» — теперь RPC корректирующий, а не только аддитивный.
-- Данные Светланы починены отдельно (ретопик 78 задач + удаление мусорной темы).
--
-- База — verbatim 20260611130200 + retopic-ветка. Гранты — по инварианту
-- 20260722130000: GRANT authenticated/service_role → REVOKE PUBLIC → REVOKE anon.

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
      -- ВОЛНА 7.1: уже опубликована, но в ДРУГОЙ теме/подтеме → перенос.
      -- UPDATE источника фаерит CASE B (topic_id/subtopic_id изменились) →
      -- kb_resync_task переносит каталожную копию (включая hidden_duplicate).
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

-- Гранты — тройной порядок (инвариант 20260722130000 / rule 99):
GRANT EXECUTE ON FUNCTION public.kb_publish_folder_to_catalog(UUID, UUID, UUID) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kb_publish_folder_to_catalog(UUID, UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kb_publish_folder_to_catalog(UUID, UUID, UUID) FROM anon;
