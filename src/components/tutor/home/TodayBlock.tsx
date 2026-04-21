import { memo } from 'react';
import { CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  SessionBlock,
  type TodaySession,
} from '@/components/tutor/home/primitives';
import { pluralize, PLURAL_SESSIONS } from '@/lib/ru/pluralize';

export interface TodayBlockProps {
  sessions: TodaySession[];
  onOpenSchedule: () => void;
  onOpenSession?: (session: TodaySession) => void;
}

const MAX_VISIBLE = 4;

function TodayBlockImpl({
  sessions,
  onOpenSchedule,
  onOpenSession,
}: TodayBlockProps) {
  const visible = sessions.slice(0, MAX_VISIBLE);
  const overflow = Math.max(0, sessions.length - MAX_VISIBLE);
  const metaLabel = `${sessions.length} ${pluralize(sessions.length, PLURAL_SESSIONS)}`;

  return (
    <section className="t-section">
      <div className="t-section__header">
        <h2>Сегодня</h2>
        <span className="t-section__meta">{metaLabel}</span>
        <span style={{ marginLeft: 'auto' }}>
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenSchedule}
            style={{ touchAction: 'manipulation' }}
          >
            Расписание
          </Button>
        </span>
      </div>
      <hr className="t-divider" />
      {sessions.length === 0 ? (
        <div className="t-empty" style={{ padding: '32px 20px' }}>
          <CalendarClock
            size={24}
            aria-hidden="true"
            style={{ color: 'var(--sokrat-fg3)' }}
          />
          <div className="t-empty__title">Сегодня занятий нет</div>
          <div className="t-empty__body">
            Можно открыть расписание и запланировать новое.
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 8,
            padding: 12,
          }}
        >
          {visible.map((session) => (
            <SessionBlock
              key={session.id}
              session={session}
              onOpen={onOpenSession}
            />
          ))}
          {overflow > 0 && (
            <div
              className="t-chip t-chip--neutral"
              style={{
                alignSelf: 'center',
                justifySelf: 'start',
                padding: '6px 10px',
              }}
            >
              ещё {overflow}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export const TodayBlock = memo(TodayBlockImpl);
