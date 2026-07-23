import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { CopyToFolderModal } from '@/components/kb/CopyToFolderModal';
import { KBStatusCard } from '@/components/kb/KBStatusCard';
import { KnowledgeBaseFrame } from '@/components/kb/KnowledgeBaseFrame';
import { MaterialCard } from '@/components/kb/MaterialCard';
import { SubtopicManager } from '@/components/kb/SubtopicManager';
import { TaskCard } from '@/components/kb/TaskCard';
import { TopicEditorModal } from '@/components/kb/TopicEditorModal';
import { CatalogTaskGroups } from '@/components/kb/CatalogTaskGroups';
import { ExamBadge } from '@/components/kb/ui/ExamBadge';
import { SourceBadge } from '@/components/kb/ui/SourceBadge';
import { StatCounter } from '@/components/kb/ui/StatCounter';
import { SubtopicFilterChips } from '@/components/kb/ui/SubtopicFilterChips';
import { TopicChip } from '@/components/kb/ui/TopicChip';
import { useCatalogTasks, useCatalogTasksAll, useMaterials, useSubtopics, useTopic } from '@/hooks/useKnowledgeBase';
import { useIsModerator } from '@/hooks/useIsModerator';
import { useAdminAccess } from '@/hooks/useAdminAccess';
import { useTutorProfile } from '@/hooks/useTutorProfile';
import { useDeleteCatalogTask, useDeleteTopicToMyBase, useMoveTaskToMyBase } from '@/hooks/useModeratorCatalog';
import { FolderPickerModal } from '@/components/kb/FolderPickerModal';
import { DeleteCatalogDialog } from '@/components/kb/DeleteCatalogDialog';
import { DeleteCatalogTaskDialog } from '@/components/kb/DeleteCatalogTaskDialog';
import { stripLatex } from '@/components/kb/ui/stripLatex';
import { countTasksBySubtopic, groupTasksByKim, groupTasksBySubtopic, NO_SUBTOPIC_FILTER } from '@/lib/kbCatalogGrouping';
import { kbModReassign, parseAttachmentUrls } from '@/lib/kbApi';
import { useHWDraftStore } from '@/stores/hwDraftStore';
import type { KBTask } from '@/types/kb';

// Ревью 5.6 P1: memo-обёртка строит зиро-арг колбэки TaskCard из СТАБИЛЬНЫХ
// параметризованных (зеркало TaskCardRow в HWTasksSection — API TaskCard не
// трогаем, его рендерит и FolderPage). Инлайн-замыкания в renderTask убивали
// memo: любой setState страницы перерисовывал все 200+ карточек с MathText;
// теперь expand трогает 2 карточки, диалоги — 0.
const CatalogTaskItem = memo(function CatalogTaskItem({
  task,
  isExpanded,
  inHW,
  isModerator,
  canMod,
  subtopicName,
  onKimClick,
  onToggleTask,
  onCopyTask,
  onAddToHW,
  onMoveTask,
  onReassignTask,
  onDeleteTask,
}: {
  task: KBTask;
  isExpanded: boolean;
  inHW: boolean;
  isModerator: boolean;
  canMod: boolean;
  subtopicName: string | undefined;
  onKimClick: (kim: number) => void;
  onToggleTask: (taskId: string) => void;
  onCopyTask: (task: KBTask) => void;
  onAddToHW: (task: KBTask) => void;
  onMoveTask: (task: KBTask) => void;
  onReassignTask: (task: KBTask) => void;
  onDeleteTask: (task: KBTask) => void;
}) {
  return (
    <TaskCard
      task={task}
      isOwn={false}
      inHW={inHW}
      isModerator={isModerator}
      subtopicName={subtopicName}
      isExpanded={isExpanded}
      onKimClick={onKimClick}
      onToggle={() => onToggleTask(task.id)}
      onCopyToFolder={() => onCopyTask(task)}
      onAddToHW={() => onAddToHW(task)}
      onMoveToMyBase={canMod ? () => onMoveTask(task) : undefined}
      onReassign={canMod ? () => onReassignTask(task) : undefined}
      onDeleteFromCatalog={canMod ? () => onDeleteTask(task) : undefined}
    />
  );
});

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
  const { isAdmin } = useAdminAccess();
  // Модератор ИЛИ владелец (is_admin) читают all-status фетч (у не-модератора он
  // отдаёт active-only — гард `fetch_catalog_tasks_all` пускает tutor, но
  // не-active строки видит лишь moderator; для владельца это норм, ошибки нет).
  const canModerate = isModerator || isAdmin;
  const { tasks: publicTasks, loading: publicLoading, error: publicError, refetch: refetchPublic } = useCatalogTasks(topicId);
  const { tasks: allTasks, loading: allLoading, error: allError, refetch: refetchAll } = useCatalogTasksAll(topicId, canModerate);
  const tasks = canModerate ? allTasks : publicTasks;
  const tasksLoading = canModerate ? allLoading : publicLoading;
  const tasksError = canModerate ? allError : publicError;
  const refetchTasks = canModerate ? refetchAll : refetchPublic;
  const { materials, loading: materialsLoading } = useMaterials(topicId);

  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [copyTask, setCopyTask] = useState<KBTask | null>(null);
  const [kimFilter, setKimFilter] = useState<number | null>(null);
  const [subtopicFilter, setSubtopicFilter] = useState<string | null>(null);
  const [editingTopic, setEditingTopic] = useState(false);
  const { addTask, hasTask } = useHWDraftStore();
  const queryClient = useQueryClient();

  // ВОЛНА 6: destructive-действия модератора — только по своим предметам профиля.
  // Владелец (is_admin) — bypass по любому предмету (зеркало серверного гейта
  // kb_require_moderator_subject: is_admin проверяется ПЕРВЫМ).
  const { data: tutorProfile } = useTutorProfile();
  const mySubjects = tutorProfile?.subjects ?? [];
  const canMod = isAdmin || (isModerator && !!topic && mySubjects.includes(topic.subject));
  const [moveTask, setMoveTask] = useState<KBTask | null>(null);
  const [deleteTask, setDeleteTask] = useState<KBTask | null>(null);
  const [deletingTopic, setDeletingTopic] = useState(false);
  const moveMutation = useMoveTaskToMyBase();
  const deleteTaskMutation = useDeleteCatalogTask();
  const deleteTopicMutation = useDeleteTopicToMyBase();

  const isOlympiad = topic?.kind === 'olympiad';

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

  // Олимпиадные темы — без № КИМ: группируем по подтемам. Экзаменационные — по КИМ.
  const taskGroups = useMemo(
    () =>
      isOlympiad
        ? groupTasksBySubtopic(visibleTasks, subtopics)
        : groupTasksByKim(visibleTasks, subtopicOrder),
    [isOlympiad, visibleTasks, subtopics, subtopicOrder],
  );

  // Сброс фильтров/раскрытия при смене темы (param-only навигация не размонтирует компонент).
  useEffect(() => {
    setKimFilter(null);
    setSubtopicFilter(null);
    setExpandedTaskId(null);
  }, [topicId]);

  const handleConfirmMove = useCallback(
    (folderId: string) => {
      if (!moveTask) return;
      moveMutation.mutate(
        { taskId: moveTask.id, folderId },
        {
          onSuccess: () => { toast.success('Задача перенесена в вашу «Мою базу»'); setMoveTask(null); },
          onError: (err) => toast.error(err instanceof Error ? err.message : 'Не удалось перенести задачу'),
        },
      );
    },
    [moveTask, moveMutation],
  );

  const handleConfirmDeleteTask = useCallback(() => {
    if (!deleteTask) return;
    deleteTaskMutation.mutate(deleteTask.id, {
      onSuccess: (result) => {
        toast.success(
          result === 'deleted_with_source'
            ? 'Задача и её исходник удалены'
            : 'Задача удалена из каталога',
        );
        setDeleteTask(null);
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : 'Не удалось удалить задачу'),
    });
  }, [deleteTask, deleteTaskMutation]);

  const handleConfirmDeleteTopic = useCallback(
    (folderId: string | null) => {
      if (!topic) return;
      deleteTopicMutation.mutate(
        { topicId: topic.id, folderId },
        {
          onSuccess: (res) => {
            toast.success(res.moved > 0 ? `Тема удалена, задач перенесено: ${res.moved}` : 'Тема удалена');
            setDeletingTopic(false);
            navigate(-1);
          },
          onError: (err) => toast.error(err instanceof Error ? err.message : 'Не удалось удалить тему'),
        },
      );
    },
    [topic, deleteTopicMutation, navigate],
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

  const handleAddToHW = useCallback(
    (task: KBTask) => {
      if (hasTask(task.id)) {
        toast.info('Задача уже в ДЗ.');
        return;
      }
      const subtopicName = subtopics.find((s) => s.id === task.subtopic_id)?.name;
      // subjectHint = предмет темы (review P1 2026-07-07): HWDrawer префиллит
      // «Предмет ДЗ», check_format-эвристика становится subject-aware.
      addTask(task, subtopicName, topic?.name, topic?.subject);
      const imageCount = parseAttachmentUrls(task.attachment_url).length;
      if (imageCount > 1) {
        toast.success(`Задача добавлена в ДЗ (в ДЗ уйдёт первое фото из ${imageCount})`);
      } else {
        toast.success('Задача добавлена в ДЗ');
      }
    },
    [hasTask, subtopics, addTask, topic?.name, topic?.subject],
  );

  // Стабильные параметризованные колбэки (ревью 5.6 P1, конвенция PickerTaskCard
  // W3.4): инлайн-замыкания в renderTask убивали memo TaskCard — любой setState
  // страницы (expand, открытие диалога) пересравнивал и перерисовывал 200+
  // карточек с MathText. Зиро-арг замыкания строит memo-обёртка CatalogTaskItem.
  const handleKimClick = useCallback((kim: number) => setKimFilter(kim), []);
  const handleToggleTask = useCallback(
    (taskId: string) => setExpandedTaskId((prev) => (prev === taskId ? null : taskId)),
    [],
  );
  const handleCopyTask = useCallback((task: KBTask) => setCopyTask(task), []);
  const handleMoveTask = useCallback((task: KBTask) => setMoveTask(task), []);
  const handleDeleteTaskOpen = useCallback((task: KBTask) => setDeleteTask(task), []);

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
                    <ExamBadge exam={topic.exam} kind={topic.kind} />
                    <SourceBadge source="socrat" className="bg-socrat-border-light text-slate-500" />
                    {isModerator ? (
                      <button
                        type="button"
                        onClick={() => setEditingTopic(true)}
                        className="inline-flex items-center gap-1 rounded-lg border border-socrat-border px-2.5 py-1 text-[12px] font-semibold text-slate-600 transition-colors hover:border-socrat-primary/30 hover:text-socrat-primary [touch-action:manipulation]"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Редактировать тему
                      </button>
                    ) : null}
                    {canMod ? (
                      <button
                        type="button"
                        onClick={() => setDeletingTopic(true)}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-[12px] font-semibold text-red-600 transition-colors hover:border-red-400 hover:bg-red-50 [touch-action:manipulation]"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Удалить тему
                      </button>
                    ) : null}
                  </div>
                  <p className="text-sm text-slate-500">
                    {topic.section}
                    {!isOlympiad && topic.kim_numbers.length > 0
                      ? ` · КИМ № ${topic.kim_numbers.join(', ')}`
                      : ''}
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

          {isModerator && topic ? (
            <SubtopicManager topicId={topic.id} subtopics={subtopics} canDelete={canMod} />
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
                <CatalogTaskItem
                  task={task}
                  isExpanded={expandedTaskId === task.id}
                  inHW={hasTask(task.id)}
                  isModerator={isModerator}
                  canMod={canMod}
                  subtopicName={subtopicById.get(task.subtopic_id ?? '')?.name}
                  onKimClick={handleKimClick}
                  onToggleTask={handleToggleTask}
                  onCopyTask={handleCopyTask}
                  onAddToHW={handleAddToHW}
                  onMoveTask={handleMoveTask}
                  onReassignTask={handleReassign}
                  onDeleteTask={handleDeleteTaskOpen}
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

        {moveTask ? (
          <FolderPickerModal
            title="Перенести в Мою базу"
            description="Задача уедет в выбранную личную папку, из общего каталога исчезнет."
            confirmLabel="Перенести"
            isPending={moveMutation.isPending}
            onConfirm={handleConfirmMove}
            onClose={() => setMoveTask(null)}
          />
        ) : null}

        {deleteTask ? (
          <DeleteCatalogTaskDialog
            taskId={deleteTask.id}
            taskPreviewText={stripLatex(deleteTask.text || '').trim() || 'Задача на фото'}
            isPending={deleteTaskMutation.isPending}
            onConfirm={handleConfirmDeleteTask}
            onClose={() => setDeleteTask(null)}
          />
        ) : null}

        {deletingTopic && topic ? (
          <DeleteCatalogDialog
            entity="тему"
            name={topic.name}
            target={{ kind: 'topic', topicId: topic.id }}
            isPending={deleteTopicMutation.isPending}
            onConfirm={handleConfirmDeleteTopic}
            onClose={() => setDeletingTopic(false)}
          />
        ) : null}

        {editingTopic && topic ? (
          <TopicEditorModal
            mode="edit"
            kind={topic.kind}
            initial={topic}
            onClose={() => setEditingTopic(false)}
          />
        ) : null}
      </KnowledgeBaseFrame>
  );
}

export default function CatalogTopicPage() {
  return <CatalogTopicContent />;
}
