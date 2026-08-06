import { describe, expect, it } from "vitest";

import { extractJsonObject } from "./ai-lovable.ts";
import { classifyAiGatewayError } from "./ai-gateway-errors.ts";

/**
 * Разбор ответа модели в JSON-объект + классификация отказа.
 *
 * Повод: за неделю 9 из 13 отказов шлюза — `invalid_json` у `kb-ai-extract`,
 * при выводе 348–510 токенов (обрезка по капу 16 000 исключена данными: максимум
 * за 30 дней — 12 224). Самая вероятная причина — массив верхнего уровня вместо
 * объекта-обёртки; она же и самая незаметная, потому что `JSON.parse` такой
 * ответ принимает.
 */
describe("extractJsonObject", () => {
  it("берёт обычный объект", () => {
    expect(extractJsonObject('{"tasks":[1,2]}')).toEqual({ tasks: [1, 2] });
  });

  it("берёт объект из markdown-забора", () => {
    expect(extractJsonObject('```json\n{"tasks":[1]}\n```')).toEqual({ tasks: [1] });
  });

  it("БЕЗ arrayKey массив верхнего уровня отвергается (прежнее поведение)", () => {
    expect(() => extractJsonObject('[{"a":1},{"b":2}]')).toThrow(/shape: array/);
  });

  it("С arrayKey массив верхнего уровня оборачивается", () => {
    expect(extractJsonObject('[{"a":1},{"b":2}]', "tasks")).toEqual({
      tasks: [{ a: 1 }, { b: 2 }],
    });
  });

  it("С arrayKey массив в markdown-заборе тоже оборачивается", () => {
    expect(extractJsonObject('```json\n[{"a":1}]\n```', "tasks")).toEqual({ tasks: [{ a: 1 }] });
  });

  it("arrayKey НЕ перехватывает валидный объект", () => {
    expect(extractJsonObject('{"tasks":[1],"stats":{}}', "tasks")).toEqual({
      tasks: [1],
      stats: {},
    });
  });

  it("brace-слайс спасает объект в обёртке из текста", () => {
    expect(extractJsonObject('Вот результат: {"tasks":[1]} — готово')).toEqual({ tasks: [1] });
  });

  it("одноэлементный массив: brace-слайс мангл vs корректная обёртка", () => {
    // ПРЕ-СУЩЕСТВУЮЩЕЕ поведение: слайс от первой `{` до последней `}` молча
    // разворачивает `[{…}]` в голый объект — у загрузчика это давало не
    // `invalid_json`, а `schema_invalid` (нет ключа `tasks`), т.е. тот же
    // потерянный вызов под другим именем.
    expect(extractJsonObject('[{"a":1}]')).toEqual({ a: 1 });
    // С arrayKey форма восстанавливается правильно.
    expect(extractJsonObject('[{"a":1}]', "tasks")).toEqual({ tasks: [{ a: 1 }] });
  });

  it("в текст ошибки НЕ попадает содержимое ответа модели", () => {
    const secret = '[{"solution_text":"эталон решения задачи"},{"b":2}]';
    try {
      extractJsonObject(secret);
      throw new Error("должно было бросить");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain("эталон");
      expect(msg).not.toContain("solution_text");
      expect(msg).toContain("shape: array");
    }
  });

  describe("структурный класс отказа", () => {
    // Только входы, которые ДОХОДЯТ до броска: одноэлементные массивы и
    // `[{…}` перехватывает brace-слайс выше (см. тест про мангл).
    const cases: Array<[string, string]> = [
      ['[{"a":1},{"b":2}]', "array"],
      ['{"a":1', "truncated"],
      ["Извините, я не могу", "prose"],
      ['"просто строка"', "scalar"],
      ["42", "scalar"],
      ['{"a":1,}', "malformed"],
    ];
    for (const [raw, shape] of cases) {
      it(`${shape}: ${raw.slice(0, 18)}`, () => {
        expect(() => extractJsonObject(raw)).toThrow(new RegExp(`shape: ${shape}`));
      });
    }
  });
});

describe("classifyAiGatewayError", () => {
  it("уточняет форму, когда её прислал callLovableJson", () => {
    const err = new Error("Failed to extract valid JSON object from model response (shape: array)");
    expect(classifyAiGatewayError(err).code).toBe("invalid_json_array");
  });

  it("копии вызова без формы дают общий invalid_json, а не падение", () => {
    const err = new Error("Failed to extract valid JSON object from model response");
    expect(classifyAiGatewayError(err).code).toBe("invalid_json");
  });

  it("незнакомая форма не выдумывает код", () => {
    const err = new Error("Failed to extract valid JSON ... (shape: something_new)");
    expect(classifyAiGatewayError(err).code).toBe("invalid_json");
  });

  it("не путает с другими классами отказа", () => {
    expect(classifyAiGatewayError({ status: 429 })).toEqual({ code: "http", httpStatus: 429 });
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(classifyAiGatewayError(abort).code).toBe("timeout");
    expect(classifyAiGatewayError(new Error("Model response is empty")).code).toBe("empty_response");
  });
});
