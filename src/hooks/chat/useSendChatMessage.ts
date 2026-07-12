import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { serializeAttachmentUrls, parseAttachmentUrls } from '@/lib/attachmentRefs';
import {
  ChatApiError,
  generateClientMsgId,
  mergeChatMessage,
  sendChatMessageApi,
} from '@/lib/tutorStudentChatApi';
import { chatMessagesKey } from '@/hooks/chat/chatQueryKeys';
import type { ConversationMessagesCache } from '@/hooks/chat/useConversationMessages';
import type { ChatPerspective, TutorStudentChatMessage } from '@/types/tutorStudentChat';

export interface SendChatResult {
  ok: boolean;
  /** rule-97 message для toast'а (CHAT_ARCHIVED / RATE_LIMITED / сеть). */
  error?: string;
  code?: string;
}

/**
 * Оптимистичная отправка: пузырь появляется сразу (⏱), сервер/realtime заменяют
 * его по `client_msg_id` (какой бы ответ ни пришёл первым — merge идемпотентен).
 * Ошибка → статус failed + «Повторить» с ТЕМ ЖЕ client_msg_id (сервер дедупит
 * по partial-unique — двойной тап не создаст дубль).
 */
export function useSendChatMessage(conversationId: string | null, perspective: ChatPerspective) {
  const queryClient = useQueryClient();

  const patchLocal = useCallback(
    (localId: string, patch: Partial<TutorStudentChatMessage>) => {
      if (!conversationId) return;
      queryClient.setQueryData<ConversationMessagesCache>(
        chatMessagesKey(conversationId),
        (prev) =>
          prev
            ? {
                ...prev,
                messages: prev.messages.map((m) => (m.id === localId ? { ...m, ...patch } : m)),
              }
            : prev,
      );
    },
    [conversationId, queryClient],
  );

  const post = useCallback(
    async (localMessage: TutorStudentChatMessage): Promise<SendChatResult> => {
      if (!conversationId) return { ok: false, error: 'Чат не найден' };
      try {
        const res = await sendChatMessageApi(conversationId, {
          content: localMessage.content,
          attachment_refs: parseAttachmentUrls(localMessage.attachment_url),
          client_msg_id: localMessage.client_msg_id!,
        });
        queryClient.setQueryData<ConversationMessagesCache>(
          chatMessagesKey(conversationId),
          (prev) =>
            prev ? { ...prev, messages: mergeChatMessage(prev.messages, res.message) } : prev,
        );
        return { ok: true };
      } catch (e) {
        patchLocal(localMessage.id, { _localStatus: 'failed' });
        const err = e instanceof ChatApiError ? e : null;
        return {
          ok: false,
          error: err?.message ?? 'Не удалось отправить сообщение',
          code: err?.code,
        };
      }
    },
    [conversationId, patchLocal, queryClient],
  );

  const send = useCallback(
    async (content: string, attachmentRefs: string[] = []): Promise<SendChatResult> => {
      if (!conversationId) return { ok: false, error: 'Чат не найден' };
      const clientMsgId = generateClientMsgId();
      const optimistic: TutorStudentChatMessage = {
        id: `local-${clientMsgId}`,
        conversation_id: conversationId,
        sender_role: perspective,
        author_user_id: null,
        content,
        attachment_url: serializeAttachmentUrls(attachmentRefs),
        client_msg_id: clientMsgId,
        created_at: new Date().toISOString(),
        _localStatus: 'sending',
      };
      queryClient.setQueryData<ConversationMessagesCache>(
        chatMessagesKey(conversationId),
        (prev) =>
          prev
            ? { ...prev, messages: [...prev.messages, optimistic] }
            : { messages: [optimistic], hasMore: false, conversation: null },
      );
      return post(optimistic);
    },
    [conversationId, perspective, post, queryClient],
  );

  const retry = useCallback(
    async (failedMessage: TutorStudentChatMessage): Promise<SendChatResult> => {
      patchLocal(failedMessage.id, { _localStatus: 'sending' });
      return post(failedMessage);
    },
    [patchLocal, post],
  );

  return { send, retry };
}
