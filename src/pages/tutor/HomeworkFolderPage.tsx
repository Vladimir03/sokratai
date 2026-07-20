// Страница папки ДЗ (folder-first, запрос Елены 2026-06-17). Тот же tutor-layout shell,
// что и TutorHomework (НЕ KnowledgeBaseFrame — он KB-специфичный). Список заданий папки
// фильтруется КЛИЕНТСКИ по folder_id из того же useTutorHomeworkAssignments кэша.
import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ChevronRight, Folder, FolderInput, FolderPlus, Pencil, Trash2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TutorDataStatus } from '@/components/tutor/TutorDataStatus';
import { useTutorHomeworkAssignments } from '@/hooks/useTutorHomework';
import {
  useHomeworkFolders,
  useDeleteHomeworkFolder,
  useMoveAssignmentToFolder,
  useMoveHomeworkFolder,
} from '@/hooks/useHomeworkFolders';
import {
  buildFolderBreadcrumbs,
  collectDescendantIds,
  countDirectChildren,
  recursiveAssignmentCounts,
} from '@/lib/homeworkFolderTree';
import type { HomeworkFolder } from '@/lib/tutorHomeworkFoldersApi';
import { cn } from '@/lib/utils';
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
import { MoveHomeworkFolderModal } from '@/components/tutor/homework/MoveHomeworkFolderModal';
import { HwDraggable, HwFolderDropZone } from '@/components/tutor/homework/homeworkDnd';

const ASSIGNMENT_WORD: [string, string, string] = ['задание', 'задания', 'заданий'];

export default function HomeworkFolderPage() {
  const { folderId } = useParams<{ folderId: string }>();
  const navigate = useNavigate();

  const [filter, setFilter] = useState<HomeworkAssignmentsFilter>('all');
  const [sortKey, setSortKey] = useState<HomeworkSortKey>('created_desc');
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [movingSelf, setMovingSelf] = useState(false);
  const [creatingSubfolder, setCreatingSubfolder] = useState(false);
  const [movingAssignment, setMovingAssignment] = useState<TutorHomeworkAssignmentListItem | null>(null);
  // Модалки подпапок этой страницы (rename/delete/move карточек «Подпапки»).
  const [renamingChild, setRenamingChild] = useState<{ id: string; name: string } | null>(null);
  const [deletingChild, setDeletingChild] = useState<{ id: string; name: string } | null>(null);
  const [movingChild, setMovingChild] = useState<HomeworkFolder | null>(null);

  const { folders, loading: foldersLoading, isFetching: foldersFetching } = useHomeworkFolders();
  const deleteFolder = useDeleteHomeworkFolder();
  const moveAssignment = useMoveAssignmentToFolder();
  const moveFolder = useMoveHomeworkFolder();

  const folder = useMemo(
    () => folders.find((f) => f.id === folderId) ?? null,
    [folders, folderId],
  );

  // Вложенность (2026-07-20): крошки + прямые подпапки + счётчики (семантика KB).
  const breadcrumbs = useMemo(
    () => (folderId ? buildFolderBreadcrumbs(folders, folderId) : []),
    [folders, folderId],
  );
  const childFolders = useMemo(
    () => folders.filter((f) => f.parent_id === folderId),
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
  const folderCounts = useMemo(
    () => recursiveAssignmentCounts(folders, assignments),
    [folders, assignments],
  );
  const childCounts = useMemo(() => countDirectChildren(folders), [folders]);
  // Subtree-счётчики для диалогов удаления (текущая папка И подпапки со страницы).
  const subtreeCounts = useCallback(
    (rootId: string) => {
      const ids = collectDescendantIds(folders, rootId);
      return {
        subfolderCount: ids.size - 1,
        assignmentCount: assignments.filter((a) => a.folder_id && ids.has(a.folder_id)).length,
      };
    },
    [folders, assignments],
  );

  const handleRetry = useCallback(() => { refetch(); }, [refetch]);

  const handleDeleteFolder = useCallback(() => {
    if (!folder) return;
    const parentId = folder.parent_id;
    deleteFolder.mutate(folder.id, {
      onSuccess: () => {
        toast.success('Папка удалена');
        navigate(parentId ? `/tutor/homework/folder/${parentId}` : '/tutor/homework');
      },
      onError: () => {
        toast.error('Не удалось удалить папку');
      },
    });
  }, [folder, deleteFolder, navigate]);

  const handleDeleteChild = useCallback(() => {
    if (!deletingChild) return;
    deleteFolder.mutate(deletingChild.id, {
      onSuccess: () => {
        toast.success('Папка удалена');
        setDeletingChild(null);
      },
      onError: () => {
        toast.error('Не удалось удалить папку');
      },
    });
  }, [deletingChild, deleteFolder]);

  // DnD (desktop-энхансмент): дроп на подпапку/крошку.
  const handleDropAssignment = useCallback(
    (assignmentId: string, targetFolderId: string | null) => {
      const a = assignments.find((x) => x.id === assignmentId);
      if (a && (a.folder_id ?? null) === targetFolderId) return;
      moveAssignment.mutate(
        { assignmentId, folderId: targetFolderId },
        {
          onSuccess: () =>
            toast.success(targetFolderId ? 'ДЗ перемещено в папку' : 'ДЗ убрано из папки'),
          onError: () => toast.error('Не удалось переместить ДЗ'),
        },
      );
    },
    [assignments, moveAssignment],
  );
  const handleDropFolder = useCallback(
    (droppedFolderId: string, targetFolderId: string | null) => {
      const f = folders.find((x) => x.id === droppedFolderId);
      if (f && (f.parent_id ?? null) === targetFolderId) return;
      moveFolder.mutate(
        { folderId: droppedFolderId, parentId: targetFolderId },
        {
          onSuccess: () => toast.success('Папка перемещена'),
          onError: (err) =>
            toast.error(err instanceof Error && err.message ? err.message : 'Не удалось переместить папку'),
        },
      );
    },
    [folders, moveFolder],
  );

  const showSkeleton = loading && assignments.length === 0 && !error;
  // Папка не найдена (удалена/невалидный id) — только после загрузки списка папок
  // И когда нет активного refetch (code review P2: не мигать «не найдена», пока
  // список папок ещё догружается, напр. сразу после создания + навигации).
  const folderMissing = !foldersLoading && !foldersFetching && !folder;

  return (
    <div className="space-y-6">
      {/* Breadcrumbs (вложенность 2026-07-20, KB-стиль) + header. Крошки-предки
          и корень — drop-зоны (вынести ДЗ/папку на уровень выше). */}
      <div className="space-y-3">
        <nav aria-label="Хлебные крошки" className="flex flex-wrap items-center gap-1 text-sm">
          <HwFolderDropZone
            folderId={null}
            folders={folders}
            onDropAssignment={handleDropAssignment}
            onDropFolder={handleDropFolder}
            className="inline-flex"
          >
            <Link
              to="/tutor/homework"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Домашние задания
            </Link>
          </HwFolderDropZone>
          {breadcrumbs.map((crumb, i) => {
            const isLast = i === breadcrumbs.length - 1;
            return (
              <div key={crumb.id} className="flex items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5 text-slate-300" aria-hidden="true" />
                {isLast ? (
                  <span className="font-medium text-foreground">{crumb.name}</span>
                ) : (
                  <HwFolderDropZone
                    folderId={crumb.id}
                    folders={folders}
                    onDropAssignment={handleDropAssignment}
                    onDropFolder={handleDropFolder}
                    className="inline-flex"
                  >
                    <Link
                      to={`/tutor/homework/folder/${crumb.id}`}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {crumb.name}
                    </Link>
                  </HwFolderDropZone>
                )}
              </div>
            );
          })}
        </nav>
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
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setCreatingSubfolder(true)}>
                <FolderPlus className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                <span className="hidden sm:inline">Подпапка</span>
              </Button>
              <Button variant="outline" size="sm" onClick={() => setRenaming(true)}>
                <Pencil className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                <span className="hidden sm:inline">Переименовать</span>
              </Button>
              <Button variant="outline" size="sm" onClick={() => setMovingSelf(true)}>
                <FolderInput className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                <span className="hidden sm:inline">Переместить</span>
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
                {/* Передаём id папки → конструктор привяжет новое ДЗ к ней
                    (баг Елены 2026-07-13: раньше уходило в «Без папки»). */}
                <Link to={`/tutor/homework/create?folder=${folder.id}`}>
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

          {/* Подпапки (вложенность 2026-07-20; зеркало KB FolderPage). */}
          {childFolders.length > 0 && (
            <section className="space-y-2.5">
              <h2 className="text-sm font-semibold text-muted-foreground">Подпапки</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {childFolders.map((f) => (
                  <HwFolderDropZone
                    key={f.id}
                    folderId={f.id}
                    folders={folders}
                    onDropAssignment={handleDropAssignment}
                    onDropFolder={handleDropFolder}
                  >
                    <HwDraggable payload={{ type: 'folder', id: f.id }}>
                      <FolderCard
                        folder={{ id: f.id, name: f.name }}
                        childCount={childCounts.get(f.id) ?? 0}
                        taskCount={folderCounts.get(f.id) ?? 0}
                        taskWord={ASSIGNMENT_WORD}
                        showChildCount={true}
                        onClick={() => navigate(`/tutor/homework/folder/${f.id}`)}
                        onRename={() => setRenamingChild({ id: f.id, name: f.name })}
                        onMove={() => setMovingChild(f)}
                        onDelete={() => setDeletingChild({ id: f.id, name: f.name })}
                      />
                    </HwDraggable>
                  </HwFolderDropZone>
                ))}
              </div>
            </section>
          )}

          {/* Content — задания ТОЛЬКО этой папки (прямые, зеркало KB). */}
          {showSkeleton ? (
            <HomeworkListSkeleton />
          ) : folderAssignments.length === 0 && !error ? (
            childFolders.length === 0 ? (
              <HomeworkEmptyState filter={filter} hasGroupFilter={false} inFolder />
            ) : (
              <p className="text-sm text-muted-foreground">
                Заданий прямо в этой папке нет — они лежат в подпапках.
              </p>
            )
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {folderAssignments.map((item) => (
                <HwDraggable key={item.id} payload={{ type: 'assignment', id: item.id }}>
                  <AssignmentCard item={item} onMoveToFolder={setMovingAssignment} />
                </HwDraggable>
              ))}
            </div>
          )}
        </>
      )}

      {/* Модалки */}
      {folder && creatingSubfolder && (
        <CreateHomeworkFolderModal
          parentId={folder.id}
          onClose={() => setCreatingSubfolder(false)}
          onCreated={(created) => navigate(`/tutor/homework/folder/${created.id}`)}
        />
      )}
      {folder && renaming && (
        <RenameHomeworkFolderModal
          folderId={folder.id}
          currentName={folder.name}
          onClose={() => setRenaming(false)}
        />
      )}
      {folder && movingSelf && (
        <MoveHomeworkFolderModal folder={folder} onClose={() => setMovingSelf(false)} />
      )}
      {folder && deleting && (
        <DeleteHomeworkFolderDialog
          folder={folder}
          assignmentCount={subtreeCounts(folder.id).assignmentCount}
          subfolderCount={subtreeCounts(folder.id).subfolderCount}
          isPending={deleteFolder.isPending}
          onConfirm={handleDeleteFolder}
          onClose={() => setDeleting(false)}
        />
      )}
      {renamingChild && (
        <RenameHomeworkFolderModal
          folderId={renamingChild.id}
          currentName={renamingChild.name}
          onClose={() => setRenamingChild(null)}
        />
      )}
      {movingChild && (
        <MoveHomeworkFolderModal folder={movingChild} onClose={() => setMovingChild(null)} />
      )}
      {deletingChild && (
        <DeleteHomeworkFolderDialog
          folder={deletingChild}
          assignmentCount={subtreeCounts(deletingChild.id).assignmentCount}
          subfolderCount={subtreeCounts(deletingChild.id).subfolderCount}
          isPending={deleteFolder.isPending}
          onConfirm={handleDeleteChild}
          onClose={() => setDeletingChild(null)}
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
