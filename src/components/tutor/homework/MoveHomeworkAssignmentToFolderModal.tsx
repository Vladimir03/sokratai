// Перемещение ДЗ в папку. Плоский список папок + «Без папки» (флэт — не дерево).
// Запрос Елены (2026-06-17).
import { useEffect, useState, type ReactNode } from 'react';
import { X, Folder, Inbox, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useHomeworkFolders, useMoveAssignmentToFolder } from '@/hooks/useHomeworkFolders';
import { cn } from '@/lib/utils';

interface MoveHomeworkAssignmentToFolderModalProps {
  assignment: { id: string; title: string; folder_id: string | null };
  onClose: () => void;
}

const NO_FOLDER = '__none__';

export function MoveHomeworkAssignmentToFolderModal({
  assignment,
  onClose,
}: MoveHomeworkAssignmentToFolderModalProps) {
  const { folders, loading } = useHomeworkFolders();
  const move = useMoveAssignmentToFolder();
  const [selectedId, setSelectedId] = useState<string>(assignment.folder_id ?? NO_FOLDER);

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

  const currentId = assignment.folder_id ?? NO_FOLDER;
  const canSave = selectedId !== currentId && !move.isPending;

  const handleSave = () => {
    if (!canSave) return;
    const folderId = selectedId === NO_FOLDER ? null : selectedId;
    move.mutate(
      { assignmentId: assignment.id, folderId },
      {
        onSuccess: () => {
          toast.success(folderId ? 'ДЗ перемещено в папку' : 'ДЗ убрано из папки');
          onClose();
        },
        onError: () => {
          toast.error('Не удалось переместить ДЗ');
        },
      },
    );
  };

  return (
    <>
      <div className="fixed inset-0 z-[300] bg-black/40 animate-in fade-in-0" onClick={onClose} />

      <div className="fixed left-1/2 top-1/2 z-[301] flex max-h-[80vh] w-[calc(100%-2rem)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white shadow-xl animate-in fade-in-0 zoom-in-95">
        <div className="flex items-center justify-between border-b border-socrat-border px-5 py-4">
          <h3 className="min-w-0 truncate text-base font-semibold">Переместить в папку</h3>
          <button type="button" onClick={onClose} className="shrink-0 p-1">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <FolderRow
            icon={<Inbox className="h-4 w-4 text-slate-400" />}
            label="Без папки"
            selected={selectedId === NO_FOLDER}
            isCurrent={currentId === NO_FOLDER}
            onClick={() => setSelectedId(NO_FOLDER)}
          />
          {loading ? (
            <p className="px-3 py-4 text-sm text-slate-500">Загрузка папок...</p>
          ) : folders.length === 0 ? (
            <p className="px-3 py-4 text-sm text-slate-500">
              Папок пока нет. Создайте папку на странице «Домашние задания».
            </p>
          ) : (
            folders.map((f) => (
              <FolderRow
                key={f.id}
                icon={<Folder className="h-4 w-4 text-socrat-folder" />}
                label={f.name}
                selected={selectedId === f.id}
                isCurrent={currentId === f.id}
                onClick={() => setSelectedId(f.id)}
              />
            ))
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

function FolderRow({
  icon,
  label,
  selected,
  isCurrent,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  selected: boolean;
  isCurrent: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
        selected ? 'bg-socrat-primary-light text-slate-950' : 'hover:bg-socrat-surface',
      )}
      style={{ touchAction: 'manipulation' }}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {isCurrent && <span className="shrink-0 text-[11px] text-slate-400">текущая</span>}
      {selected && <Check className="h-4 w-4 shrink-0 text-socrat-primary" />}
    </button>
  );
}
