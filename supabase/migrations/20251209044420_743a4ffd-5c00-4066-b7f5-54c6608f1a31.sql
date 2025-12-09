-- Create RPC function to get subscription status
CREATE OR REPLACE FUNCTION public.get_subscription_status(p_user_id uuid)
RETURNS TABLE (
  is_premium boolean,
  subscription_expires_at timestamp with time zone,
  is_trial_active boolean,
  trial_ends_at timestamp with time zone,
  trial_days_left integer,
  daily_limit integer,
  messages_used integer,
  limit_reached boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subscription_tier text;
  v_subscription_expires timestamptz;
  v_trial_ends timestamptz;
  v_is_premium boolean := false;
  v_is_trial_active boolean := false;
  v_trial_days_left integer := 0;
  v_messages_used integer := 0;
  v_daily_limit integer := 10;
BEGIN
  -- Get profile data
  SELECT 
    p.subscription_tier,
    p.subscription_expires_at,
    p.trial_ends_at
  INTO v_subscription_tier, v_subscription_expires, v_trial_ends
  FROM profiles p
  WHERE p.id = p_user_id;

  -- Check premium status
  v_is_premium := (v_subscription_tier = 'premium') AND 
                  (v_subscription_expires IS NULL OR v_subscription_expires > NOW());

  -- Check trial status
  IF v_trial_ends IS NOT NULL AND v_trial_ends > NOW() THEN
    v_is_trial_active := true;
    v_trial_days_left := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_trial_ends - NOW())) / 86400))::integer;
  END IF;

  -- Get messages used today (only if not premium and not trial)
  IF NOT v_is_premium AND NOT v_is_trial_active THEN
    SELECT COALESCE(messages_today, 0)
    INTO v_messages_used
    FROM daily_message_limits
    WHERE user_id = p_user_id AND last_reset_date = CURRENT_DATE;
    
    -- If no record found, default to 0
    IF v_messages_used IS NULL THEN
      v_messages_used := 0;
    END IF;
  END IF;

  RETURN QUERY SELECT 
    v_is_premium,
    v_subscription_expires,
    v_is_trial_active,
    v_trial_ends,
    v_trial_days_left,
    v_daily_limit,
    v_messages_used,
    (NOT v_is_premium AND NOT v_is_trial_active AND v_messages_used >= v_daily_limit);
END;
$$;

-- Update trial_ends_at for existing users based on first message
UPDATE profiles p
SET trial_ends_at = (
  SELECT MIN(cm.created_at) + INTERVAL '7 days'
  FROM chat_messages cm
  WHERE cm.user_id = p.id
)
WHERE p.subscription_tier = 'free'
  AND EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.user_id = p.id);

-- For users without messages - trial from registration date + 7 days
UPDATE profiles p
SET trial_ends_at = p.created_at + INTERVAL '7 days'
WHERE p.subscription_tier = 'free'
  AND NOT EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.user_id = p.id)
  AND (trial_ends_at IS NULL OR trial_ends_at = '2025-07-09 18:28:26.252966+00');

-- For premium users - remove trial
UPDATE profiles
SET trial_ends_at = NULL
WHERE subscription_tier = 'premium';