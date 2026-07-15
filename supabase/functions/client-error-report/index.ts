/**
 * client-error-report — приём PII-free репортов о клиентских крашах.
 *
 * Писатели: `src/lib/clientErrorReport.ts` (ErrorBoundary «белый экран» +
 * MarkdownErrorBoundary «пузырь деградировал»). Работает БЕЗ сессии
 * (verify_jwt=false — краш может случиться и на /login), клиент шлёт
 * anon-ключ в заголовках (rule 96 #11a).
 *
 * Санитизация (КРИТИЧНО, ревью ChatGPT-5.6 2026-07-15 P1×2):
 *  - route: route-aware маскировка bearer-маршрутов (/c/:token, /invite/:code,
 *    /p/:slug, /p/mock-result/:slug — короткие slug'и НЕ ловятся эвристикой
 *    по длине!) + генерик-маска динамических сегментов (uuid/hex/base64url
 *    ≥16 симв., чисто числовые); query/hash отбрасываются;
 *  - message: скраб email → [email], query-string внутри URL → ?[…] (сам
 *    origin+path оставляем — «какой чанк не загрузился» = диагностика),
 *    JWT (eyJ…) → [jwt], длинные token-подобные строки ≥24 симв. → [token];
 *    усечение до 400 симв. Технический текст ошибки — осознанное исключение
 *    из «meta без свободного текста» (решение Vladimir 2026-07-15);
 *  - ua: усечение до 300 симв.
 *
 * Анти-abuse (ревью P1): ранний reject по Content-Length (до req.json()),
 * per-IP окно в памяти isolate (первая линия) + durable глобальный кап
 * через COUNT последних client_error в БД (переживает cold isolates).
 * Спуфинг user_id не даёт привилегий (диагностическое поле).
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { logAnalyticsEvent } from "../_shared/analytics.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Content-Type": "application/json",
} as const;

const MESSAGE_MAX = 400;
const UA_MAX = 300;
const ROUTE_MAX = 200;
const MAX_BODY_BYTES = 8 * 1024;
const VALID_KINDS = new Set(["screen", "markdown_bubble"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Per-IP окно в памяти isolate — первая линия (обходится cold isolates,
// поэтому НЕ единственная: durable-кап ниже считает по БД).
const IP_WINDOW_MS = 60 * 1000;
const IP_WINDOW_MAX = 10;
const IP_MAP_MAX = 1000;
const ipWindows = new Map<string, { start: number; count: number }>();

// Durable глобальный кап: не больше N событий client_error в минуту суммарно
// (COUNT по БД — переживает параллельные/холодные isolates).
const GLOBAL_WINDOW_MS = 60 * 1000;
const GLOBAL_WINDOW_MAX = 120;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: CORS_HEADERS });
}

function ipAllowed(ip: string): boolean {
  const now = Date.now();
  const w = ipWindows.get(ip);
  if (!w || now - w.start > IP_WINDOW_MS) {
    if (ipWindows.size > IP_MAP_MAX) ipWindows.clear();
    ipWindows.set(ip, { start: now, count: 1 });
    return true;
  }
  w.count += 1;
  return w.count <= IP_WINDOW_MAX;
}

/**
 * Bearer-маршруты маскируются ЦЕЛИКОМ по префиксу (ревью P1: короткие
 * 8-символьные slug'и /invite и /p/* не ловятся эвристикой по длине).
 */
const ROUTE_MASKS: Array<[RegExp, string]> = [
  [/^\/c\/.+/i, "/c/:token"],
  [/^\/invite\/.+/i, "/invite/:code"],
  [/^\/p\/mock-result\/.+/i, "/p/mock-result/:slug"],
  [/^\/p\/.+/i, "/p/:slug"],
];

/** pathname без query/hash + маскировка динамических сегментов. */
function sanitizeRoute(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/")) return "/";
  const pathname = raw.split("?")[0].split("#")[0];
  for (const [re, masked] of ROUTE_MASKS) {
    if (re.test(pathname)) return masked;
  }
  const masked = pathname
    .split("/")
    .map((seg) =>
      /^[0-9a-f-]{16,}$/i.test(seg) || /^[A-Za-z0-9_-]{16,}$/.test(seg) || /^\d+$/.test(seg)
        ? ":id"
        : seg,
    )
    .join("/");
  return masked.slice(0, ROUTE_MAX);
}

/**
 * Скраб потенциального PII/токенов в тексте ошибки (ревью P1). Порядок
 * важен: сначала query внутри URL (там живут signed-URL токены), потом
 * email/JWT/длинные токены. Origin+path URL сохраняем — «какой чанк не
 * загрузился» = основная диагностика chunk-ошибок.
 */
function scrubMessage(raw: string): string {
  return raw
    .replace(/((?:https?|wss?):\/\/[^\s?"'<>]+)\?[^\s"'<>]*/gi, "$1?[…]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{4,}){0,2}/g, "[jwt]")
    .replace(/[A-Za-z0-9_-]{24,}/g, "[token]");
}

function clampText(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, max);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Метод не поддерживается.", code: "METHOD_NOT_ALLOWED" }, 405);
  }

  // Ранний reject ДО чтения тела (ревью P1: не расходуем память на большой JSON).
  const contentLength = Number(req.headers.get("content-length") ?? "");
  if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > MAX_BODY_BYTES) {
    return json({ error: "Слишком большое или пустое тело запроса.", code: "BODY_TOO_LARGE" }, 413);
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("cf-connecting-ip") ||
    "unknown";
  if (!ipAllowed(ip)) {
    return json({ error: "Слишком много репортов, попробуйте позже.", code: "RATE_LIMITED" }, 429);
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ error: "Некорректное тело запроса.", code: "VALIDATION" }, 400);
    }

    const b = body as Record<string, unknown>;
    const rawMessage = clampText(b.message, MESSAGE_MAX * 2);
    if (!rawMessage) {
      return json({ error: "Пустое сообщение об ошибке.", code: "VALIDATION" }, 400);
    }
    const message = scrubMessage(rawMessage).slice(0, MESSAGE_MAX);
    const kind = typeof b.kind === "string" && VALID_KINDS.has(b.kind) ? b.kind : "screen";
    const route = sanitizeRoute(b.route);
    const ua = clampText(b.ua, UA_MAX);
    const userId =
      typeof b.user_id === "string" && UUID_RE.test(b.user_id) ? b.user_id : null;

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Durable глобальный кап (fail-open: сбой COUNT не блокирует репорт).
    const { count, error: countError } = await db
      .from("analytics_events")
      .select("id", { count: "exact", head: true })
      .eq("event_name", "client_error")
      .gte("occurred_at", new Date(Date.now() - GLOBAL_WINDOW_MS).toISOString());
    if (!countError && (count ?? 0) >= GLOBAL_WINDOW_MAX) {
      return json({ error: "Слишком много репортов, попробуйте позже.", code: "RATE_LIMITED" }, 429);
    }

    const inserted = await logAnalyticsEvent(db, {
      event_name: "client_error",
      actor_user_id: userId,
      source: kind,
      meta: { message, route, ua },
    });
    if (!inserted) {
      // Ревью P2: endpoint существует ради записи — молчаливый {ok:true}
      // при сбое INSERT маскировал бы потерю репортов (rule 97).
      return json({ error: "Не удалось сохранить репорт об ошибке.", code: "DB_WRITE_FAILED" }, 500);
    }

    return json({ ok: true });
  } catch (e) {
    // PII-free лог: без тела запроса.
    console.error(
      JSON.stringify({ event: "client_error_report_failed", error: (e as Error).message }),
    );
    return json(
      { error: `Не удалось сохранить репорт об ошибке: ${(e as Error).message}`, code: "INTERNAL" },
      500,
    );
  }
});
