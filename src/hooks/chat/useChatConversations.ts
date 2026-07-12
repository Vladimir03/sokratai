import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { parseISO } from 'date-fns';
import { supabase } from '@/lib/supabaseClient';
import { listChatConversations } from '@/lib/tutorStudentChatApi';
import { chatConversationsKey } from '@/hooks/chat/chatQueryKeys';
import type {
  ChatConversationListItem,
  ChatConversationRealtimeRow,
  ChatPerspective,
} from '@/types/tutorStudentChat';

// ОДИН shared-канал на роль с refcount (ревью 5.6 P2: Navigation + ChatSidebar
// + TutorChat/SideNav монтируют хук одновременно → 3 одинаковые подписки,
// каждый UPDATE обрабатывался трижды). Все экземпляры пишут в один query-кэш —
// достаточно одного канала; последний unmount отписывается.
// Суффикс топика уникален на создание (supabase-js не даёт подписаться на
// один topic дважды при гонке unsubscribe/subscribe).
let channelSeq = 0;
const sharedListChannels = new Map<
  ChatPerspective,
  { channel: ReturnType<typeof supabase.channel>; refs: number }
>();

function byLastMessageDesc(a: ChatConversationListItem, b: ChatConversationListItem): number {
  const at = a.last_message_at ? parseISO(a.last_message_at).getTime() : 0;
  const bt = b.last_message_at ? parseISO(b.last_message_at).getTime() : 0;
  if (at !== bt) return bt - at;
  return a.partner_name.localeCompare(b.partner_name, 'ru');
}

/**
 * Список бесед (у репетитора — ученики, у ученика — репетиторы) + list-level
 * realtime: ОДНА нефильтрованная UPDATE-подписка на `tutor_student_conversations`
 * (RLS доставляет только свои строки) обновляет превью/бейджи/сортировку без
 * refetch. Merge через setQueryData — НИКОГДА invalidateQueries из realtime.
 */
export function useChatConversations(
  role: ChatPerspective,
  opts: { enabled?: boolean } = {},
) {
  const enabled = opts.enabled ?? true;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: chatConversationsKey(role),
    queryFn: () => listChatConversations(role),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!enabled) return;

    let entry = sharedListChannels.get(role);
    if (!entry) {
      const channel = supabase
        .channel(`tsc-list-${role}-${++channelSeq}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'tutor_student_conversations' },
          (payload) => {
            const row = payload.new as unknown as ChatConversationRealtimeRow;
            if (!row?.id) return;
            queryClient.setQueryData<ChatConversationListItem[]>(
              chatConversationsKey(role),
              (prev) => {
                if (!prev) return prev;
                const idx = prev.findIndex(
                  (i) =>
                    i.conversation_id === row.id || i.tutor_student_id === row.tutor_student_id,
                );
                if (idx < 0) return prev;
                const next = [...prev];
                next[idx] = {
                  ...next[idx],
                  conversation_id: row.id,
                  last_message_at: row.last_message_at,
                  last_message_preview: row.last_message_preview,
                  last_message_sender: row.last_message_sender,
                  unread_count:
                    role === 'tutor' ? row.tutor_unread_count : row.student_unread_count,
                  peer_last_read_at:
                    role === 'tutor' ? row.student_last_read_at : row.tutor_last_read_at,
                };
                next.sort(byLastMessageDesc);
                return next;
              },
            );
          },
        )
        .subscribe();
      entry = { channel, refs: 0 };
      sharedListChannels.set(role, entry);
    }
    entry.refs += 1;

    // Cleanup обязателен — последний потребитель отписывается (rule 40 realtime).
    return () => {
      const current = sharedListChannels.get(role);
      if (!current) return;
      current.refs -= 1;
      if (current.refs <= 0) {
        sharedListChannels.delete(role);
        void current.channel.unsubscribe();
      }
    };
  }, [role, enabled, queryClient]);

  return query;
}

/** Кол-во чатов с непрочитанным (Telegram считает чаты, не сообщения). */
export function useChatUnreadChatsCount(
  role: ChatPerspective,
  opts: { enabled?: boolean } = {},
): number {
  const { data } = useChatConversations(role, opts);
  return useMemo(
    () => (data ?? []).reduce((sum, item) => sum + (item.unread_count > 0 ? 1 : 0), 0),
    [data],
  );
}
