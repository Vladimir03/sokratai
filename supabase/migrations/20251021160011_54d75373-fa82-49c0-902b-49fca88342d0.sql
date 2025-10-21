-- Make chat-images bucket private to prevent unauthorized access
UPDATE storage.buckets 
SET public = false 
WHERE id = 'chat-images';

-- Add RLS policy so users can only view their own uploaded images
CREATE POLICY "Users can view their own chat images"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'chat-images' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow users to upload their own images
CREATE POLICY "Users can upload their own chat images"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'chat-images' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow users to delete their own images
CREATE POLICY "Users can delete their own chat images"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'chat-images' AND
  auth.uid()::text = (storage.foldername(name))[1]
);