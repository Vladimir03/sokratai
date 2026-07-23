#!/usr/bin/env node
// ExamProfile registry — parity-тест (техдолг ревью 5.6, 2026-07-23).
//
// Registry (src/lib/examProfiles.ts) консолидировал карты предмет×экзамен
// (баллы КИМ, режимы Части 1, граница Части 2, бенчмарки), раньше жившие
// inline в ≥4 файлах. Обёртки (kbKimScores / variantTaskDraft /
// checkFormatHelpers / mockExamScaleEge2025) обязаны отдавать ПРЕЖНИЕ значения
// байт-в-байт — канарейки ниже зафиксированы из до-registry поведения.
//
// Run: node scripts/test-exam-profiles.mjs (или npm test — секция 16)

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

/** Бандл-импорт TS-модуля с резолвом alias `@` → src (модули не самодостаточны). */
function bundleTs(relPath) {
  const entry = fileURLToPath(new URL(`../${relPath}`, import.meta.url));
  const srcDir = fileURLToPath(new URL("../src", import.meta.url));
  const result = buildSync({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    alias: { "@": srcDir },
  });
  return import(
    "data:text/javascript;base64," +
      Buffer.from(result.outputFiles[0].text).toString("base64")
  );
}

const profiles = await bundleTs("src/lib/examProfiles.ts");
const kbScores = await bundleTs("src/lib/kbKimScores.ts");
const variantDraft = await bundleTs("src/components/tutor/mock-exams/variantTaskDraft.ts");
const checkFormat = await bundleTs("src/lib/checkFormatHelpers.ts");
const scale = await bundleTs("src/lib/mockExamScaleEge2025.ts");

const sum = (map) => Object.values(map).reduce((a, b) => a + b, 0);

// ─── Замороженные полные карты (ревью 5.6 P2 №8): суммы не ловят компенсирующие
// правки («КИМ 5: 2→1, КИМ 6: 2→3» даёт ту же Σ). Эталоны сняты из
// ДО-registry источников (kbKimScores/variantTaskDraft на коммите 50e9ed6);
// осознанное обновление ФИПИ = правка литерала здесь + подтверждение
// предметника (Егор/Милада). ─────────────────────────────────────────────────

const FROZEN_PHYSICS_EGE_SCORES = {
  1: 1, 2: 1, 3: 1, 4: 1, 5: 2, 6: 2, 7: 1, 8: 1, 9: 2, 10: 2,
  11: 1, 12: 1, 13: 1, 14: 2, 15: 2, 16: 1, 17: 2, 18: 2, 19: 1, 20: 1,
  21: 3, 22: 2, 23: 2, 24: 3, 25: 3, 26: 4,
};
const FROZEN_PHYSICS_OGE_SCORES = {
  1: 2, 2: 2, 3: 1, 4: 2, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1, 11: 1,
  12: 2, 13: 2, 14: 2, 15: 1, 16: 2, 17: 3, 18: 2, 19: 2, 20: 3, 21: 3, 22: 3,
};
const FROZEN_SOCIAL_EGE_SCORES = {
  1: 1, 2: 2, 3: 1, 4: 2, 5: 2, 6: 2, 7: 2, 8: 2,
  9: 1, 10: 2, 11: 2, 12: 1, 13: 2, 14: 2, 15: 2, 16: 2,
};
const FROZEN_PHYSICS_EGE_CHECK_MODES = {
  5: "multi_choice", 9: "multi_choice", 14: "multi_choice", 18: "multi_choice",
  6: "ordered", 10: "ordered", 15: "ordered", 17: "ordered",
  20: "task20",
};
// 2026-07-23 (репорт Милады): «выбор нескольких» у обществознания переведён на
// multi_choice_strict — ЗАМЕНА цифры даёт 0 (физический multi_choice её
// засчитывал за 1 балл). Физическая карта не тронута.
const FROZEN_SOCIAL_EGE_CHECK_MODES = {
  6: "ordered_lenient", 13: "ordered_lenient", 15: "ordered_lenient",
  2: "multi_choice_strict", 4: "multi_choice_strict", 5: "multi_choice_strict",
  7: "multi_choice_strict", 8: "multi_choice_strict", 10: "multi_choice_strict",
  11: "multi_choice_strict", 14: "multi_choice_strict", 16: "multi_choice_strict",
  1: "task20", 3: "task20", 9: "task20", 12: "task20",
};

test("registry: полные карты = замороженные эталоны (deepEqual, не только Σ)", () => {
  assert.deepEqual(
    profiles.getExamProfile("physics", "ege").kimPrimaryScores,
    FROZEN_PHYSICS_EGE_SCORES,
  );
  assert.deepEqual(
    profiles.getExamProfile("physics", "oge").kimPrimaryScores,
    FROZEN_PHYSICS_OGE_SCORES,
  );
  assert.deepEqual(
    profiles.getExamProfile("social", "ege").kimPrimaryScores,
    FROZEN_SOCIAL_EGE_SCORES,
  );
  assert.deepEqual(
    profiles.getExamProfile("physics", "ege").part1CheckModes,
    FROZEN_PHYSICS_EGE_CHECK_MODES,
  );
  assert.deepEqual(
    profiles.getExamProfile("social", "ege").part1CheckModes,
    FROZEN_SOCIAL_EGE_CHECK_MODES,
  );
});

test("sweep: обёртки = registry для КАЖДОГО (профиль × КИМ), не только канарейки", () => {
  for (const p of profiles.listExamProfiles()) {
    for (const [kimStr, score] of Object.entries(p.kimPrimaryScores ?? {})) {
      const kim = Number(kimStr);
      assert.equal(
        kbScores.getKimPrimaryScoreForSubject(p.subject, p.exam, kim),
        score,
        `балл ${p.subject}:${p.exam} КИМ ${kim}`,
      );
    }
    for (const [kimStr, mode] of Object.entries(p.part1CheckModes ?? {})) {
      const kim = Number(kimStr);
      assert.equal(
        variantDraft.inferPart1CheckMode(p.subject, p.exam, kim),
        mode,
        `режим ${p.subject}:${p.exam} КИМ ${kim}`,
      );
    }
  }
});

test("registry: суммы первичных баллов ФИПИ (канарейки предметников)", () => {
  const phEge = profiles.getExamProfile("physics", "ege");
  const phOge = profiles.getExamProfile("physics", "oge");
  const soEge = profiles.getExamProfile("social", "ege");
  assert.equal(sum(phEge.kimPrimaryScores), 45, "физика ЕГЭ Σ=45");
  assert.equal(Object.keys(phEge.kimPrimaryScores).length, 26);
  assert.equal(sum(phOge.kimPrimaryScores), 39, "физика ОГЭ Σ=39");
  assert.equal(Object.keys(phOge.kimPrimaryScores).length, 22);
  assert.equal(sum(soEge.kimPrimaryScores), 28, "обществознание ЕГЭ Ч1 Σ=28");
  assert.equal(Object.keys(soEge.kimPrimaryScores).length, 16);
});

test("registry: режимы Части 1 = прежние карты (rule 45)", () => {
  const ph = profiles.getExamProfile("physics", "ege").part1CheckModes;
  for (const k of [5, 9, 14, 18]) assert.equal(ph[k], "multi_choice", `физика КИМ ${k}`);
  for (const k of [6, 10, 15, 17]) assert.equal(ph[k], "ordered", `физика КИМ ${k}`);
  assert.equal(ph[20], "task20");
  assert.equal(Object.keys(ph).length, 9, "физика: ровно 9 номеров в карте");

  const so = profiles.getExamProfile("social", "ege").part1CheckModes;
  for (const k of [6, 13, 15]) assert.equal(so[k], "ordered_lenient", `social КИМ ${k}`);
  for (const k of [2, 4, 5, 7, 8, 10, 11, 14, 16]) assert.equal(so[k], "multi_choice_strict", `social КИМ ${k}`);
  for (const k of [1, 3, 9, 12]) assert.equal(so[k], "task20", `social КИМ ${k}`);
  assert.equal(Object.keys(so).length, 16, "social: все 16 номеров Ч1 покрыты");
});

test("registry: длительность экзамена = подтверждённые значения", () => {
  // Физика ЕГЭ 3ч55м (текст инструкции в ReferencesPanel), обществознание ЕГЭ
  // 3ч30м (Милада 2026-07-23). ОГЭ-физика не подтверждена → null (фолбэк).
  assert.equal(profiles.getExamProfile("physics", "ege").durationMinutes, 235);
  assert.equal(profiles.getExamProfile("social", "ege").durationMinutes, 210);
  assert.equal(profiles.getExamProfile("physics", "oge").durationMinutes, null);
});

test("normalizeExamType: легаси exam_type физики → generic ключ профиля", () => {
  const n = profiles.normalizeExamType;
  assert.equal(n("ege_physics"), "ege", "легаси физики ЕГЭ");
  assert.equal(n("oge_physics"), "oge", "легаси физики ОГЭ");
  assert.equal(n("ege"), "ege");
  assert.equal(n("oge"), "oge");
  assert.equal(n(null), null);
  assert.equal(n(""), null);
  assert.equal(n("olympiad"), null, "неизвестное → null, чужой профиль не подставляем");
});

test("registry: неизвестный профиль → null (балл/режим вручную)", () => {
  assert.equal(profiles.getExamProfile("chemistry", "ege"), null);
  assert.equal(profiles.getExamProfile("social", "oge"), null);
  assert.equal(profiles.getExamProfile(null, "ege"), null);
});

test("обёртка kbKimScores: прежнее поведение байт-в-байт", () => {
  const f = kbScores.getKimPrimaryScoreForSubject;
  assert.equal(f("physics", "ege", 21), 3);
  assert.equal(f("physics", "ege", 26), 4);
  assert.equal(f("physics", "oge", 17), 3);
  assert.equal(f(null, "ege", 5), 2, "subject null = физика (homework без предмета)");
  assert.equal(f("social", "ege", 1), 1);
  assert.equal(f("social", "ege", 2), 2);
  assert.equal(f("social", "ege", 17), null, "social Ч2 — вручную");
  assert.equal(f("social", "oge", 1), null, "social строго ЕГЭ (ревью 5.6 P1)");
  assert.equal(f("chemistry", "ege", 5), null, "предмет без профиля → null");
  assert.equal(kbScores.getKimPrimaryScore("ege", 20), 1);
  assert.equal(kbScores.getKimPrimaryScore(null, 20), null);
});

test("обёртка inferPart1CheckMode: exam-гейтинг сохранён", () => {
  const f = variantDraft.inferPart1CheckMode;
  assert.equal(f("physics", "", 20), "task20", "физика лояльна к пустому exam");
  assert.equal(f("physics", "ege", 5), "multi_choice");
  assert.equal(f("physics", "oge", 5), "strict", "ОГЭ-карты режимов нет");
  assert.equal(f("social", "ege", 6), "ordered_lenient");
  assert.equal(f("social", "ege", 1), "task20");
  assert.equal(f("social", "", 6), "strict", "social строго ЕГЭ");
  assert.equal(f("social", "oge", 6), "strict");
  assert.equal(f("chemistry", "ege", 5), "strict");
  assert.equal(f("physics", "ege", null), "strict");
});

test("обёртка inferVariantTaskPart + inferCheckFormatFromKim: граница Ч2 [21,26]", () => {
  assert.equal(variantDraft.inferVariantTaskPart("physics", 21, "short_answer"), 2);
  assert.equal(variantDraft.inferVariantTaskPart("physics", 20, "short_answer"), 1);
  // Физика байт-в-байт: лояльна к пустому/любому exam (её карта = ЕГЭ).
  assert.equal(variantDraft.inferVariantTaskPart("physics", 21, "short_answer", ""), 2);
  assert.equal(variantDraft.inferVariantTaskPart("physics", 21, "short_answer", "oge"), 2);
  // Ревью 5.6 P1 #2: обществознание получило свою границу Ч2 [17,25], но
  // строго по указанному экзамену (зеркало inferPart1CheckMode).
  assert.equal(variantDraft.inferVariantTaskPart("social", 17, "short_answer", "ege"), 2);
  assert.equal(variantDraft.inferVariantTaskPart("social", 25, "short_answer", "ege"), 2);
  assert.equal(variantDraft.inferVariantTaskPart("social", 16, "short_answer", "ege"), 1);
  assert.equal(variantDraft.inferVariantTaskPart("social", 17, "short_answer", "oge"), 1, "social строго ЕГЭ");
  assert.equal(
    variantDraft.inferVariantTaskPart("social", 21, "short_answer"),
    1,
    "без exam — физическая граница на чужой предмет НЕ распространяется",
  );
  assert.equal(variantDraft.inferVariantTaskPart("chemistry", 21, "short_answer", "ege"), 1);
  assert.equal(
    variantDraft.inferVariantTaskPart("social", 3, "detailed_solution", "ege"),
    2,
    "формат проверки остаётся фолбэком вне диапазона",
  );
  assert.equal(checkFormat.inferCheckFormatFromKim(21), "detailed_solution");
  assert.equal(checkFormat.inferCheckFormatFromKim(26), "detailed_solution");
  assert.equal(checkFormat.inferCheckFormatFromKim(20), "short_answer");
  assert.equal(checkFormat.inferCheckFormatFromKim(null), "short_answer");
});

test("обёртка getEgePhysicsBenchmarks: порог 8 / хорошо 27 / гейты целы", () => {
  assert.deepEqual(
    scale.getEgePhysicsBenchmarks({ totalMax: 45, examType: "ege_physics" }),
    { pass: 8, good: 27 },
  );
  // Ревью 5.6 P1 #6 (2026-07-24): examType null/undefined БОЛЬШЕ НЕ пермиссивен.
  // Раньше здесь ожидалось { pass: 8, good: 27 } «по max» — из-за этого ручные
  // записи (variant = null → max подставлялся 45) и любой предмет без exam_type
  // получали физическую шкалу и выдуманный тестовый балл /100.
  assert.equal(scale.getEgePhysicsBenchmarks({ totalMax: 45 }), null);
  assert.equal(scale.getEgePhysicsBenchmarks({ totalMax: 45, examType: null }), null);
  assert.equal(scale.getEgePhysicsBenchmarks({ totalMax: 45, examType: "ege" }), null);
  assert.equal(scale.getEgePhysicsBenchmarks({ totalMax: 45, examType: "oge_physics" }), null);
  assert.equal(scale.getEgePhysicsBenchmarks({ totalMax: 20 }), null);
  assert.equal(scale.MAX_PRIMARY_EGE_PHYSICS_2025, 45, "maxPrimary registry = 45");
  assert.equal(scale.primaryToSecondary(8), 36, "шкала не задета registry-рефакторингом");
  assert.equal(scale.primaryToSecondary(45), 100);
});
