/**
 * health-check — активный мониторинг прода с алертом в Telegram.
 *
 * Триггер: pg_cron каждые 5 минут → POST с `Authorization: Bearer
 * ${SCHEDULER_SECRET}` (guard-паттерн `tutor-plan-expiry-reminder`).
 * `verify_jwt = false` в config.toml.
 *
 * ЗАЧЕМ: мониторинга не было ВООБЩЕ — единственной проверкой был `curl` в конце
 * деплоя. О реальных поломках узнавали скриншотами в Telegram через дни, а
 * boot-crash `lesson-materials-api` держал прод сломанным ~5 дней (rule 98).
 *
 * ЧТО ПРОВЕРЯЕМ — ровно те отказы, которые у нас БЫЛИ:
 *  • shell: sokratai.ru отдаёт 200 И entry-чанк из его index.html тоже 200.
 *    Второе — прямая канарейка на белые экраны. Пинг одной главной их НЕ ловит:
 *    index.html отдавался прекрасно, а 404 прилетал на чанк.
 *  • edge: OPTIONS на критичной функции ≠ 503. 503 на OPTIONS = Deno link-fail,
 *    функция мертва на ВСЕХ роутах (401 = жива, 404 = не задеплоена, rule 98).
 *
 * ДИСЦИПЛИНА АЛЕРТОВ: алерт только на переходе здоров→сломан, только после
 * ДВУХ провалов подряд (РФ-DPI роняет одиночные запросы — тот же урок, что
 * tiered-статус кабинета в rule 95), восстановление сообщается один раз.
 * Шумный алерт — это выключённый алерт.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendTelegramMessage } from "../_shared/telegram-send.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";

const SITE_URL = "https://sokratai.ru";
const API_URL = "https://api.sokratai.ru";
/** Порог: одиночный провал = DPI, два подряд = поломка. */
const FAILURES_BEFORE_ALERT = 2;
const FETCH_TIMEOUT_MS = 10_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Content-Type": "application/json",
} as const;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: corsHeaders });
}

/**
 * `AbortSignal.timeout()` — Safari < 16, но здесь Deno; всё равно собираем
 * контроллер руками: единый стиль с клиентом (rule 80) и явный таймаут важнее
 * краткости — зависший запрос превратил бы health-check в источник таймаутов.
 */
async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

type CheckResult = { ok: boolean; detail: string };

/**
 * Шелл + entry-чанк. Именно вторая половина и есть канарейка на белые экраны:
 * при разрушительном деплое index.html отдаётся, а чанк из него — 404.
 */
async function checkShell(): Promise<CheckResult> {
  let html: string;
  try {
    const res = await fetchWithTimeout(SITE_URL + "/");
    if (!res.ok) return { ok: false, detail: `главная отдаёт ${res.status}` };
    html = await res.text();
  } catch (e) {
    return { ok: false, detail: `главная недоступна: ${(e as Error).message}` };
  }

  const match = html.match(/\/assets\/(index-[A-Za-z0-9_-]+\.js)/);
  if (!match) {
    return { ok: false, detail: "в index.html не найден entry-чанк — сломана сборка или подменён шелл" };
  }

  try {
    const asset = await fetchWithTimeout(`${SITE_URL}/assets/${match[1]}`, { method: "HEAD" });
    if (!asset.ok) {
      return {
        ok: false,
        detail: `entry-чанк ${match[1]} отдаёт ${asset.status} — это белый экран у пользователей`,
      };
    }
  } catch (e) {
    return { ok: false, detail: `entry-чанк недоступен: ${(e as Error).message}` };
  }

  return { ok: true, detail: `шелл ок, entry ${match[1]}` };
}

/**
 * Boot-crash edge-функции. 503 на OPTIONS = link-fail при загрузке модуля
 * (rule 98): функция мертва на ВСЕХ роутах, включая preflight. 401 — норма
 * (жива и требует авторизации), 404 — не задеплоена.
 */
async function checkEdge(): Promise<CheckResult> {
  const targets = ["homework-api", "lesson-materials-api"];
  const broken: string[] = [];
  for (const name of targets) {
    try {
      const res = await fetchWithTimeout(`${API_URL}/functions/v1/${name}`, { method: "OPTIONS" });
      if (res.status === 503) broken.push(`${name}: 503 (boot-crash)`);
      else if (res.status === 404) broken.push(`${name}: 404 (не задеплоена)`);
    } catch (e) {
      broken.push(`${name}: ${(e as Error).message}`);
    }
  }
  return broken.length > 0
    ? { ok: false, detail: broken.join("; ") }
    : { ok: true, detail: `edge ок (${targets.join(", ")})` };
}

const CHECK_LABEL: Record<string, string> = {
  shell: "Сайт sokratai.ru",
  edge: "Edge-функции",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Scheduler guard (verbatim tutor-plan-expiry-reminder).
  const authHeader = req.headers.get("Authorization");
  const expectedSecret = Deno.env.get("SCHEDULER_SECRET");
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const recipients = (Deno.env.get("CEO_DIGEST_CHAT_IDS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const checks: Array<[string, CheckResult]> = [
    ["shell", await checkShell()],
    ["edge", await checkEdge()],
  ];

  const summary: Record<string, unknown> = {};
  const now = new Date().toISOString();

  for (const [key, result] of checks) {
    const { data: prev } = await db
      .from("health_check_state")
      .select("status, consecutive_failures")
      .eq("check_key", key)
      .maybeSingle();

    const prevStatus = prev?.status ?? "unknown";
    const prevFailures = prev?.consecutive_failures ?? 0;
    const failures = result.ok ? 0 : prevFailures + 1;
    // «failing» объявляем только на пороге. Промежуточное состояние «провал был,
    // но порог не достигнут» пишем как 'unknown': оно не равно ни 'failing'
    // (значит алерт не сработает), ни 'ok' (значит последующее восстановление
    // не будет объявлено «починкой» того, о чём мы никого не предупреждали).
    const status = result.ok
      ? "ok"
      : failures >= FAILURES_BEFORE_ALERT || prevStatus === "failing"
        ? "failing"
        : "unknown";

    // Алертим ТОЛЬКО на переходе. Пока состояние не менялось, молчим — иначе
    // за ночь прилетело бы 288 одинаковых сообщений и алерт бы отключили.
    const brokeNow = status === "failing" && prevStatus !== "failing";
    const healedNow = status === "ok" && prevStatus === "failing";

    if (brokeNow || healedNow) {
      const text = brokeNow
        ? [
            `🚨 <b>${CHECK_LABEL[key] ?? key} — сломано</b>`,
            result.detail,
            `Провалов подряд: ${failures}. Проверка идёт каждые 5 минут.`,
          ].join("\n")
        : [`✅ <b>${CHECK_LABEL[key] ?? key} — восстановлено</b>`, result.detail].join("\n");
      for (const chatId of recipients) {
        await sendTelegramMessage(chatId, text);
      }
      if (recipients.length === 0) {
        console.error("health_check_no_recipients (CEO_DIGEST_CHAT_IDS not set)");
      }
    }

    // Опущенные ключи PostgREST не включает в `ON CONFLICT DO UPDATE SET` —
    // то есть «не передали» означает «оставить как было». Именно это и нужно:
    // last_ok_at не должен обнуляться при провале, а last_alert_at — меняться,
    // когда мы никого не тревожили.
    const patch: Record<string, unknown> = {
      check_key: key,
      status,
      consecutive_failures: failures,
      last_detail: result.detail,
      updated_at: now,
    };
    if (result.ok) patch.last_ok_at = now;
    else patch.last_failure_at = now;
    if (brokeNow) patch.last_alert_at = now;

    await db.from("health_check_state").upsert(patch, { onConflict: "check_key" });

    summary[key] = { ok: result.ok, status, failures, detail: result.detail };
  }

  const allOk = checks.every(([, r]) => r.ok);
  if (!allOk) console.warn("health_check_failing", JSON.stringify(summary));

  return json({ ok: allOk, checks: summary });
});
