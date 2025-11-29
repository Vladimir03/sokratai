-- Create telegram_login_tokens table for web authentication flow
CREATE TABLE public.telegram_login_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text UNIQUE NOT NULL,
  telegram_user_id bigint,
  user_id uuid,
  session_data jsonb,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'used', 'expired')),
  created_at timestamptz DEFAULT now(),
  verified_at timestamptz,
  expires_at timestamptz DEFAULT (now() + interval '5 minutes')
);

-- Enable RLS
ALTER TABLE public.telegram_login_tokens ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can do everything (for edge functions)
CREATE POLICY "Service role full access" ON public.telegram_login_tokens
  FOR ALL USING (true) WITH CHECK (true);

-- Create index for faster token lookups
CREATE INDEX idx_telegram_login_tokens_token ON public.telegram_login_tokens(token);
CREATE INDEX idx_telegram_login_tokens_status ON public.telegram_login_tokens(status);