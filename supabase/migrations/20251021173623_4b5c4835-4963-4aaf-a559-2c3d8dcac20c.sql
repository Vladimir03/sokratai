-- Make chat-images bucket public so images can be displayed
UPDATE storage.buckets 
SET public = true 
WHERE id = 'chat-images';