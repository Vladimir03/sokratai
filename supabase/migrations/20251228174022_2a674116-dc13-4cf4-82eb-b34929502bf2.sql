-- Добавляем уникальный constraint для ON CONFLICT
ALTER TABLE user_ege_progress 
ADD CONSTRAINT user_ege_progress_user_ege_unique UNIQUE (user_id, ege_number);

-- Функция для автоматического обновления прогресса после каждой попытки
CREATE OR REPLACE FUNCTION update_user_ege_progress_on_attempt()
RETURNS TRIGGER AS $$
DECLARE
  v_ege_number integer;
BEGIN
  -- Получаем ege_number из задачи
  SELECT ege_number INTO v_ege_number
  FROM ege_problems
  WHERE id = NEW.problem_id;
  
  -- Если задача найдена, обновляем прогресс
  IF v_ege_number IS NOT NULL THEN
    INSERT INTO user_ege_progress (user_id, ege_number, total_attempts, correct_attempts, last_practiced_at)
    VALUES (
      NEW.user_id,
      v_ege_number,
      1,
      CASE WHEN NEW.is_correct THEN 1 ELSE 0 END,
      NOW()
    )
    ON CONFLICT (user_id, ege_number) 
    DO UPDATE SET
      total_attempts = user_ege_progress.total_attempts + 1,
      correct_attempts = user_ege_progress.correct_attempts + CASE WHEN NEW.is_correct THEN 1 ELSE 0 END,
      last_practiced_at = NOW(),
      updated_at = NOW();
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Триггер, срабатывающий после вставки в practice_attempts
CREATE TRIGGER on_practice_attempt_insert
AFTER INSERT ON practice_attempts
FOR EACH ROW EXECUTE FUNCTION update_user_ege_progress_on_attempt();