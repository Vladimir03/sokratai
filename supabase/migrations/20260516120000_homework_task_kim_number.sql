-- Hotfix 2026-05-16 — P0 production error «Task not found».
-- ============================================================================
-- Phase 2 subject-rubric layer (commit `ea41a39`, 2026-05-15) добавил
-- `kim_number` в SELECT три места:
--   - homework-api/index.ts::handleCheckAnswer (line ~6697)
--   - homework-api/index.ts::handleRequestHint (line ~7223)
--   - chat/index.ts::processAIRequest          (line ~1270)
--
-- Но колонка `kim_number` НЕ существовала в `homework_tutor_tasks` — она
-- была определена ТОЛЬКО в `kb_tasks` (KB system). PostgREST в production
-- возвращал 400 «column does not exist» → `.single()` получала data=null →
-- handler уходил в `if (!task)` ветку → 500 DB_ERROR «Task not found».
--
-- Симптом: ученик жмёт «Проверить» на короткий ответ → toast «Task not found».
--
-- Эта additive миграция добавляет колонку, чтобы существующие SELECT-запросы
-- работали. Для не-KIM задач (типичный tutor homework) `kim_number` = NULL —
-- resolveSubjectRubric автоматически использует GENERIC_METHODOLOGY (а после
-- утреннего hotfix 4773b50 для task_kind='numeric' — compact methodology).
--
-- KB → homework мост в `HWDrawer.tsx` и `HWTasksSection.tsx` пока НЕ копирует
-- `kim_number` из `kb_tasks` (это отдельная feature). Когда будет нужно — pull
-- `kb_tasks.kim_number → homework_tutor_tasks.kim_number` в обоих write-path
-- (см. CLAUDE.md §0 invariant о двух путях в homework_tutor_tasks).
-- ============================================================================

BEGIN;

ALTER TABLE public.homework_tutor_tasks
  ADD COLUMN IF NOT EXISTS kim_number INT NULL;

COMMENT ON COLUMN public.homework_tutor_tasks.kim_number IS
  'Optional KIM-style task number (1-26 для ЕГЭ физики, 1-19 для математики и т.д.). '
  'NULL для обычных tutor задач без привязки к КИМ. Используется subject-rubric layer '
  '(_shared/subject-rubrics/index.ts) для per-KIM specific methodology в AI prompts. '
  'Phase 2 (2026-05-15): автоматически прокидывается в SubjectRubricInput.kim_number.';

COMMIT;
