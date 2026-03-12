import { AlertCircle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface KBStatusCardProps {
  error?: string | null;
  isFetching?: boolean;
  onRetry?: () => void;
  className?: string;
}

export function KBStatusCard({
  error,
  isFetching = false,
  onRetry,
  className,
}: KBStatusCardProps) {
  if (!error) {
    return null;
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-4 rounded-2xl border border-socrat-border bg-white px-5 py-4',
        'shadow-[0_12px_30px_-26px_rgba(15,23,42,0.35)] sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-socrat-accent-light text-socrat-accent">
          <AlertCircle className="h-4 w-4" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-slate-900">{error}</p>
          <p className="text-xs text-slate-500">
            {isFetching ? 'Обновляем данные в фоне. Можно попробовать ещё раз.' : 'Попробуйте обновить данные.'}
          </p>
        </div>
      </div>

      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className={cn(
            'inline-flex items-center gap-2 self-start rounded-xl border border-socrat-border bg-white px-4 py-2.5',
            'text-sm font-semibold text-slate-700 shadow-sm transition-all duration-200',
            'hover:border-socrat-primary/30 hover:text-socrat-primary sm:self-auto',
          )}
        >
          <RefreshCw className="h-4 w-4" />
          Повторить
        </button>
      )}
    </div>
  );
}
