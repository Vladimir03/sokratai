-- Create homework_sets table
CREATE TABLE public.homework_sets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  topic TEXT NOT NULL,
  photo_url TEXT,
  deadline DATE,
  priority TEXT NOT NULL DEFAULT 'later' CHECK (priority IN ('urgent', 'important', 'later')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create homework_tasks table
CREATE TABLE public.homework_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  homework_set_id UUID NOT NULL REFERENCES public.homework_sets(id) ON DELETE CASCADE,
  task_number TEXT NOT NULL,
  condition_text TEXT,
  condition_photo_url TEXT,
  ai_analysis JSONB,
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create homework_chat_messages table
CREATE TABLE public.homework_chat_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  homework_task_id UUID NOT NULL REFERENCES public.homework_tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create triggers for updated_at
CREATE TRIGGER update_homework_sets_updated_at
  BEFORE UPDATE ON public.homework_sets
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER update_homework_tasks_updated_at
  BEFORE UPDATE ON public.homework_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Enable Row Level Security
ALTER TABLE public.homework_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_chat_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies for homework_sets
CREATE POLICY "Users can view their own homework sets"
  ON public.homework_sets
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own homework sets"
  ON public.homework_sets
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own homework sets"
  ON public.homework_sets
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own homework sets"
  ON public.homework_sets
  FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for homework_tasks
CREATE POLICY "Users can view their own homework tasks"
  ON public.homework_tasks
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.homework_sets
      WHERE homework_sets.id = homework_tasks.homework_set_id
      AND homework_sets.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert tasks to their own homework sets"
  ON public.homework_tasks
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.homework_sets
      WHERE homework_sets.id = homework_tasks.homework_set_id
      AND homework_sets.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own homework tasks"
  ON public.homework_tasks
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.homework_sets
      WHERE homework_sets.id = homework_tasks.homework_set_id
      AND homework_sets.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their own homework tasks"
  ON public.homework_tasks
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.homework_sets
      WHERE homework_sets.id = homework_tasks.homework_set_id
      AND homework_sets.user_id = auth.uid()
    )
  );

-- RLS Policies for homework_chat_messages
CREATE POLICY "Users can view chat messages for their homework tasks"
  ON public.homework_chat_messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.homework_tasks
      JOIN public.homework_sets ON homework_sets.id = homework_tasks.homework_set_id
      WHERE homework_tasks.id = homework_chat_messages.homework_task_id
      AND homework_sets.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert chat messages to their homework tasks"
  ON public.homework_chat_messages
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.homework_tasks
      JOIN public.homework_sets ON homework_sets.id = homework_tasks.homework_set_id
      WHERE homework_tasks.id = homework_chat_messages.homework_task_id
      AND homework_sets.user_id = auth.uid()
    )
  );

-- Create indexes for better performance
CREATE INDEX idx_homework_sets_user_id ON public.homework_sets(user_id);
CREATE INDEX idx_homework_sets_priority ON public.homework_sets(priority);
CREATE INDEX idx_homework_sets_deadline ON public.homework_sets(deadline);
CREATE INDEX idx_homework_tasks_homework_set_id ON public.homework_tasks(homework_set_id);
CREATE INDEX idx_homework_tasks_status ON public.homework_tasks(status);
CREATE INDEX idx_homework_chat_messages_homework_task_id ON public.homework_chat_messages(homework_task_id);
CREATE INDEX idx_homework_chat_messages_user_id ON public.homework_chat_messages(user_id);