-- Standalone trainer schema adjustments for formula_round_results.
-- Notes on schema drift:
-- - Current table uses student_id + round_id (not user_id + homework_assignment_id).
-- - homework_assignment_id is handled defensively if it exists in some environments.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'formula_round_results'
      AND column_name = 'student_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.formula_round_results
      ALTER COLUMN student_id DROP NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'formula_round_results'
      AND column_name = 'homework_assignment_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.formula_round_results
      ALTER COLUMN homework_assignment_id DROP NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'formula_round_results'
      AND column_name = 'round_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.formula_round_results
      ALTER COLUMN round_id DROP NOT NULL;
  END IF;
END $$;

ALTER TABLE public.formula_round_results
  ADD COLUMN IF NOT EXISTS session_id text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'homework',
  ADD COLUMN IF NOT EXISTS ip_hash text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'formula_round_results_source_check'
      AND conrelid = 'public.formula_round_results'::regclass
  ) THEN
    ALTER TABLE public.formula_round_results
      ADD CONSTRAINT formula_round_results_source_check
      CHECK (source IN ('homework', 'trainer'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_formula_round_results_trainer_recent
  ON public.formula_round_results (ip_hash, created_at DESC)
  WHERE source = 'trainer';

DROP POLICY IF EXISTS trainer_results_no_anon_read ON public.formula_round_results;

CREATE POLICY trainer_results_no_anon_read
  ON public.formula_round_results
  FOR SELECT
  TO anon
  USING (false);
