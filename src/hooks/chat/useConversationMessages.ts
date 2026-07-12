import { useCallback, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchChatMessages, mergeChatMessage } from '@/lib/tutorStudentChatApi';
import { chatMessagesKey } from '@/hooks/chat/chatQueryKeys';
import type {
  ChatConversationMeta,
  TutorStudentChatMessage,
} from '@/types/tutorStudentChat';

export interface ConversationMessagesCache {
  messages: TutorStudentChatMessage[];
  hasMore: boolean;
  conversation: ChatConversationMeta | null;
}

const PAGE_SIZE = 50;

/**
 * Сообщения беседы — flat-кэш `{messages, hasMore, conversation}` (НЕ
 * useInfiniteQuery: realtime-merge в infinite-страницы хрупок; зеркало
 * проверенного GuidedThreadViewer-паттерна). Пагинация вверх — `fetchOlder()`.
 */
export function useConversationMessages(conversationId: string | null) {
  const queryClient = useQueryClient();
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

  const query = useQuery<ConversationMessagesCache>({
    queryKey: chatMessagesKey(conversationId ?? 'none'),
    enabled: Boolean(conversationId),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const res = await fetchChatMessages(conversationId!, { limit: PAGE_SIZE });
      // Background/focus-refetch возвращает только ПОСЛЕДНЮЮ страницу — мерджим
      // её В существующий кэш, а не заменяем (ревью 5.6 P1: замена теряла
      // догруженные fetchOlder'ом старые страницы). Оптимистичные пузыри
      // (sending/failed) сохраняются merge'ем автоматически (дедуп по
      // id/client_msg_id внутри mergeChatMessage).
      const prev = queryClient.getQueryData<ConversationMessagesCache>(
        chatMessagesKey(conversationId!),
      );
      if (!prev) {
        return { messages: res.messages, hasMore: res.has_more, conversation: res.conversation };
      }
      let messages = prev.messages;
      for (const m of res.messages) messages = mergeChatMessage(messages, m);
      return {
        messages,
        // hasMore относится к САМОМУ СТАРОМУ загруженному сообщению — у prev
        // история глубже, чем у последней страницы → его флаг авторитетнее.
        hasMore: prev.hasMore,
        conversation: res.conversation,
      };
    },
  });

  // Синхронный lock (ревью 5.6 P1): isLoadingOlder — async state, несколько
  // scroll-событий до ре-рендера запускали параллельные fetchOlder.
  const loadingOlderRef = useRef(false);

  const fetchOlder = useCallback(async () => {
    if (!conversationId || loadingOlderRef.current) return;
    const cache = queryClient.getQueryData<ConversationMessagesCache>(
      chatMessagesKey(conversationId),
    );
    // Курсор — самое старое СЕРВЕРНОЕ сообщение (оптимистичные не считаются).
    const oldest = cache?.messages.find((m) => !m._localStatus);
    if (!cache || !cache.hasMore || !oldest) return;
    loadingOlderRef.current = true;
    setIsLoadingOlder(true);
    try {
      const res = await fetchChatMessages(conversationId, {
        before: oldest.created_at,
        beforeId: oldest.id,
        limit: PAGE_SIZE,
      });
      queryClient.setQueryData<ConversationMessagesCache>(
        chatMessagesKey(conversationId),
        (prev) => {
          if (!prev) return prev;
          let messages = prev.messages;
          for (const m of res.messages) messages = mergeChatMessage(messages, m);
          return { ...prev, messages, hasMore: res.has_more };
        },
      );
    } finally {
      loadingOlderRef.current = false;
      setIsLoadingOlder(false);
    }
  }, [conversationId, queryClient]);

  return { ...query, fetchOlder, isLoadingOlder };
}
