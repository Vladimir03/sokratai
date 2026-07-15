CREATE TABLE IF NOT EXISTS public.ceo_digest_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mode        TEXT NOT NULL CHECK (mode IN ('weekly', 'daily')),
  period_key  TEXT NOT NULL,
  outcome     TEXT NOT NULL DEFAULT 'sent',
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mode, period_key)
);

ALTER TABLE public.ceo_digest_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ceo_digest_log FROM anon, authenticated;

COMMENT ON TABLE public.ceo_digest_log IS
  'Идемпотентность CEO-дайджеста (edge ceo-telegram-digest): одна отправка на (mode, period_key).';