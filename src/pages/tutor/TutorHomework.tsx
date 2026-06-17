import { useState, useCallback, useMemo, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Plus, BookOpen, Library, FolderPlus } from 'lucide-react';
import { TutorDataStatus } from '@/components/tutor/TutorDataStatus';
import { useTutorHomeworkAssignments } from '@/hooks/useTutorHomework';
import { useTutor, useTutorGroups } from '@/hooks/useTutor';
import {
  useHomeworkFolders,
  useDeleteHomeworkFolder,
} from '@/hooks/useHomeworkFolders';
import { trackGuidedHomeworkEvent } from '@/lib/homeworkTelemetry';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type {
  HomeworkAssignmentsFilter,
  TutorHomeworkAssignmentListItem,
} from '@/lib/tutorHomeworkApi';
import { FolderCard } from '@/components/kb/FolderCard';
import { AssignmentCard } from '@/components/tutor/homework/AssignmentCard';
import {
  HomeworkListSkeleton,
  HomeworkEmptyState,
} from '@/components/tutor/homework/HomeworkListStates';
import {
  FILTER_TABS,
  SORT_OPTIONS,
  sortAssignments,
  type HomeworkSortKey,
} from '@/components/tutor/homework/homeworkListShared';
import { CreateHomeworkFolderModal } from '@/components/tutor/homework/CreateHomeworkFolderModal';
import { RenameHomeworkFolderModal } from '@/components/tutor/homework/RenameHomeworkFolderModal';
import { DeleteHomeworkFolderDialog } from '@/components/tutor/homework/DeleteHomeworkFolderDialog';
import { MoveHomeworkAssignmentToFolderModal } from '@/components/tutor/homework/MoveHomeworkAssignmentToFolderModal';

// Слово для счётчика заданий в карточке папки (FolderCard generalize, 2026-06-17).
const ASSIGNMENT_WORD: [string, string, string] = ['задание', 'задания', 'заданий'];

// ─── Main Content ────────────────────────────────────────────────────────────

function TutorHomeworkContent() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<HomeworkAssignmentsFilter>('all');
  const [sortKey, setSortKey] = useState<HomeworkSortKey>('created_desc');
  const [groupId, setGroupId] = useState<string | null>(null);
  const { tutor } = useTutor();
  const miniGroupsEnabled = Boolean(tutor?.mini_groups_enabled);
  const { groups, loading: groupsLoading } = useTutorGroups(miniGroupsEnabled);

  // Папки ДЗ (homework_folders) — запрос Елены 2026-06-17.
  const { folders } = useHomeworkFolders();
  const deleteFolder = useDeleteHomeworkFolder();

  // Модалки папок / перемещения.
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<{ id: string; name: string } | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<{ id: string; name: string } | null>(null);
  const [movingAssignment, setMovingAssignment] = useState<TutorHomeworkAssignmentListItem | null>(null);

  const {
    assignments,
    loading,
    error,
    refetch,
    isFetching,
  } = useTutorHomeworkAssignments({
    filter,
    groupId,
    sortKey,
  });

  const showGroupFilter = miniGroupsEnabled && groups.length > 0;

  useEffect(() => {
    if (groupsLoading || !groupId) return;
    if (groups.some((group) => group.id === groupId)) return;
    setGroupId(null);
  }, [groups, groupsLoading, groupId]);

  const sortedAssignments = useMemo(
    () => sortAssignments(assignments, sortKey),
    [assignments, sortKey],
  );

  // Клиентский split: «без папки» (folder_id == null) + счётчики по папкам.
  // Счётчики отражают текущий статус/группа-фильтр (на дефолте «Все» = полные).
  const unfiledAssignments = useMemo(
    () => sortedAssignments.filter((a) => !a.folder_id),
    [sortedAssignments],
  );
  const folderCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of assignments) {
      if (a.folder_id) map.set(a.folder_id, (map.get(a.folder_id) ?? 0) + 1);
    }
    return map;
  }, [assignments]);

  const hasData = assignments.length > 0;
  const showSkeleton = loading && !hasData && !error;

  const handleRetry = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleGroupFilterChange = useCallback((nextValue: string) => {
    const nextGroupId = nextValue === 'all' ? null : nextValue;
    setGroupId(nextGroupId);
    trackGuidedHomeworkEvent('homework_filter_by_group', {
      group_id: nextGroupId,
    });
  }, []);

  const handleDeleteFolder = useCallback(() => {
    if (!deletingFolder) return;
    deleteFolder.mutate(deletingFolder.id, {
      onSuccess: () => {
        toast.success('Папка удалена');
        setDeletingFolder(null);
      },
      onError: () => {
        toast.error('Не удалось удалить папку');
      },
    });
  }, [deletingFolder, deleteFolder]);

  const hasFolders = folders.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <BookOpen className="h-6 w-6" />
            Домашние задания
          </h1>
          <p className="text-muted-foreground text-sm mt-1.5">
            Управляйте домашками и отслеживайте прогресс учеников
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setShowCreateFolder(true)} className="group">
            <FolderPlus
              className="h-4 w-4 mr-2 transition-transform duration-200 ease-out group-hover:-translate-y-0.5"
              aria-hidden="true"
            />
            Папка
          </Button>
          <Button variant="outline" asChild className="group">
            <Link to="/tutor/homework/templates">
              <Library
                className="h-4 w-4 mr-2 transition-transform duration-200 ease-out group-hover:-translate-x-0.5"
                aria-hidden="true"
              />
              Шаблоны
            </Link>
          </Button>
          <Button asChild className="group">
            <Link to="/tutor/homework/create">
              <Plus
                className="h-4 w-4 mr-2 transition-transform duration-300 ease-out group-hover:rotate-90"
                aria-hidden="true"
              />
              Создать ДЗ
            </Link>
          </Button>
        </div>
      </div>

      {/* Error / Recovery status */}
      <TutorDataStatus
        criticalError={error}
        isFetching={isFetching}
        onRetry={handleRetry}
      />

      {/* Filter group + Sort. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div
          role="group"
          aria-label="Фильтр домашних заданий по статусу"
          className="flex gap-1 border-b overflow-x-auto"
        >
          {FILTER_TABS.map((tab) => {
            const isActive = filter === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => setFilter(tab.value)}
                aria-pressed={isActive}
                className={cn(
                  'min-h-[44px] px-4 text-sm font-medium border-b-2 transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:rounded-sm',
                  isActive
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30',
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {showGroupFilter && (
            <select
              value={groupId ?? 'all'}
              onChange={(e) => handleGroupFilterChange(e.target.value)}
              aria-label="Фильтр домашних заданий по группе"
              className="min-h-[44px] w-full rounded-lg border border-input bg-background px-3 py-1.5 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 sm:w-auto"
            >
              <option value="all">Все группы</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.short_name?.trim() || group.name}
                </option>
              ))}
            </select>
          )}
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as HomeworkSortKey)}
            aria-label="Сортировка домашних заданий"
            className="min-h-[44px] w-full rounded-lg border border-input bg-background px-3 py-1.5 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 sm:w-auto"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Папки (если есть) */}
      {hasFolders && (
        <section className="space-y-2.5">
          <h2 className="text-sm font-semibold text-muted-foreground">Папки</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {folders.map((f) => (
              <FolderCard
                key={f.id}
                folder={{ id: f.id, name: f.name }}
                taskCount={folderCounts.get(f.id) ?? 0}
                taskWord={ASSIGNMENT_WORD}
                showChildCount={false}
                onClick={() => navigate(`/tutor/homework/folder/${f.id}`)}
                onRename={() => setRenamingFolder({ id: f.id, name: f.name })}
                onDelete={() => setDeletingFolder({ id: f.id, name: f.name })}
              />
            ))}
          </div>
        </section>
      )}

      {/* Задания «без папки» / весь список */}
      {showSkeleton ? (
        <HomeworkListSkeleton />
      ) : !hasData && !error ? (
        <HomeworkEmptyState filter={filter} hasGroupFilter={groupId !== null} />
      ) : (
        <section className="space-y-2.5">
          {hasFolders && (
            <h2 className="text-sm font-semibold text-muted-foreground">Без папки</h2>
          )}
          {unfiledAssignments.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {unfiledAssignments.map((item) => (
                <AssignmentCard
                  key={item.id}
                  item={item}
                  onMoveToFolder={setMovingAssignment}
                />
              ))}
            </div>
          ) : hasFolders ? (
            <p className="text-sm text-muted-foreground">Все задания разложены по папкам.</p>
          ) : null}
        </section>
      )}

      {/* Модалки */}
      {showCreateFolder && (
        <CreateHomeworkFolderModal
          onClose={() => setShowCreateFolder(false)}
          onCreated={(folder) => navigate(`/tutor/homework/folder/${folder.id}`)}
        />
      )}
      {renamingFolder && (
        <RenameHomeworkFolderModal
          folderId={renamingFolder.id}
          currentName={renamingFolder.name}
          onClose={() => setRenamingFolder(null)}
        />
      )}
      {deletingFolder && (
        <DeleteHomeworkFolderDialog
          folder={deletingFolder}
          assignmentCount={folderCounts.get(deletingFolder.id) ?? 0}
          isPending={deleteFolder.isPending}
          onConfirm={handleDeleteFolder}
          onClose={() => setDeletingFolder(null)}
        />
      )}
      {movingAssignment && (
        <MoveHomeworkAssignmentToFolderModal
          assignment={{
            id: movingAssignment.id,
            title: movingAssignment.title,
            folder_id: movingAssignment.folder_id ?? null,
          }}
          onClose={() => setMovingAssignment(null)}
        />
      )}
    </div>
  );
}

// ─── Export ──────────────────────────────────────────────────────────────────

export default function TutorHomework() {
  return <TutorHomeworkContent />;
}
