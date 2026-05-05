ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN profiles.trial_started_at IS
  'Timestamp когда репетитор начал trial. NULL для legacy и тех, кто пришёл не через trial-flow. P0: только measurement; AI-gating в P1 через tutor_subscriptions.';

CREATE INDEX IF NOT EXISTS idx_profiles_trial_started_at
  ON profiles(trial_started_at)
  WHERE trial_started_at IS NOT NULL;
