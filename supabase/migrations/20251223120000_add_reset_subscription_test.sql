-- Function to reset subscription to free (for testing)
-- Only allowed for specific usernames
CREATE OR REPLACE FUNCTION public.reset_subscription_for_test()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username text;
  v_result jsonb;
BEGIN
  -- Get current user's username
  SELECT username INTO v_username
  FROM profiles
  WHERE id = auth.uid();

  -- Check if user is allowed to reset
  IF v_username IS NULL THEN
    RETURN jsonb_build_object('error', 'Profile not found');
  END IF;

  IF v_username NOT IN ('VladimirKam', 'Vladimir') THEN
    RETURN jsonb_build_object('error', 'Access denied');
  END IF;

  -- Reset subscription to free
  UPDATE profiles
  SET 
    subscription_tier = 'free',
    subscription_expires_at = NULL
  WHERE id = auth.uid();

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Subscription reset to free',
    'username', v_username
  );
END;
$$;

-- Comment
COMMENT ON FUNCTION public.reset_subscription_for_test() IS 'Test function to reset subscription to free tier for allowed users';

