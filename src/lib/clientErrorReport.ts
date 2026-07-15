/**
 * PII-free репорт клиентских крашей → edge `client-error-report` →
 * analytics_events('client_error') → /admin вкладка «Ошибки».
 *
 * Инцидент Глеба 2026-07-15: о белых экранах узнавали по скриншотам в TG
 * через дни. Писатели: ErrorBoundary (kind 'screen') и MarkdownErrorBoundary
 * (kind 'markdown_bubble' — деградация пузыря тоже видна, не только краш).
 *
 * Fire-and-forget: никогда не бросает, не блокирует рендер. Анти-спам:
 * не чаще 1 репорта / 30 сек + дедуп одинаковых сообщений за сессию.
 * Только прод/preview-хосты (PROD_HOSTS) — dev-шум не пишем. Route
 * дополнительно санитизируется на edge (query/токены не утекают).
 */
import { PROD_HOSTS } from '@/registerServiceWorker';
import { supabase, SUPABASE_PUBLISHABLE_KEY } from '@/lib/supabaseClient';

const REPORT_URL = 'https://api.sokratai.ru/functions/v1/client-error-report';
const THROTTLE_MS = 30 * 1000;
const THROTTLE_KEY = 'sokrat-client-error-last';

const sentThisSession = new Set<string>();

// In-memory фолбэк троттлинга: localStorage может быть недоступен именно там,
// где наблюдаемость нужнее всего (Safari private / restricted webview,
// ревью 2026-07-15 P2) — его сбой НЕ должен глушить репорт целиком.
let memLastSentAt = 0;

function readLastSentAt(): number {
  try {
    return Number(localStorage.getItem(THROTTLE_KEY) || 0) || memLastSentAt;
  } catch {
    return memLastSentAt;
  }
}

function writeLastSentAt(ts: number): void {
  memLastSentAt = ts;
  try {
    localStorage.setItem(THROTTLE_KEY, String(ts));
  } catch {
    // приватный режим / quota — работаем на in-memory фолбэке
  }
}

export type ClientErrorKind = 'screen' | 'markdown_bubble';

export function reportClientError(message: string, kind: ClientErrorKind): void {
  try {
    if (!PROD_HOSTS.includes(window.location.hostname)) return;

    const normalized = String(message || '').slice(0, 400);
    if (!normalized) return;

    const dedupeKey = `${kind}:${normalized}`;
    if (sentThisSession.has(dedupeKey)) return;

    if (Date.now() - readLastSentAt() < THROTTLE_MS) return;
    writeLastSentAt(Date.now());
    sentThisSession.add(dedupeKey);

    // getSession — локальный кеш, мгновенно (performance.md §2a). user_id
    // диагностический (спуфинг не даёт привилегий, edge валидирует UUID).
    void supabase.auth
      .getSession()
      .then(({ data }) =>
        fetch(REPORT_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            message: normalized,
            kind,
            route: window.location.pathname,
            ua: navigator.userAgent,
            user_id: data.session?.user?.id ?? null,
          }),
          keepalive: true,
        }),
      )
      .catch(() => {
        // Сетевой сбой не должен НАВСЕГДА подавлять этот message в сессии
        // (ревью P2): снимаем дедуп — троттлинг 30с остаётся первой линией.
        sentThisSession.delete(dedupeKey);
      });
  } catch {
    // телеметрия никогда не ломает приложение
  }
}
