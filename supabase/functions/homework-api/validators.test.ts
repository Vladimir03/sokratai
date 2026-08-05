/**
 * Валидаторы write-path'ов ДЗ (rule 40) — волна 2 тест-покрытия (2026-08-05).
 *
 * Самые дорогие исторические регрессы, которые эти функции держат:
 *  - шаг 0.5 у max_score: возврат к isPositiveInt молча коллапсировал 12.5 → 1;
 *  - task_kind ↔ check_format: write без deriveTaskKind делал все «краткие
 *    ответы» развёрнутыми (DB DEFAULT 'extended', баг 2026-05-12);
 *  - speaking НЕ выводится из check_format — только явный выбор.
 */
import { describe, expect, it } from "vitest";
import {
  deriveTaskKind,
  INDEPENDENT_MAX_ATTEMPTS,
  isPositiveHalfStepNumber,
  normalizeCefrLevel,
  normalizeFeedbackLanguage,
  normalizeGradingCriteria,
  normalizeKimNumber,
  normalizeWorkMode,
  resolveWriteTaskKind,
  VALID_CEFR_LEVELS,
  VALID_WORK_MODES,
} from "./validators";
import { SUBJECTS_REQUIRING_CEFR } from "../_shared/subjects.generated";

describe("isPositiveHalfStepNumber (шаг 0.5 у max_score)", () => {
  it("принимает целые и полушаги", () => {
    for (const v of [0.5, 1, 1.5, 12, 12.5, 45]) {
      expect(isPositiveHalfStepNumber(v), String(v)).toBe(true);
    }
  });

  it("отвергает нецелые шаги, ноль, отрицательные, NaN и строки", () => {
    for (const v of [0.1, 0.3, 12.7, 0, -1, -0.5, NaN, Infinity, "12.5", null, undefined]) {
      expect(isPositiveHalfStepNumber(v), String(v)).toBe(false);
    }
  });

  it("терпит floating-point junk (12.5*2 = 25.000...01 в некоторых браузерах)", () => {
    expect(isPositiveHalfStepNumber(0.1 + 0.4)).toBe(true); // 0.5 с fp-шумом
  });
});

describe("deriveTaskKind / resolveWriteTaskKind (task_kind ↔ check_format)", () => {
  it("short_answer → numeric, detailed_solution/неизвестное/null → extended", () => {
    expect(deriveTaskKind("short_answer")).toBe("numeric");
    expect(deriveTaskKind("detailed_solution")).toBe("extended");
    expect(deriveTaskKind(null)).toBe("extended");
    expect(deriveTaskKind(undefined)).toBe("extended");
    expect(deriveTaskKind("мусор")).toBe("extended");
  });

  it("speaking сохраняется ТОЛЬКО при явном clientTaskKind='speaking'", () => {
    expect(resolveWriteTaskKind("speaking", "short_answer")).toBe("speaking");
    expect(resolveWriteTaskKind("speaking", null)).toBe("speaking");
    // Любое другое клиентское значение игнорируется — истина в check_format.
    expect(resolveWriteTaskKind("numeric", "detailed_solution")).toBe("extended");
    expect(resolveWriteTaskKind("extended", "short_answer")).toBe("numeric");
    expect(resolveWriteTaskKind(undefined, "short_answer")).toBe("numeric");
    expect(resolveWriteTaskKind(42, "short_answer")).toBe("numeric");
  });
});

describe("normalizeCefrLevel + CEFR-гейт", () => {
  it("принимает A1..C1, отвергает C2/мусор/не-строки → null (= auto-detect)", () => {
    for (const lvl of VALID_CEFR_LEVELS) {
      expect(normalizeCefrLevel(lvl)).toBe(lvl);
    }
    for (const bad of ["C2", "a1", "B1 ", "", 42, null, undefined, {}]) {
      expect(normalizeCefrLevel(bad), String(bad)).toBeNull();
    }
  });

  it("канарейка CEFR-гейта: языковые предметы в реестре, родной язык — нет", () => {
    // Гейт «языковое ДЗ обязано нести CEFR» питается ЭТИМ множеством
    // (LANGUAGE_SUBJECTS_REQUIRING_CEFR = SUBJECTS_REQUIRING_CEFR).
    // Расхождение фронт/бэк блокирует создание ДЗ (AGENTS.md, реестр предметов).
    // Точный состав на 2026-08-05: расширение — только через реестр
    // (registry.ts → npm run generate:subjects), не правкой этого теста «на глаз».
    expect([...SUBJECTS_REQUIRING_CEFR].sort()).toEqual(["english", "french", "spanish"]);
    for (const native of ["russian", "literature", "physics", "chemistry"]) {
      expect(SUBJECTS_REQUIRING_CEFR.has(native), native).toBe(false);
    }
  });
});

describe("normalizeKimNumber", () => {
  it("integer 1..40 из числа или цифровой строки; остальное → null", () => {
    expect(normalizeKimNumber(1)).toBe(1);
    expect(normalizeKimNumber(40)).toBe(40);
    expect(normalizeKimNumber("27")).toBe(27);
    expect(normalizeKimNumber(" 5 ")).toBe(5);
    for (const bad of [0, 41, -3, 2.5, "3.5", "27a", "", null, undefined]) {
      expect(normalizeKimNumber(bad), String(bad)).toBeNull();
    }
  });
});

describe("normalizeWorkMode", () => {
  it("homework/independent проходят, остальное → null", () => {
    expect(VALID_WORK_MODES).toEqual(["homework", "independent"]);
    expect(normalizeWorkMode("homework")).toBe("homework");
    expect(normalizeWorkMode("independent")).toBe("independent");
    for (const bad of ["classic", "", null, 1]) {
      expect(normalizeWorkMode(bad), String(bad)).toBeNull();
    }
  });

  it("канарейка: кап переотправок самостоятельной = 10 (анти-безлимитный AI)", () => {
    expect(INDEPENDENT_MAX_ATTEMPTS).toBe(10);
  });
});

describe("normalizeFeedbackLanguage", () => {
  it("auto/russian/target проходят, остальное → null (= DB default auto)", () => {
    expect(normalizeFeedbackLanguage("auto")).toBe("auto");
    expect(normalizeFeedbackLanguage("russian")).toBe("russian");
    expect(normalizeFeedbackLanguage("target")).toBe("target");
    for (const bad of ["english", "", null, undefined]) {
      expect(normalizeFeedbackLanguage(bad), String(bad)).toBeNull();
    }
  });
});

describe("normalizeGradingCriteria", () => {
  it("пустое/не-массив → null; валидные критерии проходят с snap max к 0.5", () => {
    expect(normalizeGradingCriteria(null)).toBeNull();
    expect(normalizeGradingCriteria([])).toBeNull();
    expect(normalizeGradingCriteria("мусор")).toBeNull();

    const out = normalizeGradingCriteria([
      { label: "К1", max: 2 },
      { label: "К2", max: "1.7" }, // строка + snap → 1.5
    ]);
    expect(out).toEqual([
      { label: "К1", max: 2 },
      { label: "К2", max: 1.5 },
    ]);
  });

  it("битые записи выбрасываются, дубль label (case-insensitive) — первый побеждает", () => {
    const out = normalizeGradingCriteria([
      { label: "", max: 2 }, // пустой label
      { label: "К1", max: 0 }, // max <= 0
      { label: "К1", max: -1 },
      { max: 3 }, // без label
      { label: "К1", max: 2 },
      { label: "к1", max: 3 }, // дубль по lowercase — отбрасывается
    ]);
    expect(out).toEqual([{ label: "К1", max: 2 }]);
  });

  it("kind: только tutor_only whitelist'ится; description режется до 1000", () => {
    const out = normalizeGradingCriteria([
      { label: "Фонетика", max: 1, kind: "tutor_only", description: "x".repeat(1500) },
      { label: "К2", max: 1, kind: "хакер" },
    ]);
    expect(out?.[0].kind).toBe("tutor_only");
    expect(out?.[0].description).toHaveLength(1000);
    expect(out?.[1]).not.toHaveProperty("kind");
  });

  it("depends_on_zero: нерезолвящиеся и самоссылки выбрасываются", () => {
    const out = normalizeGradingCriteria([
      { label: "К1", max: 2 },
      { label: "К2", max: 1, depends_on_zero: ["К1", "К2", "Несуществующий"] },
      { label: "К3", max: 1, depends_on_zero: ["Только несуществующий"] },
    ]);
    expect(out?.[1].depends_on_zero).toEqual(["К1"]); // самоссылка К2 и фантом убраны
    expect(out?.[2]).not.toHaveProperty("depends_on_zero");
  });

  it("кап 30 критериев (MAX_GRADING_CRITERIA)", () => {
    const many = Array.from({ length: 35 }, (_, i) => ({ label: `К${i + 1}`, max: 1 }));
    expect(normalizeGradingCriteria(many)).toHaveLength(30);
  });
});
