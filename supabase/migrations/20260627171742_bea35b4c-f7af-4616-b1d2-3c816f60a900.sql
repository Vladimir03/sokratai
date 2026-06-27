ALTER TABLE public.homework_tutor_tasks
  ADD COLUMN IF NOT EXISTS grading_criteria_json JSONB NULL;

COMMENT ON COLUMN public.homework_tutor_tasks.grading_criteria_json IS
  'Tutor-authored structured grading criteria (any subject) for per-criterion AI grading. Array<{label, max, description?, kind?: ''ai''|''tutor_only'', depends_on_zero?: string[]}>. When present, drives criteria_breakdown → ai_criteria_json (overrides built-in subject preset). NULL = built-in preset (russian-ege К1–К10 / languages-ege) or no breakdown. Tutor-only prompt context — never returned to the student. Added 2026-06 (criteria-grading feature).';