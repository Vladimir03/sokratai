import { Clock, ChevronRight } from 'lucide-react';

export interface RecentSolutionItem {
  id: string;
  created_at: string;
  problem_preview: string;
  subject?: string | null;
}

interface RecentSolutionsListProps {
  items: RecentSolutionItem[];
  loading: boolean;
  error?: string | null;
  onOpen: (solutionId: string) => void;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('ru-RU');
}

export function RecentSolutionsList({
  items,
  loading,
  error,
  onOpen,
}: RecentSolutionsListProps) {
  if (loading) {
    return (
      <div className="text-sm" style={{ color: 'var(--tg-theme-hint-color, hsl(var(--muted-foreground)))' }}>
        Загрузка решений...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm" style={{ color: 'var(--tg-theme-hint-color, hsl(var(--muted-foreground)))' }}>
        {error}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-sm" style={{ color: 'var(--tg-theme-hint-color, hsl(var(--muted-foreground)))' }}>
        Пока нет решений. Отправь задачу боту, чтобы она появилась здесь.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => onOpen(item.id)}
          className="w-full text-left p-4 rounded-xl transition-all hover:shadow-md"
          style={{
            backgroundColor: 'var(--tg-theme-bg-color, hsl(var(--card)))',
            borderWidth: '1px',
            borderStyle: 'solid',
            borderColor: 'var(--tg-theme-hint-color, hsl(var(--border)))',
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate" style={{ color: 'var(--tg-theme-text-color, hsl(var(--foreground)))' }}>
                {item.problem_preview}
              </p>
              <div className="flex items-center gap-2 mt-2 text-xs" style={{ color: 'var(--tg-theme-hint-color, hsl(var(--muted-foreground)))' }}>
                <Clock className="w-3 h-3" />
                <span>{formatDate(item.created_at)}</span>
                {item.subject && (
                  <span className="px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--tg-theme-secondary-bg-color, hsl(var(--secondary)))' }}>
                    {item.subject}
                  </span>
                )}
              </div>
            </div>
            <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--tg-theme-hint-color, hsl(var(--muted-foreground)))' }} />
          </div>
        </button>
      ))}
    </div>
  );
}
