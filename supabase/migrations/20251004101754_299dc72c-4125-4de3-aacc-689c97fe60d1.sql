-- Create rate limiting table for chat API
CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  request_count INTEGER DEFAULT 0 NOT NULL,
  window_start TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Enable RLS
ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;

-- Users can only view their own rate limits
CREATE POLICY "Users can view own rate limits" 
ON public.api_rate_limits 
FOR SELECT 
USING (auth.uid() = user_id);

-- Users cannot modify rate limits (only edge functions can)
CREATE POLICY "Rate limits managed by system" 
ON public.api_rate_limits 
FOR ALL 
USING (false);