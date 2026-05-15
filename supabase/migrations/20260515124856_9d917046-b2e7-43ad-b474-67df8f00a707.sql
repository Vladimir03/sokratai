BEGIN;

ALTER TABLE public.mock_exam_attempts
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

COMMENT ON COLUMN public.mock_exam_attempts.updated_at IS
  'Auto-maintained by BEFORE UPDATE trigger. Used by mock-exam-grade CAS claim для stale-lock detection (STALE_LOCK_AGE_MS=120s) — если status=ai_checking и updated_at < 120s назад → concurrent grader, return 202 ALREADY_GRADING.';

CREATE OR REPLACE FUNCTION public.set_mock_exam_attempts_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mock_exam_attempts_updated_at
  ON public.mock_exam_attempts;
CREATE TRIGGER trg_mock_exam_attempts_updated_at
  BEFORE UPDATE ON public.mock_exam_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_mock_exam_attempts_updated_at();

COMMIT;