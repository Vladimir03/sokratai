-- Add action_type column for distinguishing login vs link actions
ALTER TABLE telegram_login_tokens 
ADD COLUMN action_type text DEFAULT 'login';

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_telegram_login_tokens_action_type ON telegram_login_tokens(action_type);