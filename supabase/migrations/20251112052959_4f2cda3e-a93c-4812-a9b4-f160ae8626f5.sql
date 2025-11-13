-- Clean up corrupted messages with empty content and no image
DELETE FROM chat_messages 
WHERE (content IS NULL OR content = '') 
  AND (image_url IS NULL OR image_url = '');