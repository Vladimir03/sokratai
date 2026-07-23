#!/usr/bin/env node
// Mock Exams — parity-тест набора check_mode по всем поверхностям (ревью 5.6 A4).
//
// Проблема: добавление режима проверки требует синхронной правки 7 мест
// (2 зеркала чекера, 2 клиентских типа, OCR-хелпер, валидатор tutor-api,
// опции редактора + CHECK-миграция). Пропуск любого — тихая деградация
// (инцидент: ordered_lenient без OCR-хинта → «формат не определён»).
//
// Source of truth — реестр MOCK_EXAM_CHECK_MODES в src/lib/mockExamPart1Checker.ts.
// Runtime-значения обоих зеркал сверяются честным импортом (esbuild); поверхности,
// где набор существует только в исходнике (OCR union, Set валидатора, опции
// редактора), — извлечением из исходника.
//
// Run: node scripts/test-mockexam-checkmode-parity.mjs (или npm test — секция 15)

import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { transformSync } from "esbuild";

async function importTs(relPath) {
  const source = readFileSync(new URL(`../${relPath}`, import.meta.url), "utf8");
  const compiled = transformSync(source, { loader: "ts", format: "esm" }).code;
  return import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));
}

function readSource(relPath) {
  return readFileSync(new URL(`../${relPath}`, import.meta.url), "utf8");
}

/** Все строковые литералы в куске исходника (оба стиля кавычек). */
function quotedStrings(chunk) {
  return [...chunk.matchAll(/["']([a-z0-9_]+)["']/g)].map((m) => m[1]);
}

const fe = await importTs("src/lib/mockExamPart1Checker.ts");
const deno = await importTs("supabase/functions/_shared/mock-exam-part1-checker.ts");

const MODES = fe.MOCK_EXAM_CHECK_MODES;
const NON_MANUAL = MODES.filter((m) => m !== "manual");

test("реестр существует и непуст", () => {
  assert.ok(Array.isArray(MODES) && MODES.length >= 8, "MOCK_EXAM_CHECK_MODES пуст");
  assert.ok(MODES.includes("manual"), "manual обязан быть в реестре");
});

test("Deno-зеркало: CHECK_MODES идентичен реестру (порядок включительно)", () => {
  assert.deepEqual([...deno.CHECK_MODES], [...MODES]);
});

test("OCR-хелпер: union Part1OCRTaskMeta.check_mode = реестр", () => {
  const src = readSource("supabase/functions/_shared/mock-exam-part1-ocr.ts");
  // Якорим на interface-блок (упоминания check_mode в комментариях не считаются).
  const ifaceMatch = src.match(/interface Part1OCRTaskMeta \{([\s\S]*?)\n\}/);
  assert.ok(ifaceMatch, "не найден interface Part1OCRTaskMeta");
  const unionMatch = ifaceMatch[1].match(/check_mode:\s*([\s\S]*?);/);
  assert.ok(unionMatch, "не найден union check_mode в Part1OCRTaskMeta");
  assert.deepEqual(new Set(quotedStrings(unionMatch[1])), new Set(MODES));
});

test("OCR-хелпер: формат-хинт для каждого не-manual режима в ОБОИХ промптах", () => {
  const src = readSource("supabase/functions/_shared/mock-exam-part1-ocr.ts");
  for (const mode of NON_MANUAL) {
    const hits = src.split(`case "${mode}"`).length - 1;
    assert.ok(
      hits >= 2,
      `режим "${mode}" покрыт case-хинтом ${hits}/2 промптов (blank + freeform) — добавь в оба switch`,
    );
  }
});

test("tutor-api: VALID_PART1_CHECK_MODES = реестр минус manual", () => {
  const src = readSource("supabase/functions/mock-exam-tutor-api/index.ts");
  const setMatch = src.match(/VALID_PART1_CHECK_MODES\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(setMatch, "не найден VALID_PART1_CHECK_MODES");
  assert.deepEqual(new Set(quotedStrings(setMatch[1])), new Set(NON_MANUAL));
});

test("редактор варианта: CHECK_MODE_OPTIONS = реестр минус manual", () => {
  const src = readSource("src/pages/tutor/mock-exams/TutorMockExamVariantEditor.tsx");
  const blockMatch = src.match(/CHECK_MODE_OPTIONS[\s\S]*?=\s*\[([\s\S]*?)\];/);
  assert.ok(blockMatch, "не найден CHECK_MODE_OPTIONS");
  const values = [...blockMatch[1].matchAll(/value:\s*'([a-z0-9_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(new Set(values), new Set(NON_MANUAL));
});

test("клиентские типы derived, а не дубль-union", () => {
  // types/mockExam.ts обязан ре-экспортировать тип из checker'а; mockExamApi —
  // выводить через Exclude. Локальный union-дубль = риск рассинхрона.
  const typesSrc = readSource("src/types/mockExam.ts");
  assert.ok(
    /export type \{ MockExamCheckMode \} from '@\/lib\/mockExamPart1Checker'/.test(typesSrc),
    "types/mockExam.ts обязан ре-экспортировать MockExamCheckMode из checker'а",
  );
  const apiSrc = readSource("src/lib/mockExamApi.ts");
  assert.ok(
    /MockExamPart1CheckMode\s*=\s*Exclude<MockExamCheckMode,\s*'manual'>/.test(apiSrc),
    "mockExamApi.ts обязан выводить MockExamPart1CheckMode через Exclude",
  );
});

test("оба зеркала грейдят одинаково на канареечных векторах каждого режима", () => {
  // Runtime-канарейка поверх набора: по одному вектору на режим (полный балл),
  // сверка frontend ↔ Deno (полные векторы — в test-mockexam-checker.mjs).
  const vectors = {
    strict: ["5.6", "5,6"],
    ordered: ["123", "123"],
    ordered_lenient: ["22211", "222111"],
    unordered: ["1,3,2", "2,3,1"],
    multi_choice: ["13", "31"],
    task20: ["13", "31"],
    pair: ["12.5 м/с", "12,5 м/с"],
    manual: ["x", "x"],
  };
  for (const mode of MODES) {
    const [correct, student] = vectors[mode];
    const feRes = fe.checkPart1Answer({ correctAnswer: correct, studentAnswer: student, checkMode: mode, maxScore: 2 });
    const dnRes = deno.checkPart1(correct, student, mode, 2);
    assert.equal(feRes.earnedScore, dnRes.earned, `режим ${mode}: earned разошёлся между зеркалами`);
    assert.equal(feRes.isCorrect, dnRes.correct, `режим ${mode}: correct разошёлся между зеркалами`);
  }
});
