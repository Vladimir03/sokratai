-- Add input_method column to track how user sent the message
ALTER TABLE public.chat_messages 
ADD COLUMN input_method TEXT DEFAULT 'text' CHECK (input_method IN ('text', 'voice', 'button'));