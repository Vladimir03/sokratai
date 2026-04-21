import { memo, type KeyboardEvent } from 'react';
import type { TodaySession } from '@/hooks/useTutorTodayLessons';

export type { TodaySession };

export interface SessionBlockProps {
  session: TodaySession;
  onOpen?: (session: TodaySession) => void;
  isPast?: boolean;
}

function SessionBlockImpl({ session, onOpen, isPast = false }: SessionBlockProps) {
  const classNames = [
    't-session',
    session.stream === 'ОГЭ' ? 't-session--oge' : '',
    isPast ? 't-session--past' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const interactive = typeof onOpen === 'function';

  const handleClick = () => {
    if (interactive) onOpen?.(session);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen?.(session);
    }
  };

  return (
    <div
      className={classNames}
      onClick={interactive ? handleClick : undefined}
      onKeyDown={interactive ? handleKeyDown : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={
        interactive
          ? `${session.time} · ${session.studentName} · ${session.topic}`
          : undefined
      }
      style={interactive ? { touchAction: 'manipulation' } : undefined}
    >
      <span className="t-session__time">{session.time}</span>
      <span className="t-session__title">{session.studentName}</span>
      <span className="t-session__meta">{session.topic}</span>
    </div>
  );
}

export const SessionBlock = memo(SessionBlockImpl);
