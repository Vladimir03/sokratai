import { useEffect, useMemo, useState } from 'react';
import { Folder, X } from 'lucide-react';
import { useFolderTree } from '@/hooks/useFolders';
import { cn } from '@/lib/utils';
import type { KBFolderTreeNode } from '@/types/kb';

// ВОЛНА 6: переиспользуемый пикер личной папки «Моей базы» для модераторской
// уборки каталога (перенос задачи / удаление темы-раздела). Дерево — `useFolderTree`
// (папки модератора), КОРНЕВАЯ «сократ» отфильтрована (туда переносить нельзя —
// авто-переопубликует; бэкенд тоже отклоняет). `FolderTreeSelect` встраивается
// и в модалку, и в DeleteCatalogDialog.

const SOCRAT_ROOT = 'сократ';

/** Встраиваемое дерево выбора личной папки (без корня «сократ»). */
export function FolderTreeSelect({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { tree, loading, error, refetch } = useFolderTree();
  const folders = useMemo(
    () => tree.filter((n) => n.name.trim().toLowerCase() !== SOCRAT_ROOT),
    [tree],
  );

  if (loading) {
    return (
      <div className="space-y-2 px-3 py-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-socrat-border-light" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-3 py-8 text-center">
        <p className="text-sm text-red-600">Не удалось загрузить папки</p>
        <button onClick={refetch} className="mt-2 text-xs font-medium text-socrat-primary hover:underline">
          Повторить
        </button>
      </div>
    );
  }
  if (folders.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-socrat-muted">
        Нет личных папок. Создайте папку в «Моей базе».
      </div>
    );
  }
  return <>{renderFolders(folders, 0, selectedId, onSelect)}</>;
}

interface FolderPickerModalProps {
  title: string;
  description?: string;
  confirmLabel: string;
  isPending?: boolean;
  onConfirm: (folderId: string) => void;
  onClose: () => void;
}

/** Модалка «выбрать папку» для одиночного действия (перенос задачи). */
export function FolderPickerModal({
  title,
  description,
  confirmLabel,
  isPending = false,
  onConfirm,
  onClose,
}: FolderPickerModalProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
      <div className="fixed left-1/2 top-1/2 z-[301] flex max-h-[70vh] w-[380px] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white shadow-xl animate-in fade-in-0 zoom-in-95">
        <div className="flex items-start justify-between border-b border-socrat-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold">{title}</h3>
            {description ? (
              <p className="mt-1 text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
          <button onClick={onClose} className="ml-2 shrink-0 p-1" aria-label="Закрыть">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-1.5 py-2">
          <FolderTreeSelect selectedId={selectedId} onSelect={setSelectedId} />
        </div>

        <div className="flex justify-end gap-2 border-t border-socrat-border px-5 py-3.5">
          <button
            onClick={onClose}
            className="rounded-lg border border-socrat-border bg-transparent px-4 py-2 text-[13px] text-muted-foreground [touch-action:manipulation]"
          >
            Отмена
          </button>
          <button
            onClick={() => selectedId && onConfirm(selectedId)}
            disabled={!selectedId || isPending}
            className={cn(
              'rounded-lg px-4 py-2 text-[13px] font-semibold text-white [touch-action:manipulation]',
              selectedId && !isPending ? 'bg-socrat-primary' : 'cursor-default bg-socrat-border',
            )}
          >
            {isPending ? 'Переносим…' : confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}

function renderFolders(
  nodes: KBFolderTreeNode[],
  depth: number,
  selectedId: string | null,
  onSelect: (id: string) => void,
) {
  return nodes.map((node) => (
    <div key={node.id}>
      <button
        onClick={() => onSelect(node.id)}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-left text-[13px] [touch-action:manipulation]',
          selectedId === node.id ? 'bg-socrat-primary-light font-semibold' : 'hover:bg-socrat-surface',
        )}
        style={{ paddingLeft: 14 + depth * 20 }}
      >
        <Folder
          className={cn(
            'h-4 w-4 shrink-0',
            selectedId === node.id ? 'text-socrat-primary' : 'text-socrat-folder',
          )}
        />
        <span>{node.name}</span>
      </button>
      {node.children.length > 0 && renderFolders(node.children, depth + 1, selectedId, onSelect)}
    </div>
  ));
}
