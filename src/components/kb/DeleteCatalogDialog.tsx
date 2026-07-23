import { useState } from 'react';
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
import { pluralizeRu } from '@/lib/pluralizeRu';
import { cn } from '@/lib/utils';
import { FolderTreeSelect } from '@/components/kb/FolderPickerModal';
import { useDeclutterPreview, type DeclutterTarget } from '@/hooks/useModeratorCatalog';

// ВОЛНА 6: подтверждение удаления темы/раздела из каталога с переносом задач в
// Мою базу. Хром — зеркало DeleteFolderDialog (красный destructive). Счётчики +
// needs_folder приходят из СЕРВЕРНОГО preflight (ревью 5.6 P0-2/P1-5): клиентский
// поиск и каталожный active-only view не искажают scope. При наличии задач —
// встроенный пикер личной папки; пусто → onConfirm(null).
//
// 2026-07-23 (техдолг ревью 5.6): портировано на Radix AlertDialog — focus-trap/
// aria/Esc/scroll-lock из коробки; пикер папки живёт внутри AlertDialogContent.
// Props-контракт не менялся.

interface DeleteCatalogDialogProps {
  entity: 'тему' | 'раздел';
  name: string;
  target: DeclutterTarget;
  isPending?: boolean;
  onConfirm: (folderId: string | null) => void;
  onClose: () => void;
}

export function DeleteCatalogDialog({
  entity,
  name,
  target,
  isPending = false,
  onConfirm,
  onClose,
}: DeleteCatalogDialogProps) {
  const { data: preview, isLoading, error } = useDeclutterPreview(target);
  const [folderId, setFolderId] = useState<string | null>(null);
  const needsFolder = preview?.needsFolder ?? false;
  const taskCount = preview?.moveCount ?? 0;
  const topicCount = preview?.topicCount;
  const canConfirm = !isPending && !isLoading && !error && (!needsFolder || folderId !== null);

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
                Удалить {entity} из каталога
              </AlertDialogTitle>
              <p className="mt-0.5 truncate text-sm text-slate-600">«{name}»</p>
            </div>
          </div>
        </AlertDialogHeader>

        <div className="text-left">
          {isLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Подсчёт содержимого…
            </div>
          ) : error ? (
            <p className="py-2 text-sm text-red-600">
              {error instanceof Error ? error.message : 'Не удалось получить сведения'}
            </p>
          ) : (
            <>
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
            </>
          )}
        </div>

        <AlertDialogFooter className="gap-2 sm:gap-2">
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              if (canConfirm) onConfirm(needsFolder ? folderId : null);
            }}
            disabled={!canConfirm}
            className={cn(
              'text-white',
              canConfirm ? 'bg-red-600 hover:bg-red-700' : 'cursor-default bg-socrat-border',
            )}
          >
            {isPending ? 'Удаляем…' : needsFolder ? 'Перенести и удалить' : 'Удалить'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
