import { useEffect } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDeleteTaskPreview } from '@/hooks/useModeratorCatalog';
import type { DeleteCatalogTaskBranch } from '@/lib/kbModeratorApi';

// Hard-delete задачи из каталога (запрос Милады, 2026-07-22). Хром — зеркало
// DeleteCatalogDialog (красный destructive), но БЕЗ пикера папки: удаление
// ничего не переносит. Ветка (own_source / orphan / foreign / …) приходит из
// СЕРВЕРНОГО preflight `kb_mod_preview_delete_task` — клиент не может отличить
// свой исходник от чужого (RLS прячет чужие личные строки). Гонка preview ↔
// confirm не страшна: мутация-RPC перепроверяет всё под FOR UPDATE.

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
  const { data: preview, isLoading, error } = useDeleteTaskPreview(taskId);

  const templateBlocked =
    (preview?.templateCount ?? 0) > 0 || (preview?.sourceTemplateCount ?? 0) > 0;
  const body = preview ? branchBody(preview.branch) : null;
  const canConfirm =
    !isPending && !isLoading && !error && body !== null && !body.blocking && !templateBlocked;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-[300] bg-black/40 animate-in fade-in-0" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[301] flex max-h-[85vh] w-[420px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white shadow-xl animate-in fade-in-0 zoom-in-95">
        <div className="flex items-start justify-between border-b border-socrat-border px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-red-600">Удалить задачу из каталога</h3>
              <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">«{taskPreviewText}»</p>
            </div>
          </div>
          <button onClick={onClose} className="ml-2 shrink-0 p-1" aria-label="Закрыть">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          {isLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Проверяем задачу…
            </div>
          ) : error ? (
            <p className="py-4 text-sm text-red-600">
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

        <div className="flex justify-end gap-2 border-t border-socrat-border px-5 py-3.5">
          <button
            onClick={onClose}
            className="rounded-lg border border-socrat-border bg-transparent px-4 py-2 text-[13px] text-muted-foreground [touch-action:manipulation]"
          >
            {body?.blocking || templateBlocked ? 'Понятно' : 'Отмена'}
          </button>
          {!body?.blocking && (
            <button
              onClick={() => canConfirm && onConfirm()}
              disabled={!canConfirm}
              className={cn(
                'rounded-lg px-4 py-2 text-[13px] font-semibold text-white [touch-action:manipulation]',
                canConfirm ? 'bg-red-600 hover:bg-red-700' : 'cursor-default bg-socrat-border',
              )}
            >
              {isPending ? 'Удаляем…' : 'Удалить безвозвратно'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
