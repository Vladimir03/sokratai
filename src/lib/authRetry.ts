/**
 * Устойчивость auth-запросов под РФ-DPI (2026-07-07).
 *
 * Проблема: `signInWithPassword` / `is_tutor` — одиночные критичные запросы к
 * `api.sokratai.ru`; РФ-DPI вероятностно роняет их БЕЗ ответа, и форма логина
 * висит на «Вход...» бесконечно (в форме нет таймаута — репорт Милады 2026-07-07).
 *
 * Решение: таймаут на попытку + ретрай ТОЛЬКО на СЕТЕВОЙ сбой/таймаут. Реальные
 * ответы сервера (в т.ч. `{ error }` вроде «неверный пароль») возвращаются как
 * есть — БЕЗ ретрая (fast-fail; иначе неверный пароль крутил бы попытки и упирался
 * в rate-limit авторизации). Happy-path не задет: при рабочей сети запрос
 * резолвится за <2с, таймаут/ретрай не активируются.
 *
 * Safari-safe (rule 80): Promise.race + setTimeout, без `AbortSignal.timeout`.
 * Зеркало `TutorGuard.withTimeout`.
 */

/** Таймаут на попытку. Щедрый (не рубить легитимный медленный логин в РФ). */
export const AUTH_ATTEMPT_TIMEOUT_MS = 10_000;
/** 2 попытки = 1 ретрай. Больше — риск упереться в auth rate-limit. */
export const AUTH_MAX_ATTEMPTS = 2;

const TIMEOUT_MESSAGE = 'AUTH_NETWORK_TIMEOUT';

async function raceWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(TIMEOUT_MESSAGE)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * true = транзиентный сетевой сбой/таймаут (ретраить + показать «сеть не отвечает»);
 * false = реальная ошибка (неверный пароль и т.п. — не ретраить).
 */
export function isAuthNetworkFailure(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return (
    msg === TIMEOUT_MESSAGE.toLowerCase() ||
    msg.includes('failed to fetch') || // Chrome/Firefox — оборванный запрос
    msg.includes('load failed') || // Safari — оборванный запрос
    msg.includes('networkerror') ||
    msg.includes('network request failed')
  );
}

/**
 * Выполнить `fn` с таймаутом на попытку; ретраить ТОЛЬКО на сетевой сбой/таймаут.
 * Если `fn` РЕЗОЛВИТСЯ (успех ИЛИ `{ error }`) — вернуть как есть, без ретрая.
 * Бросает исходную ошибку после исчерпания попыток (её ловит вызывающий и решает,
 * показать ли «сеть не отвечает» через `isAuthNetworkFailure`).
 *
 * `fn` ДОЛЖНА создавать свежий запрос при каждом вызове (не переиспользовать один
 * промис) — иначе ретрай ждал бы тот же оборванный запрос.
 */
export async function callAuthWithRetry<T>(
  fn: () => Promise<T>,
  opts: { onRetry?: (attempt: number) => void } = {},
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= AUTH_MAX_ATTEMPTS; attempt++) {
    try {
      return await raceWithTimeout(fn(), AUTH_ATTEMPT_TIMEOUT_MS);
    } catch (e) {
      lastError = e;
      if (attempt < AUTH_MAX_ATTEMPTS && isAuthNetworkFailure(e)) {
        opts.onRetry?.(attempt);
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}
