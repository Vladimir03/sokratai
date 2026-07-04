-- strict-criteria-grading Phase 3 / Phase A (2026-06-30):
-- Кэш AI-сгенерированного ЭТАЛОНА решения на задаче ДЗ. Генерится фоново при
-- создании/правке ДЗ (edge `homework-generate-reference`) для физики, развёрнутых
-- задач (task_kind extended/proof), у которых репетитор НЕ задал solution_text.
-- Consumed Phase B грейдингом (сравнение решения ученика с эталоном → узлы
-- блок-схемы ФИПИ → walkPhysicsFlowchart).
--
-- ⚠ ANTI-LEAK: tutor-only, как `solution_text`/`rubric_text`. НИКОГДА не
-- селектится в student-facing endpoint'ах (handleGetStudentProblem /
-- handleGetStudentAssignment column-whitelist). Отдаётся только в tutor
-- handleGetAssignment. При добавлении нового student SELECT — НЕ включать эти
-- колонки.
--
-- Additive (ADD COLUMN IF NOT EXISTS). Table-level GRANT покрывает — отдельный
-- column GRANT не нужен (mirror solution_text).

ALTER TABLE public.homework_tutor_tasks
  ADD COLUMN IF NOT EXISTS ai_reference_solution TEXT,
  ADD COLUMN IF NOT EXISTS ai_reference_confidence TEXT,
  ADD COLUMN IF NOT EXISTS ai_reference_status TEXT,
  ADD COLUMN IF NOT EXISTS ai_reference_generated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.homework_tutor_tasks.ai_reference_solution IS
  'AI-эталон решения (tutor-only, anti-leak как solution_text). NULL если не генерился или у задачи есть tutor solution_text.';
COMMENT ON COLUMN public.homework_tutor_tasks.ai_reference_confidence IS
  'low|medium|high — уверенность AI в эталоне (показывается репетитору).';
COMMENT ON COLUMN public.homework_tutor_tasks.ai_reference_status IS
  'pending|ready|failed — статус фоновой генерации эталона.';
COMMENT ON COLUMN public.homework_tutor_tasks.ai_reference_generated_at IS
  'Когда эталон сгенерирован/попытка завершилась.';
