-- =====================================================
-- Diagnostic Module - Database Schema
-- Диагностика уровня знаний для новых пользователей
-- =====================================================

-- 1. Добавляем флаг диагностики в ege_problems
ALTER TABLE ege_problems 
ADD COLUMN IF NOT EXISTS is_diagnostic BOOLEAN DEFAULT false;

-- Индекс для быстрого поиска диагностических задач
CREATE INDEX IF NOT EXISTS idx_ege_problems_diagnostic 
ON ege_problems(is_diagnostic) WHERE is_diagnostic = true;

-- 2. Таблица сессий диагностики
CREATE TABLE IF NOT EXISTS diagnostic_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Статус сессии
  status TEXT NOT NULL DEFAULT 'in_progress' 
    CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  
  -- Результаты (заполняются при status = 'completed')
  predicted_primary_score SMALLINT CHECK (predicted_primary_score BETWEEN 0 AND 12),
  predicted_test_score SMALLINT CHECK (predicted_test_score BETWEEN 0 AND 100),
  topic_scores JSONB DEFAULT '{}', 
  weak_topics SMALLINT[] DEFAULT '{}',
  strong_topics SMALLINT[] DEFAULT '{}',
  recommended_start_topic SMALLINT,
  
  -- Прогресс
  current_question SMALLINT DEFAULT 1,
  total_questions SMALLINT DEFAULT 15,
  
  -- Время
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  time_spent_seconds INT,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Индексы для diagnostic_sessions
CREATE INDEX IF NOT EXISTS idx_diagnostic_sessions_user_id 
  ON diagnostic_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_diagnostic_sessions_status 
  ON diagnostic_sessions(status);
CREATE INDEX IF NOT EXISTS idx_diagnostic_sessions_user_completed 
  ON diagnostic_sessions(user_id, completed_at DESC) 
  WHERE status = 'completed';

-- 3. Таблица ответов диагностики
CREATE TABLE IF NOT EXISTS diagnostic_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES diagnostic_sessions(id) ON DELETE CASCADE,
  problem_id UUID NOT NULL REFERENCES ege_problems(id),
  
  -- Данные ответа
  ege_number SMALLINT NOT NULL,
  user_answer TEXT NOT NULL,
  is_correct BOOLEAN NOT NULL,
  time_spent_seconds INT,
  
  -- Порядок вопроса в сессии
  question_order SMALLINT NOT NULL,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(session_id, question_order)
);

CREATE INDEX IF NOT EXISTS idx_diagnostic_answers_session 
  ON diagnostic_answers(session_id);

-- 4. Обновляем profiles - добавляем поля для диагностики
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS diagnostic_completed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS last_diagnostic_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_diagnostic_score SMALLINT;

-- 5. RLS политики
ALTER TABLE diagnostic_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE diagnostic_answers ENABLE ROW LEVEL SECURITY;

-- Политики для diagnostic_sessions
CREATE POLICY "Users can read own diagnostic sessions" 
  ON diagnostic_sessions FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own diagnostic sessions" 
  ON diagnostic_sessions FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own diagnostic sessions" 
  ON diagnostic_sessions FOR UPDATE 
  USING (auth.uid() = user_id);

-- Политики для diagnostic_answers
CREATE POLICY "Users can read own diagnostic answers" 
  ON diagnostic_answers FOR SELECT 
  USING (
    session_id IN (
      SELECT id FROM diagnostic_sessions WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own diagnostic answers" 
  ON diagnostic_answers FOR INSERT 
  WITH CHECK (
    session_id IN (
      SELECT id FROM diagnostic_sessions WHERE user_id = auth.uid()
    )
  );

-- 6. Триггер updated_at для diagnostic_sessions
DROP TRIGGER IF EXISTS update_diagnostic_sessions_updated_at ON diagnostic_sessions;
CREATE TRIGGER update_diagnostic_sessions_updated_at
  BEFORE UPDATE ON diagnostic_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 7. Функция для получения задач диагностики
-- Возвращает по 1-2 задачи на каждый номер ЕГЭ (1-12)
CREATE OR REPLACE FUNCTION get_diagnostic_problems(p_total_questions INT DEFAULT 15)
RETURNS TABLE (
  id UUID,
  ege_number SMALLINT,
  condition_text TEXT,
  condition_image_url TEXT,
  answer_type TEXT,
  correct_answer TEXT,
  topic TEXT,
  subtopic TEXT,
  difficulty SMALLINT
) AS $$
DECLARE
  questions_per_number INT;
  extra_questions INT;
BEGIN
  -- Распределяем вопросы: 15 вопросов на 12 номеров
  -- Базово по 1 на номер, + 3 дополнительных для сложных тем
  questions_per_number := p_total_questions / 12;
  extra_questions := p_total_questions % 12;
  
  RETURN QUERY
  WITH numbered_problems AS (
    SELECT 
      ep.*,
      ROW_NUMBER() OVER (PARTITION BY ep.ege_number ORDER BY 
        CASE WHEN ep.is_diagnostic THEN 0 ELSE 1 END,
        RANDOM()
      ) as rn
    FROM ege_problems ep
    WHERE ep.is_active = true
      AND ep.ege_number BETWEEN 1 AND 12
  ),
  selected AS (
    SELECT np.*
    FROM numbered_problems np
    WHERE np.rn <= CASE 
      -- Даём дополнительные вопросы сложным темам (7, 9, 12)
      WHEN np.ege_number IN (7, 9, 12) AND extra_questions > 0 THEN 2
      ELSE 1
    END
  )
  SELECT 
    s.id,
    s.ege_number,
    s.condition_text,
    s.condition_image_url,
    s.answer_type,
    s.correct_answer,
    s.topic,
    s.subtopic,
    s.difficulty
  FROM selected s
  ORDER BY s.ege_number, RANDOM()
  LIMIT p_total_questions;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Комментарии
COMMENT ON TABLE diagnostic_sessions IS 'Сессии диагностики уровня знаний';
COMMENT ON TABLE diagnostic_answers IS 'Ответы пользователя в диагностике';
COMMENT ON COLUMN profiles.diagnostic_completed IS 'Прошёл ли пользователь диагностику';
COMMENT ON COLUMN profiles.last_diagnostic_at IS 'Дата последней диагностики';
COMMENT ON COLUMN profiles.last_diagnostic_score IS 'Балл последней диагностики (0-100)';

