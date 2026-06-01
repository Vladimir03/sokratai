import { memo, type KeyboardEvent } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  MessageCircle,
  Send,
  type LucideIcon,
} from 'lucide-react';
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

// Per-kind visual config. All chip classes use existing .t-chip-- tokens from
// src/styles/tutor-dashboard.css (rule 90 — no new colours / hex). Visual
// ramp: gray (looked) → amber (talking) → blue (submitted) → green (done) →
// red (needs help) — so a tutor scanning the feed reads urgency by colour.
interface KindMeta {
  Icon: LucideIcon;
  chipClass: string;
  chipLabel: string;
  /** italic + muted preview — used for the low-signal 'opened' row. */
  muted: boolean;
}

function kindMeta(chat: DialogItem): KindMeta {
  const n = chat.taskOrder;
  const num = typeof n === 'number' ? ` №${n}` : '';
  switch (chat.kind) {
    case 'completed':
      return {
        Icon: CheckCircle2,
        chipClass: 't-chip t-chip--success',
        chipLabel: 'Завершил ДЗ',
        muted: false,
      };
    case 'stuck':
      return {
        Icon: AlertTriangle,
        chipClass: 't-chip t-chip--danger',
        chipLabel: typeof n === 'number' ? `Застрял · №${n}` : 'Застрял',
        muted: false,
      };
    case 'submitted':
      return {
        Icon: Send,
        chipClass: 't-chip t-chip--info',
        chipLabel: `Сдал${num}`,
        muted: false,
      };
    case 'opened':
      return {
        Icon: BookOpen,
        chipClass: 't-chip t-chip--neutral',
        chipLabel: `Задача${num}`,
        muted: true,
      };
    case 'wrote':
    default:
      return {
        Icon: MessageCircle,
        chipClass: 't-chip t-chip--warning',
        chipLabel: 'Ученик',
        muted: false,
      };
  }
}

// The preview sentence. 'wrote' shows the actual message content (already
// trimmed server-side); every other kind renders an event line that folds in
// the homework title so the row is self-explanatory.
function previewLine(chat: DialogItem): string {
  const n = chat.taskOrder;
  const num = typeof n === 'number' ? ` №${n}` : '';
  switch (chat.kind) {
    case 'completed':
      return `Завершил ДЗ «${chat.hwTitle}»`;
    case 'stuck':
      return `Застрял на задаче${num} в «${chat.hwTitle}»`;
    case 'submitted':
      return `Сдал задачу${num} в «${chat.hwTitle}»`;
    case 'opened':
      return `Открыл условие задачи${num} в «${chat.hwTitle}»`;
    case 'wrote':
    default:
      return chat.preview;
  }
}

function ChatRowImpl({ chat, onOpen }: ChatRowProps) {
  const streamChipClass =
    chat.stream === 'ЕГЭ' ? 't-chip t-chip--ege' : 't-chip t-chip--oge';
  const meta = kindMeta(chat);
  const KindIcon = meta.Icon;
  const preview = previewLine(chat);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(chat);
    }
  };

  // Unread contract:
  //   `chat.unread`      — общий флаг «есть новое событие»; драйвит bold name.
  //   `chat.unreadCount` — counter только по student messages; badge при > 0,
  //                        иначе (например 'opened') — точка.
  const unreadCount = chat.unreadCount ?? 0;
  const hasUnread = Boolean(chat.unread);
  const showBadge = unreadCount > 0;
  const badgeText = unreadCount > 99 ? '99+' : String(unreadCount);

  const ariaParts = [
    `Открыть диалог с ${chat.name}`,
    preview,
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
      title={`Открыть ДЗ «${chat.hwTitle}» — ${preview}`}
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
          <span
            className={meta.chipClass}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            aria-hidden="true"
          >
            <KindIcon size={12} />
            {meta.chipLabel}
          </span>
        </span>
        <span
          className="chat-row__preview"
          style={{
            fontStyle: meta.muted ? 'italic' : undefined,
            color: meta.muted ? 'var(--sokrat-fg3)' : undefined,
          }}
        >
          {preview}
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
          // Unread event without a student-message count (e.g. 'opened'):
          // show a dot instead of a number.
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
