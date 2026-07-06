-- ai-usage-logging (2026-07-06): per-call AI token-usage attribution.
--
-- Observability only. Tags each `token_usage_logs` row by call type (`source`)
-- so AI costs can be sliced by type (проверка ДЗ / подсказки / пробники / OCR /
-- kb-extract / чат / голос) and — via user_id / assignment_id — by tutor.
--
-- Additive: nothing dropped, no NOT NULL / FK on the new columns.
--   - `source`        — call-type tag (see _shared/token-usage.ts TokenUsageSource).
--   - `audio_seconds` — Groq Whisper duration (numeric); tokens are 0 for voice.
--   - `assignment_id` — homework / mock assignment id for tutor-level rollups.
--                       Plain uuid (NO FK) — it can reference either
--                       homework_tutor_assignments OR mock_exam_assignments, so a
--                       FK would be wrong. It is a rollup tag, not a relation.
--
-- Backfill: every historical row came from the chat path (the only prior
-- writer, chat/index.ts) → default them to 'chat_discussion'.

ALTER TABLE public.token_usage_logs
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS audio_seconds numeric,
  ADD COLUMN IF NOT EXISTS assignment_id uuid;

UPDATE public.token_usage_logs
  SET source = 'chat_discussion'
  WHERE source IS NULL;

CREATE INDEX IF NOT EXISTS idx_token_usage_logs_source_created
  ON public.token_usage_logs (source, created_at);
