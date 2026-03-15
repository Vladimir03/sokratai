import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, X } from 'lucide-react';
import { toast } from 'sonner';
import { useFolderTree } from '@/hooks/useFolders';
import { useImageUpload } from '@/hooks/useImageUpload';
import { useCreateTask, useSubtopics, useTopics } from '@/hooks/useKnowledgeBase';
import {
  deleteKBTaskImage,
  MAX_TASK_IMAGES,
  serializeAttachmentUrls,
  uploadKBTaskImage,
} from '@/lib/kbApi';
import { cn } from '@/lib/utils';
import { ImageUploadField } from '@/components/kb/ui/ImageUploadField';
import type { ExamType, KBFolderTreeNode } from '@/types/kb';

interface CreateTaskModalProps {
  /** Pre-selected folder id (e.g. current folder on FolderPage) */
  defaultFolderId?: string;
  onClose: () => void;
}

/** Flatten folder tree into { id, name, depth } for <select> options */
function flattenTree(
  nodes: KBFolderTreeNode[],
  depth = 0,
): { id: string; name: string; depth: number }[] {
  const result: { id: string; name: string; depth: number }[] = [];
  for (const node of nodes) {
    result.push({ id: node.id, name: node.name, depth });
    if (node.children.length > 0) {
      result.push(...flattenTree(node.children, depth + 1));
    }
  }
  return result;
}

const ANSWER_FORMAT_OPTIONS = [
  { value: '', label: 'Не указан' },
  { value: 'number', label: 'Число' },
  { value: 'text', label: 'Текст' },
  { value: 'detailed', label: 'Развернутое решение' },
  { value: 'matching', label: 'Соответствие' },
  { value: 'choice', label: 'Выбор ответа' },
];

export function CreateTaskModal({ defaultFolderId, onClose }: CreateTaskModalProps) {
  const { tree, loading: treesLoading } = useFolderTree();
  const createTask = useCreateTask();

  // Primary fields
  const [folderId, setFolderId] = useState<string>(defaultFolderId ?? '');
  const [text, setText] = useState('');

  // Additional fields
  const [answerFormat, setAnswerFormat] = useState('');
  const [answer, setAnswer] = useState('');
  const [solution, setSolution] = useState('');
  const [exam, setExam] = useState<ExamType | ''>('');
  const [kimNumber, setKimNumber] = useState('');
  const [primaryScore, setPrimaryScore] = useState('');
  const [topicId, setTopicId] = useState('');
  const [subtopicId, setSubtopicId] = useState('');
  const [source, setSource] = useState('');

  const [showExtra, setShowExtra] = useState(false);
  const [uploading, setUploading] = useState(false);

  const isBusy = uploading || createTask.isPending;

  // Image hooks
  const conditionImages = useImageUpload({ maxImages: MAX_TASK_IMAGES, disabled: isBusy });
  const solutionImages = useImageUpload({ maxImages: MAX_TASK_IMAGES, disabled: isBusy });

  // Topics & subtopics for selectors
  const { topics = [], loading: topicsLoading } = useTopics();
  const { subtopics, loading: subtopicsLoading } = useSubtopics(topicId || undefined);

  // Reset subtopic when topic changes
  useEffect(() => {
    setSubtopicId('');
  }, [topicId]);

  // Auto-select defaultFolderId when tree loads
  useEffect(() => {
    if (defaultFolderId && !folderId) {
      setFolderId(defaultFolderId);
    }
  }, [defaultFolderId, folderId]);

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

  // Validation: folder + (text OR image)
  const hasContent = text.trim().length > 0 || conditionImages.totalImages > 0;
  const canSave = hasContent && folderId !== '';

  const handleSave = async () => {
    if (!canSave || !folderId) return;

    setUploading(true);
    const conditionRefs: string[] = [];
    const solutionRefs: string[] = [];
    try {
      for (const file of conditionImages.getNewFiles()) {
        const result = await uploadKBTaskImage(file);
        conditionRefs.push(result.storageRef);
      }
      for (const file of solutionImages.getNewFiles()) {
        const result = await uploadKBTaskImage(file);
        solutionRefs.push(result.storageRef);
      }

      const attachmentUrl = serializeAttachmentUrls(conditionRefs) ?? undefined;
      const solutionAttachmentUrl = serializeAttachmentUrls(solutionRefs) ?? undefined;
      const taskText = text.trim() || '[Задача на фото]';
      const kimNum = kimNumber.trim() ? parseInt(kimNumber.trim(), 10) : undefined;
      const scoreNum = primaryScore.trim() ? parseInt(primaryScore.trim(), 10) : undefined;

      createTask.mutate(
        {
          folder_id: folderId,
          text: taskText,
          answer: answer.trim() || undefined,
          solution: solution.trim() || undefined,
          exam: exam || undefined,
          answer_format: answerFormat || undefined,
          attachment_url: attachmentUrl,
          solution_attachment_url: solutionAttachmentUrl,
          kim_number: kimNum && !isNaN(kimNum) ? kimNum : undefined,
          primary_score: scoreNum && !isNaN(scoreNum) ? scoreNum : undefined,
          topic_id: topicId || undefined,
          subtopic_id: subtopicId || undefined,
          source_label: source.trim() || 'my',
        },
        {
          onSuccess: () => {
            toast.success('Задача создана');
            onClose();
          },
          onError: () => {
            for (const ref of conditionRefs) void deleteKBTaskImage(ref);
            for (const ref of solutionRefs) void deleteKBTaskImage(ref);
            toast.error('Не удалось создать задачу');
          },
        },
      );
    } catch {
      for (const ref of conditionRefs) void deleteKBTaskImage(ref);
      for (const ref of solutionRefs) void deleteKBTaskImage(ref);
      toast.error('Не удалось загрузить изображение');
    } finally {
      setUploading(false);
    }
  };

  const flatFolders = flattenTree(tree);

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
          <h3 className="text-base font-semibold">Новая задача</h3>
          <button type="button" onClick={onClose} className="shrink-0 p-1">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="relative flex-1 space-y-4 overflow-auto px-5 py-4">
          {/* ── Primary fields ── */}

          {/* Folder select */}
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold text-slate-500">
              Папка в базе <span className="text-red-500">*</span>
            </legend>
            <div className="relative">
              <Folder className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-socrat-folder" />
              <select
                value={folderId}
                onChange={(e) => setFolderId(e.target.value)}
                className="w-full appearance-none rounded-lg border border-socrat-border py-2 pl-8 pr-8 text-[16px] transition-colors duration-200 focus:border-socrat-primary/50 focus:outline-none"
              >
                <option value="">Выберите папку…</option>
                {treesLoading ? (
                  <option disabled>Загрузка…</option>
                ) : (
                  flatFolders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {'　'.repeat(f.depth)}{f.depth > 0 ? '└ ' : ''}{f.name}
                    </option>
                  ))
                )}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            </div>
            {tree.length === 0 && !treesLoading && (
              <p className="mt-1 text-xs text-socrat-muted">
                Нет папок. Создайте папку в «Моя база».
              </p>
            )}
          </fieldset>

          {/* Task text */}
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold text-slate-500">
              Условие задачи {conditionImages.totalImages === 0 && <span className="text-red-500">*</span>}
            </legend>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={conditionImages.handlePaste}
              rows={4}
              placeholder={
                conditionImages.totalImages > 0
                  ? 'Описание (опционально — фото прикреплено)'
                  : 'Введите условие задачи или вставьте скриншот…'
              }
              className="w-full resize-y rounded-lg border border-socrat-border px-3 py-2.5 text-[16px] leading-relaxed transition-colors duration-200 placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none"
            />
          </fieldset>

          {/* Condition images */}
          <ImageUploadField label="Фото условия" imageUpload={conditionImages} disabled={isBusy} />

          {/* Validation hint */}
          {!hasContent && (
            <p className="text-xs text-amber-600">
              Заполните условие задачи или прикрепите хотя бы одно фото
            </p>
          )}

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
                  placeholder="Подробное решение (опционально) или вставьте скриншот…"
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

              {/* Source */}
              <fieldset>
                <legend className="mb-1.5 text-xs font-semibold text-slate-500">Источник задачи</legend>
                <input
                  type="text"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="ФИПИ, Решу ЕГЭ, свой авторский, учебник…"
                  className="w-full rounded-lg border border-socrat-border px-3 py-2 text-[16px] transition-colors duration-200 placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none"
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
            {isBusy ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </>
  );
}
