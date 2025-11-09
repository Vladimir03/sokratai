-- STAGE 1: Database Extension for Telegram Integration

-- 1.1 Add Telegram fields to profiles table
ALTER TABLE profiles 
  ADD COLUMN IF NOT EXISTS telegram_user_id BIGINT UNIQUE,
  ADD COLUMN IF NOT EXISTS telegram_username TEXT,
  ADD COLUMN IF NOT EXISTS registration_source TEXT DEFAULT 'web';

-- Index for fast Telegram ID lookups
CREATE INDEX IF NOT EXISTS idx_profiles_telegram_user_id ON profiles(telegram_user_id);

-- 1.2 Add source tracking to onboarding_analytics
ALTER TABLE onboarding_analytics 
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS utm_source TEXT,
  ADD COLUMN IF NOT EXISTS telegram_user_id BIGINT;

-- Index for UTM analytics
CREATE INDEX IF NOT EXISTS idx_onboarding_utm ON onboarding_analytics(utm_source);
CREATE INDEX IF NOT EXISTS idx_onboarding_source ON onboarding_analytics(source);

-- 1.3 Create telegram_sessions table for bot state management
CREATE TABLE IF NOT EXISTS telegram_sessions (
  telegram_user_id BIGINT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  onboarding_state TEXT DEFAULT 'welcome',
  onboarding_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on telegram_sessions
ALTER TABLE telegram_sessions ENABLE ROW LEVEL SECURITY;

-- RLS policies for telegram_sessions
CREATE POLICY "Users can view their own telegram session"
  ON telegram_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own telegram session"
  ON telegram_sessions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage all telegram sessions"
  ON telegram_sessions FOR ALL
  USING (auth.role() = 'service_role');

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_telegram_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER telegram_sessions_updated_at
  BEFORE UPDATE ON telegram_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_telegram_sessions_updated_at();