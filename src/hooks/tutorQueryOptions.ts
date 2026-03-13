export const TUTOR_TIMEOUT_MS = 10000;
export const TUTOR_MAX_RETRIES = 5; // 5 retries + first attempt = 6 total attempts
export const TUTOR_RETRY_BASE_DELAY_MS = 500;
export const TUTOR_RETRY_MAX_DELAY_MS = 5000;
export const TUTOR_STALE_TIME_MS = 60000;
export const TUTOR_GC_TIME_MS = 600000;
export const TUTOR_BACKGROUND_REFETCH_MS = 15000;

type TutorQueryKey = readonly unknown[];

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

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
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          const key = tutorQueryKeyToString(queryKey);
          const timeoutError = new Error(`Tutor query timed out: ${key}`);
          timeoutError.name = "TutorQueryTimeoutError";
          reject(timeoutError);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/** Error messages that should NOT be retried (resource genuinely missing). */
function isNonRetryableError(error: unknown): boolean {
  const msg = toErrorMessage(error).toLowerCase();
  return msg.includes("not found") || msg.includes("not_found");
}

export function createTutorRetry(queryKey: TutorQueryKey) {
  const key = tutorQueryKeyToString(queryKey);

  return (failureCount: number, error: unknown): boolean => {
    if (isNonRetryableError(error)) {
      console.warn("tutor_query_no_retry_not_found", { queryKey: key, error: toErrorMessage(error) });
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

export function tutorRetryDelay(attemptIndex: number): number {
  return Math.min(TUTOR_RETRY_BASE_DELAY_MS * Math.pow(2, attemptIndex), TUTOR_RETRY_MAX_DELAY_MS);
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

  if (message.includes("failed to fetch") || message.includes("network")) {
    return `${defaultMessage} (проблема с сетью)`;
  }

  return defaultMessage;
}
