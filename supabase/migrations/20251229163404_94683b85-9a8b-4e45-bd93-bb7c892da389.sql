-- =====================================================
-- Diagnostic Module - Database Schema
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
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress' 
    CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  predicted_primary_score SMALLINT CHECK (predicted_primary_score BETWEEN 0 AND 12),
  predicted_test_score SMALLINT CHECK (predicted_test_score BETWEEN 0 AND 100),
  topic_scores JSONB DEFAULT '{}', 
  weak_topics SMALLINT[] DEFAULT '{}',
  strong_topics SMALLINT[] DEFAULT '{}',
  recommended_start_topic SMALLINT,
  current_question SMALLINT DEFAULT 1,
  total_questions SMALLINT DEFAULT 15,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  time_spent_seconds INT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Таблица ответов диагностики
CREATE TABLE IF NOT EXISTS diagnostic_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES diagnostic_sessions(id) ON DELETE CASCADE,
  problem_id UUID NOT NULL REFERENCES ege_problems(id),
  ege_number SMALLINT NOT NULL,
  user_answer TEXT NOT NULL,
  is_correct BOOLEAN NOT NULL,
  time_spent_seconds INT,
  question_order SMALLINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(session_id, question_order)
);

-- 4. Обновляем profiles
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS diagnostic_completed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS last_diagnostic_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_diagnostic_score SMALLINT;

-- 5. RLS политики
ALTER TABLE diagnostic_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE diagnostic_answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own diagnostic sessions" ON diagnostic_sessions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own diagnostic answers" ON diagnostic_answers FOR ALL USING (session_id IN (SELECT id FROM diagnostic_sessions WHERE user_id = auth.uid()));

-- 6. Функция для получения задач (RPC)
CREATE OR REPLACE FUNCTION get_diagnostic_problems(p_total_questions INT DEFAULT 15)
RETURNS TABLE (
  id UUID, ege_number SMALLINT, condition_text TEXT, condition_image_url TEXT,
  answer_type TEXT, correct_answer TEXT, topic TEXT, subtopic TEXT, difficulty SMALLINT
) AS $$
BEGIN
  RETURN QUERY
  WITH numbered_problems AS (
    SELECT ep.*, ROW_NUMBER() OVER (PARTITION BY ep.ege_number ORDER BY CASE WHEN ep.is_diagnostic THEN 0 ELSE 1 END, RANDOM()) as rn
    FROM ege_problems ep WHERE ep.is_active = true AND ep.ege_number BETWEEN 1 AND 12
  )
  SELECT s.id, s.ege_number, s.condition_text, s.condition_image_url, s.answer_type, s.correct_answer, s.topic, s.subtopic, s.difficulty
  FROM (SELECT * FROM numbered_problems WHERE rn <= 2) s
  ORDER BY s.ege_number, RANDOM() LIMIT p_total_questions;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;