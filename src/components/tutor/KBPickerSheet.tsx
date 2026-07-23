// Job: Быстро добавить задачу из базы в черновик ДЗ (P0.1 wedge)
import { memo, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Folder,
  Image as ImageIcon,
  Library,
  Loader2,
  Plus,
  Search,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { MathText } from '@/components/kb/ui/MathText';
import { SourceBadge } from '@/components/kb/ui/SourceBadge';
import { SubtopicFilterChips } from '@/components/kb/ui/SubtopicFilterChips';
import { CatalogTaskGroups } from '@/components/kb/CatalogTaskGroups';
import { SubjectPills } from '@/components/kb/SubjectPills';
import { FilterChips } from '@/components/kb/ui/FilterChips';
import { cn } from '@/lib/utils';
import { useTopics, useCatalogTasks, useSubtopics } from '@/hooks/useKnowledgeBase';
import { useRootFolders, useFolder } from '@/hooks/useFolders';
import { countTasksBySubtopic, groupTasksByKim, groupTasksBySubtopic, groupTopicsBySection, NO_SUBTOPIC_FILTER } from '@/lib/kbCatalogGrouping';
import { parseAttachmentUrls } from '@/lib/kbApi';
import { useKBImagesSignedUrls } from '@/hooks/useKBImagesSignedUrls';
import { DEFAULT_KB_SUBJECT, type CatalogFilter, type KBTask, type KBTopicWithCounts, type KBFolderWithCounts } from '@/types/kb';
import { getSubjectDative } from '@/lib/subjectHelpers';
import { useTutorProfile } from '@/hooks/useTutorProfile';

// ─── Types ───────────────────────────────────────────────────────────────────

interface KBPickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Batch-capable callback — receives one or more tasks at once */
  onAddTasks: (tasks: KBTask[]) => void;
  addedKbTaskIds: Set<string>;
  topicHint?: string;
  /**
   * Предмет ДЗ — стартовый фильтр Каталога (репорт Ульяны 2026-07-23: пикер
   * показывал темы всех предметов подряд). Переключатель виден.
   */
  subject?: string;
  /** Экзамен ДЗ (`ege`/`oge`) — стартовый фильтр; олимпиады выбираются вручную. */
  examType?: string | null;
}

type Tab = 'catalog' | 'my';

// ─── Picker task card ────────────────────────────────────────────────────────

const PickerTaskCard = memo(function PickerTaskCard({
  task,
  added,
  selected,
  showCheckbox,
  onAdd,
  onToggleSelect,
}: {
  task: KBTask;
  added: boolean;
  selected: boolean;
  showCheckbox: boolean;
  /** Стабильные колбэки с параметром (W3.4, ревью P2) — иначе memo был бы no-op. */
  onAdd: (task: KBTask) => void;
  onToggleSelect: (taskId: string) => void;
}) {
  const source = task.owner_id ? 'my' : 'socrat';

  // Resolve attachment thumbnail — через кэшированный batch-хук (дедуп между
  // карточками, staleTime 55 мин) вместо прямого createSignedUrl per-card.
  const attachmentRefs = useMemo(
    () => parseAttachmentUrls(task.attachment_url),
    [task.attachment_url],
  );
  const thumbRef = attachmentRefs[0] ?? null;
  const thumbRefs = useMemo(() => (thumbRef ? [thumbRef] : []), [thumbRef]);
  const { urls: thumbUrlMap } = useKBImagesSignedUrls(thumbRefs);
  const thumbUrl = thumbRef ? thumbUrlMap[thumbRef] ?? null : null;

  const isImageOnly = !task.text || task.text === '[Задача на фото]';

  // Источник задачи («ФИПИ», …) — запрос Егора #3; sentinel 'my'/'socrat' скрываем.
  const sourceLabel =
    task.source_label && task.source_label !== 'my' && task.source_label !== 'socrat'
      ? task.source_label
      : null;

  return (
    <div
      className={cn(
        'rounded-xl border bg-white p-3 transition-all duration-200 space-y-2',
        added
          ? 'border-socrat-primary/30 bg-socrat-primary/[0.03]'
          : 'border-socrat-border hover:border-socrat-primary/25',
      )}
    >
      {/* Header: checkbox + badge + KIM + button */}
      <div className="flex items-center gap-2">
        {showCheckbox && !added && (
          <button
            type="button"
            onClick={() => onToggleSelect(task.id)}
            className={cn(
              'flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors',
              selected
                ? 'border-socrat-primary bg-socrat-primary text-white'
                : 'border-gray-300 hover:border-socrat-primary/50',
            )}
            aria-label={selected ? 'Убрать из выбранных' : 'Выбрать'}
          >
            {selected && <Check className="h-3 w-3" />}
          </button>
        )}
        <SourceBadge source={source} />
        {sourceLabel && (
          <span
            className="max-w-[140px] truncate text-[11px] text-muted-foreground"
            title={`Источник: ${sourceLabel}`}
          >
            {sourceLabel}
          </span>
        )}
        {task.kim_number != null && (
          <span className="text-[11px] text-muted-foreground">
            КИМ №{task.kim_number}
          </span>
        )}
        {task.difficulty != null && (
          <span className="rounded bg-socrat-folder-bg px-1.5 py-0.5 text-[10px] font-semibold text-socrat-folder">
            Сложность {task.difficulty}
          </span>
        )}
        <div className="flex-1" />
        <Button
          size="sm"
          variant={added ? 'ghost' : 'outline'}
          className={cn(
            'shrink-0 gap-1 text-xs',
            added && 'pointer-events-none text-socrat-primary',
          )}
          onClick={() => onAdd(task)}
          disabled={added}
        >
          {added ? (
            <>
              <Check className="h-3.5 w-3.5" />
              Добавлено
            </>
          ) : (
            <>
              <Plus className="h-3.5 w-3.5" />
              В ДЗ
            </>
          )}
        </Button>
      </div>

      {/* Task text */}
      {!isImageOnly && task.text ? (
        <MathText text={task.text} className="line-clamp-3 text-sm leading-snug text-gray-800" />
      ) : !isImageOnly && (
        <p className="text-sm text-gray-400">Без текста</p>
      )}

      {/* Full-width image below text */}
      {thumbUrl ? (
        <img
          src={thumbUrl}
          alt="Вложение к задаче"
          loading="lazy"
          className={cn(
            'w-full rounded-xl border border-gray-200 bg-gray-50 object-contain',
            isImageOnly ? 'max-h-64' : 'max-h-48',
          )}
        />
      ) : attachmentRefs.length > 0 ? (
        <div className="flex h-24 w-full items-center justify-center rounded-xl border border-gray-200 bg-gray-50">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : null}
    </div>
  );
});

// ─── Catalog browser ─────────────────────────────────────────────────────────

function CatalogBrowser({
  addedIds,
  onAddTasks,
  topicHint,
  defaultSubject,
  defaultExam,
  tutorSubjects,
}: {
  addedIds: Set<string>;
  onAddTasks: (tasks: KBTask[]) => void;
  topicHint?: string;
  /** Предмет ДЗ — фильтр по умолчанию (репетитор его переключает). */
  defaultSubject?: string;
  /** Экзамен ДЗ — фильтр по умолчанию; олимпиады выбираются вручную. */
  defaultExam?: CatalogFilter;
  /** Предметы профиля — попадают в pills (персонализация). */
  tutorSubjects?: readonly string[];
}) {
  const [selectedTopicId, setSelectedTopicId] = useState<string | undefined>();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [subtopicFilter, setSubtopicFilter] = useState<string | null>(null);
  // Структура «предмет → экзамен → раздел → тема» — та же, что на витрине Базы
  // (репорт Ульяны 2026-07-23: пикер показывал темы ВСЕХ предметов и всех
  // экзаменов одним плоским списком). Дефолты берутся из ДЗ; переключатели
  // видны — задачу из другого раздела взять по-прежнему можно.
  const [subject, setSubject] = useState<string>(defaultSubject ?? DEFAULT_KB_SUBJECT);
  const [examFilter, setExamFilter] = useState<CatalogFilter>(defaultExam ?? 'ege');
  const [topicQuery, setTopicQuery] = useState('');

  // Предмет/экзамен ДЗ резолвятся асинхронно (профиль, prefill шаблона) — если
  // они приехали ПОСЛЕ монтирования, подхватываем, пока репетитор сам не
  // переключил фильтр (иначе клоббер выбора — класс багов конструктора).
  const filtersTouchedRef = useRef(false);
  useEffect(() => {
    if (filtersTouchedRef.current) return;
    if (defaultSubject) setSubject(defaultSubject);
    if (defaultExam) setExamFilter(defaultExam);
  }, [defaultSubject, defaultExam]);

  const handleSubjectChange = useCallback((next: string) => {
    filtersTouchedRef.current = true;
    setSubject(next);
    setSelectedTopicId(undefined);
    setSubtopicFilter(null);
    setSelectedIds(new Set());
  }, []);

  const handleExamChange = useCallback((next: CatalogFilter) => {
    filtersTouchedRef.current = true;
    setExamFilter(next);
    setSelectedTopicId(undefined);
    setSubtopicFilter(null);
    setSelectedIds(new Set());
  }, []);

  const { topics, loading: topicsLoading } = useTopics(examFilter, subject);
  // Отдельный «тихий» запрос ВСЕХ тем — только чтобы pills показали предметы, у
  // которых контент есть (тот же кэш-ключ, что у витрины: справочник, quiet).
  const { topics: allTopics } = useTopics();
  const { subtopics } = useSubtopics(selectedTopicId);
  const { tasks, loading: tasksLoading } = useCatalogTasks(selectedTopicId);

  const subtopicCounts = useMemo(() => countTasksBySubtopic(tasks), [tasks]);
  const subtopicOrder = useMemo(
    () => new Map(subtopics.map((s) => [s.id, s.sort_order])),
    [subtopics],
  );
  const visibleTasks = useMemo(() => {
    if (subtopicFilter === null) return tasks;
    if (subtopicFilter === NO_SUBTOPIC_FILTER) return tasks.filter((t) => !t.subtopic_id);
    return tasks.filter((t) => t.subtopic_id === subtopicFilter);
  }, [tasks, subtopicFilter]);
  // Олимпиадные темы группируются по подтеме + сортируются по сложности
  // (как в CatalogTopicPage); экзаменационные — по № КИМ.
  const isOlympiad = useMemo(
    () => topics.find((t) => t.id === selectedTopicId)?.kind === 'olympiad',
    [topics, selectedTopicId],
  );
  const taskGroups = useMemo(
    () =>
      isOlympiad
        ? groupTasksBySubtopic(visibleTasks, subtopics)
        : groupTasksByKim(visibleTasks, subtopicOrder),
    [isOlympiad, visibleTasks, subtopics, subtopicOrder],
  );

  // Сменить подтему/тему — сбросить batch-выбор (selection всегда в рамках текущего вида).
  const handleSelectSubtopic = useCallback((id: string | null) => {
    setSubtopicFilter(id);
    setSelectedIds(new Set());
  }, []);

  // Предметы, по которым в каталоге реально есть темы → в pills (вместе с
  // якорными и предметами профиля; логика union — в общем компоненте).
  const allTopicSubjects = useMemo(() => allTopics.map((t) => t.subject), [allTopics]);

  // Поиск по темам/подтемам — локальный, по уже загруженному списку предмета.
  const visibleTopics = useMemo(() => {
    const q = topicQuery.trim().toLowerCase();
    if (!q) return topics;
    return topics.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.section.toLowerCase().includes(q) ||
        (t.subtopic_names ?? []).some((n) => n.toLowerCase().includes(q)),
    );
  }, [topics, topicQuery]);

  const topicSections = useMemo(() => groupTopicsBySection(visibleTopics), [visibleTopics]);

  // Auto-select topic matching hint (one-time, after topics load)
  const hintMatchedTopicId = useMemo(() => {
    if (!topicHint || !topics.length) return undefined;
    const lower = topicHint.toLowerCase();
    const match = topics.find((t) => t.name.toLowerCase().includes(lower));
    return match?.id;
  }, [topicHint, topics]);

  useEffect(() => {
    if (hintMatchedTopicId && !selectedTopicId) {
      setSelectedTopicId(hintMatchedTopicId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time auto-select
  }, [hintMatchedTopicId]);

  const toggleSelect = useCallback((taskId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  // W3.4: стабильный per-task хендлер — memo(PickerTaskCard) работает.
  const handleAddOne = useCallback((task: KBTask) => onAddTasks([task]), [onAddTasks]);

  const handleBatchAdd = useCallback(() => {
    const toAdd = visibleTasks.filter(
      (t) => selectedIds.has(t.id) && !addedIds.has(t.id),
    );
    if (toAdd.length > 0) onAddTasks(toAdd);
    setSelectedIds(new Set());
  }, [visibleTasks, selectedIds, addedIds, onAddTasks]);

  const availableTasks = visibleTasks.filter((t) => !addedIds.has(t.id));
  const showBatch = availableTasks.length >= 3;
  const batchCount = [...selectedIds].filter(
    (id) => !addedIds.has(id),
  ).length;

  // Topic list view — предмет → экзамен → раздел → тема (структура витрины).
  if (!selectedTopicId) {
    const filters = (
      <div className="space-y-3">
        <SubjectPills
          value={subject}
          onChange={handleSubjectChange}
          topicSubjects={allTopicSubjects}
          tutorSubjects={tutorSubjects}
          aria-label="Предмет каталога"
        />
        <FilterChips
          selected={examFilter}
          onChange={(key) => handleExamChange(key as CatalogFilter)}
          options={[
            { key: 'ege', label: 'ЕГЭ', activeClassName: 'text-socrat-ege' },
            { key: 'oge', label: 'ОГЭ', activeClassName: 'text-socrat-oge' },
            { key: 'olympiad', label: 'Олимпиады', activeClassName: 'text-socrat-folder' },
          ]}
        />
        {/* Поиск по темам — локальный по уже загруженному списку предмета,
            без нового запроса (у физики 30+ тем, скролл утомляет). */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={topicQuery}
            onChange={(e) => setTopicQuery(e.target.value)}
            placeholder="Поиск по темам и подтемам..."
            aria-label="Поиск по темам"
            // 16px — иначе iOS Safari зумит поле (rule 80).
            className="h-10 w-full rounded-lg border border-socrat-border bg-white pl-9 pr-3 text-base text-slate-800 placeholder:text-muted-foreground focus:border-socrat-primary focus:outline-none focus:ring-2 focus:ring-socrat-primary/20 [touch-action:manipulation]"
          />
        </div>
      </div>
    );

    if (topicsLoading) {
      return (
        <div className="space-y-3">
          {filters}
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {filters}

        {topicSections.map(([section, sectionTopics]) => (
          <section key={section}>
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {section}
            </h3>
            <div className="space-y-1.5">
              {sectionTopics.map((topic) => (
                <TopicRow
                  key={topic.id}
                  topic={topic}
                  onClick={() => {
                    setSelectedTopicId(topic.id);
                    setSubtopicFilter(null);
                    setSelectedIds(new Set());
                  }}
                />
              ))}
            </div>
          </section>
        ))}

        {visibleTopics.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {topicQuery.trim()
              ? 'Ничего не найдено — измените запрос'
              : `По ${getSubjectDative(subject)} ${
                  examFilter === 'olympiad'
                    ? 'олимпиадных тем пока нет'
                    : `тем ${examFilter === 'oge' ? 'ОГЭ' : 'ЕГЭ'} пока нет`
                }`}
          </p>
        )}
      </div>
    );
  }

  // Task list view
  const selectedTopic = topics.find((t) => t.id === selectedTopicId);

  return (
    <div className="space-y-3">
      <button
        type="button"
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => {
          setSelectedTopicId(undefined);
          setSubtopicFilter(null);
          setSelectedIds(new Set());
        }}
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {selectedTopic?.name ?? 'Назад'}
      </button>

      {subtopics.length > 0 && (
        <SubtopicFilterChips
          subtopics={subtopics}
          counts={subtopicCounts}
          activeId={subtopicFilter}
          onSelect={handleSelectSubtopic}
        />
      )}

      {tasksLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {showBatch && (
            <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
              <button
                type="button"
                className="text-xs text-socrat-primary hover:underline"
                onClick={() => {
                  if (batchCount === availableTasks.length) {
                    setSelectedIds(new Set());
                  } else {
                    setSelectedIds(new Set(availableTasks.map((t) => t.id)));
                  }
                }}
              >
                {batchCount === availableTasks.length
                  ? 'Снять все'
                  : `Выбрать все (${availableTasks.length})`}
              </button>
              {batchCount > 0 && (
                <Button
                  size="sm"
                  className="gap-1 bg-socrat-primary text-xs hover:bg-socrat-primary/90"
                  onClick={handleBatchAdd}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Добавить выбранные ({batchCount})
                </Button>
              )}
            </div>
          )}

          <CatalogTaskGroups
            key={selectedTopicId}
            groups={taskGroups}
            groupBodyClassName="flex flex-col gap-2"
            renderTask={(task) => (
              <PickerTaskCard
                task={task}
                added={addedIds.has(task.id)}
                selected={selectedIds.has(task.id)}
                showCheckbox={showBatch}
                onAdd={handleAddOne}
                onToggleSelect={toggleSelect}
              />
            )}
          />

          {tasks.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Нет задач по этой теме
            </p>
          ) : visibleTasks.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Нет задач по выбранной подтеме
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

// ─── Topic row ───────────────────────────────────────────────────────────────

function TopicRow({
  topic,
  onClick,
}: {
  topic: KBTopicWithCounts;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center justify-between rounded-lg border border-socrat-border bg-white px-3 py-2.5 text-left transition-colors hover:border-socrat-primary/25 hover:bg-socrat-primary/[0.02]"
      onClick={onClick}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-gray-800">
          {topic.name}
        </p>
        <p className="text-xs text-muted-foreground">
          {topic.task_count}{' '}
          {topic.task_count === 1
            ? 'задача'
            : topic.task_count < 5
              ? 'задачи'
              : 'задач'}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

// ─── Folder browser (Моя база) ──────────────────────────────────────────────

function FolderBrowser({
  addedIds,
  onAddTasks,
}: {
  addedIds: Set<string>;
  onAddTasks: (tasks: KBTask[]) => void;
}) {
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { folders: rootFolders, loading: rootLoading } = useRootFolders();
  const {
    folder,
    children,
    tasks,
    breadcrumbs,
    loading: folderLoading,
  } = useFolder(currentFolderId);

  const toggleSelect = useCallback((taskId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  // W3.4: стабильный per-task хендлер — memo(PickerTaskCard) работает.
  const handleAddOne = useCallback((task: KBTask) => onAddTasks([task]), [onAddTasks]);

  const handleBatchAdd = useCallback(() => {
    const toAdd = tasks.filter(
      (t) => selectedIds.has(t.id) && !addedIds.has(t.id),
    );
    if (toAdd.length > 0) onAddTasks(toAdd);
    setSelectedIds(new Set());
  }, [tasks, selectedIds, addedIds, onAddTasks]);

  // Root folders view
  if (!currentFolderId) {
    if (rootLoading) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      );
    }

    return (
      <div className="space-y-1.5">
        {rootFolders.map((f) => (
          <FolderRow
            key={f.id}
            name={f.name}
            taskCount={f.task_count}
            onClick={() => setCurrentFolderId(f.id)}
          />
        ))}
        {rootFolders.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Нет папок в личной базе
          </p>
        )}
      </div>
    );
  }

  // Folder detail view
  const availableTasks = tasks.filter((t) => !addedIds.has(t.id));
  const showBatch = availableTasks.length >= 3;
  const batchCount = [...selectedIds].filter(
    (id) => !addedIds.has(id),
  ).length;

  if (folderLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 text-sm">
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => {
            setCurrentFolderId(undefined);
            setSelectedIds(new Set());
          }}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        {breadcrumbs.map((bc, i) => (
          <span key={bc.id} className="flex items-center gap-1">
            {i > 0 && (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )}
            <button
              type="button"
              className={cn(
                'text-xs',
                i === breadcrumbs.length - 1
                  ? 'font-medium text-gray-800'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setCurrentFolderId(bc.id)}
            >
              {bc.name}
            </button>
          </span>
        ))}
      </div>

      {/* Sub-folders */}
      {children.length > 0 && (
        <div className="space-y-1.5">
          {children.map((c) => (
            <FolderRow
              key={c.id}
              name={c.name}
              taskCount={c.task_count}
              onClick={() => {
                setCurrentFolderId(c.id);
                setSelectedIds(new Set());
              }}
            />
          ))}
        </div>
      )}

      {/* Batch bar */}
      {showBatch && (
        <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
          <button
            type="button"
            className="text-xs text-socrat-primary hover:underline"
            onClick={() => {
              if (batchCount === availableTasks.length) {
                setSelectedIds(new Set());
              } else {
                setSelectedIds(new Set(availableTasks.map((t) => t.id)));
              }
            }}
          >
            {batchCount === availableTasks.length
              ? 'Снять все'
              : `Выбрать все (${availableTasks.length})`}
          </button>
          {batchCount > 0 && (
            <Button
              size="sm"
              className="gap-1 bg-socrat-primary text-xs hover:bg-socrat-primary/90"
              onClick={handleBatchAdd}
            >
              <Plus className="h-3.5 w-3.5" />
              Добавить выбранные ({batchCount})
            </Button>
          )}
        </div>
      )}

      {/* Tasks */}
      <div className="space-y-2">
        {tasks.map((task) => (
          <PickerTaskCard
            key={task.id}
            task={task}
            added={addedIds.has(task.id)}
            selected={selectedIds.has(task.id)}
            showCheckbox={showBatch}
            onAdd={handleAddOne}
            onToggleSelect={toggleSelect}
          />
        ))}
      </div>

      {tasks.length === 0 && children.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Папка пуста
        </p>
      )}
    </div>
  );
}

function FolderRow({
  name,
  taskCount,
  onClick,
}: {
  name: string;
  taskCount: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2.5 rounded-lg border border-socrat-border bg-white px-3 py-2.5 text-left transition-colors hover:border-socrat-folder/30 hover:bg-socrat-folder/[0.03]"
      onClick={onClick}
    >
      <Folder className="h-4 w-4 shrink-0 text-socrat-folder" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-800">{name}</p>
        {taskCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {taskCount}{' '}
            {taskCount === 1
              ? 'задача'
              : taskCount < 5
                ? 'задачи'
                : 'задач'}
          </p>
        )}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function KBPickerSheet({
  open,
  onOpenChange,
  onAddTasks,
  addedKbTaskIds,
  topicHint,
  subject,
  examType,
}: KBPickerSheetProps) {
  const [tab, setTab] = useState<Tab>('catalog');
  const { data: tutorProfile } = useTutorProfile();
  // Олимпиадный дефолт не выводим из ДЗ: `exam_type` у ДЗ — только ЕГЭ/ОГЭ.
  const defaultExam: CatalogFilter | undefined =
    examType === 'ege' || examType === 'oge' ? examType : undefined;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-[75vw] !max-w-none flex-col gap-0 p-0"
      >
        <SheetHeader className="border-b px-4 pb-3 pt-4">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Library className="h-4.5 w-4.5 text-socrat-primary" />
            База задач
          </SheetTitle>

          {/* Tabs */}
          <div className="mt-2 flex gap-1 rounded-lg bg-gray-100 p-0.5">
            <button
              type="button"
              className={cn(
                'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                tab === 'catalog'
                  ? 'bg-white text-gray-800 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700',
              )}
              onClick={() => setTab('catalog')}
            >
              Каталог Сократ AI
            </button>
            <button
              type="button"
              className={cn(
                'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                tab === 'my'
                  ? 'bg-white text-gray-800 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700',
              )}
              onClick={() => setTab('my')}
            >
              Моя база
            </button>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {tab === 'catalog' ? (
            <CatalogBrowser
              addedIds={addedKbTaskIds}
              onAddTasks={onAddTasks}
              topicHint={topicHint}
              defaultSubject={subject}
              defaultExam={defaultExam}
              tutorSubjects={tutorProfile?.subjects}
            />
          ) : (
            <FolderBrowser addedIds={addedKbTaskIds} onAddTasks={onAddTasks} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
