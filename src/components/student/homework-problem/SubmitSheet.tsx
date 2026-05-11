import { useEffect, useMemo, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Loader2, Mic, MicOff, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import { transcribeThreadVoice } from '@/lib/studentHomeworkApi';
import { PhotoStrip } from './PhotoStrip';
import {
  AUTOSAVE_INTERVAL_MS,
  getSubmitSheetDraftKey,
  type SubmitSheetDraftSnapshot,
} from './submitSheetInternal';

/**
 * Normalise a user-typed numeric string for the wire payload: comma → dot.
 * Original `numeric` is preserved in component state so the retry path
 * re-displays exactly what the student typed; only the parent-bound
 * payload gets the dot form.
 */
function normaliseNumericForWire(raw: string): string {
  return raw.trim().replace(/,/g, '.');
}

export type SubmitSheetTaskKind = 'numeric' | 'extended' | 'proof';

export interface SubmitSheetSubmissionPayload {
  /** Canonical "1.4" form (comma → dot already applied). */
  numeric: string;
  /** `storage://...` refs after upload. */
  photos: string[];
  /** Optional reasoning. Empty string is OK. */
  text: string;
}

interface SubmitSheetTask {
  /** UUID of the task. */
  id: string;
  /** 1-based position within the assignment — for header «Сдать задачу N из M». */
  order_num: number;
  /** Total tasks in the assignment. */
  task_total?: number;
  /** Max score for this task. */
  max_score: number;
  /** Drives required-field semantics. */
  task_kind: SubmitSheetTaskKind;
  /** Optional unit suffix shown next to the numeric input. */
  answer_unit?: string;
  /** Optional homework title for the sheet subtitle. */
  homework_title?: string;
  /** Optional current task score (0..max) for sheet subtitle. */
  current_score?: number;
}

interface SubmitSheetProps {
  open: boolean;
  /** Parent decides what happens on close. */
  onClose: () => void;
  task: SubmitSheetTask;
  hwId: string;
  taskId: string;
  /**
   * Real `homework_tutor_threads.id`. Used by Section 4 voice transcribe
   * (`/threads/:threadId/transcribe-voice`). `null`/`undefined` → voice
   * section disabled with a "недоступно" hint.
   */
  threadId?: string | null;
  /**
   * Phase 1.2 refactor (preview-QA #6, 2026-05-10): SubmitSheet больше не
   * владеет mutation + verdict overlay. Студент тапает «Отправить» —
   * sheet немедленно закрывается, parent (`HomeworkProblem`) запускает
   * `submitSolution` mutation в background и владеет:
   *   - optimistic submission user bubble + typing dots в чате
   *   - persisted submission + AI feedback bubbles после refetch
   *   - localStorage draft clearance (на CORRECT verdict)
   *   - navigation на следующую задачу
   *
   * SubmitSheet просто собирает inputs + persistDraftNow + onSubmit.
   * Это закрывает preview-QA #6 запрос «всё в чат, отдельный verdict
   * overlay удалить».
   */
  onSubmit: (payload: SubmitSheetSubmissionPayload) => void;
}

const HINT_BY_KIND: Record<SubmitSheetTaskKind, string> = {
  numeric: 'Достаточно числового ответа.',
  extended:
    'Развёрнутое решение: нужны и ответ, и фото с ходом решения. Без хода — 0 баллов.',
  proof: 'Доказательство — нужны фото с подробным выводом.',
};

const NUMERIC = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

/**
 * Bottom-sheet form для single-shot homework submission.
 *
 * Phase 1.2 (preview-QA #6, 2026-05-10) — крупный refactor:
 *   - **Удалён `<VerdictOverlay>`**: ответ ученика + AI-проверка теперь
 *     показываются прямо в чате (parent rendered). Это даёт ученику
 *     полную историю работы с задачей в одном месте + репетитор видит
 *     ту же историю через `GuidedThreadViewer`.
 *   - **Удалена `useSubmitSolution` mutation**: parent владеет mutation
 *     + optimistic flow + navigation после Phase 1.2.
 *   - **Удалены submitError / verdict states + соответствующие handlers**:
 *     SubmitSheet больше не отображает результат проверки.
 *   - **Сохранены**: form state (numeric/photos/text), autosave (5s
 *     localStorage tick + sync persist на submit), Voice Section 4 (Q11),
 *     comma normalisation, voice recorder.
 *
 * Built on `@radix-ui/react-dialog` directly (waiver в
 * `.claude/rules/90-design-system.md` — design-pixel-perfect grab-handle
 * + max-h + rounded-top from handoff). Underlying primitive identical
 * to shadcn Sheet wrapper.
 */
export function SubmitSheet({
  open,
  onClose,
  task,
  hwId: _hwId,
  taskId,
  threadId,
  onSubmit,
}: SubmitSheetProps) {
  const [numeric, setNumeric] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [text, setText] = useState('');

  // ─── Autosave (Q12, preserved through Phase 1.2 refactor) ────────────────
  const draftKey = getSubmitSheetDraftKey(taskId);
  const [lastAutosaveAt, setLastAutosaveAt] = useState<number | null>(null);
  const lastSerializedRef = useRef<string>('');

  // Restore from localStorage on open; otherwise reset to blank.
  useEffect(() => {
    if (!open) return;
    let restored = false;
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SubmitSheetDraftSnapshot>;
        if (
          parsed &&
          typeof parsed.numeric === 'string' &&
          typeof parsed.text === 'string' &&
          Array.isArray(parsed.photos) &&
          parsed.photos.every((p) => typeof p === 'string')
        ) {
          setNumeric(parsed.numeric);
          setPhotos(parsed.photos);
          setText(parsed.text);
          lastSerializedRef.current = JSON.stringify({
            numeric: parsed.numeric,
            photos: parsed.photos,
            text: parsed.text,
          });
          setLastAutosaveAt(typeof parsed.savedAt === 'number' ? parsed.savedAt : Date.now());
          restored = true;
        }
      }
    } catch {
      /* corrupted draft — drop and start clean */
    }
    if (!restored) {
      setNumeric('');
      setPhotos([]);
      setText('');
      lastSerializedRef.current = '';
      setLastAutosaveAt(null);
    }
  }, [open, draftKey]);

  /**
   * Synchronous persist of the current `{numeric, photos, text}` snapshot.
   * Used by:
   *   - autosave interval (5s tick)
   *   - submit click (codex re-review #1: draft was lost when submit
   *     happened before first 5s tick)
   * Bounded cleanup on QuotaExceededError: prune all `submitsheet-draft-*`
   * keys older than 7 days, then retry the write once.
   */
  const persistDraftNow = (
    snap: { numeric: string; photos: string[]; text: string },
  ) => {
    const isEmpty = !snap.numeric && snap.photos.length === 0 && !snap.text;
    if (isEmpty) {
      try {
        window.localStorage.removeItem(draftKey);
      } catch { /* noop */ }
      lastSerializedRef.current = JSON.stringify(snap);
      setLastAutosaveAt(null);
      return;
    }
    const now = Date.now();
    const draft: SubmitSheetDraftSnapshot = { ...snap, savedAt: now };
    const payload = JSON.stringify(draft);
    const tryWrite = () => {
      window.localStorage.setItem(draftKey, payload);
      lastSerializedRef.current = JSON.stringify(snap);
      setLastAutosaveAt(now);
    };
    try {
      tryWrite();
    } catch (err) {
      const isQuotaError =
        err instanceof Error &&
        (err.name === 'QuotaExceededError' ||
          err.name === 'NS_ERROR_DOM_QUOTA_REACHED');
      if (isQuotaError) {
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        const cutoff = now - sevenDaysMs;
        try {
          for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
            const key = window.localStorage.key(i);
            if (!key || !key.startsWith('submitsheet-draft-')) continue;
            if (key === draftKey) continue;
            const raw = window.localStorage.getItem(key);
            if (!raw) continue;
            try {
              const parsed = JSON.parse(raw) as Partial<SubmitSheetDraftSnapshot>;
              if (
                typeof parsed?.savedAt !== 'number' ||
                parsed.savedAt < cutoff
              ) {
                window.localStorage.removeItem(key);
              }
            } catch {
              window.localStorage.removeItem(key);
            }
          }
          tryWrite();
        } catch {
          toast.error('Не удаётся сохранить черновик локально. Закончи задачу одной попыткой.');
        }
      }
    }
  };

  // Periodic autosave (every 5s while sheet is open).
  useEffect(() => {
    if (!open) return;
    const interval = window.setInterval(() => {
      const snapshot = JSON.stringify({ numeric, photos, text });
      if (snapshot === lastSerializedRef.current) return;
      persistDraftNow({ numeric, photos, text });
    }, AUTOSAVE_INTERVAL_MS);
    return () => window.clearInterval(interval);
    // persistDraftNow is identity-stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draftKey, numeric, photos, text]);

  // Caption «Черновик сохранён · N сек назад» — recompute every 10s.
  const [autosaveCaptionTick, setAutosaveCaptionTick] = useState(0);
  useEffect(() => {
    if (!open || !lastAutosaveAt) return;
    const id = window.setInterval(() => {
      setAutosaveCaptionTick((t) => t + 1);
    }, 10_000);
    return () => window.clearInterval(id);
  }, [open, lastAutosaveAt]);
  const autosaveCaption = useMemo(() => {
    if (!lastAutosaveAt) return '';
    void autosaveCaptionTick;
    const ageSec = Math.max(0, Math.round((Date.now() - lastAutosaveAt) / 1000));
    if (ageSec < 5) return 'Черновик сохранён · только что';
    if (ageSec < 60) return `Черновик сохранён · ${ageSec} сек назад`;
    const min = Math.round(ageSec / 60);
    return `Черновик сохранён · ${min} мин назад`;
  }, [lastAutosaveAt, autosaveCaptionTick]);

  const hint = HINT_BY_KIND[task.task_kind] ?? HINT_BY_KIND.extended;

  const showNumeric = task.task_kind !== 'proof';
  const showPhotos = task.task_kind === 'extended' || task.task_kind === 'proof';

  // Preview-QA #8 (2026-05-11) relax: для extended ученик может submit
  // ТОЛЬКО с фото (numeric становится «по желанию» когда photos.length>=1).
  // Backend `handleStudentSubmission` extended-branch тоже relax'нут.
  const numericRequired =
    task.task_kind === 'extended' ? photos.length === 0 : task.task_kind === 'numeric';

  const kindReady = useMemo(() => {
    const numericOk = numeric.trim().length > 0;
    const photoOk = photos.length >= 1;
    switch (task.task_kind) {
      case 'numeric':
        return numericOk;
      case 'proof':
        return photoOk;
      case 'extended':
      default:
        // Preview-QA #8: photo enough — numeric optional with photo
        return photoOk;
    }
  }, [numeric, photos.length, task.task_kind]);

  const submitDisabled = !kindReady;

  const titleText = task.task_total
    ? `Сдать задачу ${task.order_num} из ${task.task_total}`
    : `Сдать задачу ${task.order_num}`;

  const subtitleText = useMemo(() => {
    const parts: string[] = [];
    if (task.homework_title) parts.push(task.homework_title);
    const score = task.current_score ?? 0;
    parts.push(`${NUMERIC.format(score)} / ${NUMERIC.format(task.max_score)} баллов`);
    return parts.join(' · ');
  }, [task.homework_title, task.current_score, task.max_score]);

  /**
   * Phase 1.2 submit: persist draft → fire onSubmit → close sheet.
   * Parent owns mutation + optimistic + navigation. SubmitSheet does NOT
   * await mutation — sheet closes synchronously so the student
   * immediately sees their submission landing in the chat.
   */
  const handleSubmit = () => {
    if (submitDisabled) return;
    persistDraftNow({ numeric, photos, text });
    onSubmit({
      numeric: normaliseNumericForWire(numeric),
      photos,
      text: text.trim(),
    });
    onClose();
  };

  // ─── Voice section (Q11) ─────────────────────────────────────────────────
  const voiceRecorder = useVoiceRecorder();
  const [isTranscribing, setIsTranscribing] = useState(false);

  const handleVoiceClick = async () => {
    if (!threadId) {
      toast.error('Голосовой ввод временно недоступен. Попробуй обновить страницу.');
      return;
    }
    if (voiceRecorder.isRecording) {
      const result = await voiceRecorder.stopRecording();
      if (!result) return;
      setIsTranscribing(true);
      try {
        const { text: transcript } = await transcribeThreadVoice(
          threadId,
          result.blob,
          result.fileName,
        );
        setText((prev) => (prev.trim() ? `${prev}\n${transcript}` : transcript));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Не удалось распознать речь');
      } finally {
        setIsTranscribing(false);
      }
    } else {
      if (!voiceRecorder.isSupported) return;
      await voiceRecorder.startRecording();
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out duration-200"
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 flex flex-col mx-auto w-full max-w-2xl max-h-[92dvh] bg-white rounded-t-[22px] overflow-hidden shadow-xl outline-none focus-visible:outline-none animate-homework-sheet-slide-up"
        >
          {/* Grab handle */}
          <span
            className="block w-10 h-1 rounded-sm bg-slate-300 mx-auto mt-2 mb-1 shrink-0"
            aria-hidden="true"
          />

          {/* Header */}
          <div className="flex items-start justify-between gap-2.5 px-4 pt-2 pb-3 border-b border-socrat-border-light shrink-0">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-base font-bold text-slate-900 m-0">
                {titleText}
              </DialogPrimitive.Title>
              <p className="text-xs text-socrat-muted mt-0.5 truncate">{subtitleText}</p>
            </div>
            <DialogPrimitive.Close
              type="button"
              aria-label="Закрыть"
              className="grid place-items-center w-9 h-9 rounded-full bg-socrat-surface hover:bg-socrat-border-light text-slate-700 shrink-0 touch-manipulation"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>

          {/* Body */}
          <div className="relative flex-1 min-h-0 flex flex-col">
            <div className="flex-1 overflow-y-auto px-4 pt-4 pb-5 [-webkit-overflow-scrolling:touch] flex flex-col gap-5">
              {/* Hint banner */}
              <div className="flex items-start gap-2 rounded-xl bg-socrat-primary-light border border-socrat-primary/15 px-3 py-2.5 text-[13px] leading-relaxed text-socrat-primary-dark">
                <span aria-hidden="true" className="mt-0.5 select-none">ⓘ</span>
                <span>{hint}</span>
              </div>

              {/* Preview-QA #8 (2026-05-11) reorder: Photos first (section
                  1) → Numeric second (section 2). Relabel + dynamic
                  «обязательно/по желанию» badge для numeric в extended
                  ветке. */}

              {/* Section 1 — Photos (extended + proof) */}
              {showPhotos && (
                <section className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="grid place-items-center w-[22px] h-[22px] rounded-full bg-socrat-primary-light text-socrat-primary text-xs font-bold">
                      1
                    </span>
                    <h4 className="text-[13px] font-bold text-slate-900 m-0">
                      Решение фото или скриншот
                    </h4>
                    <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded-full">
                      обязательно
                    </span>
                  </div>
                  <PhotoStrip
                    photos={photos}
                    onAdd={(ref) => setPhotos((prev) => [...prev, ref])}
                    onRemove={(ref) => setPhotos((prev) => prev.filter((p) => p !== ref))}
                    hwId={_hwId}
                    taskOrder={task.order_num}
                  />
                  <p className="text-[11px] text-socrat-muted leading-relaxed">
                    Можно несколько страниц — добавляй по одной. ИИ распознаёт формулы и проверит ход решения.
                  </p>
                </section>
              )}

              {/* Section 2 — Numeric (extended after photos; numeric-only
                  case still renders here as 1, no photos shown). */}
              {showNumeric && (
                <section className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="grid place-items-center w-[22px] h-[22px] rounded-full bg-socrat-primary-light text-socrat-primary text-xs font-bold">
                      {showPhotos ? 2 : 1}
                    </span>
                    <h4 className="text-[13px] font-bold text-slate-900 m-0">
                      Ответ
                    </h4>
                    {numericRequired ? (
                      <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded-full">
                        обязательно
                      </span>
                    ) : (
                      <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-socrat-muted bg-socrat-border-light px-1.5 py-0.5 rounded-full">
                        по желанию
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      pattern="^-?\\d*[.,]?\\d*$"
                      autoComplete="off"
                      value={numeric}
                      onChange={(e) => setNumeric(e.target.value)}
                      placeholder="например, 1,4"
                      style={{ fontSize: '16px' }}
                      className="flex-1 h-11 min-w-0 px-3 bg-white border-[1.5px] border-socrat-border rounded-[10px] font-semibold text-slate-900 outline-none focus-visible:border-socrat-primary focus-visible:ring-2 focus-visible:ring-socrat-primary/20 touch-manipulation"
                      aria-label="Ответ"
                    />
                    {task.answer_unit ? (
                      <span className="text-sm font-semibold text-slate-600 px-1 shrink-0">
                        {task.answer_unit}
                      </span>
                    ) : null}
                  </div>
                </section>
              )}

              {/* Section 3 — Optional text */}
              <section className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="grid place-items-center w-[22px] h-[22px] rounded-full bg-socrat-primary-light text-socrat-primary text-xs font-bold">
                    {(showNumeric ? 1 : 0) + (showPhotos ? 1 : 0) + 1}
                  </span>
                  <h4 className="text-[13px] font-bold text-slate-900 m-0">
                    Дополнить текстом
                  </h4>
                  <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-socrat-muted bg-socrat-border-light px-1.5 py-0.5 rounded-full">
                    по желанию
                  </span>
                </div>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Если хочешь — поясни ход решения текстом"
                  rows={3}
                  style={{ fontSize: '16px' }}
                  className="w-full min-h-[88px] px-3 py-2.5 bg-white border-[1.5px] border-socrat-border rounded-[10px] text-slate-900 leading-relaxed outline-none focus-visible:border-socrat-primary focus-visible:ring-2 focus-visible:ring-socrat-primary/20 resize-y touch-manipulation"
                  aria-label="Дополнительное пояснение"
                />
              </section>

              {/* Section 4 — Voice (Q11) */}
              <section className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="grid place-items-center w-[22px] h-[22px] rounded-full bg-socrat-primary-light text-socrat-primary text-xs font-bold">
                    {(showNumeric ? 1 : 0) + (showPhotos ? 1 : 0) + 2}
                  </span>
                  <h4 className="text-[13px] font-bold text-slate-900 m-0">
                    Голосом
                  </h4>
                  <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-socrat-muted bg-socrat-border-light px-1.5 py-0.5 rounded-full">
                    по желанию
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleVoiceClick}
                  disabled={!voiceRecorder.isSupported || isTranscribing}
                  className={`inline-flex items-center justify-center gap-1.5 h-11 px-4 rounded-[10px] text-sm font-semibold touch-manipulation transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    voiceRecorder.isRecording
                      ? 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100'
                      : 'bg-socrat-surface text-slate-700 border border-socrat-border hover:bg-socrat-border-light'
                  }`}
                >
                  {voiceRecorder.isRecording ? (
                    <>
                      <MicOff className="h-4 w-4" aria-hidden="true" />
                      Остановить запись · {voiceRecorder.recordingDurationSeconds}с
                    </>
                  ) : isTranscribing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Расшифровываем…
                    </>
                  ) : (
                    <>
                      <Mic className="h-4 w-4" aria-hidden="true" />
                      Записать голосовое объяснение
                    </>
                  )}
                </button>
                {!voiceRecorder.isSupported ? (
                  <p className="text-[11px] text-socrat-muted">
                    Голосовой ввод не поддерживается этим браузером.
                  </p>
                ) : null}
              </section>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-2.5 px-3.5 py-3 border-t border-socrat-border-light bg-white shrink-0">
              <span className="text-[11px] text-socrat-muted">
                {autosaveCaption || ' '}
              </span>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitDisabled}
                className="inline-flex items-center gap-1.5 h-11 px-4 rounded-[12px] bg-socrat-primary hover:bg-socrat-primary-dark text-white text-sm font-bold shadow-lg shadow-socrat-primary/25 disabled:opacity-45 disabled:cursor-not-allowed disabled:shadow-none touch-manipulation transition-colors"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
                Отправить на проверку
              </button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
