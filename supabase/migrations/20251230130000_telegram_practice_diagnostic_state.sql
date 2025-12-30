-- =====================================================
-- Telegram Bot: Practice & Diagnostic State
-- Добавляем поля для состояния тренажёра и диагностики
-- =====================================================

-- 1. Добавляем колонки для состояния в telegram_sessions
ALTER TABLE telegram_sessions 
ADD COLUMN IF NOT EXISTS practice_state JSONB DEFAULT NULL,
ADD COLUMN IF NOT EXISTS diagnostic_state JSONB DEFAULT NULL;

-- 2. Комментарии для документации
COMMENT ON COLUMN telegram_sessions.practice_state IS 
  'Текущее состояние тренажёра: {ege_number: number, current_problem_id: string, started_at: timestamp}';

COMMENT ON COLUMN telegram_sessions.diagnostic_state IS 
  'Текущее состояние диагностики: {session_id: string, problems: [{id, ege_number}], current_index: number, answers: {index: {answer, is_correct}}}';

-- 3. Добавляем поле mode для отслеживания текущего режима бота
ALTER TABLE telegram_sessions 
ADD COLUMN IF NOT EXISTS current_mode TEXT DEFAULT 'chat' 
  CHECK (current_mode IN ('chat', 'practice', 'diagnostic'));

COMMENT ON COLUMN telegram_sessions.current_mode IS 
  'Текущий режим работы бота: chat (обычный AI), practice (тренажёр), diagnostic (диагностика)';

-- 4. Индексы для быстрого поиска активных сессий тренажёра/диагностики
CREATE INDEX IF NOT EXISTS idx_telegram_sessions_practice_active 
  ON telegram_sessions(telegram_user_id) 
  WHERE practice_state IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_telegram_sessions_diagnostic_active 
  ON telegram_sessions(telegram_user_id) 
  WHERE diagnostic_state IS NOT NULL;

-- 5. Добавляем RLS политику для service role (если ещё нет)
-- Service role должен иметь возможность обновлять состояние
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'telegram_sessions' 
    AND policyname = 'Service role can manage telegram sessions'
  ) THEN
    CREATE POLICY "Service role can manage telegram sessions"
      ON telegram_sessions
      FOR ALL
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;


