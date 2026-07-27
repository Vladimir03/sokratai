-- =============================================================================
-- Структурные тестовые задачи: options_json (спека homework-choice-tasks,
-- решения владельца 2026-07-27). Мотивация: импорт ~2500 тестов Дианы Шевцовой
-- с Online Test Pad (D5 «тест назначается группе и проверяется сам»).
--
-- Формат (канон src/lib/taskOptions.ts + Deno-зеркало _shared/task-options.ts):
--   { kind: 'single_choice'|'multi_choice', options: [{key:'1'..'9', text}] }
--   { kind: 'matching', left: [{key:'А'..'Д', text}], right: [{key:'1'..'9', text}] }
--
-- ⚠️ ПРАВИЛЬНЫЙ ОТВЕТ НЕ ЖИВЁТ в options_json — колонка student-safe (GRANT
-- ниже). Ответ остаётся в correct_answer (tutor-only, НЕ гранится) в формате
-- чекеров пробников: single "3", multi "1267", matching "35142".
-- Пояснение репетитора к ответу → solution_text (tutor-only навсегда, rule 40),
-- ученик получает его смысл через AI-объяснение (precomputedVerdict).
-- =============================================================================

ALTER TABLE public.homework_tutor_tasks
  ADD COLUMN IF NOT EXISTS options_json jsonb;

ALTER TABLE public.homework_tutor_tasks
  DROP CONSTRAINT IF EXISTS homework_tutor_tasks_options_json_object;
ALTER TABLE public.homework_tutor_tasks
  ADD CONSTRAINT homework_tutor_tasks_options_json_object
  CHECK (options_json IS NULL OR jsonb_typeof(options_json) = 'object');

-- Anti-leak инвариант rule 40: после table-level REVOKE (20260630170000) новые
-- student-safe колонки грантятся ЯВНОЙ миграцией. options_json безопасен —
-- варианты ученик и так видит на экране.
GRANT SELECT (options_json) ON public.homework_tutor_tasks TO authenticated;

-- Паритетная колонка Базы задач (kb_tasks) — иначе варианты теряются на пути
-- KB → ДЗ (kbTaskToDraftTask / hwDraftStore) и при save-back. KB — tutor-домен,
-- отдельный GRANT не нужен (table-level).
ALTER TABLE public.kb_tasks
  ADD COLUMN IF NOT EXISTS options_json jsonb;

ALTER TABLE public.kb_tasks
  DROP CONSTRAINT IF EXISTS kb_tasks_options_json_object;
ALTER TABLE public.kb_tasks
  ADD CONSTRAINT kb_tasks_options_json_object
  CHECK (options_json IS NULL OR jsonb_typeof(options_json) = 'object');

-- ⚠️ ОТЛОЖЕНО ОСОЗНАННО (rule 50): options_json пока НЕ добавлен в column-lists
-- kb_publish_task / kb_resync_task — публикация задачи с вариантами в общий
-- Каталог потеряет варианты (текст уедет без списка). V1-скоуп — личные папки
-- (импорт Дианы), каталог не затронут. Перед публикацией тестовых задач в
-- Каталог: расширить обе RPC + resync-триггер отдельной миграцией.

NOTIFY pgrst, 'reload schema';
