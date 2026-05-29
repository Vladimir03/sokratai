#!/usr/bin/env node
// Voice-Speaking MVP TASK-2/3 — criteria template invariants.
//
// Guards the sum-aggregation contract of the per-criterion breakdown
// (review fix 2026-05-27, P1 #2): each language format that exposes a
// `criteria_breakdown_template` MUST be additive (Σ criterion max =
// declared exam total), and AVERAGE-aggregated formats (IELTS) MUST NOT
// expose a template (sanitizer only supports sum). Catches the regression
// class «methodology says N but template sums to M» and accidental
// re-enabling of IELTS breakdown.
//
// Bundles the Deno `_shared/subject-rubrics/index.ts` graph via esbuild
// (already a Vite dep) → imports via data: URL → runs node:test assertions.
//
// Run: node scripts/test-criteria-templates.mjs

import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const entry = fileURLToPath(
  new URL("../supabase/functions/_shared/subject-rubrics/index.ts", import.meta.url),
);

const bundled = await build({
  entryPoints: [entry],
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
  logLevel: "silent",
});
const code = bundled.outputFiles[0].text;
const dataUrl = "data:text/javascript;base64," + Buffer.from(code).toString("base64");
const mod = await import(dataUrl);
const { resolveSubjectRubric } = mod;

function resolveTemplate(subject, taskText, taskKind = "extended") {
  const r = resolveSubjectRubric({
    subject,
    exam_type: "ege",
    kim_number: null,
    task_kind: taskKind,
    task_text: taskText,
    tutor_rubric: null,
  });
  return r.criteria_breakdown_template ?? null;
}

const sumMax = (t) => t.reduce((s, c) => s + c.max, 0);
const sumAiMax = (t) => t.filter((c) => c.kind !== "tutor_only").reduce((s, c) => s + c.max, 0);
const tutorOnly = (t) => t.filter((c) => c.kind === "tutor_only");

// [subject, taskText, fullTotal, aiGradableTotal, tutorOnlyCount]
const SUM_FORMATS = [
  ["french", "DELF B1 production écrite — exprimez votre point de vue", 25, 25, 0],
  ["french", "DELF B2 production écrite — essai argumenté", 25, 25, 0],
  ["french", "DELF A2 production écrite — décrire vos dernières vacances", 25, 25, 0],
  ["french", "DELF A2 production orale — présentez votre ville natale", 25, 23, 1],
  ["french", "DELF B1 production orale — expression d'un point de vue", 25, 23, 1],
  ["french", "DELF B2 production orale — exposé et débat", 25, 23, 1],
  ["english", "ЕГЭ задание 38 — личное письмо", 6, 6, 0],
  ["english", "ЕГЭ задание 39 — эссе развёрнутое высказывание", 14, 14, 0],
  ["english", "ОГЭ личное письмо другу", 8, 8, 0],
  ["english", "ЕГЭ устная часть Task 3 — тематический монолог", 8, 7, 1],
  ["english", "ОГЭ устная часть — монологическое высказывание", 6, 5, 1],
];

for (const [subject, taskText, full, aiTotal, tutorN] of SUM_FORMATS) {
  test(`sum template: ${subject} «${taskText.slice(0, 32)}…»`, () => {
    const t = resolveTemplate(subject, taskText);
    assert.ok(Array.isArray(t) && t.length > 0, "template must be non-null array");
    assert.equal(sumMax(t), full, `Σ all criterion max must equal exam total ${full}`);
    assert.equal(sumAiMax(t), aiTotal, `Σ AI-graded max must equal ${aiTotal}`);
    assert.equal(tutorOnly(t).length, tutorN, `tutor_only count must be ${tutorN}`);
  });
}

// AVERAGE-aggregated formats — must NOT expose a template (P1 #2).
test("IELTS Task 1 → no breakdown template (average aggregation)", () => {
  assert.equal(resolveTemplate("english", "IELTS Writing Task 1 — describe the graph"), null);
});
test("IELTS Task 2 → no breakdown template (average aggregation)", () => {
  assert.equal(resolveTemplate("english", "IELTS Writing Task 2 — agree or disagree essay"), null);
});

// Non-language subjects never expose a criteria template.
for (const subject of ["physics", "maths", "chemistry", "informatics", "history", "biology"]) {
  test(`non-language ${subject} → no breakdown template`, () => {
    assert.equal(resolveTemplate(subject, "Найди ускорение тела массой 2 кг."), null);
  });
}

// Numeric (краткий ответ) language tasks — no decomposition.
test("numeric language task → no breakdown template", () => {
  assert.equal(resolveTemplate("french", "DELF B1 — choisissez la bonne réponse", "numeric"), null);
});

// voice-speaking-mvp fix #2 (2026-05-29): explicit task_kind='speaking' MUST force
// the ORAL rubric even when the sujet has no oral keywords («монолог»/«orale»).
// Before the fix, runStudentAnswerGrading nulled the speaking signal and format
// detection fell back to task_text heuristics → a real oral answer was graded by
// écrite criteria.
test("speaking task_kind forces oral rubric (not text heuristic)", () => {
  // sujet БЕЗ oral-ключевых слов — раньше → écrite.
  const neutralFr = "DELF B1. Présentez votre point de vue sur les réseaux sociaux.";
  const methodologyFor = (taskKind) =>
    resolveSubjectRubric({
      subject: "french",
      exam_type: "ege",
      kim_number: null,
      task_kind: taskKind,
      task_text: neutralFr,
      tutor_rubric: null,
    }).methodology;

  assert.match(methodologyFor("speaking"), /orale/i, "speaking → production orale methodology");
  // Контроль: тот же текст как extended → écrite (эвристика сама oral не поднимает).
  assert.match(methodologyFor("extended"), /écrite|ecrite/i, "extended → production écrite methodology");
});

// CEFR-level fix (2026-05-29): explicit `cefr_level` (селектор «Уровень») ПОБЕЖДАЕТ
// текст-эвристику. Раньше уровень угадывался только из task_text → дефолт B1 →
// A2/B2-задачи грейдились по B1 (баг Эмилии).
test("cefr_level forces the rubric level over text heuristic", () => {
  // Нейтральный текст БЕЗ уровневого токена → авто-детект = B1 (дефолт).
  const neutral = "Rédigez un texte argumenté sur les réseaux sociaux.";
  const methodologyFor = (cefr) =>
    resolveSubjectRubric({
      subject: "french",
      exam_type: "ege",
      kim_number: null,
      task_kind: "extended",
      task_text: neutral,
      tutor_rubric: null,
      cefr_level: cefr,
    }).methodology;

  assert.match(methodologyFor("A2"), /A2/, "cefr_level=A2 → A2 methodology");
  assert.match(methodologyFor("B2"), /B2/, "cefr_level=B2 → B2 methodology");
  // null → авто-детект: нейтральный текст падает в дефолт B1 (прежнее поведение).
  assert.match(methodologyFor(null), /B1/, "cefr_level=null → auto-detect (B1 default)");
});
