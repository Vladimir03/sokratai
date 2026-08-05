import { describe, expect, it } from "vitest";
import {
  buildFallbackHint,
  renormalizeCriteriaToScore,
  validateHintContent,
  type GuidedCriteriaItem,
} from "./guided_ai";

/**
 * Тесты на непокрытую математику баллов и подсказки guided-чата ДЗ.
 *
 * Почему здесь: `renormalizeCriteriaToScore` — та же категория, что
 * `score-compute` (rule 20): ошибка не падает, а молча пишет ученику НЕВЕРНУЮ
 * разбивку по критериям, расходящуюся с ai_score. Ровно этот дрейф уже был
 * багом (P1 #3, ревью 2026-05-27) — функцию для того и извлекли.
 *
 * Deno-модуль гоняется в vitest, потому что npm:-импорты в графе только
 * `import type` (стираются), а Deno.env читается внутри функций, не на
 * верхнем уровне модуля.
 */

function item(overrides: Partial<GuidedCriteriaItem> = {}): GuidedCriteriaItem {
  return { label: "К1", score: 0, max: 1, comment: "", ...overrides };
}

describe("renormalizeCriteriaToScore — входные гварды", () => {
  it("null / undefined / пустой массив → null", () => {
    expect(renormalizeCriteriaToScore(null, 2, 5)).toBeNull();
    expect(renormalizeCriteriaToScore(undefined, 2, 5)).toBeNull();
    expect(renormalizeCriteriaToScore([], 2, 5)).toBeNull();
  });

  it("effectiveAiScoreTaskScale null или не-finite → items возвращаются как есть (та же ссылка)", () => {
    const items = [item({ score: 2, max: 3 })];
    expect(renormalizeCriteriaToScore(items, null, 5)).toBe(items);
    expect(renormalizeCriteriaToScore(items, Number.NaN, 5)).toBe(items);
    expect(renormalizeCriteriaToScore(items, Infinity, 5)).toBe(items);
    // Никто не должен был тронуть исходные объекты.
    expect(items[0].score).toBe(2);
  });
});

describe("renormalizeCriteriaToScore — перенормировка суммы", () => {
  it("пропорционально сжимает баллы AI-критериев к новому таргету", () => {
    // Σ score = 3, новый эффективный балл 1.5 при max_score == Σ max → factor 0.5.
    const result = renormalizeCriteriaToScore(
      [item({ label: "К1", score: 2, max: 3 }), item({ label: "К2", score: 1, max: 2 })],
      1.5,
      5,
    )!;
    expect(result.map((c) => c.score)).toEqual([1, 0.5]);
  });

  it("tutor_only исключается из суммы и остаётся нетронутым (пиннится)", () => {
    // AI-часть: 2/3; произношение (tutor_only) 2/2 в таргет НЕ входит.
    const result = renormalizeCriteriaToScore(
      [
        item({ label: "Содержание", score: 2, max: 3 }),
        item({ label: "Произношение", score: 2, max: 2, kind: "tutor_only" }),
      ],
      1,
      3,
    )!;
    expect(result[0].score).toBe(1); // 2 × (1/2)
    expect(result[1].score).toBe(2); // не тронут
  });

  it("если все критерии tutor_only — ничего не меняется даже при таргете 0", () => {
    const result = renormalizeCriteriaToScore(
      [item({ score: 2, max: 2, kind: "tutor_only" })],
      0,
      2,
    )!;
    expect(result[0].score).toBe(2);
  });

  it("Σ score = 0 при таргете > 0 → распределение пропорционально max", () => {
    // Вердикт-даунгрейд мог занулить всё, а потом эффективный балл вырос.
    const result = renormalizeCriteriaToScore(
      [item({ score: 0, max: 3 }), item({ score: 0, max: 1 })],
      2,
      4,
    )!;
    expect(result.map((c) => c.score)).toEqual([1.5, 0.5]); // (3/4)·2 и (1/4)·2
  });

  it("дрейф округления впитывается в критерий с наибольшим max, все баллы кратны 0.1", () => {
    // 3 × (1/1) → таргет 2: каждый 0.6667 → 0.7, Σ = 2.1, дрейф −0.1 уходит в первый.
    const result = renormalizeCriteriaToScore(
      [item({ label: "К1", score: 1 }), item({ label: "К2", score: 1 }), item({ label: "К3", score: 1 })],
      2,
      3,
    )!;
    expect(result.map((c) => c.score)).toEqual([0.6, 0.7, 0.7]);
    for (const c of result) {
      expect(Math.round(c.score * 10) / 10).toBe(c.score); // шаг 0.1 (rule 40)
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.score).toBeLessThanOrEqual(c.max);
    }
  });

  it("клампы: таргет не выходит за Σ max, отрицательный балл зануляет", () => {
    // effective 100 при max_score 2 → таргет капится на aiGradableMax → score = max.
    const inflated = renormalizeCriteriaToScore([item({ score: 1, max: 2 })], 100, 2)!;
    expect(inflated[0].score).toBe(2);
    // Отрицательный эффективный балл → safeScore 0 → всё в ноль.
    const negative = renormalizeCriteriaToScore([item({ score: 1, max: 2 })], -3, 2)!;
    expect(negative[0].score).toBe(0);
  });

  it("расхождение в пределах толеранса 0.05 не трогает баллы", () => {
    // |1.5 − 1.52| = 0.02 ≤ CRITERIA_SUM_TOLERANCE → перенормировка не запускается.
    const result = renormalizeCriteriaToScore([item({ score: 1.5, max: 3 })], 1.52, 3)!;
    expect(result[0].score).toBe(1.5);
  });

  it("misconfig max_score ≠ Σ max критериев → балл переводится на шкалу шаблона", () => {
    // Задача на 5 баллов, шаблон на 10: effective 2.5 → таргет 2.5·(10/5) = 5.
    const result = renormalizeCriteriaToScore([item({ score: 4, max: 10 })], 2.5, 5)!;
    expect(result[0].score).toBe(5);
  });
});

describe("validateHintContent — гейт качества подсказки", () => {
  it("нормальная предметная подсказка проходит", () => {
    const hint =
      "Сосредоточься на том, что в задаче фигурирует «скорость». Какая физическая величина это описывает?";
    expect(validateHintContent(hint)).toEqual({ ok: true });
  });

  it("короче 40 символов (после trim) — too_short; пустая строка тоже", () => {
    expect(validateHintContent("")).toEqual({ ok: false, reason: "too_short" });
    expect(validateHintContent("а".repeat(39))).toEqual({ ok: false, reason: "too_short" });
    expect(validateHintContent("а".repeat(40)).ok).toBe(true); // граница ровно 40
  });

  it("пустые фразы-паразиты запрещены и проверяются РАНЬШЕ длины", () => {
    // «Перечитай условие» короче 40 символов, но причина — forbidden, не too_short:
    // порядок проверок в коде фиксирован, и его смена поменяла бы телеметрию причин.
    const short = validateHintContent("Перечитай условие");
    expect(short.ok).toBe(false);
    expect(short.reason).toMatch(/^forbidden:/);

    const long = validateHintContent(
      "Попробуй ещё раз решить эту задачу, у тебя обязательно получится, я в тебя верю!",
    );
    expect(long.ok).toBe(false);
    expect(long.reason).toMatch(/^forbidden:/);
  });

  it("верхнего предела длины НЕТ — очень длинный текст проходит (клампится не здесь)", () => {
    // Фиксируем текущее поведение: усечение живёт в sanitizeHintText
    // (softTruncate до MAX_FEEDBACK_LENGTH), а не в валидаторе.
    expect(validateHintContent("х".repeat(5000)).ok).toBe(true);
  });
});

describe("buildFallbackHint — резервная подсказка без AI", () => {
  it("физика + ключевое слово из словаря стемов → физическая формулировка", () => {
    const hint = buildFallbackHint({
      taskText: "Брусок массой 2 кг тянут по столу с постоянной скоростью",
      subject: "physics",
    });
    expect(hint).toContain("«брусок»"); // первый стем словаря побеждает
    expect(hint).toContain("физическая величина");
    expect(validateHintContent(hint).ok).toBe(true);
  });

  it("не-физика: стоп-слова пропускаются, берётся первое содержательное слово ≥5 букв", () => {
    // «Найдите» — в FALLBACK_STOPWORDS, поэтому ключевым становится следующее слово.
    const hint = buildFallbackHint({
      taskText: "Найдите грамматическую основу предложения",
      subject: "russian",
    });
    expect(hint).toContain("«грамматическую»");
    expect(hint).toContain("Какое правило, приём или ключевая идея");
    expect(validateHintContent(hint).ok).toBe(true);
  });

  it("пустой текст + картинка → ветка про изображение, предметно-зависимая", () => {
    const physics = buildFallbackHint({ taskText: "", hasImage: true, subject: "physics" });
    expect(physics).toContain("На изображении задачи есть конкретные величины");

    const generic = buildFallbackHint({ taskText: "", hasImage: true, subject: "russian" });
    expect(generic).toContain("На изображении задачи есть конкретные элементы условия");
  });

  it("текст без единого ключевого слова (и без картинки) падает в предметный фолбэк", () => {
    // Непустой текст из коротких слов НЕ уводит в ветку картинки — только в subject-фолбэк.
    const hint = buildFallbackHint({ taskText: "Дано: а и б", subject: "french" });
    expect(hint).toContain("грамматическое правило");
    // Неизвестный предмет → нейтральный дефолт (никакой «физической величины» — rule 40).
    const unknown = buildFallbackHint({ taskText: "Дано: а и б", subject: "dance" });
    expect(unknown).toContain("На какую часть условия ты опираешься");
    expect(unknown).not.toContain("физическая");
  });

  it("любая ветка фолбэка проходит validateHintContent", () => {
    const contexts = [
      { taskText: "Брусок скользит по наклонной плоскости", subject: "physics" },
      { taskText: "Найдите грамматическую основу", subject: "russian" },
      { taskText: "", hasImage: true, subject: "physics" },
      { taskText: "", hasImage: true, subject: "french" },
      { taskText: "", subject: "chemistry" },
      { taskText: "", subject: null },
    ];
    for (const ctx of contexts) {
      expect(validateHintContent(buildFallbackHint(ctx)).ok).toBe(true);
    }
  });
});
