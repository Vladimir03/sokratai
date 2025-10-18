-- Create token usage logs table
CREATE TABLE public.token_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  chat_id UUID,
  model TEXT NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.token_usage_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own token usage
CREATE POLICY "Users can view own token usage"
ON public.token_usage_logs
FOR SELECT
USING (auth.uid() = user_id);

-- Policy: Service role can insert token usage (for edge functions)
CREATE POLICY "Service role can insert token usage"
ON public.token_usage_logs
FOR INSERT
WITH CHECK (true);

-- Index for better query performance
CREATE INDEX idx_token_usage_user_id ON public.token_usage_logs(user_id);
CREATE INDEX idx_token_usage_created_at ON public.token_usage_logs(created_at DESC);