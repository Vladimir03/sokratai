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

export type ClientErrorKind = 'screen' | 'markdown_bubble';

export function reportClientError(message: string, kind: ClientErrorKind): void {
  try {
    if (!PROD_HOSTS.includes(window.location.hostname)) return;

    const normalized = String(message || '').slice(0, 400);
    if (!normalized) return;

    const dedupeKey = `${kind}:${normalized}`;
    if (sentThisSession.has(dedupeKey)) return;

    const last = Number(localStorage.getItem(THROTTLE_KEY) || 0);
    if (Date.now() - last < THROTTLE_MS) return;
    localStorage.setItem(THROTTLE_KEY, String(Date.now()));
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
      .catch(() => undefined);
  } catch {
    // телеметрия никогда не ломает приложение
  }
}
