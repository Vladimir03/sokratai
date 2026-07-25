/**
 * Общая политика устойчивости запросов (React Query + fetch-обёртки).
 *
 * ЗАЧЕМ: `src/App.tsx` держал буквально `new QueryClient()` — без единой
 * настройки, то есть все student-хуки жили на дефолтах библиотеки (retry 3 без
 * различения классов ошибок). Вся продуманная политика существовала только в
 * `src/hooks/tutorQueryOptions.ts` и была opt-in — её подключил лишь tutor-слой.
 *
 * Этот модуль — leaf (НЕ импортирует ничего из проекта), поэтому дёшев для
 * eager entry-чанка. `tutorQueryOptions.ts` реэкспортирует классификаторы
 * отсюда, чтобы определение «сетевой ошибки» существовало в одном месте.
 *
 * Safari 15 (rule 80): только `Date.now`/`setTimeout`/`Math`, без
 * `AbortSignal.timeout` и lookbehind-регэкспов.
 */

export const DEFAULT_NETWORK_MAX_RETRIES = 2; // 3 попытки суммарно
export const DEFAULT_SERVER_MAX_RETRIES = 1; // 2 попытки суммарно
export const DEFAULT_RETRY_BASE_DELAY_MS = 300;
export const DEFAULT_RETRY_MAX_DELAY_MS = 4000;
export const RETRY_JITTER_RATIO = 0.25;

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "");
  }
  return String(error);
}

/** Ресурса реально нет — ретраить бессмысленно. */
export function isNotFoundError(error: unknown): boolean {
  const msg = toErrorMessage(error).toLowerCase();
  return msg.includes("not found") || msg.includes("not_found");
}

/**
 * Отказ авторизации. Ретраить нельзя: 401 владеет refresh-путь
 * (`requestStudentHomeworkApi` и др.), 403 — это решение сервера.
 */
export function isAuthRejection(error: unknown): boolean {
  const msg = toErrorMessage(error).toLowerCase();
  return (
    msg.includes("session_expired") ||
    msg.includes("forbidden") ||
    msg.includes("unauthorized") ||
    msg.includes("jwt expired")
  );
}

/**
 * Сбой сетевого уровня браузера (DNS / TCP reset / CORS / нет сети), а не ответ
 * бэкенда. Типичный кейс РФ-DPI: рвётся ~1 из N параллельных TLS-соединений до
 * `api.sokratai.ru`, при этом бэкенд жив.
 *
 * ШИРЕ, чем прежний `isTutorNetworkError`: добавлены формулировки iOS Safari
 * («the network connection was lost», «connection appears to be offline») —
 * ученики массово на старых iPhone, и раньше эти ошибки классифицировались как
 * серверные. Это баг-фикс, а не косметика.
 */
export function isNetworkError(error: unknown): boolean {
  const msg = toErrorMessage(error).toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network error") ||
    msg.includes("network request failed") ||
    msg.includes("err_connection") ||
    msg.includes("err_network") ||
    msg.includes("load failed") || // Safari fetch
    msg.includes("the network connection was lost") || // iOS Safari
    msg.includes("connection appears to be offline") || // iOS Safari
    msg.includes("auth_network_timeout") || // sentinel из authRetry
    msg.includes("timed out")
  );
}

/**
 * Разброс ±RETRY_JITTER_RATIO вокруг задержки, с КЛАМПОМ по `maxMs`.
 *
 * Кламп обязателен: без него `withJitter(4000)` возвращал до 5000мс, то есть
 * заявленный максимум задержки не был максимумом. `maxMs` по умолчанию —
 * сама задержка, поэтому джиттер тогда только УМЕНЬШАЕТ (безопасный дефолт).
 */
export function withJitter(delayMs: number, maxMs = delayMs): number {
  const spread = delayMs * RETRY_JITTER_RATIO;
  const jittered = Math.round(delayMs - spread + Math.random() * spread * 2);
  return Math.min(Math.max(0, jittered), maxMs);
}

/**
 * Глобальный `retry` для React Query. Философия уже была в репо
 * (`src/lib/authRetry.ts`): щедро к «ответа не было вовсе», скупо к «сервер
 * ответил ошибкой».
 *
 * ВАЖНО: сетевой кап тут (2 ретрая) НАМЕРЕННО больше tutor-ового
 * (`TUTOR_NETWORK_MAX_RETRIES = 1`). У tutor-поверхностей сверху лежит цикл
 * самолечения `TutorDataStatus` (6с × 20), у student-поверхностей его нет —
 * унификация этих двух чисел сделала бы ученикам ХУЖЕ, чем дефолтные 3.
 */
export function defaultQueryRetry(failureCount: number, error: unknown): boolean {
  if (isNotFoundError(error)) return false;
  if (isAuthRejection(error)) return false;
  // Строго `<`, не `<=` (ревью 5.6 P2, проверено по query-core/retryer):
  // `let failureCount = 0` и `retry(failureCount, error)` вызывается ДО
  // инкремента, поэтому первое решение приходит с 0. При `<=` каждый кап давал
  // на один ретрай больше заявленного. Тот же идиом у самого TanStack для
  // числового `retry`: `failureCount < retry`.
  if (isNetworkError(error)) return failureCount < DEFAULT_NETWORK_MAX_RETRIES;
  return failureCount < DEFAULT_SERVER_MAX_RETRIES;
}

/**
 * Экспонента с джиттером. Джиттер здесь не украшение: под DPI много запросов
 * падают одновременно и без разброса ретраятся в одну миллисекунду, воссоздавая
 * ту самую пачку параллельных соединений, которую DPI и бьёт.
 */
export function defaultRetryDelay(attemptIndex: number): number {
  return withJitter(
    Math.min(
      DEFAULT_RETRY_BASE_DELAY_MS * Math.pow(2, attemptIndex),
      DEFAULT_RETRY_MAX_DELAY_MS,
    ),
    DEFAULT_RETRY_MAX_DELAY_MS,
  );
}

/**
 * Таймаут через `Promise.race` — Safari-safe (rule 80: `AbortSignal.timeout`
 * недоступен на iOS 15). Единая механика для трёх исторических копий
 * (`withTutorTimeout`, `authRetry.raceWithTimeout`, `TutorGuard.withTimeout`);
 * у каждого вызывающего остаётся свой таймаут и свой текст ошибки.
 */
export async function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorName: string,
  errorMessage: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          const err = new Error(errorMessage);
          err.name = errorName;
          reject(err);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
