import { memo, type ComponentType, type KeyboardEvent } from 'react';
import {
  BookOpen,
  CheckCircle2,
  ChevronRight,
  MessageCircle,
  Send,
} from 'lucide-react';
import type { DialogItem } from '@/hooks/useTutorRecentDialogs';
import { SokratBearIcon } from '@/components/tutor/home/primitives/SokratBearIcon';

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

// lucide icons and our SokratBearIcon both satisfy this minimal shape.
type ChipIcon = ComponentType<{ size?: number; className?: string }>;

// Per-kind visual config. Chip classes use existing .t-chip-- tokens from
// tutor-dashboard.css (rule 90 — no hex). The chip now carries the ACTION (so
// the preview line can drop the duplicate and just name the homework). Palette:
//   gray   opened / wrote   — passive (looked / chatted)
//   blue   submitted        — delivered work
//   green  completed        — finished
//   amber  stuck            — needs help (warm, NOT a red alarm) + Сократ bear
interface KindMeta {
  Icon: ChipIcon;
  chipClass: string;
  chipLabel: string;
  /** italic + muted preview — only for the low-signal 'opened' row. */
  muted: boolean;
}

function kindMeta(chat: DialogItem): KindMeta {
  const n = chat.taskOrder;
  const numDot = typeof n === 'number' ? ` · №${n}` : '';
  switch (chat.kind) {
    case 'completed':
      return {
        Icon: CheckCircle2,
        chipClass: 't-chip t-chip--success',
        chipLabel: 'Завершил ДЗ',
        muted: false,
      };
    case 'stuck':
      // «Застрял» = повод помочь, не ЧП. Тёплый янтарный тон + Сократ-мишка
      // (положительная привязка к бренду), а не красный alarm (см. spec §8).
      return {
        Icon: SokratBearIcon,
        chipClass: 't-chip t-chip--warning',
        chipLabel: `Нужна помощь${numDot}`,
        muted: false,
      };
    case 'submitted':
      return {
        Icon: Send,
        chipClass: 't-chip t-chip--info',
        chipLabel: `Сдал${numDot}`,
        muted: false,
      };
    case 'opened':
      return {
        Icon: BookOpen,
        chipClass: 't-chip t-chip--neutral',
        chipLabel: `Открыл${numDot}`,
        muted: true,
      };
    case 'wrote':
    default:
      return {
        Icon: MessageCircle,
        chipClass: 't-chip t-chip--neutral',
        chipLabel: 'Написал',
        muted: false,
      };
  }
}

// Visible preview line. 'wrote' shows the message content; every other (fact)
// event shows just the homework title — the chip already states what happened,
// so repeating it here would be noise (Q4: kill chip/preview duplication).
function previewLine(chat: DialogItem): string {
  if (chat.kind === 'wrote') return chat.preview;
  return `«${chat.hwTitle}»`;
}

// Full sentence for a11y (aria-label / title) — keeps the action explicit even
// though the visible preview is tightened.
function eventDescription(chat: DialogItem): string {
  const n = chat.taskOrder;
  const num = typeof n === 'number' ? ` №${n}` : '';
  switch (chat.kind) {
    case 'completed':
      return `завершил ДЗ «${chat.hwTitle}»`;
    case 'stuck':
      return `нужна помощь на задаче${num} в «${chat.hwTitle}»`;
    case 'submitted':
      return `сдал задачу${num} в «${chat.hwTitle}»`;
    case 'opened':
      return `открыл условие задачи${num} в «${chat.hwTitle}»`;
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
  const event = eventDescription(chat);

  const handleKeyDown = (keyEvent: KeyboardEvent<HTMLButtonElement>) => {
    if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
      keyEvent.preventDefault();
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
    event,
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
      title={`${chat.name}: ${event} — открыть`}
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
