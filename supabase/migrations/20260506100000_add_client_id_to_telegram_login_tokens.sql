-- Trial Telegram login: stale-token absorb via client_id
--
-- Each browser session generates a UUID stored in localStorage and includes
-- it on every telegram_login_token created. When the bot processes a /start
-- with a deep-link param, after verifying that one token it also marks
-- verified ALL other pending tokens sharing the same client_id. Solves the
-- "Telegram cached old deep-link param, bot keeps processing OLDER tokens"
-- bug — frontend's polling on the latest token now picks up via absorb.
--
-- Safe: client_id is browser-local; cross-browser collision astronomically
-- unlikely. Only pending tokens are absorbed (no overwrite of verified/used).

ALTER TABLE public.telegram_login_tokens
  ADD COLUMN IF NOT EXISTS client_id text NULL;

COMMENT ON COLUMN public.telegram_login_tokens.client_id IS
  'Browser-local UUID (sokrat_tg_client_id in localStorage). Used by bot to absorb sibling pending tokens from the same browser session when a deep-link is processed.';

-- Partial index keeps the absorb lookup cheap (only pending tokens within
-- the 5-minute window matter).
CREATE INDEX IF NOT EXISTS idx_telegram_login_tokens_client_id_pending
  ON public.telegram_login_tokens(client_id)
  WHERE client_id IS NOT NULL AND status = 'pending';
