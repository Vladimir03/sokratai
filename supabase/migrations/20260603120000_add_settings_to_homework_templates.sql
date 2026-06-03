-- ══════════════════════════════════════════════════════════════
-- Homework templates: assignment-level settings parity with «Создание ДЗ»
--
-- Context: templates were built early (fewer fields). Reusing a template
-- silently dropped grading settings: a "detailed_solution" task reverted to
-- "short answer", task_kind fell back to numeric, CEFR / feedback language
-- were lost. Per-task fields (check_format / task_kind / cefr_level) live in
-- tasks_json (no schema change). These three are ASSIGNMENT-LEVEL and need
-- columns so a template can remember the full grading context.
--
-- Additive only (no destructive changes). Backward-compatible: old templates
-- read NULL/default and behave exactly as before.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.homework_tutor_templates
  ADD COLUMN IF NOT EXISTS exam_type text,
  ADD COLUMN IF NOT EXISTS feedback_language text,
  ADD COLUMN IF NOT EXISTS disable_ai_bootstrap boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.homework_tutor_templates.exam_type IS
  'ege | oge — saved from assignment so reuse keeps the FIPI grading methodology. NULL = unset.';
COMMENT ON COLUMN public.homework_tutor_templates.feedback_language IS
  'auto | russian | target — assignment-level AI feedback language. Only meaningful for language subjects (french/english/spanish). NULL = auto.';
COMMENT ON COLUMN public.homework_tutor_templates.disable_ai_bootstrap IS
  'Mirrors homework_tutor_assignments.disable_ai_bootstrap so reuse preserves the AI-intro toggle.';
