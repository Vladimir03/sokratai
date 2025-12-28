-- 1. Добавляем колонку в таблицу profiles (если её ещё нет)
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS current_streak INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_streak_update TIMESTAMPTZ;

-- 2. Создаём функцию для проверки и обновления стрика
CREATE OR REPLACE FUNCTION check_and_update_streak(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_streak INTEGER;
  v_last_update TIMESTAMPTZ;
  v_solved_today INTEGER;
  v_goal INTEGER := 10;
BEGIN
  SELECT current_streak, last_streak_update INTO v_current_streak, v_last_update
  FROM profiles WHERE id = p_user_id;

  IF v_last_update IS NOT NULL AND v_last_update::DATE = CURRENT_DATE THEN
    RETURN v_current_streak;
  END IF;

  SELECT COUNT(*) INTO v_solved_today
  FROM practice_attempts
  WHERE user_id = p_user_id AND created_at::DATE = CURRENT_DATE;

  IF v_solved_today >= v_goal THEN
    IF v_last_update IS NOT NULL AND v_last_update::DATE = CURRENT_DATE - INTERVAL '1 day' THEN
      v_current_streak := COALESCE(v_current_streak, 0) + 1;
    ELSE
      v_current_streak := 1;
    END IF;

    UPDATE profiles
    SET current_streak = v_current_streak,
        last_streak_update = now()
    WHERE id = p_user_id;
    
    RETURN v_current_streak;
  END IF;

  RETURN COALESCE(v_current_streak, 0);
END;
$$;