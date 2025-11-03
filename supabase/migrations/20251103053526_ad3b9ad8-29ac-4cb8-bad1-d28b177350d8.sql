-- Миграция 1: Расширение таблицы profiles для онбординга

-- Добавляем колонки для онбординга
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS grade INTEGER,
ADD COLUMN IF NOT EXISTS difficult_subject TEXT,
ADD COLUMN IF NOT EXISTS learning_goal TEXT,
ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;

-- Комментарии для документации
COMMENT ON COLUMN profiles.grade IS 'Класс ученика (1-11)';
COMMENT ON COLUMN profiles.difficult_subject IS 'Сложный предмет: math, physics, cs';
COMMENT ON COLUMN profiles.learning_goal IS 'Цель обучения: ЕГЭ, ОГЭ, Школьная программа, Олимпиада, или произвольный текст';
COMMENT ON COLUMN profiles.onboarding_completed IS 'Флаг завершения онбординга';