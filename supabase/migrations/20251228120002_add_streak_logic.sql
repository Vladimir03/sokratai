-- Функция для автоматического обновления стрейка
CREATE OR REPLACE FUNCTION check_and_update_streak(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_streak INTEGER;
  v_last_update TIMESTAMPTZ;
  v_solved_today INTEGER;
  v_goal INTEGER := 10;
BEGIN
  -- Получаем текущие данные из профиля (или user_stats, если таблица существует)
  -- В текущем проекте стрейк лежит в profiles
  SELECT current_streak, last_streak_update INTO v_current_streak, v_last_update
  FROM profiles
  WHERE id = p_user_id;

  -- Если за сегодня уже обновляли стрейк, просто возвращаем текущий
  IF v_last_update IS NOT NULL AND v_last_update::DATE = CURRENT_DATE THEN
    RETURN v_current_streak;
  END IF;

  -- Считаем количество решенных задач за сегодня
  SELECT COUNT(*) INTO v_solved_today
  FROM practice_attempts
  WHERE user_id = p_user_id AND created_at::DATE = CURRENT_DATE;

  -- Если цель достигнута
  IF v_solved_today >= v_goal THEN
    -- Проверяем, был ли вчера активный день
    IF v_last_update IS NOT NULL AND v_last_update::DATE = CURRENT_DATE - INTERVAL '1 day' THEN
      v_current_streak := COALESCE(v_current_streak, 0) + 1;
    ELSE
      -- Если пропустил день или это первый раз
      v_current_streak := 1;
    END IF;

    -- Обновляем профиль
    UPDATE profiles
    SET current_streak = v_current_streak,
        last_streak_update = now()
    WHERE id = p_user_id;
    
    RETURN v_current_streak;
  END IF;

  RETURN COALESCE(v_current_streak, 0);
END;
$$;

