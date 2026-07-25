/**
 * Политика запросов tutor-кабинета. Классификаторы ошибок и механика таймаута
 * живут в общем `src/lib/queryResilience.ts` (единое определение «сетевой
 * ошибки» на весь проект) — здесь остаются tutor-специфичные КОНСТАНТЫ и
 * логирование. Публичный API этого модуля не менялся: `isTutorNetworkError`
 * реэкспортируется, все существующие call-site'ы работают дословно.
 */
import {
  isNetworkError,
  isNotFoundError,
  raceWithTimeout,
  toErrorMessage,
  withJitter,
} from "@/lib/queryResilience";

export const TUTOR_TIMEOUT_MS = 10000;
export const TUTOR_MAX_RETRIES = 5; // 5 retries + first attempt = 6 total attempts
/**
 * Для сетевых сбоев (Failed to fetch / ERR_CONNECTION_RESET) длинная цепочка
 * ретраев бесполезна и создаёт у пользователя ложное ощущение, что «сервер
 * восстанавливается 5 минут». Для таких ошибок ограничиваемся одной
 * повторной попыткой и сразу показываем честное сообщение.
 */
export const TUTOR_NETWORK_MAX_RETRIES = 1;
export const TUTOR_RETRY_BASE_DELAY_MS = 500;
export const TUTOR_RETRY_MAX_DELAY_MS = 5000;
export const TUTOR_STALE_TIME_MS = 60000;
export const TUTOR_GC_TIME_MS = 600000;
export const TUTOR_BACKGROUND_REFETCH_MS = 15000;

type TutorQueryKey = readonly unknown[];

export function tutorQueryKeyToString(queryKey: TutorQueryKey): string {
  return queryKey
    .map((part) => (typeof part === "string" || typeof part === "number" ? String(part) : JSON.stringify(part)))
    .join(":");
}

export async function withTutorTimeout<T>(
  queryKey: TutorQueryKey,
  promise: Promise<T>,
  timeoutMs: number = TUTOR_TIMEOUT_MS
): Promise<T> {
  const key = tutorQueryKeyToString(queryKey);
  return raceWithTimeout(
    promise,
    timeoutMs,
    "TutorQueryTimeoutError",
    `Tutor query timed out: ${key}`,
  );
}

/**
 * Признак того, что запрос упал из-за сетевой ошибки уровня браузера
 * (DNS / TCP reset / CORS / отсутствие сети), а не из-за самого backend.
 * В таких случаях backend, скорее всего, жив, но текущая сеть пользователя
 * не может до него достучаться — типичный кейс блокировок у российских
 * провайдеров без VPN.
 *
 * Алиас общего `isNetworkError` (`src/lib/queryResilience.ts`) — определение
 * одно на проект. Общая версия ШИРЕ прежней локальной: добавлены формулировки
 * iOS Safari («the network connection was lost»), которые раньше ошибочно
 * классифицировались как серверные, хотя ученики массово на старых iPhone.
 */
export const isTutorNetworkError = isNetworkError;

export function createTutorRetry(queryKey: TutorQueryKey) {
  const key = tutorQueryKeyToString(queryKey);

  return (failureCount: number, error: unknown): boolean => {
    if (isNotFoundError(error)) {
      console.warn("tutor_query_no_retry_not_found", { queryKey: key, error: toErrorMessage(error) });
      return false;
    }

    // Network-level errors почти никогда не лечатся ретраями — это
    // блокировка/сброс на сетевом пути. Делаем максимум 1 повторную
    // попытку и быстро отдаём ошибку наверх, чтобы UI показал
    // правильное сообщение и не висел в «восстановлении».
    if (isTutorNetworkError(error)) {
      if (failureCount <= TUTOR_NETWORK_MAX_RETRIES) {
        console.warn("tutor_query_network_retry", {
          queryKey: key,
          failureCount,
          error: toErrorMessage(error),
        });
        return true;
      }
      console.error("tutor_query_network_failed", {
        queryKey: key,
        failureCount,
        error: toErrorMessage(error),
      });
      return false;
    }

    if (failureCount <= TUTOR_MAX_RETRIES) {
      console.warn("tutor_query_retry", {
        queryKey: key,
        failureCount,
        error: toErrorMessage(error),
      });
      return true;
    }

    console.error("tutor_query_timeout", {
      queryKey: key,
      failureCount,
      error: toErrorMessage(error),
    });
    return false;
  };
}

/**
 * Экспонента с джиттером. Джиттер обязателен: под DPI много запросов кабинета
 * падают одновременно и без разброса ретраятся в одну миллисекунду, воссоздавая
 * ту самую пачку параллельных соединений, которую DPI и бьёт.
 */
export function tutorRetryDelay(attemptIndex: number): number {
  return withJitter(
    Math.min(TUTOR_RETRY_BASE_DELAY_MS * Math.pow(2, attemptIndex), TUTOR_RETRY_MAX_DELAY_MS),
    TUTOR_RETRY_MAX_DELAY_MS,
  );
}

export function getTutorBackgroundRefetchInterval(hasData: boolean, hasError: boolean): number | false {
  if (!hasData && hasError) {
    return TUTOR_BACKGROUND_REFETCH_MS;
  }
  return false;
}

export function toTutorErrorMessage(defaultMessage: string, error: unknown): string {
  const message = toErrorMessage(error).toLowerCase();

  if (message.includes("timed out")) {
    return `${defaultMessage} (истекло время ожидания ответа)`;
  }

  // Network-level failures (DPI reset / blocked host) keep the page-specific
  // neutral message. TutorDataStatus calmly explains the transient-connection
  // context; we no longer blame the tutor's network or push VPN here — the
  // fragile leg is our cross-border proxy hop, usually not them (rule 95).
  return defaultMessage;
}
