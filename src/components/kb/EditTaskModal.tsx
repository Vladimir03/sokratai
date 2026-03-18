import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { toast } from 'sonner';
import { useImageUpload } from '@/hooks/useImageUpload';
import { useUpdateTask, useSubtopics, useTopics } from '@/hooks/useKnowledgeBase';
import {
  deleteKBTaskImage,
  MAX_TASK_IMAGES,
  parseAttachmentUrls,
  serializeAttachmentUrls,
  uploadKBTaskImage,
} from '@/lib/kbApi';
import { cn } from '@/lib/utils';
import { ImageUploadField } from '@/components/kb/ui/ImageUploadField';
import type { ExamType, KBTask, UpdateKBTaskInput } from '@/types/kb';

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

const ANSWER_FORMAT_OPTIONS = [
  { value: '', label: 'Не указан' },
  { value: 'number', label: 'Число' },
  { value: 'text', label: 'Текст' },
  { value: 'detailed', label: 'Развернутое решение' },
  { value: 'matching', label: 'Соответствие' },
  { value: 'choice', label: 'Выбор ответа' },
];

export function EditTaskModal({ task, onClose }: EditTaskModalProps) {
  const updateTask = useUpdateTask();

  const [text, setText] = useState(task.text);
  const [answer, setAnswer] = useState(task.answer ?? '');
  const [solution, setSolution] = useState(task.solution ?? '');
  const [exam, setExam] = useState<ExamType | ''>(task.exam ?? '');
  const [answerFormat, setAnswerFormat] = useState(normalizeAnswerFormat(task.answer_format));
  const [kimNumber, setKimNumber] = useState(task.kim_number?.toString() ?? '');
  const [primaryScore, setPrimaryScore] = useState(task.primary_score?.toString() ?? '');
  const [topicId, setTopicId] = useState(task.topic_id ?? '');
  const [subtopicId, setSubtopicId] = useState(task.subtopic_id ?? '');
  const [uploading, setUploading] = useState(false);
  const [showExtra, setShowExtra] = useState(false);

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

  // Topics & subtopics for selectors
  const { topics = [], loading: topicsLoading } = useTopics();
  const { subtopics, loading: subtopicsLoading } = useSubtopics(topicId || undefined);

  // Reset subtopic when topic changes (only if user changes it, not on mount)
  const [topicInitialized, setTopicInitialized] = useState(false);
  useEffect(() => {
    if (topicInitialized) {
      setSubtopicId('');
    } else {
      setTopicInitialized(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicId]);

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

  // ─── Save logic ───────────────────────────────────────────────────────────

  const hasImage = conditionImages.totalImages > 0;
  const hasContent = text.trim().length > 0 || hasImage;
  const canSave = hasContent;

  const handleSave = async () => {
    if (!canSave) return;

    setUploading(true);
    const conditionUploadedRefs: string[] = [];
    const solutionUploadedRefs: string[] = [];
    try {
      // Upload new condition images
      for (const file of conditionImages.getNewFiles()) {
        const result = await uploadKBTaskImage(file);
        conditionUploadedRefs.push(result.storageRef);
      }

      // Upload new solution images
      for (const file of solutionImages.getNewFiles()) {
        const result = await uploadKBTaskImage(file);
        solutionUploadedRefs.push(result.storageRef);
      }

      // Combine existing + new refs for each field
      const allConditionRefs = [...conditionImages.getExistingRefs(), ...conditionUploadedRefs];
      const allSolutionRefs = [...solutionImages.getExistingRefs(), ...solutionUploadedRefs];

      // Determine if attachment changed vs. original
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
      const kimNum = kimNumber.trim() ? parseInt(kimNumber.trim(), 10) : null;
      const scoreNum = primaryScore.trim() ? parseInt(primaryScore.trim(), 10) : null;

      const input: UpdateKBTaskInput = {
        text: taskText,
        answer: answer.trim() || null,
        solution: solution.trim() || null,
        exam: exam || null,
        answer_format: answerFormat || null,
        kim_number: kimNum && !isNaN(kimNum) ? kimNum : null,
        primary_score: scoreNum && !isNaN(scoreNum) ? scoreNum : null,
        topic_id: topicId || null,
        subtopic_id: subtopicId || null,
      };

      // Only include attachment fields if changed
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
            // Delete removed refs only after successful save
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
            // Clean up orphan uploads — update failed
            for (const ref of conditionUploadedRefs) void deleteKBTaskImage(ref);
            for (const ref of solutionUploadedRefs) void deleteKBTaskImage(ref);
            toast.error('Не удалось обновить задачу');
          },
        },
      );
    } catch {
      // Clean up refs already uploaded before the failure
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
      <div className="fixed left-1/2 top-1/2 z-[301] flex max-h-[85vh] w-[440px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white shadow-xl animate-in fade-in-0 zoom-in-95">
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

          {/* ── Collapsible additional fields ── */}
          <button
            type="button"
            onClick={() => setShowExtra((v) => !v)}
            className="flex w-full items-center gap-1.5 rounded-lg py-1.5 text-[13px] font-medium text-socrat-primary hover:underline"
          >
            {showExtra ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            Дополнительные поля
          </button>

          {showExtra && (
            <div className="space-y-4 rounded-lg border border-socrat-border/50 bg-slate-50/50 p-4">
              {/* Answer format */}
              <fieldset>
                <legend className="mb-1.5 text-xs font-semibold text-slate-500">Формат ответа</legend>
                <select
                  value={answerFormat}
                  onChange={(e) => setAnswerFormat(e.target.value)}
                  className="w-full rounded-lg border border-socrat-border px-3 py-2 text-[16px] transition-colors duration-200 focus:border-socrat-primary/50 focus:outline-none"
                >
                  {ANSWER_FORMAT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </fieldset>

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

              {/* Exam + KIM number + primary score row */}
              <div className="grid grid-cols-3 gap-3">
                <fieldset>
                  <legend className="mb-1.5 text-xs font-semibold text-slate-500">Экзамен</legend>
                  <select
                    value={exam}
                    onChange={(e) => setExam(e.target.value as ExamType | '')}
                    className="w-full rounded-lg border border-socrat-border px-3 py-2 text-[16px] transition-colors duration-200 focus:border-socrat-primary/50 focus:outline-none"
                  >
                    <option value="">Не указан</option>
                    <option value="ege">ЕГЭ</option>
                    <option value="oge">ОГЭ</option>
                  </select>
                </fieldset>

                <fieldset>
                  <legend className="mb-1.5 text-xs font-semibold text-slate-500">№ задания</legend>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={kimNumber}
                    onChange={(e) => setKimNumber(e.target.value.replace(/\D/g, ''))}
                    placeholder="1–30"
                    className="w-full rounded-lg border border-socrat-border px-3 py-2 text-[16px] transition-colors duration-200 placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none"
                  />
                </fieldset>

                <fieldset>
                  <legend className="mb-1.5 text-xs font-semibold text-slate-500">Первичный балл</legend>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={primaryScore}
                    onChange={(e) => setPrimaryScore(e.target.value.replace(/\D/g, ''))}
                    placeholder="1–4"
                    className="w-full rounded-lg border border-socrat-border px-3 py-2 text-[16px] transition-colors duration-200 placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none"
                  />
                </fieldset>
              </div>

              {/* Topic */}
              <fieldset>
                <legend className="mb-1.5 text-xs font-semibold text-slate-500">Тема</legend>
                <select
                  value={topicId}
                  onChange={(e) => setTopicId(e.target.value)}
                  disabled={topicsLoading}
                  className="w-full rounded-lg border border-socrat-border px-3 py-2 text-[16px] transition-colors duration-200 focus:border-socrat-primary/50 focus:outline-none"
                >
                  <option value="">Не выбрана</option>
                  {topics.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}{t.exam ? ` (${t.exam === 'ege' ? 'ЕГЭ' : 'ОГЭ'})` : ''}
                    </option>
                  ))}
                </select>
              </fieldset>

              {/* Subtopic — only when topic is selected */}
              {topicId && (
                <fieldset>
                  <legend className="mb-1.5 text-xs font-semibold text-slate-500">Подтема</legend>
                  <select
                    value={subtopicId}
                    onChange={(e) => setSubtopicId(e.target.value)}
                    disabled={subtopicsLoading}
                    className="w-full rounded-lg border border-socrat-border px-3 py-2 text-[16px] transition-colors duration-200 focus:border-socrat-primary/50 focus:outline-none"
                  >
                    <option value="">Не выбрана</option>
                    {subtopics.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </fieldset>
              )}
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
