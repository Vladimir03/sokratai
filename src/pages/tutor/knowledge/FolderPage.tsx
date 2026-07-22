import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, Folder, FolderPlus, Pencil, Plus, Sparkles, Trash2, UploadCloud, X } from 'lucide-react';
import { toast } from 'sonner';
import { CreateFolderModal } from '@/components/kb/CreateFolderModal';
import { CreateTaskModal } from '@/components/kb/CreateTaskModal';
import { DeleteFolderDialog } from '@/components/kb/DeleteFolderDialog';
import { EditTaskModal } from '@/components/kb/EditTaskModal';
import { FolderCard } from '@/components/kb/FolderCard';
import { MoveToFolderModal } from '@/components/kb/MoveToFolderModal';
import { PublishFolderModal } from '@/components/kb/PublishFolderModal';
import { RenameFolderModal } from '@/components/kb/RenameFolderModal';
import { KBStatusCard } from '@/components/kb/KBStatusCard';
import { KnowledgeBaseFrame } from '@/components/kb/KnowledgeBaseFrame';
import { TaskCard } from '@/components/kb/TaskCard';
import { useDeleteFolder, useFolder } from '@/hooks/useFolders';
import { useDeleteTask } from '@/hooks/useKnowledgeBase';
import { useIsModerator } from '@/hooks/useIsModerator';
import { parseAttachmentUrls } from '@/lib/kbApi';
import { pluralizeRu } from '@/lib/pluralizeRu';
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
  const [kimFilter, setKimFilter] = useState<number | null>(null);
  const [showPublish, setShowPublish] = useState(false);

  // Tasks filtered by clicked-on KIM badge. `null` shows all.
  const visibleTasks = useMemo(
    () => (kimFilter === null ? tasks : tasks.filter((t) => t.kim_number === kimFilter)),
    [tasks, kimFilter],
  );
  const { addTask, hasTask } = useHWDraftStore();
  const deleteTask = useDeleteTask();
  const deleteFolder = useDeleteFolder();
  const { isModerator } = useIsModerator();

  // ВОЛНА 7 (репорт Светланы): триггер авто-публикации «сократ» МОЛЧА пропускает
  // задачи без темы (CASE A требует topic_id) — 12 задач «переносились» и не
  // появлялись в каталоге без какой-либо обратной связи. Баннер делает провал
  // видимым и ведёт в PublishFolderModal (назначит тему всем задачам папки +
  // опубликует). Детект корня — точное имя 'сократ' (регистрозависимо, mirror
  // kb_is_in_socrat_tree, rule 50).
  const isInSocratTree = breadcrumbs[0]?.name === 'сократ';
  const topiclessCount = useMemo(() => tasks.filter((t) => !t.topic_id).length, [tasks]);

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
                  {isModerator ? (
                    <button
                      type="button"
                      onClick={() => setShowPublish(true)}
                      className="inline-flex items-center gap-2 rounded-xl border border-socrat-folder/30 bg-socrat-folder-bg px-4 py-2.5 text-sm font-semibold text-socrat-folder shadow-sm transition-all duration-200 hover:border-socrat-folder/50 [touch-action:manipulation]"
                    >
                      <UploadCloud className="h-4 w-4" />
                      В каталог
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => navigate(`/tutor/knowledge/ai-loader?folder=${folderId}`)}
                    className="inline-flex items-center gap-2 rounded-xl border border-socrat-primary/20 bg-socrat-primary-light px-4 py-2.5 text-sm font-semibold text-socrat-primary shadow-sm transition-all duration-200 hover:border-socrat-primary/35 [touch-action:manipulation]"
                  >
                    <Sparkles className="h-4 w-4" />
                    AI-загрузка
                  </button>
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

              {isModerator && isInSocratTree && topiclessCount > 0 ? (
                <div className="flex flex-col gap-3 rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-amber-900">
                    <span className="font-semibold">
                      {topiclessCount} {pluralizeRu(topiclessCount, ['задача', 'задачи', 'задач'])} без темы
                    </span>{' '}
                    — {topiclessCount === 1 ? 'она не публикуется' : 'они не публикуются'} в общий
                    каталог. Укажите тему, и {topiclessCount === 1 ? 'она попадёт' : 'они попадут'} в
                    Банк автоматически.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowPublish(true)}
                    className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-amber-700 [touch-action:manipulation]"
                  >
                    <UploadCloud className="h-4 w-4" />
                    Указать тему и опубликовать
                  </button>
                </div>
              ) : null}

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
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Задачи
                    </div>
                    {kimFilter !== null ? (
                      <button
                        type="button"
                        onClick={() => setKimFilter(null)}
                        className="inline-flex items-center gap-1 rounded-full bg-socrat-primary/10 px-2.5 py-1 text-[11px] font-semibold text-socrat-primary transition-colors hover:bg-socrat-primary/20"
                      >
                        КИМ № {kimFilter}
                        <X className="h-3 w-3" />
                      </button>
                    ) : null}
                    {kimFilter !== null && visibleTasks.length !== tasks.length ? (
                      <span className="text-[11px] text-slate-400">
                        {visibleTasks.length} из {tasks.length}
                      </span>
                    ) : null}
                  </div>
                  {visibleTasks.length === 0 && kimFilter !== null ? (
                    <div className="rounded-[18px] border border-dashed border-socrat-border bg-white/60 px-5 py-8 text-center text-sm text-slate-500">
                      Задач с КИМ № {kimFilter} в этой папке нет.{' '}
                      <button
                        type="button"
                        onClick={() => setKimFilter(null)}
                        className="font-semibold text-socrat-primary hover:underline"
                      >
                        Сбросить фильтр
                      </button>
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-3">
                    {visibleTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        isOwn
                        inHW={hasTask(task.id)}
                        isModerator={isModerator}
                        isExpanded={expandedTaskId === task.id}
                        onKimClick={(kim) => setKimFilter(kim)}
                        onToggle={() => setExpandedTaskId(expandedTaskId === task.id ? null : task.id)}
                        onAddToHW={() => handleAddToHW(task)}
                        onMoveToFolder={() => setMovingTask(task)}
                        onEdit={() => setEditingTask(task)}
                        onDelete={() => {
                          if (window.confirm('Удалить задачу?')) {
                            deleteTask.mutate(task.id, {
                              onSuccess: () => toast.success('Задача удалена'),
                              // Ревью-фикс P1 (2026-07-06): delete-гард шаблонов кидает
                              // русскую фразу («Задача используется в шаблонах: …») —
                              // показываем её, а не generic (rule 97).
                              onError: (e) =>
                                toast.error(
                                  e instanceof Error && /[а-яё]/i.test(e.message)
                                    ? e.message
                                    : 'Не удалось удалить задачу',
                                ),
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

        {showPublish && folder ? (
          <PublishFolderModal folder={folder} onClose={() => setShowPublish(false)} />
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
                // Ревью-фикс P1 (2026-07-06): delete-гард шаблонов кидает русскую
                // фразу («В папке есть задачи, используемые в шаблонах…») —
                // показываем её, а не generic (rule 97).
                onError: (e) =>
                  toast.error(
                    e instanceof Error && /[а-яё]/i.test(e.message)
                      ? e.message
                      : 'Не удалось удалить папку',
                  ),
              });
            }}
            onClose={() => setDeletingFolder(null)}
          />
        ) : null}
      </KnowledgeBaseFrame>
  );
}

export default function FolderPage() {
  return <FolderContent />;
}
