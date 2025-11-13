-- Create solutions table to store AI-generated solutions
CREATE TABLE IF NOT EXISTS public.solutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_chat_id BIGINT,
  telegram_user_id BIGINT,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  problem_text TEXT NOT NULL,
  solution_data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE public.solutions ENABLE ROW LEVEL SECURITY;

-- Create policy for users to view their own solutions
CREATE POLICY "Users can view their own solutions"
ON public.solutions
FOR SELECT
USING (auth.uid() = user_id);

-- Create policy for users to create their own solutions
CREATE POLICY "Users can create their own solutions"
ON public.solutions
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Create policy for service role to insert solutions (for telegram bot)
CREATE POLICY "Service role can insert solutions"
ON public.solutions
FOR INSERT
WITH CHECK (true);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_solutions_user_id ON public.solutions(user_id);
CREATE INDEX IF NOT EXISTS idx_solutions_telegram_user_id ON public.solutions(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_solutions_created_at ON public.solutions(created_at DESC);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_solutions_updated_at
BEFORE UPDATE ON public.solutions
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();