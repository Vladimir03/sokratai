/**
 * PII-free репорт клиентских крашей → edge `client-error-report` →
 * analytics_events('client_error') → /admin вкладка «Ошибки».
 *
 * Инцидент Глеба 2026-07-15: о белых экранах узнавали по скриншотам в TG
 * через дни. Писатели: ErrorBoundary (kind 'screen') и MarkdownErrorBoundary
 * (kind 'markdown_bubble' — деградация пузыря тоже видна, не только краш).
 *
 * Fire-and-forget: никогда не бросает, не блокирует рендер. Анти-спам:
 * не чаще 1 репорта / 30 сек **на каждый kind** + дедуп одинаковых сообщений за
 * сессию. Троттл per-kind, а не глобальный (2026-07-25): при глобальном окне
 * всплеск РАЗНЫХ ошибок за 30с терял все кроме первой — chunk-репорт заглушал
 * настоящий краш и наоборот.
 * Только прод/preview-хосты (PROD_HOSTS) — dev-шум не пишем. Route
 * дополнительно санитизируется на edge (query/токены не утекают).
 */
import { PROD_HOSTS } from '@/registerServiceWorker';
import { supabase, SUPABASE_PUBLISHABLE_KEY } from '@/lib/supabaseClient';

const REPORT_URL = 'https://api.sokratai.ru/functions/v1/client-error-report';
const THROTTLE_MS = 30 * 1000;
const THROTTLE_KEY_PREFIX = 'sokrat-client-error-last';

const sentThisSession = new Set<string>();

// In-memory фолбэк троттлинга: localStorage может быть недоступен именно там,
// где наблюдаемость нужнее всего (Safari private / restricted webview,
// ревью 2026-07-15 P2) — его сбой НЕ должен глушить репорт целиком.
const memLastSentAt = new Map<string, number>();

function throttleKey(kind: ClientErrorKind): string {
  return `${THROTTLE_KEY_PREFIX}:${kind}`;
}

function readLastSentAt(kind: ClientErrorKind): number {
  const mem = memLastSentAt.get(kind) ?? 0;
  try {
    return Number(localStorage.getItem(throttleKey(kind)) || 0) || mem;
  } catch {
    return mem;
  }
}

function writeLastSentAt(kind: ClientErrorKind, ts: number): void {
  memLastSentAt.set(kind, ts);
  try {
    localStorage.setItem(throttleKey(kind), String(ts));
  } catch {
    // приватный режим / quota — работаем на in-memory фолбэке
  }
}

/**
 * `chunk` — сбой загрузки lazy-чанка (стейл-деплой / DPI-обрыв).
 * `window` / `promise` — глобальные uncaught (globalErrorReporter).
 * `query` / `mutation` — сбой React Query, когда у юзера реально пусто.
 * `net` — сетевой класс, отдельный жёсткий лимит на сессию.
 *
 * Edge при неизвестном kind грациозно вырождает его в 'screen', поэтому фронт
 * можно катить раньше `VALID_KINDS` (rule 95: edge деплоит Lovable-синк).
 */
export type ClientErrorKind =
  | 'screen'
  | 'markdown_bubble'
  | 'chunk'
  | 'window'
  | 'promise'
  | 'query'
  | 'mutation'
  | 'net';

function postReport(
  normalized: string,
  kind: ClientErrorKind,
  userId: string | null,
  dedupeKey: string,
): void {
  void fetch(REPORT_URL, {
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
      user_id: userId,
    }),
    keepalive: true,
  }).catch(() => {
    // Сетевой сбой не должен НАВСЕГДА подавлять этот message в сессии
    // (ревью P2): снимаем дедуп — троттлинг остаётся первой линией.
    sentThisSession.delete(dedupeKey);
  });
}

export function reportClientError(message: string, kind: ClientErrorKind): void {
  try {
    if (!PROD_HOSTS.includes(window.location.hostname)) return;

    const normalized = String(message || '').slice(0, 400);
    if (!normalized) return;

    const dedupeKey = `${kind}:${normalized}`;
    if (sentThisSession.has(dedupeKey)) return;

    if (Date.now() - readLastSentAt(kind) < THROTTLE_MS) return;
    writeLastSentAt(kind, Date.now());
    sentThisSession.add(dedupeKey);

    if (kind === 'chunk') {
      // КРИТИЧНО: не ждём getSession(). Вызывающий (ErrorBoundary /
      // unhandledrejection-гард) синхронно дёргает location.reload() сразу
      // после нас, а `keepalive` защищает ВЫПУЩЕННЫЙ запрос, не отложенный
      // внутрь .then(). user_id здесь диагностический — потерять его бесплатно.
      postReport(normalized, kind, null, dedupeKey);
      return;
    }

    // getSession — локальный кеш, мгновенно (performance.md §2a). user_id
    // диагностический (спуфинг не даёт привилегий, edge валидирует UUID).
    void supabase.auth
      .getSession()
      .then(({ data }) =>
        postReport(normalized, kind, data.session?.user?.id ?? null, dedupeKey),
      )
      .catch(() => {
        sentThisSession.delete(dedupeKey);
      });
  } catch {
    // телеметрия никогда не ломает приложение
  }
}
