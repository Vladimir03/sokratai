import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import TutorGuard from '@/components/TutorGuard';
import { CopyToFolderModal } from '@/components/kb/CopyToFolderModal';
import { KBStatusCard } from '@/components/kb/KBStatusCard';
import { KnowledgeBaseFrame } from '@/components/kb/KnowledgeBaseFrame';
import { MaterialCard } from '@/components/kb/MaterialCard';
import { TaskCard } from '@/components/kb/TaskCard';
import { ExamBadge } from '@/components/kb/ui/ExamBadge';
import { SourceBadge } from '@/components/kb/ui/SourceBadge';
import { StatCounter } from '@/components/kb/ui/StatCounter';
import { TopicChip } from '@/components/kb/ui/TopicChip';
import { TutorLayout } from '@/components/tutor/TutorLayout';
import { useCatalogTasks, useCatalogTasksAll, useMaterials, useSubtopics, useTopic } from '@/hooks/useKnowledgeBase';
import { useIsModerator } from '@/hooks/useIsModerator';
import { kbModUnpublish, kbModReassign, parseAttachmentUrls } from '@/lib/kbApi';
import { useHWDraftStore } from '@/stores/hwDraftStore';
import type { KBTask } from '@/types/kb';

function CatalogTopicContent() {
  const { topicId } = useParams<{ topicId: string }>();
  const navigate = useNavigate();

  const {
    topic,
    loading: topicLoading,
    error: topicError,
    refetch: refetchTopic,
    isFetching: topicFetching,
  } = useTopic(topicId);
  const { subtopics } = useSubtopics(topicId);
  const { isModerator } = useIsModerator();
  const { tasks: publicTasks, loading: publicLoading, error: publicError, refetch: refetchPublic } = useCatalogTasks(topicId);
  const { tasks: allTasks, loading: allLoading, error: allError, refetch: refetchAll } = useCatalogTasksAll(topicId, isModerator);
  const tasks = isModerator ? allTasks : publicTasks;
  const tasksLoading = isModerator ? allLoading : publicLoading;
  const tasksError = isModerator ? allError : publicError;
  const refetchTasks = isModerator ? refetchAll : refetchPublic;
  const { materials, loading: materialsLoading } = useMaterials(topicId);

  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [copyTask, setCopyTask] = useState<KBTask | null>(null);
  const { addTask, hasTask } = useHWDraftStore();
  const queryClient = useQueryClient();

  const handleUnpublish = useCallback(
    async (task: KBTask) => {
      if (!window.confirm(`Снять публикацию задачи?`)) return;
      try {
        await kbModUnpublish(task.id);
        await queryClient.invalidateQueries({ queryKey: ['tutor', 'kb'] });
        toast.success('Публикация снята');
      } catch (err) {
        console.error('Unpublish failed', err);
        toast.error('Не удалось снять публикацию');
      }
    },
    [queryClient],
  );

  const handleReassign = useCallback(
    async (task: KBTask) => {
      const newSourceId = window.prompt('UUID задачи-источника для перепривязки:');
      if (!newSourceId?.trim()) return;
      try {
        await kbModReassign(task.id, newSourceId.trim());
        await queryClient.invalidateQueries({ queryKey: ['tutor', 'kb'] });
        toast.success('Источник перепривязан');
      } catch (err) {
        console.error('Reassign failed', err);
        toast.error('Не удалось перепривязать источник');
      }
    },
    [queryClient],
  );

  const error = topicError || tasksError;

  const handleAddToHW = (task: KBTask) => {
    if (hasTask(task.id)) {
      toast.info('Задача уже в ДЗ.');
      return;
    }
    const subtopicName = subtopics.find((s) => s.id === task.subtopic_id)?.name;
    addTask(task, subtopicName, topic?.name);
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
          <KBStatusCard
            error={error}
            isFetching={topicFetching}
            onRetry={() => {
              refetchTopic();
              refetchTasks();
            }}
          />

          <button
            type="button"
            onClick={() => navigate('/tutor/knowledge')}
            className="inline-flex items-center gap-2 text-sm font-semibold text-socrat-primary transition-colors duration-200 hover:text-socrat-primary-dark"
          >
            <ArrowLeft className="h-4 w-4" />
            Каталог задач
          </button>

          {topicLoading ? <div className="h-44 animate-pulse rounded-[24px] bg-white/80" /> : null}

          {topic ? (
            <section className="rounded-[24px] border border-socrat-border bg-white px-5 py-5 shadow-[0_16px_40px_-32px_rgba(15,23,42,0.4)] sm:px-6">
              <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="font-display text-[1.75rem] font-bold tracking-[-0.04em] text-slate-950">
                      {topic.name}
                    </h2>
                    <ExamBadge exam={topic.exam} />
                    <SourceBadge source="socrat" className="bg-socrat-border-light text-slate-500" />
                  </div>
                  <p className="text-sm text-slate-500">
                    {topic.section}
                    {topic.kim_numbers.length > 0 ? ` · КИМ № ${topic.kim_numbers.join(', ')}` : ''}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {(subtopics.length > 0
                      ? subtopics
                      : topic.subtopic_names.map((name, index) => ({ id: `${topic.id}-${index}`, name }))
                    ).map((subtopic) => (
                      <TopicChip key={subtopic.id} label={subtopic.name} />
                    ))}
                  </div>
                </div>

                <StatCounter value={topic.task_count} label="задач" />
              </div>
            </section>
          ) : null}

          <section>
            <h3 className="mb-3 text-lg font-semibold text-slate-900">Задачи</h3>

            {tasksLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((index) => (
                  <div key={index} className="h-28 animate-pulse rounded-[22px] bg-white/80" />
                ))}
              </div>
            ) : null}

            {!tasksLoading && tasks.length === 0 ? (
              <div className="rounded-[22px] border border-dashed border-socrat-border bg-white/70 px-5 py-10 text-center text-sm text-slate-500">
                Задач пока нет
              </div>
            ) : null}

            <div className="flex flex-col gap-3">
              {tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  isOwn={false}
                  inHW={hasTask(task.id)}
                  isModerator={isModerator}
                  subtopicName={subtopics.find((subtopic) => subtopic.id === task.subtopic_id)?.name}
                  isExpanded={expandedTaskId === task.id}
                  onToggle={() => setExpandedTaskId(expandedTaskId === task.id ? null : task.id)}
                  onCopyToFolder={() => setCopyTask(task)}
                  onAddToHW={() => handleAddToHW(task)}
                  onUnpublish={() => handleUnpublish(task)}
                  onReassign={() => handleReassign(task)}
                />
              ))}
            </div>
          </section>

          {!materialsLoading && materials.length > 0 ? (
            <section>
              <h3 className="mb-3 text-lg font-semibold text-slate-900">Материалы</h3>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {materials.map((material) => (
                  <MaterialCard key={material.id} material={material} />
                ))}
              </div>
            </section>
          ) : null}
        </div>

        {copyTask ? <CopyToFolderModal task={copyTask} onClose={() => setCopyTask(null)} /> : null}
      </KnowledgeBaseFrame>
    </TutorLayout>
  );
}

export default function CatalogTopicPage() {
  return (
    <TutorGuard>
      <CatalogTopicContent />
    </TutorGuard>
  );
}
