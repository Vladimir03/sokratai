import { describe, expect, it } from "vitest";
import {
  aggregateHwWork,
  BEHIND_GOAL_PCT,
  buildStudentProgress,
  gradeClass,
  HW_CONFIRMED_MOCK,
  MOCK_PENDING_REVIEW,
  resolveTutorPkId,
} from "./student-progress-build";
import { makeFakeDb, type FakeDbFixtures } from "./test-helpers/fake-db";

/**
 * Тесты на СБОРЩИК ПРОГРЕССА УЧЕНИКА — на нём стоят тутор-«Обзор» (R2)
 * и «Отчёт родителю». Ошибка здесь не падает — она молча показывает родителю
 * неверный процент, ложную просрочку или (хуже) неподтверждённый балл пробника.
 *
 * db инжектится параметром и в модуле есть только `import type` supabase-js,
 * поэтому интеграционные тесты идут на chainable-фейке (test-helpers/fake-db)
 * без рефакторинга исходника.
 *
 * Ожидания выведены ИЗ КОДА (не из желаемого поведения). Странности
 * зафиксированы как есть — менять их должен осознанный коммит, и тогда
 * тест упадёт ровно в нужном месте.
 */

// ── Общие ID: честно отражаем FK-дрейф (rule 60) ────────────────────────────
// tutor_students.tutor_id → tutors.id (PK), а homework/mock assignments.tutor_id
// → auth.users.id. Перепутать их в фикстурах = тест пройдёт мимо бага.
const TUTOR_USER = "tutor-user-1"; // auth.users.id
const TUTOR_PK = "tutor-pk-1"; // tutors.id
const TS_ID = "ts-1"; // tutor_students.id
const STUDENT = "student-1"; // profiles.id / auth.users.id ученика

const PAST = "2020-01-01T00:00:00Z";
const FUTURE = "2100-01-01T00:00:00Z";

function baseFixtures(overrides: FakeDbFixtures = {}): FakeDbFixtures {
  return {
    tutor_students: [{
      id: TS_ID,
      tutor_id: TUTOR_PK,
      student_id: STUDENT,
      display_name: "Глеб",
      exam_type: "ege",
      target_score: 80,
    }],
    profiles: [{ id: STUDENT, full_name: "Глеб Иванов", username: null, avatar_url: null, grade: 11 }],
    ...overrides,
  };
}

function build(
  fixtures: FakeDbFixtures,
  period?: { start: string | null; end: string | null } | null,
) {
  return buildStudentProgress(makeFakeDb(fixtures) as never, TUTOR_USER, TUTOR_PK, TS_ID, period);
}

describe("константы-канарейки — менять только осознанным коммитом", () => {
  it("HW_CONFIRMED_MOCK — ровно {approved, manually_entered}", () => {
    expect([...HW_CONFIRMED_MOCK].sort()).toEqual(["approved", "manually_entered"]);
  });

  it("MOCK_PENDING_REVIEW — ровно {submitted, ai_checking, awaiting_review}", () => {
    expect([...MOCK_PENDING_REVIEW].sort()).toEqual(["ai_checking", "awaiting_review", "submitted"]);
  });

  it("BEHIND_GOAL_PCT = 50 (зеркало usp/data.js BEHIND)", () => {
    expect(BEHIND_GOAL_PCT).toBe(50);
  });
});

describe("gradeClass — класс ученика", () => {
  it("явный положительный grade из профиля важнее трека", () => {
    expect(gradeClass(9, "ege")).toBe("9 класс");
    expect(gradeClass(11, "oge")).toBe("11 класс");
  });

  it("grade 0, отрицательный, null и undefined — не класс, падаем на трек", () => {
    expect(gradeClass(0, "ege")).toBe("11 класс");
    expect(gradeClass(-1, "ege")).toBe("11 класс");
    expect(gradeClass(null, "oge")).toBe("9 класс");
    expect(gradeClass(undefined, "ege")).toBe("11 класс");
  });

  it("неизвестный трек без класса — null, а не выдуманный класс", () => {
    expect(gradeClass(null, "school")).toBeNull();
    expect(gradeClass(undefined, "")).toBeNull();
  });
});

describe("aggregateHwWork — сигналы по работе", () => {
  it("пустой вход — все сигналы false", () => {
    expect(aggregateHwWork([], null, "active")).toEqual({
      submitted: false,
      pendingReview: false,
      reviewed: false,
      overdue: false,
    });
  });

  it("сдано: завершённый тред / completed-задача / любая AI-оценка, включая 0", () => {
    expect(aggregateHwWork([], null, "completed").submitted).toBe(true);
    expect(
      aggregateHwWork([{ status: "completed", ai_score: null, tutor_reviewed_at: null }], null, "active").submitted,
    ).toBe(true);
    // 0 — это балл, а не «нет данных»: != null, значит проверка AI состоялась.
    expect(
      aggregateHwWork([{ status: "in_progress", ai_score: 0, tutor_reviewed_at: null }], null, "active").submitted,
    ).toBe(true);
  });

  it("AI-оценка без визы репетитора → pendingReview, и он блокирует reviewed", () => {
    const r = aggregateHwWork(
      [
        { status: "completed", ai_score: 5, tutor_reviewed_at: "2026-07-01T00:00:00Z" },
        { status: "completed", ai_score: 3, tutor_reviewed_at: null },
      ],
      null,
      "active",
    );
    expect(r.pendingReview).toBe(true);
    expect(r.reviewed).toBe(false);
  });

  it("reviewed: достаточно ОДНОЙ визы (в buildStudentProgress у работы строже — все задачи)", () => {
    // Канарейка расхождения: здесь `some(tutor_reviewed_at)`, а per-work
    // reviewed в билдере — `reviewedCount === total`. Это два разных контракта.
    const r = aggregateHwWork(
      [
        { status: "completed", ai_score: 5, tutor_reviewed_at: "2026-07-01T00:00:00Z" },
        { status: "completed", ai_score: null, tutor_reviewed_at: null },
      ],
      null,
      "active",
    );
    expect(r.reviewed).toBe(true);
  });

  it("просрочка: срок прошёл и не сдано — true; будущий срок / сдано и проверено — false", () => {
    expect(aggregateHwWork([], PAST, "active").overdue).toBe(true);
    expect(aggregateHwWork([], FUTURE, "active").overdue).toBe(false);
    expect(aggregateHwWork([], PAST, "completed").overdue).toBe(false);
  });

  it("сдано, но AI-оценка ждёт визы после срока — всё ещё просрочка", () => {
    const r = aggregateHwWork(
      [{ status: "completed", ai_score: 4, tutor_reviewed_at: null }],
      PAST,
      "active",
    );
    expect(r.submitted).toBe(true);
    expect(r.overdue).toBe(true);
  });
});

describe("resolveTutorPkId — FK-конверсия auth.users.id → tutors.id", () => {
  it("находит id по user_id; без строки — null", async () => {
    const db = makeFakeDb({ tutors: [{ id: TUTOR_PK, user_id: TUTOR_USER }] }) as never;
    expect(await resolveTutorPkId(db, TUTOR_USER)).toBe(TUTOR_PK);
    expect(await resolveTutorPkId(db, "no-such-user")).toBeNull();
  });
});

describe("buildStudentProgress — доступ и пустая история", () => {
  it("ученик не найден или принадлежит другому тутору — null, не throw", async () => {
    expect(await build({ ...baseFixtures(), tutor_students: [] })).toBeNull();
    expect(
      await build({
        ...baseFixtures(),
        tutor_students: [{ id: TS_ID, tutor_id: "чужой-pk", student_id: STUDENT, display_name: null, exam_type: "ege", target_score: null }],
      }),
    ).toBeNull();
  });

  it("пустая история — корректный пустой payload без throw", async () => {
    const p = await build(baseFixtures());
    expect(p).toEqual({
      student: {
        id: TS_ID,
        student_id: STUDENT,
        name: "Глеб",
        avatar_url: null,
        track: "ege",
        grade_class: "11 класс",
      },
      target: { track: "ege", target_score: 80, scale_year: 2026 },
      works: [],
      summary: {
        done: 0,
        total: 0,
        reviewed_pct: null,
        needs_attention: false,
        current_level: null,
        target: 80,
        trend: [],
        hw_done: 0,
        hw_total: 0,
        hw_overdue: 0,
        hw_success_pct: null,
      },
    });
  });

  it("имя: display_name → full_name → username (кроме служебных user_*) → «Ученик»", async () => {
    const noDisplay = (username: string | null, fullName: string | null) => ({
      ...baseFixtures(),
      tutor_students: [{ id: TS_ID, tutor_id: TUTOR_PK, student_id: STUDENT, display_name: null, exam_type: "ege", target_score: null }],
      profiles: [{ id: STUDENT, full_name: fullName, username, avatar_url: null, grade: null }],
    });
    expect((await build(noDisplay("user_42", null)))!.student.name).toBe("Ученик");
    expect((await build(noDisplay("gleb2010", null)))!.student.name).toBe("gleb2010");
    expect((await build(noDisplay("gleb2010", "Иван")))!.student.name).toBe("Иван");
  });
});

// ── ДЗ ───────────────────────────────────────────────────────────────────────

/** Проверенная работа: 2 задачи, тред завершён, обе завизированы. */
function verifiedHwFixtures(workMode: "homework" | "independent" = "homework"): FakeDbFixtures {
  return baseFixtures({
    homework_tutor_assignments: [{
      id: "a1",
      tutor_id: TUTOR_USER, // auth.users.id — НЕ tutors.id
      title: "Кинематика",
      subject: "physics",
      status: "active",
      deadline: null,
      created_at: "2026-07-01T10:00:00Z",
      work_mode: workMode,
    }],
    homework_tutor_student_assignments: [{ id: "sa1", assignment_id: "a1", student_id: STUDENT }],
    homework_tutor_tasks: [
      // Нарочно в обратном порядке: cells обязаны отсортироваться по order_num.
      { id: "t-hard", assignment_id: "a1", order_num: 2, max_score: 2 },
      { id: "t-easy", assignment_id: "a1", order_num: 1, max_score: 3 },
    ],
    homework_tutor_threads: [{ id: "th1", student_assignment_id: "sa1", status: "completed" }],
    homework_tutor_task_states: [
      // Ручной балл репетитора бьёт всё: 3, а не ai 2 и не earned 1.
      { thread_id: "th1", task_id: "t-easy", status: "completed", ai_score: 2, earned_score: 1, best_earned_score: null, tutor_score_override: 3, tutor_reviewed_at: "2026-07-02T10:00:00Z", ai_help_events: 0, hint_count: 0, wrong_answer_count: 0, attempts: 1 },
      // best_earned_score (2) выше earned (1.5) и ai (1) — пересдача не понижает.
      { thread_id: "th1", task_id: "t-hard", status: "completed", ai_score: 1, earned_score: 1.5, best_earned_score: 2, tutor_score_override: null, tutor_reviewed_at: "2026-07-02T10:00:00Z", ai_help_events: 2, hint_count: 0, wrong_answer_count: 0, attempts: 1 },
    ],
  });
}

describe("buildStudentProgress — домашние работы", () => {
  it("cells в порядке order_num, балл — цепочка computeFinalScore (override / best_earned)", async () => {
    const p = await build(verifiedHwFixtures());
    expect(p!.works).toHaveLength(1);
    const w = p!.works[0];
    expect(w.kind).toBe("homework");
    expect(w.cells).toEqual([
      { score: 3, max: 3 }, // t-easy (order 1): override 3
      { score: 2, max: 2 }, // t-hard (order 2): best_earned 2
    ]);
    expect(w.raw).toBe(5);
    expect(w.raw_max).toBe(5);
    expect(w.reviewed).toBe(true);
    expect(w.status).toBe("verified");
    expect(w.pending_review_count).toBe(0);
    expect(w.date).toBe("2026-07-01T10:00:00Z"); // deadline null → created_at
  });

  it("проверенная работа: счётчики родителя и «% самостоятельности» (взвешенный по max_score)", async () => {
    const p = await build(verifiedHwFixtures());
    // (100% × вес 3 + 80% × вес 2) / 5 = 92 — сложные задачи весят больше.
    expect(p!.works[0].independence_pct).toBe(92);
    expect(p!.works[0].independence_is_estimate).toBe(false);
    expect(p!.summary).toMatchObject({
      done: 1,
      total: 1,
      reviewed_pct: 100,
      needs_attention: false,
      hw_done: 1,
      hw_total: 1,
      hw_overdue: 0,
      hw_success_pct: 100,
    });
  });

  it("work_mode=independent: «% самостоятельности» не показывается (AI выключен)", async () => {
    const p = await build(verifiedHwFixtures("independent"));
    expect(p!.works[0].work_mode).toBe("independent");
    expect(p!.works[0].independence_pct).toBeNull();
    expect(p!.works[0].independence_is_estimate).toBe(false);
  });

  it("earned_score без сигнала завершения — ячейка ПУСТАЯ (гейт hasSignal), работа «none»", async () => {
    // Странность кода, фиксируем как есть: балл появляется в ячейке только при
    // status=completed / ai_score / override. Голый earned_score (задача в
    // процессе) не считается сигналом — и в raw не входит.
    const p = await build(baseFixtures({
      homework_tutor_assignments: [{ id: "a3", tutor_id: TUTOR_USER, title: "В процессе", subject: null, status: "active", deadline: null, created_at: "2026-07-01T00:00:00Z", work_mode: "homework" }],
      homework_tutor_student_assignments: [{ id: "sa3", assignment_id: "a3", student_id: STUDENT }],
      homework_tutor_tasks: [{ id: "t3", assignment_id: "a3", order_num: 1, max_score: 5 }],
      homework_tutor_threads: [{ id: "th3", student_assignment_id: "sa3", status: "active" }],
      homework_tutor_task_states: [
        { thread_id: "th3", task_id: "t3", status: "in_progress", ai_score: null, earned_score: 4, best_earned_score: null, tutor_score_override: null, tutor_reviewed_at: null, ai_help_events: null, hint_count: 0, wrong_answer_count: 0, attempts: 1 },
      ],
    }));
    expect(p!.works[0].cells).toEqual([{ score: null, max: 5 }]);
    expect(p!.works[0].raw).toBeNull();
    expect(p!.works[0].status).toBe("none");
    expect(p!.summary.done).toBe(0); // «none» не считается сданной
    expect(p!.summary.hw_total).toBe(1);
  });

  it("draft-задание и задание чужого тутора не попадают в выборку", async () => {
    const p = await build(baseFixtures({
      homework_tutor_assignments: [
        { id: "a-draft", tutor_id: TUTOR_USER, title: "Черновик", subject: null, status: "draft", deadline: null, created_at: "2026-07-01T00:00:00Z", work_mode: "homework" },
        { id: "a-foreign", tutor_id: "другой-тутор", title: "Чужое", subject: null, status: "active", deadline: null, created_at: "2026-07-01T00:00:00Z", work_mode: "homework" },
      ],
      homework_tutor_student_assignments: [
        { id: "sa-d", assignment_id: "a-draft", student_id: STUDENT },
        { id: "sa-f", assignment_id: "a-foreign", student_id: STUDENT },
      ],
    }));
    expect(p!.works).toEqual([]);
    expect(p!.summary.hw_total).toBe(0);
  });

  it("сдано, но ждёт визы после срока: status=review, просрочка работы, hw_overdue, needs_attention", async () => {
    const p = await build(baseFixtures({
      homework_tutor_assignments: [{ id: "a2", tutor_id: TUTOR_USER, title: "Динамика", subject: null, status: "active", deadline: PAST, created_at: "2019-12-01T00:00:00Z", work_mode: "homework" }],
      homework_tutor_student_assignments: [{ id: "sa2", assignment_id: "a2", student_id: STUDENT }],
      homework_tutor_tasks: [{ id: "t2", assignment_id: "a2", order_num: 1, max_score: 4 }],
      homework_tutor_threads: [{ id: "th2", student_assignment_id: "sa2", status: "active" }],
      homework_tutor_task_states: [
        // ai_help_events нет (legacy-работа) → «≈»-оценка по hint_count.
        { thread_id: "th2", task_id: "t2", status: "completed", ai_score: 3, earned_score: null, best_earned_score: null, tutor_score_override: null, tutor_reviewed_at: null, ai_help_events: null, hint_count: 1, wrong_answer_count: 0, attempts: 2 },
      ],
    }));
    const w = p!.works[0];
    expect(w.status).toBe("review");
    expect(w.overdue).toBe(true);
    expect(w.pending_review_count).toBe(1);
    expect(w.raw).toBe(3); // ai_score — последний в цепочке из имеющихся
    expect(w.independence_pct).toBe(90);
    expect(w.independence_is_estimate).toBe(true); // legacy-оценка помечается «≈»
    expect(p!.summary).toMatchObject({
      done: 1,
      reviewed_pct: 0, // сдано 1, проверено 0 — это 0%, а не null
      needs_attention: true, // backlog: есть работа в статусе review
      hw_done: 0, // тред не завершён — «сделано» не растёт
      hw_overdue: 1,
      hw_success_pct: null, // success% только по ЗАВЕРШЁННЫМ тредам
    });
  });
});

// ── Пробники ─────────────────────────────────────────────────────────────────

function mockFixtures(
  attempts: Record<string, unknown>[],
  variants?: Record<string, unknown>[],
  assignments?: Record<string, unknown>[],
): FakeDbFixtures {
  return baseFixtures({
    mock_exam_assignments: assignments ?? [{
      id: "m1",
      tutor_id: TUTOR_USER,
      variant_id: "v1",
      variant_title: "Вариант 3",
      title: "", // пустой → заголовок берётся из variant_title
      deadline: null,
      created_at: "2026-07-05T00:00:00Z",
    }],
    mock_exam_variants: variants ?? [
      { id: "v1", exam_type: "ege_physics", subject: "physics", total_max_score: 45, part1_max: 20, part2_max: 25 },
    ],
    mock_exam_attempts: attempts,
  });
}

describe("buildStudentProgress — пробники", () => {
  it("approved: балл раскрыт, 2-ячеечная мини-карта, тренд и current_level по шкале ЕГЭ-физики", async () => {
    const p = await build(mockFixtures([
      { id: "at1", assignment_id: "m1", student_id: STUDENT, status: "approved", total_score: 21, total_part1_score: 15, total_part2_score: 6, submitted_at: "2026-07-10T12:00:00Z", manual_entered_date: null, created_at: "2026-07-06T00:00:00Z" },
    ]));
    const w = p!.works[0];
    expect(w.kind).toBe("mock");
    expect(w.title).toBe("Вариант 3");
    expect(w.score_kind).toBe("ege_scaled");
    expect(w.raw).toBe(21);
    expect(w.raw_max).toBe(45);
    expect(w.cells).toEqual([{ score: 15, max: 20 }, { score: 6, max: 25 }]);
    expect(w.reviewed).toBe(true);
    expect(w.status).toBe("verified");
    expect(p!.summary.trend).toEqual([59]); // первичный 21 → тестовый 59
    expect(p!.summary.current_level).toBe(59);
    // 59 из цели 80 = 74% ≥ BEHIND_GOAL_PCT → внимания не требует.
    expect(p!.summary.needs_attention).toBe(false);
  });

  it("anti-leak до подтверждения: raw=null и cells=[] даже при заполненном total_score", async () => {
    const p = await build(mockFixtures([
      { id: "at2", assignment_id: "m1", student_id: STUDENT, status: "awaiting_review", total_score: 30, total_part1_score: 20, total_part2_score: 10, submitted_at: "2026-07-10T12:00:00Z", manual_entered_date: null, created_at: "2026-07-06T00:00:00Z" },
    ]));
    const w = p!.works[0];
    expect(w.raw).toBeNull();
    expect(w.cells).toEqual([]);
    expect(w.reviewed).toBe(false);
    expect(w.status).toBe("review");
    expect(p!.summary.trend).toEqual([]); // предварительный балл в тренд не идёт
    expect(p!.summary.needs_attention).toBe(true); // backlog: ждёт проверки
  });

  it("in_progress/paused → «none» и не считается сданной", async () => {
    const p = await build(mockFixtures([
      { id: "at3", assignment_id: "m1", student_id: STUDENT, status: "in_progress", total_score: null, total_part1_score: null, total_part2_score: null, submitted_at: null, manual_entered_date: null, created_at: "2026-07-06T00:00:00Z" },
    ]));
    expect(p!.works[0].status).toBe("none");
    expect(p!.summary.done).toBe(0);
    expect(p!.summary.reviewed_pct).toBeNull(); // сданных нет → null, не 0
  });

  it("manually_entered — подтверждённый (HW_CONFIRMED_MOCK): балл раскрыт, дата — из manual_entered_date", async () => {
    const p = await build(mockFixtures([
      { id: "at4", assignment_id: "m1", student_id: STUDENT, status: "manually_entered", total_score: 25, total_part1_score: null, total_part2_score: null, submitted_at: null, manual_entered_date: "2026-07-11T00:00:00Z", created_at: "2026-07-06T00:00:00Z" },
    ]));
    const w = p!.works[0];
    expect(w.reviewed).toBe(true);
    expect(w.status).toBe("verified");
    expect(w.raw).toBe(25);
    expect(w.date).toBe("2026-07-11T00:00:00Z");
    expect(p!.summary.trend).toEqual([65]); // 25 первичных → 65 тестовых
  });

  it("не-физика ЕГЭ: score_kind=primary, БЕЗ пересчёта по физической шкале (ревью 5.6 P1 #5)", async () => {
    const p = await build(mockFixtures(
      [{ id: "at5", assignment_id: "m1", student_id: STUDENT, status: "approved", total_score: 40, total_part1_score: null, total_part2_score: null, submitted_at: "2026-07-10T12:00:00Z", manual_entered_date: null, created_at: "2026-07-06T00:00:00Z" }],
      [{ id: "v1", exam_type: "ege", subject: "social", total_max_score: 57, part1_max: 0, part2_max: 0 }],
    ));
    const w = p!.works[0];
    expect(w.score_kind).toBe("primary");
    expect(w.raw).toBe(40);
    expect(w.raw_max).toBe(57);
    expect(w.cells).toEqual([]); // part1/part2 max = 0 → мини-карты нет
    expect(p!.summary.trend).toEqual([]); // шкалы для предмета нет → тренда нет
    expect(p!.summary.current_level).toBeNull();
    // Фикс 2026-08-05: subject у mock-работы — предмет варианта (раньше был
    // захардкожен "physics", и пробник по обществознанию уходил родителю
    // как физика). Легаси-фолбэк NULL→"physics" проверяется отдельным тестом.
    expect(w.subject).toBe("social");
  });

  it("легаси-вариант с subject NULL → фолбэк \"physics\" (старые строки забэкфилены физикой)", async () => {
    const p = await build(mockFixtures(
      [{ id: "at5b", assignment_id: "m1", student_id: STUDENT, status: "approved", total_score: 10, total_part1_score: null, total_part2_score: null, submitted_at: "2026-07-10T12:00:00Z", manual_entered_date: null, created_at: "2026-07-06T00:00:00Z" }],
      [{ id: "v1", exam_type: "ege_physics", subject: null, total_max_score: 45, part1_max: 0, part2_max: 0 }],
    ));
    expect(p!.works[0].subject).toBe("physics");
  });

  it("низкий подтверждённый балл против цели → behindGoal → needs_attention без всякого backlog", async () => {
    const p = await build(mockFixtures([
      { id: "at6", assignment_id: "m1", student_id: STUDENT, status: "approved", total_score: 1, total_part1_score: 1, total_part2_score: 0, submitted_at: "2026-07-10T12:00:00Z", manual_entered_date: null, created_at: "2026-07-06T00:00:00Z" },
    ]));
    // Первичный 1 → тестовый 5; 5 из 80 = 6% < 50 → отстаёт от цели.
    expect(p!.summary.current_level).toBe(5);
    expect(p!.works[0].status).toBe("verified"); // backlog нет
    expect(p!.summary.needs_attention).toBe(true);
  });

  it("тренд сортируется по дате сдачи (asc), works — по дате (desc)", async () => {
    const p = await build(mockFixtures(
      [
        // Нарочно поздняя раньше в фикстуре — порядок обязан выправиться.
        { id: "at-late", assignment_id: "m-late", student_id: STUDENT, status: "approved", total_score: 30, total_part1_score: null, total_part2_score: null, submitted_at: "2026-07-20T12:00:00Z", manual_entered_date: null, created_at: "2026-07-06T00:00:00Z" },
        { id: "at-early", assignment_id: "m-early", student_id: STUDENT, status: "approved", total_score: 21, total_part1_score: null, total_part2_score: null, submitted_at: "2026-07-10T12:00:00Z", manual_entered_date: null, created_at: "2026-07-05T00:00:00Z" },
      ],
      undefined,
      [
        { id: "m-early", tutor_id: TUTOR_USER, variant_id: "v1", variant_title: null, title: "Ранний", deadline: null, created_at: "2026-07-05T00:00:00Z" },
        { id: "m-late", tutor_id: TUTOR_USER, variant_id: "v1", variant_title: null, title: "Поздний", deadline: null, created_at: "2026-07-06T00:00:00Z" },
      ],
    ));
    expect(p!.summary.trend).toEqual([59, 73]); // 21→59 (10.07), 30→73 (20.07)
    expect(p!.summary.current_level).toBe(73); // последняя точка тренда
    expect(p!.works.map((w) => w.id)).toEqual(["at-late", "at-early"]);
  });
});

describe("buildStudentProgress — период отчёта", () => {
  it("работа вне периода исключается и из works, и из hw-счётчиков; конец периода инклюзивен", async () => {
    const fixtures = {
      ...verifiedHwFixtures(),
      ...mockFixtures([
        // 31 июля 18:00 — ВНУТРИ периода до «2026-07-31» (конец = до конца дня).
        { id: "at-in", assignment_id: "m1", student_id: STUDENT, status: "approved", total_score: 21, total_part1_score: null, total_part2_score: null, submitted_at: "2026-07-31T18:00:00Z", manual_entered_date: null, created_at: "2026-07-06T00:00:00Z" },
        // 1 августа — уже снаружи.
        { id: "at-out", assignment_id: "m1", student_id: STUDENT, status: "approved", total_score: 30, total_part1_score: null, total_part2_score: null, submitted_at: "2026-08-01T10:00:00Z", manual_entered_date: null, created_at: "2026-07-06T00:00:00Z" },
      ]),
      // ДЗ с дедлайном ДО периода — исключается (дата ДЗ = deadline ?? created_at).
      homework_tutor_assignments: [{ id: "a1", tutor_id: TUTOR_USER, title: "Июньское", subject: null, status: "active", deadline: "2026-06-15T00:00:00Z", created_at: "2026-06-01T00:00:00Z", work_mode: "homework" }],
    };
    const p = await build(fixtures, { start: "2026-07-01", end: "2026-07-31" });
    expect(p!.works.map((w) => w.id)).toEqual(["at-in"]);
    expect(p!.summary.hw_total).toBe(0); // июньское ДЗ не попало и в счётчики
    expect(p!.summary.trend).toEqual([59]); // at-out не внёс точку
  });

  it("без периода (тутор-«Обзор») — all-time: та же фикстура отдаёт все работы", async () => {
    const fixtures = {
      ...verifiedHwFixtures(),
      ...mockFixtures([
        { id: "at-in", assignment_id: "m1", student_id: STUDENT, status: "approved", total_score: 21, total_part1_score: null, total_part2_score: null, submitted_at: "2026-07-31T18:00:00Z", manual_entered_date: null, created_at: "2026-07-06T00:00:00Z" },
      ]),
    };
    const p = await build(fixtures);
    expect(p!.works).toHaveLength(2);
    expect(p!.summary.hw_total).toBe(1);
  });
});
