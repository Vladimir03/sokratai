import { useEffect, useState } from 'react';
import { Folder, X } from 'lucide-react';
import { toast } from 'sonner';
import { useFolderTree, useCopyTaskToFolder } from '@/hooks/useFolders';
import { cn } from '@/lib/utils';
import type { KBFolderTreeNode, KBTask } from '@/types/kb';

interface CopyToFolderModalProps {
  task: KBTask;
  onClose: () => void;
}

export function CopyToFolderModal({ task, onClose }: CopyToFolderModalProps) {
  const { tree, loading, error, refetch } = useFolderTree();
  const copyMutation = useCopyTaskToFolder();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Esc to close + body scroll lock
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

  const handleCopy = () => {
    if (!selectedId) return;
    copyMutation.mutate(
      { taskId: task.id, folderId: selectedId },
      {
        onSuccess: () => {
          const folderName = findFolderName(tree, selectedId);
          toast.success(`Скопировано в папку${folderName ? ` «${folderName}»` : ''}`);
          onClose();
        },
        onError: () => {
          toast.error('Не удалось скопировать задачу');
        },
      }
    );
  };

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-[300] bg-black/40 animate-in fade-in-0"
        onClick={onClose}
      />
      {/* Modal */}
      <div className="fixed left-1/2 top-1/2 z-[301] flex max-h-[70vh] w-[380px] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white shadow-xl animate-in fade-in-0 zoom-in-95">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-socrat-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold">Копировать в папку</h3>
            <p className="mt-1 truncate text-xs text-muted-foreground">{task.text}</p>
          </div>
          <button onClick={onClose} className="ml-2 shrink-0 p-1">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Folder tree */}
        <div className="flex-1 overflow-auto px-1.5 py-2">
          {loading && (
            <div className="space-y-2 px-3 py-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-10 animate-pulse rounded-lg bg-socrat-border-light" />
              ))}
            </div>
          )}
          {!loading && error && (
            <div className="px-3 py-8 text-center">
              <p className="text-sm text-red-600">Не удалось загрузить папки</p>
              <button
                onClick={refetch}
                className="mt-2 text-xs font-medium text-socrat-primary hover:underline"
              >
                Повторить
              </button>
            </div>
          )}
          {!loading && !error && tree.length === 0 && (
            <div className="py-8 text-center text-sm text-socrat-muted">
              Нет папок. Создайте папку в «Моя база».
            </div>
          )}
          {!loading && !error && tree.length > 0 && renderFolders(tree, 0, selectedId, setSelectedId)}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-socrat-border px-5 py-3.5">
          <button
            onClick={onClose}
            className="rounded-lg border border-socrat-border bg-transparent px-4 py-2 text-[13px] text-muted-foreground"
          >
            Отмена
          </button>
          <button
            onClick={handleCopy}
            disabled={!selectedId || copyMutation.isPending}
            className={cn(
              'rounded-lg px-4 py-2 text-[13px] font-semibold text-white',
              selectedId && !copyMutation.isPending
                ? 'bg-socrat-primary'
                : 'cursor-default bg-socrat-border'
            )}
          >
            {copyMutation.isPending ? 'Копирование...' : 'Скопировать'}
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
  setSelectedId: (id: string) => void,
) {
  return nodes.map(node => (
    <div key={node.id}>
      <button
        onClick={() => setSelectedId(node.id)}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-left text-[13px]',
          selectedId === node.id
            ? 'bg-socrat-primary-light font-semibold'
            : 'hover:bg-socrat-surface'
        )}
        style={{ paddingLeft: 14 + depth * 20 }}
      >
        <Folder
          className={cn(
            'h-4 w-4 shrink-0',
            selectedId === node.id ? 'text-socrat-primary' : 'text-socrat-folder'
          )}
        />
        <span>{node.name}</span>
      </button>
      {node.children.length > 0 && renderFolders(node.children, depth + 1, selectedId, setSelectedId)}
    </div>
  ));
}

function findFolderName(tree: KBFolderTreeNode[], id: string): string | null {
  for (const node of tree) {
    if (node.id === id) return node.name;
    if (node.children.length > 0) {
      const found = findFolderName(node.children, id);
      if (found) return found;
    }
  }
  return null;
}
