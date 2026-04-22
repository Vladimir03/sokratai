import { memo, type KeyboardEvent } from 'react';
import { BookOpen, ChevronRight } from 'lucide-react';
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

// TASK-8: Wire-level lastAuthor is 'student' | 'tutor' | 'ai'. Backend
// returns 'ai' for kind='task_opened' (see handleGetRecentDialogs) for
// legacy-safe rendering — new UI ignores it and branches on `kind` below.
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
  const isTaskOpened = chat.kind === 'task_opened';

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(chat);
    }
  };

  // TASK-8 unread contract (spec §4 «Unread extended»):
  //   `chat.unread`      — общий флаг «есть новое событие» (student message
  //                        ИЛИ task-advance); драйвит визуал (bold name).
  //   `chat.unreadCount` — численный counter только по student messages;
  //                        для Case A всегда 0, поэтому badge только при > 0.
  const unreadCount = chat.unreadCount ?? 0;
  const hasUnread = Boolean(chat.unread);
  const showBadge = unreadCount > 0;
  const badgeText = unreadCount > 99 ? '99+' : String(unreadCount);

  const ariaParts = [
    `Открыть диалог с ${chat.name}`,
    isTaskOpened
      ? `открыл задачу №${chat.taskOrder ?? '?'} в «${chat.hwTitle}»`
      : `последнее сообщение от ${authorLabel}`,
    showBadge
      ? `${unreadCount} непрочитанных сообщений`
      : hasUnread
        ? 'новое событие'
        : null,
  ].filter(Boolean);

  return (
    <button
      type="button"
      className="chat-row"
      onClick={() => onOpen(chat)}
      onKeyDown={handleKeyDown}
      title={
        isTaskOpened
          ? `Перейти в ДЗ «${chat.hwTitle}» — задача №${chat.taskOrder ?? '?'}`
          : `Открыть ДЗ «${chat.hwTitle}» с чатом ученика`
      }
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
          {isTaskOpened ? (
            // Case A: system-style маркер «перешёл на задачу». BookOpen icon
            // + нейтральная chip с номером задачи. Читается как «событие»,
            // не «сообщение в чате» — убирает визуальный шум Author-chip.
            <span
              className="t-chip t-chip--neutral"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
              aria-hidden="true"
            >
              <BookOpen size={12} />
              Задача №{chat.taskOrder ?? '?'}
            </span>
          ) : (
            <span className={authorChipClass}>{authorLabel}</span>
          )}
        </span>
        <span
          className="chat-row__preview"
          style={{
            fontStyle: isTaskOpened ? 'italic' : undefined,
            color: isTaskOpened ? 'var(--sokrat-fg3)' : undefined,
          }}
        >
          {isTaskOpened
            ? `Открыл задачу №${chat.taskOrder ?? '?'} в «${chat.hwTitle}»`
            : chat.preview}
        </span>
      </span>
      <span className="chat-row__meta">
        <span className="chat-row__time">{chat.at}</span>
        {showBadge ? (
          <span
            className="chat-row__badge"
            aria-label={`${unreadCount} непрочитанных сообщений`}
          >
            {badgeText}
          </span>
        ) : hasUnread ? (
          // Case A (task-advance без student message): нет числа, но есть
          // unread-signal — показываем точку вместо counter.
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--sokrat-state-warning-fg)',
              flex: 'none',
              display: 'inline-block',
            }}
          />
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
