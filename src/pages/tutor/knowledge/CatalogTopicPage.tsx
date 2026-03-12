import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
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
import { useCatalogTasks, useMaterials, useSubtopics, useTopic } from '@/hooks/useKnowledgeBase';
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
  const { tasks, loading: tasksLoading, error: tasksError, refetch: refetchTasks } = useCatalogTasks(topicId);
  const { materials, loading: materialsLoading } = useMaterials(topicId);

  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [copyTask, setCopyTask] = useState<KBTask | null>(null);
  const [hwTaskIds, setHwTaskIds] = useState<string[]>([]);

  const error = topicError || tasksError;

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
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
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
                  inHW={hwTaskIds.includes(task.id)}
                  subtopicName={subtopics.find((subtopic) => subtopic.id === task.subtopic_id)?.name}
                  isExpanded={expandedTaskId === task.id}
                  onToggle={() => setExpandedTaskId(expandedTaskId === task.id ? null : task.id)}
                  onCopyToFolder={() => setCopyTask(task)}
                  onAddToHW={() => handleAddToHW(task)}
                />
              ))}
            </div>
          </section>

          {!materialsLoading && materials.length > 0 ? (
            <section>
              <h3 className="mb-3 text-lg font-semibold text-slate-900">Материалы</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
