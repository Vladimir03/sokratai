-- Create table for tracking message interactions
CREATE TABLE public.message_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  interaction_type TEXT NOT NULL CHECK (interaction_type IN ('copy', 'view', 'share')),
  interaction_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(message_id, user_id, interaction_type)
);

-- Enable RLS
ALTER TABLE public.message_interactions ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own interactions"
  ON public.message_interactions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own interactions"
  ON public.message_interactions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own interactions"
  ON public.message_interactions
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX idx_message_interactions_message_user 
  ON public.message_interactions(message_id, user_id);

CREATE INDEX idx_message_interactions_type 
  ON public.message_interactions(interaction_type);

-- Trigger for updating updated_at
CREATE TRIGGER update_message_interactions_updated_at
  BEFORE UPDATE ON public.message_interactions
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();