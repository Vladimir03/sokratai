/**
 * MockExamGradingProgressBanner — sticky-feel banner поверх TutorMockExamReview
 * пока AI обрабатывает пробник (status ∈ {submitted, ai_checking}).
 *
 * Spec: docs/delivery/features/mock-exams-v1-pilot-polish/ocr-grading-recovery-spec.md
 * Phase: TASK-OCR-2 Round 2 (2026-05-21).
 *
 * UX контракт:
 * - Elapsed-time countdown («AI работает 1:23 / обычно 30-90 сек»).
 * - 2 step chip'а: Часть 1 OCR (pending|running|done|failed|skipped) +
 *   Часть 2 grading (pending|running|done).
 * - Полностью derive из existing attempt data — НЕ требует backend
 *   `grading_progress` колонки. Source of truth:
 *     • `attempt.submitted_at` — start of elapsed timer.
 *     • `attempt.answer_method` — blank | form (для OCR show/skip).
 *     • `attempt.ai_part1_ocr_json.__meta.status` — OCR state.
 *     • `attempt.ai_part1_ocr_json.cells[].value` — recognized cells count.
 *     • `attempt.part2_solutions[*].ai_draft.suggested_score` — Часть 2 graded count.
 * - Stale-CTA «Запустить AI заново» после 5 мин — вызывает combo:
 *   retryMockExamPart1OCR + regradeMockExamPart2 параллельно через caller.
 *
 * Polling: handled by `useMockExamAttempt` hook (refetchInterval=5000 when
 * status ∈ {submitted, ai_checking}). Banner просто re-renders на новых
 * данных, без собственных fetch'ов.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { MockExamAttemptDetail } from '@/types/mockExam';

type ProgressChipState = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

/** AI typically finishes in ≤90s. After 5 min we surface a recovery CTA. */
const STALE_THRESHOLD_SEC = 300;

interface MockExamGradingProgressBannerProps {
  attempt: MockExamAttemptDetail;
  /** Callback for stale-CTA «Запустить AI заново». Parent owns the mutation. */
  onRetryAll: () => void;
  /** Disables the retry button while mutation is in flight. */
  isRetrying: boolean;
}

export function MockExamGradingProgressBanner({
  attempt,
  onRetryAll,
  isRetrying,
}: MockExamGradingProgressBannerProps) {
  // Render only while AI is in flight. submitted = queued, ai_checking = grading.
  const isInFlight =
    attempt.status === 'submitted' || attempt.status === 'ai_checking';

  // useEffect ниже стартует setInterval — но если banner не in_flight, можем
  // bail early. Это не нарушает hook order т.к. ниже все hooks стабильны.
  const startedAtMs = useMemo<number>(() => {
    if (attempt.submitted_at) {
      const parsed = Date.parse(attempt.submitted_at);
      if (Number.isFinite(parsed)) return parsed;
    }
    // Fallback — если submitted_at не пришёл (shouldn't happen for submitted+),
    // используем Date.now() чтобы elapsedSec = 0 → не показывает stale CTA.
    return Date.now();
  }, [attempt.submitted_at]);

  const [elapsedSec, setElapsedSec] = useState<number>(() =>
    Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)),
  );

  useEffect(() => {
    if (!isInFlight) return;
    const tick = () => {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [isInFlight, startedAtMs]);

  if (!isInFlight) return null;

  // ─── Derive OCR state (Часть 1) ────────────────────────────────────────────
  const isBlankMode = attempt.answer_method === 'blank';
  const ocrMeta = attempt.ai_part1_ocr_json?.__meta;
  const ocrCells = attempt.ai_part1_ocr_json?.cells;
  const ocrRecognizedCount = ocrCells
    ? Object.values(ocrCells).filter(
        (c) => c && typeof c.value === 'string' && c.value.trim().length > 0,
      ).length
    : 0;

  let ocrState: ProgressChipState;
  let ocrDetail: string;
  if (!isBlankMode) {
    ocrState = 'skipped';
    ocrDetail = 'автопроверка по форме';
  } else if (ocrMeta?.status === 'success') {
    ocrState = 'done';
    ocrDetail = `${ocrRecognizedCount}/20 распознано`;
  } else if (ocrMeta?.status === 'failed') {
    ocrState = 'failed';
    ocrDetail = 'не получилось';
  } else if (elapsedSec < 5) {
    ocrState = 'pending';
    ocrDetail = 'в очереди';
  } else {
    ocrState = 'running';
    ocrDetail = 'распознаю…';
  }

  // ─── Derive Часть 2 state ──────────────────────────────────────────────────
  // `ai_draft.suggested_score !== null` ⇒ AI закончил оценку этой задачи.
  // Tutor-edited задачи (status='tutor_approved'/'tutor_modified') тоже
  // считаются «оценено» — UI semantics одинаковая, цвет может различаться позже.
  const part2Graded = attempt.part2_solutions.filter(
    (s) =>
      s.ai_draft?.suggested_score !== null
      && s.ai_draft?.suggested_score !== undefined,
  ).length;
  const part2Total = attempt.part2_solutions.length;

  let part2State: ProgressChipState;
  let part2Detail: string;
  if (part2Total === 0) {
    part2State = 'skipped';
    part2Detail = 'нет задач';
  } else if (part2Graded === part2Total) {
    part2State = 'done';
    part2Detail = `${part2Graded}/${part2Total} оценено`;
  } else if (part2Graded > 0) {
    part2State = 'running';
    part2Detail = `${part2Graded}/${part2Total} оценено`;
  } else if (elapsedSec < 10) {
    part2State = 'pending';
    part2Detail = 'в очереди';
  } else {
    part2State = 'running';
    part2Detail = 'оцениваю…';
  }

  const isStale = elapsedSec > STALE_THRESHOLD_SEC;

  // Containment styles — emerald (in-flight, ok) → amber (stale, action needed).
  const containerClasses = isStale
    ? 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30'
    : 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30';

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'rounded-lg border p-4 space-y-3',
        containerClasses,
      )}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          {isStale ? (
            <AlertCircle
              className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0"
              aria-hidden="true"
            />
          ) : (
            <Sparkles
              className="h-5 w-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 animate-pulse"
              aria-hidden="true"
            />
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {isStale
                ? `AI работает медленнее обычного — ${formatElapsed(elapsedSec)}`
                : `AI проверяет работу — ${formatElapsed(elapsedSec)}`}
            </p>
            <p className="text-xs text-slate-700 dark:text-slate-300 mt-0.5">
              {isStale
                ? 'Обычно проверка занимает 30-90 секунд. Можно подождать или запустить AI заново.'
                : 'Страница обновляется автоматически каждые 5 сек. Обычно AI заканчивает за 30-90 сек.'}
            </p>
          </div>
        </div>
        {isStale && (
          <Button
            size="sm"
            variant="outline"
            onClick={onRetryAll}
            disabled={isRetrying}
            className="border-amber-300 text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-100 min-h-9 touch-manipulation"
          >
            <RotateCcw className="h-4 w-4 mr-1.5" aria-hidden="true" />
            {isRetrying ? 'Запускаю…' : 'Запустить AI заново'}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <ProgressChip label="Часть 1" state={ocrState} detail={ocrDetail} />
        <ProgressChip label="Часть 2" state={part2State} detail={part2Detail} />
      </div>
    </div>
  );
}

interface ProgressChipProps {
  label: string;
  state: ProgressChipState;
  detail: string;
}

function ProgressChip({ label, state, detail }: ProgressChipProps) {
  const config: Record<
    ProgressChipState,
    {
      icon: typeof Clock;
      classes: string;
      iconClasses?: string;
    }
  > = {
    pending: {
      icon: Clock,
      classes:
        'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
    },
    running: {
      icon: Sparkles,
      classes:
        'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200',
      iconClasses: 'animate-pulse',
    },
    done: {
      icon: CheckCircle2,
      classes:
        'border-emerald-200 bg-emerald-100 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200',
    },
    failed: {
      icon: AlertCircle,
      classes:
        'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200',
    },
    skipped: {
      icon: Check,
      classes:
        'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
    },
  };
  const c = config[state];
  const Icon = c.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium',
        c.classes,
      )}
    >
      <Icon
        className={cn('h-3.5 w-3.5 flex-shrink-0', c.iconClasses)}
        aria-hidden="true"
      />
      <span className="font-semibold">{label}:</span>
      <span>{detail}</span>
    </span>
  );
}

function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec} сек`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem === 0 ? `${min} мин` : `${min} мин ${rem.toString().padStart(2, '0')} сек`;
}
