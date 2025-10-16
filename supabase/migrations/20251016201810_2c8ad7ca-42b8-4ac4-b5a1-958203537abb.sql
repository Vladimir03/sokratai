-- Fix: Add authorization check to prevent users from updating other users' stats
CREATE OR REPLACE FUNCTION public.update_user_stats_on_solve(
  p_user_id uuid,
  p_is_correct boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last_activity timestamp with time zone;
  v_current_streak integer;
  v_new_streak integer;
  v_xp_reward integer := 10;
BEGIN
  -- CRITICAL: Verify caller owns this user_id
  IF auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Access denied: Cannot update other users stats';
  END IF;

  -- Get or create user stats
  INSERT INTO public.user_stats (user_id, last_activity)
  VALUES (p_user_id, now())
  ON CONFLICT (user_id) DO NOTHING;

  -- Get current stats
  SELECT last_activity, current_streak
  INTO v_last_activity, v_current_streak
  FROM public.user_stats
  WHERE user_id = p_user_id;

  -- Calculate new streak
  IF v_last_activity IS NULL THEN
    -- First activity
    v_new_streak := 1;
  ELSIF DATE(v_last_activity) = CURRENT_DATE THEN
    -- Already solved today, keep streak
    v_new_streak := v_current_streak;
  ELSIF DATE(v_last_activity) = CURRENT_DATE - INTERVAL '1 day' THEN
    -- Solved yesterday, increment streak
    v_new_streak := v_current_streak + 1;
  ELSE
    -- Missed days, reset streak
    v_new_streak := 1;
  END IF;

  -- Update stats (only if correct answer)
  IF p_is_correct THEN
    UPDATE public.user_stats
    SET 
      total_xp = total_xp + v_xp_reward,
      current_streak = v_new_streak,
      last_activity = now(),
      level = FLOOR((total_xp + v_xp_reward) / 100) + 1
    WHERE user_id = p_user_id;
  ELSE
    -- Update last_activity and streak even for incorrect answers
    UPDATE public.user_stats
    SET 
      current_streak = v_new_streak,
      last_activity = now()
    WHERE user_id = p_user_id;
  END IF;
END;
$$;