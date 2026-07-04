#!/usr/bin/env node
// strict-criteria-grading Phase 3 — детерминированный обходчик блок-схем ФИПИ
// физики Часть 2 (№ 21-26). Схемы подтверждены Егором (2026-06-30).
//
// Гарантирует: балл считается КОДОМ по блок-схеме ФИПИ (не моделью). Ловит
// регрессию развязки узлов. Ключевой кейс — адиабата: верный ответ, но потеряна
// Δ в преобразованиях → 2 из 3 (не 3), т.е. движок ловит то, что холистическая
// проверка пропускает.
//
// Бандлит `_shared/physics-flowcharts.ts` через esbuild → data: URL → node:test.
// Run: node scripts/test-physics-flowcharts.mjs

import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const entry = fileURLToPath(
  new URL("../supabase/functions/_shared/physics-flowcharts.ts", import.meta.url),
);
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
const { walkPhysicsFlowchart, physicsFlowchartKind } = await import(dataUrl);

const score = (kim, j) => walkPhysicsFlowchart(kim, j).score;

// ─── № КИМ → тип схемы ───────────────────────────────────────────────────────
test("physicsFlowchartKind mapping", () => {
  assert.equal(physicsFlowchartKind(21), "qualitative21");
  assert.equal(physicsFlowchartKind(22), "calc22_23");
  assert.equal(physicsFlowchartKind(23), "calc22_23");
  assert.equal(physicsFlowchartKind(24), "calc24_25");
  assert.equal(physicsFlowchartKind(25), "calc24_25");
  assert.equal(physicsFlowchartKind(26), "calc26");
  assert.equal(physicsFlowchartKind(5), null); // Часть 1
  assert.equal(physicsFlowchartKind(null), null);
  assert.equal(walkPhysicsFlowchart(5, {}), null);
});

// ─── № 21 качественная (макс 3) ──────────────────────────────────────────────
const q21 = (o) => ({
  correct_answer: true, full_explanation: true, has_errors: false, missing_laws: 0, correct_reasoning: false, ...o,
});
test("№21: верный ответ + полное объяснение + без ошибок → 3", () => {
  assert.equal(score(21, q21()), 3);
});
test("№21: верный ответ + полное объяснение + есть ошибки → 2", () => {
  assert.equal(score(21, q21({ has_errors: true })), 2);
});
test("№21: верный ответ + не полное, не хватает 1 закона → 2", () => {
  assert.equal(score(21, q21({ full_explanation: false, missing_laws: 1 })), 2);
});
test("№21: верный ответ + не хватает 2+ законов → 1", () => {
  assert.equal(score(21, q21({ full_explanation: false, missing_laws: 2 })), 1);
});
test("№21: неверный ответ, но верные рассуждения → 1", () => {
  assert.equal(score(21, q21({ correct_answer: false, correct_reasoning: true })), 1);
});
test("№21: неверный ответ + неверные рассуждения → 0", () => {
  assert.equal(score(21, q21({ correct_answer: false, correct_reasoning: false })), 0);
});

// ─── № 22-23 расчётная (макс 2) ──────────────────────────────────────────────
const c2223 = (o) => ({
  all_formulas: true, answer_dimension_correct: true, notation_transforms_calc_correct: true,
  extra_records: false, transforms_correct: true, ...o,
});
test("№22-23: всё верно, без лишних записей → 2", () => {
  assert.equal(score(22, c2223()), 2);
});
test("№22-23: всё верно, но лишние записи → 1", () => {
  assert.equal(score(22, c2223({ extra_records: true })), 1);
});
test("№22-23: ответ верен, но ошибка в обозначениях/преобразованиях → 1", () => {
  assert.equal(score(23, c2223({ notation_transforms_calc_correct: false })), 1);
});
test("№22-23: ответ/размерность неверны, но преобразования верны → 1", () => {
  assert.equal(score(22, c2223({ answer_dimension_correct: false, transforms_correct: true })), 1);
});
test("№22-23: ответ неверен + преобразования неверны → 0", () => {
  assert.equal(score(22, c2223({ answer_dimension_correct: false, transforms_correct: false })), 0);
});
test("№22-23: не все формулы → 0", () => {
  assert.equal(score(22, c2223({ all_formulas: false })), 0);
});

// ─── № 24-25 расчётная (макс 3) ──────────────────────────────────────────────
const c2425 = (o) => ({
  all_formulas: true, general_formula_dim_answer_correct: true, notation_transforms_calc_correct: true,
  transforms_correct: true, only_one_formula_wrong_or_missing: false, ...o,
});
test("№24-25: всё верно → 3", () => {
  assert.equal(score(24, c2425()), 3);
});
test("№24-25: общая формула/ответ верны, недочёт в обозначениях/преобразованиях → 2", () => {
  assert.equal(score(24, c2425({ notation_transforms_calc_correct: false })), 2);
});
test("№24-25: общая формула/ответ неверны, но преобразования верны → 2", () => {
  assert.equal(score(25, c2425({ general_formula_dim_answer_correct: false, transforms_correct: true })), 2);
});
test("№24-25: общая формула неверна + преобразования неверны → 1", () => {
  assert.equal(score(24, c2425({ general_formula_dim_answer_correct: false, transforms_correct: false })), 1);
});
test("№24-25: одна формула с ошибкой/нет, преобразования верны → 1", () => {
  assert.equal(score(24, c2425({ all_formulas: false, only_one_formula_wrong_or_missing: true, transforms_correct: true })), 1);
});
test("№24-25: одна формула с ошибкой/нет, преобразования неверны → 0", () => {
  assert.equal(score(24, c2425({ all_formulas: false, only_one_formula_wrong_or_missing: true, transforms_correct: false })), 0);
});
test("№24-25: нет 2+ формул → 0", () => {
  assert.equal(score(24, c2425({ all_formulas: false, only_one_formula_wrong_or_missing: false })), 0);
});

// ─── КЛЮЧЕВОЙ КЕЙС: адиабата (потеряна Δ) ────────────────────────────────────
// Ученик: ответ 3,7 кДж верен, но написал ΔU=3/2·pV вместо 3/2·Δ(pV) → ошибка
// записи преобразования (III элемент). Холистика похвалила бы (ответ верный);
// блок-схема снимает балл: № 24-25, общая формула/ответ верны, но
// обозначения/преобразования НЕ верны → 2 из 3.
test("адиабата: верный ответ, но потеряна Δ в преобразованиях → 2 из 3 (не 3)", () => {
  const r = walkPhysicsFlowchart(24, c2425({ notation_transforms_calc_correct: false }));
  assert.equal(r.score, 2);
  assert.equal(r.maxScore, 3);
  // трасса содержит узел «Обозначения, преобразования, вычисления» с вердиктом no
  assert.ok(r.trace.some((s) => s.node.includes("реобразовани") && s.verdict === "no"));
});

// ─── № 26 = обоснование (0/+1) + расчёт (как № 24-25) ────────────────────────
const c26 = (o) => ({ ...c2425(), justification_complete: true, ...o });
test("№26: полное обоснование + расчёт 3 → 4", () => {
  assert.equal(score(26, c26()), 4);
});
test("№26: НЕТ обоснования + расчёт 3 → 3", () => {
  assert.equal(score(26, c26({ justification_complete: false })), 3);
});
test("№26: полное обоснование + расчёт 2 (недочёт преобразований) → 3", () => {
  assert.equal(score(26, c26({ notation_transforms_calc_correct: false })), 3);
});
test("№26: НЕТ обоснования + расчёт 0 (нет формул) → 0", () => {
  assert.equal(score(26, c26({ justification_complete: false, all_formulas: false, only_one_formula_wrong_or_missing: false })), 0);
});
test("№26: maxScore = 4", () => {
  assert.equal(walkPhysicsFlowchart(26, c26()).maxScore, 4);
});

// ─── Трасса: положительная полярность узлов (Phase C UI) ──────────────────────
// Все узлы сформулированы как «критерий выполнен?» → yes=✓, partial=⚠, no=✗.
// Регрессия-гард: ни один узел не должен иметь yes = «плохо» (иначе зелёная
// галочка в UI-трассе вводит в заблуждение — напр. старое «Лишние записи: yes»).
const trace = (kim, j) => walkPhysicsFlowchart(kim, j).trace;

test("трасса: полный балл → ВСЕ узлы yes (№21/22-23/24-25/26)", () => {
  for (const [kim, j] of [[21, q21()], [22, c2223()], [24, c2425()], [26, c26()]]) {
    const t = trace(kim, j);
    assert.ok(t.length > 0, `${kim}: пустая трасса`);
    assert.ok(t.every((s) => s.verdict === "yes"), `${kim}: ${JSON.stringify(t)}`);
  }
});

test("трасса: №22-23 лишние записи → «Нет лишних записей» = no (а не yes=плохо)", () => {
  const node = trace(22, c2223({ extra_records: true })).find((s) => s.node.includes("лишних записей"));
  assert.ok(node);
  assert.equal(node.verdict, "no");
});

test("трасса: №21 есть ошибки → «Объяснение без ошибок» = no", () => {
  const node = trace(21, q21({ has_errors: true })).find((s) => s.node.includes("без ошибок"));
  assert.ok(node);
  assert.equal(node.verdict, "no");
});

test("трасса: №21 не хватает 1 закона → «Все необходимые законы/явления приведены» = partial", () => {
  const node = trace(21, q21({ full_explanation: false, missing_laws: 1 })).find((s) => s.node.includes("законы/явления приведены"));
  assert.ok(node);
  assert.equal(node.verdict, "partial");
});

test("трасса: №24-25 одна ошибка в формулах → узел = partial (не yes)", () => {
  const node = trace(24, c2425({ all_formulas: false, only_one_formula_wrong_or_missing: true, transforms_correct: true }))
    .find((s) => s.node.includes("одной ошибки в формулах"));
  assert.ok(node);
  assert.equal(node.verdict, "partial");
});

test("трасса: любой узел любого исхода имеет verdict ∈ {yes, partial, no}", () => {
  const cases = [
    [21, q21()], [21, q21({ has_errors: true })], [21, q21({ full_explanation: false, missing_laws: 2 })],
    [21, q21({ correct_answer: false })],
    [22, c2223()], [22, c2223({ extra_records: true })], [22, c2223({ all_formulas: false })],
    [24, c2425()], [24, c2425({ all_formulas: false, only_one_formula_wrong_or_missing: false })],
    [26, c26()], [26, c26({ justification_complete: false })],
  ];
  for (const [kim, j] of cases) {
    for (const s of trace(kim, j)) {
      assert.ok(["yes", "partial", "no"].includes(s.verdict), `${kim}: ${s.node} → ${s.verdict}`);
    }
  }
});
