// «Группы и метки» — единая точка управления (запрос Егора #39): создать с нуля,
// переименовать, состав, архив/восстановление. Открывается из «Все ученики».
// Модалки действий хостит родитель (TutorStudents) — те же инстансы обслуживают
// kebab на заголовках секций списка.
import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Link2, Pencil, Plus, Tag, Users } from 'lucide-react';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useTutorGroups } from '@/hooks/useTutor';
import { getTutorGroups, setTutorGroupArchived } from '@/lib/tutors';
import { invalidateGroupEditorCaches } from '@/components/tutor/groups/groupCaches';
import { pluralizeRu } from '@/lib/pluralizeRu';
import type { TutorGroup } from '@/types/tutor';

export interface ManageGroupsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (type: 'group' | 'tag') => void;
  onRename: (group: TutorGroup) => void;
  onMembers: (group: TutorGroup) => void;
  onArchive: (group: TutorGroup, memberCount: number) => void;
  /** Ссылка саморегистрации — только учебные группы. */
  onInviteLink: (group: TutorGroup) => void;
}

export function ManageGroupsSheet({
  open,
  onOpenChange,
  onCreate,
  onRename,
  onMembers,
  onArchive,
  onInviteLink,
}: ManageGroupsSheetProps) {
  const queryClient = useQueryClient();
  const { groups, loading } = useTutorGroups(open);

  // Архив: все группы (включая неактивные) — отдельный подключ под общим
  // префиксом ['tutor','groups'] (prefix-инвалидации накрывают оба).
  const archivedQuery = useQuery({
    queryKey: ['tutor', 'groups', 'all'],
    queryFn: () => getTutorGroups(false),
    enabled: open,
    staleTime: 30_000,
  });
  const archivedGroups = useMemo(
    () => (archivedQuery.data ?? []).filter((g) => !g.is_active),
    [archivedQuery.data],
  );

  const primaryGroups = useMemo(() => groups.filter((g) => g.is_primary), [groups]);
  const tagGroups = useMemo(() => groups.filter((g) => !g.is_primary), [groups]);

  const activeMemberCount = (g: (typeof groups)[number]) =>
    g.members.filter((m) => m.is_active).length;

  const handleRestore = async (group: TutorGroup) => {
    const res = await setTutorGroupArchived(group.id, false);
    if (!res.ok) {
      toast.error(res.error || 'Не удалось восстановить');
      return;
    }
    await invalidateGroupEditorCaches(queryClient);
    toast.success(
      group.is_primary
        ? `Группа «${group.name}» восстановлена. Состав нужно собрать заново.`
        : `Метка «${group.name}» восстановлена.`,
    );
  };

  const renderRow = (g: (typeof groups)[number]) => {
    const count = activeMemberCount(g);
    return (
      <li
        key={g.id}
        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5"
      >
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: g.color || '#94a3b8' }}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-800">
            {g.short_name?.trim() || g.name}
          </p>
          <p className="text-xs text-slate-400">
            {count} {pluralizeRu(count, ['ученик', 'ученика', 'учеников'])}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {g.is_primary && (
            <button
              type="button"
              onClick={() => onInviteLink(g)}
              aria-label={`Ссылка в группу ${g.name}`}
              className="rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-accent"
              style={{ touchAction: 'manipulation' }}
            >
              <Link2 className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onRename(g)}
            aria-label={`Переименовать ${g.name}`}
            className="rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            style={{ touchAction: 'manipulation' }}
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onMembers(g)}
            aria-label={`Состав ${g.name}`}
            className="rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            style={{ touchAction: 'manipulation' }}
          >
            <Users className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onArchive(g, count)}
            aria-label={`Архивировать ${g.name}`}
            className="rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-red-600"
            style={{ touchAction: 'manipulation' }}
          >
            <Archive className="h-4 w-4" />
          </button>
        </div>
      </li>
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="pb-4 text-left">
          <SheetTitle>Группы и метки</SheetTitle>
          <SheetDescription>
            Учебная группа — одна на ученика (занятия, чат). Метки — сколько угодно, для
            фильтров и выдачи ДЗ.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6">
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                <Users className="h-4 w-4 text-slate-400" aria-hidden="true" />
                Учебные группы
              </h3>
              <Button variant="outline" size="sm" onClick={() => onCreate('group')}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Группа
              </Button>
            </div>
            {loading ? (
              <p className="py-3 text-sm text-muted-foreground">Загрузка…</p>
            ) : primaryGroups.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-muted-foreground">
                Учебных групп пока нет
              </p>
            ) : (
              <ul className="space-y-2">{primaryGroups.map(renderRow)}</ul>
            )}
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                <Tag className="h-4 w-4 text-slate-400" aria-hidden="true" />
                Метки
              </h3>
              <Button variant="outline" size="sm" onClick={() => onCreate('tag')}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Метка
              </Button>
            </div>
            {loading ? (
              <p className="py-3 text-sm text-muted-foreground">Загрузка…</p>
            ) : tagGroups.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-muted-foreground">
                Меток пока нет
              </p>
            ) : (
              <ul className="space-y-2">{tagGroups.map(renderRow)}</ul>
            )}
          </section>

          {archivedGroups.length > 0 && (
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-500">
                <Archive className="h-4 w-4 text-slate-400" aria-hidden="true" />
                Архив
              </h3>
              <ul className="space-y-2">
                {archivedGroups.map((g) => (
                  <li
                    key={g.id}
                    className="flex items-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-slate-500">
                        {g.short_name?.trim() || g.name}
                      </p>
                      <p className="text-xs text-slate-400">
                        {g.is_primary ? 'Учебная группа' : 'Метка'}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-slate-500"
                      onClick={() => void handleRestore(g)}
                    >
                      <ArchiveRestore className="mr-1 h-3.5 w-3.5" /> Восстановить
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
