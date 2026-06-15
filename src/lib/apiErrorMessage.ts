/**
 * Extract a human-readable error message from an arbitrary edge-function JSON body.
 *
 * Supports two shapes used across the codebase:
 *   - `{ error: { message: "..." } }` (homework-api validation errors)
 *   - `{ error: "limit_reached", message: "...", tutor_can_upgrade?: boolean }`
 *     (subscription-limits 429 from `_shared/subscription-limits.ts`)
 *
 * For the limit_reached shape, appends a tutor-upgrade nudge when the backend
 * signals it (the user's tutor is on a free tier and could move to AI-старт).
 */
export function extractApiErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const b = body as Record<string, unknown>;

  let message = fallback;

  // Top-level message (limit_reached + most explicit error responses)
  if (typeof b.message === 'string' && b.message.trim().length > 0) {
    message = b.message.trim();
  } else if (b.error && typeof b.error === 'object') {
    // Nested error.message shape
    const nested = (b.error as Record<string, unknown>).message;
    if (typeof nested === 'string' && nested.trim().length > 0) {
      message = nested.trim();
    }
  }

  // Append tutor upgrade nudge for limit_reached when backend says it's relevant.
  if (b.error === 'limit_reached' && b.tutor_can_upgrade === true) {
    // Лимит — 50 сообщений в день (в ДЗ), общий на ученика, НЕ «по 50 на каждое ДЗ»
    // (счётчик daily_message_limits — один на пользователя). Не обещаем больше, чем даём.
    message = `${message} Попроси репетитора подключить тариф AI-старт — тогда лимит станет 50 сообщений в день.`;
  } else if (b.error === 'limit_reached' && b.limit === 10) {
    // Free chat-tier лимит (нет платящего тутора). Часто бьёт репетитора, который
    // открыл своё же ДЗ под собственной учёткой как ученик — он попадает в ученический лимит.
    message = `${message} Это лимит ученика без подписки. Если вы репетитор и открыли своё ДЗ для проверки — выйдите в кабинет репетитора, там лимит не действует.`;
  }

  return message;
}

/**
 * Extract a stable error code from an edge-function JSON body.
 * Supports `{ error: { code: "..." } }` and `{ error: "string_code" }` shapes.
 */
export function extractApiErrorCode(body: unknown, fallback = 'UNKNOWN'): string {
  if (!body || typeof body !== 'object') return fallback;
  const b = body as Record<string, unknown>;
  if (typeof b.error === 'string' && b.error.trim().length > 0) return b.error;
  if (b.error && typeof b.error === 'object') {
    const code = (b.error as Record<string, unknown>).code;
    if (typeof code === 'string' && code.trim().length > 0) return code;
  }
  return fallback;
}