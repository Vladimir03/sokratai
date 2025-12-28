-- =====================================================
-- EGE Practice Module - Database Schema
-- Таблицы для тренажёра ЕГЭ по математике
-- =====================================================

-- 1. Таблица задач ЕГЭ
CREATE TABLE IF NOT EXISTS ege_problems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Метаданные задачи
  ege_number SMALLINT NOT NULL CHECK (ege_number BETWEEN 1 AND 19),
  year SMALLINT DEFAULT 2025,
  variant_source TEXT, -- Источник: 'fipi', 'reshuege', 'author'
  source_id TEXT, -- ID в источнике
  
  -- Условие задачи
  condition_text TEXT NOT NULL,
  condition_image_url TEXT,
  
  -- Ответ
  answer_type TEXT NOT NULL CHECK (answer_type IN (
    'integer', 'decimal', 'fraction', 'multiple_choice', 'text', 'sequence'
  )),
  correct_answer TEXT NOT NULL,
  answer_tolerance DECIMAL(10,6) DEFAULT 0, -- Погрешность для decimal
  
  -- Решение и подсказки
  solution_text TEXT,
  solution_video_url TEXT,
  hints JSONB DEFAULT '[]'::jsonb,
  
  -- Классификация
  topic TEXT NOT NULL,
  subtopic TEXT,
  difficulty SMALLINT DEFAULT 1 CHECK (difficulty BETWEEN 1 AND 3), -- 1-легко, 2-средне, 3-сложно
  tags TEXT[] DEFAULT '{}',
  
  -- Статус
  is_active BOOLEAN DEFAULT true,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_ege_problems_ege_number ON ege_problems(ege_number);
CREATE INDEX IF NOT EXISTS idx_ege_problems_difficulty ON ege_problems(difficulty);
CREATE INDEX IF NOT EXISTS idx_ege_problems_topic ON ege_problems(topic);
CREATE INDEX IF NOT EXISTS idx_ege_problems_is_active ON ege_problems(is_active);

-- 2. Таблица попыток решения
CREATE TABLE IF NOT EXISTS practice_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  problem_id UUID NOT NULL REFERENCES ege_problems(id) ON DELETE CASCADE,
  
  -- Ответ пользователя
  user_answer TEXT NOT NULL,
  is_correct BOOLEAN NOT NULL,
  
  -- Время
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Метрики
  hints_used SMALLINT DEFAULT 0,
  asked_ai BOOLEAN DEFAULT false,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Индексы для статистики
CREATE INDEX IF NOT EXISTS idx_practice_attempts_user_id ON practice_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_practice_attempts_problem_id ON practice_attempts(problem_id);
CREATE INDEX IF NOT EXISTS idx_practice_attempts_created_at ON practice_attempts(created_at);
CREATE INDEX IF NOT EXISTS idx_practice_attempts_is_correct ON practice_attempts(is_correct);

-- 3. Таблица прогресса пользователя по номерам ЕГЭ
CREATE TABLE IF NOT EXISTS user_ege_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ege_number SMALLINT NOT NULL CHECK (ege_number BETWEEN 1 AND 19),
  
  -- Статистика
  total_attempts INTEGER DEFAULT 0,
  correct_attempts INTEGER DEFAULT 0,
  current_difficulty SMALLINT DEFAULT 1 CHECK (current_difficulty BETWEEN 1 AND 3),
  
  -- Время
  last_practiced_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id, ege_number)
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_user_ege_progress_user_id ON user_ege_progress(user_id);

-- =====================================================
-- Row Level Security (RLS)
-- =====================================================

-- Включаем RLS для таблиц
ALTER TABLE ege_problems ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_ege_progress ENABLE ROW LEVEL SECURITY;

-- Политики для ege_problems (все могут читать активные задачи)
CREATE POLICY "Anyone can read active problems" 
  ON ege_problems FOR SELECT 
  USING (is_active = true);

-- Политики для practice_attempts
CREATE POLICY "Users can read own attempts" 
  ON practice_attempts FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own attempts" 
  ON practice_attempts FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

-- Политики для user_ege_progress
CREATE POLICY "Users can read own progress" 
  ON user_ege_progress FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own progress" 
  ON user_ege_progress FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own progress" 
  ON user_ege_progress FOR UPDATE 
  USING (auth.uid() = user_id);

-- =====================================================
-- Триггер для обновления updated_at
-- =====================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Триггеры
DROP TRIGGER IF EXISTS update_ege_problems_updated_at ON ege_problems;
CREATE TRIGGER update_ege_problems_updated_at
  BEFORE UPDATE ON ege_problems
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_ege_progress_updated_at ON user_ege_progress;
CREATE TRIGGER update_user_ege_progress_updated_at
  BEFORE UPDATE ON user_ege_progress
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

