-- Create broadcast_logs table to track all sent broadcasts
CREATE TABLE public.broadcast_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id bigint NOT NULL,
  broadcast_type text NOT NULL, -- 'activation_reminder', 'manual', 'scheduled'
  message_preview text, -- first 100 chars of the message
  sent_at timestamptz DEFAULT now(),
  success boolean DEFAULT true,
  error_message text
);

-- Enable RLS
ALTER TABLE public.broadcast_logs ENABLE ROW LEVEL SECURITY;

-- Only service role can access (for edge functions)
CREATE POLICY "Service role full access" ON public.broadcast_logs
  FOR ALL USING (true) WITH CHECK (true);

-- Indexes for efficient queries
CREATE INDEX idx_broadcast_logs_user ON public.broadcast_logs(telegram_user_id);
CREATE INDEX idx_broadcast_logs_type ON public.broadcast_logs(broadcast_type);
CREATE INDEX idx_broadcast_logs_sent_at ON public.broadcast_logs(sent_at DESC);