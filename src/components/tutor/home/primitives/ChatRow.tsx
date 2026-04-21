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

function ChatRowImpl({ chat, onOpen }: ChatRowProps) {
  const isMe = chat.from === 'me';
  const chipClass = chat.stream === 'ЕГЭ' ? 't-chip t-chip--ege' : 't-chip t-chip--oge';

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(chat);
    }
  };

  return (
    <button
      type="button"
      className="chat-row"
      onClick={() => onOpen(chat)}
      onKeyDown={handleKeyDown}
      title={`Открыть ДЗ «${chat.hwTitle}» с чатом ученика`}
      aria-label={`Открыть диалог с ${chat.name}`}
      style={{ touchAction: 'manipulation' }}
    >
      <span className="chat-row__avatar" aria-hidden="true">
        {initialsOf(chat.name)}
      </span>
      <span className="chat-row__body">
        <span className="chat-row__top">
          <span className="chat-row__name">{chat.name}</span>
          <span className={chipClass}>{chat.stream}</span>
          <span className="chat-row__time">{chat.at}</span>
        </span>
        <span className="chat-row__preview">
          {isMe ? <span className="chat-row__prefix">Вы: </span> : null}
          {chat.preview}
        </span>
      </span>
      <ChevronRight size={16} aria-hidden="true" style={{ color: 'var(--sokrat-fg3)', flex: 'none' }} />
    </button>
  );
}

export const ChatRow = memo(ChatRowImpl);
