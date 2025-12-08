-- Add trial_ends_at column to profiles
ALTER TABLE profiles 
ADD COLUMN trial_ends_at timestamp with time zone;

-- Set 7-day trial for all existing free users
UPDATE profiles 
SET trial_ends_at = NOW() + INTERVAL '7 days'
WHERE subscription_tier = 'free' 
AND trial_ends_at IS NULL;

-- Premium users don't need trial
UPDATE profiles 
SET trial_ends_at = NULL 
WHERE subscription_tier = 'premium';

-- Update handle_new_user function to set trial for new users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, trial_ends_at)
  VALUES (
    NEW.id, 
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    NOW() + INTERVAL '7 days'
  );
  RETURN NEW;
END;
$$;