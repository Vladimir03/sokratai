-- OAuth server-side state store (2026-07-14).
--
-- VK ID (id.vk.com) mangles/truncates the OAuth `state` param when it exceeds
-- ~128 chars: our compact signed state with the inline PKCE code_verifier is
-- ~195 chars → VK corrupts it → the callback fails HMAC verify → invalid_state
-- on EVERY VK login. (Yandex's state is ~128 with no verifier and round-trips
-- fine.) Fix: keep the full payload server-side keyed by a short random handle;
-- the OAuth `state` param carries only the ~32-char handle, which VK preserves.
--
-- service_role only (RLS on, no policies): the OAuth edge functions write/read
-- via service_role (bypasses RLS); no client ever touches this table. One-time
-- use + TTL are enforced in the edge functions (delete-on-read + created_at
-- age check).

CREATE TABLE IF NOT EXISTS public.oauth_state_store (
  handle TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cheap cleanup of abandoned handles (flows the user never completed).
CREATE INDEX IF NOT EXISTS idx_oauth_state_store_created_at
  ON public.oauth_state_store (created_at);

ALTER TABLE public.oauth_state_store ENABLE ROW LEVEL SECURITY;

-- Defense in depth: no anon/authenticated access at all (no policies grant it,
-- and revoke any table-level grants). Only service_role (RLS-exempt) uses it.
REVOKE ALL ON public.oauth_state_store FROM anon, authenticated;
