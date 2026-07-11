#!/usr/bin/env node
// #61 (2026-07-11) — несколько допустимых верных ответов + числовой диапазон.
//
// Гарантирует: (1) оба зеркала парсера (frontend src/lib/answerAlternatives.ts
// и Deno supabase/functions/_shared/answer-alternatives.ts) дают ИДЕНТИЧНЫЙ
// результат на общем наборе векторов — дрейф зеркал ловится до мержа;
// (2) семантика: одиночные ответы (включая «-5», даты «1941-1945») НЕ
// трактуются как диапазон/альтернативы; «;» делит варианты; en-dash/../
// дефис-с-пробелами дают диапазон; запятая/точка десятичные равнозначны.
//
// Бандлит оба TS-модуля через esbuild → data: URL → node:test
// (паттерн test-physics-flowcharts.mjs).
// Run: node scripts/test-answer-alternatives.mjs

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

const deno = await loadModule("../supabase/functions/_shared/answer-alternatives.ts");
const front = await loadModule("../src/lib/answerAlternatives.ts");

// ─── Общие векторы: зеркала обязаны совпадать ────────────────────────────────
const VECTORS = [
  null,
  "",
  "   ",
  "42",
  "-5",
  "2,5",
  "2.5 м/с",
  "1941-1945",          // компактный дефис = литерал (даты), НЕ диапазон
  "-5-3",               // компактный дефис = литерал, НЕ диапазон
  "x=1; y=2",           // РЕГРЕСС (ChatGPT-5.6 P1): составной ответ через «;» — НЕ альтернативы
  "1248 или 1250",      // альтернативы через « или »
  "да или нет",         // текстовые альтернативы
  "2,1–2,3",            // en-dash диапазон
  "2.1..2.3",           // .. диапазон
  "2,1 - 2,3",          // дефис С пробелами = диапазон
  "5–3",                // min ≥ max → деградация в exact
  "а–б",                // не числа → exact
  "2,1–2,3 или 4",      // диапазон + альтернатива
  " или ",              // одинокое «или» после trim → безопасный exact (mirror-parity)
];

test("mirror parity: parseAnswerSpec идентичен на всех векторах", () => {
  for (const v of VECTORS) {
    assert.deepEqual(
      front.parseAnswerSpec(v),
      deno.parseAnswerSpec(v),
      `mirror drift on ${JSON.stringify(v)}`,
    );
  }
});

test("mirror parity: describeAnswerSpecForPrompt идентичен", () => {
  for (const v of VECTORS) {
    assert.equal(
      front.describeAnswerSpecForPrompt(front.parseAnswerSpec(v)),
      deno.describeAnswerSpecForPrompt(deno.parseAnswerSpec(v)),
      `mirror drift on ${JSON.stringify(v)}`,
    );
  }
});

// ─── Семантика (на Deno-зеркале — оно кормит грейдинг) ──────────────────────
const parse = deno.parseAnswerSpec;

test("одиночный ответ — не multi, exact byte-identical", () => {
  const spec = parse("42");
  assert.equal(spec.isMulti, false);
  assert.deepEqual(spec.alternatives, [{ type: "exact", value: "42" }]);
});

test("пусто/null → null; одинокое «или» после trim → безопасный exact (не крэш)", () => {
  assert.equal(parse(null), null);
  assert.equal(parse(""), null);
  assert.equal(parse("   "), null);
  // trim() снимает внешние пробелы → «или» без окружения не разделитель:
  // консервативно один exact, не multi (не ложные пустые альтернативы).
  const lone = parse(" или ");
  assert.equal(lone.isMulti, false);
});

test("РЕГРЕСС (ChatGPT-5.6 P1): «;» больше НЕ разделитель — составной ответ = один exact", () => {
  // Легаси `x=1; y=2` («нужны оба») НЕ должен распадаться на альтернативы,
  // иначе ученик «x=1» получил бы полный балл. Разделитель теперь « или ».
  const spec = parse("x=1; y=2");
  assert.equal(spec.isMulti, false);
  assert.deepEqual(spec.alternatives, [{ type: "exact", value: "x=1; y=2" }]);
  // И промпту не инжектируется ложный список вариантов.
  assert.equal(deno.describeAnswerSpecForPrompt(spec), null);
});

test("отрицательное число — НЕ диапазон", () => {
  const spec = parse("-5");
  assert.equal(spec.isMulti, false);
  assert.deepEqual(spec.alternatives[0], { type: "exact", value: "-5" });
});

test("даты с компактным дефисом — НЕ диапазон (анти-false-positive)", () => {
  const spec = parse("1941-1945");
  assert.equal(spec.isMulti, false);
  assert.equal(spec.alternatives[0].type, "exact");
});

test("альтернативы через « или »", () => {
  const spec = parse("1248 или 1250");
  assert.equal(spec.isMulti, true);
  assert.deepEqual(spec.alternatives, [
    { type: "exact", value: "1248" },
    { type: "exact", value: "1250" },
  ]);
  // Регистр «или» не важен.
  assert.equal(parse("1248 ИЛИ 1250").isMulti, true);
});

test("en-dash диапазон с запятой-десятичной", () => {
  const spec = parse("2,1–2,3");
  assert.equal(spec.isMulti, true);
  assert.deepEqual(spec.alternatives[0], { type: "range", min: 2.1, max: 2.3, label: "2,1–2,3" });
});

test("«..» и дефис-с-пробелами — тоже диапазон", () => {
  assert.equal(parse("2.1..2.3").alternatives[0].type, "range");
  assert.equal(parse("2,1 - 2,3").alternatives[0].type, "range");
});

test("вырожденный диапазон (min ≥ max) деградирует в exact", () => {
  assert.equal(parse("5–3").alternatives[0].type, "exact");
  assert.equal(parse("2–2").alternatives[0].type, "exact");
});

test("диапазон + альтернатива комбинируются", () => {
  const spec = parse("2,1–2,3 или 4");
  assert.equal(spec.isMulti, true);
  assert.equal(spec.alternatives.length, 2);
  assert.equal(spec.alternatives[0].type, "range");
  assert.deepEqual(spec.alternatives[1], { type: "exact", value: "4" });
});

test("describeAnswerSpecForPrompt: null для single, текст для multi", () => {
  assert.equal(deno.describeAnswerSpecForPrompt(parse("42")), null);
  const text = deno.describeAnswerSpecForPrompt(parse("2,1–2,3 или 4"));
  assert.ok(text.includes("от 2,1 до 2,3"));
  assert.ok(text.includes("«4»"));
});

test("parseAnswerNumber: запятая/точка/знак/мусор", () => {
  assert.equal(deno.parseAnswerNumber("2,5"), 2.5);
  assert.equal(deno.parseAnswerNumber(" 2.5 "), 2.5);
  assert.equal(deno.parseAnswerNumber("-3"), -3);
  assert.equal(deno.parseAnswerNumber("abc"), null);
  assert.equal(deno.parseAnswerNumber("2,1–2,3"), null);
});

test("frontend serializeAnswerParts: join через « или » + отбрасывание пустых", () => {
  assert.equal(front.serializeAnswerParts(["1248", "", " 1250 "]), "1248 или 1250");
  assert.equal(front.serializeAnswerParts([""]), "");
  // Round-trip: сериализованное значение парсится обратно в 2 альтернативы.
  assert.equal(front.parseAnswerSpec(front.serializeAnswerParts(["1248", "1250"])).alternatives.length, 2);
});
