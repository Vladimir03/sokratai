import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { parseISO } from 'date-fns';
import { ArrowDown, ArrowLeft, Loader2, MessagesSquare, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { UserAvatar } from '@/components/common/UserAvatar';
import { ChatBubble } from '@/components/chat/ChatBubble';
import { ChatComposer } from '@/components/chat/ChatComposer';
import { ChatDateSeparator, formatChatDateLabel } from '@/components/chat/ChatDateSeparator';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useConversationMessages } from '@/hooks/chat/useConversationMessages';
import { useChatRealtime } from '@/hooks/chat/useChatRealtime';
import { useSendChatMessage } from '@/hooks/chat/useSendChatMessage';
import { useTypingBroadcast } from '@/hooks/chat/useTypingBroadcast';
import { chatConversationsKey } from '@/hooks/chat/chatQueryKeys';
import { pluralizeRu } from '@/lib/pluralizeRu';
import {
  AI_MENTION_RE,
  deleteChatUploads,
  getMyUserId,
  markChatRead,
  uploadChatImage,
} from '@/lib/tutorStudentChatApi';
import type {
  ChatConversationListItem,
  ChatPartnerIdentity,
  ChatPerspective,
  MessageSendStatus,
  TutorStudentChatMessage,
} from '@/types/tutorStudentChat';

const STICKY_BOTTOM_THRESHOLD_PX = 100;
const LOAD_OLDER_THRESHOLD_PX = 200;

function isSameDay(a: string, b: string): boolean {
  const da = parseISO(a);
  const db = parseISO(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

export interface ConversationViewProps {
  conversationId: string;
  perspective: ChatPerspective;
  /** Identity из списка чатов — рендерится до прихода meta (deep-link fallback внутри). */
  partnerSeed?: ChatPartnerIdentity | null;
  onBack?: () => void;
  /** Слот перед аватаром в шапке (гамбургер сайдбара на student-мобиле). */
  leadingSlot?: React.ReactNode;
  className?: string;
}

/**
 * Полная панель беседы репетитор↔ученик (общая для обеих сторон через
 * `perspective` — паттерн GuidedChatMessage): header с typing-подзаголовком,
 * лента с дата-пилюлями и разделителем непрочитанных, sticky-bottom + FAB,
 * оптимистичный композер с фото и @СократAI.
 */
export function ConversationView({
  conversationId,
  perspective,
  partnerSeed = null,
  onBack,
  leadingSlot,
  className,
}: ConversationViewProps) {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch, fetchOlder, isLoadingOlder } =
    useConversationMessages(conversationId);
  useChatRealtime(conversationId, true);

  // uid для own-детекта в группах (sender_role не различает учеников).
  const [myUserId, setMyUserId] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    void getMyUserId().then((uid) => {
      if (mounted) setMyUserId(uid);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const conversationMeta = data?.conversation ?? null;
  const isGroup = conversationMeta?.kind === 'group';
  const groupInfo = conversationMeta?.group ?? null;
  const groupMembers = useMemo(() => conversationMeta?.members ?? [], [conversationMeta]);
  const authorByUid = useMemo(() => {
    const map = new Map<string, ChatPartnerIdentity>();
    for (const m of groupMembers) {
      map.set(m.user_id, { name: m.name, avatar_url: m.avatar_url, gender: m.gender });
    }
    return map;
  }, [groupMembers]);
  const selfDisplayName = useMemo(
    () => (isGroup && myUserId ? (authorByUid.get(myUserId)?.name ?? null) : null),
    [isGroup, myUserId, authorByUid],
  );

  const {
    partnerTyping,
    partnerTypingName,
    assistantTyping,
    notifyTyping,
    previewAssistantTyping,
    clearAssistantTyping,
  } = useTypingBroadcast(conversationId, perspective, true, selfDisplayName);
  const { send, retry } = useSendChatMessage(conversationId, perspective);

  // Own-детект: оптимистичные — свои by construction; группа — по author_user_id
  // (у двух учеников одинаковый sender_role); 1:1 — прежняя role-модель.
  const isOwnMessage = useCallback(
    (m: TutorStudentChatMessage): boolean => {
      if (m._localStatus) return true;
      if (isGroup) return m.author_user_id != null && m.author_user_id === myUserId;
      return m.sender_role === perspective;
    },
    [isGroup, myUserId, perspective],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [newSinceScroll, setNewSinceScroll] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const firstUnreadIdRef = useRef<string | null>(null);
  const didInitialScrollRef = useRef(false);
  const lastMarkedMessageIdRef = useRef<string | null>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  // Плавающая дата-пилюля (Telegram): дата верхнего видимого сообщения при
  // скролле, гаснет через ~1с покоя.
  const [floatingDayIso, setFloatingDayIso] = useState<string | null>(null);
  const [floatingDayVisible, setFloatingDayVisible] = useState(false);
  const floatingDayHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const floatingDayRafRef = useRef<number | null>(null);
  // Кэш узлов сообщений — обновляется на смену messages, НЕ на каждый scroll-кадр
  // (ревью 5.6 р.2 #9: querySelectorAll по 1-2k узлов 60 раз/с дёргал iOS).
  const dayNodesRef = useRef<HTMLElement[]>([]);

  const messages = useMemo(() => data?.messages ?? [], [data?.messages]);
  const conversation = data?.conversation ?? null;
  const partner = conversation?.partner ?? partnerSeed;
  const archived = conversation?.archived ?? false;

  // Снимок первого непрочитанного — один раз на mount беседы (Telegram: разделитель
  // не гоняется за новыми сообщениями в течение сессии).
  useEffect(() => {
    didInitialScrollRef.current = false;
    firstUnreadIdRef.current = null;
    lastMarkedMessageIdRef.current = null;
    lastMessageIdRef.current = null;
    setNewSinceScroll(0);
  }, [conversationId]);

  // Снимок первого непрочитанного — ЛЕНИВО В РЕНДЕР-ФАЗЕ (write-once ref), НЕ в
  // effect: divider обязан попасть в тот же коммит, что и сообщения — иначе
  // initial-scroll не находил его в DOM, уезжал вниз и mark-read гасил всю пачку
  // непрочитанных (ревью 5.6 р.2 #1). Telegram-семантика прежняя: разделитель не
  // гоняется за новыми сообщениями в течение сессии.
  if (
    firstUnreadIdRef.current === null &&
    conversation !== null &&
    messages.length > 0 &&
    // Группа: ждём uid — без него own-детект пометил бы свои сообщения непрочитанными.
    (!isGroup || myUserId !== null)
  ) {
    const myReadAt = conversation.my_last_read_at
      ? parseISO(conversation.my_last_read_at).getTime()
      : 0;
    const firstUnread = messages.find(
      (m) => !isOwnMessage(m) && parseISO(m.created_at).getTime() > myReadAt,
    );
    firstUnreadIdRef.current = firstUnread?.id ?? '';
  }

  // ── Scroll management ──
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = containerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    // Initial scroll: к разделителю непрочитанных, иначе вниз. Гейт на снапшот:
    // пока он не взят (группа ждёт uid) — не скроллим, иначе divider ещё не в
    // DOM и лента ушла бы вниз с mark-read'ом всей пачки (ревью 5.6 р.2 #1).
    if (didInitialScrollRef.current || messages.length === 0) return;
    if (firstUnreadIdRef.current === null) return;
    didInitialScrollRef.current = true;
    requestAnimationFrame(() => {
      const unreadEl = firstUnreadIdRef.current
        ? document.getElementById(`chat-unread-divider-${conversationId}`)
        : null;
      if (unreadEl) unreadEl.scrollIntoView({ block: 'center' });
      else scrollToBottom();
    });
  }, [conversationId, messages.length, scrollToBottom, myUserId]);

  useEffect(() => {
    // Новые сообщения в ХВОСТЕ: sticky-bottom если рядом с низом, иначе
    // FAB-счётчик. Детект по id последнего сообщения, НЕ по длине массива —
    // prepend старой страницы (fetchOlder) не должен считаться «новыми»
    // (ревью 5.6 P1: FAB показывал «50 новых» после пагинации вверх).
    const last = messages[messages.length - 1] ?? null;
    const prevLastId = lastMessageIdRef.current;
    lastMessageIdRef.current = last?.id ?? null;
    if (!didInitialScrollRef.current || !last || last.id === prevLastId) return;
    const isOwn = isOwnMessage(last);
    if (isOwn || isAtBottom) {
      requestAnimationFrame(() => scrollToBottom(isOwn ? 'smooth' : 'auto'));
      setNewSinceScroll(0);
    } else {
      setNewSinceScroll((n) => n + 1);
    }
  }, [messages, isOwnMessage, isAtBottom, scrollToBottom]);

  // ── Mark-read: только когда пользователь РЕАЛЬНО у низа ленты и вкладка
  // видима (ревью 5.6 P1: открытие с 30 непрочитанными сразу давало ✓✓ и
  // глушило уведомления, хотя пользователь видел только начало). Позиция
  // читается синхронно из DOM — state isAtBottom может отставать от
  // scrollIntoView к разделителю непрочитанных.
  const lastIncomingId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (!isOwnMessage(messages[i])) {
        return messages[i].id;
      }
    }
    return null;
  }, [messages, isOwnMessage]);

  const maybeMarkRead = useCallback(() => {
    if (!conversation) return;
    if (document.visibilityState !== 'visible') return;
    const el = containerRef.current;
    if (!el) return;
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < STICKY_BOTTOM_THRESHOLD_PX;
    if (!nearBottom) return;
    const marker = lastIncomingId ?? 'initial';
    if (lastMarkedMessageIdRef.current === marker) return;
    lastMarkedMessageIdRef.current = marker;
    void markChatRead(conversationId).catch(() => undefined);
    // Оптимистично зануляем бейдж в списке чатов своей роли.
    queryClient.setQueryData<ChatConversationListItem[]>(
      chatConversationsKey(perspective),
      (prev) =>
        prev?.map((item) =>
          item.conversation_id === conversationId ? { ...item, unread_count: 0 } : item,
        ),
    );
  }, [conversation, conversationId, lastIncomingId, perspective, queryClient]);

  // Триггеры mark-read: загрузка/новое входящее + возврат на вкладку
  // (visibilitychange — сообщение, пришедшее в скрытой вкладке, отмечается
  // при возврате). Достижение низа скроллом — в handleScroll ниже.
  useEffect(() => {
    maybeMarkRead();
  }, [maybeMarkRead]);
  useEffect(() => {
    const onVisibility = () => maybeMarkRead();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [maybeMarkRead]);

  // Кэш узлов для пилюли — после каждого изменения ленты (append/prepend/замена
  // оптимистичного пузыря серверной строкой меняет key → узел пересоздаётся).
  useEffect(() => {
    const el = containerRef.current;
    dayNodesRef.current = el
      ? Array.from(el.querySelectorAll<HTMLElement>('[data-chat-iso]'))
      : [];
  }, [messages]);

  // Пилюля даты: бинарный поиск верхнего видимого сообщения (тексты в
  // document-order → top-координаты монотонны; ≤ ~10 rect-замеров на тик).
  const updateFloatingDay = useCallback(() => {
    floatingDayRafRef.current = null;
    const el = containerRef.current;
    if (!el) return;
    // Чат без скролла (умещается на экран) — пилюля не нужна.
    if (el.scrollHeight <= el.clientHeight + 4) return;
    const nodes = dayNodesRef.current;
    if (nodes.length === 0) return;
    const topEdge = el.getBoundingClientRect().top;
    let lo = 0;
    let hi = nodes.length - 1;
    let found = nodes.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (nodes[mid].getBoundingClientRect().bottom > topEdge + 1) {
        found = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    const iso = nodes[found]?.dataset.chatIso;
    if (!iso) return;
    setFloatingDayIso(iso);
    setFloatingDayVisible(true);
    if (floatingDayHideTimerRef.current) clearTimeout(floatingDayHideTimerRef.current);
    floatingDayHideTimerRef.current = setTimeout(() => setFloatingDayVisible(false), 1000);
  }, []);

  useEffect(
    () => () => {
      if (floatingDayHideTimerRef.current) clearTimeout(floatingDayHideTimerRef.current);
      if (floatingDayRafRef.current !== null) cancelAnimationFrame(floatingDayRafRef.current);
    },
    [],
  );

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distance < STICKY_BOTTOM_THRESHOLD_PX;
    setIsAtBottom(atBottom);
    if (atBottom) {
      setNewSinceScroll(0);
      maybeMarkRead();
    }

    // Плавающая дата-пилюля — rAF-троттлинг DOM-замеров.
    if (floatingDayRafRef.current === null) {
      floatingDayRafRef.current = requestAnimationFrame(updateFloatingDay);
    }

    if (el.scrollTop < LOAD_OLDER_THRESHOLD_PX && data?.hasMore && !isLoadingOlder) {
      const prevHeight = el.scrollHeight;
      const prevTop = el.scrollTop;
      void fetchOlder().then(() => {
        requestAnimationFrame(() => {
          const node = containerRef.current;
          if (node) node.scrollTop = node.scrollHeight - prevHeight + prevTop;
        });
      });
    }
  }, [data?.hasMore, fetchOlder, isLoadingOlder, maybeMarkRead, updateFloatingDay]);

  // Ответ СократAI пришёл → гасим «печатает…».
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.sender_role === 'assistant') clearAssistantTyping();
  }, [messages, clearAssistantTyping]);

  // ── Send ──
  // Возвращает true = композеру можно очистить черновик (оптимистичный пузырь
  // создан; сбой POST обрабатывается «Повторить» на пузыре). false = upload
  // фото упал — черновик сохраняется, успешно залитые файлы удаляются
  // (ревью 5.6 P1: частичный сбой терял сообщение и плодил сирот в storage).
  const handleSend = useCallback(
    async (content: string, files: File[]): Promise<boolean> => {
      let refs: string[] = [];
      if (files.length > 0) {
        setIsUploading(true);
        const settled = await Promise.allSettled(
          files.map((f) => uploadChatImage(f, conversationId)),
        );
        setIsUploading(false);
        const uploaded = settled
          .filter((s): s is PromiseFulfilledResult<string> => s.status === 'fulfilled')
          .map((s) => s.value);
        if (uploaded.length < files.length) {
          void deleteChatUploads(uploaded);
          toast.error('Не удалось загрузить фото — сообщение не отправлено. Попробуйте ещё раз.');
          return false;
        }
        refs = uploaded;
      }
      if (AI_MENTION_RE.test(content)) previewAssistantTyping();
      const result = await send(content, refs);
      if (!result.ok && result.error) {
        // Пузырь уже помечен failed — toast только для содержательных отказов.
        if (result.code === 'CHAT_ARCHIVED' || result.code === 'RATE_LIMITED') {
          toast.error(result.error);
        }
      }
      return true;
    },
    [conversationId, previewAssistantTyping, send],
  );

  const handleRetry = useCallback(
    (message: TutorStudentChatMessage) => {
      void retry(message);
    },
    [retry],
  );

  // ── Derived render bits ──
  const peerReadAtMs = conversation?.peer_last_read_at
    ? parseISO(conversation.peer_last_read_at).getTime()
    : 0;

  const statusFor = useCallback(
    (m: TutorStudentChatMessage): MessageSendStatus => {
      if (m._localStatus === 'failed') return 'failed';
      if (m._localStatus === 'sending') return 'sending';
      return parseISO(m.created_at).getTime() <= peerReadAtMs ? 'read' : 'sent';
    },
    [peerReadAtMs],
  );

  const subtitle = assistantTyping
    ? 'СократAI печатает…'
    : partnerTyping
      ? isGroup && partnerTypingName
        ? `${partnerTypingName} печатает…`
        : 'печатает…'
      : archived
        ? isGroup
          ? 'группа неактивна'
          : 'ученик в архиве'
        : isGroup && groupInfo
          ? `${groupInfo.member_count} ${
            pluralizeRu(groupInfo.member_count, ['участник', 'участника', 'участников'])
          }`
          : null;

  const [membersOpen, setMembersOpen] = useState(false);

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-socrat-surface', className)}>
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-2 sm:px-3">
        {leadingSlot}
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-socrat-surface"
            style={{ touchAction: 'manipulation' }}
            aria-label="Назад к списку чатов"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        {isGroup ? (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-socrat-folder-bg">
            <Users className="h-4 w-4 text-socrat-folder" aria-hidden="true" />
          </span>
        ) : (
          <UserAvatar
            name={partner?.name}
            avatarUrl={partner?.avatar_url}
            gender={(partner?.gender as 'male' | 'female' | null) ?? null}
            size="sm"
          />
        )}
        <button
          type="button"
          onClick={isGroup ? () => setMembersOpen(true) : undefined}
          disabled={!isGroup}
          className={cn(
            'flex min-h-11 min-w-0 flex-1 flex-col justify-center text-left',
            isGroup && 'cursor-pointer rounded-md px-1 hover:bg-socrat-surface',
          )}
          style={{ touchAction: 'manipulation' }}
          aria-label={isGroup ? 'Участники группы' : undefined}
        >
          <p className="truncate text-[15px] font-semibold leading-tight text-slate-900">
            {partner?.name ?? 'Чат'}
          </p>
          {subtitle && (
            <p
              className={cn(
                'truncate text-xs leading-tight',
                assistantTyping || partnerTyping ? 'animate-pulse text-accent' : 'text-slate-400',
              )}
            >
              {subtitle}
            </p>
          )}
        </button>
      </div>

      {/* Участники группы */}
      {isGroup && (
        <Dialog open={membersOpen} onOpenChange={setMembersOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{groupInfo?.name ?? 'Группа'}</DialogTitle>
            </DialogHeader>
            <ul className="flex flex-col gap-1">
              {groupMembers.map((m) => (
                <li key={m.user_id} className="flex min-h-[44px] items-center gap-2.5 rounded-lg px-1.5">
                  <UserAvatar
                    name={m.name}
                    avatarUrl={m.avatar_url}
                    gender={(m.gender as 'male' | 'female' | null) ?? null}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-900">
                    {m.name}
                    {m.user_id === myUserId && <span className="text-slate-400"> (вы)</span>}
                  </span>
                  {m.role === 'tutor' && (
                    <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
                      Репетитор
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </DialogContent>
        </Dialog>
      )}

      {/* Messages */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto overscroll-contain py-2"
        >
          {isLoading && (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          )}

          {!isLoading && error && messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm text-slate-500">Не удалось загрузить чат</p>
              <button
                type="button"
                onClick={() => void refetch()}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
                style={{ touchAction: 'manipulation' }}
              >
                Повторить
              </button>
            </div>
          )}

          {!isLoading && !error && messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white">
                <MessagesSquare className="h-6 w-6 text-accent" aria-hidden="true" />
              </div>
              <p className="text-sm font-medium text-slate-700">
                {isGroup
                  ? `Начните общий чат группы${groupInfo?.name ? ` «${groupInfo.name}»` : ''}`
                  : partner?.name
                    ? `Начните диалог с ${partner.name}`
                    : 'Начните диалог'}
              </p>
              <p className="text-xs text-slate-500">
                Напишите @СократAI, чтобы позвать AI-помощника в этот чат
              </p>
            </div>
          )}

          {isLoadingOlder && (
            <div className="flex justify-center py-2">
              <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
            </div>
          )}

          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const showDate = !prev || !isSameDay(prev.created_at, m.created_at);
            const showUnreadDivider = firstUnreadIdRef.current === m.id;
            return (
              <div key={m.id} data-chat-iso={m.created_at}>
                {showDate && <ChatDateSeparator iso={m.created_at} />}
                {showUnreadDivider && (
                  <div
                    id={`chat-unread-divider-${conversationId}`}
                    className="flex items-center gap-3 px-4 py-1.5"
                    role="separator"
                  >
                    <span className="h-px flex-1 bg-accent/30" />
                    <span className="text-xs font-medium text-accent">
                      Непрочитанные сообщения
                    </span>
                    <span className="h-px flex-1 bg-accent/30" />
                  </div>
                )}
                <ChatBubble
                  message={m}
                  isOwn={isOwnMessage(m)}
                  partner={partner}
                  status={statusFor(m)}
                  onRetry={handleRetry}
                  showAuthor={isGroup}
                  author={
                    isGroup && m.author_user_id
                      ? (authorByUid.get(m.author_user_id) ?? null)
                      : null
                  }
                />
              </div>
            );
          })}
        </div>

        {/* Плавающая дата-пилюля (Telegram): дата видимой области при скролле */}
        <div
          className={cn(
            'pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center transition-opacity duration-200',
            floatingDayVisible && floatingDayIso ? 'opacity-100' : 'opacity-0',
          )}
          aria-hidden="true"
        >
          {floatingDayIso && (
            <span className="rounded-full bg-slate-900/60 px-3 py-0.5 text-xs font-medium text-white">
              {formatChatDateLabel(floatingDayIso)}
            </span>
          )}
        </div>

        {/* Scroll-to-bottom FAB */}
        {!isAtBottom && messages.length > 0 && (
          <button
            type="button"
            onClick={() => {
              scrollToBottom('smooth');
              setNewSinceScroll(0);
            }}
            className="absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-md"
            style={{ touchAction: 'manipulation' }}
            aria-label="К последним сообщениям"
          >
            <ArrowDown className="h-5 w-5" />
            {newSinceScroll > 0 && (
              <span className="absolute -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold text-white">
                {newSinceScroll > 99 ? '99+' : newSinceScroll}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Composer */}
      <ChatComposer
        onSend={handleSend}
        onTyping={notifyTyping}
        isSending={isUploading}
        disabledHint={
          archived
            ? isGroup
              ? 'Группа неактивна — отправка недоступна, история сохранена.'
              : 'Ученик в архиве — отправка недоступна, история сохранена.'
            : null
        }
      />
    </div>
  );
}

export default ConversationView;
