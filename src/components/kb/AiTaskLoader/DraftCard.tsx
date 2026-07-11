import { memo, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Crop,
  ImagePlus,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { MathText } from '@/components/kb/ui/MathText';
import { BboxEditor } from '@/components/kb/AiTaskLoader/BboxEditor';
import type { CropState, ReviewOverrides } from '@/components/kb/AiTaskLoader/reviewTypes';
import { resolveCheckFormatFromKb } from '@/lib/checkFormatHelpers';
import { getKimPrimaryScoreForSubject } from '@/lib/kbKimScores';
import { useKbSources, useSubtopics } from '@/hooks/useKnowledgeBase';
import { getKBImageSignedUrl, uploadKBTaskImage, validateImageFile } from '@/lib/kbApi';
import { cn } from '@/lib/utils';
import type { ExtractedTask, ImageBbox } from '@/lib/kbAiExtractApi';
import type { KBTopicWithCounts } from '@/types/kb';

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

  // ── Волна 2 (2026-07-11): полноценное ревью до сохранения ──
  /** Классификация тутора (тема/подтема/источник/экзамен/КИМ/балл). */
  override?: ReviewOverrides;
  onOverrideChange?: (index: number, patch: Partial<ReviewOverrides>) => void;
  /** Темы выбранного предмета (page-level useTopics — не грузим в каждой карточке). */
  topics?: KBTopicWithCounts[];
  /** Кроп рисунка (AI-bbox / правка рамки / весь файл). */
  crop?: CropState | null;
  onCropChange?: (index: number, crop: CropState | null) => void;
  /** «Переспросить AI» с комментарием (refine). */
  onRefine?: (index: number, comment: string) => Promise<void>;
  refining?: boolean;
  /** Скрыть чекбокс/шапку выбора (expand-row таблицы — выбор уже в строке). */
  hideSelect?: boolean;
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

const SELECT_CLASS =
  'w-full rounded-lg border border-socrat-border px-3 py-2 text-[16px] transition-colors duration-200 focus:border-socrat-primary/50 focus:outline-none [touch-action:manipulation]';
const INPUT_CLASS = SELECT_CLASS;
const LEGEND_CLASS = 'mb-1 block text-xs font-semibold text-slate-500';

/** Рамка по умолчанию для ручного кропа (AI bbox не дал). */
const DEFAULT_MANUAL_BBOX: ImageBbox = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">
      {children}
    </span>
  );
}

/**
 * CSS-превью кропа без canvas: фон-изображение масштабируется так, что видна
 * только рамка. Пропорции контейнера = пропорции кропа (naturals грузим раз).
 */
function CropPreview({ url, bbox }: { url: string; bbox: ImageBbox }) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setDims({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.src = url;
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!dims) {
    return <div className="h-24 w-24 animate-pulse rounded-lg border border-socrat-border bg-socrat-surface" />;
  }

  const cropAspect = (bbox.w * dims.w) / (bbox.h * dims.h);
  let h = 96;
  let w = Math.round(h * cropAspect);
  if (w > 220) {
    w = 220;
    h = Math.round(w / cropAspect);
  }
  if (w < 48) w = 48;

  const posX = bbox.w >= 0.999 ? 0 : (bbox.x / (1 - bbox.w)) * 100;
  const posY = bbox.h >= 0.999 ? 0 : (bbox.y / (1 - bbox.h)) * 100;

  return (
    <div
      className="rounded-lg border border-socrat-border bg-white"
      style={{
        width: `${w}px`,
        height: `${h}px`,
        backgroundImage: `url("${url}")`,
        backgroundSize: `${100 / bbox.w}% ${100 / bbox.h}%`,
        backgroundPosition: `${posX}% ${posY}%`,
        backgroundRepeat: 'no-repeat',
      }}
      role="img"
      aria-label="Превью вырезанного рисунка"
    />
  );
}

function DraftCardComponent({
  index,
  draft,
  selected,
  subject,
  onToggleSelect,
  onChange,
  disabled,
  override,
  onOverrideChange,
  topics,
  crop,
  onCropChange,
  onRefine,
  refining,
  hideSelect,
}: DraftCardProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [bboxEditing, setBboxEditing] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);
  const [refineComment, setRefineComment] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasOverride = override !== undefined && onOverrideChange !== undefined;
  // Подтемы/источники — quiet-хуки (staleTime 10 мин, дедуп по ключу); монтируются
  // только в раскрытых карточках.
  const { subtopics } = useSubtopics(hasOverride && override.topicId ? override.topicId : undefined);
  const { sources = [] } = useKbSources();

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
  const effKim = hasOverride
    ? (override.kimNumber.trim() ? parseInt(override.kimNumber.trim(), 10) : null)
    : draft.kim_number;
  const effExam = hasOverride ? (override.exam || null) : draft.exam;
  // P1-4: grading mode resolved exactly as the commit does (so the badge matches
  // what's persisted to kb_tasks.check_format).
  const checkFormatLabel =
    resolveCheckFormatFromKb({
      check_format: draft.check_format,
      answer_format: draft.answer_format,
      kim_number: effKim,
      subject,
    }) === 'detailed_solution'
      ? 'Развёрнутое решение'
      : 'Краткий ответ';
  const autoScore = getKimPrimaryScoreForSubject(subject, effExam, effKim);
  // Темы ЕГЭ и ОГЭ имеют одинаковые имена («Кинематика» ×2) — при выбранном
  // экзамене скоупим список, иначе селект пестрит дублями.
  const topicOptions = (topics ?? []).filter(
    (t) => !hasOverride || !override.exam || t.exam === override.exam,
  );

  const activeCropBbox = crop && crop.status !== 'full' ? crop.bbox : null;

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
      // Ручной файл — кроп-предложение AI больше не про него.
      onCropChange?.(index, null);
      toast.success('Рисунок прикреплён');
    } catch {
      toast.error('Не удалось загрузить рисунок');
    } finally {
      setReplacing(false);
    }
  };

  const handleRefineSubmit = async () => {
    const comment = refineComment.trim();
    if (!comment || !onRefine || refining) return;
    await onRefine(index, comment);
    setRefineComment('');
    setRefineOpen(false);
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
        <label className={cn('flex items-start gap-2.5', hideSelect ? '' : 'cursor-pointer')}>
          {hideSelect ? null : (
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect(index)}
              className="mt-1 h-4 w-4 shrink-0 accent-socrat-primary [touch-action:manipulation]"
              aria-label={`Выбрать задачу ${index + 1}`}
            />
          )}
          <span className="flex flex-wrap items-center gap-1.5">
            <Chip>№ {index + 1}</Chip>
            {effExam ? <Chip>{EXAM_LABELS[effExam] ?? effExam}</Chip> : null}
            {effKim !== null && Number.isFinite(effKim) ? <Chip>КИМ № {effKim}</Chip> : null}
            <Chip>{checkFormatLabel}</Chip>
            {!hasOverride && draft.topic_suggestion ? <Chip>{draft.topic_suggestion}</Chip> : null}
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

      {/* Решение — редактируемо (#54, волна 2; раньше read-only) */}
      <label className="mb-1 mt-3 block text-xs font-semibold text-slate-500">
        Решение / пояснение
      </label>
      <textarea
        value={draft.solution ?? ''}
        onChange={(e) => onChange(index, { solution: e.target.value || null })}
        disabled={disabled}
        rows={2}
        className="w-full resize-y rounded-lg border border-socrat-border px-3 py-2 text-[16px] leading-relaxed transition-colors focus:border-socrat-primary/50 focus:outline-none [touch-action:manipulation]"
        placeholder="Ход решения (если есть в материале или хотите добавить)"
      />

      {/* Критерии — редактируемо (#54); tutor-only */}
      <label className="mb-1 mt-3 flex items-center gap-1 text-xs font-semibold text-socrat-primary">
        <ShieldCheck className="h-3 w-3" aria-hidden="true" />
        Критерии оценки — видно только вам
      </label>
      <textarea
        value={draft.rubric_text ?? ''}
        onChange={(e) => onChange(index, { rubric_text: e.target.value || null })}
        disabled={disabled}
        rows={2}
        className="w-full resize-y rounded-lg border border-socrat-primary/20 bg-socrat-primary-light/40 px-3 py-2 text-[16px] leading-relaxed transition-colors focus:border-socrat-primary/50 focus:outline-none [touch-action:manipulation]"
        placeholder="Как начислять баллы (используется AI при проверке ДЗ)"
      />

      {/* ── Классификация (волна 2, #54): тутор правит ДО сохранения ── */}
      {hasOverride ? (
        <div className="mt-3 space-y-3 rounded-lg border border-socrat-border/50 bg-slate-50/50 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            Классификация
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div>
              <label className={LEGEND_CLASS}>Экзамен</label>
              <select
                value={override.exam}
                onChange={(e) =>
                  onOverrideChange(index, { exam: e.target.value as ReviewOverrides['exam'] })
                }
                disabled={disabled}
                className={SELECT_CLASS}
              >
                <option value="">—</option>
                <option value="ege">ЕГЭ</option>
                <option value="oge">ОГЭ</option>
              </select>
            </div>
            <div>
              <label className={LEGEND_CLASS}>№ КИМ</label>
              <input
                type="text"
                inputMode="numeric"
                value={override.kimNumber}
                onChange={(e) =>
                  onOverrideChange(index, {
                    kimNumber: e.target.value.replace(/\D/g, ''),
                    primaryScore: '',
                  })
                }
                disabled={disabled}
                placeholder="1–30"
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className={LEGEND_CLASS}>Балл</label>
              <input
                type="text"
                inputMode="numeric"
                value={override.primaryScore}
                onChange={(e) =>
                  onOverrideChange(index, { primaryScore: e.target.value.replace(/\D/g, '') })
                }
                disabled={disabled}
                placeholder={autoScore != null ? `авто: ${autoScore}` : '—'}
                className={INPUT_CLASS}
              />
            </div>
          </div>
          <div>
            <label className={LEGEND_CLASS}>Тема</label>
            <select
              value={override.topicId ?? ''}
              onChange={(e) =>
                onOverrideChange(index, { topicId: e.target.value || null, subtopicId: null })
              }
              disabled={disabled}
              className={SELECT_CLASS}
            >
              <option value="">Не выбрана</option>
              {topicOptions.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {!override.topicId && draft.topic_suggestion ? (
              <p className="mt-1 text-[11px] text-amber-700">
                AI предложил: «{draft.topic_suggestion}» — такой темы нет в вашей таксономии.
              </p>
            ) : null}
          </div>
          {override.topicId ? (
            <div>
              <label className={LEGEND_CLASS}>Подтема</label>
              <select
                value={override.subtopicId ?? ''}
                onChange={(e) => onOverrideChange(index, { subtopicId: e.target.value || null })}
                disabled={disabled}
                className={SELECT_CLASS}
              >
                <option value="">Не выбрана</option>
                {subtopics.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          ) : null}
          <div>
            <label className={LEGEND_CLASS}>Источник</label>
            <input
              type="text"
              value={override.sourceLabel}
              onChange={(e) => onOverrideChange(index, { sourceLabel: e.target.value })}
              disabled={disabled}
              list={`kb-sources-${index}`}
              placeholder="ФИПИ, Решу ЕГЭ, учебник…"
              className={INPUT_CLASS}
            />
            <datalist id={`kb-sources-${index}`}>
              {sources.map((s) => (
                <option key={s.id} value={s.name} />
              ))}
            </datalist>
          </div>
        </div>
      ) : null}

      {/* Рисунок: кроп-превью (AI bbox / ручная рамка) или целый файл */}
      <div className="mt-3">
        {draft.attachment_ref ? (
          <div className="flex flex-wrap items-center gap-3">
            {activeCropBbox && signedUrl ? (
              <CropPreview url={signedUrl} bbox={activeCropBbox} />
            ) : signedUrl ? (
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
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="text-[11px] font-medium text-slate-500">
                {activeCropBbox
                  ? crop?.status === 'edited'
                    ? 'Рисунок будет вырезан по вашей рамке'
                    : 'AI предложил вырезать рисунок — проверьте превью'
                  : 'Авторский рисунок — AI не меняет'}
              </span>
              <div className="flex flex-wrap gap-2">
                {onCropChange && signedUrl ? (
                  <button
                    type="button"
                    disabled={disabled || replacing}
                    onClick={() => setBboxEditing(true)}
                    className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-socrat-border bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-socrat-primary/40 hover:text-socrat-primary disabled:opacity-50 [touch-action:manipulation]"
                  >
                    <Crop className="h-3.5 w-3.5" aria-hidden="true" />
                    {activeCropBbox ? 'Править рамку' : 'Вырезать фрагмент'}
                  </button>
                ) : null}
                {onCropChange && activeCropBbox ? (
                  <button
                    type="button"
                    disabled={disabled || replacing}
                    onClick={() => onCropChange(index, { bbox: null, status: 'full' })}
                    className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-socrat-border bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-socrat-primary/40 hover:text-socrat-primary disabled:opacity-50 [touch-action:manipulation]"
                  >
                    Прикрепить весь файл
                  </button>
                ) : null}
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
                  onClick={() => {
                    onChange(index, { attachment_ref: null });
                    onCropChange?.(index, null);
                  }}
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

      {/* ── «Переспросить AI» (refine, #45а полная часть) ── */}
      {onRefine ? (
        <div className="mt-3">
          {refineOpen ? (
            <div className="space-y-2 rounded-lg border border-socrat-border/60 bg-socrat-surface/60 p-3">
              <label className={LEGEND_CLASS}>Что поправить? AI перегенерирует этот черновик</label>
              <textarea
                value={refineComment}
                onChange={(e) => setRefineComment(e.target.value)}
                disabled={disabled || refining}
                rows={2}
                maxLength={2000}
                className="w-full resize-y rounded-lg border border-socrat-border px-3 py-2 text-[16px] leading-relaxed transition-colors focus:border-socrat-primary/50 focus:outline-none [touch-action:manipulation]"
                placeholder="Например: «раздели на две задачи», «ответ должен быть 5 м/с», «поправь LaTeX в формуле»"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={disabled || refining || !refineComment.trim()}
                  onClick={() => void handleRefineSubmit()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-socrat-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-socrat-primary-dark disabled:opacity-50 [touch-action:manipulation]"
                >
                  {refining ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {refining ? 'Перегенерируем…' : 'Переспросить AI'}
                </button>
                <button
                  type="button"
                  disabled={refining}
                  onClick={() => setRefineOpen(false)}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 [touch-action:manipulation]"
                >
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={disabled || refining}
              onClick={() => setRefineOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-socrat-primary/40 px-3 py-1.5 text-xs font-semibold text-socrat-primary transition-colors hover:bg-socrat-primary-light disabled:opacity-50 [touch-action:manipulation]"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Переспросить AI
            </button>
          )}
        </div>
      ) : null}

      {/* notes */}
      {draft.notes ? (
        <p className="mt-3 text-[11px] italic text-slate-400">{draft.notes}</p>
      ) : null}

      {/* Редактор рамки кропа */}
      {bboxEditing && signedUrl ? (
        <BboxEditor
          imageUrl={signedUrl}
          initialBbox={activeCropBbox ?? DEFAULT_MANUAL_BBOX}
          onConfirm={(bbox) => {
            onCropChange?.(index, { bbox, status: 'edited' });
            setBboxEditing(false);
          }}
          onCancel={() => setBboxEditing(false)}
        />
      ) : null}
    </div>
  );
}

export const DraftCard = memo(DraftCardComponent);
