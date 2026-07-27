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

const VECTORS = [
  null,
  undefined,
  "строка",
  42,
  [],
  {},
  { kind: "unknown" },
  { kind: "single_choice" },
  { kind: "single_choice", options: [{ key: "1", text: "один" }] }, // <2 → null
  { kind: "single_choice", options: [{ key: "1", text: "да" }, { key: "2", text: "нет" }] },
  mc(3),
  mc(12), // кап до 9
  {
    kind: "multi_choice",
    options: [
      { key: "1", text: "  с пробелами  " },
      { key: "1", text: "дубль ключа" }, // дедуп
      { key: "2", text: "x".repeat(600) }, // текст режется до 500
      { key: "", text: "пустой ключ" },
      { key: "3", text: "" },
      { key: "4", text: "ок", correct: true }, // лишнее поле — выбросить
    ],
    correct: "14", // ⚠️ anti-leak: НЕ должен доехать
    extra: { nested: true },
  },
  {
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
  },
  { kind: "matching", left: [], right: [{ key: "1", text: "раз" }, { key: "2", text: "два" }] }, // → null
];

test("mirror parity: normalizeOptionsJson идентичен на всех векторах", () => {
  for (const v of VECTORS) {
    assert.deepEqual(
      front.normalizeOptionsJson(v),
      deno.normalizeOptionsJson(v),
      `mirror drift on ${JSON.stringify(v)?.slice(0, 80)}`,
    );
  }
});

test("anti-leak: лишние поля (correct и пр.) выбрасываются целиком", () => {
  const dirty = VECTORS[12];
  const clean = front.normalizeOptionsJson(dirty);
  assert.ok(clean);
  assert.deepEqual(Object.keys(clean).sort(), ["kind", "options"]);
  for (const item of clean.options) {
    assert.deepEqual(Object.keys(item).sort(), ["key", "text"]);
  }
  assert.ok(!JSON.stringify(clean).includes("correct"));
});

test("капы: ≤9 вариантов, текст ≤500, дедуп ключей", () => {
  const capped = front.normalizeOptionsJson(mc(12));
  assert.equal(capped.options.length, 9);
  const dirty = front.normalizeOptionsJson(VECTORS[12]);
  assert.equal(dirty.options.find((o) => o.key === "2").text.length, 500);
  assert.equal(dirty.options.filter((o) => o.key === "1").length, 1);
});

test("сериализация выбора: single/multi/matching", () => {
  const single = front.normalizeOptionsJson(VECTORS[9]);
  assert.equal(front.serializeChoiceSelection(single, ["2"]), "2");
  const multi = front.normalizeOptionsJson(mc(7));
  assert.equal(front.serializeChoiceSelection(multi, ["7", "1", "2", "6"]), "1, 2, 6, 7");
  const matching = front.normalizeOptionsJson(VECTORS[13]);
  assert.equal(front.serializeChoiceSelection(matching, ["3", "1"]), "31");
});

test("compactChoiceAnswer: строка ученика → форма чекера", () => {
  assert.equal(front.compactChoiceAnswer("1, 2, 6, 7"), "1267");
  assert.equal(front.compactChoiceAnswer(" 3 "), "3");
  assert.equal(front.compactChoiceAnswer("3-5-1-4-2"), "35142");
  assert.equal(deno.compactChoiceAnswer("1; 2; 6; 7"), "1267");
});

test("renderOptionsForPrompt: все варианты в тексте промпта", () => {
  const multi = front.normalizeOptionsJson(mc(3));
  const rendered = front.renderOptionsForPrompt(multi);
  assert.ok(rendered.includes("1) вариант 1"));
  assert.ok(rendered.includes("3) вариант 3"));
  assert.equal(rendered, deno.renderOptionsForPrompt(multi));
  const matching = front.normalizeOptionsJson(VECTORS[13]);
  const m = front.renderOptionsForPrompt(matching);
  assert.ok(m.includes("А) первое"));
  assert.ok(m.includes("СООТВЕТСТВИЕ"));
});
