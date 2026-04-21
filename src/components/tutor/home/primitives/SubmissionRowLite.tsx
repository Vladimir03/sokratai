import { memo, type KeyboardEvent } from 'react';
import { ChevronRight } from 'lucide-react';
import type { ReviewItem } from '@/hooks/useTutorReviewQueue';

export type { ReviewItem };

export interface SubmissionRowLiteProps {
  sub: ReviewItem;
  onOpen: (assignmentId: string) => void;
}

function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const second = parts[1]?.[0] ?? '';
  return (first + second).toUpperCase();
}

const ANSWER_COLOR: Record<'ok' | 'part' | 'miss', string> = {
  ok: 'var(--sokrat-state-success-fg)',
  part: 'var(--sokrat-state-warning-fg)',
  miss: 'var(--sokrat-state-danger-fg)',
};

function aiChipText(flag: ReviewItem['aiFlag'], warnCount?: number): string {
  if (flag === 'ok') return 'AI ✓';
  if (flag === 'warn') {
    const n = warnCount ?? 0;
    return n > 0 ? `AI ⚠ ${n}` : 'AI ⚠';
  }
  return 'AI ?';
}

function aiChipClass(flag: ReviewItem['aiFlag']): string {
  if (flag === 'ok') return 't-chip t-chip--success';
  if (flag === 'warn') return 't-chip t-chip--warning';
  return 't-chip t-chip--neutral';
}

function SubmissionRowLiteImpl({ sub, onOpen }: SubmissionRowLiteProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(sub.assignmentId);
    }
  };

  const avatarRingClass =
    sub.stream === 'ЕГЭ' ? 't-avatar t-avatar--32 t-avatar--ege' : 't-avatar t-avatar--32 t-avatar--oge';

  return (
    <button
      type="button"
      className="chat-row"
      onClick={() => onOpen(sub.assignmentId)}
      onKeyDown={handleKeyDown}
      aria-label={`Открыть работу ${sub.name} на проверку`}
      title={`Открыть ДЗ · ${sub.name}`}
      style={{ touchAction: 'manipulation' }}
    >
      <span className={avatarRingClass} aria-hidden="true">
        {initialsOf(sub.name)}
      </span>
      <span className="chat-row__body">
        <span className="chat-row__top">
          <span className="chat-row__name">{sub.name}</span>
          <span className="chat-row__time">Сдано {sub.submittedAt}</span>
        </span>
        <span
          className="chat-row__preview"
          style={{ display: 'flex', alignItems: 'center', gap: 10 }}
        >
          <span
            className="t-num"
            style={{ fontSize: 13, fontWeight: 600, color: 'var(--sokrat-fg1)' }}
          >
            {sub.score}/{sub.total}
          </span>
          <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }} aria-hidden="true">
            {sub.answers.map((a, i) => (
              <span
                key={i}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: ANSWER_COLOR[a],
                  display: 'inline-block',
                  flex: 'none',
                }}
              />
            ))}
          </span>
          <span className={aiChipClass(sub.aiFlag)}>{aiChipText(sub.aiFlag, sub.aiWarnCount)}</span>
        </span>
      </span>
      <ChevronRight size={16} aria-hidden="true" style={{ color: 'var(--sokrat-fg3)', flex: 'none' }} />
    </button>
  );
}

export const SubmissionRowLite = memo(SubmissionRowLiteImpl);
