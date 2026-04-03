import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { countFolderDescendants } from '@/hooks/useFolders';
import { cn } from '@/lib/utils';

interface DeleteFolderDialogProps {
  folder: { id: string; name: string };
  onConfirm: () => void;
  onClose: () => void;
  isPending?: boolean;
}

export function DeleteFolderDialog({
  folder,
  onConfirm,
  onClose,
  isPending = false,
}: DeleteFolderDialogProps) {
  const [counts, setCounts] = useState<{ subfolderCount: number; taskCount: number } | null>(null);
  const [countsLoading, setCountsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setCountsLoading(true);
    countFolderDescendants(folder.id)
      .then((result) => { if (!cancelled) setCounts(result); })
      .catch(() => { if (!cancelled) setCounts(null); })
      .finally(() => { if (!cancelled) setCountsLoading(false); });
    return () => { cancelled = true; };
  }, [folder.id]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const subfolderCount = counts?.subfolderCount ?? 0;
  const taskCount = counts?.taskCount ?? 0;
  const hasContent = subfolderCount > 0 || taskCount > 0;

  return (
    <>
      <div
        className="fixed inset-0 z-[300] bg-black/40 animate-in fade-in-0"
        onClick={onClose}
      />

      <div className="fixed left-1/2 top-1/2 z-[301] flex w-[calc(100%-2rem)] max-w-[400px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white shadow-xl animate-in fade-in-0 zoom-in-95">
        <div className="flex items-center justify-between border-b border-socrat-border px-5 py-4">
          <h3 className="text-base font-semibold text-red-600">Удалить папку</h3>
          <button type="button" onClick={onClose} className="shrink-0 p-1">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="px-5 py-5">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50">
              <AlertTriangle className="h-5 w-5 text-red-500" />
            </div>
            <div className="min-w-0 text-sm text-slate-700">
              <p>
                Папка <span className="font-semibold">&laquo;{folder.name}&raquo;</span> будет
                удалена безвозвратно.
              </p>
              {countsLoading ? (
                <p className="mt-2 flex items-center gap-1.5 text-slate-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Подсчёт содержимого...
                </p>
              ) : hasContent ? (
                <p className="mt-2 text-slate-500">
                  Вместе с ней будут удалены:{' '}
                  {subfolderCount > 0 && (
                    <span>{subfolderCount} {subfolderCount === 1 ? 'подпапка' : 'подпапок'}</span>
                  )}
                  {subfolderCount > 0 && taskCount > 0 && ' и '}
                  {taskCount > 0 && (
                    <span>{taskCount} {taskCount === 1 ? 'задача' : 'задач'}</span>
                  )}
                  .
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-socrat-border px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-socrat-border bg-transparent px-4 py-2 text-[13px] text-muted-foreground"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className={cn(
              'rounded-lg px-4 py-2 text-[13px] font-semibold text-white',
              isPending ? 'cursor-default bg-red-300' : 'bg-red-600 hover:bg-red-700',
            )}
          >
            {isPending ? 'Удаление...' : 'Удалить'}
          </button>
        </div>
      </div>
    </>
  );
}
