#!/usr/bin/env node
// Резолвер номеров Части 2 пробника (репорт Ульяны 2026-08-04).
//
// Баг: разбивка была захардкожена физикой ЕГЭ `[21..26]` на репетиторских
// экранах, поэтому письменное задание 20 химии ОГЭ пропадало из ленты привязки
// фото и никогда не проверялось AI.
//
// Главный риск правки — регресс физики, поэтому её поведение зафиксировано
// байт-в-байт из КАЖДОГО источника отдельно.
//
// Run: node scripts/test-mockexam-part2.mjs (или npm test — секция 27)

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

/** Бандл-импорт TS-модуля с резолвом alias `@` → src (модуль не самодостаточен). */
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

const m = await bundleTs("src/lib/mockExamPart2.ts");

const PHYSICS_EGE = [21, 22, 23, 24, 25, 26];
const CHEM_OGE = [20, 21, 22, 23];

test("физика ЕГЭ: [21..26] из КАЖДОГО источника (регресс-замок)", () => {
  assert.deepEqual(
    m.resolvePart2KimNumbers({ variantPart2Kims: PHYSICS_EGE }),
    PHYSICS_EGE,
    "из задач варианта",
  );
  assert.deepEqual(
    m.resolvePart2KimNumbers({ solutionKims: PHYSICS_EGE }),
    PHYSICS_EGE,
    "из строк решений",
  );
  assert.deepEqual(
    m.resolvePart2KimNumbers({ subject: "physics", examType: "ege_physics" }),
    PHYSICS_EGE,
    "из профиля по легаси exam_type",
  );
  assert.deepEqual(
    m.resolvePart2KimNumbers({ subject: null, examType: "ege_physics" }),
    PHYSICS_EGE,
    "предмет NULL (легаси-строка) + физический exam_type → прежнее поведение",
  );
});

test("химия ОГЭ: задание 20 не теряется (кейс Ульяны)", () => {
  assert.deepEqual(m.resolvePart2KimNumbers({ variantPart2Kims: CHEM_OGE }), CHEM_OGE);
  assert.deepEqual(
    m.resolvePart2KimNumbers({ subject: "chemistry", examType: "oge" }),
    CHEM_OGE,
    "из профиля chemistry:oge",
  );
  assert.deepEqual(
    m.resolvePart2KimNumbers({ subject: "chemistry", examType: "ege" }),
    [29, 30, 31, 32, 33, 34],
    "химия ЕГЭ — своя граница",
  );
  // Ровно тот сценарий, который у неё сломался: КИМ 20 есть в решениях,
  // старый экран его отфильтровывал.
  const withSolutions = m.resolvePart2KimNumbers({ solutionKims: [20, 21, 22, 23] });
  assert.ok(withSolutions.includes(20), "КИМ 20 обязан присутствовать");
});

test("приоритет источников: данные > профиль, union задач и решений", () => {
  // Профиль физики НЕ должен победить реальные данные химии.
  assert.deepEqual(
    m.resolvePart2KimNumbers({
      variantPart2Kims: CHEM_OGE,
      subject: "physics",
      examType: "ege_physics",
    }),
    CHEM_OGE,
    "данные варианта важнее профиля",
  );
  // Осиротевшая строка решения (вариант отредактировали после проверки) обязана
  // остаться видимой — иначе балл за неё теряется молча.
  assert.deepEqual(
    m.resolvePart2KimNumbers({ variantPart2Kims: [21, 22], solutionKims: [26] }),
    [21, 22, 26],
    "union, а не только бэкенд",
  );
});

test("deploy-skew: нет part2_kim_numbers → добираем из решений", () => {
  // Фронт деплоится отдельно от edge (rule 95): новое поле может не прийти.
  assert.deepEqual(
    m.resolvePart2KimNumbers({
      variantPart2Kims: undefined,
      solutionKims: CHEM_OGE,
      subject: undefined,
      examType: "oge",
    }),
    CHEM_OGE,
  );
});

test("пусто → пусто, никогда чужой предмет", () => {
  // Ни данных, ни экзамена = мы НЕ ЗНАЕМ разбивку. Подставлять физику здесь
  // нельзя: ровно так задание 20 химии и пропадало. `exam_type` в БД NOT NULL
  // (DEFAULT 'ege_physics'), поэтому в проде эта ветка недостижима — но она
  // обязана быть безопасной, а не «угадывающей».
  assert.deepEqual(m.resolvePart2KimNumbers({}), [], "ничего не знаем → молчим");
  assert.deepEqual(
    m.resolvePart2KimNumbers({ subject: null, examType: null }),
    [],
    "нет экзамена → профиля нет → молчим",
  );
  assert.deepEqual(
    m.resolvePart2KimNumbers({ subject: "french", examType: "delf" }),
    [],
    "профиля нет → молчим",
  );
  assert.deepEqual(
    m.resolvePart2KimNumbers({ subject: "physics", examType: "oge_physics" }),
    [],
    "physics:oge имеет part2KimRange=null → молчим, а не ЕГЭ-диапазон",
  );
});

test("мусор в номерах отбрасывается, дубли схлопываются", () => {
  assert.deepEqual(
    m.resolvePart2KimNumbers({ variantPart2Kims: [21, 21, 22, 0, -3, 1e9, 2.5, NaN] }),
    [21, 22],
  );
});

test("expandKimRange", () => {
  assert.deepEqual(m.expandKimRange([20, 23]), CHEM_OGE);
  assert.deepEqual(m.expandKimRange([21, 21]), [21]);
  assert.deepEqual(m.expandKimRange(null), []);
  assert.deepEqual(m.expandKimRange([26, 21]), [], "перевёрнутый диапазон → пусто");
});

test("resolveVariantKimLayout: обе части из данных + max_score", () => {
  const layout = m.resolveVariantKimLayout({
    variantTasks: [
      { kim_number: 1, part: 1, max_score: 2 },
      { kim_number: 19, part: 1, max_score: 1 },
      { kim_number: 20, part: 2, max_score: 3 },
      { kim_number: 23, part: 2, max_score: 4 },
    ],
    subject: "chemistry",
    examType: "oge",
  });
  assert.deepEqual(layout.part1, [1, 19]);
  assert.deepEqual(layout.part2, [20, 23], "КИМ 20 в Части 2, а не в Части 1");
  assert.equal(layout.maxByKim[20], 3);
  // Пересечения быть не может — иначе теплокарта нарисует КИМ дважды.
  assert.equal(
    layout.part1.filter((n) => layout.part2.includes(n)).length,
    0,
    "части не пересекаются",
  );
});

test("resolveVariantKimLayout: нет задач → профиль, физика не пересекается", () => {
  const layout = m.resolveVariantKimLayout({ subject: "physics", examType: "ege_physics" });
  assert.deepEqual(layout.part2, PHYSICS_EGE);
  assert.deepEqual(layout.part1, Array.from({ length: 20 }, (_, i) => i + 1), "1..20");
  assert.equal(
    layout.part1.filter((n) => layout.part2.includes(n)).length,
    0,
    "части не пересекаются",
  );
  assert.equal(layout.maxByKim[26], 4, "балл ФИПИ из карты профиля");
});

test("formatKimNumbersLabel", () => {
  assert.equal(m.formatKimNumbersLabel(PHYSICS_EGE), "№ 21–26");
  assert.equal(m.formatKimNumbersLabel(CHEM_OGE), "№ 20–23");
  assert.equal(m.formatKimNumbersLabel([20]), "№ 20");
  assert.equal(m.formatKimNumbersLabel([3, 7, 11]), "№ 3, 7, 11", "разреженный");
  assert.equal(m.formatKimNumbersLabel([]), null, "пусто → не подписывать");
  assert.equal(m.formatKimNumbersLabel([21, 22], { prefix: "" }), "21–22");
});
