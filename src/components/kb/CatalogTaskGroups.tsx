import { memo, useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { pluralizeRu } from '@/lib/pluralizeRu';
import type { KimGroup } from '@/lib/kbCatalogGrouping';
import type { KBTask } from '@/types/kb';

interface CatalogTaskGroupsProps {
  groups: KimGroup[];
  renderTask: (task: KBTask) => ReactNode;
  /** Классы контейнера задач внутри группы (default: `flex flex-col gap-3`). */
  groupBodyClassName?: string;
  className?: string;
}

function groupKey(kim: number | null): string {
  return kim == null ? 'none' : String(kim);
}

function groupLabel(kim: number | null): string {
  return kim == null ? 'Без номера КИМ' : `КИМ № ${kim}`;
}

/**
 * Рендерит задачи каталога сворачиваемыми секциями «КИМ № N · M задач»
 * (best-practice Школково). Карточку рендерит родитель через `renderTask` —
 * каталог отдаёт `TaskCard`, пикер — `PickerTaskCard`, общая логика одна.
 *
 * Состояние сворачивания локальное (default — все раскрыты). Сброс при смене
 * темы — через `key={topicId}` на этом компоненте у родителя.
 */
export const CatalogTaskGroups = memo(function CatalogTaskGroups({
  groups,
  renderTask,
  groupBodyClassName,
  className,
}: CatalogTaskGroupsProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const idBase = useId();

  const toggle = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {groups.map((group) => {
        // Олимпиадные (под)группы задают свои key/label; KIM-группы — дефолтные.
        const key = group.key ?? groupKey(group.kim);
        const label = group.label ?? groupLabel(group.kim);
        const isOpen = !collapsed.has(key);
        const panelId = `${idBase}-${key}`;
        const count = group.tasks.length;
        return (
          <section key={key}>
            <button
              type="button"
              onClick={() => toggle(key)}
              aria-expanded={isOpen}
              aria-controls={panelId}
              className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left [touch-action:manipulation] transition-colors hover:bg-socrat-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-socrat-primary/40"
            >
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  'h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200',
                  isOpen ? '' : '-rotate-90',
                )}
              />
              <span className="text-sm font-semibold text-slate-800">{label}</span>
              <span className="text-xs font-medium tabular-nums text-slate-400">
                · {count} {pluralizeRu(count, ['задача', 'задачи', 'задач'])}
              </span>
            </button>
            {isOpen ? (
              <div id={panelId} className={cn('mt-2', groupBodyClassName ?? 'flex flex-col gap-3')}>
                {group.tasks.map((task) => (
                  <div key={task.id}>{renderTask(task)}</div>
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
});
