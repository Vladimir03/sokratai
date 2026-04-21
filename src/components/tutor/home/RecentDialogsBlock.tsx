import { memo } from 'react';
import { MessagesSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  ChatRow,
  type DialogItem,
} from '@/components/tutor/home/primitives';

export interface RecentDialogsBlockProps {
  dialogs: DialogItem[];
  onOpenDialog: (dialog: DialogItem) => void;
  onOpenAll: () => void;
}

const MAX_VISIBLE = 5;

function RecentDialogsBlockImpl({
  dialogs,
  onOpenDialog,
  onOpenAll,
}: RecentDialogsBlockProps) {
  const visible = dialogs.slice(0, MAX_VISIBLE);

  return (
    <section className="t-section" style={{ marginBottom: 16 }}>
      <div className="t-section__header">
        <h2>Последние диалоги</h2>
        <span className="t-section__meta">
          сортировка по времени последнего сообщения
        </span>
        <span style={{ marginLeft: 'auto' }}>
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenAll}
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
          <div className="t-empty__title">Пока нет сообщений от учеников</div>
          <div className="t-empty__body">
            Как только ученик напишет — диалог появится здесь.
          </div>
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
