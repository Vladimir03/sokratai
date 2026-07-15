/**
 * Пре-воронка «до регистрации» из Яндекс.Метрики (счётчик 105827612).
 *
 * Лендинг УЖЕ инструментирован (src/lib/tutorLandingAnalytics.ts): цели
 * tutor_landing_cta_* (клики CTA) + tutor_landing_trial_signup_started
 * (открыл форму). Визиты — pageview'ы Метрики. Этот модуль тянет агрегаты
 * через Reporting API — до регистрации имён не бывает, пре-воронка
 * принципиально АНОНИМНАЯ (в отличие от поимённой основной).
 *
 * Требует секрет `METRIKA_API_TOKEN` (OAuth-токен Яндекса с правом
 * metrika:read). Нет токена / API упал → { available: false } — Пульс и
 * дайджест живут без пре-воронки, ничего не падает.
 *
 * ГОТЧА per-goal: reachGoal с фронта ИГНОРИРУЕТСЯ Метрикой, пока цель с тем
 * же идентификатором не создана в интерфейсе (Цели → JavaScript-событие).
 * Поэтому цели резолвятся по именам через Management API, а незаведённые
 * возвращаются в missingGoals — честный сигнал «создай цель», а не ноль.
 */

const METRIKA_COUNTER_ID = 105827612;
const METRIKA_API_TOKEN = (Deno.env.get("METRIKA_API_TOKEN") ?? "").trim();

/** Идентификаторы JS-событий CTA лендинга (mirror tutorLandingAnalytics.ts). */
const CTA_GOAL_NAMES = [
  "tutor_landing_cta_hero",
  "tutor_landing_cta_tour1",
  "tutor_landing_cta_pricing",
  "tutor_landing_cta_final",
  "tutor_landing_cta_trial_hero",
  "tutor_landing_cta_trial_pricing",
  "tutor_landing_cta_trial_final",
];
const SIGNUP_FORM_GOAL_NAME = "tutor_landing_trial_signup_started";

export interface PulsePreFunnel {
  available: boolean;
  /** Уникальные посетители страницы лендинга «/» за 7 дней. */
  landingVisitors7d: number;
  /** Σ достижений CTA-целей за 7 дней. */
  ctaClicks7d: number;
  /** Открытий формы регистрации (signup_started) за 7 дней. */
  signupFormOpens7d: number;
  /** Уникальные посетители /egor (QR Егора) за 7 дней. */
  qrVisits7d: number;
  deltas: {
    landingVisitors: number;
    ctaClicks: number;
    signupFormOpens: number;
    qrVisits: number;
  };
  /** Цели, не заведённые в интерфейсе Метрики (reachGoal по ним игнорируется). */
  missingGoals: string[];
}

interface MetrikaGoal {
  id: number;
  name: string;
  type: string;
  conditions?: Array<{ type: string; url: string }>;
}

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

/** МСК-день (YYYY-MM-DD) для date1/date2 — таймзона счётчика московская. */
function mskDay(d: Date): string {
  return new Date(d.getTime() + MSK_OFFSET_MS).toISOString().split("T")[0];
}

async function metrikaGet(url: string): Promise<Record<string, unknown> | null> {
  const maxAttempts = 2;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: { Authorization: `OAuth ${METRIKA_API_TOKEN}` },
      });
      if (resp.ok) return (await resp.json()) as Record<string, unknown>;
      console.error(`metrika_api_failed status=${resp.status}`);
      if (attempt < maxAttempts - 1 && (resp.status === 429 || resp.status >= 500)) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      return null;
    } catch (err) {
      console.error("metrika_api_network", err instanceof Error ? err.message : String(err));
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      return null;
    }
  }
  return null;
}

/**
 * JS-event цель матчится по ИДЕНТИФИКАТОРУ условия (conditions[].url) —
 * name в интерфейсе произвольный. Fallback — точное имя.
 */
function resolveGoalIds(goals: MetrikaGoal[], targets: string[]): { ids: number[]; missing: string[] } {
  const ids: number[] = [];
  const missing: string[] = [];
  for (const target of targets) {
    const goal = goals.find(
      (g) => g.conditions?.some((c) => c.url === target) || g.name === target,
    );
    if (goal) ids.push(goal.id);
    else missing.push(target);
  }
  return { ids, missing };
}

/** Σ метрик первой строки stat-ответа (totals) по списку метрик. */
function sumTotals(data: Record<string, unknown> | null): number[] {
  const totals = (data as { totals?: number[] } | null)?.totals;
  return Array.isArray(totals) ? totals.map((v) => Math.round(Number(v) || 0)) : [];
}

async function fetchGoalReaches(goalIds: number[], date1: string, date2: string): Promise<number> {
  if (goalIds.length === 0) return 0;
  // До 20 метрик на запрос — целей у нас 8, влезаем в один.
  const metrics = goalIds.map((id) => `ym:s:goal${id}reaches`).join(",");
  const url =
    `https://api-metrika.yandex.net/stat/v1/data?ids=${METRIKA_COUNTER_ID}` +
    `&metrics=${encodeURIComponent(metrics)}&date1=${date1}&date2=${date2}&limit=1`;
  const totals = sumTotals(await metrikaGet(url));
  return totals.reduce((s, v) => s + v, 0);
}

async function fetchPageUsers(path: string, date1: string, date2: string): Promise<number> {
  const filter = `ym:pv:URLPath=='${path}'`;
  const url =
    `https://api-metrika.yandex.net/stat/v1/data?ids=${METRIKA_COUNTER_ID}` +
    `&metrics=${encodeURIComponent("ym:pv:users")}&filters=${encodeURIComponent(filter)}` +
    `&date1=${date1}&date2=${date2}&limit=1`;
  const totals = sumTotals(await metrikaGet(url));
  return totals[0] ?? 0;
}

/**
 * Пре-воронка за последние 7 МСК-дней + дельты к предыдущим 7.
 * Никогда не бросает: сбой → { available: false } (Пульс живёт без блока).
 */
export async function computePreFunnel(now: Date = new Date()): Promise<PulsePreFunnel> {
  const empty: PulsePreFunnel = {
    available: false,
    landingVisitors7d: 0,
    ctaClicks7d: 0,
    signupFormOpens7d: 0,
    qrVisits7d: 0,
    deltas: { landingVisitors: 0, ctaClicks: 0, signupFormOpens: 0, qrVisits: 0 },
    missingGoals: [],
  };
  if (!METRIKA_API_TOKEN) return empty;

  try {
    // Цели счётчика (Management API) → id по идентификаторам JS-событий.
    const goalsResp = await metrikaGet(
      `https://api-metrika.yandex.net/management/v1/counter/${METRIKA_COUNTER_ID}/goals`,
    );
    if (!goalsResp) return empty;
    const goals = ((goalsResp as { goals?: MetrikaGoal[] }).goals ?? []) as MetrikaGoal[];

    const cta = resolveGoalIds(goals, CTA_GOAL_NAMES);
    const signup = resolveGoalIds(goals, [SIGNUP_FORM_GOAL_NAME]);
    const missingGoals = [...cta.missing, ...signup.missing];

    // Окна: [now−7д, now] и [now−14д, now−7д) МСК-днями.
    const d0 = mskDay(now);
    const d7 = mskDay(new Date(now.getTime() - 7 * 864e5));
    const d8 = mskDay(new Date(now.getTime() - 8 * 864e5));
    const d14 = mskDay(new Date(now.getTime() - 14 * 864e5));

    const [
      landingCur, landingPrev,
      qrCur, qrPrev,
      ctaCur, ctaPrev,
      signupCur, signupPrev,
    ] = await Promise.all([
      fetchPageUsers("/", d7, d0),
      fetchPageUsers("/", d14, d8),
      fetchPageUsers("/egor", d7, d0),
      fetchPageUsers("/egor", d14, d8),
      fetchGoalReaches(cta.ids, d7, d0),
      fetchGoalReaches(cta.ids, d14, d8),
      fetchGoalReaches(signup.ids, d7, d0),
      fetchGoalReaches(signup.ids, d14, d8),
    ]);

    return {
      available: true,
      landingVisitors7d: landingCur,
      ctaClicks7d: ctaCur,
      signupFormOpens7d: signupCur,
      qrVisits7d: qrCur,
      deltas: {
        landingVisitors: landingCur - landingPrev,
        ctaClicks: ctaCur - ctaPrev,
        signupFormOpens: signupCur - signupPrev,
        qrVisits: qrCur - qrPrev,
      },
      missingGoals,
    };
  } catch (err) {
    console.error("metrika_prefunnel_failed", err instanceof Error ? err.message : String(err));
    return empty;
  }
}
