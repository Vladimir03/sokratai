ALTER TABLE public.mock_exam_attempts ADD COLUMN IF NOT EXISTS ai_part1_ocr_json JSONB NULL;

COMMENT ON COLUMN public.mock_exam_attempts.ai_part1_ocr_json IS 'AI OCR Часть 1 для blank mode. Format: { "1": {value, confidence}, ..., "20": {value, confidence} }. NULL = OCR не запускался (form mode или legacy). Tutor-only до approval.';

ALTER TABLE public.mock_exam_attempts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

COMMENT ON COLUMN public.mock_exam_attempts.updated_at IS 'Auto-maintained by BEFORE UPDATE trigger. Used by mock-exam-grade CAS claim для stale-lock detection (STALE_LOCK_AGE_MS=120s) — если status=ai_checking и updated_at < 120s назад → concurrent grader, return 202 ALREADY_GRADING.';

CREATE OR REPLACE FUNCTION public.set_mock_exam_attempts_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_mock_exam_attempts_updated_at ON public.mock_exam_attempts;

CREATE TRIGGER trg_mock_exam_attempts_updated_at BEFORE UPDATE ON public.mock_exam_attempts FOR EACH ROW EXECUTE FUNCTION public.set_mock_exam_attempts_updated_at();

ALTER TABLE public.mock_exam_attempt_part1_answers ADD COLUMN IF NOT EXISTS score_source TEXT NOT NULL DEFAULT 'ocr' CHECK (score_source IN ('ocr', 'tutor', 'finalize_default', 'student_form'));

UPDATE public.mock_exam_attempt_part1_answers SET score_source = 'tutor' WHERE score_source = 'ocr';

COMMENT ON COLUMN public.mock_exam_attempt_part1_answers.score_source IS 'Source of earned_score value. ocr = runPart1OCR; tutor = handlePart1ManualScore; finalize_default = handlePart1Finalize INSERT-on-missing; student_form = form-mode auto-check on submit. Используется в runPart1OCR для skip-condition: только score_source=tutor preserved при retry.';