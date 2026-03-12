import { useEffect, useState } from 'react';
import { Folder, X } from 'lucide-react';
import { toast } from 'sonner';
import { useFolderTree } from '@/hooks/useFolders';
import { useCreateTask } from '@/hooks/useKnowledgeBase';
import { cn } from '@/lib/utils';
import type { ExamType, KBFolderTreeNode } from '@/types/kb';

interface CreateTaskModalProps {
  /** Pre-selected folder id (e.g. current folder on FolderPage) */
  defaultFolderId?: string;
  onClose: () => void;
}

export function CreateTaskModal({ defaultFolderId, onClose }: CreateTaskModalProps) {
  const { tree, loading: treesLoading } = useFolderTree();
  const createTask = useCreateTask();

  const [folderId, setFolderId] = useState<string | null>(defaultFolderId ?? null);
  const [text, setText] = useState('');
  const [answer, setAnswer] = useState('');
  const [solution, setSolution] = useState('');
  const [exam, setExam] = useState<ExamType | ''>('');
  const [answerFormat, setAnswerFormat] = useState('');

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

  const canSave = text.trim().length > 0 && folderId !== null;

  const handleSave = () => {
    if (!canSave || !folderId) return;

    createTask.mutate(
      {
        folder_id: folderId,
        text: text.trim(),
        answer: answer.trim() || undefined,
        solution: solution.trim() || undefined,
        exam: exam || undefined,
        answer_format: answerFormat || undefined,
      },
      {
        onSuccess: () => {
          toast.success('Задача создана');
          onClose();
        },
        onError: () => {
          toast.error('Не удалось создать задачу');
        },
      },
    );
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
          <h3 className="text-base font-semibold">Новая задача</h3>
          <button type="button" onClick={onClose} className="shrink-0 p-1">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-4 overflow-auto px-5 py-4">
          {/* Folder select */}
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold text-slate-500">
              Папка <span className="text-red-500">*</span>
            </legend>
            <div className="max-h-36 overflow-auto rounded-lg border border-socrat-border">
              {treesLoading ? (
                <div className="space-y-1.5 px-2 py-2">
                  {[1, 2].map((i) => (
                    <div key={i} className="h-8 animate-pulse rounded bg-socrat-border-light" />
                  ))}
                </div>
              ) : tree.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-socrat-muted">
                  Нет папок. Создайте папку в «Моя база».
                </div>
              ) : (
                <div className="py-1">
                  {renderFolderOptions(tree, 0, folderId, setFolderId)}
                </div>
              )}
            </div>
          </fieldset>

          {/* Task text — required */}
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold text-slate-500">
              Условие задачи <span className="text-red-500">*</span>
            </legend>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder="Введите условие задачи..."
              className="w-full resize-y rounded-lg border border-socrat-border px-3 py-2.5 text-[16px] leading-relaxed transition-colors duration-200 placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none sm:text-sm"
            />
          </fieldset>

          {/* Exam + answer format row */}
          <div className="grid grid-cols-2 gap-3">
            <fieldset>
              <legend className="mb-1.5 text-xs font-semibold text-slate-500">Экзамен</legend>
              <select
                value={exam}
                onChange={(e) => setExam(e.target.value as ExamType | '')}
                className="w-full rounded-lg border border-socrat-border px-3 py-2 text-[16px] transition-colors duration-200 focus:border-socrat-primary/50 focus:outline-none sm:text-sm"
              >
                <option value="">Не указан</option>
                <option value="ege">ЕГЭ</option>
                <option value="oge">ОГЭ</option>
              </select>
            </fieldset>

            <fieldset>
              <legend className="mb-1.5 text-xs font-semibold text-slate-500">Формат ответа</legend>
              <select
                value={answerFormat}
                onChange={(e) => setAnswerFormat(e.target.value)}
                className="w-full rounded-lg border border-socrat-border px-3 py-2 text-[16px] transition-colors duration-200 focus:border-socrat-primary/50 focus:outline-none sm:text-sm"
              >
                <option value="">Не указан</option>
                <option value="number">Число</option>
                <option value="expression">Выражение</option>
                <option value="choice">Выбор</option>
                <option value="matching">Соответствие</option>
              </select>
            </fieldset>
          </div>

          {/* Answer */}
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold text-slate-500">Ответ</legend>
            <input
              type="text"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Правильный ответ"
              className="w-full rounded-lg border border-socrat-border px-3 py-2 text-[16px] transition-colors duration-200 placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none sm:text-sm"
            />
          </fieldset>

          {/* Solution */}
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold text-slate-500">Решение / пояснение</legend>
            <textarea
              value={solution}
              onChange={(e) => setSolution(e.target.value)}
              rows={3}
              placeholder="Подробное решение (опционально)..."
              className="w-full resize-y rounded-lg border border-socrat-border px-3 py-2.5 text-[16px] leading-relaxed transition-colors duration-200 placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none sm:text-sm"
            />
          </fieldset>
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
            disabled={!canSave || createTask.isPending}
            className={cn(
              'rounded-lg px-4 py-2 text-[13px] font-semibold text-white',
              canSave && !createTask.isPending
                ? 'bg-socrat-primary'
                : 'cursor-default bg-socrat-border',
            )}
          >
            {createTask.isPending ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </div>
    </>
  );
}

function renderFolderOptions(
  nodes: KBFolderTreeNode[],
  depth: number,
  selectedId: string | null,
  setSelectedId: (id: string) => void,
) {
  return nodes.map((node) => (
    <div key={node.id}>
      <button
        type="button"
        onClick={() => setSelectedId(node.id)}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px]',
          selectedId === node.id
            ? 'bg-socrat-primary-light font-semibold'
            : 'hover:bg-socrat-surface',
        )}
        style={{ paddingLeft: 12 + depth * 18 }}
      >
        <Folder
          className={cn(
            'h-3.5 w-3.5 shrink-0',
            selectedId === node.id ? 'text-socrat-primary' : 'text-socrat-folder',
          )}
        />
        <span>{node.name}</span>
      </button>
      {node.children.length > 0 &&
        renderFolderOptions(node.children, depth + 1, selectedId, setSelectedId)}
    </div>
  ));
}
