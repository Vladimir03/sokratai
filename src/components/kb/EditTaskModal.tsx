import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { toast } from 'sonner';
import { useImageUpload } from '@/hooks/useImageUpload';
import { useUpdateTask } from '@/hooks/useKnowledgeBase';
import { MAX_TASK_IMAGES } from '@/lib/attachmentRefs';
import {
  deleteKBTaskImage,
  parseAttachmentUrls,
  serializeAttachmentUrls,
  uploadKBTaskImage,
} from '@/lib/kbApi';
import { getKimPrimaryScore } from '@/lib/kbKimScores';
import { cn } from '@/lib/utils';
import { ImageUploadField } from '@/components/kb/ui/ImageUploadField';
import {
  TaskClassificationFields,
  type TaskClassType,
} from '@/components/kb/TaskClassificationFields';
import type { KBTask, UpdateKBTaskInput } from '@/types/kb';

interface EditTaskModalProps {
  task: KBTask;
  onClose: () => void;
}

/** Normalize legacy Russian answer_format literals to English codes */
function normalizeAnswerFormat(value: string | null): string {
  if (!value) return '';
  const map: Record<string, string> = {
    'число': 'number',
    'выражение': 'text',
    'выбор': 'choice',
    'соответствие': 'matching',
    'развернутое решение': 'detailed',
  };
  return map[value] ?? value;
}

/** Тип задания из существующей задачи: exam → ege/oge; difficulty → olympiad; иначе ''. */
function deriveTaskType(task: KBTask): TaskClassType {
  if (task.exam === 'ege' || task.exam === 'oge') return task.exam;
  if (task.difficulty != null) return 'olympiad';
  return '';
}

export function EditTaskModal({ task, onClose }: EditTaskModalProps) {
  const updateTask = useUpdateTask();

  const [text, setText] = useState(task.text);
  const [answer, setAnswer] = useState(task.answer ?? '');
  const [solution, setSolution] = useState(task.solution ?? '');
  // Field-parity fix (2026-06-03): рубрика — first-class поле задачи в «Моей базе».
  const [rubricText, setRubricText] = useState(task.rubric_text ?? '');

  // Classification (cascade)
  const [taskType, setTaskType] = useState<TaskClassType>(() => deriveTaskType(task));
  const [kimNumber, setKimNumber] = useState(task.kim_number?.toString() ?? '');
  const [difficulty, setDifficulty] = useState(task.difficulty?.toString() ?? '');
  // primaryScore — ручной override (пусто = авто по КИМ). Если сохранённый балл
  // совпадает с авто-баллом ФИПИ (или NULL) — оставляем пусто (покажется чип).
  const [primaryScore, setPrimaryScore] = useState(() => {
    const auto = getKimPrimaryScore(task.exam ?? null, task.kim_number ?? null);
    return task.primary_score != null && task.primary_score !== auto
      ? String(task.primary_score)
      : '';
  });
  const [topicId, setTopicId] = useState(task.topic_id ?? '');
  const [subtopicId, setSubtopicId] = useState(task.subtopic_id ?? '');
  // 'my'/'socrat' — служебные sentinel'ы провенанса, не реальный источник.
  const [sourceLabel, setSourceLabel] = useState(
    task.source_label && task.source_label !== 'my' && task.source_label !== 'socrat'
      ? task.source_label
      : '',
  );
  const [answerFormat, setAnswerFormat] = useState(normalizeAnswerFormat(task.answer_format));

  const [uploading, setUploading] = useState(false);
  const [showAnswerSection, setShowAnswerSection] = useState(false);

  const isBusy = uploading || updateTask.isPending;

  // Image hooks — condition + solution, initialized with existing refs
  const conditionImages = useImageUpload({
    maxImages: MAX_TASK_IMAGES,
    disabled: isBusy,
    initialRefs: parseAttachmentUrls(task.attachment_url),
  });
  const solutionImages = useImageUpload({
    maxImages: MAX_TASK_IMAGES,
    disabled: isBusy,
    initialRefs: parseAttachmentUrls(task.solution_attachment_url),
  });

  // Cascade resets (user-triggered only → safe on mount, no prefill clobber)
  const handleTaskTypeChange = (v: TaskClassType) => {
    setTaskType(v);
    setTopicId('');
    setSubtopicId('');
    setPrimaryScore('');
    if (v === 'olympiad') setKimNumber('');
    else setDifficulty('');
  };
  const handleKimChange = (v: string) => {
    setKimNumber(v);
    setPrimaryScore('');
  };
  const handleTopicChange = (v: string) => {
    setTopicId(v);
    setSubtopicId('');
  };

  // Esc to close + body scroll lock
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const hasImage = conditionImages.totalImages > 0;
  const hasContent = text.trim().length > 0 || hasImage;
  const olympiadNeedsDifficulty = taskType === 'olympiad' && !difficulty.trim();
  const canSave = hasContent && !olympiadNeedsDifficulty;

  const handleSave = async () => {
    if (!canSave) return;

    setUploading(true);
    const conditionUploadedRefs: string[] = [];
    const solutionUploadedRefs: string[] = [];
    try {
      for (const file of conditionImages.getNewFiles()) {
        const result = await uploadKBTaskImage(file);
        conditionUploadedRefs.push(result.storageRef);
      }
      for (const file of solutionImages.getNewFiles()) {
        const result = await uploadKBTaskImage(file);
        solutionUploadedRefs.push(result.storageRef);
      }

      const allConditionRefs = [...conditionImages.getExistingRefs(), ...conditionUploadedRefs];
      const allSolutionRefs = [...solutionImages.getExistingRefs(), ...solutionUploadedRefs];

      const originalConditionRefs = parseAttachmentUrls(task.attachment_url);
      const hasConditionChanges =
        allConditionRefs.length !== originalConditionRefs.length ||
        allConditionRefs.some((r, i) => r !== originalConditionRefs[i]) ||
        conditionImages.getRemovedRefs().length > 0;

      const originalSolutionRefs = parseAttachmentUrls(task.solution_attachment_url);
      const hasSolutionChanges =
        allSolutionRefs.length !== originalSolutionRefs.length ||
        allSolutionRefs.some((r, i) => r !== originalSolutionRefs[i]) ||
        solutionImages.getRemovedRefs().length > 0;

      const taskText = text.trim() || '[Задача на фото]';

      const exam = taskType === 'ege' ? 'ege' : taskType === 'oge' ? 'oge' : null;
      const kimNum =
        taskType !== 'olympiad' && kimNumber.trim() ? parseInt(kimNumber.trim(), 10) : null;

      let difficultyNum: number | null = null;
      let scoreNum: number | null = null;
      if (taskType === 'olympiad') {
        difficultyNum = difficulty.trim() ? parseInt(difficulty.trim(), 10) : null;
        scoreNum = difficultyNum;
      } else {
        const autoScore = getKimPrimaryScore(exam, kimNum);
        const s = primaryScore.trim() || (autoScore != null ? String(autoScore) : '');
        scoreNum = s ? parseInt(s, 10) : null;
      }

      const input: UpdateKBTaskInput = {
        text: taskText,
        answer: answer.trim() || null,
        solution: solution.trim() || null,
        rubric_text: rubricText.trim() || null,
        exam: exam,
        answer_format: answerFormat || null,
        kim_number: kimNum != null && !isNaN(kimNum) ? kimNum : null,
        primary_score: scoreNum != null && !isNaN(scoreNum) ? scoreNum : null,
        difficulty: difficultyNum != null && !isNaN(difficultyNum) ? difficultyNum : null,
        topic_id: topicId || null,
        subtopic_id: subtopicId || null,
        source_label: sourceLabel.trim() || null,
      };

      if (hasConditionChanges) {
        input.attachment_url = serializeAttachmentUrls(allConditionRefs);
      }
      if (hasSolutionChanges) {
        input.solution_attachment_url = serializeAttachmentUrls(allSolutionRefs);
      }

      updateTask.mutate(
        { taskId: task.id, input },
        {
          onSuccess: () => {
            for (const ref of conditionImages.getRemovedRefs()) {
              void deleteKBTaskImage(ref);
            }
            for (const ref of solutionImages.getRemovedRefs()) {
              void deleteKBTaskImage(ref);
            }
            toast.success('Задача обновлена');
            onClose();
          },
          onError: () => {
            for (const ref of conditionUploadedRefs) void deleteKBTaskImage(ref);
            for (const ref of solutionUploadedRefs) void deleteKBTaskImage(ref);
            toast.error('Не удалось обновить задачу');
          },
        },
      );
    } catch {
      for (const ref of conditionUploadedRefs) void deleteKBTaskImage(ref);
      for (const ref of solutionUploadedRefs) void deleteKBTaskImage(ref);
      toast.error('Не удалось загрузить изображение');
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-[300] bg-black/40 animate-in fade-in-0"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed left-1/2 top-1/2 z-[301] flex max-h-[85vh] w-[calc(100%-2rem)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white shadow-xl animate-in fade-in-0 zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-socrat-border px-5 py-4">
          <h3 className="text-base font-semibold">Редактировать задачу</h3>
          <button type="button" onClick={onClose} className="shrink-0 p-1">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="relative flex-1 space-y-4 overflow-auto px-5 py-4">
          {/* Task text */}
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold text-slate-500">
              Условие задачи {!hasImage && <span className="text-red-500">*</span>}
            </legend>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={conditionImages.handlePaste}
              rows={4}
              placeholder={hasImage ? 'Описание (опционально — фото прикреплено)' : 'Введите условие задачи или вставьте скриншот...'}
              className="w-full resize-y rounded-lg border border-socrat-border px-3 py-2.5 text-[16px] leading-relaxed transition-colors duration-200 placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none"
            />
          </fieldset>

          {/* Condition images */}
          <ImageUploadField label="Фото задачи" imageUpload={conditionImages} disabled={isBusy} />

          {/* ── Классификация (видна всегда) ── */}
          <div className="space-y-4 rounded-lg border border-socrat-border/50 bg-slate-50/50 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              Классификация
            </div>
            <TaskClassificationFields
              taskType={taskType}
              kimNumber={kimNumber}
              difficulty={difficulty}
              primaryScore={primaryScore}
              topicId={topicId}
              subtopicId={subtopicId}
              sourceLabel={sourceLabel}
              answerFormat={answerFormat}
              onTaskTypeChange={handleTaskTypeChange}
              onKimNumberChange={handleKimChange}
              onDifficultyChange={setDifficulty}
              onPrimaryScoreChange={setPrimaryScore}
              onTopicIdChange={handleTopicChange}
              onSubtopicIdChange={setSubtopicId}
              onSourceLabelChange={setSourceLabel}
              onAnswerFormatChange={setAnswerFormat}
              disabled={isBusy}
            />
          </div>

          {/* ── Ответ и решение (сворачиваемо) ── */}
          <button
            type="button"
            onClick={() => setShowAnswerSection((v) => !v)}
            className="flex w-full items-center gap-1.5 rounded-lg py-1.5 text-[13px] font-medium text-socrat-primary hover:underline"
          >
            {showAnswerSection ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            Ответ и решение
          </button>

          {showAnswerSection && (
            <div className="space-y-4 rounded-lg border border-socrat-border/50 bg-slate-50/50 p-4">
              {/* Answer */}
              <fieldset>
                <legend className="mb-1.5 text-xs font-semibold text-slate-500">Ответ</legend>
                <input
                  type="text"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="Правильный ответ"
                  className="w-full rounded-lg border border-socrat-border px-3 py-2 text-[16px] transition-colors duration-200 placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none"
                />
              </fieldset>

              {/* Solution */}
              <fieldset>
                <legend className="mb-1.5 text-xs font-semibold text-slate-500">Решение / пояснение</legend>
                <textarea
                  value={solution}
                  onChange={(e) => setSolution(e.target.value)}
                  onPaste={solutionImages.handlePaste}
                  rows={3}
                  placeholder="Подробное решение (опционально) или вставьте скриншот..."
                  className="w-full resize-y rounded-lg border border-socrat-border px-3 py-2.5 text-[16px] leading-relaxed transition-colors duration-200 placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none"
                />
              </fieldset>

              {/* Solution images */}
              <ImageUploadField label="Фото решения" imageUpload={solutionImages} disabled={isBusy} />

              {/* Rubric / criteria (field-parity fix 2026-06-03) */}
              <fieldset>
                <legend className="mb-1.5 text-xs font-semibold text-slate-500">Критерии оценки</legend>
                <textarea
                  value={rubricText}
                  onChange={(e) => setRubricText(e.target.value)}
                  rows={3}
                  placeholder="Как начислять баллы (используется AI при проверке). Например: «Полное решение — 2 балла; ошибка в знаке — минус 1 балл»."
                  className="w-full resize-y rounded-lg border border-socrat-border px-3 py-2.5 text-[16px] leading-relaxed transition-colors duration-200 placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none"
                />
              </fieldset>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-socrat-border px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-socrat-border bg-transparent px-4 py-2 text-[13px] text-muted-foreground"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave || isBusy}
            className={cn(
              'rounded-lg px-4 py-2 text-[13px] font-semibold text-white',
              canSave && !isBusy
                ? 'bg-socrat-primary'
                : 'cursor-default bg-socrat-border',
            )}
          >
            {isBusy ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </div>
    </>
  );
}
