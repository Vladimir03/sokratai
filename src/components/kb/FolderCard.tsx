import { Folder, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FolderCardProps {
  folder: {
    id: string;
    name: string;
  };
  childCount?: number | null;
  taskCount?: number | null;
  onClick: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}

export function FolderCard({ folder, childCount = null, taskCount = null, onClick, onRename, onDelete }: FolderCardProps) {
  const hasCounts = childCount !== null || taskCount !== null;
  const hasActions = Boolean(onRename || onDelete);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className={cn(
        'group flex w-full items-center gap-3 rounded-[22px] border border-socrat-border bg-white px-4 py-4 text-left cursor-pointer',
        'shadow-[0_14px_32px_-30px_rgba(15,23,42,0.28)] transition-all duration-200 hover:border-socrat-folder/35 hover:bg-[#FCFBF8]'
      )}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-socrat-folder-bg">
        <Folder className="h-5 w-5 text-socrat-folder" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold text-slate-950">{folder.name}</div>
        {hasCounts ? (
          <div className="mt-0.5 text-xs text-slate-500">
            {childCount ?? 0} папок · {taskCount ?? 0} задач
          </div>
        ) : null}
      </div>
      {hasActions ? (
        <div className="flex shrink-0 items-center gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-200">
          {onRename ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRename(); }}
              onKeyDown={(e) => e.stopPropagation()}
              className="rounded-lg p-1.5 text-slate-400 transition-colors duration-200 hover:bg-slate-100 hover:text-socrat-primary touch-action-manipulation"
              aria-label="Переименовать папку"
            >
              <Pencil className="h-4 w-4" />
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              onKeyDown={(e) => e.stopPropagation()}
              className="rounded-lg p-1.5 text-slate-400 transition-colors duration-200 hover:bg-red-50 hover:text-red-500 touch-action-manipulation"
              aria-label="Удалить папку"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      ) : null}
      <ChevronRight className="h-[18px] w-[18px] shrink-0 text-slate-400 transition-colors duration-200 group-hover:text-socrat-folder" />
    </div>
  );
}
