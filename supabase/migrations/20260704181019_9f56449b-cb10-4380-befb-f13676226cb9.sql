-- === 20260704160000_add_ai_nodes_json_to_task_states.sql ===
ALTER TABLE public.homework_tutor_task_states
  ADD COLUMN IF NOT EXISTS ai_nodes_json JSONB NULL;

COMMENT ON COLUMN public.homework_tutor_task_states.ai_nodes_json IS
  'Physics Часть 2 ФИПИ flowchart trace for deterministic grading (walkPhysicsFlowchart). Format: { score, max_score, confidence, steps: Array<{node, verdict: yes|no|partial, note?}> }. Positive-polarity nodes (yes = satisfied) for ✓/⚠/✗ UI. NULL for languages (see ai_criteria_json) / numeric / other. Visible to student post-submit (feedback layer). Added 2026-07-04 (strict-criteria-grading Phase C).';

GRANT SELECT (ai_nodes_json)
  ON public.homework_tutor_task_states
  TO authenticated;

-- === 20260704200000_fix_ai_reference_schema_drift.sql ===
ALTER TABLE public.homework_tutor_tasks
  ADD COLUMN IF NOT EXISTS ai_reference_confidence TEXT,
  ADD COLUMN IF NOT EXISTS ai_reference_status TEXT,
  ADD COLUMN IF NOT EXISTS ai_reference_generated_at TIMESTAMPTZ;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'homework_tutor_tasks'
      AND column_name = 'ai_reference_solution'
      AND data_type = 'jsonb'
  ) THEN
    ALTER TABLE public.homework_tutor_tasks
      ALTER COLUMN ai_reference_solution TYPE TEXT
      USING CASE
        WHEN ai_reference_solution IS NULL THEN NULL
        WHEN jsonb_typeof(ai_reference_solution) = 'string'
          THEN ai_reference_solution #>> '{}'
        ELSE ai_reference_solution::text
      END;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'homework_tutor_tasks'
      AND column_name = 'ai_reference_solution'
  ) THEN
    ALTER TABLE public.homework_tutor_tasks
      ADD COLUMN ai_reference_solution TEXT;
  END IF;
END $$;

ALTER TABLE public.homework_tutor_task_states
  ADD COLUMN IF NOT EXISTS ai_nodes_json JSONB NULL;

GRANT SELECT (ai_nodes_json)
  ON public.homework_tutor_task_states
  TO authenticated;