DELETE FROM chat_messages 
WHERE chat_id = '824206d7-5cfc-4919-8645-b68260f9b34f'
  AND role = 'user'
  AND created_at >= '2026-03-23'
  AND id NOT IN (
    SELECT id FROM chat_messages
    WHERE chat_id = '824206d7-5cfc-4919-8645-b68260f9b34f'
      AND role = 'user'
      AND created_at >= '2026-03-23'
    ORDER BY created_at DESC
    LIMIT 1
  );