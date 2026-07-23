/**
 * Подтверждение удаления папки «Моей базы» (рекурсивные счётчики содержимого).
 *
 * 2026-07-23 (техдолг ревью 5.6): портировано с самописного оверлея на Radix
 * AlertDialog (`@/components/ui/alert-dialog`) — focus-trap, aria, Esc и
 * body-scroll-lock из коробки (прецедент: mock-exams DeleteMockExamDialog).
 * Публичный контракт props НЕ менялся — родитель условно рендерит компонент,
 * поэтому `open` всегда true, закрытие через onOpenChange → onClose.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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

  const subfolderCount = counts?.subfolderCount ?? 0;
  const taskCount = counts?.taskCount ?? 0;
  const hasContent = subfolderCount > 0 || taskCount > 0;

  return (
    <AlertDialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <AlertDialogContent className="max-w-[400px]">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="h-5 w-5 shrink-0 text-red-500" aria-hidden="true" />
            Удалить папку
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2 text-left">
            <span className="block text-slate-700">
              Папка <span className="font-semibold">&laquo;{folder.name}&raquo;</span> будет
              удалена безвозвратно.
            </span>
            {countsLoading ? (
              <span className="flex items-center gap-1.5 text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Подсчёт содержимого...
              </span>
            ) : hasContent ? (
              <span className="block text-slate-500">
                Вместе с ней будут удалены:{' '}
                {subfolderCount > 0 && (
                  <span>{subfolderCount} {subfolderCount === 1 ? 'подпапка' : 'подпапок'}</span>
                )}
                {subfolderCount > 0 && taskCount > 0 && ' и '}
                {taskCount > 0 && (
                  <span>{taskCount} {taskCount === 1 ? 'задача' : 'задач'}</span>
                )}
                .
              </span>
            ) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <AlertDialogCancel disabled={isPending}>Отмена</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // Radix закрывает по клику сам; закрытием управляет родитель
              // (unmount после успеха мутации) — предотвращаем дефолт.
              e.preventDefault();
              onConfirm();
            }}
            disabled={isPending}
            className={cn(
              'text-white',
              isPending ? 'cursor-default bg-red-300' : 'bg-red-600 hover:bg-red-700',
            )}
          >
            {isPending ? 'Удаление...' : 'Удалить'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
