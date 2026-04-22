import { memo } from 'react';
import { MessagesSquare, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  ChatRow,
  type DialogItem,
} from '@/components/tutor/home/primitives';

export interface RecentDialogsBlockProps {
  dialogs: DialogItem[];
  onOpenDialog: (dialog: DialogItem) => void;
  onOpenAll: () => void;
  /** When present, empty state renders primary CTA «Добавить ученика» (AC-3). */
  onAddStudent?: () => void;
}

const MAX_VISIBLE = 5;

function RecentDialogsBlockImpl({
  dialogs,
  onOpenDialog,
  onOpenAll,
  onAddStudent,
}: RecentDialogsBlockProps) {
  const visible = dialogs.slice(0, MAX_VISIBLE);

  return (
    <section className="t-section" style={{ marginBottom: 16 }}>
      <div className="t-section__header">
        <h2>Последние действия учеников</h2>
        <span className="t-section__meta">
          переписка и открытие задач, сортировка по последнему событию
        </span>
        <span style={{ marginLeft: 'auto' }}>
          <Button
            variant="ghost"
            size="default"
            onClick={onOpenAll}
            aria-label="Открыть все чаты"
            style={{ touchAction: 'manipulation' }}
          >
            Все чаты
          </Button>
        </span>
      </div>
      <hr className="t-divider" />
      {visible.length === 0 ? (
        <div className="t-empty" style={{ padding: '32px 20px' }}>
          <MessagesSquare
            size={24}
            aria-hidden="true"
            style={{ color: 'var(--sokrat-fg3)' }}
          />
          <div className="t-empty__title">Пока нет активности учеников</div>
          <div className="t-empty__body">
            Как только ученик откроет задачу или напишет в guided chat —
            событие появится здесь.
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
          {visible.map((chat) => (
            <ChatRow
              key={`${chat.studentId}-${chat.hwId}`}
              chat={chat}
              onOpen={onOpenDialog}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export const RecentDialogsBlock = memo(RecentDialogsBlockImpl);
