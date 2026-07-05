-- ══════════════════════════════════════════════════════════════
-- Единая модель задач (unified-task-model, Фаза 0 / M1) — 2026-07-05
--
-- Паритет полей kb_tasks ↔ homework_tutor_tasks: задача «живёт» в Базе со
-- ВСЕЙ AI-настройкой, ДЗ хранит её снимок. До этой миграции check_format был
-- (без UI), а task_kind / cefr_level / grading_criteria_json существовали
-- только на homework_tutor_tasks → терялись при «Сохранить в мою базу» и не
-- задавались при создании задачи в Базе.
--
-- Аддитивно, nullable, idempotent. Публикация этих полей в каталог — M2
-- (отдельная миграция, policy change).
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.kb_tasks
  ADD COLUMN IF NOT EXISTS task_kind TEXT,
  ADD COLUMN IF NOT EXISTS cefr_level TEXT,
  ADD COLUMN IF NOT EXISTS grading_criteria_json JSONB;

DO $$ BEGIN
  ALTER TABLE public.kb_tasks
    ADD CONSTRAINT kb_tasks_task_kind_check
    CHECK (task_kind IS NULL OR task_kind IN ('numeric', 'extended', 'proof', 'speaking'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.kb_tasks
    ADD CONSTRAINT kb_tasks_cefr_level_check
    CHECK (cefr_level IS NULL OR cefr_level IN ('A2', 'B1', 'B2', 'C1'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.kb_tasks.task_kind IS
  'Тип ответа (numeric/extended/proof/speaking) — зеркало homework_tutor_tasks.task_kind. NULL = derive из check_format при снапшоте в ДЗ.';
COMMENT ON COLUMN public.kb_tasks.cefr_level IS
  'Уровень CEFR (A2/B1/B2/C1) для языковых задач — зеркало homework_tutor_tasks.cefr_level. NULL = авто-детект.';
COMMENT ON COLUMN public.kb_tasks.grading_criteria_json IS
  'Структурные критерии оценки [{label, max, description?, kind?, depends_on_zero?}] — зеркало homework_tutor_tasks.grading_criteria_json (rule 40 «Покритериальная проверка»).';
