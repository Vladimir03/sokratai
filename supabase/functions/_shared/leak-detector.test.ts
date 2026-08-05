import { describe, expect, it } from "vitest";
import { _internals, containsVerbatimSpan } from "./leak-detector";

/**
 * Тесты span-детектора утечки эталона (humanities, Phase 7 round 2).
 *
 * Почему тесты важны: детектор — access boundary, а не «улучшайзер». System
 * prompt «не цитируй дословно» обходится джейлбрейком (см. шапку модуля), и
 * если детектор молча перестанет ловить копипасту, ученик получит эталонное
 * DELF-письмо репетитора дословно — без единой ошибки в логах.
 *
 * Пороги здесь СВОИ, не как у sanitizeFeedback (rule 40: тот игнорирует
 * эталоны короче 2 символов): span-детектор оперирует СЛОВАМИ и требует
 * MIN_VERBATIM_SPAN_WORDS = 8 подряд — эталон короче 8 слов не ловится вовсе.
 */

// 12 слов — достаточно для окон в 8 слов.
const SOLUTION_RU = "Мама мыла раму каждое утро перед завтраком в старом доме у реки";

describe("containsVerbatimSpan — базовое поведение", () => {
  it("дословный спан из 8+ слов эталона в фидбэке → true", () => {
    const output =
      "Отличное начало! Мама мыла раму каждое утро перед завтраком в старом — это дословная цитата.";
    expect(containsVerbatimSpan(output, SOLUTION_RU)).toBe(true);
  });

  it("фидбэк без копипасты, даже с общей лексикой → false", () => {
    const output =
      "Проверь согласование подлежащего и сказуемого, а затем перечитай свой вывод ещё раз внимательно";
    expect(containsVerbatimSpan(output, SOLUTION_RU)).toBe(false);
  });

  it("регистр и пунктуация не спасают от детекта (нормализация обеих сторон)", () => {
    // Те же 8 слов, но КАПС, тире, скобки и знаки препинания.
    const output = "МАМА, мыла;— РАМУ: каждое... утро (перед) завтраком! В?";
    expect(containsVerbatimSpan(output, SOLUTION_RU)).toBe(true);
  });

  it("кириллица и латиница ловятся одинаково (мотивация детектора — French)", () => {
    const solution =
      "Je vous écris pour vous informer que je ne pourrai pas venir à la réunion de demain matin";
    const output =
      "Très bien, mais attention: «je ne pourrai pas venir à la réunion» n'est pas ta phrase";
    expect(containsVerbatimSpan(output, solution)).toBe(true);
  });
});

describe("containsVerbatimSpan — пороги (8 слов, не 2 символа)", () => {
  it("эталон короче 8 слов НЕ ловится вовсе, даже скопированный целиком", () => {
    // Контраст с sanitizeFeedback (rule 40): там порог 2 символа. Здесь — 8 слов:
    // короткие эталоны (число, краткий ответ) защищают ДРУГИЕ механизмы.
    const shortSolution = "правильный ответ сорок два";
    const output =
      "правильный ответ сорок два — именно так, и вот ещё много слов чтобы окно было длинным";
    expect(containsVerbatimSpan(output, shortSolution)).toBe(false);
  });

  it("фидбэк короче 8 слов → false (окну негде поместиться)", () => {
    const output = "Мама мыла раму каждое утро перед завтраком"; // 7 слов из эталона
    expect(containsVerbatimSpan(output, SOLUTION_RU)).toBe(false);
  });

  it("параметр minSpanWords переопределяет порог", () => {
    const solution = "сорок два метра в секунду ровно"; // 6 слов — ниже дефолтного порога
    const output = "итог таков: сорок два метра в секунду ровно, как в эталоне";
    expect(containsVerbatimSpan(output, solution)).toBe(false); // дефолт 8
    expect(containsVerbatimSpan(output, solution, null, 3)).toBe(true); // порог 3
  });
});

describe("containsVerbatimSpan — вычитание текста условия", () => {
  it("спан, целиком присутствующий в условии, — легитимная цитата → false", () => {
    // Условие дословно содержит эталон (напр. «перепишите предложение …») —
    // все спаны эталона исключаются, ловить нечего.
    const output =
      "Отличное начало! Мама мыла раму каждое утро перед завтраком в старом — так и в условии.";
    expect(containsVerbatimSpan(output, SOLUTION_RU, SOLUTION_RU)).toBe(false);
  });

  it("условие гасит только СВОИ спаны: копипаста другой части эталона ловится", () => {
    const solution = `${SOLUTION_RU} а потом читала длинную газету сидя на веранде с чаем`;
    const task = SOLUTION_RU; // условие цитирует только первую половину
    const output = "Хорошо, но вот кусок эталона: потом читала длинную газету сидя на веранде с чаем";
    expect(containsVerbatimSpan(output, solution, task)).toBe(true);
  });
});

describe("_internals — контракт нормализации", () => {
  it("порог по умолчанию — 8 слов", () => {
    expect(_internals.MIN_VERBATIM_SPAN_WORDS).toBe(8);
  });

  it("normalizeToWords: lowercase, апострофы режут слово, пусто → []", () => {
    // «l'accord» → ["l","accord"] — задокументировано в модуле как acceptable.
    expect(_internals.normalizeToWords("L'accord était signé!")).toEqual([
      "l",
      "accord",
      "était",
      "signé",
    ]);
    expect(_internals.normalizeToWords(null)).toEqual([]);
    expect(_internals.normalizeToWords("  ...  ")).toEqual([]);
  });
});
