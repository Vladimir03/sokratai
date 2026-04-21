import { memo } from 'react';
import { CheckCircle2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  SubmissionRowLite,
  type ReviewItem,
} from '@/components/tutor/home/primitives';
import { pluralize, PLURAL_WORKS } from '@/lib/ru/pluralize';

export interface ReviewQueueBlockProps {
  items: ReviewItem[];
  onOpenAll: () => void;
  onOpenSubmission: (assignmentId: string) => void;
  /** When present, empty state renders primary CTA «Добавить ученика» (AC-3). */
  onAddStudent?: () => void;
}

const MAX_VISIBLE = 4;

function ReviewQueueBlockImpl({
  items,
  onOpenAll,
  onOpenSubmission,
  onAddStudent,
}: ReviewQueueBlockProps) {
  const visible = items.slice(0, MAX_VISIBLE);
  const metaLabel = `${items.length} ${pluralize(items.length, PLURAL_WORKS)}`;

  return (
    <section className="t-section">
      <div className="t-section__header">
        <h2>Требует проверки</h2>
        <span className="t-section__meta">{metaLabel}</span>
        <span style={{ marginLeft: 'auto' }}>
          <Button
            variant="ghost"
            size="default"
            onClick={onOpenAll}
            aria-label="Открыть все домашние задания"
            style={{ touchAction: 'manipulation' }}
          >
            Все ДЗ
          </Button>
        </span>
      </div>
      <hr className="t-divider" />
      {visible.length === 0 ? (
        <div className="t-empty" style={{ padding: '32px 20px' }}>
          <CheckCircle2
            size={24}
            aria-hidden="true"
            style={{ color: 'var(--sokrat-state-success-fg)' }}
          />
          <div className="t-empty__title">Ничего не ждёт проверки</div>
          <div className="t-empty__body">
            Новые сдачи появятся здесь сразу после выполнения учеником.
          </div>
          {onAddStudent && (
            <div className="t-empty__cta">
              <Button
                size="default"
                onClick={onAddStudent}
                aria-label="Добавить ученика"
                className="text-white"
                style={{
                  background: 'var(--sokrat-green-700)',
                  touchAction: 'manipulation',
                }}
              >
                <UserPlus aria-hidden="true" />
                Добавить ученика
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div>
          {visible.map((item) => (
            <SubmissionRowLite
              key={item.id}
              sub={item}
              onOpen={onOpenSubmission}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export const ReviewQueueBlock = memo(ReviewQueueBlockImpl);
