import { memo, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ImagePlus, Loader2, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { MathText } from '@/components/kb/ui/MathText';
import { resolveCheckFormatFromKb } from '@/lib/checkFormatHelpers';
import { getKBImageSignedUrl, uploadKBTaskImage, validateImageFile } from '@/lib/kbApi';
import { cn } from '@/lib/utils';
import type { ExtractedTask } from '@/lib/kbAiExtractApi';

interface DraftCardProps {
  index: number;
  draft: ExtractedTask;
  selected: boolean;
  /** Предмет распознавания — бейдж формата проверки должен совпадать с commit (review P2). */
  subject: string;
  onToggleSelect: (index: number) => void;
  onChange: (index: number, patch: Partial<ExtractedTask>) => void;
  /** Disable all editing (during commit). */
  disabled?: boolean;
}

const CONFIDENCE_META: Record<
  ExtractedTask['answer_confidence'],
  { label: string; className: string }
> = {
  high: { label: 'AI уверен в ответе', className: 'bg-emerald-100 text-emerald-800' },
  medium: { label: 'Ответ — проверьте', className: 'bg-amber-100 text-amber-800' },
  low: { label: 'Ответ не распознан', className: 'bg-amber-100 text-amber-800' },
};

const EXAM_LABELS: Record<string, string> = { ege: 'ЕГЭ', oge: 'ОГЭ' };

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">
      {children}
    </span>
  );
}

function DraftCardComponent({ index, draft, selected, subject, onToggleSelect, onChange, disabled }: DraftCardProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Resolve signed URL for the attached original image.
  useEffect(() => {
    if (!draft.attachment_ref) {
      setSignedUrl(null);
      return;
    }
    let cancelled = false;
    void getKBImageSignedUrl(draft.attachment_ref).then((url) => {
      if (!cancelled) setSignedUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [draft.attachment_ref]);

  const confidence = CONFIDENCE_META[draft.answer_confidence];
  const answerEmpty = !draft.answer || draft.answer.trim() === '';
  const answerNeedsReview = draft.needs_review_fields.includes('answer');
  // P1-4: grading mode resolved exactly as the commit does (so the badge matches
  // what's persisted to kb_tasks.check_format).
  const checkFormatLabel =
    resolveCheckFormatFromKb({
      check_format: draft.check_format,
      answer_format: draft.answer_format,
      kim_number: draft.kim_number,
      subject,
    }) === 'detailed_solution'
      ? 'Развёрнутое решение'
      : 'Краткий ответ';

  const handleReplaceImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const validationError = validateImageFile(file);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setReplacing(true);
    try {
      const res = await uploadKBTaskImage(file);
      onChange(index, { attachment_ref: res.storageRef });
      toast.success('Рисунок прикреплён');
    } catch {
      toast.error('Не удалось загрузить рисунок');
    } finally {
      setReplacing(false);
    }
  };

  return (
    <div
      className={cn(
        'rounded-2xl border bg-white p-4 shadow-sm transition-colors',
        selected ? 'border-socrat-primary/40' : 'border-socrat-border',
        disabled && 'pointer-events-none opacity-60',
      )}
    >
      {/* Header: select + chips + confidence */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(index)}
            className="mt-1 h-4 w-4 shrink-0 accent-socrat-primary [touch-action:manipulation]"
            aria-label={`Выбрать задачу ${index + 1}`}
          />
          <span className="flex flex-wrap items-center gap-1.5">
            <Chip>№ {index + 1}</Chip>
            {draft.exam ? <Chip>{EXAM_LABELS[draft.exam] ?? draft.exam}</Chip> : null}
            {draft.kim_number !== null ? <Chip>КИМ № {draft.kim_number}</Chip> : null}
            <Chip>{checkFormatLabel}</Chip>
            {draft.topic_suggestion ? <Chip>{draft.topic_suggestion}</Chip> : null}
          </span>
        </label>
        <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold', confidence.className)}>
          {confidence.label}
        </span>
      </div>

      {/* Dedup banner (edge fingerprint_match) */}
      {draft.fingerprint_match ? (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Похоже, такая задача уже есть{' '}
            {draft.fingerprint_match.scope === 'mine'
              ? draft.fingerprint_match.folder_name
                ? `в папке «${draft.fingerprint_match.folder_name}»`
                : 'в вашей базе'
              : 'в Каталоге'}
            . Снимите галочку, если не нужно добавлять дубликат.
          </span>
        </div>
      ) : null}

      {/* Условие — raw LaTeX edit + live preview */}
      <label className="mb-1 block text-xs font-semibold text-slate-500">Условие</label>
      <textarea
        value={draft.text}
        onChange={(e) => onChange(index, { text: e.target.value })}
        disabled={disabled}
        rows={3}
        className="w-full resize-y rounded-lg border border-socrat-border px-3 py-2 text-[16px] leading-relaxed transition-colors focus:border-socrat-primary/50 focus:outline-none [touch-action:manipulation]"
        placeholder="Текст условия (формулы в $…$)"
      />
      {draft.text.includes('$') ? (
        <div className="mt-1.5 rounded-lg bg-socrat-surface px-3 py-2 text-sm text-slate-700">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Предпросмотр
          </span>
          <MathText text={draft.text} />
        </div>
      ) : null}

      {/* Ответ — raw edit, amber when empty/needs-review */}
      <label className="mb-1 mt-3 block text-xs font-semibold text-slate-500">Ответ</label>
      <input
        type="text"
        value={draft.answer ?? ''}
        onChange={(e) => onChange(index, { answer: e.target.value })}
        disabled={disabled}
        className={cn(
          'w-full rounded-lg border px-3 py-2 text-[16px] transition-colors focus:outline-none [touch-action:manipulation]',
          answerEmpty || answerNeedsReview
            ? 'border-amber-300 bg-amber-50/40 focus:border-amber-400'
            : 'border-socrat-border focus:border-socrat-primary/50',
        )}
        placeholder={answerEmpty ? 'AI не уверен — впишите/поправьте ответ' : 'Ответ'}
      />
      {(answerEmpty || answerNeedsReview) ? (
        <p className="mt-1 text-[11px] text-amber-700">
          AI оставил поле для проверки — впишите верный ответ, чтобы авто-проверка ДЗ работала.
        </p>
      ) : null}

      {/* Решение (из материала) — read-only, info */}
      {draft.solution ? (
        <div className="mt-3 rounded-lg border border-socrat-border bg-socrat-surface px-3 py-2">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Решение (из материала)
          </span>
          <MathText className="text-sm text-slate-700" text={draft.solution} />
        </div>
      ) : null}

      {/* Рубрика — tutor-only */}
      {draft.rubric_text ? (
        <div className="mt-3 rounded-lg border border-socrat-primary/20 bg-socrat-primary-light px-3 py-2">
          <span className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-socrat-primary">
            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
            Критерии — видно только вам
          </span>
          <MathText className="text-sm text-slate-700" text={draft.rubric_text} />
        </div>
      ) : null}

      {/* Рисунок — тутор управляет независимо от AI: добавить / заменить / убрать */}
      <div className="mt-3">
        {draft.attachment_ref ? (
          <div className="flex items-center gap-3">
            {signedUrl ? (
              <img
                loading="lazy"
                src={signedUrl}
                alt={`Рисунок задачи ${index + 1}`}
                className="h-24 w-24 rounded-lg border border-socrat-border object-cover"
              />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-socrat-border bg-socrat-surface">
                <ImagePlus className="h-5 w-5 animate-pulse text-slate-300" />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-slate-500">
                Авторский рисунок — AI не меняет
              </span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={disabled || replacing}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-socrat-border bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-socrat-primary/40 hover:text-socrat-primary disabled:opacity-50 [touch-action:manipulation]"
                >
                  {replacing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  Заменить
                </button>
                <button
                  type="button"
                  disabled={disabled || replacing}
                  onClick={() => onChange(index, { attachment_ref: null })}
                  className="inline-flex w-fit items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 [touch-action:manipulation]"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Убрать
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {draft.needs_review_fields.includes('image') ? (
              <span className="text-[11px] text-amber-700">
                AI не уверен, нужен ли рисунок — добавьте, если в задаче есть график или схема.
              </span>
            ) : null}
            <button
              type="button"
              disabled={disabled || replacing}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-dashed border-socrat-border bg-white px-3 py-1.5 text-xs font-semibold text-slate-500 transition-colors hover:border-socrat-primary/40 hover:text-socrat-primary disabled:opacity-50 [touch-action:manipulation]"
            >
              {replacing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Добавить рисунок
            </button>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleReplaceImage}
          className="hidden"
        />
      </div>

      {/* notes */}
      {draft.notes ? (
        <p className="mt-3 text-[11px] italic text-slate-400">{draft.notes}</p>
      ) : null}
    </div>
  );
}

export const DraftCard = memo(DraftCardComponent);
