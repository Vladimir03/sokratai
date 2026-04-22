import { memo, type KeyboardEvent } from 'react';
import { ChevronRight } from 'lucide-react';
import type { DialogItem } from '@/hooks/useTutorRecentDialogs';

export type { DialogItem };

export interface ChatRowProps {
  chat: DialogItem;
  onOpen: (chat: DialogItem) => void;
}

function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const second = parts[1]?.[0] ?? '';
  return (first + second).toUpperCase();
}

const AUTHOR_LABEL: Record<DialogItem['lastAuthor'], string> = {
  student: 'Ученик',
  tutor: 'Вы',
  ai: 'AI',
};

// Uses existing .t-chip tokens defined in src/styles/tutor-dashboard.css
// (rule 90 design system — no new colours, no hex).
const AUTHOR_CHIP_CLASS: Record<DialogItem['lastAuthor'], string> = {
  student: 't-chip t-chip--warning',
  tutor: 't-chip t-chip--info',
  ai: 't-chip t-chip--neutral',
};

function ChatRowImpl({ chat, onOpen }: ChatRowProps) {
  const streamChipClass =
    chat.stream === 'ЕГЭ' ? 't-chip t-chip--ege' : 't-chip t-chip--oge';
  const authorLabel = AUTHOR_LABEL[chat.lastAuthor];
  const authorChipClass = AUTHOR_CHIP_CLASS[chat.lastAuthor];

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(chat);
    }
  };

  const unreadCount = chat.unreadCount ?? 0;
  const hasUnread = unreadCount > 0;
  const badgeText = unreadCount > 99 ? '99+' : String(unreadCount);

  const ariaParts = [
    `Открыть диалог с ${chat.name}`,
    `последнее сообщение от ${authorLabel}`,
    hasUnread ? `${unreadCount} непрочитанных сообщений` : null,
  ].filter(Boolean);

  return (
    <button
      type="button"
      className="chat-row"
      onClick={() => onOpen(chat)}
      onKeyDown={handleKeyDown}
      title={`Открыть ДЗ «${chat.hwTitle}» с чатом ученика`}
      aria-label={ariaParts.join(', ')}
      style={{ touchAction: 'manipulation' }}
    >
      <span className="chat-row__avatar" aria-hidden="true">
        {initialsOf(chat.name)}
      </span>
      <span className="chat-row__body">
        <span className="chat-row__top">
          <span
            className="chat-row__name"
            style={{ fontWeight: hasUnread ? 700 : 600 }}
          >
            {chat.name}
          </span>
          <span className={streamChipClass}>{chat.stream}</span>
          <span className={authorChipClass}>{authorLabel}</span>
        </span>
        <span className="chat-row__preview">{chat.preview}</span>
      </span>
      <span className="chat-row__meta">
        <span className="chat-row__time">{chat.at}</span>
        {hasUnread ? (
          <span
            className="chat-row__badge"
            aria-label={`${unreadCount} непрочитанных сообщений`}
          >
            {badgeText}
          </span>
        ) : null}
      </span>
      <ChevronRight
        size={16}
        aria-hidden="true"
        style={{ color: 'var(--sokrat-fg3)', flex: 'none' }}
      />
    </button>
  );
}

export const ChatRow = memo(ChatRowImpl);
