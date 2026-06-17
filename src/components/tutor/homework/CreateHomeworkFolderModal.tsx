// Создание папки ДЗ. Клон KB CreateFolderModal на homework-хуки. Запрос Елены (2026-06-17).
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { useCreateHomeworkFolder } from '@/hooks/useHomeworkFolders';
import { cn } from '@/lib/utils';

interface CreateHomeworkFolderModalProps {
  onClose: () => void;
  /** Опц. колбэк с созданной папкой (например, чтобы сразу перейти в неё). */
  onCreated?: (folder: { id: string; name: string }) => void;
}

export function CreateHomeworkFolderModal({ onClose, onCreated }: CreateHomeworkFolderModalProps) {
  const createFolder = useCreateHomeworkFolder();
  const [name, setName] = useState('');

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
    createFolder.mutate(name.trim(), {
      onSuccess: (folder) => {
        toast.success('Папка создана');
        onCreated?.(folder);
        onClose();
      },
      onError: () => {
        toast.error('Не удалось создать папку');
      },
    });
  };

  return (
    <>
      <div className="fixed inset-0 z-[300] bg-black/40 animate-in fade-in-0" onClick={onClose} />

      <div className="fixed left-1/2 top-1/2 z-[301] flex w-[calc(100%-2rem)] max-w-[400px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white shadow-xl animate-in fade-in-0 zoom-in-95">
        <div className="flex items-center justify-between border-b border-socrat-border px-5 py-4">
          <h3 className="text-base font-semibold">Новая папка</h3>
          <button type="button" onClick={onClose} className="shrink-0 p-1">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

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
                if (e.key === 'Enter' && canSave && !createFolder.isPending) handleSave();
              }}
              placeholder="Например: Кинематика, Группа 11А..."
              autoFocus
              className="w-full rounded-lg border border-socrat-border px-3 py-2.5 text-[16px] transition-colors duration-200 placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none"
            />
          </fieldset>
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
            disabled={!canSave || createFolder.isPending}
            className={cn(
              'rounded-lg px-4 py-2 text-[13px] font-semibold text-white',
              canSave && !createFolder.isPending ? 'bg-socrat-primary' : 'cursor-default bg-socrat-border',
            )}
          >
            {createFolder.isPending ? 'Создание...' : 'Создать'}
          </button>
        </div>
      </div>
    </>
  );
}
