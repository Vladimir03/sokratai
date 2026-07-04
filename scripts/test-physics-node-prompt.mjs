#!/usr/bin/env node
// strict-criteria-grading Phase 3 / Phase B — санитайзер узлов-суждений физики.
// Проверяет: (1) sanitizePhysicsJudgments приводит ответ модели к типизированным
// judgments нужной формы по № задания + коэрсит булевы/missing_laws; (2) связка
// «узлы → walkPhysicsFlowchart» даёт правильный балл (вкл. адиабату Δ→2/3);
// (3) buildPhysicsNodeSystemContent содержит чеклист №26 и null для не-Часть-2.
//
// Бандлит _shared/physics-node-prompt.ts (тянет physics-flowcharts.ts) через
// esbuild. Run: node scripts/test-physics-node-prompt.mjs

import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const entry = fileURLToPath(
  new URL("../supabase/functions/_shared/physics-node-prompt.ts", import.meta.url),
);
const walkerEntry = fileURLToPath(
  new URL("../supabase/functions/_shared/physics-flowcharts.ts", import.meta.url),
);
async function load(path) {
  const bundled = await build({
    entryPoints: [path],
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
const { sanitizePhysicsJudgments, buildPhysicsNodeSystemContent } = await load(entry);
const { walkPhysicsFlowchart } = await load(walkerEntry);

// ─── Санитайзер: форма judgments по № ────────────────────────────────────────
test("sanitize № 24-25 → форма Calc24_25 + коэрсинг", () => {
  const r = sanitizePhysicsJudgments(
    {
      all_formulas: "yes",
      general_formula_dim_answer_correct: true,
      notation_transforms_calc_correct: 0,
      transforms_correct: "да",
      only_one_formula_wrong_or_missing: false,
      feedback: "  проверь преобразования  ",
      confidence: "high",
    },
    24,
  );
  assert.equal(r.judgments.all_formulas, true); // "yes" → true
  assert.equal(r.judgments.notation_transforms_calc_correct, false); // 0 → false
  assert.equal(r.judgments.transforms_correct, true); // "да" → true
  assert.equal(r.feedback, "проверь преобразования"); // trimmed
  assert.equal(r.confidence, 0.9); // high
});

test("sanitize № 21 → missing_laws коэрсинг (строка/большое → 0/1/2)", () => {
  assert.equal(sanitizePhysicsJudgments({ missing_laws: "2" }, 21).judgments.missing_laws, 2);
  assert.equal(sanitizePhysicsJudgments({ missing_laws: 5 }, 21).judgments.missing_laws, 2);
  assert.equal(sanitizePhysicsJudgments({ missing_laws: 1 }, 21).judgments.missing_laws, 1);
  assert.equal(sanitizePhysicsJudgments({ missing_laws: 0 }, 21).judgments.missing_laws, 0);
  assert.equal(sanitizePhysicsJudgments({}, 21).judgments.missing_laws, 0); // отсутствует → 0
});

test("sanitize № 26 → включает justification_complete", () => {
  const r = sanitizePhysicsJudgments({ justification_complete: true, all_formulas: true }, 26);
  assert.equal(r.judgments.justification_complete, true);
  assert.equal(r.judgments.all_formulas, true);
});

test("sanitize не-Часть-2 (№ 5) → null", () => {
  assert.equal(sanitizePhysicsJudgments({ all_formulas: true }, 5), null);
  assert.equal(sanitizePhysicsJudgments("не объект", 24), null);
  assert.equal(sanitizePhysicsJudgments(null, 24), null);
});

// ─── Связка узлы → walker (адиабата: потеряна Δ → 2/3) ────────────────────────
test("адиабата: узлы модели → walker → 2 из 3", () => {
  const r = sanitizePhysicsJudgments(
    {
      all_formulas: true,
      general_formula_dim_answer_correct: true,
      notation_transforms_calc_correct: false, // потеряна Δ в преобразованиях
      transforms_correct: true,
      only_one_formula_wrong_or_missing: false,
      feedback: "...",
      confidence: "medium",
    },
    24,
  );
  const walk = walkPhysicsFlowchart(24, r.judgments);
  assert.equal(walk.score, 2);
  assert.equal(walk.maxScore, 3);
});

test("№ 26: полное обоснование + идеальный расчёт → 4", () => {
  const r = sanitizePhysicsJudgments(
    {
      justification_complete: true,
      all_formulas: true,
      general_formula_dim_answer_correct: true,
      notation_transforms_calc_correct: true,
      transforms_correct: true,
      only_one_formula_wrong_or_missing: false,
    },
    26,
  );
  assert.equal(walkPhysicsFlowchart(26, r.judgments).score, 4);
});

// ─── buildPhysicsNodeSystemContent ───────────────────────────────────────────
test("system content: № 26 содержит чеклист обоснования, № 24 — нет", () => {
  const c26 = buildPhysicsNodeSystemContent({ kim: 26, role: "R", methodology: "M", reference: "REF", maxScore: 4 });
  assert.match(c26, /ЧЕКЛИСТ ОБОСНОВАНИЯ/);
  assert.match(c26, /ЭТАЛОННОЕ РЕШЕНИЕ/); // reference вставлен
  const c24 = buildPhysicsNodeSystemContent({ kim: 24, role: "R", methodology: "M", reference: null, maxScore: 3 });
  assert.doesNotMatch(c24, /ЧЕКЛИСТ ОБОСНОВАНИЯ/);
  assert.doesNotMatch(c24, /ЭТАЛОННОЕ РЕШЕНИЕ/); // reference=null → нет блока
});

test("system content: не-Часть-2 → null", () => {
  assert.equal(buildPhysicsNodeSystemContent({ kim: 5, role: "R", methodology: "M", reference: null, maxScore: 1 }), null);
});
