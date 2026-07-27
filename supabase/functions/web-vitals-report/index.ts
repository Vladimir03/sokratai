/**
 * web-vitals-report — приём полевых Core Web Vitals (LCP/INP/CLS/TTFB/FCP).
 *
 * Писатель: `src/lib/webVitals.ts`. Работает БЕЗ сессии (verify_jwt=false —
 * замерять надо и /login, и лендинг), клиент шлёт anon-ключ в заголовках
 * (rule 96 #12). Пишет в `web_vitals_samples` под service_role.
 *
 * ПОЧЕМУ ОТДЕЛЬНАЯ ФУНКЦИЯ, а не расширение client-error-report:
 * у той durable-кап 120 событий/мин на ВСЮ систему — это разумно для крашей
 * (их должно быть мало) и абсурдно для виталов (~5 замеров на каждый pageview).
 * Общий кап означал бы, что всплеск замеров глушит репорты о белых экранах —
 * то есть телеметрия скорости ослепляла бы телеметрию надёжности.
 *
 * PII-free СТРОЖЕ, чем у крашей: здесь нет даже диагностического user_id и нет
 * свободного текста вообще. По строке нельзя узнать, кто это был — только
 * «какой маршрут, какое устройство, какая роль».
 *
 * Батч: клиент копит замеры страницы и шлёт их одним запросом на
 * `visibilitychange → hidden` (иначе INP/CLS, которые финализируются только при
 * уходе со страницы, терялись бы).
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { sanitizeRoute } from "../_shared/sanitize-route.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Content-Type": "application/json",
} as const;

const MAX_BODY_BYTES = 8 * 1024;
const MAX_SAMPLES_PER_BATCH = 20;
const APP_VERSION_MAX = 64;

const VALID_METRICS = new Set(["LCP", "INP", "CLS", "TTFB", "FCP"]);
const VALID_RATINGS = new Set(["good", "needs-improvement", "poor"]);
const VALID_DEVICES = new Set(["mobile", "desktop"]);
const VALID_ROLES = new Set(["tutor", "student", "anon"]);
// Полный набор из web-vitals v6. `back-forward-cache` и `soft-navigation`
// важны отдельно: у восстановленной из bfcache страницы метрики искусственно
// прекрасные, и смешивать их с холодными загрузками — врать себе.
const VALID_NAV_TYPES = new Set([
  "navigate",
  "reload",
  "back-forward",
  "back-forward-cache",
  "prerender",
  "restore",
  "soft-navigation",
]);

/**
 * Санитарные потолки. CLS безразмерен (сдвиг layout'а), остальные — мс.
 * Значение выше потолка — это не «очень медленно», а мусор/подделка: смысла
 * тянуть его в перцентиль нет, он бы утащил p75 в бессмыслицу.
 */
const VALUE_CEILING: Record<string, number> = {
  CLS: 10,
  LCP: 600_000,
  INP: 600_000,
  TTFB: 600_000,
  FCP: 600_000,
};

// Per-IP окно в памяти isolate — первая линия. Один pageview = один батч,
// поэтому 30/мин с запасом покрывает живого человека с активной навигацией.
const IP_WINDOW_MS = 60 * 1000;
const IP_WINDOW_MAX = 30;
const IP_MAP_MAX = 1000;
const ipWindows = new Map<string, { start: number; count: number }>();

// Durable глобальный кап (переживает холодные/параллельные isolates).
// 3000 замеров/мин ≈ 600 pageview/мин — на порядок выше нашего пика, но
// ограничивает стоимость злоупотребления. Опирается на idx_web_vitals_time.
const GLOBAL_WINDOW_MS = 60 * 1000;
const GLOBAL_WINDOW_MAX = 3000;

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

/** Имя entry-чанка (`index-<hash>.js`) — связывает просадку с конкретным релизом. */
function cleanAppVersion(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, APP_VERSION_MAX);
  return /^[A-Za-z0-9._-]+$/.test(trimmed) ? trimmed : null;
}

type Row = {
  metric: string;
  value: number;
  rating: string | null;
  route: string;
  device: string;
  role: string;
  nav_type: string | null;
  app_version: string | null;
};

/** Одна запись батча → строка или null (молча отбрасываем невалидное). */
function toRow(raw: unknown): Row | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;

  const metric = typeof s.metric === "string" ? s.metric : "";
  if (!VALID_METRICS.has(metric)) return null;

  const value = typeof s.value === "number" ? s.value : Number.NaN;
  if (!Number.isFinite(value) || value < 0 || value > VALUE_CEILING[metric]) return null;

  const device = typeof s.device === "string" && VALID_DEVICES.has(s.device) ? s.device : null;
  const role = typeof s.role === "string" && VALID_ROLES.has(s.role) ? s.role : null;
  if (!device || !role) return null;

  return {
    metric,
    // 4 знака: CLS содержателен в сотых-тысячных, миллисекундам дробь не мешает.
    value: Math.round(value * 10_000) / 10_000,
    rating: typeof s.rating === "string" && VALID_RATINGS.has(s.rating) ? s.rating : null,
    route: sanitizeRoute(s.route),
    device,
    role,
    nav_type:
      typeof s.nav_type === "string" && VALID_NAV_TYPES.has(s.nav_type) ? s.nav_type : null,
    app_version: cleanAppVersion(s.app_version),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Метод не поддерживается.", code: "METHOD_NOT_ALLOWED" }, 405);
  }

  // Ранний reject ДО чтения тела: не расходуем память на большой JSON.
  const contentLength = Number(req.headers.get("content-length") ?? "");
  if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > MAX_BODY_BYTES) {
    return json({ error: "Слишком большое или пустое тело запроса.", code: "BODY_TOO_LARGE" }, 413);
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("cf-connecting-ip") ||
    "unknown";
  if (!ipAllowed(ip)) {
    return json({ error: "Слишком много замеров, попробуйте позже.", code: "RATE_LIMITED" }, 429);
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ error: "Некорректное тело запроса.", code: "VALIDATION" }, 400);
    }

    const rawSamples = (body as Record<string, unknown>).samples;
    if (!Array.isArray(rawSamples) || rawSamples.length === 0) {
      return json({ error: "Пустой батч замеров.", code: "VALIDATION" }, 400);
    }

    const rows = rawSamples
      .slice(0, MAX_SAMPLES_PER_BATCH)
      .map(toRow)
      .filter((r): r is Row => r !== null);
    if (rows.length === 0) {
      // Батч дошёл, но ни один замер не прошёл валидацию — это ответ клиенту
      // «данные не приняты», а не тихий ok (rule 97: молчаливый успех при
      // потере данных маскирует поломку писателя).
      return json({ error: "Ни один замер не прошёл валидацию.", code: "VALIDATION" }, 400);
    }

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Durable глобальный кап (fail-open: сбой COUNT не должен ослеплять метрики).
    const { count, error: countError } = await db
      .from("web_vitals_samples")
      .select("id", { count: "exact", head: true })
      .gte("occurred_at", new Date(Date.now() - GLOBAL_WINDOW_MS).toISOString());
    if (!countError && (count ?? 0) >= GLOBAL_WINDOW_MAX) {
      return json({ error: "Слишком много замеров, попробуйте позже.", code: "RATE_LIMITED" }, 429);
    }

    const { error } = await db.from("web_vitals_samples").insert(rows);
    if (error) {
      console.error(
        JSON.stringify({ event: "web_vitals_insert_failed", error: error.message }),
      );
      return json({ error: "Не удалось сохранить замеры.", code: "DB_WRITE_FAILED" }, 500);
    }

    return json({ ok: true, accepted: rows.length });
  } catch (e) {
    // PII-free лог: без тела запроса.
    console.error(
      JSON.stringify({ event: "web_vitals_report_failed", error: (e as Error).message }),
    );
    return json(
      { error: `Не удалось сохранить замеры: ${(e as Error).message}`, code: "INTERNAL" },
      500,
    );
  }
});
