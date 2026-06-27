-- ══════════════════════════════════════════════════════════════
-- homework_tutor_tasks.grading_criteria_json — структурные критерии
-- покритериальной AI-проверки (любой предмет).
--
-- Criteria-grading feature (2026-06): репетитор задаёт критерии оценки в
-- конструкторе (название + макс. балл + опц. описание/зависимость/kind), AI
-- раскладывает балл по ним → `homework_tutor_task_states.ai_criteria_json` →
-- таблица «критерий → балл/макс → комментарий» ученику. Подключается к УЖЕ
-- существующему движку покритериального грейдинга (см. languages-ege.ts /
-- russian-ege.ts, resolveSubjectRubric.grading_criteria — высший приоритет
-- над встроенными пресетами).
--
-- Запрос репетитора-филолога: проверка сочинения ЕГЭ (К1–К10) по официальным
-- критериям ФИПИ. Кнопка «Загрузить критерии ЕГЭ русский» в конструкторе
-- пишет сюда пресет К1–К10.
--
-- Формат (валидируется server-side normalizeGradingCriteria в homework-api):
--   Array<{ label: string; max: number;
--           description?: string;            -- band-гайд для AI (prompt-only)
--           kind?: 'ai' | 'tutor_only';      -- tutor_only = вне AI-суммы
--           depends_on_zero?: string[] }>    -- cascade (К1=0 ⇒ К2,К3=0), labels
--
-- Аддитивно, NULL для всех существующих задач (= без покритериального разбора,
-- поведение не меняется). НЕ возвращается ученику (tutor-only prompt context).
-- homework_tutor_tasks имеет table-level GRANT (HWDrawer пишет напрямую под RLS),
-- поэтому отдельный column-GRANT не нужен.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.homework_tutor_tasks
  ADD COLUMN IF NOT EXISTS grading_criteria_json JSONB NULL;

COMMENT ON COLUMN public.homework_tutor_tasks.grading_criteria_json IS
  'Tutor-authored structured grading criteria (any subject) for per-criterion AI grading. Array<{label, max, description?, kind?: ''ai''|''tutor_only'', depends_on_zero?: string[]}>. When present, drives criteria_breakdown → ai_criteria_json (overrides built-in subject preset). NULL = built-in preset (russian-ege К1–К10 / languages-ege) or no breakdown. Tutor-only prompt context — never returned to the student. Added 2026-06 (criteria-grading feature).';
