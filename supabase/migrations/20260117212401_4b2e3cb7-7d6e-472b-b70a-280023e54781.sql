-- Добавить поле intended_role в таблицу telegram_login_tokens
ALTER TABLE public.telegram_login_tokens 
ADD COLUMN IF NOT EXISTS intended_role text DEFAULT NULL;