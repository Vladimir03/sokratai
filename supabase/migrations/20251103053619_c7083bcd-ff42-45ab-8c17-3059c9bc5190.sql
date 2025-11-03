-- Миграция 2: Таблица аналитики онбординга

-- Создаем таблицу для сбора аналитики
CREATE TABLE IF NOT EXISTS onboarding_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  grade INTEGER,
  subject TEXT,
  goal TEXT,
  
  -- Длительность каждого этапа в миллисекундах
  step1_duration_ms INTEGER,
  step2_duration_ms INTEGER,
  step3_duration_ms INTEGER,
  step4_duration_ms INTEGER,
  step5_duration_ms INTEGER,
  
  -- Аналитика ЭТАПА 2 (демо)
  demo_hints_used INTEGER DEFAULT 0,
  demo_answer_attempted BOOLEAN DEFAULT false,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Индекс для быстрого поиска по пользователям
CREATE INDEX idx_onboarding_analytics_user_id ON onboarding_analytics(user_id);

-- RLS policies
ALTER TABLE onboarding_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own analytics"
  ON onboarding_analytics FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own analytics"
  ON onboarding_analytics FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own analytics"
  ON onboarding_analytics FOR UPDATE
  USING (auth.uid() = user_id);

-- Функция для инкремента количества подсказок
CREATE OR REPLACE FUNCTION increment_demo_hints(analytics_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE onboarding_analytics 
  SET demo_hints_used = demo_hints_used + 1
  WHERE id = analytics_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;