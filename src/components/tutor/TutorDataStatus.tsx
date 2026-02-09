import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw, WifiOff } from 'lucide-react';

interface TutorDataStatusProps {
  error?: string | null;
  isFetching?: boolean;
  isRecovering?: boolean;
  failureCount?: number;
  onRetry?: () => void;
  className?: string;
}

export function TutorDataStatus({
  error,
  isFetching = false,
  isRecovering = false,
  failureCount = 0,
  onRetry,
  className,
}: TutorDataStatusProps) {
  if (!error && !isRecovering) {
    return null;
  }

  return (
    <Alert className={className}>
      {error ? (
        <AlertCircle className="h-4 w-4" />
      ) : (
        <WifiOff className="h-4 w-4" />
      )}
      <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          <p className="font-medium">
            {error || 'Восстанавливаем соединение с сервером...'}
          </p>
          {isRecovering && (
            <p className="text-muted-foreground">
              Автоматическая попытка восстановления{failureCount > 0 ? ` (попытка ${failureCount})` : ''}.
            </p>
          )}
          {!isRecovering && isFetching && (
            <p className="text-muted-foreground">Обновляем данные в фоне.</p>
          )}
        </div>
        {onRetry && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="gap-2 self-start sm:self-auto"
          >
            <RefreshCw className="h-4 w-4" />
            Повторить
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
