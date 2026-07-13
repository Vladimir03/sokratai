// Чат репетитор ↔ ученик — типы (зеркало ответов tutor-student-chat-api).
// НЕ путать с AI-чатом ученика (`chats` / `chat_messages`) — это отдельная система.

export type ChatSenderRole = 'tutor' | 'student' | 'assistant';

/** Чья сторона рендерит беседу — определяет ориентацию пузырей и watermark'и. */
export type ChatPerspective = 'tutor' | 'student';

/** Тип беседы: 1:1 с учеником или чат учебной группы. */
export type ChatConversationKind = 'direct' | 'group';

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

/** Группа в списке/шапке чата. */
export interface ChatGroupInfo {
  id: string;
  name: string;
  member_count: number;
}

/** Участник групповой беседы (identity, для имён авторов и списка участников). */
export interface ChatMemberIdentity {
  user_id: string;
  name: string;
  avatar_url: string | null;
  gender: string | null;
  role: ChatPerspective;
}

/** Строка списка чатов (у репетитора — ученики + группы; у ученика — репетиторы + группы). */
export interface ChatConversationListItem {
  /** 'direct' | 'group'; отсутствие поля (старый edge) = direct. */
  kind?: ChatConversationKind;
  /** direct: id линка tutor_students; group: null. */
  tutor_student_id: string | null;
  /** group: id учебной группы; direct: null/отсутствует. */
  tutor_group_id?: string | null;
  conversation_id: string | null;
  partner_name: string;
  partner_avatar_url: string | null;
  partner_gender: string | null;
  group?: ChatGroupInfo | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_sender: ChatSenderRole | null;
  /** Автор последнего сообщения — «Вы:» в превью групп. */
  last_message_author_user_id?: string | null;
  unread_count: number;
  peer_last_read_at: string | null;
  archived: boolean;
}

export interface ChatConversationMeta {
  id: string;
  kind?: ChatConversationKind;
  tutor_student_id: string | null;
  tutor_group_id?: string | null;
  my_role: ChatPerspective;
  archived: boolean;
  tutor_last_read_at: string | null;
  student_last_read_at: string | null;
  my_last_read_at: string | null;
  peer_last_read_at: string | null;
  partner: ChatPartnerIdentity;
  group?: ChatGroupInfo | null;
  members?: ChatMemberIdentity[] | null;
}

/** Realtime UPDATE payload строки беседы (колонки таблицы). */
export interface ChatConversationRealtimeRow {
  id: string;
  kind?: ChatConversationKind;
  tutor_student_id: string | null;
  tutor_group_id?: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_sender: ChatSenderRole | null;
  last_message_author_user_id?: string | null;
  tutor_last_read_at: string | null;
  student_last_read_at: string | null;
  tutor_unread_count: number;
  student_unread_count: number;
}

/** Realtime payload строки tutor_chat_members (per-member state групп). */
export interface ChatMemberStateRealtimeRow {
  conversation_id: string;
  user_id: string;
  last_read_at: string | null;
  unread_count: number;
}
