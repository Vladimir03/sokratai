#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// Единый справочник предметов: реестр ↔ сгенерированное Deno-зеркало.
//
// До 2026-07-23 словарь предметов существовал ≥9 копиями (SUBJECTS,
// KB_SUBJECTS, дательный падеж, humanities-множество ×4, VALID_SUBJECTS_*,
// SUBJECT_LABELS_DENO ×2) и сверялся регэкспами по исходникам. Расхождение
// давало ТИХУЮ поломку: у репетитора-химика два месяца не сохранялся шаблон ДЗ.
//
// Теперь источник один — src/lib/subjects/registry.ts; edge читает
// _shared/subjects.generated.ts. Этот тест проверяет РАНТАЙМ-эквивалентность
// (не текст файлов): свежесть зеркала как файла проверяет
// `generate-subjects.mjs --check` (smoke §19), соответствие CHECK'ам БД —
// `check-prod-schema.mjs` (smoke §17).
//
// Run: node scripts/test-subjects-registry.mjs
// ══════════════════════════════════════════════════════════════════════════

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

const registry = await loadModule("../src/lib/subjects/registry.ts");
const mirror = await loadModule("../supabase/functions/_shared/subjects.generated.ts");

/** Письменные гуманитарные: канонические + легаси через alias. */
const registryHumanities = new Set([
  ...registry.SUBJECT_REGISTRY.filter((s) => s.isHumanitiesWriting).map((s) => s.id),
  ...registry.LEGACY_SUBJECTS.filter((l) => {
    const target = registry.SUBJECT_REGISTRY.find((s) => s.id === l.alias);
    return target?.isHumanitiesWriting === true;
  }).map((l) => l.id),
]);

const sorted = (iterable) => [...iterable].sort();

test("baseline письменных гуманитарных предметов на месте", () => {
  // Выпадение любого → у ученика возвращается физико-математический UX
  // (numeric-инпут в SubmitSheet, «покажи ход решения» вместо «напиши текст»).
  for (const id of ["russian", "rus", "literature", "english", "french", "spanish"]) {
    assert.ok(registryHumanities.has(id), `реестр потерял письменный предмет: ${id}`);
  }
});

test("humanities-множество: реестр = Deno-зеркало", () => {
  assert.deepEqual(sorted(mirror.HUMANITIES_WRITING_SUBJECTS), sorted(registryHumanities));
});

test("CEFR-множество: реестр = Deno-зеркало", () => {
  const registryCefr = registry.SUBJECT_REGISTRY.filter((s) => s.requiresCefr).map((s) => s.id);
  assert.deepEqual(sorted(mirror.SUBJECTS_REQUIRING_CEFR), sorted(registryCefr));
  // Языковые ДЗ без CEFR грейдятся не тем уровнем (rule 40 Phase 11).
  for (const id of ["english", "french", "spanish"]) {
    assert.ok(mirror.SUBJECTS_REQUIRING_CEFR.has(id), `язык без CEFR-флага: ${id}`);
  }
});

test("список id и его ПОРЯДОК совпадают (порядок = порядок в селекторах)", () => {
  assert.deepEqual([...mirror.SUBJECT_IDS], registry.SUBJECT_REGISTRY.map((s) => s.id));
  assert.deepEqual([...mirror.LEGACY_SUBJECT_IDS], registry.LEGACY_SUBJECTS.map((s) => s.id));
});

test("лейблы совпадают для канонических и легаси id", () => {
  for (const s of registry.SUBJECT_REGISTRY) {
    assert.equal(mirror.SUBJECT_LABELS[s.id], s.name, `лейбл разошёлся: ${s.id}`);
    assert.equal(registry.getSubjectName(s.id), s.name);
  }
  for (const l of registry.LEGACY_SUBJECTS) {
    assert.equal(mirror.SUBJECT_LABELS[l.id], l.name, `лейбл легаси разошёлся: ${l.id}`);
  }
});

test("дательный падеж есть у каждого предмета", () => {
  for (const s of registry.SUBJECT_REGISTRY) {
    assert.equal(mirror.SUBJECT_DATIVE[s.id], s.dative);
    assert.ok(s.dative.trim().length > 0, `пустой дательный падеж: ${s.id}`);
  }
  // Неизвестный/пустой → нейтральная формулировка, а не сырой id в UI.
  assert.equal(registry.getSubjectDativeName(null), "этому предмету");
  assert.equal(registry.getSubjectDativeName("нет-такого"), "этому предмету");
});

test("легаси-id резолвятся в канонический предмет (alias)", () => {
  assert.equal(registry.canonicalSubjectId("rus"), "russian");
  assert.equal(registry.canonicalSubjectId("math"), "maths");
  assert.equal(registry.canonicalSubjectId("cs"), "informatics");
  // Легаси наследует поведение канонического.
  assert.equal(registry.subjectIsHumanitiesWriting("rus"), true);
  assert.equal(registry.subjectRequiresCefr("math"), false);
});

test("нормализация регистра и пробелов (в БД предметы lowercase)", () => {
  assert.equal(registry.getSubjectName(" Physics "), "Физика");
  assert.equal(registry.subjectIsHumanitiesWriting("FRENCH"), true);
  assert.equal(registry.canonicalSubjectId(""), null);
  assert.equal(registry.canonicalSubjectId(null), null);
});

test("id уникальны и не пересекаются с легаси", () => {
  const ids = registry.SUBJECT_REGISTRY.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, "дубликаты id в реестре");
  const legacyIds = registry.LEGACY_SUBJECTS.map((l) => l.id);
  assert.equal(new Set(legacyIds).size, legacyIds.length, "дубликаты легаси-id");
  const overlap = legacyIds.filter((id) => ids.includes(id));
  assert.deepEqual(overlap, [], `легаси-id пересекается с каноническим: ${overlap.join(", ")}`);
});

test("alias легаси указывает на существующий канонический предмет", () => {
  for (const l of registry.LEGACY_SUBJECTS) {
    if (l.alias === null) continue;
    assert.ok(
      registry.SUBJECT_REGISTRY.some((s) => s.id === l.alias),
      `битый alias у ${l.id}: ${l.alias}`,
    );
  }
});
