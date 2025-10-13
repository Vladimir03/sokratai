-- Create chats table
CREATE TABLE public.chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  chat_type TEXT NOT NULL CHECK (chat_type IN ('general', 'homework_task', 'custom')),
  title TEXT,
  homework_task_id UUID REFERENCES public.homework_tasks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  icon TEXT,
  
  CONSTRAINT homework_task_chat_has_task 
    CHECK (chat_type != 'homework_task' OR homework_task_id IS NOT NULL),
  
  CONSTRAINT custom_chat_has_title 
    CHECK (chat_type != 'custom' OR title IS NOT NULL)
);

-- Create indexes for fast lookup
CREATE INDEX idx_chats_user_id ON public.chats(user_id);
CREATE INDEX idx_chats_task_id ON public.chats(homework_task_id);
CREATE INDEX idx_chats_last_message ON public.chats(last_message_at DESC);

-- Enable RLS
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;

-- RLS policies for chats
CREATE POLICY "Users can view their own chats"
  ON public.chats FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own chats"
  ON public.chats FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own chats"
  ON public.chats FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own chats"
  ON public.chats FOR DELETE
  USING (auth.uid() = user_id);

-- Add chat_id to chat_messages
ALTER TABLE public.chat_messages 
  ADD COLUMN chat_id UUID REFERENCES public.chats(id) ON DELETE CASCADE;

-- Create index for chat_id
CREATE INDEX idx_chat_messages_chat_id ON public.chat_messages(chat_id);

-- Create trigger to update chats.updated_at
CREATE OR REPLACE FUNCTION public.update_chat_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_chats_updated_at
  BEFORE UPDATE ON public.chats
  FOR EACH ROW
  EXECUTE FUNCTION public.update_chat_updated_at();