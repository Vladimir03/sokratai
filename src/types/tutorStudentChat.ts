// Чат репетитор ↔ ученик — типы (зеркало ответов tutor-student-chat-api).
// НЕ путать с AI-чатом ученика (`chats` / `chat_messages`) — это отдельная система.

export type ChatSenderRole = 'tutor' | 'student' | 'assistant';

/** Чья сторона рендерит беседу — определяет ориентацию пузырей и watermark'и. */
export type ChatPerspective = 'tutor' | 'student';

/** Клиентский статус собственного сообщения (⏱ → ✓ → ✓✓ / повторить). */
export type MessageSendStatus = 'sending' | 'sent' | 'read' | 'failed';

export interface TutorStudentChatMessage {
  id: string;
  conversation_id: string;
  sender_role: ChatSenderRole;
  author_user_id: string | null;
  content: string;
  /** dual-format: single storage:// ref ИЛИ JSON-array (parseAttachmentUrls). */
  attachment_url: string | null;
  client_msg_id: string | null;
  created_at: string;
  /** client-only: выставляется оптимистичной отправкой, сервер его не знает. */
  _localStatus?: 'sending' | 'failed';
}

export interface ChatPartnerIdentity {
  name: string;
  avatar_url: string | null;
  gender: string | null;
}

/** Строка списка чатов (у репетитора — ученики; у ученика — репетиторы). */
export interface ChatConversationListItem {
  tutor_student_id: string;
  conversation_id: string | null;
  partner_name: string;
  partner_avatar_url: string | null;
  partner_gender: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_sender: ChatSenderRole | null;
  unread_count: number;
  peer_last_read_at: string | null;
  archived: boolean;
}

export interface ChatConversationMeta {
  id: string;
  tutor_student_id: string;
  my_role: ChatPerspective;
  archived: boolean;
  tutor_last_read_at: string | null;
  student_last_read_at: string | null;
  my_last_read_at: string | null;
  peer_last_read_at: string | null;
  partner: ChatPartnerIdentity;
}

/** Realtime UPDATE payload строки беседы (колонки таблицы). */
export interface ChatConversationRealtimeRow {
  id: string;
  tutor_student_id: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_sender: ChatSenderRole | null;
  tutor_last_read_at: string | null;
  student_last_read_at: string | null;
  tutor_unread_count: number;
  student_unread_count: number;
}
