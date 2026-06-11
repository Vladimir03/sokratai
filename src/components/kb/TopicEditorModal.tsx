import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { useCreateTopic, useUpdateTopic } from '@/hooks/useModeratorCatalog';
import { cn } from '@/lib/utils';
import type { ExamType, KBTopicWithCounts, TopicKind } from '@/types/kb';

interface TopicEditorModalProps {
  mode: 'create' | 'edit';
  /** Тип создаваемой темы (для create) или существующей (для edit). */
  kind: TopicKind;
  initial?: KBTopicWithCounts;
  onClose: () => void;
  onSaved?: (topicId: string) => void;
}

function parseKimNumbers(raw: string): number[] {
  return Array.from(
    new Set(
      raw
        .split(/[\s,]+/)
        .map((s) => parseInt(s, 10))
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= 40),
    ),
  ).sort((a, b) => a - b);
}

export function TopicEditorModal({ mode, kind, initial, onClose, onSaved }: TopicEditorModalProps) {
  const createTopic = useCreateTopic();
  const updateTopic = useUpdateTopic();
  const isExam = kind === 'exam';

  const [name, setName] = useState(initial?.name ?? '');
  const [section, setSection] = useState(initial?.section ?? (isExam ? '' : 'Олимпиады'));
  const [exam, setExam] = useState<ExamType | ''>(initial?.exam ?? '');
  const [kimNumbers, setKimNumbers] = useState((initial?.kim_numbers ?? []).join(', '));
  const [sortOrder, setSortOrder] = useState(String(initial?.sort_order ?? 0));

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const isPending = createTopic.isPending || updateTopic.isPending;
  const canSave =
    name.trim().length > 0 &&
    section.trim().length > 0 &&
    (!isExam || exam !== '') &&
    !isPending;

  const handleSave = () => {
    if (!canSave) return;
    const sortNum = parseInt(sortOrder, 10);
    const common = {
      name: name.trim(),
      section: section.trim(),
      exam: isExam ? (exam as ExamType) : null,
      kimNumbers: isExam ? parseKimNumbers(kimNumbers) : [],
      sortOrder: Number.isFinite(sortNum) ? sortNum : 0,
    };

    if (mode === 'create') {
      createTopic.mutate(
        { ...common, kind, subject: 'physics' },
        {
          onSuccess: (topicId) => {
            toast.success('Тема создана');
            onSaved?.(topicId);
            onClose();
          },
          onError: (e) => toast.error(e instanceof Error ? e.message : 'Не удалось создать тему'),
        },
      );
    } else if (initial) {
      updateTopic.mutate(
        { id: initial.id, ...common },
        {
          onSuccess: () => {
            toast.success('Тема сохранена');
            onSaved?.(initial.id);
            onClose();
          },
          onError: (e) => toast.error(e instanceof Error ? e.message : 'Не удалось сохранить тему'),
        },
      );
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-[300] bg-black/40 animate-in fade-in-0" onClick={onClose} />

      <div className="fixed left-1/2 top-1/2 z-[301] flex max-h-[85vh] w-[calc(100%-2rem)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white shadow-xl animate-in fade-in-0 zoom-in-95">
        <div className="flex items-center justify-between border-b border-socrat-border px-5 py-4">
          <h3 className="text-base font-semibold">
            {mode === 'create'
              ? (isExam ? 'Новая тема' : 'Новая олимпиадная тема')
              : 'Редактировать тему'}
          </h3>
          <button type="button" onClick={onClose} className="shrink-0 p-1">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-auto px-5 py-4">
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold text-slate-500">
              Название <span className="text-red-500">*</span>
            </legend>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isExam ? 'Например: Магнетизм' : 'Например: Электродинамика 10–11'}
              autoFocus
              className="w-full rounded-lg border border-socrat-border px-3 py-2.5 text-[16px] transition-colors duration-200 placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none"
            />
          </fieldset>

          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold text-slate-500">
              Раздел <span className="text-red-500">*</span>
            </legend>
            <input
              type="text"
              value={section}
              onChange={(e) => setSection(e.target.value)}
              placeholder={isExam ? 'Например: Электродинамика' : 'Олимпиады'}
              className="w-full rounded-lg border border-socrat-border px-3 py-2.5 text-[16px] transition-colors duration-200 placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none"
            />
            <p className="mt-1 text-xs text-slate-400">Заголовок-группа на витрине каталога.</p>
          </fieldset>

          {isExam ? (
            <div className="grid grid-cols-2 gap-3">
              <fieldset>
                <legend className="mb-1.5 text-xs font-semibold text-slate-500">
                  Экзамен <span className="text-red-500">*</span>
                </legend>
                <select
                  value={exam}
                  onChange={(e) => setExam(e.target.value as ExamType | '')}
                  className="w-full rounded-lg border border-socrat-border px-3 py-2 text-[16px] transition-colors duration-200 focus:border-socrat-primary/50 focus:outline-none"
                >
                  <option value="">Выберите…</option>
                  <option value="ege">ЕГЭ</option>
                  <option value="oge">ОГЭ</option>
                </select>
              </fieldset>

              <fieldset>
                <legend className="mb-1.5 text-xs font-semibold text-slate-500">№ КИМ</legend>
                <input
                  type="text"
                  inputMode="numeric"
                  value={kimNumbers}
                  onChange={(e) => setKimNumbers(e.target.value)}
                  placeholder="12, 14, 15"
                  className="w-full rounded-lg border border-socrat-border px-3 py-2 text-[16px] transition-colors duration-200 placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none"
                />
              </fieldset>
            </div>
          ) : null}

          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold text-slate-500">Порядок сортировки</legend>
            <input
              type="text"
              inputMode="numeric"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value.replace(/[^\d-]/g, ''))}
              placeholder="0"
              className="w-full rounded-lg border border-socrat-border px-3 py-2 text-[16px] transition-colors duration-200 placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none"
            />
            <p className="mt-1 text-xs text-slate-400">Меньше — выше в списке.</p>
          </fieldset>
        </div>

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
            disabled={!canSave}
            className={cn(
              'rounded-lg px-4 py-2 text-[13px] font-semibold text-white',
              canSave ? 'bg-socrat-primary' : 'cursor-default bg-socrat-border',
            )}
          >
            {isPending ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </>
  );
}
