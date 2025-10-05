-- Add columns for image support in chat messages
ALTER TABLE public.chat_messages 
ADD COLUMN image_url TEXT,
ADD COLUMN extracted_text TEXT;

-- Create bucket for chat images
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-images', 'chat-images', true);

-- RLS policy: Users can upload their own images
CREATE POLICY "Users can upload their own images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'chat-images' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- RLS policy: Images are publicly accessible
CREATE POLICY "Images are publicly accessible"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'chat-images');