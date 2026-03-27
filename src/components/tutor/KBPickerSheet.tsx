// Job: Быстро добавить задачу из базы в черновик ДЗ (P0.1 wedge)
import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Folder,
  Image as ImageIcon,
  Library,
  Loader2,
  Plus,
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
import { cn } from '@/lib/utils';
import { useTopics, useCatalogTasks, useSubtopics } from '@/hooks/useKnowledgeBase';
import { useRootFolders, useFolder } from '@/hooks/useFolders';
import { getKBImageSignedUrl, parseAttachmentUrls } from '@/lib/kbApi';
import type { KBTask, KBTopicWithCounts, KBFolderWithCounts } from '@/types/kb';

// ─── Types ───────────────────────────────────────────────────────────────────

interface KBPickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Batch-capable callback — receives one or more tasks at once */
  onAddTasks: (tasks: KBTask[]) => void;
  addedKbTaskIds: Set<string>;
  topicHint?: string;
}

type Tab = 'catalog' | 'my';

// ─── Picker task card ────────────────────────────────────────────────────────

function PickerTaskCard({
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
  onAdd: () => void;
  onToggleSelect: () => void;
}) {
  const source = task.owner_id ? 'my' : 'socrat';

  // Resolve attachment thumbnail
  const attachmentRefs = useMemo(
    () => parseAttachmentUrls(task.attachment_url),
    [task.attachment_url],
  );
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!attachmentRefs.length) return;
    let cancelled = false;
    getKBImageSignedUrl(attachmentRefs[0]).then((url) => {
      if (!cancelled) setThumbUrl(url);
    });
    return () => { cancelled = true; };
  }, [attachmentRefs]);

  const isImageOnly = !task.text || task.text === '[Задача на фото]';

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
            onClick={onToggleSelect}
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
        {task.kim_number != null && (
          <span className="text-[11px] text-muted-foreground">
            КИМ №{task.kim_number}
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
          onClick={onAdd}
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
}

// ─── Catalog browser ─────────────────────────────────────────────────────────

function CatalogBrowser({
  addedIds,
  onAddTasks,
  topicHint,
}: {
  addedIds: Set<string>;
  onAddTasks: (tasks: KBTask[]) => void;
  topicHint?: string;
}) {
  const [selectedTopicId, setSelectedTopicId] = useState<string | undefined>();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { topics, loading: topicsLoading } = useTopics(undefined, undefined);
  const { subtopics } = useSubtopics(selectedTopicId);
  const { tasks, loading: tasksLoading } = useCatalogTasks(selectedTopicId);

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

  const handleBatchAdd = useCallback(() => {
    const toAdd = tasks.filter(
      (t) => selectedIds.has(t.id) && !addedIds.has(t.id),
    );
    if (toAdd.length > 0) onAddTasks(toAdd);
    setSelectedIds(new Set());
  }, [tasks, selectedIds, addedIds, onAddTasks]);

  const availableTasks = tasks.filter((t) => !addedIds.has(t.id));
  const showBatch = availableTasks.length >= 3;
  const batchCount = [...selectedIds].filter(
    (id) => !addedIds.has(id),
  ).length;

  // Topic list view
  if (!selectedTopicId) {
    if (topicsLoading) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      );
    }

    return (
      <div className="space-y-1.5">
        {topics.map((topic) => (
          <TopicRow
            key={topic.id}
            topic={topic}
            onClick={() => setSelectedTopicId(topic.id)}
          />
        ))}
        {topics.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Нет тем в каталоге
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
          setSelectedIds(new Set());
        }}
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {selectedTopic?.name ?? 'Назад'}
      </button>

      {subtopics.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {subtopics.map((s) => (
            <span
              key={s.id}
              className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] text-gray-600"
            >
              {s.name}
            </span>
          ))}
        </div>
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

          <div className="space-y-2">
            {tasks.map((task) => (
              <PickerTaskCard
                key={task.id}
                task={task}
                added={addedIds.has(task.id)}
                selected={selectedIds.has(task.id)}
                showCheckbox={showBatch}
                onAdd={() => onAddTasks([task])}
                onToggleSelect={() => toggleSelect(task.id)}
              />
            ))}
          </div>

          {tasks.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Нет задач по этой теме
            </p>
          )}
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
            onAdd={() => onAddTasks([task])}
            onToggleSelect={() => toggleSelect(task.id)}
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
}: KBPickerSheetProps) {
  const [tab, setTab] = useState<Tab>('catalog');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-[75vw] !max-w-none flex-col gap-0 p-0"
      >
        <SheetHeader className="border-b px-4 pb-3 pt-4">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Library className="h-4.5 w-4.5 text-socrat-primary" />
            База знаний
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
              Каталог Сократа
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
            />
          ) : (
            <FolderBrowser addedIds={addedKbTaskIds} onAddTasks={onAddTasks} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
