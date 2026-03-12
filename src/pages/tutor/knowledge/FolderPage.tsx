import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, Folder, FolderPlus, Plus } from 'lucide-react';
import { toast } from 'sonner';
import TutorGuard from '@/components/TutorGuard';
import { FolderCard } from '@/components/kb/FolderCard';
import { KBStatusCard } from '@/components/kb/KBStatusCard';
import { KnowledgeBaseFrame } from '@/components/kb/KnowledgeBaseFrame';
import { KnowledgeTaskCard } from '@/components/kb/KnowledgeTaskCard';
import { TutorLayout } from '@/components/tutor/TutorLayout';
import { useFolder } from '@/hooks/useFolders';
import type { KBTask } from '@/types/kb';

function FolderContent() {
  const { folderId } = useParams<{ folderId: string }>();
  const navigate = useNavigate();
  const { folder, children, tasks, breadcrumbs, loading, error, refetch, isFetching } = useFolder(folderId);

  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [hwTaskIds, setHwTaskIds] = useState<string[]>([]);

  const handleAddToHW = (task: KBTask) => {
    setHwTaskIds((current) => {
      if (current.includes(task.id)) {
        toast.info('Задача уже отмечена для ДЗ.');
        return current;
      }

      toast.success('Задача добавлена в ДЗ.');
      return [...current, task.id];
    });
  };

  return (
    <TutorLayout>
      <KnowledgeBaseFrame onHomeworkClick={() => toast.info('Корзина ДЗ появится в следующем шаге.')}>
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

              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="font-display text-[1.85rem] font-bold tracking-[-0.04em] text-slate-950">
                  {folder.name}
                </h2>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => toast.info('Создание подпапок подключим следующим шагом.')}
                    className="inline-flex items-center gap-2 rounded-xl border border-socrat-border bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 shadow-sm transition-all duration-200 hover:border-socrat-folder/30 hover:text-socrat-folder"
                  >
                    <FolderPlus className="h-4 w-4" />
                    Подпапка
                  </button>
                  <button
                    type="button"
                    onClick={() => toast.info('Создание задач подключим следующим шагом.')}
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
                      <KnowledgeTaskCard
                        key={task.id}
                        task={task}
                        isOwn
                        inHW={hwTaskIds.includes(task.id)}
                        isExpanded={expandedTaskId === task.id}
                        onToggle={() => setExpandedTaskId(expandedTaskId === task.id ? null : task.id)}
                        onAddToHW={() => handleAddToHW(task)}
                        onEdit={() => toast.info('Редактирование задачи подключим следующим шагом.')}
                        onDelete={() => toast.info('Удаление задачи подключим следующим шагом.')}
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
