// Страница папки ДЗ (folder-first, запрос Елены 2026-06-17). Тот же tutor-layout shell,
// что и TutorHomework (НЕ KnowledgeBaseFrame — он KB-специфичный). Список заданий папки
// фильтруется КЛИЕНТСКИ по folder_id из того же useTutorHomeworkAssignments кэша.
import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Folder, Pencil, Trash2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TutorDataStatus } from '@/components/tutor/TutorDataStatus';
import { useTutorHomeworkAssignments } from '@/hooks/useTutorHomework';
import {
  useHomeworkFolders,
  useDeleteHomeworkFolder,
} from '@/hooks/useHomeworkFolders';
import { cn } from '@/lib/utils';
import type {
  HomeworkAssignmentsFilter,
  TutorHomeworkAssignmentListItem,
} from '@/lib/tutorHomeworkApi';
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
import { RenameHomeworkFolderModal } from '@/components/tutor/homework/RenameHomeworkFolderModal';
import { DeleteHomeworkFolderDialog } from '@/components/tutor/homework/DeleteHomeworkFolderDialog';
import { MoveHomeworkAssignmentToFolderModal } from '@/components/tutor/homework/MoveHomeworkAssignmentToFolderModal';

export default function HomeworkFolderPage() {
  const { folderId } = useParams<{ folderId: string }>();
  const navigate = useNavigate();

  const [filter, setFilter] = useState<HomeworkAssignmentsFilter>('all');
  const [sortKey, setSortKey] = useState<HomeworkSortKey>('created_desc');
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [movingAssignment, setMovingAssignment] = useState<TutorHomeworkAssignmentListItem | null>(null);

  const { folders, loading: foldersLoading, isFetching: foldersFetching } = useHomeworkFolders();
  const deleteFolder = useDeleteHomeworkFolder();

  const folder = useMemo(
    () => folders.find((f) => f.id === folderId) ?? null,
    [folders, folderId],
  );

  const {
    assignments,
    loading,
    error,
    refetch,
    isFetching,
  } = useTutorHomeworkAssignments({ filter, sortKey });

  const folderAssignments = useMemo(
    () => sortAssignments(assignments.filter((a) => a.folder_id === folderId), sortKey),
    [assignments, folderId, sortKey],
  );

  const handleRetry = useCallback(() => { refetch(); }, [refetch]);

  const handleDeleteFolder = useCallback(() => {
    if (!folder) return;
    deleteFolder.mutate(folder.id, {
      onSuccess: () => {
        toast.success('Папка удалена');
        navigate('/tutor/homework');
      },
      onError: () => {
        toast.error('Не удалось удалить папку');
      },
    });
  }, [folder, deleteFolder, navigate]);

  const showSkeleton = loading && assignments.length === 0 && !error;
  // Папка не найдена (удалена/невалидный id) — только после загрузки списка папок
  // И когда нет активного refetch (code review P2: не мигать «не найдена», пока
  // список папок ещё догружается, напр. сразу после создания + навигации).
  const folderMissing = !foldersLoading && !foldersFetching && !folder;

  return (
    <div className="space-y-6">
      {/* Breadcrumb + header */}
      <div className="space-y-3">
        <Link
          to="/tutor/homework"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Домашние задания
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-socrat-folder-bg">
              <Folder className="h-5 w-5 text-socrat-folder" aria-hidden="true" />
            </div>
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {folder ? folder.name : folderMissing ? 'Папка не найдена' : '...'}
            </h1>
          </div>
          {folder && (
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" size="sm" onClick={() => setRenaming(true)}>
                <Pencil className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                <span className="hidden sm:inline">Переименовать</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeleting(true)}
                className="text-red-600 hover:bg-red-50 hover:text-red-700"
              >
                <Trash2 className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                <span className="hidden sm:inline">Удалить</span>
              </Button>
              <Button asChild size="sm">
                <Link to="/tutor/homework/create">
                  <Plus className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Создать ДЗ</span>
                </Link>
              </Button>
            </div>
          )}
        </div>
      </div>

      {folderMissing ? (
        <HomeworkEmptyState filter="all" hasGroupFilter={false} inFolder />
      ) : (
        <>
          <TutorDataStatus criticalError={error} isFetching={isFetching} onRetry={handleRetry} />

          {/* Status filter + sort */}
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

          {/* Content */}
          {showSkeleton ? (
            <HomeworkListSkeleton />
          ) : folderAssignments.length === 0 && !error ? (
            <HomeworkEmptyState filter={filter} hasGroupFilter={false} inFolder />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {folderAssignments.map((item) => (
                <AssignmentCard key={item.id} item={item} onMoveToFolder={setMovingAssignment} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Модалки */}
      {folder && renaming && (
        <RenameHomeworkFolderModal
          folderId={folder.id}
          currentName={folder.name}
          onClose={() => setRenaming(false)}
        />
      )}
      {folder && deleting && (
        <DeleteHomeworkFolderDialog
          folder={folder}
          assignmentCount={folderAssignments.length}
          isPending={deleteFolder.isPending}
          onConfirm={handleDeleteFolder}
          onClose={() => setDeleting(false)}
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
