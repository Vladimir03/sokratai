import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface TutorDataStatusProps {
  /**
   * Error from a CRITICAL query — present ONLY when the surface has no usable
   * content (primary entity / base data missing). Drives the calm
   * "тихо → громко" model:
   *   • transient failure → muted «Обновляем данные…» + silent fast self-retry;
   *   • neutral banner only after `escalateAfterMs` of sustained failure;
   *   • auto-clears on the first successful retry.
   * NEVER set this for a single failed block while the rest of the page renders
   * — that is `degraded` (else we recreate the "banner over loaded data" bug).
   */
  criticalError?: string | null;
  /**
   * A non-critical block failed while the rest of the surface rendered fine.
   * Shows a subtle note (never the banner) + a slow background self-heal.
   */
  degraded?: boolean;
  isFetching?: boolean;
  /** Manual retry + degraded self-heal — typically refetches everything. */
  onRetry?: () => void;
  /**
   * Silent CRITICAL self-heal — should refetch only the critical queries
   * (cheap, targeted). Falls back to `onRetry` when omitted.
   */
  onAutoRetry?: () => void;
  /**
   * Banner heading. Defaults to the `criticalError` message itself (already
   * page-specific and neutral after `toTutorErrorMessage`). /tutor/home overrides
   * it with a generic title because it aggregates many queries at once.
   */
  bannerTitle?: string;
  /** Grace period before a sustained critical failure escalates to the banner. */
  escalateAfterMs?: number;
  className?: string;
}

const DEFAULT_ESCALATE_AFTER_MS = 25_000;
const CRITICAL_RETRY_INTERVAL_MS = 6_000;
const CRITICAL_MAX_RETRIES = 20; // ~2 минуты быстрых тихих попыток
const DEGRADED_RETRY_INTERVAL_MS = 20_000; // периферию чиним реже, без шторма
const DEGRADED_MAX_RETRIES = 10; // ~3 минуты

export function TutorDataStatus({
  criticalError,
  degraded = false,
  isFetching = false,
  onRetry,
  onAutoRetry,
  bannerTitle,
  escalateAfterMs = DEFAULT_ESCALATE_AFTER_MS,
  className,
}: TutorDataStatusProps) {
  const hasCritical = !!criticalError;
  const [escalated, setEscalated] = useState(false);

  // Keep retry callbacks in refs so the intervals below are NOT torn down on
  // every render when the parent passes fresh callback identities.
  const onRetryRef = useRef(onRetry);
  const onAutoRetryRef = useRef(onAutoRetry);
  useEffect(() => {
    onRetryRef.current = onRetry;
    onAutoRetryRef.current = onAutoRetry;
  }, [onRetry, onAutoRetry]);

  // Escalation timer: a sustained critical failure becomes a visible banner
  // only after the grace period; transient blips self-heal silently first.
  useEffect(() => {
    if (!hasCritical) {
      setEscalated(false);
      return;
    }
    const timer = setTimeout(() => setEscalated(true), escalateAfterMs);
    return () => clearTimeout(timer);
  }, [hasCritical, escalateAfterMs]);

  // Critical self-heal — fast, targeted (refetchCritical via onAutoRetry) so the
  // tutor never reloads by hand. React-query dedups in-flight fetches.
  useEffect(() => {
    if (!hasCritical) return;
    let attempts = 0;
    const id = setInterval(() => {
      attempts += 1;
      if (attempts > CRITICAL_MAX_RETRIES) {
        clearInterval(id);
        return;
      }
      (onAutoRetryRef.current ?? onRetryRef.current)?.();
    }, CRITICAL_RETRY_INTERVAL_MS);
    return () => clearInterval(id);
  }, [hasCritical]);

  // Degraded self-heal — slow full refetch, only while there is NO critical
  // error (critical owns the UI otherwise). Heals peripheral blocks without a
  // manual reload, on a calm cadence.
  useEffect(() => {
    if (hasCritical || !degraded) return;
    let attempts = 0;
    const id = setInterval(() => {
      attempts += 1;
      if (attempts > DEGRADED_MAX_RETRIES) {
        clearInterval(id);
        return;
      }
      onRetryRef.current?.();
    }, DEGRADED_RETRY_INTERVAL_MS);
    return () => clearInterval(id);
  }, [hasCritical, degraded]);

  // Critical failure, still inside the grace window → quiet & reassuring.
  if (hasCritical && !escalated) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`flex items-center gap-2 px-1 py-2 text-sm text-muted-foreground ${className ?? ''}`}
      >
        <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
        <span>Обновляем данные…</span>
      </div>
    );
  }

  // Sustained critical failure → neutral banner. No "виновата ваша сеть", no
  // VPN list (rule 95: проблема чаще на кросс-граничном хопе, а не у тутора).
  if (hasCritical && escalated) {
    return (
      <Alert
        role="alert"
        className={`border-amber-300 bg-amber-50 text-amber-900 ${className ?? ''}`}
      >
        <AlertCircle className="h-4 w-4 text-amber-600" />
        <AlertDescription className="flex flex-col gap-3">
          <div className="text-sm space-y-1">
            <p className="font-medium">{bannerTitle ?? criticalError}</p>
            <p>
              Похоже, соединение с сервером временно прерывается. Пробуем
              восстановить автоматически.
            </p>
          </div>
          {onRetry && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRetry}
              className="gap-2 self-start border-amber-300 bg-white/60 hover:bg-white"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
              Обновить
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  // Only non-critical data failed → subtle, low-key note. Кабинет на месте.
  if (degraded) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`flex items-center justify-between gap-2 px-1 py-2 text-sm text-muted-foreground ${className ?? ''}`}
      >
        <span>Не удалось обновить часть данных.</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 font-medium text-slate-600 underline-offset-2 hover:underline"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            Обновить
          </button>
        )}
      </div>
    );
  }

  return null;
}
