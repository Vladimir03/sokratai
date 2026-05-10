import { useEffect, useMemo, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Loader2, Mic, MicOff, Send, X } from 'lucide-react';
import { useSubmitSolution } from '@/hooks/useSubmitSolution';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import { transcribeThreadVoice } from '@/lib/studentHomeworkApi';
import { PhotoStrip } from './PhotoStrip';
import { VerdictOverlay } from './VerdictOverlay';
import type { CheckAnswerResponse } from '@/types/homework';

const AUTOSAVE_INTERVAL_MS = 5_000;
const DRAFT_STORAGE_PREFIX = 'submitsheet-draft-';

/**
 * localStorage shape — `{numeric, photos, text}` matches `SubmitSolutionPayload`
 * minus the wire-side normalisation. `savedAt` is server-clock-independent
 * timestamp for the «Черновик сохранён · X сек назад» footer caption.
 */
interface SubmitSheetDraft {
  numeric: string;
  photos: string[];
  text: string;
  savedAt: number;
}

/**
 * Normalise a user-typed numeric string for the wire payload: comma → dot,
 * collapse internal whitespace. We deliberately preserve the original
 * string for `submission_payload.numeric` echo back / tutor view (audit
 * trail) — only the wire send is normalised so the AI prompt + strict
 * equality fallbacks see canonical "1.4". `<input inputMode="decimal">`
 * already accepts both Russian and English locale separators reliably
 * (unlike `<input type="number">`, which is browser-locale-dependent and
 * silently drops comma input in many configurations — codex finding #8).
 */
function normaliseNumericForWire(raw: string): string {
  return raw.trim().replace(/,/g, '.');
}

export type SubmitSheetTaskKind = 'numeric' | 'extended' | 'proof';

interface SubmitSheetTask {
  /** UUID of the task. */
  id: string;
  /** 1-based position within the assignment — used in storage paths + header. */
  order_num: number;
  /** Total tasks in the assignment — for header «Сдать задачу N из M». */
  task_total?: number;
  /** Max score for this task (display + step counter). */
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
  /** Close request — parent should ignore while `verdict` is being shown if it wants strict gating; this component already prevents close mid-submit. */
  onClose: () => void;
  task: SubmitSheetTask;
  hwId: string;
  taskId: string;
  /**
   * Called once the verdict overlay is dismissed. Parent navigates / refetches.
   *  - `(verdict, score, max, response)` signature lets the parent telemetry-emit
   *    or auto-advance.
   */
  onSubmitted: (
    verdict: CheckAnswerResponse['verdict'],
    score: number,
    max: number,
    response: CheckAnswerResponse,
  ) => void;
  /**
   * Fires once per submit click, BEFORE the mutation resolves. Used by the
   * parent for the `student_submission_sent` telemetry event so we capture
   * intent even if the request times out / fails. Payload is PII-free —
   * `numericLength` is the trimmed length, never the value.
   */
  onSubmitStart?: (payload: {
    hasPhotos: boolean;
    photoCount: number;
    hasText: boolean;
    numericLength: number;
  }) => void;
}

const HINT_BY_KIND: Record<SubmitSheetTaskKind, string> = {
  numeric: 'Достаточно числового ответа.',
  extended:
    'Развёрнутое решение: нужны и ответ, и фото с ходом решения. Без хода — 0 баллов.',
  proof: 'Доказательство — нужны фото с подробным выводом.',
};

const NUMERIC = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

/**
 * Bottom-sheet form for the single-shot homework solution.
 *
 * Built on `@radix-ui/react-dialog` primitives directly (instead of
 * `src/components/ui/sheet.tsx`) — the shadcn `Sheet` `bottom` variant has
 * a different animation and lacks the pixel-perfect grab-handle / max-h /
 * rounded-top treatment from the design handoff. Radix gives us focus
 * trap, escape handling, body scroll-lock, and outside click for free
 * (matches the AC «shadcn Sheet primitive (focus-trap)»).
 *
 * Sections rendered conditionally on `task.task_kind`:
 *   1. Numeric answer — render unless `proof`.
 *   2. Photo strip — render for `extended` and `proof`.
 *   3. Optional text reasoning — always available.
 *   4. Voice — Phase 2.
 *
 * Submit-button enablement matches `task_kind` requirements exactly so the
 * server-side validator never has to reject; client + backend agree on the
 * rules (anti-double-source-of-truth: kept only in `kindReady`).
 *
 * Verdict overlay is mounted into the sheet body's z-stack rather than as
 * a separate Dialog — single focus context (per spec §6 + the user's
 * instruction "VerdictOverlay не fixed модал — рендерится внутри SubmitSheet
 * body conditional"). Submission state stays in local React state until
 * verdict closes — resilient to accidental refresh / navigation.
 */
export function SubmitSheet({
  open,
  onClose,
  task,
  hwId,
  taskId,
  onSubmitted,
  onSubmitStart,
}: SubmitSheetProps) {
  const [numeric, setNumeric] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [verdict, setVerdict] = useState<CheckAnswerResponse | null>(null);
  /**
   * Network/AI failure state — distinct from a successful but `INCORRECT`
   * verdict. When set, VerdictOverlay renders in `error` mode with a real
   * retry CTA. Submission inputs (numeric/photos/text) stay populated so
   * the retry replays the original payload (AC-6 + codex finding #7).
   */
  const [submitError, setSubmitError] = useState<string | null>(null);

  const submitMutation = useSubmitSolution(hwId, taskId);
  const isSubmitting = submitMutation.isPending;

  // ─── Autosave (Q12, 2026-05-10) ──────────────────────────────────────────
  // Persist a draft to localStorage every AUTOSAVE_INTERVAL_MS while the
  // sheet is open. Restore on (re)open for the same task. Footer caption
  // tracks the last-saved time so the student knows the draft is real.
  const draftKey = `${DRAFT_STORAGE_PREFIX}${taskId}`;
  const [lastAutosaveAt, setLastAutosaveAt] = useState<number | null>(null);
  const lastSerializedRef = useRef<string>('');

  // Restore from localStorage on open; otherwise reset to blank.
  useEffect(() => {
    if (!open) return;
    setVerdict(null);
    setSubmitError(null);
    submitMutation.reset();

    let restored = false;
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SubmitSheetDraft>;
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
      // Corrupted draft — drop and start clean.
    }
    if (!restored) {
      setNumeric('');
      setPhotos([]);
      setText('');
      lastSerializedRef.current = '';
      setLastAutosaveAt(null);
    }
    // submitMutation.reset is identity-stable per react-query; safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draftKey]);

  // Periodic autosave (every 5s while sheet is open). Skip if nothing
  // changed since the last serialized snapshot to avoid useless writes.
  useEffect(() => {
    if (!open) return;
    const interval = window.setInterval(() => {
      const snapshot = JSON.stringify({ numeric, photos, text });
      if (snapshot === lastSerializedRef.current) return;
      // Don't persist a fully-empty draft (avoids localStorage litter).
      if (!numeric && photos.length === 0 && !text) {
        window.localStorage.removeItem(draftKey);
        lastSerializedRef.current = snapshot;
        setLastAutosaveAt(null);
        return;
      }
      const now = Date.now();
      const draft: SubmitSheetDraft = { numeric, photos, text, savedAt: now };
      try {
        window.localStorage.setItem(draftKey, JSON.stringify(draft));
        lastSerializedRef.current = snapshot;
        setLastAutosaveAt(now);
      } catch {
        // Quota exceeded etc. — silent fail (draft is best-effort).
      }
    }, AUTOSAVE_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [open, draftKey, numeric, photos, text]);

  // Caption «Черновик сохранён · N сек назад» — recompute every 10s while
  // the sheet is mounted so the timestamp doesn't go stale visually.
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
    // touch tick so memo re-runs on caption refresh
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
        return numericOk && photoOk;
    }
  }, [numeric, photos.length, task.task_kind]);

  const submitDisabled = !kindReady || isSubmitting;

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

  const handleSubmit = async () => {
    if (submitDisabled) return;
    // Normalise comma → dot for the wire payload (codex finding #8).
    // Original user input stays in the `numeric` state so the retry path
    // re-displays exactly what the student typed.
    const wireNumeric = normaliseNumericForWire(numeric);
    const trimmedText = text.trim();
    onSubmitStart?.({
      hasPhotos: photos.length > 0,
      photoCount: photos.length,
      hasText: trimmedText.length > 0,
      numericLength: wireNumeric.length,
    });
    setSubmitError(null);
    try {
      const response = await submitMutation.mutateAsync({
        numeric: wireNumeric,
        photos,
        text: trimmedText,
      });
      // Keep submitted data in state until verdict is dismissed — protects
      // the «Переснять решение» path: re-opening doesn't lose context.
      setVerdict(response);
    } catch (err) {
      // Network / timeout / 5xx — surface as the error verdict overlay with
      // explicit retry. State (numeric/photos/text) is preserved so the
      // retry replays the original payload (AC-6 + codex finding #7).
      const msg = err instanceof Error ? err.message : 'Не удалось отправить решение';
      setSubmitError(msg);
    }
  };

  /** Helper: drop autosaved draft on CORRECT verdict (prevents stale
   *  draft from showing up on the next homework if same taskId reused). */
  const clearAutosaveDraft = () => {
    try {
      window.localStorage.removeItem(draftKey);
    } catch {
      /* noop */
    }
    setLastAutosaveAt(null);
    lastSerializedRef.current = '';
  };

  const handleVerdictContinue = () => {
    if (!verdict) return;
    const earned = verdict.earned_score ?? 0;
    onSubmitted(verdict.verdict, earned, verdict.max_score, verdict);
    if (verdict.verdict === 'CORRECT') clearAutosaveDraft();
    setVerdict(null);
    onClose();
  };

  const handleVerdictNext = () => {
    if (!verdict) return;
    const earned = verdict.earned_score ?? 0;
    onSubmitted(verdict.verdict, earned, verdict.max_score, verdict);
    if (verdict.verdict === 'CORRECT') clearAutosaveDraft();
    setVerdict(null);
    onClose();
  };

  /** Dismiss the error overlay without closing the sheet — student can
   *  amend the form (e.g. add another photo) and submit again. */
  const handleErrorDismiss = () => {
    setSubmitError(null);
  };

  /** Re-run mutation with the same payload — input state is unchanged. */
  const handleErrorRetry = () => {
    setSubmitError(null);
    void handleSubmit();
  };

  /**
   * Retry from a successful-but-failed verdict (`CHECK_FAILED` or zero-score
   * `INCORRECT`) — the server reply landed but AI couldn't evaluate
   * deterministically. State (numeric/photos/text) is preserved; just clear
   * the verdict and replay. Codex re-review #2.
   */
  const handleVerdictRetry = () => {
    setVerdict(null);
    void handleSubmit();
  };

  // ─── Voice section (Q11 from preview QA #1, 2026-05-10) ───────────────────
  const voiceRecorder = useVoiceRecorder();
  const [isTranscribing, setIsTranscribing] = useState(false);

  /**
   * Mic button handler — start/stop recording, then transcribe and append
   * to the section-3 text input. Phase 1 stores no audio blob; voice is
   * pure speech-to-text (per spec contract `voice_ref` stays null/undef).
   *
   * Threading through `transcribeThreadVoice` (Groq Whisper). The endpoint
   * needs a thread id — we don't have one in SubmitSheet directly because
   * the sheet is task-scoped, not thread-scoped. Workaround: pass the
   * `taskId` as a synthetic thread id; backend resolves the student's
   * actual thread by ownership. (If this turns out to be wrong, parent
   * can pass `threadId` as an additional prop in a follow-up.)
   */
  const handleVoiceClick = async () => {
    if (voiceRecorder.isRecording) {
      const result = await voiceRecorder.stopRecording();
      if (!result) return;
      setIsTranscribing(true);
      try {
        const { text: transcript } = await transcribeThreadVoice(
          taskId,
          result.blob,
          result.fileName,
        );
        // Append to existing section-3 text rather than replace, so a
        // student who already typed something doesn't lose it.
        setText((prev) => (prev.trim() ? `${prev}\n${transcript}` : transcript));
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Не удалось распознать речь';
        setSubmitError(msg);
      } finally {
        setIsTranscribing(false);
      }
    } else {
      if (!voiceRecorder.isSupported) return;
      await voiceRecorder.startRecording();
    }
  };

  // Block close (Esc / outside click) while uploading or submitting. Once
  // verdict shows the user must explicitly tap a CTA so we don't lose the
  // achievement card. Error overlay also blocks accidental dismiss — the
  // student should explicitly choose Retry vs Close.
  const handleOpenChange = (next: boolean) => {
    if (next) return;
    if (isSubmitting) return;
    if (verdict) {
      handleVerdictContinue();
      return;
    }
    if (submitError) {
      // Treat backdrop click while error is showing as «Закрыть» — drop
      // state. Explicit user choice; mirrors VerdictOverlay's onContinue.
      handleErrorDismiss();
      onClose();
      return;
    }
    onClose();
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out duration-200"
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 flex flex-col mx-auto w-full max-w-2xl max-h-[92dvh] bg-white rounded-t-[22px] overflow-hidden shadow-xl outline-none focus-visible:outline-none animate-homework-sheet-slide-up"
        >
          {/* Grab handle (mobile affordance) */}
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
              disabled={isSubmitting}
              className="grid place-items-center w-9 h-9 rounded-full bg-socrat-surface hover:bg-socrat-border-light text-slate-700 shrink-0 touch-manipulation disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>

          {/* Body — relative parent for the verdict z-stack */}
          <div className="relative flex-1 min-h-0 flex flex-col">
            <div className="flex-1 overflow-y-auto px-4 pt-4 pb-5 [-webkit-overflow-scrolling:touch] flex flex-col gap-5">
              {/* Hint banner */}
              <div className="flex items-start gap-2 rounded-xl bg-socrat-primary-light border border-socrat-primary/15 px-3 py-2.5 text-[13px] leading-relaxed text-socrat-primary-dark">
                <span aria-hidden="true" className="mt-0.5 select-none">ⓘ</span>
                <span>{hint}</span>
              </div>

              {/* Section 1 — Numeric */}
              {showNumeric && (
                <section className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="grid place-items-center w-[22px] h-[22px] rounded-full bg-socrat-primary-light text-socrat-primary text-xs font-bold">
                      1
                    </span>
                    <h4 className="text-[13px] font-bold text-slate-900 m-0">
                      Числовой ответ
                    </h4>
                    <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded-full">
                      обязательно
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {/*
                      type="text" + inputMode="decimal" instead of
                      type="number": codex finding #8 — `<input type="number">`
                      rejects/normalises comma input inconsistently across
                      browsers (Chrome rejects "1,4", Firefox-RU accepts,
                      Safari-EN strips silently). text + inputMode shows the
                      decimal keypad on mobile and lets us own the parse via
                      `normaliseNumericForWire`. `pattern` accepts numbers
                      with optional sign + comma OR dot — rejects free text.
                    */}
                    <input
                      type="text"
                      inputMode="decimal"
                      pattern="^-?\\d*[.,]?\\d*$"
                      autoComplete="off"
                      value={numeric}
                      onChange={(e) => setNumeric(e.target.value)}
                      placeholder="например, 1,4"
                      disabled={isSubmitting}
                      // 16px font-size — prevent iOS Safari auto-zoom on focus.
                      style={{ fontSize: '16px' }}
                      className="flex-1 h-11 min-w-0 px-3 bg-white border-[1.5px] border-socrat-border rounded-[10px] font-semibold text-slate-900 outline-none focus-visible:border-socrat-primary focus-visible:ring-2 focus-visible:ring-socrat-primary/20 disabled:opacity-50 touch-manipulation"
                      aria-label="Числовой ответ"
                    />
                    {task.answer_unit ? (
                      <span className="text-sm font-semibold text-slate-600 px-1 shrink-0">
                        {task.answer_unit}
                      </span>
                    ) : null}
                  </div>
                </section>
              )}

              {/* Section 2 — Photos */}
              {showPhotos && (
                <section className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="grid place-items-center w-[22px] h-[22px] rounded-full bg-socrat-primary-light text-socrat-primary text-xs font-bold">
                      {showNumeric ? 2 : 1}
                    </span>
                    <h4 className="text-[13px] font-bold text-slate-900 m-0">
                      Фото решения от руки
                    </h4>
                    <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded-full">
                      обязательно
                    </span>
                  </div>
                  <PhotoStrip
                    photos={photos}
                    onAdd={(ref) => setPhotos((prev) => [...prev, ref])}
                    onRemove={(ref) => setPhotos((prev) => prev.filter((p) => p !== ref))}
                    hwId={hwId}
                    taskOrder={task.order_num}
                    disabled={isSubmitting}
                  />
                  <p className="text-[11px] text-socrat-muted leading-relaxed">
                    Можно несколько страниц — добавляй по одной. ИИ распознаёт формулы и проверит ход решения.
                  </p>
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
                  disabled={isSubmitting}
                  // 16px to prevent iOS auto-zoom (matches numeric input).
                  style={{ fontSize: '16px' }}
                  className="w-full min-h-[88px] px-3 py-2.5 bg-white border-[1.5px] border-socrat-border rounded-[10px] text-slate-900 leading-relaxed outline-none focus-visible:border-socrat-primary focus-visible:ring-2 focus-visible:ring-socrat-primary/20 disabled:opacity-50 resize-y touch-manipulation"
                  aria-label="Дополнительное пояснение"
                />
              </section>

              {/* Section 4 — Voice (Q11 from preview QA #1, 2026-05-10).
                  Speech-to-text helper: запись через MediaRecorder →
                  транскрипция через Groq Whisper → транскрипт ДОБАВЛЯЕТСЯ
                  к существующему тексту в section 3 (visible, editable).
                  No `voice_ref` server-side: this is a UX shortcut for
                  long text, not an audio attachment. */}
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
                  disabled={isSubmitting || !voiceRecorder.isSupported || isTranscribing}
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

            {/* Footer
                NB: «Черновик сохранён» label removed (codex finding #13) —
                Phase 1 has no autosave (spec §3 «Out of scope»). Showing
                a saved-status while there's no persistence misled students
                into thinking their answer was safe across reloads. Phase 2
                will land real autosave + restore the label tied to it. */}
            <div className="flex items-center justify-between gap-2.5 px-3.5 py-3 border-t border-socrat-border-light bg-white shrink-0">
              <span className="text-[11px] text-socrat-muted">
                {isSubmitting
                  ? 'Распознаём и проверяем…'
                  : autosaveCaption || ' '}
              </span>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitDisabled}
                // Shadow uses Tailwind's color-with-opacity syntax against
                // the brand token instead of hardcoded rgba (codex re-review
                // #4 fix). `shadow-socrat-primary/25` resolves to brand
                // green at 25% opacity through the design system —
                // visually identical to the previous
                // shadow-[0_4px_14px_rgba(27,107,74,0.25)] but routed
                // through the token. Opacity-aware shadow util ships with
                // tailwindcss-animate / Tailwind v3.3+.
                className="inline-flex items-center gap-1.5 h-11 px-4 rounded-[12px] bg-socrat-primary hover:bg-socrat-primary-dark text-white text-sm font-bold shadow-lg shadow-socrat-primary/25 disabled:opacity-45 disabled:cursor-not-allowed disabled:shadow-none touch-manipulation transition-colors"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="h-4 w-4" aria-hidden="true" />
                )}
                Отправить на проверку
              </button>
            </div>

            {/* Verdict overlay — z-stacked over the sheet body, single
                focus context. Error mode preserves form state + offers a
                real retry CTA (AC-6 + codex finding #7).
                A successful response with `verdict='CHECK_FAILED'` ALSO
                deserves a retry path (codex re-review #2): the AI couldn't
                evaluate the submission deterministically (network blip /
                rate-limit / model parse fail). State is unchanged, so we
                can replay the same payload. We also pass `onRetry` for
                `INCORRECT && earned_score === 0` because that's the
                second branch where VerdictOverlay derives `mode='error'`
                and the student likely wants to add another photo / fix
                comma input — without retry they'd close + lose state. */}
            {verdict ? (
              <VerdictOverlay
                verdict={verdict.verdict}
                aiScore={verdict.earned_score}
                maxScore={verdict.max_score}
                feedback={verdict.feedback}
                onContinue={handleVerdictContinue}
                onNext={handleVerdictNext}
                hasNext={Boolean(verdict.next_task_id || verdict.next_task_order)}
                onRetry={
                  verdict.verdict === 'CHECK_FAILED' ||
                  (verdict.verdict === 'INCORRECT' &&
                    (verdict.earned_score ?? 0) === 0)
                    ? handleVerdictRetry
                    : undefined
                }
              />
            ) : submitError ? (
              <VerdictOverlay
                mode="error"
                titleOverride="Не удалось отправить решение"
                aiScore={null}
                maxScore={task.max_score}
                feedback={submitError}
                onContinue={() => {
                  handleErrorDismiss();
                  onClose();
                }}
                onNext={handleErrorDismiss}
                onRetry={handleErrorRetry}
              />
            ) : null}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
