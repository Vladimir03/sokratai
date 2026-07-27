// Создание группы/метки с нуля (не «изнутри ученика») — запрос Егора #39.
// Паттерн-клон RenameHomeworkFolderModal (z-[300/301], Enter-guard, isPending).
// createTutorGroup сам делает create-or-reuse по имени (инцидент Дианы 2026-07-27).
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Tag, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { createTutorGroup } from '@/lib/tutors';
import { invalidateGroupEditorCaches } from '@/components/tutor/groups/groupCaches';
import { cn } from '@/lib/utils';

interface CreateGroupModalProps {
  /** Предвыбранный тип: 'group' = учебная группа, 'tag' = метка. */
  initialType: 'group' | 'tag';
  onClose: () => void;
  /** Открыть редактор состава сразу после создания (опционально). */
  onCreated?: (group: { id: string; name: string; is_primary: boolean }) => void;
}

export function CreateGroupModal({ initialType, onClose, onCreated }: CreateGroupModalProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [type, setType] = useState<'group' | 'tag'>(initialType);
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
    inputRef.current?.focus();
  }, []);

  const canSave = name.trim().length > 0;

  const handleSave = async () => {
    if (!canSave || busyRef.current) return;
    busyRef.current = true;
    setIsPending(true);
    try {
      const created = await createTutorGroup({
        name: name.trim(),
        is_primary: type === 'group',
      });
      if (!created) {
        toast.error(type === 'group' ? 'Не удалось создать группу' : 'Не удалось создать метку');
        return;
      }
      await invalidateGroupEditorCaches(queryClient);
      toast.success(
        type === 'group'
          ? `Группа «${created.short_name || created.name}» создана`
          : `Метка «${created.short_name || created.name}» создана`,
      );
      onCreated?.({ id: created.id, name: created.name, is_primary: created.is_primary });
      onClose();
    } catch (error) {
      console.error('Error creating group from modal:', error);
      toast.error(error instanceof Error ? error.message : 'Не удалось создать');
    } finally {
      busyRef.current = false;
      setIsPending(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-[300] bg-black/40 animate-in fade-in-0" onClick={onClose} />

      <div className="fixed left-1/2 top-1/2 z-[301] flex w-[calc(100%-2rem)] max-w-[400px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white shadow-xl animate-in fade-in-0 zoom-in-95">
        <div className="flex items-center justify-between border-b border-socrat-border px-5 py-4">
          <h3 className="text-base font-semibold">
            {type === 'group' ? 'Новая учебная группа' : 'Новая метка'}
          </h3>
          <button type="button" onClick={onClose} className="shrink-0 p-1" aria-label="Закрыть">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { key: 'group' as const, label: 'Учебная группа', Icon: Users },
                { key: 'tag' as const, label: 'Метка', Icon: Tag },
              ]
            ).map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setType(key)}
                className={cn(
                  'flex min-h-[44px] items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                  type === key
                    ? 'border-accent bg-accent/5 text-accent'
                    : 'border-socrat-border text-slate-600 hover:bg-slate-50',
                )}
                style={{ touchAction: 'manipulation' }}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            {type === 'group'
              ? 'У ученика одна учебная группа: занятия, групповой чат, секция в списке.'
              : 'Меток у ученика может быть сколько угодно — для фильтров и массовой выдачи ДЗ.'}
          </p>

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
              placeholder={type === 'group' ? '11 класс, 11Д…' : '#интенсив, сочинения…'}
              className="w-full rounded-lg border border-socrat-border px-3 py-2.5 text-[16px] transition-colors duration-200 placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none"
              style={{ touchAction: 'manipulation' }}
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
            onClick={() => void handleSave()}
            disabled={!canSave || isPending}
            className={cn(
              'rounded-lg px-4 py-2 text-[13px] font-semibold text-white',
              canSave && !isPending ? 'bg-socrat-primary' : 'cursor-default bg-socrat-border',
            )}
          >
            {isPending ? 'Создание...' : 'Создать'}
          </button>
        </div>
      </div>
    </>
  );
}
