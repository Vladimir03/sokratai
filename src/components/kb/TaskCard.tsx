import { Check, Image, Pencil, Sparkles, Trash2 } from 'lucide-react';
import { ContextMenu, type ContextMenuItem } from '@/components/kb/ui/ContextMenu';
import { SourceBadge } from '@/components/kb/ui/SourceBadge';
import { cn } from '@/lib/utils';
import type { KBTask } from '@/types/kb';

interface TaskCardProps {
  task: KBTask;
  isExpanded: boolean;
  isOwn: boolean;
  inHW?: boolean;
  subtopicName?: string;
  onToggle: () => void;
  onAddToHW?: () => void;
  onCopyToFolder?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onAiSimilar?: () => void;
  className?: string;
}

export function TaskCard({
  task,
  isExpanded,
  isOwn,
  inHW = false,
  subtopicName,
  onToggle,
  onAddToHW,
  onCopyToFolder,
  onEdit,
  onDelete,
  onAiSimilar,
  className,
}: TaskCardProps) {
  const menuItems: ContextMenuItem[] = [];

  if (isOwn && onEdit) {
    menuItems.push({ key: 'edit', label: 'Редактировать', icon: Pencil, onSelect: onEdit });
  }
  if (isOwn && onAiSimilar) {
    menuItems.push({ key: 'ai_similar', label: 'Похожая AI', icon: Sparkles, onSelect: onAiSimilar });
  }
  if (isOwn && onDelete) {
    menuItems.push({ key: 'delete', label: 'Удалить', icon: Trash2, destructive: true, onSelect: onDelete });
  }

  return (
    <article
      className={cn(
        'overflow-hidden rounded-2xl border bg-white transition-all duration-200',
        inHW
          ? 'border-socrat-primary/30 shadow-[0_18px_35px_-30px_rgba(27,107,74,0.55)]'
          : 'border-socrat-border shadow-[0_14px_32px_-30px_rgba(15,23,42,0.28)] hover:border-socrat-primary/25',
        className,
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggle();
          }
        }}
        className="flex cursor-pointer items-start gap-4 px-4 py-4 sm:px-5"
      >
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <SourceBadge source={isOwn ? 'my' : 'socrat'} />
            {subtopicName ? (
              <span className="text-[11px] font-medium text-slate-500">{subtopicName}</span>
            ) : null}
            {task.kim_number ? (
              <span className="text-[11px] font-medium text-slate-500">КИМ № {task.kim_number}</span>
            ) : null}
            {task.attachment_url ? <Image className="h-3.5 w-3.5 text-slate-400" /> : null}
          </div>

          <p
            className={cn(
              'text-[13px] leading-[1.58] text-slate-900 sm:text-sm',
              !isExpanded && 'line-clamp-2',
            )}
          >
            {task.text}
          </p>

          {isExpanded && task.answer ? (
            <div className="mt-3 rounded-xl bg-socrat-surface px-3.5 py-3">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
                Ответ
              </div>
              <div className="font-mono text-sm font-semibold text-socrat-primary">{task.answer}</div>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-start gap-2" onClick={(event) => event.stopPropagation()}>
          {!isOwn && onCopyToFolder ? (
            <button
              type="button"
              onClick={onCopyToFolder}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-all duration-200',
                'border-socrat-folder/20 bg-socrat-folder-bg text-socrat-folder hover:border-socrat-folder/40',
              )}
            >
              К себе
            </button>
          ) : null}

          {onAddToHW ? (
            <button
              type="button"
              onClick={onAddToHW}
              disabled={inHW}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all duration-200',
                inHW
                  ? 'cursor-default border border-socrat-primary/20 bg-socrat-primary-light text-socrat-primary'
                  : 'bg-socrat-primary text-white shadow-sm hover:bg-socrat-primary-dark',
              )}
            >
              {inHW ? <Check className="h-3.5 w-3.5" /> : null}
              В ДЗ
            </button>
          ) : null}

          {isOwn && menuItems.length > 0 ? <ContextMenu items={menuItems} /> : null}
        </div>
      </div>
    </article>
  );
}
