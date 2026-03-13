import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { useCreateFolder } from '@/hooks/useFolders';
import { cn } from '@/lib/utils';

interface CreateFolderModalProps {
  /** Parent folder id — if set, creates a subfolder */
  parentId?: string;
  onClose: () => void;
}

export function CreateFolderModal({ parentId, onClose }: CreateFolderModalProps) {
  const createFolder = useCreateFolder();
  const [name, setName] = useState('');

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

  const canSave = name.trim().length > 0;

  const handleSave = () => {
    if (!canSave) return;

    createFolder.mutate(
      { name: name.trim(), parent_id: parentId ?? null },
      {
        onSuccess: () => {
          toast.success('Папка создана');
          onClose();
        },
        onError: () => {
          toast.error('Не удалось создать папку');
        },
      },
    );
  };

  const title = parentId ? 'Новая подпапка' : 'Новая папка';

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-[300] bg-black/40 animate-in fade-in-0"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed left-1/2 top-1/2 z-[301] flex w-[400px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white shadow-xl animate-in fade-in-0 zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-socrat-border px-5 py-4">
          <h3 className="text-base font-semibold">{title}</h3>
          <button type="button" onClick={onClose} className="shrink-0 p-1">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4">
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold text-slate-500">
              Название <span className="text-red-500">*</span>
            </legend>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSave && !createFolder.isPending) {
                  handleSave();
                }
              }}
              placeholder="Введите название папки..."
              autoFocus
              className="w-full rounded-lg border border-socrat-border px-3 py-2.5 text-[16px] transition-colors duration-200 placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none"
            />
          </fieldset>
        </div>

        {/* Footer */}
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
            disabled={!canSave || createFolder.isPending}
            className={cn(
              'rounded-lg px-4 py-2 text-[13px] font-semibold text-white',
              canSave && !createFolder.isPending
                ? 'bg-socrat-primary'
                : 'cursor-default bg-socrat-border',
            )}
          >
            {createFolder.isPending ? 'Создание...' : 'Создать'}
          </button>
        </div>
      </div>
    </>
  );
}
