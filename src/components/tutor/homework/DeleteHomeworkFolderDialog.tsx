// Удаление папки ДЗ. КРИТИЧНО — отличие от KB: задания внутри НЕ удаляются,
// они становятся «Без папки» (FK ON DELETE SET NULL). Текст обязателен — копировать
// KB-формулировку «будут удалены N задач» опасно для живых сдач. Запрос Елены (2026-06-17).
import { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { pluralizeRu } from '@/lib/pluralizeRu';

interface DeleteHomeworkFolderDialogProps {
  folder: { id: string; name: string };
  /**
   * Сколько заданий в папке И ВО ВСЁМ ПОДДЕРЕВЕ (вложенность 2026-07-20) —
   * для текста: они НЕ удалятся, станут «Без папки».
   */
  assignmentCount: number;
  /** Сколько подпапок в поддереве — они УДАЛЯТСЯ (FK CASCADE). 0 = плоская папка. */
  subfolderCount?: number;
  onConfirm: () => void;
  onClose: () => void;
  isPending?: boolean;
}

export function DeleteHomeworkFolderDialog({
  folder,
  assignmentCount,
  subfolderCount = 0,
  onConfirm,
  onClose,
  isPending = false,
}: DeleteHomeworkFolderDialogProps) {
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

  return (
    <>
      <div className="fixed inset-0 z-[300] bg-black/40 animate-in fade-in-0" onClick={onClose} />

      <div className="fixed left-1/2 top-1/2 z-[301] flex w-[calc(100%-2rem)] max-w-[400px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white shadow-xl animate-in fade-in-0 zoom-in-95">
        <div className="flex items-center justify-between border-b border-socrat-border px-5 py-4">
          <h3 className="text-base font-semibold text-red-600">Удалить папку</h3>
          <button type="button" onClick={onClose} className="shrink-0 p-1">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="px-5 py-5">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-50">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            </div>
            <div className="min-w-0 text-sm text-slate-700">
              <p>
                Папка <span className="font-semibold">&laquo;{folder.name}&raquo;</span> будет удалена
                {subfolderCount > 0 ? (
                  <>
                    {' '}вместе с {subfolderCount}{' '}
                    {pluralizeRu(subfolderCount, ['подпапкой', 'подпапками', 'подпапками'])}
                  </>
                ) : null}
                .
              </p>
              <p className="mt-2 text-slate-500">
                {assignmentCount > 0 ? (
                  <>
                    {assignmentCount} {pluralizeRu(assignmentCount, ['задание', 'задания', 'заданий'])}
                    {subfolderCount > 0 ? ' (включая задания в подпапках)' : ' внутри'}{' '}
                    <span className="font-medium text-slate-700">не удалятся</span> — они станут «Без папки».
                  </>
                ) : (
                  <>Заданий внутри нет — ничего не потеряется.</>
                )}
              </p>
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
            {isPending ? 'Удаление...' : 'Удалить папку'}
          </button>
        </div>
      </div>
    </>
  );
}
