import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { fetchChatMessages, mergeChatMessage } from '@/lib/tutorStudentChatApi';
import { chatMessagesKey } from '@/hooks/chat/chatQueryKeys';
import type { ConversationMessagesCache } from '@/hooks/chat/useConversationMessages';
import type {
  ChatConversationRealtimeRow,
  TutorStudentChatMessage,
} from '@/types/tutorStudentChat';

/**
 * Realtime открытой беседы — один канал, два binding'а:
 *   INSERT `tutor_student_chat_messages` (filter conversation_id) → merge пузыря;
 *   UPDATE `tutor_student_conversations` (filter id) → живые ✓✓ (watermark партнёра).
 * Merge только через setQueryData (никаких invalidateQueries — флтикер, rule 40).
 *
 * Reconnect gap-fill (RU DPI рвёт WS): на первом SUBSCRIBED после обрыва —
 * точечный fetch последней страницы + merge (без invalidate).
 */
// Уникальный суффикс топика на mount (см. useChatConversations — конфликт
// повторной подписки на один topic). Typing-канал наоборот ДОЛЖЕН делить topic
// (broadcast маршрутизируется по нему) — там один mount на беседу.
let channelSeq = 0;

export function useChatRealtime(conversationId: string | null, enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || !conversationId) return;
    const key = chatMessagesKey(conversationId);
    let wasDisconnected = false;
    let disposed = false;

    const gapFill = async () => {
      try {
        const res = await fetchChatMessages(conversationId, { limit: 50 });
        if (disposed) return;
        queryClient.setQueryData<ConversationMessagesCache>(key, (prev) => {
          if (!prev) return prev;
          let messages = prev.messages;
          for (const m of res.messages) messages = mergeChatMessage(messages, m);
          return { ...prev, messages, conversation: res.conversation };
        });
      } catch {
        // gap-fill best-effort; обычный staleTime-refetch добьёт
      }
    };

    const channel = supabase
      .channel(`tsc-${conversationId}-${++channelSeq}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'tutor_student_chat_messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as unknown as TutorStudentChatMessage;
          if (!row?.id) return;
          queryClient.setQueryData<ConversationMessagesCache>(key, (prev) =>
            prev ? { ...prev, messages: mergeChatMessage(prev.messages, row) } : prev,
          );
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tutor_student_conversations',
          filter: `id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as unknown as ChatConversationRealtimeRow;
          if (!row?.id) return;
          queryClient.setQueryData<ConversationMessagesCache>(key, (prev) => {
            if (!prev?.conversation) return prev;
            const myRole = prev.conversation.my_role;
            return {
              ...prev,
              conversation: {
                ...prev.conversation,
                tutor_last_read_at: row.tutor_last_read_at,
                student_last_read_at: row.student_last_read_at,
                my_last_read_at:
                  myRole === 'tutor' ? row.tutor_last_read_at : row.student_last_read_at,
                peer_last_read_at:
                  myRole === 'tutor' ? row.student_last_read_at : row.tutor_last_read_at,
              },
            };
          });
        },
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          wasDisconnected = true;
        }
        if (status === 'SUBSCRIBED' && wasDisconnected) {
          wasDisconnected = false;
          void gapFill();
        }
      });

    // Cleanup обязателен (rule 40) — иначе утечка каналов при rapid open/close.
    return () => {
      disposed = true;
      void channel.unsubscribe();
    };
  }, [conversationId, enabled, queryClient]);
}
