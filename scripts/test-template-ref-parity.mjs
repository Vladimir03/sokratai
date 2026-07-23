#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// Гейт промоушена шаблона в ССЫЛОЧНЫЙ режим — ревью ChatGPT-5.6 (2026-07-23),
// блокеры P1 #1 и #4.
//
// После `tasks_migrated_at` GET /templates/:id синтезирует задачи из ЖИВЫХ строк
// Базы и ИГНОРИРУЕТ сохранённый audit-снимок. Значит промоушен допустим только
// когда синтез даст ровно то, что мы сохранили. Решает это
// `templateTaskContentEquals` (kb_snapshot.ts) — единственная точка, где
// сравниваются две формы задачи, поэтому она обязана быть под тестом:
//   • задачу импортировали из Базы и правили в конструкторе без «Обновить в
//     Базе» → шаблон обязан остаться legacy (иначе покажет СТАРУЮ задачу);
//   • дробный max_score округляется при зеркалировании в primary_score;
//   • include_rubric=false / include_ai_settings=false зануляют поля снимка,
//     а синтез вернёт их из Базы → тоже не промоутим.
//
// Ложное «не равно» безопасно (остаёмся на точном legacy-снимке), ложное
// «равно» — нет. Тесты закрепляют именно эту асимметрию.
// ══════════════════════════════════════════════════════════════════════════

// Бандлит Deno-модуль через esbuild → data: URL → node:test
// (паттерн test-answer-alternatives.mjs / test-physics-flowcharts.mjs).
// Run: node scripts/test-template-ref-parity.mjs

import { fileURLToPath } from "node:url";
import test from "node:test";
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

const { kbTaskToTemplateTaskJson, templateTaskContentEquals } = await loadModule(
  "../supabase/functions/homework-api/kb_snapshot.ts",
);

/** Минимальная KB-строка; поля переопределяются в каждом кейсе. */
function kbRow(overrides = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    owner_id: "tutor-1",
    text: "Найдите ускорение тела",
    answer: "2",
    solution: null,
    attachment_url: null,
    solution_attachment_url: null,
    rubric_text: null,
    rubric_image_urls: null,
    check_format: "short_answer",
    task_kind: "numeric",
    cefr_level: null,
    grading_criteria_json: null,
    kim_number: null,
    exam: "ege",
    primary_score: 1,
    difficulty: null,
    source_label: null,
    ...overrides,
  };
}

/** Снимок, который положил бы handleCreateTemplateFromAssignment (оба toggle ON). */
function snapshotFrom(kb, overrides = {}) {
  const synth = kbTaskToTemplateTaskJson(kb);
  return { ...synth, ...overrides };
}

test("идентичный снимок ↔ Базa → промоушен разрешён", () => {
  const kb = kbRow();
  assert.equal(templateTaskContentEquals(kbTaskToTemplateTaskJson(kb), snapshotFrom(kb)), true);
});

test("провенанс не влияет на сравнение (у авто-зеркала id появляется позже)", () => {
  const kb = kbRow();
  const snapshot = snapshotFrom(kb);
  delete snapshot.source_kb_task_id;
  assert.equal(templateTaskContentEquals(kbTaskToTemplateTaskJson(kb), snapshot), true);
});

test("P1 #1: правка условия в конструкторе без «Обновить в Базе» → НЕ промоутим", () => {
  const kb = kbRow();
  const snapshot = snapshotFrom(kb, { task_text: "Найдите ускорение тела (исправлено)" });
  assert.equal(templateTaskContentEquals(kbTaskToTemplateTaskJson(kb), snapshot), false);
});

test("P1 #1: правка ответа → НЕ промоутим", () => {
  const kb = kbRow();
  assert.equal(
    templateTaskContentEquals(kbTaskToTemplateTaskJson(kb), snapshotFrom(kb, { correct_answer: "5" })),
    false,
  );
});

test("P1 #1: дробный max_score округлился при зеркалировании → НЕ промоутим", () => {
  // В Базе primary_score int (2), в ДЗ max_score 2.5 — синтез вернул бы 2.
  const kb = kbRow({ primary_score: 2 });
  assert.equal(
    templateTaskContentEquals(kbTaskToTemplateTaskJson(kb), snapshotFrom(kb, { max_score: 2.5 })),
    false,
  );
});

test("P1 #4: include_rubric=false занулил рубрику → НЕ промоутим", () => {
  const kb = kbRow({ rubric_text: "К1 — тезис, К2 — пример" });
  const snapshot = snapshotFrom(kb, { rubric_text: null });
  assert.equal(templateTaskContentEquals(kbTaskToTemplateTaskJson(kb), snapshot), false);
});

test("P1 #4: include_ai_settings=false опустил check_format/task_kind → НЕ промоутим", () => {
  const kb = kbRow({ check_format: "detailed_solution", task_kind: "extended" });
  const snapshot = snapshotFrom(kb);
  delete snapshot.check_format;
  delete snapshot.task_kind;
  assert.equal(templateTaskContentEquals(kbTaskToTemplateTaskJson(kb), snapshot), false);
});

test("P1 #4: опущенные критерии → НЕ промоутим", () => {
  const kb = kbRow({ grading_criteria_json: [{ label: "К1", max: 2 }] });
  const snapshot = snapshotFrom(kb);
  delete snapshot.grading_criteria_json;
  assert.equal(templateTaskContentEquals(kbTaskToTemplateTaskJson(kb), snapshot), false);
});

test("порядок ключей и вложенные объекты не создают ложных расхождений", () => {
  const kb = kbRow({ grading_criteria_json: [{ label: "К1", max: 2, description: "тезис" }] });
  const synth = kbTaskToTemplateTaskJson(kb);
  // Тот же контент, но ключи в другом порядке (JSONB из Postgres не сохраняет порядок).
  const reordered = Object.fromEntries(Object.entries(synth).reverse());
  reordered.grading_criteria_json = [{ max: 2, description: "тезис", label: "К1" }];
  assert.equal(templateTaskContentEquals(synth, reordered), true);
});

test("null и отсутствующий ключ — одно и то же «поля нет»", () => {
  const kb = kbRow();
  const snapshot = snapshotFrom(kb, { solution_text: null, cefr_level: null });
  assert.equal(templateTaskContentEquals(kbTaskToTemplateTaskJson(kb), snapshot), true);
});

