-- Add image_path column to chat_messages table
-- This stores the file path in storage (persistent) instead of signed URL (temporary)
ALTER TABLE chat_messages 
ADD COLUMN IF NOT EXISTS image_path TEXT;

-- Create index for faster lookups of messages with images
CREATE INDEX IF NOT EXISTS idx_chat_messages_image_path ON chat_messages(image_path) 
WHERE image_path IS NOT NULL;

-- Add comment explaining the column
COMMENT ON COLUMN chat_messages.image_path IS 'Storage file path for image (e.g., user_id/timestamp-filename.jpg). Used to generate fresh signed URLs on load.';