-- ══════════════════════════════════════════════════════════════
-- KB moderator hard-delete задачи из каталога (запрос Милады, 2026-07-22)
--
-- «Разделы и темы удаляются, это супер! А можно ещё удалять задания из общего
-- банка. Не "скрыть", а вообще удалить?» Решение владельца: своя задача —
-- удаляются ОБЕ строки (каталожная копия + исходник в личной базе), безвозвратно;
-- orphan-копия — удаляется копия; чужой исходник — блок (работу другого
-- модератора не трогаем). «Перенести в Мою базу» (ВОЛНА 6) остаётся путём
-- «убрать из каталога, сохранив контент».
--
-- Ключевые решения (Plan-ревью 2026-07-22):
--  • Строгая reciprocity сделала бы `unpublished`-строки НЕудаляемыми:
--    kb_mod_unpublish (20260318150000) рвёт связь ОДНОСТОРОННЕ (source.published
--    → NULL, но copy.source_task_id остаётся) → нужна detached-ветка (copy-only).
--  • own-source: удаляем копию ПЕРВОЙ. RI ON DELETE SET NULL проставит
--    source.published_task_id=NULL (BEFORE-dup-триггер early-return'ится на
--    published IS NULL; CASE A не матчится — нет folder/topic-перехода; CASE B
--    гейтится published NOT NULL) — источник умирает следующим стейтментом.
--  • Гард шаблонов (homework_template_tasks.kb_task_id ON DELETE RESTRICT) — на
--    ОБА id (копию и источник), count-only (никаких названий чужих шаблонов).
--  • Blob'ы storage НЕ чистим: attachment_url может шариться с личными копиями
--    («К себе» / orphan-INSERT переноса) — тот же принятый долг, что у ВОЛНЫ 6.
--  • Аудит: kb_moderation_log action='hard_delete' (безвозвратное уничтожение
--    контента обязано логироваться; FK на task-ids у лога нет — безопасно).
--  • Гранты: тройной набор ЗДЕСЬ ЖЕ — DO-блок 20260722130000 отработал разово
--    по существовавшим функциям, новые kb_mod_* получают дефолтный anon EXECUTE.
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Preflight-превью для confirm-диалога ───────────────────────────────────
-- Клиент НЕ может определить ветку сам: RLS прячет чужие личные строки (owner
-- исходника не виден). branch: own_source | own_source_detached | orphan |
-- foreign | link_broken. template_count/source_template_count — для disable
-- кнопки с русским объяснением до вызова мутации.
CREATE OR REPLACE FUNCTION public.kb_mod_preview_delete_task(p_task_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _c public.kb_tasks%ROWTYPE; _subject TEXT; _caller UUID;
  _src_owner UUID; _src_pub UUID; _tpl INT; _src_tpl INT := 0; _branch TEXT;
BEGIN
  SELECT * INTO _c FROM public.kb_tasks WHERE id = p_task_id AND owner_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Задача не найдена в каталоге'; END IF;
  SELECT subject INTO _subject FROM public.kb_topics WHERE id = _c.topic_id;
  _caller := public.kb_require_moderator_subject(COALESCE(_subject, 'physics'));

  SELECT count(DISTINCT htt.template_id) INTO _tpl
    FROM public.homework_template_tasks htt WHERE htt.kb_task_id = _c.id;

  IF _c.source_task_id IS NULL THEN
    _branch := 'orphan';
  ELSE
    SELECT owner_id, published_task_id INTO _src_owner, _src_pub
      FROM public.kb_tasks WHERE id = _c.source_task_id;
    IF _src_owner IS NULL THEN
      _branch := 'orphan';                      -- источник исчез / аномален
    ELSIF _src_owner <> _caller THEN
      _branch := 'foreign';
    ELSIF _src_pub IS NULL THEN
      _branch := 'own_source_detached';         -- после unpublish (связь порвана)
    ELSIF _src_pub = _c.id THEN
      _branch := 'own_source';
      SELECT count(DISTINCT htt.template_id) INTO _src_tpl
        FROM public.homework_template_tasks htt WHERE htt.kb_task_id = _c.source_task_id;
    ELSE
      _branch := 'link_broken';                 -- source указывает на ДРУГУЮ копию
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'branch', _branch,
    'template_count', _tpl,
    'source_template_count', _src_tpl
  );
END;
$$;

-- ── 2. Мутация: удалить каталожную задачу (и исходник, если свой) ─────────────
CREATE OR REPLACE FUNCTION public.kb_mod_delete_catalog_task(p_task_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _c public.kb_tasks%ROWTYPE; _subject TEXT; _caller UUID;
  _src_owner UUID; _src_pub UUID; _tpl INT; _src_tpl INT; _result TEXT;
BEGIN
  -- Subject-гейт по теме копии (до локов — зеркало kb_mod_move_task_to_my_base).
  SELECT * INTO _c FROM public.kb_tasks WHERE id = p_task_id AND owner_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Задача не найдена в каталоге'; END IF;
  SELECT subject INTO _subject FROM public.kb_topics WHERE id = _c.topic_id;
  _caller := public.kb_require_moderator_subject(COALESCE(_subject, 'physics'));

  -- Lock-order копия → источник (тот же, что у _kb_mod_copy_to_base — нет
  -- дедлока с конкурентным «Перенести в Мою базу»). Re-read под FOR UPDATE.
  SELECT * INTO _c FROM public.kb_tasks
   WHERE id = p_task_id AND owner_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Задача не найдена в каталоге'; END IF;

  -- Гард шаблонов на копию (RESTRICT FK — backstop; count-only, P1-3).
  SELECT count(DISTINCT htt.template_id) INTO _tpl
    FROM public.homework_template_tasks htt WHERE htt.kb_task_id = _c.id;
  IF _tpl > 0 THEN
    RAISE EXCEPTION 'Задача используется в шаблонах ДЗ (%) — сначала уберите её из шаблонов.', _tpl;
  END IF;

  IF _c.source_task_id IS NOT NULL THEN
    SELECT owner_id, published_task_id INTO _src_owner, _src_pub
      FROM public.kb_tasks WHERE id = _c.source_task_id FOR UPDATE;
  END IF;

  IF _c.source_task_id IS NULL OR _src_owner IS NULL THEN
    -- ORPHAN (или источник исчез между чтениями) → удаляем только копию.
    DELETE FROM public.kb_tasks WHERE id = _c.id;
    _result := 'deleted';

  ELSIF _src_owner = _caller AND _src_pub IS NULL THEN
    -- DETACHED own-source (после unpublish): личная задача живёт своей жизнью —
    -- удаляем только каталожную строку, исходник НЕ трогаем.
    DELETE FROM public.kb_tasks WHERE id = _c.id;
    _result := 'deleted';

  ELSIF _src_owner = _caller AND _src_pub = _c.id THEN
    -- OWN SOURCE (reciprocal; включая hidden_duplicate) → удаляем ОБЕ строки.
    SELECT count(DISTINCT htt.template_id) INTO _src_tpl
      FROM public.homework_template_tasks htt WHERE htt.kb_task_id = _c.source_task_id;
    IF _src_tpl > 0 THEN
      RAISE EXCEPTION 'Исходник задачи используется в шаблонах ДЗ (%) — сначала уберите его из шаблонов.', _src_tpl;
    END IF;
    DELETE FROM public.kb_tasks WHERE id = _c.id;              -- копия первой (см. шапку)
    DELETE FROM public.kb_tasks WHERE id = _c.source_task_id;  -- затем исходник
    _result := 'deleted_with_source';

  ELSIF _src_owner = _caller THEN
    -- Свой источник, но связь на ДРУГУЮ копию — аномалия, fail-closed (P1-6).
    RAISE EXCEPTION 'Нарушена связь публикации задачи — обратитесь к владельцу';

  ELSE
    -- FOREIGN SOURCE → блок (и для админа — зеркало «Перенести», осознанно).
    RAISE EXCEPTION 'Эта задача опубликована из папки другого модератора — удалить её может только он';
  END IF;

  INSERT INTO public.kb_moderation_log (action, task_id, source_task_id, moderator_id, details)
  VALUES (
    'hard_delete', _c.id, _c.source_task_id, _caller,
    jsonb_build_object(
      'result', _result,
      'topic_id', _c.topic_id,
      'subtopic_id', _c.subtopic_id,
      'kim_number', _c.kim_number,
      'fingerprint', _c.fingerprint
    )
  );

  RETURN jsonb_build_object('task_id', p_task_id, 'result', _result);
END;
$$;

-- ── 3. Гранты (тройной набор, порядок: GRANT → REVOKE PUBLIC → REVOKE anon) ────
GRANT EXECUTE ON FUNCTION public.kb_mod_preview_delete_task(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kb_mod_delete_catalog_task(UUID) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kb_mod_preview_delete_task(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kb_mod_delete_catalog_task(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kb_mod_preview_delete_task(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.kb_mod_delete_catalog_task(UUID) FROM anon;

COMMIT;
