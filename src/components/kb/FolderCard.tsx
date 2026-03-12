import { Folder, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FolderCardProps {
  folder: {
    id: string;
    name: string;
  };
  childCount?: number | null;
  taskCount?: number | null;
  onClick: () => void;
}

export function FolderCard({ folder, childCount = null, taskCount = null, onClick }: FolderCardProps) {
  const hasCounts = childCount !== null || taskCount !== null;

  return (
    <button
      onClick={onClick}
      className={cn(
        'group flex w-full items-center gap-3 rounded-[22px] border border-socrat-border bg-white px-4 py-4 text-left',
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
      <ChevronRight className="h-[18px] w-[18px] shrink-0 text-slate-400 transition-colors duration-200 group-hover:text-socrat-folder" />
    </button>
  );
}
