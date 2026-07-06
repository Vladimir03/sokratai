ALTER TABLE public.token_usage_logs
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS audio_seconds numeric,
  ADD COLUMN IF NOT EXISTS assignment_id uuid;

UPDATE public.token_usage_logs
  SET source = 'chat_discussion'
  WHERE source IS NULL;

CREATE INDEX IF NOT EXISTS idx_token_usage_logs_source_created
  ON public.token_usage_logs (source, created_at);