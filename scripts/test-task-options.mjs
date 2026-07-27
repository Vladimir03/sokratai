#!/usr/bin/env node
// options_json (2026-07-27) — структурные тестовые задачи (спека homework-choice-tasks).
//
// Гарантирует: (1) оба зеркала (frontend src/lib/taskOptions.ts и Deno
// supabase/functions/_shared/task-options.ts) идентичны на общем наборе
// векторов; (2) anti-leak: normalizeOptionsJson выбрасывает ЛЮБЫЕ лишние поля
// (включая `correct` из импорт-скрипта); (3) капы: ≤9 вариантов (посимвольные
// чекеры), текст ≤500; (4) сериализация выбора совместима с чекерами пробников.
//
// Бандлит оба TS-модуля через esbuild → data: URL → node:test
// (паттерн test-answer-alternatives.mjs).
// Run: node scripts/test-task-options.mjs

import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

async function loadModule(relPath) {
  const entry = fileURLToPath(new URL(relPath, import.meta.url));
  const bundled = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    logLevel: "silent",
  });
  const dataUrl =
    "data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64");
  return import(dataUrl);
}

const deno = await loadModule("../supabase/functions/_shared/task-options.ts");
const front = await loadModule("../src/lib/taskOptions.ts");

const mc = (n) => ({
  kind: "multi_choice",
  options: Array.from({ length: n }, (_, i) => ({ key: String(i + 1), text: `вариант ${i + 1}` })),
});

const SINGLE_OK = {
  kind: "single_choice",
  options: [{ key: "1", text: "да" }, { key: "2", text: "нет" }],
};

// Валидный вектор с ЛИШНИМИ полями: whitelist-проекция обязана их выбросить.
const DIRTY_OK = {
  kind: "multi_choice",
  options: [
    { key: "1", text: "  с пробелами  " },
    { key: "2", text: "x".repeat(600) }, // текст режется до 500
    { key: "4", text: "ок", correct: true }, // лишнее поле — выбросить
  ],
  correct: "14", // ⚠️ anti-leak: НЕ должен доехать
  extra: { nested: true },
};

const MATCHING_OK = {
  kind: "matching",
  left: [
    { key: "А", text: "первое" },
    { key: "Б", text: "второе" },
  ],
  right: [
    { key: "1", text: "раз" },
    { key: "2", text: "два" },
    { key: "3", text: "три" },
  ],
};

// Fail-closed (ревью 5.6 P1 #5): любая аномалия → null целиком, а НЕ «молча
// урезанный» список вариантов и не ключ, который чекер никогда не сматчит.
const REJECTED = [
  null,
  undefined,
  "строка",
  42,
  [],
  {},
  { kind: "unknown" },
  { kind: "single_choice" },
  { kind: "single_choice", options: [{ key: "1", text: "один" }] }, // <2
  mc(12), // сверх капа — не резать, а отвергнуть
  { kind: "multi_choice", options: [{ key: "1", text: "a" }, { key: "1", text: "дубль" }] },
  { kind: "multi_choice", options: [{ key: "", text: "пустой ключ" }, { key: "2", text: "б" }] },
  { kind: "multi_choice", options: [{ key: "1", text: "" }, { key: "2", text: "б" }] },
  { kind: "multi_choice", options: [{ key: "10", text: "два символа" }, { key: "2", text: "б" }] },
  { kind: "multi_choice", options: [{ key: "A)", text: "с пунктуацией" }, { key: "2", text: "б" }] },
  { kind: "matching", left: [], right: [{ key: "1", text: "раз" }, { key: "2", text: "два" }] },
  {
    kind: "matching",
    left: [{ key: "А", text: "первое" }],
    right: [{ key: "10", text: "правый ключ в 2 символа" }, { key: "2", text: "два" }],
  },
];

const VECTORS = [...REJECTED, SINGLE_OK, DIRTY_OK, MATCHING_OK, mc(3), mc(9)];

test("mirror parity: normalizeOptionsJson идентичен на всех векторах", () => {
  for (const v of VECTORS) {
    assert.deepEqual(
      front.normalizeOptionsJson(v),
      deno.normalizeOptionsJson(v),
      `mirror drift on ${JSON.stringify(v)?.slice(0, 80)}`,
    );
  }
});

test("fail-closed: битая структура/ключ → null (текстовый ввод), не урезанный список", () => {
  for (const v of REJECTED) {
    assert.equal(
      front.normalizeOptionsJson(v),
      null,
      `должно отвергаться: ${JSON.stringify(v)?.slice(0, 80)}`,
    );
  }
});

test("anti-leak: лишние поля (correct и пр.) выбрасываются целиком", () => {
  const clean = front.normalizeOptionsJson(DIRTY_OK);
  assert.ok(clean);
  assert.deepEqual(Object.keys(clean).sort(), ["kind", "options"]);
  for (const item of clean.options) {
    assert.deepEqual(Object.keys(item).sort(), ["key", "text"]);
  }
  assert.ok(!JSON.stringify(clean).includes("correct"));
});

test("капы: ровно 9 вариантов проходят, текст режется до 500", () => {
  assert.equal(front.normalizeOptionsJson(mc(9)).options.length, 9);
  const dirty = front.normalizeOptionsJson(DIRTY_OK);
  assert.equal(dirty.options.find((o) => o.key === "2").text.length, 500);
  assert.equal(dirty.options.find((o) => o.key === "1").text, "с пробелами");
});

test("сериализация выбора: single/multi/matching", () => {
  const single = front.normalizeOptionsJson(SINGLE_OK);
  assert.equal(front.serializeChoiceSelection(single, ["2"]), "2");
  const multi = front.normalizeOptionsJson(mc(7));
  assert.equal(front.serializeChoiceSelection(multi, ["7", "1", "2", "6"]), "1, 2, 6, 7");
  const matching = front.normalizeOptionsJson(MATCHING_OK);
  assert.equal(front.serializeChoiceSelection(matching, ["3", "1"]), "31");
});

test("compactChoiceAnswer: строка ученика → форма чекера", () => {
  assert.equal(front.compactChoiceAnswer("1, 2, 6, 7"), "1267");
  assert.equal(front.compactChoiceAnswer(" 3 "), "3");
  assert.equal(front.compactChoiceAnswer("3-5-1-4-2"), "35142");
  assert.equal(deno.compactChoiceAnswer("1; 2; 6; 7"), "1267");
});

test("anti-leak фидбэка: ключ верного варианта / цитата его текста ловятся", () => {
  const single = front.normalizeOptionsJson({
    kind: "single_choice",
    options: [
      { key: "1", text: "давление растёт при нагревании" },
      { key: "2", text: "объём уменьшается вдвое" },
      { key: "3", text: "температура остаётся постоянной" },
    ],
  });
  const leaks = (t) => front.feedbackLeaksCorrectChoice(t, single, "3");

  assert.equal(leaks("Посмотри на вариант 3 ещё раз"), true, "голый ключ");
  assert.equal(leaks("(3)"), true, "ключ в скобках");
  assert.equal(leaks("Верно, что температура остаётся постоянной"), true, "цитата варианта");
  assert.equal(leaks("Ты выбрал процесс с нагреванием — проверь условие"), false, "чистый текст");
  assert.equal(leaks("Событие 1861 года тут ни при чём"), false, "цифра внутри числа");
  // Зеркала обязаны совпадать и здесь.
  for (const t of ["вариант 3", "1861", "температура остаётся постоянной", ""]) {
    assert.equal(
      front.feedbackLeaksCorrectChoice(t, single, "3"),
      deno.feedbackLeaksCorrectChoice(t, single, "3"),
      `mirror drift on feedback ${JSON.stringify(t)}`,
    );
  }

  const matching = front.normalizeOptionsJson(MATCHING_OK);
  assert.equal(
    front.feedbackLeaksCorrectChoice("А соответствует 3, проверь Б", matching, "31"),
    true,
    "matching: правый ключ раскрывает часть соответствия",
  );
  assert.equal(
    front.feedbackLeaksCorrectChoice("Проверь позицию Б ещё раз", matching, "31"),
    false,
    "matching: левая метка утечкой не является",
  );
});

test("renderOptionsForPrompt: все варианты в тексте промпта", () => {
  const multi = front.normalizeOptionsJson(mc(3));
  const rendered = front.renderOptionsForPrompt(multi);
  assert.ok(rendered.includes("1) вариант 1"));
  assert.ok(rendered.includes("3) вариант 3"));
  assert.equal(rendered, deno.renderOptionsForPrompt(multi));
  const matching = front.normalizeOptionsJson(MATCHING_OK);
  const m = front.renderOptionsForPrompt(matching);
  assert.ok(m.includes("А) первое"));
  assert.ok(m.includes("СООТВЕТСТВИЕ"));
});
