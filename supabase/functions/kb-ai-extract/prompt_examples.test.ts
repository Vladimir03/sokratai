import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Гард на few-shot примеры трёх промптов загрузчика (физика / обществознание /
 * generic). Читаем исходник как текст: `index.ts` не импортируется в vitest
 * (top-level `Deno.serve`), а сами промпты — не экспортируемые константы.
 *
 * ЗАЧЕМ. Few-shot определяет формат вывода сильнее словесных правил, и две
 * ошибки в нём стоят дорого:
 *
 *  1. **Пропавший `answer_confidence`.** `normalizeTask` при отсутствии поля
 *     ставит `"low"`, а `low` ОБНУЛЯЕТ ответ (анти-галлюцинация). То есть
 *     потерянное в примере поле = молча стёртые ответы у всех загруженных
 *     задач, без единой ошибки в логах.
 *  2. **Вернувшийся `image_action`.** Нормализатор ставит его константой и
 *     НИКОГДА не читает из ответа модели — просить его у модели значит платить
 *     за токены впустую в каждой задаче.
 *
 * Плюс проверяем, что примеры остаются валидным JSON: битый пример учит модель
 * возвращать битый JSON, а это ровно тот `invalid_json`, из-за которого
 * терялись вызовы.
 */

const SOURCE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "index.ts"),
  "utf8",
);

/** Строки-примеры: идут сразу после маркера `Выход:` в каждом промпте. */
function extractExamples(): string[] {
  const out: string[] = [];
  const lines = SOURCE.split("\n");
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].trim() !== "Выход:") continue;
    // Пример — одна строка; в конце последнего висит закрывающий бэктик шаблона.
    out.push(lines[i + 1].replace(/`;\s*$/, "").trim());
  }
  return out;
}

const examples = extractExamples();

describe("few-shot примеры kb-ai-extract", () => {
  it("найдены все три (физика, обществознание, generic)", () => {
    expect(examples).toHaveLength(3);
  });

  for (const [i, raw] of examples.entries()) {
    describe(`пример #${i + 1}`, () => {
      // String.raw хранит LaTeX как `\\ `, то есть в самом файле лежит
      // JSON-escape — для JSON.parse это корректная строка как есть.
      const parsed = JSON.parse(raw) as {
        tasks: Array<Record<string, unknown>>;
        stats?: Record<string, unknown>;
      };

      it("валидный JSON-объект с непустым tasks", () => {
        expect(Array.isArray(parsed.tasks)).toBe(true);
        expect(parsed.tasks.length).toBeGreaterThan(0);
      });

      it("в КАЖДОЙ задаче есть answer_confidence (иначе ответы стираются)", () => {
        for (const task of parsed.tasks) {
          expect(Object.keys(task)).toContain("answer_confidence");
          expect(["high", "medium", "low"]).toContain(task.answer_confidence);
        }
      });

      it("в КАЖДОЙ задаче есть text", () => {
        for (const task of parsed.tasks) {
          expect(typeof task.text).toBe("string");
          expect((task.text as string).length).toBeGreaterThan(0);
        }
      });

      it("не просит у модели image_action (константа нормализатора)", () => {
        for (const task of parsed.tasks) {
          expect(Object.keys(task)).not.toContain("image_action");
        }
      });

      it("демонстрирует экономию: null и пустые массивы опущены", () => {
        for (const task of parsed.tasks) {
          for (const [key, value] of Object.entries(task)) {
            expect(value, `${key} = null должен быть опущен`).not.toBeNull();
            if (Array.isArray(value)) {
              expect(value.length, `${key} = [] должен быть опущен`).toBeGreaterThan(0);
            }
          }
        }
      });
    });
  }

  it("схема больше не объявляет image_action", () => {
    expect(SOURCE).not.toContain('"image_action": "attach_original",');
  });

  it("правило экономии присутствует во всех трёх схемах", () => {
    const hits = SOURCE.split("ЭКОНОМИЯ ВЫВОДА").length - 1;
    expect(hits).toBe(3);
  });

  it("нормализатор по-прежнему подставляет image_action сам", () => {
    expect(SOURCE).toContain('image_action: "attach_original"');
  });
});
