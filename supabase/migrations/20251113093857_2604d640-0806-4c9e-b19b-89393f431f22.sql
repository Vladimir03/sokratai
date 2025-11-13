-- Drop the old constraint that blocks 'photo'
ALTER TABLE public.chat_messages 
DROP CONSTRAINT IF EXISTS chat_messages_input_method_check;

-- Add new constraint with 'photo' support
ALTER TABLE public.chat_messages 
ADD CONSTRAINT chat_messages_input_method_check 
CHECK (input_method IN ('text', 'voice', 'button', 'photo'));