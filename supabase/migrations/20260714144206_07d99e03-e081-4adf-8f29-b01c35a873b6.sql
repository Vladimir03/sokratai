CREATE TABLE IF NOT EXISTS public.oauth_state_store (
  handle TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oauth_state_store_created_at
  ON public.oauth_state_store (created_at);

ALTER TABLE public.oauth_state_store ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.oauth_state_store FROM anon, authenticated;
GRANT ALL ON public.oauth_state_store TO service_role;