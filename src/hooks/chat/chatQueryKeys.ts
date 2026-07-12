import type { ChatPerspective } from '@/types/tutorStudentChat';

// Query-ключи чата репетитор↔ученик. Общие для student и tutor поверхностей —
// нейтральный префикс 'chat' (не 'tutor'/'student': кэш один на роль в сессии).

export const chatConversationsKey = (role: ChatPerspective) =>
  ['chat', 'conversations', role] as const;

export const chatMessagesKey = (conversationId: string) =>
  ['chat', 'conversation', conversationId, 'messages'] as const;
