import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { fetchChatMessages, getMyUserId, mergeChatMessage } from '@/lib/tutorStudentChatApi';
import { chatMessagesKey } from '@/hooks/chat/chatQueryKeys';
import type { ConversationMessagesCache } from '@/hooks/chat/useConversationMessages';
import type {
  ChatConversationRealtimeRow,
  ChatMemberStateRealtimeRow,
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
    // uid для группового member-binding (свой watermark vs чужие ✓✓).
    const myUserIdRef: { uid: string | null } = { uid: null };
    void getMyUserId().then((uid) => {
      myUserIdRef.uid = uid;
    });

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
            // Группа: watermark'и живут в tutor_chat_members (binding ниже) —
            // двухпартийные колонки строки беседы не про членов группы.
            if (prev.conversation.kind === 'group') return prev;
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
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tutor_chat_members',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          // Групповые ✓✓ «прочитал хотя бы один»: peer_last_read_at = MAX по
          // остальным членам (монотонно — max с текущим значением).
          const row = payload.new as unknown as ChatMemberStateRealtimeRow;
          if (!row?.user_id) return;
          // До резолва uid свой/чужой не различить — скип (ревью 5.6 р.2 #2:
          // собственная member-строка ушла бы в peer-ветку и НАВСЕГДА завысила
          // peer_last_read_at → ложные ✓✓). Gap-fill/refetch добьёт пропущенное.
          if (!myUserIdRef.uid) return;
          queryClient.setQueryData<ConversationMessagesCache>(key, (prev) => {
            if (!prev?.conversation || prev.conversation.kind !== 'group') return prev;
            if (!row.last_read_at) return prev;
            if (myUserIdRef.uid && row.user_id === myUserIdRef.uid) {
              const currentMine = prev.conversation.my_last_read_at;
              if (currentMine && Date.parse(currentMine) >= Date.parse(row.last_read_at)) {
                return prev;
              }
              return {
                ...prev,
                conversation: { ...prev.conversation, my_last_read_at: row.last_read_at },
              };
            }
            const current = prev.conversation.peer_last_read_at;
            if (current && Date.parse(current) >= Date.parse(row.last_read_at)) return prev;
            return {
              ...prev,
              conversation: { ...prev.conversation, peer_last_read_at: row.last_read_at },
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
