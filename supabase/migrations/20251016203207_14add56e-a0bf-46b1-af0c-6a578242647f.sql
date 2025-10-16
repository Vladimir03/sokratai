-- Create storage policies for chat-images bucket
-- Policies for storage.objects must be created with specific syntax

-- Policy: Allow authenticated users to insert files into their homework tasks folders
CREATE POLICY "Allow users to upload homework task photos"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'chat-images' 
  AND auth.role() = 'authenticated'
  AND (storage.foldername(name))[1] IN (
    SELECT ht.id::text
    FROM homework_tasks ht
    JOIN homework_sets hs ON hs.id = ht.homework_set_id
    WHERE hs.user_id = auth.uid()
  )
);

-- Policy: Allow authenticated users to read files from their homework tasks
CREATE POLICY "Allow users to read homework task photos"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'chat-images'
  AND (
    -- Public bucket, allow all reads
    true
  )
);

-- Policy: Allow authenticated users to update files in their homework tasks
CREATE POLICY "Allow users to update homework task photos"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'chat-images' 
  AND auth.role() = 'authenticated'
  AND (storage.foldername(name))[1] IN (
    SELECT ht.id::text
    FROM homework_tasks ht
    JOIN homework_sets hs ON hs.id = ht.homework_set_id
    WHERE hs.user_id = auth.uid()
  )
);

-- Policy: Allow authenticated users to delete files from their homework tasks
CREATE POLICY "Allow users to delete homework task photos"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'chat-images' 
  AND auth.role() = 'authenticated'
  AND (storage.foldername(name))[1] IN (
    SELECT ht.id::text
    FROM homework_tasks ht
    JOIN homework_sets hs ON hs.id = ht.homework_set_id
    WHERE hs.user_id = auth.uid()
  )
);