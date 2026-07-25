/**
 * Учёт расхода AI-кредитов Lovable (T0, 2026-07-25).
 *
 * ЗАЧЕМ. У Lovable НЕТ программного источника остатка кредитов: MCP
 * `get_workspace` заявляет «credit balance» в описании, но фактически отдаёт
 * только `plan`. Поэтому считаем сами — данных достаточно: `token_usage_logs`
 * пишет `total_tokens` + `source` на каждый успешный вызов шлюза.
 *
 * КАЛИБРОВКА (24.07.2026, по факту исчерпания лимита 18 кредитов):
 *   5 280 209 токенов за 1150 вызовов = ровно 18 кредитов
 *   ⇒ 1 кредит ≈ 293 000 токенов ≈ 64 вызова (google/gemini-3-flash-preview)
 * Оценка ПРИБЛИЗИТЕЛЬНАЯ и зависит от модели: при смене `LOVABLE_MODEL`
 * пересчитать коэффициент (взять сумму `total_tokens` за период, поделить на
 * число кредитов, списанных Lovable за тот же период — Settings → Usage).
 *
 * Сюда же — единый маппинг `source` → человекочитаемая подпись, чтобы сырые
 * `chat_discussion` / `kb_extract` не расползлись по поверхностям.
 */

/** Лимит из настроек Lovable (владелец поднял 18 → 30 после инцидента 24.07). */
export const MONTHLY_CREDIT_LIMIT = 30;

/** См. блок «КАЛИБРОВКА» выше. */
export const TOKENS_PER_CREDIT = 293_000;

/** Порог, с которого дайджест кричит, а не сообщает. */
export const CREDIT_ALERT_THRESHOLD_PCT = 90;

/**
 * `token_usage_logs.source` → подпись для владельца. Неизвестный source
 * показываем как есть: новый AI-путь не должен ронять дайджест.
 */
const SOURCE_LABELS: Record<string, string> = {
  chat_discussion: "обсуждение в ДЗ",
  chat_generic: "общий чат",
  telegram_chat: "чат в Telegram",
  kb_extract: "загрузчик задач",
  kb_extract_refine: "загрузчик (уточнение)",
  homework_check: "проверка ДЗ",
  homework_hint: "подсказки",
  demo_check: "демо-разбор",
  mock_grade: "пробники",
  mock_ocr: "пробники (OCR)",
  reference_gen: "эталоны решений",
  tutor_student_chat: "чат с репетитором",
  bootstrap: "вступления к задачам",
  voice: "голос",
};

export function aiSourceLabel(source: string | null | undefined): string {
  if (!source) return "неизвестный источник";
  return SOURCE_LABELS[source] ?? source;
}

interface UsageSourceRow {
  source: string;
  tokens: number;
  calls: number;
}

export interface AiCreditsSnapshot {
  day: { calls: number; tokens: number; errors: number };
  month: {
    calls: number;
    tokens: number;
    credits: number;
    pct: number;
    /** Линейный прогноз к концу МСК-месяца, % от лимита. */
    forecastPct: number;
    errors: number;
    /** Календарный день МСК (1..31) — знаменатель прогноза. */
    dayOfMonth: number;
    daysInMonth: number;
    /** Номер МСК-месяца (1..12) — для подписи «прогноз к 31.07». */
    monthNumber: number;
  };
  /** Топ источников за месяц (доля в % от месячных токенов). */
  top: Array<{ label: string; pct: number }>;
  /** true — расход перевалил CREDIT_ALERT_THRESHOLD_PCT. */
  overThreshold: boolean;
}

/** Минимальная структурная форма service_role-клиента (без импорта SDK-типов). */
interface RpcClient {
  // deno-lint-ignore no-explicit-any
  rpc(fn: string, args: Record<string, unknown>): any;
}

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Компоненты МСК-даты (UTC+3 без DST — конвенция rule 101). */
function mskParts(d: Date): { year: number; month: number; day: number } {
  const shifted = new Date(d.getTime() + MSK_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Границы окон в МСК: начало календарного месяца и «за сутки» (now − 24ч).
 * Месяц берём календарный, потому что лимит Lovable — календарный.
 */
export function aiUsageWindows(now: Date): {
  monthStartIso: string;
  dayStartIso: string;
  dayOfMonth: number;
  daysInMonth: number;
  monthNumber: number;
} {
  const { year, month, day } = mskParts(now);
  return {
    monthStartIso: `${year}-${pad2(month)}-01T00:00:00+03:00`,
    dayStartIso: new Date(now.getTime() - 24 * 3600 * 1000).toISOString(),
    dayOfMonth: day,
    // day 0 следующего месяца = последний день текущего
    daysInMonth: new Date(Date.UTC(year, month, 0)).getUTCDate(),
    monthNumber: month,
  };
}

/**
 * Собрать снапшот расхода. Агрегация — в SQL (`ai_credit_usage_summary`):
 * выборкой строк считать НЕЛЬЗЯ, PostgREST молча режет на 1000 (в июле было
 * 1150 вызовов) → расход занижался бы (rule 101).
 *
 * Возвращает null на любой ошибке — дайджест обязан уйти без AI-блока,
 * а не упасть целиком.
 */
export async function computeAiCreditsSnapshot(
  db: RpcClient,
  now: Date,
): Promise<AiCreditsSnapshot | null> {
  try {
    const { monthStartIso, dayStartIso, dayOfMonth, daysInMonth, monthNumber } =
      aiUsageWindows(now);
    const { data, error } = await db.rpc("ai_credit_usage_summary", {
      _month_start: monthStartIso,
      _day_start: dayStartIso,
    });
    if (error || !data || typeof data !== "object") {
      console.warn("ai_credits_summary_failed", { code: error?.code ?? null });
      return null;
    }

    const payload = data as {
      month?: { tokens?: number; calls?: number; by_source?: UsageSourceRow[] };
      day?: { tokens?: number; calls?: number };
      errors_day?: number;
      errors_month?: number;
    };

    const monthTokens = Number(payload.month?.tokens ?? 0);
    const monthCalls = Number(payload.month?.calls ?? 0);
    const credits = monthTokens / TOKENS_PER_CREDIT;
    const pct = MONTHLY_CREDIT_LIMIT > 0 ? (credits / MONTHLY_CREDIT_LIMIT) * 100 : 0;
    const forecastPct = dayOfMonth > 0 ? (pct * daysInMonth) / dayOfMonth : pct;

    const bySource = Array.isArray(payload.month?.by_source) ? payload.month!.by_source! : [];
    const top: Array<{ label: string; pct: number }> = [];
    if (monthTokens > 0) {
      const sorted = [...bySource].sort((a, b) => Number(b.tokens ?? 0) - Number(a.tokens ?? 0));
      const head = sorted.slice(0, 3);
      for (const row of head) {
        top.push({
          label: aiSourceLabel(row.source),
          pct: (Number(row.tokens ?? 0) / monthTokens) * 100,
        });
      }
      const restTokens = sorted
        .slice(3)
        .reduce((acc, row) => acc + Number(row.tokens ?? 0), 0);
      const restPct = (restTokens / monthTokens) * 100;
      if (restPct >= 1) top.push({ label: "прочее", pct: restPct });
    }

    return {
      day: {
        calls: Number(payload.day?.calls ?? 0),
        tokens: Number(payload.day?.tokens ?? 0),
        errors: Number(payload.errors_day ?? 0),
      },
      month: {
        calls: monthCalls,
        tokens: monthTokens,
        credits,
        pct,
        forecastPct,
        errors: Number(payload.errors_month ?? 0),
        dayOfMonth,
        daysInMonth,
        monthNumber,
      },
      top,
      overThreshold: pct >= CREDIT_ALERT_THRESHOLD_PCT,
    };
  } catch (error) {
    console.warn("ai_credits_snapshot_exception", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return null;
  }
}

// ─── Форматирование для Telegram (HTML) ─────────────────────────────────────

function fmtTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(".", ",")} млн`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1000)}к`;
  return String(tokens);
}

function fmtCredits(credits: number): string {
  return credits.toFixed(1).replace(".", ",");
}

function pluralCalls(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return "вызовов";
  if (mod10 === 1) return "вызов";
  if (mod10 >= 2 && mod10 <= 4) return "вызова";
  return "вызовов";
}

/**
 * Блок для ежедневного дайджеста. Формат согласован владельцем дословно:
 *   🤖 AI за сутки: 43 вызова · 180к токенов · ошибок шлюза 0
 *   📊 Месяц: ≈12,4 из 30 кредитов (41%) · прогноз к 31.07 — 78%
 *   Топ: обсуждение в ДЗ 48% · загрузчик задач 26% · проверка ДЗ 25%
 */
export function formatAiCreditsBlock(s: AiCreditsSnapshot): string[] {
  const { day, month, top } = s;
  const lines: string[] = [
    `🤖 AI за сутки: ${day.calls} ${pluralCalls(day.calls)} · ${fmtTokens(day.tokens)} токенов · ошибок шлюза ${day.errors}`,
    `📊 Месяц: ≈${fmtCredits(month.credits)} из ${MONTHLY_CREDIT_LIMIT} кредитов (${Math.round(month.pct)}%) · прогноз к ${pad2(month.daysInMonth)}.${pad2(month.monthNumber)} — ${Math.round(month.forecastPct)}%`,
  ];
  if (top.length > 0) {
    lines.push(`Топ: ${top.map((t) => `${t.label} ${Math.round(t.pct)}%`).join(" · ")}`);
  }
  if (s.overThreshold) {
    lines.push(
      `⚠️ <b>Расход перевалил ${CREDIT_ALERT_THRESHOLD_PCT}% лимита</b> — поднимай лимит в Lovable (Settings → Usage), иначе AI-проверка встанет у всех.`,
    );
  } else if (month.forecastPct >= 100) {
    lines.push(
      `⚠️ По текущему темпу лимит кончится до конца месяца — проверь Lovable (Settings → Usage).`,
    );
  }
  // Дисклеймер показываем, когда цифра начинает влиять на решения: до 60%
  // лимита точность коэффициента не важна и строка была бы шумом.
  if (month.pct >= 60) {
    lines.push(
      `Оценка приблизительная (калибровка 24.07: 1 кредит ≈ 293к токенов) — сверь с Lovable → Settings → Usage.`,
    );
  }
  return lines;
}
