import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { MessagesSquare, Users } from 'lucide-react';
import { toast } from 'sonner';
import { ConversationRow } from '@/components/chat/ConversationRow';
import { ConversationView } from '@/components/chat/ConversationView';
import { TutorDataStatus } from '@/components/tutor/TutorDataStatus';
import NotificationsNudge from '@/components/pwa/NotificationsNudge';
import { useChatConversations } from '@/hooks/chat/useChatConversations';
import { chatConversationsKey } from '@/hooks/chat/chatQueryKeys';
import { useVisualViewportHeight } from '@/hooks/useVisualViewportHeight';
import { ensureChatConversation } from '@/lib/tutorStudentChatApi';
import type { ChatConversationListItem } from '@/types/tutorStudentChat';

// Tutor chrome breakpoint = 1024px (не 768 — rule: рельса появляется с lg).
function useIsDesktopChrome(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isDesktop;
}

/**
 * «Чаты» — Telegram-like master/detail: список учеников с превью/бейджами ⇄
 * беседа. Detail живёт в URL (`/tutor/chat/:conversationId`) — push-deep-links
 * из уведомлений открывают беседу напрямую. Desktop ≥1024: две колонки;
 * mobile: список ⇄ полноэкранная беседа с back.
 */
export default function TutorChat() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktopChrome();
  const vvHeight = useVisualViewportHeight();
  const { data: items, isLoading, error, isFetching, refetch } = useChatConversations('tutor');
  const [openingId, setOpeningId] = useState<string | null>(null);

  const activeItem = useMemo(
    () => (items ?? []).find((i) => i.conversation_id === conversationId) ?? null,
    [items, conversationId],
  );

  const handleOpen = useCallback(
    async (item: ChatConversationListItem) => {
      if (item.conversation_id) {
        navigate(`/tutor/chat/${item.conversation_id}`);
        return;
      }
      // Беседы ещё нет — lazy-create и патчим строку списка новым id.
      setOpeningId(item.tutor_student_id);
      try {
        const res = await ensureChatConversation(item.tutor_student_id);
        queryClient.setQueryData<ChatConversationListItem[]>(
          chatConversationsKey('tutor'),
          (prev) =>
            prev?.map((i) =>
              i.tutor_student_id === item.tutor_student_id
                ? { ...i, conversation_id: res.conversation_id }
                : i,
            ),
        );
        navigate(`/tutor/chat/${res.conversation_id}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Не удалось открыть чат');
      } finally {
        setOpeningId(null);
      }
    },
    [navigate, queryClient],
  );

  const showList = isDesktop || !conversationId;
  const showDetail = Boolean(conversationId);

  const listContent = (
    <>
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-4">
        <h1 className="text-lg font-semibold text-slate-900">Чаты</h1>
      </div>
      <TutorDataStatus
        // items === undefined = список НИ РАЗУ не загрузился (error ИЛИ paused/
        // retry-окно RQ v5, когда error ещё null) — критично, кабинет пуст.
        // Гейтить только по `error` нельзя: ложный empty state «Пока нет
        // учеников» у репетитора с учениками (пойман на preview 2026-07-12).
        criticalError={!isLoading && items === undefined ? 'Не удалось загрузить чаты' : null}
        isFetching={isFetching}
        onRetry={() => void refetch()}
        escalateAfterMs={8_000}
        className="px-3 pt-2"
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-3 pt-2">
          <NotificationsNudge
            context="tutor-chat"
            message="Отвечайте ученикам с телефона — не пропускайте сообщения"
          />
        </div>
        {isLoading && (
          <div className="space-y-1 px-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
        )}
        {/* Empty state ТОЛЬКО при успешно загруженном пустом списке
            (items !== undefined) — не при сбое сети. */}
        {!isLoading && items !== undefined && items.length === 0 && !error && (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-socrat-surface">
              <Users className="h-6 w-6 text-slate-400" aria-hidden="true" />
            </div>
            <p className="text-sm font-medium text-slate-700">Пока нет учеников</p>
            <p className="text-xs text-slate-500">
              Добавьте ученика — и здесь появится чат с ним
            </p>
            <button
              type="button"
              onClick={() => navigate('/tutor/students')}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
              style={{ touchAction: 'manipulation' }}
            >
              К ученикам
            </button>
          </div>
        )}
        {(items ?? []).map((item) => (
          <div key={item.tutor_student_id} className={openingId === item.tutor_student_id ? 'opacity-60' : undefined}>
            <ConversationRow
              item={item}
              myRole="tutor"
              active={Boolean(conversationId) && item.conversation_id === conversationId}
              onClick={() => void handleOpen(item)}
            />
          </div>
        ))}
      </div>
    </>
  );

  return (
    <div
      className="-mb-16 flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white lg:-mb-14"
      style={{ height: `calc(${vvHeight} - ${isDesktop ? 44 : 92}px)` }}
    >
      <div className="flex min-h-0 flex-1">
        {showList && (
          <div
            className={
              isDesktop
                ? 'flex w-80 shrink-0 flex-col border-r border-slate-200'
                : 'flex w-full flex-col'
            }
          >
            {listContent}
          </div>
        )}
        {showDetail && conversationId ? (
          <ConversationView
            key={conversationId}
            conversationId={conversationId}
            perspective="tutor"
            partnerSeed={
              activeItem
                ? {
                    name: activeItem.partner_name,
                    avatar_url: activeItem.partner_avatar_url,
                    gender: activeItem.partner_gender,
                  }
                : null
            }
            onBack={isDesktop ? undefined : () => navigate('/tutor/chat')}
            className="min-w-0 flex-1"
          />
        ) : (
          isDesktop && (
            <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-2 bg-socrat-surface">
              <MessagesSquare className="h-8 w-8 text-slate-300" aria-hidden="true" />
              <p className="text-sm text-slate-500">Выберите чат слева</p>
            </div>
          )
        )}
      </div>
    </div>
  );
}
