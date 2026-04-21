import { memo } from 'react';
import { CheckCircle2 } from 'lucide-react';
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
}

const MAX_VISIBLE = 4;

function ReviewQueueBlockImpl({
  items,
  onOpenAll,
  onOpenSubmission,
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
            size="sm"
            onClick={onOpenAll}
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
