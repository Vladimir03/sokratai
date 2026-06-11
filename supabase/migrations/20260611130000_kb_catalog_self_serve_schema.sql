-- ══════════════════════════════════════════════════════════════
-- KB Catalog self-serve + Olympiad section — SCHEMA (additive)
--
-- Контекст: каталог Сократа жёсткий (kb_topics/kb_subtopics заведены
-- миграциями, read-only) → модератор не может менять структуру без кода.
-- Плюс олимпиадные задачи не помещаются в ЕГЭ/ОГЭ-модель (нет № КИМ,
-- в будущем — математика). Эта миграция расширяет схему АДДИТИВНО:
--   • kb_topics.subject  — измерение «предмет» (physics сейчас, math позже)
--   • kb_topics.kind     — 'exam' | 'olympiad' (олимпиада ≠ экзамен)
--   • kb_topics.exam     — NULLABLE (олимпиадные темы: exam=NULL)
--   • kb_folders.catalog_topic_id / catalog_subtopic_id — биндинг папки
--     к теме каталога (чтобы публиковать папку «в один клик», без полей
--     тема/подтема на каждой задаче).
--
-- Не трогаем enum exam_type (готча ALTER TYPE ADD VALUE). kind-колонка
-- семантически чище. Существующие ЕГЭ/ОГЭ-темы не затронуты (kind='exam',
-- exam задан) — backward-compatible.
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) kb_topics: subject + kind + nullable exam ──────────────────────────────

ALTER TABLE public.kb_topics
  ADD COLUMN IF NOT EXISTS subject TEXT NOT NULL DEFAULT 'physics';

ALTER TABLE public.kb_topics
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'exam';

DO $$ BEGIN
  ALTER TABLE public.kb_topics
    ADD CONSTRAINT kb_topics_kind_check CHECK (kind IN ('exam', 'olympiad'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Олимпиадные темы не привязаны к экзамену.
ALTER TABLE public.kb_topics ALTER COLUMN exam DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kb_topics_kind ON public.kb_topics(kind);

COMMENT ON COLUMN public.kb_topics.subject IS
  'Предмет темы (physics по умолчанию). Закладка под математику — фильтр по предмету добавится с математическим контентом.';
COMMENT ON COLUMN public.kb_topics.kind IS
  'exam = тема ЕГЭ/ОГЭ (группировка по № КИМ); olympiad = олимпиадная тема (без № КИМ, exam=NULL).';

-- ── 2) kb_folders: биндинг к теме каталога (для публикации папкой) ────────────

ALTER TABLE public.kb_folders
  ADD COLUMN IF NOT EXISTS catalog_topic_id UUID
  REFERENCES public.kb_topics(id) ON DELETE SET NULL;

ALTER TABLE public.kb_folders
  ADD COLUMN IF NOT EXISTS catalog_subtopic_id UUID
  REFERENCES public.kb_subtopics(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.kb_folders.catalog_topic_id IS
  'Тема каталога, в которую публикуется эта папка (kb_publish_folder_to_catalog). Папка «помнит» тему → повторная публикация в один клик. Чисто подсказка/удобство; сама публикация требует роли moderator.';

-- ── 3) view kb_topics_with_counts: добавить subject + kind в конец ────────────
--     (CREATE OR REPLACE требует сохранить порядок существующих колонок;
--      новые добавляем В КОНЕЦ.)

CREATE OR REPLACE VIEW public.kb_topics_with_counts AS
SELECT
  t.id,
  t.name,
  t.section,
  t.exam,
  t.kim_numbers,
  t.sort_order,
  t.created_at,
  COALESCE(tc.task_count, 0)::INTEGER AS task_count,
  COALESCE(mc.material_count, 0)::INTEGER AS material_count,
  ARRAY(
    SELECT s.name FROM public.kb_subtopics s
    WHERE s.topic_id = t.id ORDER BY s.sort_order
  ) AS subtopic_names,
  t.subject,
  t.kind
FROM public.kb_topics t
LEFT JOIN (
  SELECT topic_id, COUNT(*)::INTEGER AS task_count
  FROM public.kb_tasks
  WHERE owner_id IS NULL AND moderation_status = 'active'
  GROUP BY topic_id
) tc ON tc.topic_id = t.id
LEFT JOIN (
  SELECT topic_id, COUNT(*)::INTEGER AS material_count
  FROM public.kb_materials
  WHERE owner_id IS NULL
  GROUP BY topic_id
) mc ON mc.topic_id = t.id;

COMMIT;
