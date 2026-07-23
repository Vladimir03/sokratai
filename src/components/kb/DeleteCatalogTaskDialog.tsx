import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { useDeleteTaskPreview } from '@/hooks/useModeratorCatalog';
import type { DeleteCatalogTaskBranch } from '@/lib/kbModeratorApi';

// Hard-delete задачи из каталога (запрос Милады, 2026-07-22). Хром — зеркало
// DeleteCatalogDialog (красный destructive), но БЕЗ пикера папки: удаление
// ничего не переносит. Ветка (own_source / orphan / foreign / …) приходит из
// СЕРВЕРНОГО preflight `kb_mod_preview_delete_task` — клиент не может отличить
// свой исходник от чужого (RLS прячет чужие личные строки). Гонка preview ↔
// confirm не страшна: мутация-RPC перепроверяет всё под FOR UPDATE.
//
// 2026-07-23 (техдолг ревью 5.6): портировано на Radix AlertDialog —
// focus-trap/aria/Esc/scroll-lock из коробки. Props-контракт не менялся.

interface DeleteCatalogTaskDialogProps {
  taskId: string;
  /** Короткий текст задачи для заголовка (обрезается CSS). */
  taskPreviewText: string;
  isPending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

function branchBody(branch: DeleteCatalogTaskBranch): { text: string; blocking: boolean } {
  switch (branch) {
    case 'own_source':
      return {
        text: 'Задача будет удалена из общего каталога, и её исходник будет удалён из вашей базы. Безвозвратно.',
        blocking: false,
      };
    case 'own_source_detached':
      return {
        text: 'Задача будет удалена из общего каталога безвозвратно. Ваша личная копия-исходник останется в вашей базе.',
        blocking: false,
      };
    case 'orphan':
      return {
        text: 'Задача будет удалена из общего каталога безвозвратно.',
        blocking: false,
      };
    case 'foreign':
      return {
        text: 'Эта задача опубликована из папки другого модератора — удалить её может только он.',
        blocking: true,
      };
    case 'link_broken':
      return {
        text: 'Нарушена связь публикации задачи — обратитесь к владельцу.',
        blocking: true,
      };
  }
}

export function DeleteCatalogTaskDialog({
  taskId,
  taskPreviewText,
  isPending = false,
  onConfirm,
  onClose,
}: DeleteCatalogTaskDialogProps) {
  const { data: preview, isLoading, isFetching, error } = useDeleteTaskPreview(taskId);

  const templateBlocked =
    (preview?.templateCount ?? 0) > 0 || (preview?.sourceTemplateCount ?? 0) > 0;
  const body = preview ? branchBody(preview.branch) : null;
  // Гейт по isFetching, не только isLoading (ревью 5.6 P2): повторное открытие
  // отдаёт кэш + background refetch — confirm по устаревшей ветке запрещён
  // (сервер перепроверит, но UX кончился бы неожиданным отказом).
  const canConfirm =
    !isPending && !isLoading && !isFetching && !error &&
    body !== null && !body.blocking && !templateBlocked;

  // Заголовок честен про масштаб (ревью 5.6 U1): own-source удаляет И исходник.
  const title =
    preview?.branch === 'own_source'
      ? 'Удалить из каталога и Моей базы?'
      : preview
        ? 'Удалить из каталога?'
        : 'Удалить задачу?';

  return (
    <AlertDialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      {/* Тело содержит блочную разметку — AlertDialogDescription (<p>) не
          подходит; aria-describedby гасится явно (Radix-конвенция). */}
      <AlertDialogContent className="max-w-[420px]" aria-describedby={undefined}>
        <AlertDialogHeader>
          <div className="flex items-start gap-3 text-left">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle className="h-5 w-5 text-red-600" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <AlertDialogTitle className="text-base font-semibold text-red-600">
                {title}
              </AlertDialogTitle>
              <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">«{taskPreviewText}»</p>
            </div>
          </div>
        </AlertDialogHeader>

        <div className="text-left">
          {isLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Проверяем задачу…
            </div>
          ) : error ? (
            <p className="py-2 text-sm text-red-600">
              {error instanceof Error ? error.message : 'Не удалось получить сведения'}
            </p>
          ) : body ? (
            <>
              <p className={cn('text-sm', body.blocking ? 'text-slate-600' : 'text-slate-700')}>
                {body.text}
              </p>
              {templateBlocked && !body.blocking ? (
                <p className="mt-2 text-sm font-medium text-amber-700">
                  Задача используется в шаблонах ДЗ (
                  {(preview?.templateCount ?? 0) + (preview?.sourceTemplateCount ?? 0)}) — сначала
                  уберите её из шаблонов.
                </p>
              ) : null}
              {!body.blocking && !templateBlocked ? (
                <p className="mt-2 text-xs text-slate-500">
                  Чтобы убрать задачу из каталога, сохранив её у себя, используйте «Перенести в Мою
                  базу».
                </p>
              ) : null}
            </>
          ) : null}
        </div>

        <AlertDialogFooter className="gap-2 sm:gap-2">
          <AlertDialogCancel>
            {body?.blocking || templateBlocked ? 'Понятно' : 'Отмена'}
          </AlertDialogCancel>
          {!body?.blocking && (
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (canConfirm) onConfirm();
              }}
              disabled={!canConfirm}
              className={cn(
                'text-white',
                canConfirm ? 'bg-red-600 hover:bg-red-700' : 'cursor-default bg-socrat-border',
              )}
            >
              {isPending ? 'Удаляем…' : 'Удалить безвозвратно'}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
