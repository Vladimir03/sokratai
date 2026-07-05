-- ══════════════════════════════════════════════════════════════
-- Единая модель задач (unified-task-model, Фаза 0 / M3) — 2026-07-05
-- Шаблоны ДЗ = упорядоченные ССЫЛКИ на kb_tasks (не JSON-копии) + Банк ДЗ.
--
-- СЛОЙ 2 целевой модели: шаблон живой (правка задачи в Базе видна во всех
-- шаблонах), выданное ДЗ — снимок (без изменений). Банк ДЗ v1: публикуют
-- ТОЛЬКО модераторы (зеркало каталога задач); правка чужого = fork.
--
-- FK kb_task_id = ON DELETE RESTRICT (осознанно): ссылочная модель не должна
-- молча терять участников; удаление задачи/папки Базы блокируется, пока на
-- задачу ссылаются шаблоны (client pre-check через kb_task_template_refs,
-- FK = backstop). У СНИМКОВ (homework_tutor_tasks.source_kb_task_id, M4) —
-- наоборот SET NULL: выданное ДЗ никогда не блокирует удаление из Базы.
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) Junction: упорядоченные ссылки шаблон → задача ────────────────────────
CREATE TABLE IF NOT EXISTS public.homework_template_tasks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES public.homework_tutor_templates(id) ON DELETE CASCADE,
  kb_task_id  UUID NOT NULL REFERENCES public.kb_tasks(id) ON DELETE RESTRICT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT homework_template_tasks_unique UNIQUE (template_id, kb_task_id)
);

CREATE INDEX IF NOT EXISTS idx_hw_template_tasks_template
  ON public.homework_template_tasks(template_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_hw_template_tasks_kb_task
  ON public.homework_template_tasks(kb_task_id);

COMMENT ON TABLE public.homework_template_tasks IS
  'Ссылки шаблона ДЗ на задачи Базы (unified-task-model, 2026-07-05). Шаблон НЕ копирует задачи — снимок делается только при выдаче ДЗ. UNIQUE(template_id, kb_task_id) = идемпотентная материализация + запрет бессмысленных дублей.';

-- ── 2) Sharing-колонки шаблона ────────────────────────────────────────────────
ALTER TABLE public.homework_tutor_templates
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS published_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS forked_from_template_id UUID NULL
    REFERENCES public.homework_tutor_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS usage_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS tasks_migrated_at TIMESTAMPTZ NULL;

DO $$ BEGIN
  ALTER TABLE public.homework_tutor_templates
    ADD CONSTRAINT homework_tutor_templates_visibility_check
    CHECK (visibility IN ('private', 'shared'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.homework_tutor_templates.visibility IS
  'private = личный шаблон; shared = Банк ДЗ (видят все туторы). Флип ТОЛЬКО через hw_mod_publish_template/hw_mod_unpublish_template (модераторы) — колонка не грантится authenticated.';
COMMENT ON COLUMN public.homework_tutor_templates.usage_count IS
  'Сколько раз из шаблона выдано ДЗ (инкремент service_role в POST /assignments при template_id). Social proof для Банка.';
COMMENT ON COLUMN public.homework_tutor_templates.tasks_migrated_at IS
  'Маркер материализации tasks_json → homework_template_tasks (M5 / hw_materialize_legacy_templates). NULL = legacy-снапшот, шаблон читается из tasks_json.';

CREATE INDEX IF NOT EXISTS idx_hw_templates_shared
  ON public.homework_tutor_templates(visibility, subject)
  WHERE visibility = 'shared';

-- ── 3) RLS: shared-шаблоны читают все authenticated ──────────────────────────
-- Own-CRUD политики (20260225201926) не тронуты.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'HW template select shared' AND tablename = 'homework_tutor_templates') THEN
    CREATE POLICY "HW template select shared" ON public.homework_tutor_templates
      FOR SELECT TO authenticated USING (visibility = 'shared');
  END IF;
END $$;

ALTER TABLE public.homework_template_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "HW template tasks select own or shared"
  ON public.homework_template_tasks
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.homework_tutor_templates t
    WHERE t.id = template_id AND (t.tutor_id = auth.uid() OR t.visibility = 'shared')
  ));

CREATE POLICY "HW template tasks insert own"
  ON public.homework_template_tasks
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.homework_tutor_templates t
    WHERE t.id = template_id AND t.tutor_id = auth.uid()
  ));

CREATE POLICY "HW template tasks update own"
  ON public.homework_template_tasks
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.homework_tutor_templates t
    WHERE t.id = template_id AND t.tutor_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.homework_tutor_templates t
    WHERE t.id = template_id AND t.tutor_id = auth.uid()
  ));

CREATE POLICY "HW template tasks delete own"
  ON public.homework_template_tasks
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.homework_tutor_templates t
    WHERE t.id = template_id AND t.tutor_id = auth.uid()
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.homework_template_tasks TO authenticated;

-- ── 4) Column-level write whitelist на шаблоны (defense-in-depth) ─────────────
-- Governance-колонки (visibility/published_*/usage_count/forked_from/
-- tasks_migrated_at) пишутся ТОЛЬКО edge (service_role) / SECURITY DEFINER RPC.
-- Без этого own-UPDATE RLS-политика позволила бы тутору самопубликацию
-- `visibility='shared'` прямым PostgREST. Зеркало паттерна 20260630170000
-- (там SELECT-whitelist, здесь INSERT/UPDATE-whitelist).
REVOKE INSERT, UPDATE ON public.homework_tutor_templates FROM anon, authenticated;

GRANT INSERT (tutor_id, title, subject, topic, tags, tasks_json,
              exam_type, feedback_language, disable_ai_bootstrap)
  ON public.homework_tutor_templates TO authenticated;
GRANT UPDATE (title, subject, topic, tags, tasks_json,
              exam_type, feedback_language, disable_ai_bootstrap)
  ON public.homework_tutor_templates TO authenticated;

-- ── 5) RPC: публикация в Банк (модераторы, зеркало kb_mod_*) ─────────────────
-- Атомарно: pre-валидация topic_id личных задач → автопубликация их в каталог
-- (reuse kb_publish_task; fingerprint-winner reuse) → remap junction на
-- каталожные копии (инвариант «общий шаблон ссылается только на общие задачи»
-- by construction) → visibility='shared'. Ошибки — рус. фразы (rule 97).
CREATE OR REPLACE FUNCTION public.hw_mod_publish_template(p_template_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller UUID;
  _tpl RECORD;
  _ref RECORD;
  _offenders TEXT := '';
  _target UUID;
  _fp TEXT;
BEGIN
  _caller := public.kb_require_moderator();

  SELECT * INTO _tpl FROM homework_tutor_templates WHERE id = p_template_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Шаблон не найден';
  END IF;
  IF _tpl.tutor_id <> _caller THEN
    RAISE EXCEPTION 'Публиковать можно только свои шаблоны';
  END IF;
  IF _tpl.tasks_migrated_at IS NULL THEN
    RAISE EXCEPTION 'Шаблон ещё в старом формате — пересохраните его перед публикацией';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM homework_template_tasks WHERE template_id = p_template_id) THEN
    RAISE EXCEPTION 'В шаблоне нет задач';
  END IF;

  -- Pre-валидация: личные задачи без темы публиковать нельзя (kb_publish_task
  -- требует topic_id). Собираем нарушителей одним сообщением.
  FOR _ref IN
    SELECT kt.id, left(COALESCE(kt.text, ''), 60) AS excerpt
    FROM homework_template_tasks htt
    JOIN kb_tasks kt ON kt.id = htt.kb_task_id
    WHERE htt.template_id = p_template_id
      AND kt.owner_id IS NOT NULL
      AND kt.topic_id IS NULL
  LOOP
    _offenders := _offenders || CASE WHEN _offenders = '' THEN '' ELSE '; ' END || '«' || _ref.excerpt || '…»';
  END LOOP;
  IF _offenders <> '' THEN
    RAISE EXCEPTION 'У задач не указана тема (нужна для публикации в каталог): %', _offenders;
  END IF;

  -- Автопубликация личных задач + remap ссылок на каталожные копии.
  FOR _ref IN
    SELECT htt.id AS ref_id, kt.*
    FROM homework_template_tasks htt
    JOIN kb_tasks kt ON kt.id = htt.kb_task_id
    WHERE htt.template_id = p_template_id
    ORDER BY htt.sort_order
  LOOP
    _target := NULL;

    IF _ref.owner_id IS NULL THEN
      -- Уже каталожная. hidden_duplicate → remap на активного fingerprint-победителя.
      IF _ref.moderation_status = 'active' THEN
        CONTINUE;
      END IF;
      SELECT id INTO _target FROM kb_tasks
      WHERE fingerprint = _ref.fingerprint AND owner_id IS NULL
        AND moderation_status = 'active' AND id <> _ref.id
      LIMIT 1;
      IF _target IS NULL THEN
        RAISE EXCEPTION 'Каталожная задача «%…» скрыта и не имеет активной копии — замените её в шаблоне',
          left(COALESCE(_ref.text, ''), 60);
      END IF;
    ELSE
      -- Личная задача автора.
      IF _ref.published_task_id IS NOT NULL THEN
        _target := _ref.published_task_id;
        -- Копия могла стать hidden_duplicate → активный победитель.
        IF NOT EXISTS (SELECT 1 FROM kb_tasks WHERE id = _target AND moderation_status = 'active') THEN
          SELECT id INTO _target FROM kb_tasks
          WHERE fingerprint = _ref.fingerprint AND owner_id IS NULL AND moderation_status = 'active'
          LIMIT 1;
          IF _target IS NULL THEN
            RAISE EXCEPTION 'Опубликованная копия задачи «%…» скрыта — переопубликуйте её из Базы',
              left(COALESCE(_ref.text, ''), 60);
          END IF;
        END IF;
      ELSE
        -- Fingerprint-winner reuse (идемпотентность, зеркало kb_publish_folder_to_catalog).
        _fp := kb_normalize_fingerprint(_ref.text, _ref.answer, _ref.attachment_url);
        SELECT id INTO _target FROM kb_tasks
        WHERE fingerprint = _fp AND owner_id IS NULL AND moderation_status = 'active'
        LIMIT 1;
        IF _target IS NULL THEN
          _target := kb_publish_task(_ref.id);
          -- kb_publish_task при гонке мог вставить hidden_duplicate → победитель.
          IF NOT EXISTS (SELECT 1 FROM kb_tasks WHERE id = _target AND moderation_status = 'active') THEN
            SELECT id INTO _target FROM kb_tasks
            WHERE fingerprint = _fp AND owner_id IS NULL AND moderation_status = 'active'
            LIMIT 1;
          END IF;
        END IF;
      END IF;
    END IF;

    IF _target IS NULL THEN
      RAISE EXCEPTION 'Не удалось опубликовать задачу «%…» в каталог', left(COALESCE(_ref.text, ''), 60);
    END IF;

    -- Remap ссылки; коллизия UNIQUE (две ссылки схлопнулись в одну каталожную) →
    -- удаляем дубль-строку (осмысленно: в шаблоне это была одна и та же задача).
    BEGIN
      UPDATE homework_template_tasks SET kb_task_id = _target WHERE id = _ref.ref_id;
    EXCEPTION WHEN unique_violation THEN
      DELETE FROM homework_template_tasks WHERE id = _ref.ref_id;
      RAISE NOTICE 'hw_mod_publish_template: дубль-ссылка % схлопнута в %', _ref.ref_id, _target;
    END;
  END LOOP;

  UPDATE homework_tutor_templates
  SET visibility = 'shared', published_by = _caller, published_at = now(), updated_at = now()
  WHERE id = p_template_id;

  RETURN p_template_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.hw_mod_unpublish_template(p_template_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller UUID;
BEGIN
  _caller := public.kb_require_moderator();
  UPDATE homework_tutor_templates
  SET visibility = 'private', updated_at = now()
  WHERE id = p_template_id AND visibility = 'shared';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Шаблон не найден или уже не опубликован';
  END IF;
END;
$$;

-- ── 6) RPC: guard-хелпер для delete-гардов Базы ──────────────────────────────
-- Сколько шаблонов (видимых вызывающему: свои + shared) ссылаются на задачи.
-- Используется client-side pre-check'ом в removeTask/removeFolder; RESTRICT FK
-- на junction — backstop.
CREATE OR REPLACE FUNCTION public.kb_task_template_refs(p_task_ids UUID[])
RETURNS TABLE (kb_task_id UUID, template_count BIGINT, template_titles TEXT[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT htt.kb_task_id,
         COUNT(DISTINCT t.id) AS template_count,
         (ARRAY_AGG(DISTINCT t.title))[1:5] AS template_titles
  FROM homework_template_tasks htt
  JOIN homework_tutor_templates t ON t.id = htt.template_id
  WHERE htt.kb_task_id = ANY(p_task_ids)
    AND (t.tutor_id = auth.uid() OR t.visibility = 'shared')
  GROUP BY htt.kb_task_id;
$$;

REVOKE ALL ON FUNCTION public.hw_mod_publish_template(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hw_mod_unpublish_template(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kb_task_template_refs(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hw_mod_publish_template(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hw_mod_unpublish_template(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kb_task_template_refs(UUID[]) TO authenticated, service_role;

COMMIT;
