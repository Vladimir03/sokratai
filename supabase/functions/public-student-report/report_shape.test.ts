import { describe, expect, it } from "vitest";
import {
  buildPublicReportBody,
  type LedgerEntryRow,
  parseRoute,
  type PublicReportInput,
  REPORT_SLUG_RE,
  resolveReportPeriod,
  type StudentProgressPayload,
} from "./report_shape";

/**
 * Тесты на ПУБЛИЧНЫЙ РЕМАП «Отчёта родителю» (/p/report/:slug).
 *
 * Эндпоинт отдаётся БЕЗ авторизации (verify_jwt=false), а на входе у ремапа —
 * полный payload buildStudentProgress с внутренними uuid, аватаром и служебными
 * счётчиками. Ремап — единственный анти-утечечный слой между ними и интернетом.
 * Регресс здесь не падает и не логируется: лишнее поле просто молча уезжает
 * каждому, у кого есть ссылка. Ровно тот класс ошибок, ради которого тесты.
 *
 * Ценность — в ЗАКРЕПЛЕНИИ решений, которые из кода не видны: точный whitelist
 * полей работы, кап 10, «note приватен», семантика `!== false` у флагов ссылки
 * и границы правил attention.
 */

const TS_ROW_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"; // tutor_students.id
const STUDENT_AUTH_UUID = "11111111-2222-4333-8444-555555555555"; // auth.users.id ученика
const HW_ASSIGNMENT_UUID = "99999999-8888-4777-8666-555544443333";
const MOCK_ATTEMPT_UUID = "12121212-3434-4565-8787-909090909090";
const MOCK_ASSIGNMENT_UUID = "fefefefe-dcdc-4aba-9898-767676767676";
const LEDGER_ROW_UUID = "0f0f0f0f-1e1e-4d2d-8c3c-4b4b4b4b4b4b";

/** Публичный контракт работы — ровно эти поля и ни одним больше.
 * 2026-08-05 (решение владельца): + work_mode и independence_pct — фронт
 * PublicStudentReport их рендерил с 27.07, но whitelist срезал (разрыв фичи). */
const PUBLIC_WORK_KEYS = [
  "kind",
  "title",
  "subject",
  "date",
  "score_kind",
  "raw",
  "raw_max",
  "cells",
  "reviewed",
  "status",
  "work_mode",
  "independence_pct",
].sort();

function makeHwWork(n: number): Record<string, unknown> {
  return {
    // Внутренние поля полного payload'а — ремап ОБЯЗАН их срезать.
    id: HW_ASSIGNMENT_UUID,
    work_mode: "homework",
    independence_pct: 80,
    independence_is_estimate: false,
    created_at: "2026-07-01T10:00:00Z",
    deadline: "2026-07-10",
    overdue: false,
    pending_review_count: 1,
    // Публичные поля.
    kind: "homework",
    title: `ДЗ №${n}`,
    subject: "physics",
    date: "2026-07-10",
    score_kind: "primary",
    raw: 5,
    raw_max: 10,
    cells: [{ score: 5, max: 10 }],
    reviewed: true,
    status: "verified",
  };
}

function makeMockWork(): Record<string, unknown> {
  return {
    id: MOCK_ATTEMPT_UUID,
    assignment_id: MOCK_ASSIGNMENT_UUID,
    kind: "mock",
    title: "Пробник ЕГЭ",
    subject: "physics",
    date: "2026-07-05T09:00:00Z",
    created_at: "2026-07-01T10:00:00Z",
    deadline: null,
    overdue: false,
    score_kind: "ege_scaled",
    raw: 30,
    raw_max: 45,
    cells: [{ score: 20, max: 26 }, { score: 10, max: 19 }],
    reviewed: true,
    status: "verified",
  };
}

function makeSummary(
  overrides: Partial<StudentProgressPayload["summary"]> = {},
): StudentProgressPayload["summary"] {
  return {
    done: 2,
    total: 2,
    reviewed_pct: 100,
    needs_attention: false,
    current_level: 62,
    target: 80,
    trend: [58, 62],
    hw_done: 2,
    hw_total: 2,
    hw_overdue: 0,
    hw_success_pct: 85,
    ...overrides,
  };
}

function makeProgress(overrides: Partial<StudentProgressPayload> = {}): StudentProgressPayload {
  return {
    student: {
      id: TS_ROW_UUID,
      student_id: STUDENT_AUTH_UUID,
      name: "Глеб",
      avatar_url: "https://cdn.example/avatars/gleb.png",
      track: "ege",
      grade_class: "11 класс",
    },
    target: { track: "ege", target_score: 80, scale_year: 2026 },
    works: [makeHwWork(1), makeMockWork()],
    summary: makeSummary(),
    ...overrides,
  };
}

function makeInput(overrides: Partial<PublicReportInput> = {}): PublicReportInput {
  return {
    progress: makeProgress(),
    link: {},
    studentSubject: "physics",
    studentBalance: 1500,
    tutorName: "Егор",
    ledgerEntries: [],
    ...overrides,
  };
}

/** Ledger-строка «как из БД», с приватной заметкой и служебными полями. */
const LEDGER_WITH_PRIVATE_FIELDS: LedgerEntryRow[] = [
  {
    kind: "debit",
    amount: "1500",
    occurred_on: "2026-07-03",
    source_kind: "lesson",
    created_at: "2026-07-03T18:00:00Z",
    note: "Пропустил без предупреждения — обсудить с мамой",
    id: LEDGER_ROW_UUID,
    tutor_student_id: TS_ROW_UUID,
  },
  {
    kind: "credit",
    amount: null,
    occurred_on: "2026-07-01",
    source_kind: "manual_payment",
    created_at: "2026-07-01T12:00:00Z",
  },
];

describe("parseRoute — маршрут /report/:slug", () => {
  it("полный путь Supabase Functions даёт slug; query-string не мешает", () => {
    expect(
      parseRoute(new Request("https://api.sokratai.ru/functions/v1/public-student-report/report/abc12345")),
    ).toEqual({ slug: "abc12345" });
    expect(
      parseRoute(new Request("https://api.sokratai.ru/functions/v1/public-student-report/report/abc12345?utm_source=tg")),
    ).toEqual({ slug: "abc12345" });
  });

  it("работает и без имени функции в пути (functionIdx=-1 → путь целиком)", () => {
    expect(parseRoute(new Request("https://localhost/report/abc12345"))).toEqual({ slug: "abc12345" });
  });

  it("лишний сегмент после slug — не маршрут", () => {
    expect(
      parseRoute(new Request("https://api.sokratai.ru/functions/v1/public-student-report/report/abc12345/extra")),
    ).toEqual({ slug: null });
  });

  it("без сегмента report — не маршрут", () => {
    expect(
      parseRoute(new Request("https://api.sokratai.ru/functions/v1/public-student-report/abc12345")),
    ).toEqual({ slug: null });
    expect(
      parseRoute(new Request("https://api.sokratai.ru/functions/v1/public-student-report")),
    ).toEqual({ slug: null });
  });

  it("траверса ../ нормализуется URL и не доезжает до slug", () => {
    // `report/../evil` схлопывается парсером URL ДО split'а → сегмент report
    // исчезает и маршрут не матчится. Никакой slug из траверсы не выйдет.
    expect(
      parseRoute(new Request("https://api.sokratai.ru/functions/v1/public-student-report/report/../evil")),
    ).toEqual({ slug: null });
  });
});

describe("REPORT_SLUG_RE — валидация slug", () => {
  it("пропускает legacy 8-символьные и новые 24-символьные slug'и", () => {
    expect(REPORT_SLUG_RE.test("a1b2c3d4")).toBe(true);
    expect(REPORT_SLUG_RE.test("a1b2c3d4e5f6a7b8c9d0e1f2")).toBe(true);
  });

  it("регистронезависима (флаг i — index всё равно приводит к lower до проверки)", () => {
    expect(REPORT_SLUG_RE.test("AbCd1234")).toBe(true);
  });

  it("режет мусор: короткие, длинные, спецсимволы, траверсу", () => {
    expect(REPORT_SLUG_RE.test("abc1234")).toBe(false); // 7 < 8
    expect(REPORT_SLUG_RE.test("a".repeat(65))).toBe(false); // 65 > 64
    expect(REPORT_SLUG_RE.test("abcd-1234")).toBe(false);
    expect(REPORT_SLUG_RE.test("abcd_1234")).toBe(false);
    expect(REPORT_SLUG_RE.test("../../etc/passwd")).toBe(false);
    expect(REPORT_SLUG_RE.test("abcd1234/")).toBe(false);
    expect(REPORT_SLUG_RE.test("отчётик123")).toBe(false);
    expect(REPORT_SLUG_RE.test("")).toBe(false);
  });
});

describe("resolveReportPeriod — период-снимок ссылки", () => {
  it("обе даты NULL → period null (all-time, как до фичи периодов)", () => {
    expect(resolveReportPeriod({})).toEqual({ periodStart: null, periodEnd: null, period: null });
    expect(resolveReportPeriod({ period_start: null, period_end: null }).period).toBeNull();
  });

  it("одна граница → объект периода с null второй границей", () => {
    expect(resolveReportPeriod({ period_start: "2026-07-01" })).toEqual({
      periodStart: "2026-07-01",
      periodEnd: null,
      period: { start: "2026-07-01", end: null },
    });
    expect(resolveReportPeriod({ period_end: "2026-07-31" }).period).toEqual({
      start: null,
      end: "2026-07-31",
    });
  });
});

describe("buildPublicReportBody — карточки student/tutor", () => {
  it("student — только name/track/grade_class/subject; id, student_id и avatar_url срезаны", () => {
    const body = buildPublicReportBody(makeInput());
    expect(body.student).toEqual({
      name: "Глеб",
      track: "ege",
      grade_class: "11 класс",
      subject: "physics",
    });
    expect(Object.keys(body.student as object).sort()).toEqual(
      ["grade_class", "name", "subject", "track"],
    );
  });

  it("tutor — только name (rule 96 #10); отсутствующее имя → null", () => {
    expect(buildPublicReportBody(makeInput()).tutor).toEqual({ name: "Егор" });
    expect(buildPublicReportBody(makeInput({ tutorName: undefined })).tutor).toEqual({ name: null });
  });
});

describe("buildPublicReportBody — работы (works)", () => {
  it("кап: из 15 работ наружу уходят ПЕРВЫЕ 10 (список уже отсортирован по дате desc)", () => {
    const works = Array.from({ length: 15 }, (_, i) => makeHwWork(i + 1));
    const body = buildPublicReportBody(makeInput({ progress: makeProgress({ works }) }));
    const out = body.works as Record<string, unknown>[];
    expect(out).toHaveLength(10);
    expect(out.map((w) => w.title)).toEqual(
      Array.from({ length: 10 }, (_, i) => `ДЗ №${i + 1}`),
    );
  });

  it("у каждой работы РОВНО whitelist-набор полей — uuid'ы и служебные поля срезаны", () => {
    const body = buildPublicReportBody(makeInput());
    const out = body.works as Record<string, unknown>[];
    expect(out).toHaveLength(2);
    for (const w of out) {
      expect(Object.keys(w).sort()).toEqual(PUBLIC_WORK_KEYS);
      // Явно: ни id (attempt/assignment), ни счётчиков ревью, ни флага оценки.
      expect(w).not.toHaveProperty("id");
      expect(w).not.toHaveProperty("assignment_id");
      expect(w).not.toHaveProperty("pending_review_count");
      expect(w).not.toHaveProperty("independence_is_estimate");
      expect(w).not.toHaveProperty("created_at");
      expect(w).not.toHaveProperty("deadline");
      expect(w).not.toHaveProperty("overdue");
    }
  });

  it("точная самостоятельность проходит; legacy-«≈» → null (родителю прочерк); mock → work_mode null", () => {
    const works = [
      makeHwWork(1), // exact 80
      { ...makeHwWork(2), independence_pct: 55, independence_is_estimate: true }, // legacy «≈»
      makeMockWork(), // без work_mode/independence
    ];
    const body = buildPublicReportBody(makeInput({ progress: makeProgress({ works }) }));
    const out = body.works as Record<string, unknown>[];
    expect(out[0].work_mode).toBe("homework");
    expect(out[0].independence_pct).toBe(80);
    // Решение владельца 2026-08-05: приближения — только репетитору.
    expect(out[1].independence_pct).toBeNull();
    expect(out[2].work_mode).toBeNull();
    expect(out[2].independence_pct).toBeNull();
  });
});

describe("buildPublicReportBody — агрегат independence", () => {
  it("среднее ТОЛЬКО точных значений обычных домашек; legacy-«≈», самостоятельные и пробники не в счёте", () => {
    const works = [
      makeHwWork(1), // exact 80
      { ...makeHwWork(2), independence_pct: 60, independence_is_estimate: false }, // exact 60
      { ...makeHwWork(3), independence_pct: 10, independence_is_estimate: true }, // legacy — мимо
      { ...makeHwWork(4), work_mode: "independent", independence_pct: null }, // СР — мимо
      makeMockWork(), // пробник — мимо
    ];
    const body = buildPublicReportBody(makeInput({ progress: makeProgress({ works }) }));
    expect(body.independence).toEqual({ pct: 70, works: 2 });
  });

  it("агрегат считается по ПОЛНОМУ списку периода, а не по capу 10 работ", () => {
    // 15 работ: 12 точных по 100% за пределами капа не должны потеряться.
    const works = Array.from({ length: 15 }, (_, i) => ({
      ...makeHwWork(i + 1),
      independence_pct: i < 3 ? 40 : 100,
    }));
    const body = buildPublicReportBody(makeInput({ progress: makeProgress({ works }) }));
    expect((body.independence as { works: number }).works).toBe(15);
    expect((body.independence as { pct: number }).pct).toBe(Math.round((3 * 40 + 12 * 100) / 15));
  });

  it("нет ни одного точного значения → pct null (карточка на фронте не рендерится)", () => {
    const works = [
      { ...makeHwWork(1), independence_pct: 50, independence_is_estimate: true },
      makeMockWork(),
    ];
    const body = buildPublicReportBody(makeInput({ progress: makeProgress({ works }) }));
    expect(body.independence).toEqual({ pct: null, works: 0 });
  });
});

describe("buildPublicReportBody — whitelist summary/target (ревью 5.6)", () => {
  it("новое внутреннее поле в summary/target НЕ становится публичным автоматически", () => {
    const progress = makeProgress();
    (progress.summary as Record<string, unknown>).internal_debug_field = "секрет";
    (progress.target as unknown as Record<string, unknown>).internal_note = "секрет";
    const body = buildPublicReportBody(makeInput({ progress }));
    expect(body.summary).not.toHaveProperty("internal_debug_field");
    expect(body.target).not.toHaveProperty("internal_note");
    // Текущий публичный состав зафиксирован явно.
    expect(Object.keys(body.summary as Record<string, unknown>).sort()).toEqual([
      "current_level", "done", "hw_done", "hw_overdue", "hw_success_pct",
      "hw_total", "needs_attention", "reviewed_pct", "target", "total", "trend",
    ]);
    expect(Object.keys(body.target as Record<string, unknown>).sort()).toEqual([
      "scale_year", "target_score", "track",
    ]);
  });
});

describe("buildPublicReportBody — выписка и долг", () => {
  it("note и любые лишние поля ledger-записи срезаются — остаются ровно 4 поля", () => {
    const body = buildPublicReportBody(makeInput({ ledgerEntries: LEDGER_WITH_PRIVATE_FIELDS }));
    const statement = body.statement as Record<string, unknown>[];
    expect(statement).toHaveLength(2);
    for (const e of statement) {
      expect(Object.keys(e).sort()).toEqual(["amount", "kind", "occurred_on", "source_kind"]);
    }
    expect(statement[0]).not.toHaveProperty("note");
    expect(statement[0]).not.toHaveProperty("created_at");
  });

  it("amount приводится к числу, null → 0; порядок записей сохраняется (сортирует SQL)", () => {
    const body = buildPublicReportBody(makeInput({ ledgerEntries: LEDGER_WITH_PRIVATE_FIELDS }));
    const statement = body.statement as { amount: number; occurred_on: unknown }[];
    expect(statement[0].amount).toBe(1500); // numeric из PostgREST приезжает строкой
    expect(statement[1].amount).toBe(0);
    expect(statement.map((e) => e.occurred_on)).toEqual(["2026-07-03", "2026-07-01"]);
  });

  it("show_debt_line=false → ни баланса, ни выписки (гейт тренера)", () => {
    const body = buildPublicReportBody(makeInput({
      link: { show_debt_line: false },
      ledgerEntries: null, // index.ts при выключенном гейте ledger вообще не грузит
    }));
    expect(body.show_debt_line).toBe(false);
    expect(body.balance).toBeNull();
    expect(body.statement).toEqual([]);
  });

  it("отсутствие/NULL флага (legacy-строка) → долговая строка ПОКАЗЫВАЕТСЯ; NULL-баланс → 0", () => {
    // Семантика `!== false`: только явный false прячет. И баланс при showDebt —
    // всегда число: NULL у свежего ученика означает «долга нет», а не «нет данных».
    const body = buildPublicReportBody(makeInput({
      link: { show_debt_line: null },
      studentBalance: null,
      ledgerEntries: LEDGER_WITH_PRIVATE_FIELDS,
    }));
    expect(body.show_debt_line).toBe(true);
    expect(body.balance).toBe(0);
    expect(body.statement).toHaveLength(2);
    expect(buildPublicReportBody(makeInput()).balance).toBe(1500);
  });
});

describe("buildPublicReportBody — конфиг отчёта", () => {
  it("metrics: отсутствие флага = показывать, явный false = скрыть", () => {
    expect(buildPublicReportBody(makeInput()).metrics).toEqual({
      mock_score: true,
      hw_done: true,
      hw_success: true,
    });
    expect(buildPublicReportBody(makeInput({
      link: { show_mock_score: false, show_hw_done: false, show_hw_success: false },
    })).metrics).toEqual({ mock_score: false, hw_done: false, hw_success: false });
  });

  it("verdict/tutor_comment/period — дефолты null/null/'all'; заданные значения проходят", () => {
    const empty = buildPublicReportBody(makeInput());
    expect(empty.verdict).toBeNull();
    expect(empty.tutor_comment).toBeNull();
    expect(empty.period).toEqual({ kind: "all", start: null, end: null });
    expect(Number.isNaN(Date.parse(empty.generated_at as string))).toBe(false);

    const filled = buildPublicReportBody(makeInput({
      link: {
        verdict: "on_track",
        tutor_comment: "Двигаемся по плану",
        period_kind: "month",
        period_start: "2026-07-01",
        period_end: "2026-07-31",
      },
    }));
    expect(filled.verdict).toBe("on_track");
    expect(filled.tutor_comment).toBe("Двигаемся по плану");
    expect(filled.period).toEqual({ kind: "month", start: "2026-07-01", end: "2026-07-31" });
  });
});

describe("buildPublicReportBody — attention (авто-факты)", () => {
  it("невыполненные ДЗ — одна строка, просрочка НЕ считается второй раз", () => {
    const body = buildPublicReportBody(makeInput({
      progress: makeProgress({ summary: makeSummary({ hw_total: 5, hw_done: 3, hw_overdue: 0 }) }),
    }));
    expect(body.attention).toEqual(["Не выполнено 2 из 5 ДЗ — напомните"]);
  });

  it("просрочка добавляется скобкой в ТУ ЖЕ строку (overdue ⊆ notDone)", () => {
    const body = buildPublicReportBody(makeInput({
      progress: makeProgress({ summary: makeSummary({ hw_total: 5, hw_done: 3, hw_overdue: 1 }) }),
    }));
    expect(body.attention).toEqual(["Не выполнено 2 из 5 ДЗ (из них просрочено 1) — напомните"]);
  });

  it("низкий процент верных — только когда есть сданные работы", () => {
    const low = buildPublicReportBody(makeInput({
      progress: makeProgress({ summary: makeSummary({ hw_success_pct: 45 }) }),
    }));
    expect(low.attention).toEqual(["Невысокий процент верных ответов: 45%"]);
    // hwDone=0 → процент считать не по чему; строка про % не показывается.
    const noneDone = buildPublicReportBody(makeInput({
      progress: makeProgress({ summary: makeSummary({ hw_success_pct: 45, hw_done: 0, hw_total: 0 }) }),
    }));
    expect(noneDone.attention).toEqual([]);
  });

  it("границы: 60% — уже не «невысокий»; null — молчим; мусор hw_done>hw_total не даёт отрицательных", () => {
    expect(buildPublicReportBody(makeInput({
      progress: makeProgress({ summary: makeSummary({ hw_success_pct: 60 }) }),
    })).attention).toEqual([]);
    expect(buildPublicReportBody(makeInput({
      progress: makeProgress({ summary: makeSummary({ hw_success_pct: null }) }),
    })).attention).toEqual([]);
    // notDone клампится в 0 → строка «не выполнено −1 из 2» невозможна.
    expect(buildPublicReportBody(makeInput({
      progress: makeProgress({ summary: makeSummary({ hw_total: 2, hw_done: 3 }) }),
    })).attention).toEqual([]);
  });
});

describe("канарейка анти-утечки", () => {
  it("в сериализованном ответе нет ни одного внутреннего uuid и приватных подстрок", () => {
    const body = buildPublicReportBody(makeInput({ ledgerEntries: LEDGER_WITH_PRIVATE_FIELDS }));
    const json = JSON.stringify(body);
    for (const uuid of [
      TS_ROW_UUID,
      STUDENT_AUTH_UUID,
      HW_ASSIGNMENT_UUID,
      MOCK_ATTEMPT_UUID,
      MOCK_ASSIGNMENT_UUID,
      LEDGER_ROW_UUID,
    ]) {
      expect(json).not.toContain(uuid);
    }
    for (const marker of [
      "user_id",
      "student_id", // покрывает и tutor_student_id
      "avatar",
      "cdn.example", // сам URL аватара, не только имя поля
      "pending_review",
      // work_mode и independence_pct с 2026-08-05 ПУБЛИЧНЫ (решение владельца);
      // приватным остаётся флаг legacy-оценки — сервер решает «≈»-вопрос сам.
      "independence_is_estimate",
      "note",
      "Пропустил", // текст приватной заметки тутора
      "created_at",
      "deadline",
    ]) {
      expect(json).not.toContain(marker);
    }
  });
});
