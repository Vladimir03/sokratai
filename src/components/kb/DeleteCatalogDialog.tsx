import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { pluralizeRu } from '@/lib/pluralizeRu';
import { cn } from '@/lib/utils';
import { FolderTreeSelect } from '@/components/kb/FolderPickerModal';

// ВОЛНА 6: подтверждение удаления темы/раздела из каталога с переносом задач в
// Мою базу. Хром — зеркало DeleteFolderDialog (красный destructive); при наличии
// задач встроен пикер личной папки (FolderTreeSelect). Пустая тема/раздел →
// пикер скрыт, onConfirm(null).

interface DeleteCatalogDialogProps {
  /** «тему» | «раздел» — для заголовка. */
  entity: 'тему' | 'раздел';
  name: string;
  /** Сколько задач будет перенесено в Мою базу. */
  taskCount: number;
  /** Доп. счётчик (для раздела — число тем). */
  topicCount?: number;
  isPending?: boolean;
  onConfirm: (folderId: string | null) => void;
  onClose: () => void;
}

export function DeleteCatalogDialog({
  entity,
  name,
  taskCount,
  topicCount,
  isPending = false,
  onConfirm,
  onClose,
}: DeleteCatalogDialogProps) {
  const [folderId, setFolderId] = useState<string | null>(null);
  const needsFolder = taskCount > 0;
  const canConfirm = !isPending && (!needsFolder || folderId !== null);

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
              <h3 className="text-base font-semibold text-red-600">
                Удалить {entity} из каталога
              </h3>
              <p className="mt-0.5 truncate text-sm text-slate-600">«{name}»</p>
            </div>
          </div>
          <button onClick={onClose} className="ml-2 shrink-0 p-1" aria-label="Закрыть">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          {topicCount !== undefined && topicCount > 0 ? (
            <p className="mb-2 text-sm text-slate-600">
              Будет удалено{' '}
              <span className="font-semibold">
                {topicCount} {pluralizeRu(topicCount, ['тема', 'темы', 'тем'])}
              </span>
              .
            </p>
          ) : null}

          {needsFolder ? (
            <>
              <p className="text-sm text-slate-600">
                <span className="font-semibold">
                  {taskCount} {pluralizeRu(taskCount, ['задача', 'задачи', 'задач'])}
                </span>{' '}
                {pluralizeRu(taskCount, ['будет перенесена', 'будут перенесены', 'будут перенесены'])} в
                вашу «Мою базу», из общего каталога {entity === 'тему' ? 'тема исчезнет' : 'раздел исчезнет'}.
              </p>
              <p className="mb-1.5 mt-3 text-xs font-semibold text-slate-500">Выберите папку для задач:</p>
              <div className="max-h-[38vh] overflow-auto rounded-lg border border-socrat-border py-1">
                <FolderTreeSelect selectedId={folderId} onSelect={setFolderId} />
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-600">
              {entity === 'тему' ? 'Тема пустая' : 'Раздел пустой'} — {entity === 'тему' ? 'она' : 'он'} будет
              удалён{entity === 'тему' ? 'а' : ''} из каталога. Отменить нельзя.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-socrat-border px-5 py-3.5">
          <button
            onClick={onClose}
            className="rounded-lg border border-socrat-border bg-transparent px-4 py-2 text-[13px] text-muted-foreground [touch-action:manipulation]"
          >
            Отмена
          </button>
          <button
            onClick={() => canConfirm && onConfirm(needsFolder ? folderId : null)}
            disabled={!canConfirm}
            className={cn(
              'rounded-lg px-4 py-2 text-[13px] font-semibold text-white [touch-action:manipulation]',
              canConfirm ? 'bg-red-600 hover:bg-red-700' : 'cursor-default bg-socrat-border',
            )}
          >
            {isPending ? 'Удаляем…' : needsFolder ? 'Перенести и удалить' : 'Удалить'}
          </button>
        </div>
      </div>
    </>
  );
}
