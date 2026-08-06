import { describe, expect, it } from "vitest";

import {
  aiUsageWindows,
  computeAiCreditsSnapshot,
  creditsOfTokens,
  LEGACY_TOKENS_PER_CREDIT,
  MONTHLY_CREDIT_LIMIT,
  usdOfTokens,
} from "./ai-credits.ts";

/**
 * Регрессия на модель «токены → кредиты Lovable».
 *
 * Опорные точки — НЕ выдуманные: это четыре независимых окна дашборда Lovable
 * (Cloud → Usage) за 06.08.2026, сведённые с суммами `token_usage_logs` за те же
 * окна по UTC. Если кто-то вернёт плоский коэффициент «293к = 1 кредит» или
 * подставит batch-прайс ($0.25/$1.50), эти тесты покраснеют — а без них ошибка
 * снова будет видна только через месяц по расхождению с дашбордом.
 */
const DASHBOARD_POINTS = [
  { name: "5 авг (UTC)", prompt: 646_118, completion: 135_866, lovableCredits: 2.92 },
  { name: "6 авг (UTC, неполный)", prompt: 359_187, completion: 117_884, lovableCredits: 2.13 },
  { name: "август к дате", prompt: 2_417_988, completion: 573_746, lovableCredits: 11.8 },
  { name: "последние 30 дней", prompt: 7_652_425, completion: 1_350_878, lovableCredits: 31.7 },
];

describe("creditsOfTokens — сверка с дашбордом Lovable", () => {
  for (const point of DASHBOARD_POINTS) {
    it(`совпадает с фактом Lovable: ${point.name}`, () => {
      const ours = creditsOfTokens(point.prompt, point.completion);
      const drift = Math.abs(ours - point.lovableCredits) / point.lovableCredits;
      expect(drift).toBeLessThan(0.02);
    });
  }

  it("выход дороже входа ровно в 6 раз (иначе подставлен batch-прайс)", () => {
    expect(usdOfTokens(0, 1e6) / usdOfTokens(1e6, 0)).toBeCloseTo(6, 6);
  });

  it("плоский легаси-коэффициент занижает на output-тяжёлом месяце", () => {
    const { prompt, completion } = DASHBOARD_POINTS[2];
    const legacy = (prompt + completion) / LEGACY_TOKENS_PER_CREDIT;
    // Август: 10,2 против 11,7 — занижение ~13% только за счёт коэффициента
    // (в проде к нему добавлялось ещё и МСК-окно вместо UTC).
    expect(legacy).toBeLessThan(creditsOfTokens(prompt, completion) * 0.9);
  });
});

describe("aiUsageWindows", () => {
  it("месяц режется по UTC (лимит Lovable сбрасывается 1-го по UTC)", () => {
    // 1 августа 01:00 МСК = 31 июля 22:00 UTC → это ещё ИЮЛЬ для Lovable.
    const w = aiUsageWindows(new Date("2026-07-31T22:00:00Z"));
    expect(w.monthStartIso).toBe("2026-07-01T00:00:00.000Z");
    expect(w.monthNumber).toBe(7);
    expect(w.daysInMonth).toBe(31);
    expect(w.dayOfMonth).toBe(31);
  });

  it("окно суток — скользящие 24 часа", () => {
    const now = new Date("2026-08-06T09:00:00Z");
    expect(aiUsageWindows(now).dayStartIso).toBe("2026-08-05T09:00:00.000Z");
  });
});

function fakeDb(payload: unknown, error: unknown = null) {
  return { rpc: () => Promise.resolve({ data: payload, error }) };
}

describe("computeAiCreditsSnapshot", () => {
  const monthBucket = {
    tokens: 2_991_734,
    prompt_tokens: 2_417_988,
    completion_tokens: 573_746,
    calls: 716,
    by_source: [
      // Загрузчик: меньше токенов, чем сумма остальных по входу, но почти весь
      // выход — значит в топе по ДЕНЬГАМ он обязан стоять первым.
      { source: "kb_extract", tokens: 1_801_536, prompt_tokens: 1_348_415, completion_tokens: 453_121, calls: 290 },
      { source: "homework_check", tokens: 589_223, prompt_tokens: 564_559, completion_tokens: 24_664, calls: 281 },
      { source: "chat_discussion", tokens: 197_507, prompt_tokens: 189_404, completion_tokens: 8_103, calls: 34 },
      // Остаток месяца (подсказки, пробники, чат с репетитором) — чтобы
      // by_source покрывал месячные тоталы и доли складывались в 100%.
      { source: "homework_hint", tokens: 403_468, prompt_tokens: 315_610, completion_tokens: 87_858, calls: 111 },
    ],
  };
  const dayBucket = { tokens: 917_383, prompt_tokens: 751_651, completion_tokens: 153_193, calls: 218 };

  it("считает месяц по себестоимости и сходится с дашбордом", async () => {
    const snap = await computeAiCreditsSnapshot(
      fakeDb({ month: monthBucket, day: dayBucket, errors_day: 4, errors_month: 13 }),
      new Date("2026-08-06T12:00:00Z"),
    );
    expect(snap).not.toBeNull();
    expect(snap!.exactCostModel).toBe(true);
    expect(snap!.month.credits).toBeGreaterThan(11.5);
    expect(snap!.month.credits).toBeLessThan(12.0);
    expect(snap!.month.pct).toBeCloseTo((snap!.month.credits / MONTHLY_CREDIT_LIMIT) * 100, 6);
    expect(snap!.day.errors).toBe(4);
  });

  it("топ ранжирует по деньгам, а не по токенам", async () => {
    const snap = await computeAiCreditsSnapshot(
      fakeDb({ month: monthBucket, day: dayBucket }),
      new Date("2026-08-06T12:00:00Z"),
    );
    expect(snap!.top[0].label).toBe("загрузчик задач");
    // Суть правки: доля в ДЕНЬГАХ у загрузчика заметно выше доли в ТОКЕНАХ —
    // он один даёт почти весь выход, а выход в 6 раз дороже входа.
    const tokenShare = (1_801_536 / monthBucket.tokens) * 100;
    expect(snap!.top[0].pct).toBeGreaterThan(tokenShare + 8);
    const sum = snap!.top.reduce((acc, t) => acc + t.pct, 0);
    expect(sum).toBeGreaterThan(99);
    expect(sum).toBeLessThan(101);
  });

  it("прогноз проекта включает облако, а не только AI", async () => {
    const snap = await computeAiCreditsSnapshot(
      fakeDb({ month: monthBucket, day: dayBucket }),
      new Date("2026-08-06T12:00:00Z"),
    );
    const aiForecast = (snap!.month.credits * 31) / 6;
    expect(snap!.month.forecastProjectCredits).toBeGreaterThan(aiForecast + 60);
  });

  it("deploy-skew: без разбивки падает на легаси-коэффициент и помечает это", async () => {
    const snap = await computeAiCreditsSnapshot(
      fakeDb({
        month: { tokens: 2_991_734, calls: 716, by_source: [{ source: "kb_extract", tokens: 1_801_536, calls: 290 }] },
        day: { tokens: 917_383, calls: 218 },
      }),
      new Date("2026-08-06T12:00:00Z"),
    );
    expect(snap!.exactCostModel).toBe(false);
    expect(snap!.month.credits).toBeCloseTo(2_991_734 / LEGACY_TOKENS_PER_CREDIT, 6);
  });

  it("ошибка RPC → null, дайджест уходит без AI-блока", async () => {
    const snap = await computeAiCreditsSnapshot(
      fakeDb(null, { code: "42883" }),
      new Date("2026-08-06T12:00:00Z"),
    );
    expect(snap).toBeNull();
  });
});
