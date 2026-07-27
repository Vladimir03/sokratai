import { describe, expect, it } from "vitest";
import {
  aggregateIndependencePct,
  computeFinalScore,
  computeIndependencePct,
  estimateIndependencePctLegacy,
  INDEPENDENCE_PENALTY_PP,
  resolveIndependencePct,
} from "./score-compute";

/**
 * Тесты на ГРЕЙДИНГ — балл ученика и метрика самостоятельности.
 *
 * Почему именно здесь первый тест проекта: ошибка в этой цепочке не падает и не
 * логируется — она молча ставит НЕВЕРНЫЙ балл. Ученик видит чужую оценку,
 * репетитор принимает по ней решение, и заметить это можно только вручную,
 * сверив с исходником. Ровно тот класс, ради которого стоит держать тесты.
 *
 * Функция читается за минуту, поэтому ценность тестов не в «проверить, что if
 * работает», а в ЗАКРЕПЛЕНИИ решений, которые из кода не следуют:
 * порядок приоритетов, поведение при `undefined` и разница между 0 и null.
 */

describe("computeFinalScore — цепочка приоритетов", () => {
  it("ручной балл репетитора бьёт всё остальное", () => {
    const score = computeFinalScore(
      { tutor_score_override: 3, best_earned_score: 9, earned_score: 8, ai_score: 7, status: "completed" },
      10,
    );
    expect(score).toBe(3);
  });

  it("best_earned_score стоит ВЫШЕ earned_score: повторная неудачная попытка не понижает балл", () => {
    // Ученик набрал 9, пересдал и получил 4. Должно остаться 9 — иначе
    // пересдача наказывала бы за попытку улучшить результат.
    expect(computeFinalScore({ best_earned_score: 9, earned_score: 4 }, 10)).toBe(9);
  });

  it("ai_score используется, только когда человеческих баллов нет", () => {
    expect(computeFinalScore({ ai_score: 6 }, 10)).toBe(6);
    expect(computeFinalScore({ earned_score: 2, ai_score: 6 }, 10)).toBe(2);
  });

  it("НОЛЬ — это балл, а не «нет данных»", () => {
    // Ключевое отличие `!= null` от truthy-проверки. Если кто-то заменит
    // условие на `if (ts.earned_score)`, ноль провалится дальше по цепочке и
    // ученик с нулём получит ai_score или max — молча.
    expect(computeFinalScore({ earned_score: 0, ai_score: 8, status: "completed" }, 10)).toBe(0);
    expect(computeFinalScore({ tutor_score_override: 0, best_earned_score: 9 }, 10)).toBe(0);
  });

  it("completed без единого балла даёт максимум", () => {
    expect(computeFinalScore({ status: "completed" }, 7.5)).toBe(7.5);
  });

  it("не completed и без баллов — ноль", () => {
    expect(computeFinalScore({ status: "in_progress" }, 10)).toBe(0);
    expect(computeFinalScore({}, 10)).toBe(0);
  });

  it("undefined-поле ведёт себя как отсутствующее (fail-safe для забытого SELECT)", () => {
    // Колонка, не попавшая в SELECT, приходит `undefined`. Цепочка обязана
    // молча деградировать к прежнему поведению, а не считать её нулём.
    expect(computeFinalScore({ best_earned_score: undefined, earned_score: 5 }, 10)).toBe(5);
  });

  it("строковые значения из БД приводятся к числу", () => {
    // numeric из PostgREST приезжает строкой — без Number() сравнение и
    // арифметика выше по стеку поехали бы.
    expect(computeFinalScore({ earned_score: "4.5" as unknown as number }, 10)).toBe(4.5);
  });
});

describe("computeIndependencePct — «% самостоятельности»", () => {
  it("без обращений к AI — 100%", () => {
    expect(computeIndependencePct(0)).toBe(100);
  });

  it("каждое обращение снимает ровно 10 п.п.", () => {
    expect(computeIndependencePct(1)).toBe(100 - INDEPENDENCE_PENALTY_PP);
    expect(computeIndependencePct(3)).toBe(70);
  });

  it("шкала упирается в ноль и не уходит в минус", () => {
    expect(computeIndependencePct(10)).toBe(0);
    expect(computeIndependencePct(25)).toBe(0);
  });

  it("НЕТ ДАННЫХ — это null, а не 100%", () => {
    // Работы до релиза метрики и force-complete не имеют счётчика. Показать
    // «неизвестно» как «сделал сам» значило бы приписать ученику
    // самостоятельность, которой никто не измерял.
    expect(computeIndependencePct(null)).toBeNull();
    expect(computeIndependencePct(undefined)).toBeNull();
    expect(computeIndependencePct(Number.NaN)).toBeNull();
  });

  it("мусорные значения не ломают шкалу", () => {
    expect(computeIndependencePct(-5)).toBe(100); // отрицательных обращений не бывает
    expect(computeIndependencePct(2.7)).toBe(80); // дробное округляется вниз
  });
});

describe("aggregateIndependencePct — средневзвешенное по сложности", () => {
  it("вес задачи — её max_score: сложные весят больше", () => {
    // 100% на задаче в 1 балл и 0% на задаче в 9 баллов дают 10%, а не 50%.
    expect(
      aggregateIndependencePct([
        { pct: 100, weight: 1 },
        { pct: 0, weight: 9 },
      ]),
    ).toBe(10);
  });

  it("задачи без данных не входят НИ в числитель, НИ в знаменатель", () => {
    // Если бы null считался нулём, одна старая задача обрушила бы весь
    // показатель работы.
    expect(
      aggregateIndependencePct([
        { pct: 100, weight: 5 },
        { pct: null, weight: 5 },
      ]),
    ).toBe(100);
  });

  it("нулевой и отрицательный вес игнорируются", () => {
    expect(
      aggregateIndependencePct([
        { pct: 50, weight: 0 },
        { pct: 100, weight: 2 },
      ]),
    ).toBe(100);
    expect(aggregateIndependencePct([{ pct: 50, weight: -3 }])).toBeNull();
  });

  it("отсутствующий вес не считается единицей", () => {
    // `weight ?? 0` — умолчание именно ноль: задача без max_score не должна
    // тихо получить вес 1 и перекосить среднее.
    expect(aggregateIndependencePct([{ pct: 40, weight: undefined }])).toBeNull();
  });

  it("нет ни одной задачи с данными — null, а не 0%", () => {
    expect(aggregateIndependencePct([])).toBeNull();
    expect(aggregateIndependencePct([{ pct: null, weight: 5 }])).toBeNull();
  });
});

describe("estimateIndependencePctLegacy — оценка для работ до 2026-07-26", () => {
  it("считает по подсказкам и неверным попыткам", () => {
    // Одна подсказка + одна неверная попытка = два обращения → 80%.
    expect(estimateIndependencePctLegacy(1, 1)).toBe(80);
    expect(estimateIndependencePctLegacy(0, 3)).toBe(70);
  });

  it("нулевая активность — null, а не 100%", () => {
    // Ключевое решение: задачу, к которой ученик не приступал (или которую
    // закрыли массово), оценивать нечем. «100% самостоятельно» за нетронутую
    // работу — ложь, которая ещё и завысит агрегат.
    expect(estimateIndependencePctLegacy(0, 0, 0)).toBeNull();
    expect(estimateIndependencePctLegacy(null, null, null)).toBeNull();
  });

  it("одна попытка без ошибок и подсказок — 100%", () => {
    // Активность есть (attempts=1), обращений нет → решил сам.
    expect(estimateIndependencePctLegacy(0, 0, 1)).toBe(100);
  });

  it("floor 0 — метрика не уходит в минус", () => {
    expect(estimateIndependencePctLegacy(7, 6)).toBe(0);
  });
});

describe("resolveIndependencePct — развилка точный расчёт / оценка", () => {
  it("есть счётчик обращений — точный расчёт, без пометки оценки", () => {
    expect(resolveIndependencePct({ ai_help_events: 2, hint_count: 9, wrong_answer_count: 9 }))
      .toEqual({ pct: 80, isEstimate: false });
  });

  it("счётчик 0 — это ДАННЫЕ, а не их отсутствие", () => {
    // `ai_help_events = 0` материализуется при закрытии задачи и означает
    // «решил полностью сам». Уйти в legacy-ветку здесь нельзя: там по
    // hint/wrong могло бы получиться меньше 100%.
    expect(resolveIndependencePct({ ai_help_events: 0, hint_count: 3, wrong_answer_count: 2 }))
      .toEqual({ pct: 100, isEstimate: false });
  });

  it("счётчика нет, но активность была — оценка с пометкой", () => {
    expect(resolveIndependencePct({ ai_help_events: null, hint_count: 1, wrong_answer_count: 0 }))
      .toEqual({ pct: 90, isEstimate: true });
  });

  it("ни счётчика, ни активности — null и НЕ оценка", () => {
    // Именно этот случай остаётся «—» в интерфейсе.
    expect(resolveIndependencePct({ ai_help_events: null, hint_count: 0, wrong_answer_count: 0, attempts: 0 }))
      .toEqual({ pct: null, isEstimate: false });
  });
});
