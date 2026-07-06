import { type Dispatch, type SetStateAction, useState, useCallback, useMemo, useRef, memo, lazy, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, Library } from 'lucide-react';
import { toast } from 'sonner';
import { deleteTutorHomeworkTaskImage } from '@/lib/tutorHomeworkApi';
import type { KBTask } from '@/types/kb';
import { getKBImageSignedUrl } from '@/lib/kbApi';
import {
  parseAttachmentUrls,
  serializeAttachmentUrls,
  MAX_TASK_IMAGES,
  MAX_SOLUTION_IMAGES,
  MAX_RUBRIC_IMAGES,
} from '@/lib/attachmentRefs';
import { KBPickerSheet } from '@/components/tutor/KBPickerSheet';
import { HWTaskCard } from './HWTaskCard';
import { type DraftTask, computeTaskContentFingerprint, createEmptyTask, generateUUID, isCriteriaEligibleTask, revokeObjectUrl } from './types';

// Lazy-load the Save-to-KB dialog — it's only needed when the tutor actually
// clicks BookmarkPlus on a task card in edit-mode. Bundle stays slim for the
// common «create ДЗ from scratch» path (performance.md: heavy dialogs behind
// React.lazy + Suspense).
const SaveTasksToKBDialog = lazy(() =>
  import('@/components/tutor/homework-reuse/SaveTasksToKBDialog').then((m) => ({
    default: m.SaveTasksToKBDialog,
  })),
);

function inferCheckFormat(kimNumber: number | null): 'short_answer' | 'detailed_solution' {
  if (kimNumber && kimNumber >= 21 && kimNumber <= 26) return 'detailed_solution';
  return 'short_answer';
}

/** Map legacy KB answer_format values to check_format enum */
function mapAnswerFormatToCheckFormat(af: string | null): 'short_answer' | 'detailed_solution' | null {
  if (!af) return null;
  if (af === 'short_answer' || af === 'detailed_solution') return af;
  if (af === 'detailed') return 'detailed_solution';
  // number, text, choice, matching → short answer
  return 'short_answer';
}

// Job: Быстро добавить задачу из базы в черновик ДЗ
/**
 * Возвращает `{ draft, truncatedFrom }`. `truncatedFrom` установлен в исходное
 * число фото, если KB-задача имела больше `MAX_TASK_IMAGES` — вызывающая сторона
 * решает, показать toast или нет (spec §3 «KB-импорт»).
 */
function kbTaskToDraftTask(
  task: KBTask,
): {
  draft: DraftTask;
  truncatedFrom: number | null;
  solutionTruncatedFrom: number | null;
  rubricTruncatedFrom: number | null;
} {
  const refs = parseAttachmentUrls(task.attachment_url);
  const slicedRefs = refs.slice(0, MAX_TASK_IMAGES);
  const taskImagePath = serializeAttachmentUrls(slicedRefs);
  const firstRef = slicedRefs[0] ?? null;
  const truncatedFrom = refs.length > MAX_TASK_IMAGES ? refs.length : null;

  // Solution images from KB — symmetric truncation to MAX_SOLUTION_IMAGES (5).
  // Without this, import silently accepts >5 photos and save fails at backend
  // validation (plan wild-swinging-nova.md P1-5 fix).
  const solutionRefs = parseAttachmentUrls(task.solution_attachment_url);
  const slicedSolutionRefs = solutionRefs.slice(0, MAX_SOLUTION_IMAGES);
  const solutionImagePaths = serializeAttachmentUrls(slicedSolutionRefs);
  const solutionTruncatedFrom = solutionRefs.length > MAX_SOLUTION_IMAGES ? solutionRefs.length : null;

  // Rubric (критерии) from KB — field-parity fix (2026-06-03), баг #2 «добавила
  // из базы, критерии не прикрепились». «Моя база» хранит рубрику; импорт копирует
  // её в черновик. Truncation до MAX_RUBRIC_IMAGES (3) — иначе backend validator
  // 400'нит на сохранении.
  const rubricRefs = parseAttachmentUrls(task.rubric_image_urls);
  const slicedRubricRefs = rubricRefs.slice(0, MAX_RUBRIC_IMAGES);
  const rubricImagePaths = serializeAttachmentUrls(slicedRubricRefs);
  const rubricTruncatedFrom = rubricRefs.length > MAX_RUBRIC_IMAGES ? rubricRefs.length : null;

  const checkFormat: 'short_answer' | 'detailed_solution' =
    (task.check_format === 'short_answer' || task.check_format === 'detailed_solution' ? task.check_format : null)
    ?? mapAnswerFormatToCheckFormat(task.answer_format)
    ?? inferCheckFormat(task.kim_number);

  // unified-task-model F2 (2026-07-05): классификация едет из Базы в каскад
  // конструктора (Тип/КИМ уже редактируемы в карточке; Тема/Подтема/Источник —
  // для зеркала при пересохранении и для publish-требования темы).
  const exam: DraftTask['exam'] = task.exam === 'ege' || task.exam === 'oge'
    ? task.exam
    : (task.difficulty != null ? 'olympiad' : '');

  const draftBase = {
    localId: generateUUID(),
    task_text: task.text,
      task_image_path: taskImagePath,
      // Legacy single-photo metadata — заполняем из первого ref'а для backward compat
      // (остальные фото рендерятся через parseAttachmentUrls(task_image_path) в HWTaskCard).
      task_image_name: firstRef?.split('/').pop() ?? null,
      task_image_preview_url: null,
      task_image_used_fallback: false,
      correct_answer: task.answer ?? '',
      // Field-parity fix (2026-06-03): рубрика теперь переносится из «Моей базы».
      rubric_text: task.rubric_text ?? '',
      rubric_image_paths: rubricImagePaths,
      // KB solution → auto-fill "Эталонное решение для AI" (P0 + KB-мост, 2026-04-18).
      // До этой итерации kb_snapshot_solution* теряли данные между draft и backend;
      // теперь копируем в solution_* и они сохраняются в homework_tutor_tasks.
      solution_text: task.solution ?? '',
      solution_image_paths: solutionImagePaths,
      max_score: task.primary_score ?? 1,
      uploading: false,
      check_format: checkFormat,
      // unified-task-model F1 (2026-07-05): AI-настройка Базы едет в ДЗ целиком.
      task_kind: task.task_kind === 'speaking' ? 'speaking' as const : undefined,
      cefr_level: task.cefr_level ?? undefined,
      grading_criteria_json: Array.isArray(task.grading_criteria_json) && task.grading_criteria_json.length > 0
        ? task.grading_criteria_json
        : null,
      // Phase 2 (2026-06-21): переносим № КИМ в ДЗ → AI грейдит по критериям ФИПИ.
      kim_number: task.kim_number ?? null,
      kb_task_id: task.id,
      kb_source: task.owner_id ? 'my' : 'socrat',
      kb_snapshot_text: task.text,
      kb_snapshot_answer: task.answer ?? null,
      kb_snapshot_solution: task.solution ?? null,
      kb_snapshot_solution_image_refs: task.solution_attachment_url ?? null,
      kb_source_label: task.source_label ?? null,
      // Провенанс: сохраняем тот же dual-format snapshot, что и в task_image_path.
      kb_attachment_url: taskImagePath,
      // unified-task-model F2: классификация каскада.
      exam,
      difficulty: task.difficulty ?? null,
      topic_id: task.topic_id ?? null,
      subtopic_id: task.subtopic_id ?? null,
      source_label: task.source_label ?? null,
    } satisfies DraftTask;

  return {
    draft: {
      ...draftBase,
      // Fingerprint контента на момент импорта — база divergence-детекта
      // «Обновить в Базе» (кнопка видна только при реальном расхождении).
      kb_content_fingerprint: computeTaskContentFingerprint(draftBase),
    },
    truncatedFrom,
    solutionTruncatedFrom,
    rubricTruncatedFrom,
  };
}

function isEmptyTask(t: DraftTask): boolean {
  return !t.task_text.trim() && !t.task_image_path && !t.correct_answer.trim() && !t.kb_task_id;
}

// ─── Memo-обёртка карточки (ревью-фикс P1, 2026-07-06) ───────────────────────
// HWTaskCard (rule-40 high-risk) НЕ трогаем — memo живёт в обёртке: она
// получает СТАБИЛЬНЫЕ per-index диспатчеры и собирает per-card замыкания
// внутри. Ре-рендерится только карточка, чей `task` реально изменился
// (раньше 15-30 карточек с каскадом перерисовывались на каждый keystroke).

interface TaskCardRowProps {
  task: DraftTask;
  index: number;
  count: number;
  disableExistingTaskRemove?: boolean;
  onDeferImageDelete?: (storagePath: string) => void;
  onUpdateAt: (idx: number, t: DraftTask) => void;
  onRemoveAt: (idx: number) => void;
  onMoveAt: (fromIdx: number, toIdx: number) => void;
  onRequestSaveToKB?: (task: DraftTask) => void;
  onRequestPushToKB?: (task: DraftTask) => void;
  voiceSpeakingEnabled: boolean;
  cefrLevelEnabled: boolean;
}

const TaskCardRow = memo(function TaskCardRow({
  task,
  index,
  count,
  disableExistingTaskRemove,
  onDeferImageDelete,
  onUpdateAt,
  onRemoveAt,
  onMoveAt,
  onRequestSaveToKB,
  onRequestPushToKB,
  voiceSpeakingEnabled,
  cefrLevelEnabled,
}: TaskCardRowProps) {
  const handleUpdate = useCallback((t: DraftTask) => onUpdateAt(index, t), [onUpdateAt, index]);
  const handleRemove = useCallback(() => onRemoveAt(index), [onRemoveAt, index]);
  const handleMoveUp = useCallback(() => onMoveAt(index, index - 1), [onMoveAt, index]);
  const handleMoveDown = useCallback(() => onMoveAt(index, index + 1), [onMoveAt, index]);

  return (
    <HWTaskCard
      task={task}
      index={index}
      onUpdate={handleUpdate}
      onRemove={handleRemove}
      canRemove={count > 1 && !(disableExistingTaskRemove && task.id)}
      onDeferImageDelete={onDeferImageDelete}
      onMoveUp={handleMoveUp}
      onMoveDown={handleMoveDown}
      isFirst={index === 0}
      isLast={index === count - 1}
      onRequestSaveToKB={onRequestSaveToKB}
      onRequestPushToKB={onRequestPushToKB}
      voiceSpeakingEnabled={voiceSpeakingEnabled}
      cefrLevelEnabled={cefrLevelEnabled}
      criteriaEditorEnabled={isCriteriaEligibleTask(task)}
    />
  );
});

export interface HWTasksSectionProps {
  tasks: DraftTask[];
  /**
   * Ревью-фикс P1 (2026-07-06): Dispatch-тип (принимает и массив, и updater) —
   * functional-обновления дают СТАБИЛЬНЫЕ per-card колбэки → memo(TaskCardRow)
   * реально работает (иначе 15-30 карточек ре-рендерились на каждый keystroke).
   * Родитель (TutorHomeworkCreate) передаёт setTasks как есть.
   */
  onChange: Dispatch<SetStateAction<DraftTask[]>>;
  errors: Record<string, string>;
  topicHint?: string;
  /** Disable removing existing tasks (e.g. when submissions exist) */
  disableExistingTaskRemove?: boolean;
  /** Disable adding new tasks (e.g. when submissions exist) */
  disableTaskAdd?: boolean;
  /** When set, defer storage image deletes instead of executing immediately (edit mode safety) */
  onDeferImageDelete?: (storagePath: string) => void;
  /** When true, show confirm dialog before removing a task (active HW) */
  confirmOnRemove?: boolean;
  /**
   * homework-reuse-v1 TASK-5 (AC-13): enables per-task «Сохранить в базу»
   * action. Must be the persisted assignment UUID so backend handler can
   * validate ownership + resolve tasks. When absent (новое ДЗ без id), per-
   * task BookmarkPlus icon скрывается — dialog требует реальный assignmentId.
   */
  assignmentId?: string | null;
  /**
   * voice-speaking-mvp: passes through to each HWTaskCard to surface the
   * «Устный ответ (монолог)» task-type option. Off by default (pilot tutors only).
   */
  voiceSpeakingEnabled?: boolean;
  /**
   * unified-task-model F2 (2026-07-05): «Обновить в Базе» / «Своя копия» на
   * карточке (edit-mode; parent владеет API-вызовом + dirty-гейтом). Пробрасывается
   * в HWTaskCard как есть.
   */
  onRequestPushToKB?: (task: DraftTask) => void;
  /**
   * CEFR-level fix: passes through to each HWTaskCard to surface the «Уровень»
   * (CEFR) selector. On for foreign-language subjects (french/english/spanish).
   */
  cefrLevelEnabled?: boolean;
}

export function HWTasksSection({
  tasks,
  onChange,
  errors,
  topicHint,
  disableExistingTaskRemove,
  disableTaskAdd,
  onDeferImageDelete,
  confirmOnRemove,
  assignmentId,
  onRequestPushToKB,
  voiceSpeakingEnabled = false,
  cefrLevelEnabled = false,
}: HWTasksSectionProps) {
  const [kbPickerOpen, setKbPickerOpen] = useState(false);
  const [saveToKbTask, setSaveToKbTask] = useState<DraftTask | null>(null);

  const handleRequestSaveToKB = useCallback(
    (task: DraftTask) => {
      if (!assignmentId || !task.id) return;
      setSaveToKbTask(task);
    },
    [assignmentId],
  );

  const handleAdd = useCallback(() => {
    onChange((prev) => [...prev, createEmptyTask()]);
  }, [onChange]);

  const handleAddFromKB = useCallback(
    async (kbTasks: KBTask[]) => {
      const converted = kbTasks
        .filter((t) => !tasks.some((d) => d.kb_task_id === t.id))
        .map(kbTaskToDraftTask);
      if (converted.length === 0) return;

      const newDrafts = converted.map((c) => c.draft);

      // Surface truncation per task (spec §3 «KB-импорт»: импортируем первые N
      // и показываем toast `Из БЗ импортировано N из M фото`). Separately for
      // condition photos and reference-solution photos (plan wild-swinging-nova.md P1-5).
      for (const { truncatedFrom, solutionTruncatedFrom, rubricTruncatedFrom } of converted) {
        if (truncatedFrom !== null) {
          toast.info(
            `Из БЗ импортировано ${MAX_TASK_IMAGES} из ${truncatedFrom} фото условия`,
          );
        }
        if (solutionTruncatedFrom !== null) {
          toast.info(
            `Из БЗ импортировано ${MAX_SOLUTION_IMAGES} из ${solutionTruncatedFrom} фото решения`,
          );
        }
        if (rubricTruncatedFrom !== null) {
          toast.info(
            `Из БЗ импортировано ${MAX_RUBRIC_IMAGES} из ${rubricTruncatedFrom} фото критериев`,
          );
        }
      }

      // Resolve signed URL for the first KB attachment (превью в legacy-слоте).
      // Остальные фото резолвятся внутри HWTaskCard на рендере галереи.
      await Promise.all(
        newDrafts.map(async (draft) => {
          const firstRef = parseAttachmentUrls(draft.task_image_path)[0];
          if (firstRef) {
            const url = await getKBImageSignedUrl(firstRef);
            if (url) draft.task_image_preview_url = url;
          }
        }),
      );

      // Remove empty placeholder tasks. Functional updater (ревью-фикс P1
      // 2026-07-06): выше был await (signed URL) — снимок tasks на момент
      // вызова мог устареть (тутор правил карточки), array-форма затёрла бы
      // его правки (тот же класс race, что Phase-10 P0). Дедуп по kb_task_id
      // повторяем на живом prev (после await мог добавиться тот же id).
      onChange((prev) => {
        const kept = prev.filter((t) => !isEmptyTask(t));
        const existingIds = new Set(kept.filter((t) => t.kb_task_id).map((t) => t.kb_task_id));
        return [...kept, ...newDrafts.filter((d) => !d.kb_task_id || !existingIds.has(d.kb_task_id))];
      });
      toast.success(
        newDrafts.length === 1
          ? 'Задача добавлена в ДЗ'
          : `Добавлено задач: ${newDrafts.length}`,
      );
    },
    [tasks, onChange],
  );

  const addedKbTaskIds = useMemo(
    () => new Set(tasks.filter((t) => t.kb_task_id).map((t) => t.kb_task_id!)),
    [tasks],
  );

  // Ревью-фикс P1 (2026-07-06): СТАБИЛЬНЫЕ per-index хендлеры (functional
  // updater, без deps на tasks) → memo(TaskCardRow) не инвалидируется на
  // каждый keystroke. Side-effect-данные (cleanup при удалении) читаются из
  // ref-зеркала, НЕ внутри updater'а (StrictMode double-invoke).
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const handleMove = useCallback(
    (fromIdx: number, toIdx: number) => {
      onChange((prev) => {
        if (toIdx < 0 || toIdx >= prev.length) return prev;
        const next = [...prev];
        const [moved] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, moved);
        return next;
      });
    },
    [onChange],
  );

  const handleUpdate = useCallback(
    (idx: number, updated: DraftTask) => {
      onChange((prev) => prev.map((t, i) => (i === idx ? updated : t)));
    },
    [onChange],
  );

  const handleRemove = useCallback(
    (idx: number) => {
      if (confirmOnRemove && !window.confirm('Удалить задачу? Ученики могут потерять прогресс по ней.')) {
        return;
      }
      const removed = tasksRef.current[idx];
      if (removed?.task_image_path) {
        if (onDeferImageDelete) {
          onDeferImageDelete(removed.task_image_path);
        } else {
          void deleteTutorHomeworkTaskImage(removed.task_image_path);
        }
      }
      revokeObjectUrl(removed?.task_image_preview_url);
      onChange((prev) => prev.filter((_, i) => i !== idx));
    },
    [onChange, confirmOnRemove, onDeferImageDelete],
  );

  return (
    <div className="space-y-4">
      {errors._tasks && (
        <p className="text-sm text-destructive">{errors._tasks}</p>
      )}
      {tasks.map((task, i) => (
        <TaskCardRow
          key={task.localId}
          task={task}
          index={i}
          count={tasks.length}
          disableExistingTaskRemove={disableExistingTaskRemove}
          onDeferImageDelete={onDeferImageDelete}
          onUpdateAt={handleUpdate}
          onRemoveAt={handleRemove}
          onMoveAt={handleMove}
          onRequestSaveToKB={assignmentId ? handleRequestSaveToKB : undefined}
          onRequestPushToKB={onRequestPushToKB}
          voiceSpeakingEnabled={voiceSpeakingEnabled}
          cefrLevelEnabled={cefrLevelEnabled}
        />
      ))}
      {/* unified-task-model F2: новые задачи авто-зеркалятся в Базу при
          сохранении ДЗ (папка «Из ДЗ») — тихая подсказка, не блокер. */}
      {tasks.some((t) => !t.kb_task_id && !isEmptyTask(t)) ? (
        <p className="text-xs text-muted-foreground">
          Новые задачи автоматически сохранятся в вашу Базу (папка «Из ДЗ»).
        </p>
      ) : null}
      {disableTaskAdd && (
        <p className="text-xs text-muted-foreground">
          Нельзя добавлять или удалять задачи — ученики уже отправили ответы.
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="outline" onClick={handleAdd} className="gap-2 flex-1" disabled={disableTaskAdd}>
          <Plus className="h-4 w-4" />
          Добавить задачу
        </Button>
        <Button
          variant="outline"
          onClick={() => setKbPickerOpen(true)}
          className="gap-2 flex-1"
          disabled={disableTaskAdd}
        >
          <Library className="h-4 w-4" />
          Добавить из базы
        </Button>
      </div>
      <KBPickerSheet
        open={kbPickerOpen}
        onOpenChange={setKbPickerOpen}
        onAddTasks={handleAddFromKB}
        addedKbTaskIds={addedKbTaskIds}
        topicHint={topicHint}
      />

      {/* Per-task save-to-KB dialog (homework-reuse-v1 TASK-5, AC-13). Mounted
       * only while user is interacting — keeps tree light when the feature is
       * untouched. `already_in_base_hint` uses kb_source='my' as the
       * optimistic indicator: actual dedup happens backend-side via fingerprint. */}
      {saveToKbTask && assignmentId ? (
        <Suspense fallback={null}>
          <SaveTasksToKBDialog
            open={saveToKbTask !== null}
            onOpenChange={(next) => {
              if (!next) setSaveToKbTask(null);
            }}
            assignmentId={assignmentId}
            mode="single"
            tasks={[
              {
                id: saveToKbTask.id!,
                order_num: tasks.findIndex((t) => t.localId === saveToKbTask.localId) + 1,
                task_text: saveToKbTask.task_text,
                task_image_url: saveToKbTask.task_image_path ?? null,
                already_in_base_hint: saveToKbTask.kb_source === 'my',
              },
            ]}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
