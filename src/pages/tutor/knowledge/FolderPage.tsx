import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, Folder, FolderPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import TutorGuard from '@/components/TutorGuard';
import { CreateFolderModal } from '@/components/kb/CreateFolderModal';
import { CreateTaskModal } from '@/components/kb/CreateTaskModal';
import { DeleteFolderDialog } from '@/components/kb/DeleteFolderDialog';
import { EditTaskModal } from '@/components/kb/EditTaskModal';
import { FolderCard } from '@/components/kb/FolderCard';
import { MoveToFolderModal } from '@/components/kb/MoveToFolderModal';
import { RenameFolderModal } from '@/components/kb/RenameFolderModal';
import { KBStatusCard } from '@/components/kb/KBStatusCard';
import { KnowledgeBaseFrame } from '@/components/kb/KnowledgeBaseFrame';
import { TaskCard } from '@/components/kb/TaskCard';
import { TutorLayout } from '@/components/tutor/TutorLayout';
import { useDeleteFolder, useFolder } from '@/hooks/useFolders';
import { useDeleteTask } from '@/hooks/useKnowledgeBase';
import { useIsModerator } from '@/hooks/useIsModerator';
import { parseAttachmentUrls } from '@/lib/kbApi';
import { useHWDraftStore } from '@/stores/hwDraftStore';
import type { KBTask } from '@/types/kb';

function FolderContent() {
  const { folderId } = useParams<{ folderId: string }>();
  const navigate = useNavigate();
  const { folder, children, tasks, breadcrumbs, loading, error, refetch, isFetching } = useFolder(folderId);

  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [editingTask, setEditingTask] = useState<KBTask | null>(null);
  const [movingTask, setMovingTask] = useState<KBTask | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<{ id: string; name: string } | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<{ id: string; name: string } | null>(null);
  const { addTask, hasTask } = useHWDraftStore();
  const deleteTask = useDeleteTask();
  const deleteFolder = useDeleteFolder();
  const { isModerator } = useIsModerator();

  const handleAddToHW = (task: KBTask) => {
    if (hasTask(task.id)) {
      toast.info('Задача уже в ДЗ.');
      return;
    }
    addTask(task);
    const imageCount = parseAttachmentUrls(task.attachment_url).length;
    if (imageCount > 1) {
      toast.success(`Задача добавлена в ДЗ (в ДЗ уйдёт первое фото из ${imageCount})`);
    } else {
      toast.success('Задача добавлена в ДЗ');
    }
  };

  return (
    <TutorLayout>
      <KnowledgeBaseFrame>
        <div className="space-y-7">
          <KBStatusCard error={error} isFetching={isFetching} onRetry={refetch} />

          {loading ? (
            <div className="space-y-3">
              <div className="h-5 w-64 animate-pulse rounded bg-white/80" />
              <div className="h-10 w-48 animate-pulse rounded-lg bg-white/80" />
              <div className="h-[82px] animate-pulse rounded-[22px] bg-white/80" />
              <div className="h-[110px] animate-pulse rounded-[22px] bg-white/80" />
            </div>
          ) : null}

          {folder ? (
            <>
              <nav className="flex flex-wrap items-center gap-1.5 text-sm">
                <button
                  type="button"
                  onClick={() => navigate('/tutor/knowledge?tab=mybase')}
                  className="rounded-md px-1.5 py-1 font-medium text-socrat-primary transition-colors duration-200 hover:text-socrat-primary-dark"
                >
                  Моя база
                </button>

                {breadcrumbs.map((crumb, index) => {
                  const isLast = index === breadcrumbs.length - 1;
                  return (
                    <div key={crumb.id} className="flex items-center gap-1.5">
                      <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                      <button
                        type="button"
                        disabled={isLast}
                        onClick={() => {
                          if (!isLast) {
                            navigate(`/tutor/knowledge/folder/${crumb.id}`);
                          }
                        }}
                        className={
                          isLast
                            ? 'rounded-md px-1.5 py-1 font-semibold text-slate-950'
                            : 'rounded-md px-1.5 py-1 font-medium text-socrat-primary transition-colors duration-200 hover:text-socrat-primary-dark'
                        }
                      >
                        {crumb.name}
                      </button>
                    </div>
                  );
                })}
              </nav>

              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-2xl font-bold text-foreground">
                    {folder.name}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setRenamingFolder({ id: folder.id, name: folder.name })}
                    className="rounded-lg p-1.5 text-slate-400 transition-colors duration-200 hover:bg-slate-100 hover:text-socrat-primary"
                    aria-label="Переименовать папку"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletingFolder({ id: folder.id, name: folder.name })}
                    className="rounded-lg p-1.5 text-slate-400 transition-colors duration-200 hover:bg-red-50 hover:text-red-500"
                    aria-label="Удалить папку"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateFolder(true)}
                    className="inline-flex items-center gap-2 rounded-xl border border-socrat-border bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 shadow-sm transition-all duration-200 hover:border-socrat-folder/30 hover:text-socrat-folder"
                  >
                    <FolderPlus className="h-4 w-4" />
                    Подпапка
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCreateTask(true)}
                    className="inline-flex items-center gap-2 rounded-xl bg-socrat-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-socrat-primary-dark"
                  >
                    <Plus className="h-4 w-4" />
                    Задача
                  </button>
                </div>
              </div>

              {children.length > 0 ? (
                <section>
                  <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Папки
                  </div>
                  <div className="flex flex-col gap-2.5">
                    {children.map((subfolder) => (
                      <FolderCard
                        key={subfolder.id}
                        folder={subfolder}
                        childCount={subfolder.child_count}
                        taskCount={subfolder.task_count}
                        onClick={() => navigate(`/tutor/knowledge/folder/${subfolder.id}`)}
                        onRename={() => setRenamingFolder({ id: subfolder.id, name: subfolder.name })}
                        onDelete={() => setDeletingFolder({
                          id: subfolder.id,
                          name: subfolder.name,
                        })}
                      />
                    ))}
                  </div>
                </section>
              ) : null}

              {tasks.length > 0 ? (
                <section>
                  <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Задачи
                  </div>
                  <div className="flex flex-col gap-3">
                    {tasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        isOwn
                        inHW={hasTask(task.id)}
                        isModerator={isModerator}
                        isExpanded={expandedTaskId === task.id}
                        onToggle={() => setExpandedTaskId(expandedTaskId === task.id ? null : task.id)}
                        onAddToHW={() => handleAddToHW(task)}
                        onMoveToFolder={() => setMovingTask(task)}
                        onEdit={() => setEditingTask(task)}
                        onDelete={() => {
                          if (window.confirm('Удалить задачу?')) {
                            deleteTask.mutate(task.id, {
                              onSuccess: () => toast.success('Задача удалена'),
                              onError: () => toast.error('Не удалось удалить задачу'),
                            });
                          }
                        }}
                        onAiSimilar={() => toast.info('AI-вариации подключим следующим шагом.')}
                      />
                    ))}
                  </div>
                </section>
              ) : null}

              {children.length === 0 && tasks.length === 0 ? (
                <div className="rounded-[22px] border border-dashed border-socrat-border bg-white/70 px-5 py-14 text-center">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-socrat-folder-bg text-socrat-folder">
                    <Folder className="h-7 w-7" />
                  </div>
                  <p className="text-sm font-semibold text-slate-800">Папка пуста</p>
                  <p className="mt-1 text-xs text-slate-500">Добавьте подпапки или скопируйте задачи из Каталога</p>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        {showCreateFolder && folderId ? (
          <CreateFolderModal
            parentId={folderId}
            onClose={() => setShowCreateFolder(false)}
          />
        ) : null}

        {showCreateTask && folderId ? (
          <CreateTaskModal
            defaultFolderId={folderId}
            onClose={() => setShowCreateTask(false)}
          />
        ) : null}

        {editingTask ? (
          <EditTaskModal
            task={editingTask}
            onClose={() => setEditingTask(null)}
          />
        ) : null}

        {movingTask && folderId ? (
          <MoveToFolderModal
            task={movingTask}
            currentFolderId={folderId}
            onClose={() => setMovingTask(null)}
          />
        ) : null}

        {renamingFolder ? (
          <RenameFolderModal
            folderId={renamingFolder.id}
            currentName={renamingFolder.name}
            onClose={() => setRenamingFolder(null)}
          />
        ) : null}

        {deletingFolder ? (
          <DeleteFolderDialog
            folder={deletingFolder}
            isPending={deleteFolder.isPending}
            onConfirm={() => {
              deleteFolder.mutate(deletingFolder.id, {
                onSuccess: () => {
                  toast.success('Папка удалена');
                  const isDeletingCurrent = deletingFolder.id === folderId;
                  setDeletingFolder(null);
                  if (isDeletingCurrent) {
                    const parentCrumb = breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2] : null;
                    navigate(parentCrumb ? `/tutor/knowledge/folder/${parentCrumb.id}` : '/tutor/knowledge?tab=mybase');
                  }
                },
                onError: () => toast.error('Не удалось удалить папку'),
              });
            }}
            onClose={() => setDeletingFolder(null)}
          />
        ) : null}
      </KnowledgeBaseFrame>
    </TutorLayout>
  );
}

export default function FolderPage() {
  return (
    <TutorGuard>
      <FolderContent />
    </TutorGuard>
  );
}
