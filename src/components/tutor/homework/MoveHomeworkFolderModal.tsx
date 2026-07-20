// Перенос ПАПКИ ДЗ к новому родителю (вложенность, 2026-07-20). Клон shell'а
// MoveHomeworkAssignmentToFolderModal (custom overlay, Esc, scroll-lock).
// Клиентский cycle-guard: сама папка + её поддерево disabled (collectDescendantIds);
// backstop — DB-триггер hw_folder_parent_guard (миграция 20260720130000).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { X, Folder, Inbox, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useHomeworkFolders, useMoveHomeworkFolder } from '@/hooks/useHomeworkFolders';
import { collectDescendantIds, flattenTreeWithDepth } from '@/lib/homeworkFolderTree';
import type { HomeworkFolder } from '@/lib/tutorHomeworkFoldersApi';
import { cn } from '@/lib/utils';

interface MoveHomeworkFolderModalProps {
  folder: HomeworkFolder;
  onClose: () => void;
}

const ROOT = '__root__';

export function MoveHomeworkFolderModal({ folder, onClose }: MoveHomeworkFolderModalProps) {
  const { folders, tree, loading } = useHomeworkFolders();
  const move = useMoveHomeworkFolder();
  const [selectedId, setSelectedId] = useState<string>(folder.parent_id ?? ROOT);

  const flatTree = useMemo(() => flattenTreeWithDepth(tree), [tree]);
  // Сама папка + всё её поддерево — запрещённые цели (цикл).
  const forbiddenIds = useMemo(
    () => collectDescendantIds(folders, folder.id),
    [folders, folder.id],
  );

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

  const currentId = folder.parent_id ?? ROOT;
  const canSave = selectedId !== currentId && !move.isPending && !forbiddenIds.has(selectedId);

  const handleSave = () => {
    if (!canSave) return;
    const parentId = selectedId === ROOT ? null : selectedId;
    move.mutate(
      { folderId: folder.id, parentId },
      {
        onSuccess: () => {
          toast.success('Папка перемещена');
          onClose();
        },
        onError: (err) => {
          toast.error(err instanceof Error && err.message ? err.message : 'Не удалось переместить папку');
        },
      },
    );
  };

  return (
    <>
      <div className="fixed inset-0 z-[300] bg-black/40 animate-in fade-in-0" onClick={onClose} />

      <div className="fixed left-1/2 top-1/2 z-[301] flex max-h-[80vh] w-[calc(100%-2rem)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white shadow-xl animate-in fade-in-0 zoom-in-95">
        <div className="flex items-center justify-between border-b border-socrat-border px-5 py-4">
          <h3 className="min-w-0 truncate text-base font-semibold">
            Переместить «{folder.name}»
          </h3>
          <button type="button" onClick={onClose} className="shrink-0 p-1">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <TargetRow
            icon={<Inbox className="h-4 w-4 text-slate-400" />}
            label="Без папки (корень)"
            selected={selectedId === ROOT}
            isCurrent={currentId === ROOT}
            onClick={() => setSelectedId(ROOT)}
          />
          {loading ? (
            <p className="px-3 py-4 text-sm text-slate-500">Загрузка папок...</p>
          ) : (
            flatTree.map(({ folder: f, depth }) => {
              const forbidden = forbiddenIds.has(f.id);
              return (
                <TargetRow
                  key={f.id}
                  icon={<Folder className="h-4 w-4 text-socrat-folder" />}
                  label={f.name}
                  depth={depth}
                  selected={selectedId === f.id}
                  isCurrent={currentId === f.id}
                  disabled={forbidden}
                  disabledHint={f.id === folder.id ? 'перемещаемая' : 'внутри перемещаемой'}
                  onClick={() => setSelectedId(f.id)}
                />
              );
            })
          )}
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
            onClick={handleSave}
            disabled={!canSave}
            className={cn(
              'rounded-lg px-4 py-2 text-[13px] font-semibold text-white',
              canSave ? 'bg-socrat-primary' : 'cursor-default bg-socrat-border',
            )}
          >
            {move.isPending ? 'Перемещение...' : 'Переместить'}
          </button>
        </div>
      </div>
    </>
  );
}

function TargetRow({
  icon,
  label,
  selected,
  isCurrent,
  onClick,
  depth = 0,
  disabled = false,
  disabledHint,
}: {
  icon: ReactNode;
  label: string;
  selected: boolean;
  isCurrent: boolean;
  onClick: () => void;
  depth?: number;
  disabled?: boolean;
  disabledHint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg py-2.5 pr-3 text-left text-sm transition-colors',
        disabled
          ? 'cursor-not-allowed opacity-45'
          : selected
            ? 'bg-socrat-primary-light text-slate-950'
            : 'hover:bg-socrat-surface',
      )}
      style={{ touchAction: 'manipulation', paddingLeft: 12 + depth * 20 }}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {disabled && disabledHint && (
        <span className="shrink-0 text-[11px] text-slate-400">{disabledHint}</span>
      )}
      {!disabled && isCurrent && <span className="shrink-0 text-[11px] text-slate-400">текущая</span>}
      {!disabled && selected && <Check className="h-4 w-4 shrink-0 text-socrat-primary" />}
    </button>
  );
}
