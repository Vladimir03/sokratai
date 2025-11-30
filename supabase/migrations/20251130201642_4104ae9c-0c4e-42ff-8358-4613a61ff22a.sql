-- Add subscription columns to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS subscription_tier text DEFAULT 'free' NOT NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS subscription_expires_at timestamp with time zone;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS promo_code text;

-- Set Lera as premium user (permanent)
UPDATE public.profiles 
SET subscription_tier = 'premium', 
    subscription_expires_at = NULL,
    promo_code = 'start50'
WHERE id = '86970564-1357-4d78-9f98-7d438dec4946';

-- Create table for daily message limits
CREATE TABLE public.daily_message_limits (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  messages_today integer DEFAULT 0 NOT NULL,
  last_reset_date date DEFAULT CURRENT_DATE NOT NULL
);

-- Enable RLS
ALTER TABLE public.daily_message_limits ENABLE ROW LEVEL SECURITY;

-- RLS policies for daily_message_limits
CREATE POLICY "Users can view own limits" ON public.daily_message_limits
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own limits" ON public.daily_message_limits
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own limits" ON public.daily_message_limits
  FOR UPDATE USING (auth.uid() = user_id);

-- Service role needs full access for edge function
CREATE POLICY "Service role full access" ON public.daily_message_limits
  FOR ALL USING (true) WITH CHECK (true);