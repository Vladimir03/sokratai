-- Phase 6 (2026-05-15): AI auto-OCR Часть 1 для blank-mode пробников.
--
-- Когда ученик сдаёт пробник с `answer_method='blank'` (фото бланка ФИПИ),
-- mock-exam-grade запускает Gemini OCR на бланке: распознаёт 20 ответов
-- + per-cell confidence. Result сохраняется в JSONB колонке этой
-- миграцией. Tutor видит recognized answers в Part1BlankReviewPanel
-- (pre-filled inputs + amber border для low-confidence клеток); может
-- править перед approve. После approval ученик видит только итоговый
-- earned_score (existing anti-leak contract из CLAUDE.md §15).
--
-- Format JSONB:
--   {
--     "1": { "value": "12", "confidence": "high" },
--     "2": { "value": null, "confidence": "low" },
--     ...
--     "20": { "value": "234", "confidence": "medium" }
--   }
--
-- NULL = OCR не запускался (form mode attempt или legacy attempt до Phase 6).

ALTER TABLE public.mock_exam_attempts
  ADD COLUMN IF NOT EXISTS ai_part1_ocr_json JSONB NULL;

COMMENT ON COLUMN public.mock_exam_attempts.ai_part1_ocr_json IS
  'AI OCR Часть 1 для blank mode. Format: { "1": {value, confidence}, ..., "20": {value, confidence} }. NULL = OCR не запускался (form mode или legacy). Tutor-only до approval.';
