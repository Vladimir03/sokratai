import { memo } from 'react';
import { format, parseISO } from 'date-fns';
import { RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { UserAvatar } from '@/components/common/UserAvatar';
import { MathText } from '@/components/kb/ui/MathText';
import { ReadTicks } from '@/components/chat/ReadTicks';
import { ChatImageAttachments } from '@/components/chat/ChatImageAttachments';
import sokratChatIcon from '@/assets/sokrat-chat-icon.png';
import type {
  ChatPartnerIdentity,
  MessageSendStatus,
  TutorStudentChatMessage,
} from '@/types/tutorStudentChat';

const AI_DISPLAY_NAME = 'СократAI';

// Палитра имён авторов в группе (Telegram-модель: стабильный цвет по uid).
// Оттенки 700 — 12px-текст на белом пузыре обязан давать контраст ≥4.5:1
// (ревью 5.6 р.2 #10: *-500/600 не дотягивали до AA).
const AUTHOR_COLORS = [
  'text-rose-700',
  'text-orange-700',
  'text-amber-700',
  'text-emerald-700',
  'text-cyan-700',
  'text-blue-700',
  'text-violet-700',
];

function authorColorClass(uid: string | null): string {
  if (!uid) return 'text-slate-600';
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) | 0;
  return AUTHOR_COLORS[Math.abs(h) % AUTHOR_COLORS.length];
}

// Подсветка токена упоминания в человеческих сообщениях (string-split с capture,
// без lookbehind — rule 80).
const MENTION_SPLIT_RE = /(@\s?(?:сократ\s?ai|sokrat\s?ai))/iu;

function HumanContent({ content }: { content: string }) {
  const parts = content.split(MENTION_SPLIT_RE);
  return (
    <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-slate-900">
      {parts.map((part, i) =>
        MENTION_SPLIT_RE.test(part) ? (
          <span key={i} className="font-medium text-accent">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  );
}

export interface ChatBubbleProps {
  message: TutorStudentChatMessage;
  isOwn: boolean;
  /** Identity левой стороны-человека (партнёр по беседе; в группе — fallback). */
  partner: ChatPartnerIdentity | null;
  status: MessageSendStatus;
  onRetry?: (message: TutorStudentChatMessage) => void;
  /** Группа: identity автора ЭТОГО сообщения (аватар + цветное имя). */
  author?: ChatPartnerIdentity | null;
  /** Группа: показывать имя автора над чужим человеческим сообщением. */
  showAuthor?: boolean;
}

/**
 * Пузырь сообщения (Telegram-ориентация): свои справа на подложке accent/10 без
 * аватара; партнёр слева на белом с аватаром; СократAI слева с брендовой
 * identity + MathText (KaTeX только для AI — человеческий текст рендерится
 * как есть, без markdown-сюрпризов).
 */
export const ChatBubble = memo(function ChatBubble({
  message,
  isOwn,
  partner,
  status,
  onRetry,
  author = null,
  showAuthor = false,
}: ChatBubbleProps) {
  const isAssistant = message.sender_role === 'assistant';
  const time = format(parseISO(message.created_at), 'HH:mm');
  const failed = message._localStatus === 'failed';
  const leftIdentity = showAuthor && author ? author : partner;

  return (
    <div className={cn('flex w-full gap-2 px-3 py-0.5', isOwn ? 'justify-end' : 'justify-start')}>
      {!isOwn && (
        <div className="mt-auto shrink-0">
          {isAssistant ? (
            <img
              src={sokratChatIcon}
              alt={AI_DISPLAY_NAME}
              loading="lazy"
              className="h-8 w-8 rounded-full object-cover"
            />
          ) : (
            <UserAvatar
              name={leftIdentity?.name}
              avatarUrl={leftIdentity?.avatar_url}
              gender={(leftIdentity?.gender as 'male' | 'female' | null) ?? null}
              size="sm"
            />
          )}
        </div>
      )}

      <div
        className={cn(
          'max-w-[82%] rounded-2xl px-3 py-2 sm:max-w-[70%]',
          isOwn
            ? 'rounded-br-md bg-accent/10'
            : 'rounded-bl-md border border-slate-200 bg-white',
        )}
      >
        {isAssistant && (
          <p className="mb-0.5 text-xs font-semibold text-accent">{AI_DISPLAY_NAME}</p>
        )}
        {!isAssistant && !isOwn && showAuthor && leftIdentity && (
          <p
            className={cn(
              'mb-0.5 text-xs font-semibold',
              authorColorClass(message.author_user_id),
            )}
          >
            {leftIdentity.name}
          </p>
        )}

        <ChatImageAttachments attachmentUrl={message.attachment_url} />

        {message.content.trim().length > 0 &&
          (isAssistant ? (
            <MathText
              text={message.content}
              markdownLite
              className="text-[15px] leading-relaxed text-slate-900"
            />
          ) : (
            <HumanContent content={message.content} />
          ))}

        <div className="mt-0.5 flex items-center justify-end gap-1">
          <span className="text-[11px] leading-none text-slate-400">{time}</span>
          {isOwn && <ReadTicks status={failed ? 'failed' : status} />}
        </div>

        {failed && onRetry && (
          <button
            type="button"
            onClick={() => onRetry(message)}
            className="mt-1 flex min-h-[32px] items-center gap-1 text-xs font-medium text-red-500 hover:text-red-600"
            style={{ touchAction: 'manipulation' }}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Не отправлено · Повторить
          </button>
        )}
      </div>
    </div>
  );
});

export default ChatBubble;
