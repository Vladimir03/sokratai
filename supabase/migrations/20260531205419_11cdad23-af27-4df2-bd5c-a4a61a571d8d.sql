-- Phase 11 — feedback_language on assignments
ALTER TABLE public.homework_tutor_assignments
  ADD COLUMN IF NOT EXISTS feedback_language TEXT NULL
    DEFAULT 'auto'
    CHECK (feedback_language IS NULL OR feedback_language IN ('auto', 'russian', 'target'));

COMMENT ON COLUMN public.homework_tutor_assignments.feedback_language IS
  'Phase 11 (2026-05-31). Язык AI-feedback на языковых ДЗ: auto (A2→ru, B1+→target) / russian / target. NULL = auto.';

-- Phase 11 backfill — French CEFR from title
UPDATE public.homework_tutor_tasks t
SET cefr_level = CASE
  WHEN a.title ~* '\yA2\y' THEN 'A2'
  WHEN a.title ~* '\yB1\y' THEN 'B1'
  WHEN a.title ~* '\yB2\y' THEN 'B2'
  WHEN a.title ~* '\yC1\y' THEN 'C1'
  ELSE NULL
END
FROM public.homework_tutor_assignments a
WHERE t.assignment_id = a.id
  AND a.subject = 'french'
  AND t.cefr_level IS NULL
  AND t.task_kind IN ('extended', 'proof', 'speaking')
  AND a.title ~* '\y(A2|B1|B2|C1)\y';