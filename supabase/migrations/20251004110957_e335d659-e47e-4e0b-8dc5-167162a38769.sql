-- Create user_stats table for gamification
CREATE TABLE public.user_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  current_streak integer NOT NULL DEFAULT 0,
  total_xp integer NOT NULL DEFAULT 0,
  level integer NOT NULL DEFAULT 1,
  last_activity timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_stats ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own stats"
  ON public.user_stats FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own stats"
  ON public.user_stats FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own stats"
  ON public.user_stats FOR UPDATE
  USING (auth.uid() = user_id);

-- Function to update user stats after solving a problem
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

-- Trigger to create user_stats when new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_stats (user_id)
  VALUES (NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_stats
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_stats();