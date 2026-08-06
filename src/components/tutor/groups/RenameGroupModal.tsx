// Переименование группы/метки (глобальное — новое имя видят все носители)
// + выбор цвета (Волна 1 расписания). Клон RenameHomeworkFolderModal на
// updateTutorGroup. Запрос Егора #39.
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { updateTutorGroup } from '@/lib/tutors';
import { invalidateGroupEditorCaches } from '@/components/tutor/groups/groupCaches';
import { ColorSwatchPicker } from '@/components/tutor/ColorSwatchPicker';
import { cn } from '@/lib/utils';

interface RenameGroupModalProps {
  group: { id: string; name: string; is_primary: boolean; color?: string | null };
  onClose: () => void;
}

export function RenameGroupModal({ group, onClose }: RenameGroupModalProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(group.name);
  const [color, setColor] = useState<string | null>(group.color ?? null);
  const [isPending, setIsPending] = useState(false);
  const busyRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const nameChanged = name.trim().length > 0 && name.trim() !== group.name;
  const colorChanged = color !== (group.color ?? null);
  const canSave = name.trim().length > 0 && (nameChanged || colorChanged);

  const handleSave = async () => {
    if (!canSave || busyRef.current) return;
    busyRef.current = true;
    setIsPending(true);
    try {
      const updated = await updateTutorGroup(group.id, {
        ...(nameChanged ? { name: name.trim() } : null),
        ...(colorChanged ? { color } : null),
      });
      if (!updated) {
        toast.error('Не удалось сохранить');
        return;
      }
      await invalidateGroupEditorCaches(queryClient);
      toast.success(group.is_primary ? 'Группа обновлена' : 'Метка обновлена');
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось сохранить');
    } finally {
      busyRef.current = false;
      setIsPending(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-[300] bg-black/40 animate-in fade-in-0" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-group-title"
        className="fixed left-1/2 top-1/2 z-[301] flex w-[calc(100%-2rem)] max-w-[400px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white shadow-xl animate-in fade-in-0 zoom-in-95">
        <div className="flex items-center justify-between border-b border-socrat-border px-5 py-4">
          <h3 id="rename-group-title" className="text-base font-semibold">
            {group.is_primary ? 'Переименовать группу' : 'Переименовать метку'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-slate-50"
            style={{ touchAction: "manipulation" }}
            aria-label="Закрыть"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="px-5 py-4">
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold text-slate-500">
              Название <span className="text-red-500">*</span>
            </legend>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSave && !isPending) void handleSave();
              }}
              placeholder="Введите название..."
              autoFocus
              className="w-full rounded-lg border border-socrat-border px-3 py-2.5 text-[16px] transition-colors duration-200 placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none"
              style={{ touchAction: 'manipulation' }}
            />
          </fieldset>
          <p className="mt-2 text-xs text-slate-500">
            Название обновится везде: в списке учеников, фильтрах и назначении ДЗ.
          </p>

          <fieldset className="mt-4">
            <legend className="mb-1.5 text-xs font-semibold text-slate-500">Цвет</legend>
            <ColorSwatchPicker value={color} onChange={setColor} />
            {group.is_primary && (
              <p className="mt-1.5 text-xs text-slate-500">
                Занятия группы будут этого цвета в расписании.
              </p>
            )}
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
            onClick={() => void handleSave()}
            disabled={!canSave || isPending}
            className={cn(
              'rounded-lg px-4 py-2 text-[13px] font-semibold text-white',
              canSave && !isPending ? 'bg-socrat-primary' : 'cursor-default bg-socrat-border',
            )}
          >
            {isPending ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </div>
    </>
  );
}
