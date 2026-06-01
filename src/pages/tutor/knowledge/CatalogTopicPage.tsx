import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, X } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { CopyToFolderModal } from '@/components/kb/CopyToFolderModal';
import { KBStatusCard } from '@/components/kb/KBStatusCard';
import { KnowledgeBaseFrame } from '@/components/kb/KnowledgeBaseFrame';
import { MaterialCard } from '@/components/kb/MaterialCard';
import { TaskCard } from '@/components/kb/TaskCard';
import { CatalogTaskGroups } from '@/components/kb/CatalogTaskGroups';
import { ExamBadge } from '@/components/kb/ui/ExamBadge';
import { SourceBadge } from '@/components/kb/ui/SourceBadge';
import { StatCounter } from '@/components/kb/ui/StatCounter';
import { SubtopicFilterChips } from '@/components/kb/ui/SubtopicFilterChips';
import { TopicChip } from '@/components/kb/ui/TopicChip';
import { useCatalogTasks, useCatalogTasksAll, useMaterials, useSubtopics, useTopic } from '@/hooks/useKnowledgeBase';
import { useIsModerator } from '@/hooks/useIsModerator';
import { countTasksBySubtopic, groupTasksByKim, NO_SUBTOPIC_FILTER } from '@/lib/kbCatalogGrouping';
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
  const [kimFilter, setKimFilter] = useState<number | null>(null);
  const [subtopicFilter, setSubtopicFilter] = useState<string | null>(null);
  const { addTask, hasTask } = useHWDraftStore();
  const queryClient = useQueryClient();

  const subtopicById = useMemo(() => new Map(subtopics.map((s) => [s.id, s])), [subtopics]);
  const subtopicOrder = useMemo(
    () => new Map(subtopics.map((s) => [s.id, s.sort_order])),
    [subtopics],
  );
  // Счётчики по всем задачам темы (до фильтра) — чтобы числа на чипах не «прыгали».
  const subtopicCounts = useMemo(() => countTasksBySubtopic(tasks), [tasks]);

  // Фильтры по КИМ (клик по бейджу) и по подтеме (клик по чипу) комбинируются (AND).
  const visibleTasks = useMemo(() => {
    let list = tasks;
    if (kimFilter !== null) list = list.filter((t) => t.kim_number === kimFilter);
    if (subtopicFilter !== null) {
      list =
        subtopicFilter === NO_SUBTOPIC_FILTER
          ? list.filter((t) => !t.subtopic_id)
          : list.filter((t) => t.subtopic_id === subtopicFilter);
    }
    return list;
  }, [tasks, kimFilter, subtopicFilter]);

  // Группировка по возрастанию КИМ — секции «КИМ № N · M задач».
  const taskGroups = useMemo(
    () => groupTasksByKim(visibleTasks, subtopicOrder),
    [visibleTasks, subtopicOrder],
  );

  // Сброс фильтров/раскрытия при смене темы (param-only навигация не размонтирует компонент).
  useEffect(() => {
    setKimFilter(null);
    setSubtopicFilter(null);
    setExpandedTaskId(null);
  }, [topicId]);

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
                  {subtopics.length > 0 ? (
                    <SubtopicFilterChips
                      subtopics={subtopics}
                      counts={subtopicCounts}
                      activeId={subtopicFilter}
                      onSelect={setSubtopicFilter}
                    />
                  ) : topic.subtopic_names.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {topic.subtopic_names.map((name, index) => (
                        <TopicChip key={`${topic.id}-${index}`} label={name} />
                      ))}
                    </div>
                  ) : null}
                </div>

                <StatCounter value={topic.task_count} label="задач" />
              </div>
            </section>
          ) : null}

          <section>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <h3 className="text-lg font-semibold text-slate-900">Задачи</h3>
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
              {(kimFilter !== null || subtopicFilter !== null) && visibleTasks.length !== tasks.length ? (
                <span className="text-[11px] text-slate-400">
                  {visibleTasks.length} из {tasks.length}
                </span>
              ) : null}
            </div>

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

            {!tasksLoading &&
            tasks.length > 0 &&
            visibleTasks.length === 0 &&
            (kimFilter !== null || subtopicFilter !== null) ? (
              <div className="rounded-[22px] border border-dashed border-socrat-border bg-white/70 px-5 py-8 text-center text-sm text-slate-500">
                Нет задач по выбранному фильтру.{' '}
                <button
                  type="button"
                  onClick={() => {
                    setKimFilter(null);
                    setSubtopicFilter(null);
                  }}
                  className="font-semibold text-socrat-primary hover:underline"
                >
                  Сбросить фильтры
                </button>
              </div>
            ) : null}

            <CatalogTaskGroups
              key={topicId}
              groups={taskGroups}
              renderTask={(task) => (
                <TaskCard
                  task={task}
                  isOwn={false}
                  inHW={hasTask(task.id)}
                  isModerator={isModerator}
                  subtopicName={subtopicById.get(task.subtopic_id ?? '')?.name}
                  isExpanded={expandedTaskId === task.id}
                  onKimClick={(kim) => setKimFilter(kim)}
                  onToggle={() => setExpandedTaskId(expandedTaskId === task.id ? null : task.id)}
                  onCopyToFolder={() => setCopyTask(task)}
                  onAddToHW={() => handleAddToHW(task)}
                  onUnpublish={() => handleUnpublish(task)}
                  onReassign={() => handleReassign(task)}
                />
              )}
            />
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
  );
}

export default function CatalogTopicPage() {
  return <CatalogTopicContent />;
}
