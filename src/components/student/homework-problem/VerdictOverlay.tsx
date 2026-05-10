import { AlertTriangle, ArrowRight, CheckCircle2, CircleHelp, RefreshCw } from 'lucide-react';
import type { CheckAnswerResponse } from '@/types/homework';

type VerdictKind = CheckAnswerResponse['verdict'];

/**
 * Three derivation modes — `'error'` is also reachable via the explicit
 * `mode='error'` prop (parent forces it on network/timeout failures even
 * when there's no `CheckAnswerResponse` to derive from).
 */
export type VerdictMode = 'correct' | 'partial' | 'error';

interface VerdictOverlayProps {
  /**
   * AI verdict from `submitSolution`. Optional when `mode='error'` is
   * forced by the parent (e.g. fetch threw before the server replied).
   */
  verdict?: VerdictKind;
  /**
   * Explicit mode override — when set, takes precedence over the verdict-
   * based derivation. Used by parent to surface network/AI failures as the
   * error card with a real retry CTA (see codex review finding #7 + AC-6).
   */
  mode?: VerdictMode;
  /** Override card title (e.g. parent-supplied error message). */
  titleOverride?: string;
  /**
   * Final score awarded for the task. Pass the resolved
   * `earned_score` from the response (override > earned > ai). `null` is
   * treated as 0 for display.
   */
  aiScore: number | null;
  /** Max score for this task. */
  maxScore: number;
  /** AI free-text feedback to surface to the student. */
  feedback: string;
  /** Close + stay on the task. */
  onContinue: () => void;
  /**
   * Move to next task — only meaningful for `CORRECT`. Parent should compute
   * the next task id and navigate (or finish the assignment if last).
   */
  onNext: () => void;
  /**
   * Re-run the previous submission with the same numeric/photos/text. Only
   * rendered in `error` mode. Parent owns state preservation — this overlay
   * never resets the SubmitSheet form. Per AC-6: «error: toast с retry —
   * submit data сохраняется в state, ученик может re-submit».
   */
  onRetry?: () => void;
  /** Whether a "next task" path exists (false → render only «Закрыть»). */
  hasNext?: boolean;
}

const NUMERIC = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

/**
 * Verdict carousel for the SubmitSheet z-stack.
 *
 * Three visual modes mapped to backend verdicts:
 *   - `CORRECT` → success card (emerald) with «Следующая задача →» CTA.
 *   - `ON_TRACK` or `INCORRECT` with aiScore > 0 → warning card (amber).
 *   - `INCORRECT` with aiScore = 0 or `CHECK_FAILED` → error card (rose).
 *
 * Renders absolutely-positioned over the SubmitSheet body (parent provides
 * the relative-positioned container). Single focus context — does NOT open
 * a new dialog, so focus-trap from the surrounding shadcn Sheet/Radix
 * Dialog continues to apply.
 *
 * `role="status"` + `aria-live="assertive"` announces the verdict to AT
 * users (assertive because the result blocks the UI; polite would be
 * easy to miss in the chat-driven environment).
 */
export function VerdictOverlay({
  verdict,
  mode: modeOverride,
  titleOverride,
  aiScore,
  maxScore,
  feedback,
  onContinue,
  onNext,
  onRetry,
  hasNext = true,
}: VerdictOverlayProps) {
  const score = aiScore ?? 0;
  const derivedMode: VerdictMode =
    verdict === 'CORRECT'
      ? 'correct'
      : verdict === 'CHECK_FAILED' || (verdict === 'INCORRECT' && score === 0)
        ? 'error'
        : 'partial';
  const mode: VerdictMode = modeOverride ?? derivedMode;

  const palette =
    mode === 'correct'
      ? {
          card: 'bg-emerald-50 border-emerald-200',
          icon: 'text-emerald-600',
          title: 'text-emerald-900',
          body: 'text-emerald-900/80',
        }
      : mode === 'partial'
        ? {
            card: 'bg-amber-50 border-amber-200',
            icon: 'text-amber-600',
            title: 'text-amber-900',
            body: 'text-amber-900/80',
          }
        : {
            card: 'bg-rose-50 border-rose-200',
            icon: 'text-rose-600',
            title: 'text-rose-900',
            body: 'text-rose-900/80',
          };

  const titleText =
    titleOverride ??
    (mode === 'correct'
      ? `Правильно! ${NUMERIC.format(score)}/${NUMERIC.format(maxScore)} баллов`
      : mode === 'partial'
        ? 'Почти — продолжай решать'
        : 'Не удалось проверить решение');

  const Icon =
    mode === 'correct' ? CheckCircle2 : mode === 'partial' ? AlertTriangle : CircleHelp;

  return (
    <div
      role="status"
      aria-live="assertive"
      aria-atomic="true"
      className="absolute inset-0 z-10 flex flex-col bg-white animate-in fade-in zoom-in-95 duration-200"
    >
      <div className="flex-1 overflow-y-auto px-4 py-6 flex items-center justify-center">
        <div className={`w-full max-w-md rounded-2xl border-2 ${palette.card} px-5 py-6 flex flex-col items-center text-center gap-3`}>
          <div className={`grid place-items-center ${palette.icon}`}>
            <Icon className="h-12 w-12 stroke-2" aria-hidden="true" />
          </div>
          <h3 className={`text-lg font-bold ${palette.title} m-0`}>{titleText}</h3>
          {mode !== 'correct' && (
            <p className={`text-[13px] leading-relaxed ${palette.body}`}>
              {feedback?.trim() || 'Сократ ещё разбирается. Попробуй уточнить решение.'}
            </p>
          )}
          {mode === 'correct' && feedback?.trim() ? (
            <p className={`text-[13px] leading-relaxed ${palette.body}`}>{feedback}</p>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-2 px-3.5 py-3 border-t border-socrat-border-light bg-white">
        {mode === 'correct' ? (
          <>
            <button
              type="button"
              onClick={onContinue}
              className="flex-1 h-11 px-4 rounded-[12px] text-sm font-semibold text-slate-700 hover:bg-socrat-surface touch-manipulation"
            >
              Остаться
            </button>
            <button
              type="button"
              onClick={hasNext ? onNext : onContinue}
              className="flex-1 inline-flex items-center justify-center gap-1.5 h-11 px-4 rounded-[12px] text-sm font-bold bg-socrat-primary hover:bg-socrat-primary-dark text-white touch-manipulation transition-colors"
            >
              {hasNext ? 'Следующая задача' : 'Завершить ДЗ'}
              <ArrowRight className="h-4 w-4 stroke-[2.5]" aria-hidden="true" />
            </button>
          </>
        ) : mode === 'error' && onRetry ? (
          // Error mode WITH retry — preserve submitted numeric/photos/text in
          // parent state and let the student re-submit without re-typing.
          // Per AC-6: «error (network/AI fail): toast с retry — submit data
          // сохраняется в state». Secondary action is «Закрыть» (closes the
          // sheet, drops state — explicit user choice).
          <>
            <button
              type="button"
              onClick={onContinue}
              className="flex-1 h-11 px-4 rounded-[12px] text-sm font-semibold text-slate-700 hover:bg-socrat-surface touch-manipulation"
            >
              Закрыть
            </button>
            <button
              type="button"
              onClick={onRetry}
              className="flex-1 inline-flex items-center justify-center gap-1.5 h-11 px-4 rounded-[12px] text-sm font-bold bg-socrat-primary hover:bg-socrat-primary-dark text-white touch-manipulation transition-colors"
            >
              <RefreshCw className="h-4 w-4 stroke-[2.5]" aria-hidden="true" />
              Попробовать снова
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onContinue}
            className="flex-1 inline-flex items-center justify-center gap-1.5 h-11 px-4 rounded-[12px] text-sm font-bold bg-socrat-primary hover:bg-socrat-primary-dark text-white touch-manipulation transition-colors"
          >
            Закрыть
          </button>
        )}
      </div>
    </div>
  );
}
