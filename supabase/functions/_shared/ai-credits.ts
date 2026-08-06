/**
 * Учёт расхода AI-кредитов Lovable (T0 2026-07-25, модель по себестоимости 2026-08-06).
 *
 * ЗАЧЕМ. У Lovable НЕТ программного источника остатка кредитов: MCP
 * `get_workspace` заявляет «credit balance» в описании, но фактически отдаёт
 * только `plan` (перепроверено 06.08.2026). Поэтому считаем сами — данных
 * достаточно: `token_usage_logs` пишет prompt/completion на каждый успешный
 * вызов шлюза.
 *
 * ── МОДЕЛЬ (сверена с дашбордом Lovable → Cloud → Usage, 06.08.2026) ─────────
 *
 *   кредиты = (prompt_М × $0.50 + completion_М × $3.00) / $0.25
 *
 * То есть **1 кредит = $0.25 прайсовой стоимости Google**, а шлюз Lovable
 * перепродаёт `google/gemini-3-flash-preview` РОВНО по прайсу — наценка ≈1,00×.
 * Проверка на четырёх независимых точках дашборда (расхождение ≤0,7%):
 *
 *   окно                  | наша формула | факт Lovable
 *   5 авг (UTC)           |   2,92       |   2,92
 *   6 авг (UTC, неполный) |   2,13       |   2,13
 *   август к дате         |  11,7        |  11,8
 *   последние 30 дней     |  31,5        |  31,7
 *
 * ⚠️ ДВЕ ПРЕЖНИЕ ОШИБКИ, которые этим и чинятся (обе вели к неверным решениям):
 *
 *  1. **Плоский коэффициент «293к токенов = 1 кредит»** был откалиброван на
 *     июле, где выход составлял 11% токенов. Выход стоит в 6 раз дороже входа,
 *     поэтому как только доля выхода поехала (загрузчик задач: 18% в августе),
 *     оценка поплыла ВНИЗ: 9,4 кредита против фактических 11,8 (−20%).
 *     Владелец видел «31% лимита», когда лимит был выбран на 39%.
 *  2. **«Наценка шлюза 2,2×»** — за прайс Google приняли BATCH-тариф
 *     ($0.25/$1.50, скидка 50%). Стандартный прайс вдвое выше, и наценки нет
 *     вовсе. Из-за этой ошибки уход на прямого провайдера выглядел экономией
 *     вдвое, хотя экономии нет ни цента (см. `docs/delivery/features/
 *     ai-request-optimization/research.md`).
 *
 * Меняешь `LOVABLE_MODEL` в `_shared/ai-lovable.ts` — обнови цены НИЖЕ и заново
 * сверься с дашбордом: модель привязана к прайсу конкретной модели.
 */

/** Прайс `google/gemini-3-flash-preview`, стандартный (НЕ batch), $/1М токенов. */
export const USD_PER_M_PROMPT = 0.5;
export const USD_PER_M_COMPLETION = 3.0;

/**
 * Цена кредита в составе плана Lovable **Pro** ($50 за 200 кредитов = $0.25).
 * Докупка сверх плана дороже — $0.30/кредит (auto top-up и разовый top-up),
 * поэтому «прогноз выше 100%» = переход на дорогую цену, а не просто перерасход.
 */
export const USD_PER_CREDIT = 0.25;

/**
 * Зеркало настройки Lovable → **AI features usage limit**. При достижении шлюз
 * начинает отбивать ВСЕ вызовы (инцидент 24.07: 20 часов `CHECK_FAILED`).
 * ⚠️ Это ЗЕРКАЛО, а не источник истины: поменял в дашборде — поменяй здесь,
 * иначе дайджест будет считать процент от несуществующего лимита.
 * Лимит месяца у Lovable сбрасывается 1-го числа **по UTC** (см. `aiUsageWindows`).
 */
export const MONTHLY_CREDIT_LIMIT = 75;

/**
 * Кредитов в плане Lovable Pro за месяц. С момента слияния кошельков («Your
 * Cloud & AI balance was converted to credits») ОДИН пул кормит и работу
 * приложения (Cloud: база, AI, сеть), и правки через агента Lovable — включая
 * деплой edge-функций и миграций, который у нас единственный канал выкладки
 * (rule 96 §11). Кредиты кончились = не только AI встал, но и задеплоить нечем.
 */
export const MONTHLY_PLAN_CREDITS = 200;

/**
 * Не-AI расход проекта, кредитов в сутки (Lovable → Cloud → Usage, замер 06.08):
 * база 1,86 + сеть ~0,25 + realtime/compute/storage ~0,1. Держится ровной
 * полкой — это плата за инстанс, а не за трафик, и правками AI не двигается.
 * ⚠️ Ручное зеркало дашборда: программного источника у нас нет. Сверять раз в
 * месяц; нужно ровно для одного — показать, что AI это лишь треть счёта.
 */
export const CLOUD_DAILY_CREDITS = 2.2;

/** Порог, с которого дайджест кричит, а не сообщает. */
export const CREDIT_ALERT_THRESHOLD_PCT = 90;

/**
 * Легаси-коэффициент. Используется ТОЛЬКО как фолбэк, когда RPC ещё не отдаёт
 * раздельные prompt/completion (edge уехал раньше миграции
 * `20260806120000_ai_credit_usage_summary_cost_model`). Занижает — см. шапку.
 */
export const LEGACY_TOKENS_PER_CREDIT = 293_000;

/** Кредиты → доллары (по цене кредита в составе плана). */
export function creditsToUsd(credits: number): number {
  return credits * USD_PER_CREDIT;
}

/** Прайсовая стоимость вызова(ов) в долларах. */
export function usdOfTokens(promptTokens: number, completionTokens: number): number {
  return (promptTokens / 1e6) * USD_PER_M_PROMPT +
    (completionTokens / 1e6) * USD_PER_M_COMPLETION;
}

/** Основная формула: токены → кредиты Lovable. */
export function creditsOfTokens(promptTokens: number, completionTokens: number): number {
  return usdOfTokens(promptTokens, completionTokens) / USD_PER_CREDIT;
}

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
  prompt_tokens?: number;
  completion_tokens?: number;
}

export interface AiCreditsSnapshot {
  day: { calls: number; tokens: number; usd: number; errors: number };
  month: {
    calls: number;
    tokens: number;
    credits: number;
    pct: number;
    /** Линейный прогноз к концу UTC-месяца, % от лимита. */
    forecastPct: number;
    /** Прогноз расхода кредитов ВСЕГО проекта (AI + облако) к концу месяца. */
    forecastProjectCredits: number;
    errors: number;
    /** Календарный день UTC (1..31) — знаменатель прогноза. */
    dayOfMonth: number;
    daysInMonth: number;
    /** Номер UTC-месяца (1..12) — для подписи «прогноз к 31.08». */
    monthNumber: number;
  };
  /** Топ источников за месяц: доля в % от месячных ДЕНЕГ + сами деньги. */
  top: Array<{ label: string; pct: number; usd: number }>;
  /** true — расход перевалил CREDIT_ALERT_THRESHOLD_PCT. */
  overThreshold: boolean;
  /**
   * false — RPC не отдал раздельные prompt/completion, считали легаси-плоским
   * коэффициентом (занижает). Дайджест обязан пометить такую цифру.
   */
  exactCostModel: boolean;
}

/** Минимальная структурная форма service_role-клиента (без импорта SDK-типов). */
interface RpcClient {
  // deno-lint-ignore no-explicit-any
  rpc(fn: string, args: Record<string, unknown>): any;
}

/**
 * Границы окон: начало календарного месяца **по UTC** и «за сутки» (now − 24ч).
 *
 * ⚠️ Месяц именно UTC, а не МСК (общая конвенция дайджеста, rule 101): лимит
 * Lovable сбрасывается «1 September (UTC)» — так написано в самом диалоге
 * лимита. Считать по МСК значило бы сверять с дашбордом два разных окна и
 * ловить расхождение в первые 3 часа каждого месяца.
 */
export function aiUsageWindows(now: Date): {
  monthStartIso: string;
  dayStartIso: string;
  dayOfMonth: number;
  daysInMonth: number;
  monthNumber: number;
} {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  return {
    monthStartIso: new Date(Date.UTC(year, month - 1, 1)).toISOString(),
    dayStartIso: new Date(now.getTime() - 24 * 3600 * 1000).toISOString(),
    dayOfMonth: now.getUTCDate(),
    // day 0 следующего месяца = последний день текущего
    daysInMonth: new Date(Date.UTC(year, month, 0)).getUTCDate(),
    monthNumber: month,
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
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

    interface Bucket {
      tokens?: number;
      calls?: number;
      prompt_tokens?: number;
      completion_tokens?: number;
      by_source?: UsageSourceRow[];
    }
    const payload = data as {
      month?: Bucket;
      day?: Bucket;
      errors_day?: number;
      errors_month?: number;
    };

    const monthTokens = Number(payload.month?.tokens ?? 0);
    const monthCalls = Number(payload.month?.calls ?? 0);
    const monthPrompt = Number(payload.month?.prompt_tokens ?? 0);
    const monthCompletion = Number(payload.month?.completion_tokens ?? 0);

    // Deploy-skew: edge может уехать раньше миграции, добавившей разбивку.
    // Признак — суммарно нулевая разбивка при ненулевых токенах.
    const exactCostModel = monthPrompt + monthCompletion > 0 || monthTokens === 0;
    const creditsOf = (
      prompt: number,
      completion: number,
      totalTokens: number,
    ): number =>
      exactCostModel
        ? creditsOfTokens(prompt, completion)
        : totalTokens / LEGACY_TOKENS_PER_CREDIT;

    const credits = creditsOf(monthPrompt, monthCompletion, monthTokens);
    const pct = MONTHLY_CREDIT_LIMIT > 0 ? (credits / MONTHLY_CREDIT_LIMIT) * 100 : 0;
    const forecastPct = dayOfMonth > 0 ? (pct * daysInMonth) / dayOfMonth : pct;
    const forecastAiCredits = dayOfMonth > 0
      ? (credits * daysInMonth) / dayOfMonth
      : credits;
    const forecastProjectCredits = forecastAiCredits +
      CLOUD_DAILY_CREDITS * daysInMonth;

    const dayTokens = Number(payload.day?.tokens ?? 0);
    const dayUsd = exactCostModel
      ? usdOfTokens(
        Number(payload.day?.prompt_tokens ?? 0),
        Number(payload.day?.completion_tokens ?? 0),
      )
      : creditsToUsd(dayTokens / LEGACY_TOKENS_PER_CREDIT);

    // Топ — по ДЕНЬГАМ, не по токенам. Это разные рейтинги: у загрузчика задач
    // 66% токенов, но 78% денег (он один даёт 92% всего выхода, а выход в 6 раз
    // дороже). Решения принимаются по деньгам, значит и показывать надо их.
    const bySource = Array.isArray(payload.month?.by_source) ? payload.month!.by_source! : [];
    const top: Array<{ label: string; pct: number; usd: number }> = [];
    const usdOfRow = (row: UsageSourceRow): number =>
      exactCostModel
        ? usdOfTokens(Number(row.prompt_tokens ?? 0), Number(row.completion_tokens ?? 0))
        : creditsToUsd(Number(row.tokens ?? 0) / LEGACY_TOKENS_PER_CREDIT);
    const monthUsdTotal = creditsToUsd(credits);
    if (monthUsdTotal > 0) {
      const sorted = [...bySource]
        .map((row) => ({ row, usd: usdOfRow(row) }))
        .sort((a, b) => b.usd - a.usd);
      for (const { row, usd } of sorted.slice(0, 3)) {
        top.push({
          label: aiSourceLabel(row.source),
          pct: (usd / monthUsdTotal) * 100,
          usd,
        });
      }
      const restUsd = sorted.slice(3).reduce((acc, item) => acc + item.usd, 0);
      const restPct = (restUsd / monthUsdTotal) * 100;
      if (restPct >= 1) {
        top.push({ label: "прочее", pct: restPct, usd: restUsd });
      }
    }

    return {
      day: {
        calls: Number(payload.day?.calls ?? 0),
        tokens: dayTokens,
        usd: dayUsd,
        errors: Number(payload.errors_day ?? 0),
      },
      month: {
        calls: monthCalls,
        tokens: monthTokens,
        credits,
        pct,
        forecastPct,
        forecastProjectCredits,
        errors: Number(payload.errors_month ?? 0),
        dayOfMonth,
        daysInMonth,
        monthNumber,
      },
      top,
      overThreshold: pct >= CREDIT_ALERT_THRESHOLD_PCT,
      exactCostModel,
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

/**
 * Деньги. Разрядность плавающая: суммы ниже $1 без второго знака выглядят как
 * «$0» и не отвечают на вопрос «сколько мы тратим», поэтому < $1 → 2 знака
 * (а < $0.1 → 3), выше — 1–2 знака.
 */
function fmtUsd(usd: number): string {
  const abs = Math.abs(usd);
  const digits = abs < 0.1 ? 3 : abs < 10 ? 2 : 1;
  return `$${usd.toFixed(digits).replace(".", ",")}`;
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
 * Блок для ежедневного дайджеста:
 *   🤖 AI за сутки: 218 вызовов · 917к токенов · ≈$0,78 · ошибок шлюза 4
 *   📊 AI за месяц: ≈11,8 из 75 кредитов (16%) ≈ $2,95 из $18,8 · прогноз к 31.08 — 81%
 *   Топ по деньгам: загрузчик задач 78% (≈$2,3) · проверка ДЗ 14% (≈$0,4)
 *   Средний вызов ≈$0,004
 *   💳 План: прогноз AI + облако ≈129 из 200 кредитов/мес
 */
export function formatAiCreditsBlock(s: AiCreditsSnapshot): string[] {
  const { day, month, top } = s;
  const monthUsd = creditsToUsd(month.credits);
  const limitUsd = creditsToUsd(MONTHLY_CREDIT_LIMIT);
  const lines: string[] = [
    `🤖 AI за сутки: ${day.calls} ${pluralCalls(day.calls)} · ${fmtTokens(day.tokens)} токенов · ≈${fmtUsd(day.usd)} · ошибок шлюза ${day.errors}`,
    `📊 AI за месяц: ≈${fmtCredits(month.credits)} из ${MONTHLY_CREDIT_LIMIT} кредитов (${Math.round(month.pct)}%) ≈ ${fmtUsd(monthUsd)} из ${fmtUsd(limitUsd)} · прогноз к ${pad2(month.daysInMonth)}.${pad2(month.monthNumber)} — ${Math.round(month.forecastPct)}%`,
  ];
  if (top.length > 0) {
    lines.push(
      `Топ по деньгам: ${top.map((t) => `${t.label} ${Math.round(t.pct)}% (≈${fmtUsd(t.usd)})`).join(" · ")}`,
    );
  }
  // Цена одного AI-вызова — юнит-экономика: с ней видно, сколько стоит один
  // разбор/проверка, и можно сравнивать с ценой тарифа репетитора.
  if (month.calls > 0) {
    lines.push(`Средний вызов ≈${fmtUsd(monthUsd / month.calls)}`);
  }
  // Главная строка для решения «доливать ли деньги»: AI — лишь треть счёта,
  // остальное берёт облако (база держит ровную полку ~1,9 кредита в сутки).
  // Без неё владелец оптимизирует AI, пока план выедает база.
  const cloudMonth = CLOUD_DAILY_CREDITS * month.daysInMonth;
  const projectPct = MONTHLY_PLAN_CREDITS > 0
    ? Math.round((month.forecastProjectCredits / MONTHLY_PLAN_CREDITS) * 100)
    : 0;
  lines.push(
    `💳 План: прогноз AI ${fmtCredits(month.forecastProjectCredits - cloudMonth)} + облако ≈${fmtCredits(cloudMonth)} = <b>≈${Math.round(month.forecastProjectCredits)} из ${MONTHLY_PLAN_CREDITS}</b> кредитов/мес (${projectPct}%) — без учёта правок через агента Lovable`,
  );
  if (s.overThreshold) {
    lines.push(
      `⚠️ <b>Расход перевалил ${CREDIT_ALERT_THRESHOLD_PCT}% AI-лимита</b> — поднимай лимит в Lovable (Settings → Usage → AI features), иначе AI-проверка встанет у всех.`,
    );
  } else if (month.forecastPct >= 100) {
    lines.push(
      `⚠️ По текущему темпу AI-лимит (${MONTHLY_CREDIT_LIMIT}) кончится до конца месяца — проверь Lovable (Settings → Usage → AI features).`,
    );
  }
  if (month.forecastProjectCredits >= MONTHLY_PLAN_CREDITS) {
    lines.push(
      `⚠️ <b>Прогноз выше плана (${MONTHLY_PLAN_CREDITS} кр.)</b> — докупка идёт по $0,30 за кредит против $0,25 в плане; выгоднее поднять план.`,
    );
  }
  if (!s.exactCostModel) {
    lines.push(
      `ℹ️ Считано приблизительно (миграция с разбивкой prompt/completion ещё не применена) — цифра ЗАНИЖЕНА.`,
    );
  }
  return lines;
}
