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

/**
 * Эвристика: похоже ли сообщение об ошибке на сетевую проблему уровня
 * браузера (Failed to fetch / ERR_CONNECTION_RESET / блокировка домена
 * провайдером). В таком кейсе показываем не «восстанавливаем соединение»,
 * а честный текст с подсказкой про мобильный интернет / VPN.
 */
function isLikelyNetworkBlockMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('подключ') ||
    m.includes('сет') ||
    m.includes('failed to fetch') ||
    m.includes('err_connection') ||
    m.includes('network')
  );
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

  const networkBlock = !!error && isLikelyNetworkBlockMessage(error);

  // Network-блок: показываем понятное сообщение и actionable-подсказки,
  // не пугаем пользователя бесконечным «восстанавливаем соединение».
  if (networkBlock) {
    return (
      <Alert className={className} variant="destructive">
        <WifiOff className="h-4 w-4" />
        <AlertDescription className="flex flex-col gap-3">
          <div className="text-sm space-y-1">
            <p className="font-medium">Не получается подключиться к серверу</p>
            <p className="text-muted-foreground">
              Проблема с доступом из вашей сети. Это не ошибка кабинета — сервер работает.
            </p>
            <ul className="list-disc pl-5 text-muted-foreground">
              <li>Попробуйте мобильный интернет (раздать с телефона)</li>
              <li>Включите VPN, если он у вас настроен</li>
              <li>Попробуйте другой браузер (Chrome / Firefox)</li>
            </ul>
          </div>
          {onRetry && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRetry}
              className="gap-2 self-start"
            >
              <RefreshCw className="h-4 w-4" />
              Повторить
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
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
