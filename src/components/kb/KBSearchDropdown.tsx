import { useEffect, useRef } from 'react';
import { BookOpen, FileText, Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KBSearchGrouped, KBSearchResult } from '@/hooks/useKBSearch';

interface KBSearchDropdownProps {
  grouped: KBSearchGrouped;
  isLoading: boolean;
  hasResults: boolean;
  isActive: boolean;
  onSelectTopic: (topicId: string) => void;
  onSelectTask: (task: KBSearchResult) => void;
  onClose: () => void;
}

export function KBSearchDropdown({
  grouped,
  isLoading,
  hasResults,
  isActive,
  onSelectTopic,
  onSelectTask,
  onClose,
}: KBSearchDropdownProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    if (isActive) {
      document.addEventListener('mousedown', handleClick);
    }
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isActive, onClose]);

  if (!isActive) return null;

  if (isLoading) {
    return (
      <div
        ref={ref}
        className="absolute left-0 right-0 top-full z-50 mt-1 rounded-xl border border-socrat-border bg-white p-4 shadow-lg"
      >
        <div className="flex items-center justify-center gap-2 py-3 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Поиск...
        </div>
      </div>
    );
  }

  if (!hasResults) {
    return (
      <div
        ref={ref}
        className="absolute left-0 right-0 top-full z-50 mt-1 rounded-xl border border-socrat-border bg-white p-4 shadow-lg"
      >
        <div className="py-3 text-center text-sm text-slate-500">
          <Search className="mx-auto mb-2 h-5 w-5 text-slate-400" />
          Ничего не найдено
        </div>
      </div>
    );
  }

  const { topics, tasks, materials } = grouped;

  return (
    <div
      ref={ref}
      className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[400px] overflow-y-auto rounded-xl border border-socrat-border bg-white shadow-lg"
    >
      {topics.length > 0 && (
        <SearchGroup label={`Темы (${topics.length})`}>
          {topics.map((item) => (
            <button
              key={item.result_id}
              type="button"
              onClick={() => onSelectTopic(item.result_id)}
              className={cn(
                'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                'hover:bg-socrat-surface',
              )}
            >
              <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-socrat-primary" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">{item.title}</p>
                {item.snippet ? (
                  <p className="truncate text-xs text-slate-500">{item.snippet}</p>
                ) : null}
              </div>
            </button>
          ))}
        </SearchGroup>
      )}

      {tasks.length > 0 && (
        <SearchGroup label={`Задачи (${tasks.length})`}>
          {tasks.map((item) => (
            <button
              key={item.result_id}
              type="button"
              onClick={() => onSelectTask(item)}
              className={cn(
                'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                'hover:bg-socrat-surface',
              )}
            >
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-socrat-accent" />
              <div className="min-w-0">
                <p className="line-clamp-2 text-sm text-slate-900">{item.title}</p>
                {item.source ? (
                  <p className="mt-0.5 text-xs text-slate-400">
                    {item.source === 'socrat' ? 'Каталог' : 'Моя база'}
                  </p>
                ) : null}
              </div>
            </button>
          ))}
        </SearchGroup>
      )}

      {materials.length > 0 && (
        <SearchGroup label={`Материалы (${materials.length})`}>
          {materials.map((item) => (
            <button
              key={item.result_id}
              type="button"
              onClick={() => onClose()}
              className={cn(
                'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                'hover:bg-socrat-surface',
              )}
            >
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div className="min-w-0">
                <p className="truncate text-sm text-slate-900">{item.title}</p>
                {item.snippet ? (
                  <p className="truncate text-xs text-slate-400">{item.snippet}</p>
                ) : null}
              </div>
            </button>
          ))}
        </SearchGroup>
      )}
    </div>
  );
}

function SearchGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-socrat-border-light last:border-b-0">
      <p className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </p>
      <div className="px-1 pb-2">{children}</div>
    </div>
  );
}
