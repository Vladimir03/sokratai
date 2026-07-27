// Архивация группы/метки. Удаления групп НЕТ — только мягкий архив
// (FK: занятия group_source_tutor_group_id, ДЗ source_group_id). Последствия
// перечислены явно (решение по каскадам из проработки Дианы 2026-07-27):
// групповой чат скрывается (история в БД остаётся, восстановление вернёт).
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, X } from 'lucide-react';
import { toast } from 'sonner';
import { setTutorGroupArchived } from '@/lib/tutors';
import { invalidateGroupEditorCaches } from '@/components/tutor/groups/groupCaches';
import { pluralizeRu } from '@/lib/pluralizeRu';
import { cn } from '@/lib/utils';

interface ArchiveGroupDialogProps {
  group: { id: string; name: string; is_primary: boolean };
  /** Активных участников — для текста последствий. */
  memberCount: number;
  onClose: () => void;
}

export function ArchiveGroupDialog({ group, memberCount, onClose }: ArchiveGroupDialogProps) {
  const queryClient = useQueryClient();
  const [isPending, setIsPending] = useState(false);
  const busyRef = useRef(false);

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

  const handleConfirm = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setIsPending(true);
    try {
      const res = await setTutorGroupArchived(group.id, true);
      if (!res.ok) {
        toast.error(res.error || 'Не удалось архивировать');
        return;
      }
      await invalidateGroupEditorCaches(queryClient);
      toast.success(
        group.is_primary
          ? `Группа «${group.name}» в архиве`
          : `Метка «${group.name}» в архиве`,
      );
      onClose();
    } finally {
      busyRef.current = false;
      setIsPending(false);
    }
  };

  const membersPhrase = `${memberCount} ${pluralizeRu(memberCount, ['ученик', 'ученика', 'учеников'])}`;

  return (
    <>
      <div className="fixed inset-0 z-[300] bg-black/40 animate-in fade-in-0" onClick={onClose} />

      <div className="fixed left-1/2 top-1/2 z-[301] flex w-[calc(100%-2rem)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white shadow-xl animate-in fade-in-0 zoom-in-95">
        <div className="flex items-center justify-between border-b border-socrat-border px-5 py-4">
          <h3 className="text-base font-semibold">
            {group.is_primary ? 'Архивировать группу' : 'Архивировать метку'}
          </h3>
          <button type="button" onClick={onClose} className="shrink-0 p-1" aria-label="Закрыть">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="px-5 py-5">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-50">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            </div>
            <div className="min-w-0 text-sm text-slate-700">
              <p>
                <span className="font-semibold">&laquo;{group.name}&raquo;</span> уйдёт в архив.
                Что произойдёт:
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-slate-500">
                {group.is_primary ? (
                  <>
                    <li>
                      {memberCount > 0 ? (
                        <>{membersPhrase} станут «Без группы»</>
                      ) : (
                        <>участников нет — никто не потеряет группу</>
                      )}
                    </li>
                    <li>групповой чат скроется из «Чатов» — история сохранится и вернётся при восстановлении</li>
                    <li>прошедшие занятия и оплаты не изменятся</li>
                    <li>будущие групповые занятия останутся в расписании</li>
                  </>
                ) : (
                  <li>
                    {memberCount > 0 ? (
                      <>метка снимется с {membersPhrase}</>
                    ) : (
                      <>метка ни на ком не стоит — ничего не изменится</>
                    )}
                  </li>
                )}
                <li>
                  восстановить можно в «Группы и метки» → Архив
                  {memberCount > 0 ? ' (состав придётся собрать заново)' : ''}
                </li>
              </ul>
            </div>
          </div>
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
            onClick={() => void handleConfirm()}
            disabled={isPending}
            className={cn(
              'rounded-lg px-4 py-2 text-[13px] font-semibold text-white',
              isPending ? 'cursor-default bg-red-300' : 'bg-red-600 hover:bg-red-700',
            )}
          >
            {isPending ? 'Архивация...' : 'В архив'}
          </button>
        </div>
      </div>
    </>
  );
}
