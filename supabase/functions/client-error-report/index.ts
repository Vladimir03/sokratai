/**
 * client-error-report — приём PII-free репортов о клиентских крашах.
 *
 * Писатели: `src/lib/clientErrorReport.ts` (ErrorBoundary «белый экран» +
 * MarkdownErrorBoundary «пузырь деградировал»). Работает БЕЗ сессии
 * (verify_jwt=false — краш может случиться и на /login), клиент шлёт
 * anon-ключ в заголовках (rule 96 #11a).
 *
 * Санитизация (КРИТИЧНО):
 *  - route: только pathname, query отбрасывается; длинные hex/uuid-сегменты
 *    → ':id' (claim-токены /c/{token} и invite-коды НЕ утекают в аналитику);
 *  - message: усечение до 400 симв. (технический текст ошибки — осознанное
 *    исключение из «meta без свободного текста», решение Vladimir 2026-07-15);
 *  - ua: усечение до 300 симв.
 *
 * Анти-спам: клиент троттлит (1/мин + дедуп за сессию); здесь — in-memory
 * per-isolate кап 30/мин (best-effort) + жёсткие капы длины. Событие
 * диагностическое, спуфинг user_id не даёт привилегий.
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
const VALID_KINDS = new Set(["screen", "markdown_bubble"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// In-memory best-effort кап на isolate (isolate живёт минуты — ок как первая линия).
const WINDOW_MS = 60 * 1000;
const WINDOW_MAX = 30;
let windowStart = 0;
let windowCount = 0;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: CORS_HEADERS });
}

/** pathname без query + маскировка токеноподобных сегментов (≥16 hex/uuid-симв.). */
function sanitizeRoute(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/")) return "/";
  const pathname = raw.split("?")[0].split("#")[0];
  const masked = pathname
    .split("/")
    .map((seg) => (/^[0-9a-f-]{16,}$/i.test(seg) ? ":id" : seg))
    .join("/");
  return masked.slice(0, ROUTE_MAX);
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

  const now = Date.now();
  if (now - windowStart > WINDOW_MS) {
    windowStart = now;
    windowCount = 0;
  }
  if (++windowCount > WINDOW_MAX) {
    return json({ error: "Слишком много репортов, попробуйте позже.", code: "RATE_LIMITED" }, 429);
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ error: "Некорректное тело запроса.", code: "VALIDATION" }, 400);
    }

    const b = body as Record<string, unknown>;
    const message = clampText(b.message, MESSAGE_MAX);
    if (!message) {
      return json({ error: "Пустое сообщение об ошибке.", code: "VALIDATION" }, 400);
    }
    const kind = typeof b.kind === "string" && VALID_KINDS.has(b.kind) ? b.kind : "screen";
    const route = sanitizeRoute(b.route);
    const ua = clampText(b.ua, UA_MAX);
    const userId =
      typeof b.user_id === "string" && UUID_RE.test(b.user_id) ? b.user_id : null;

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    await logAnalyticsEvent(db, {
      event_name: "client_error",
      actor_user_id: userId,
      source: kind,
      meta: { message, route, ua },
    });

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
