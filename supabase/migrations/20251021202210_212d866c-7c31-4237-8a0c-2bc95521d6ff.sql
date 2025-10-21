-- Create indexes for optimized DESC ordering by created_at
CREATE INDEX IF NOT EXISTS idx_token_usage_logs_created_at_desc ON token_usage_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chats_created_at_desc ON chats (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at_desc ON chat_messages (created_at DESC);