#!/usr/bin/env node
// Mock Exams v1 — unit tests for Part 1 deterministic checker.
//
// Workaround for absence of vitest/jest in this repo: transpile the .ts source
// via esbuild (already a Vite dep), import the compiled module via data: URL,
// then run assertions with node:test (built-in).
//
// Run: node scripts/test-mockexam-checker.mjs
//      OR: npm test (after wiring into smoke-check, см. README в TASK-4 follow-up)
//
// Spec: docs/delivery/features/mock-exams-v1/spec.md AC-3

import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { transformSync } from "esbuild";

const sourcePath = new URL("../src/lib/mockExamPart1Checker.ts", import.meta.url);
const source = readFileSync(sourcePath, "utf8");
const compiled = transformSync(source, { loader: "ts", format: "esm" }).code;
const dataUrl = "data:text/javascript;base64," + Buffer.from(compiled).toString("base64");
const checker = await import(dataUrl);

const {
  checkPart1Answer,
  checkStrict,
  checkOrdered,
  checkUnordered,
  checkMultiChoice,
  checkTask20,
  checkPair,
  numericRoundingMatch,
  gradeMultiChoice,
  gradeOrdered,
  gradeOrderedLenient,
} = checker;

// ────────────────────────────────────────────────────────────────────────────
// strict
// ────────────────────────────────────────────────────────────────────────────

test("checkStrict: exact numeric match", () => {
  assert.equal(checkStrict("5.6", "5.6"), true);
  assert.equal(checkStrict("5.6", "5,6"), true, "comma decimal accepted");
  assert.equal(checkStrict("5.6", "5.60"), true, "trailing zero accepted");
  assert.equal(checkStrict("5.6", " 5.6 "), true, "whitespace stripped");
  assert.equal(checkStrict("5.6", "5.7"), false);
});

test("checkStrict: integer-string text match", () => {
  assert.equal(checkStrict("ускорение", "Ускорение"), true, "case-insensitive");
  assert.equal(checkStrict("ускорение", "скорость"), false);
});

test("checkStrict: fp tolerance (1% or 0.01)", () => {
  assert.equal(checkStrict("0.5", "0.501"), true);
  assert.equal(checkStrict("100", "101"), false, "integers strict");
  assert.equal(checkStrict("9.81", "9.8"), true, "abs tolerance 0.01 met");
});

// ────────────────────────────────────────────────────────────────────────────
// ordered
// ────────────────────────────────────────────────────────────────────────────

test("checkOrdered: strict sequence", () => {
  assert.equal(checkOrdered("1,3,2", "1,3,2"), true);
  assert.equal(checkOrdered("1,3,2", "1, 3, 2"), true, "whitespace ignored");
  assert.equal(checkOrdered("1,3,2", "1,2,3"), false, "different order");
  assert.equal(checkOrdered("1,3,2", "1,3"), false, "different length");
});

// ────────────────────────────────────────────────────────────────────────────
// unordered
// ────────────────────────────────────────────────────────────────────────────

test("checkUnordered: multiset equality", () => {
  assert.equal(checkUnordered("1,3,2", "2,3,1"), true);
  assert.equal(checkUnordered("1,3,2", "1,3,2"), true);
  assert.equal(checkUnordered("1,3", "1,3,2"), false, "extra element");
  assert.equal(checkUnordered("1,1,2", "1,2,2"), false, "different multiset");
});

// ────────────────────────────────────────────────────────────────────────────
// multi_choice
// ────────────────────────────────────────────────────────────────────────────

test("checkMultiChoice: subset match", () => {
  assert.equal(checkMultiChoice("13", "13"), true);
  assert.equal(checkMultiChoice("13", "31"), true, "order doesn't matter");
  assert.equal(checkMultiChoice("13", "1,3"), true, "comma separated");
  assert.equal(checkMultiChoice("13", "1 3"), true, "space separated → digit-by-digit");
  assert.equal(checkMultiChoice("13", "12"), false, "wrong second");
  assert.equal(checkMultiChoice("125", "152"), true, "3-correct case");
});

// ────────────────────────────────────────────────────────────────────────────
// task20 — «выберите два номера» (порядок НЕ важен, binary). 2026-06-07: было
// строковое равенство (order-dependent), репортнут Vladimir («13» верно, но «31»
// считалось неверным). Все task20-задачи в сидах — «номера выбранных …».
// ────────────────────────────────────────────────────────────────────────────

test("checkTask20: order-independent set match", () => {
  assert.equal(checkTask20("13", "13"), true);
  assert.equal(checkTask20("13", "31"), true, "ПОРЯДОК НЕ ВАЖЕН (13=31)");
  assert.equal(checkTask20("312", "3,1,2"), true, "separators stripped");
  assert.equal(checkTask20("312", "3 1 2"), true, "whitespace stripped");
  assert.equal(checkTask20("312", "321"), true, "order-independent (same set)");
  assert.equal(checkTask20("13", "23"), false, "одна цифра не совпала → 0");
  assert.equal(checkTask20("13", "14"), false, "одна цифра не совпала → 0");
  assert.equal(checkTask20("13", "133"), false, "длина/дубликаты учитываются");
  assert.equal(checkTask20("312", "abc"), false, "non-digits rejected");
});

// ────────────────────────────────────────────────────────────────────────────
// pair — value+unit
// ────────────────────────────────────────────────────────────────────────────

test("checkPair: value and unit both correct", () => {
  assert.equal(checkPair("12.5;м/с", "12.5 м/с"), true, "; vs space separator");
  assert.equal(checkPair("12.5 м/с", "12,5 м/с"), true, "comma decimal");
  assert.equal(checkPair("12.5 м/с", "12.5 м"), false, "wrong unit");
  assert.equal(checkPair("12.5 м/с", "12 м/с"), false, "wrong value");
  assert.equal(checkPair("9.81 м/с²", "9.8 м/с²"), true, "fp tolerance");
});

test("checkPair: EGE measurement value plus error blank format", () => {
  assert.equal(checkPair("2,70,1", "2,70,1"), true, "compact blank answer");
  assert.equal(checkPair("2,70,1", "2,7 0,1"), true, "space between value and error");
  assert.equal(checkPair("2,70,1", "(2,7 ± 0,1) Н"), true, "human-readable measurement form");
  assert.equal(checkPair("2,70,1", "2,8 0,1"), false, "wrong measurement value");
});

// ────────────────────────────────────────────────────────────────────────────
// public dispatch
// ────────────────────────────────────────────────────────────────────────────

test("checkPart1Answer: scores correctly per mode", () => {
  // strict: correct → max
  assert.deepEqual(
    checkPart1Answer({ correctAnswer: "5.6", studentAnswer: "5,6", checkMode: "strict", maxScore: 1 }),
    { earnedScore: 1, isCorrect: true },
  );
  // strict: incorrect → 0
  assert.deepEqual(
    checkPart1Answer({ correctAnswer: "5.6", studentAnswer: "5.7", checkMode: "strict", maxScore: 1 }),
    { earnedScore: 0, isCorrect: false },
  );
  // empty student answer → 0
  assert.deepEqual(
    checkPart1Answer({ correctAnswer: "5.6", studentAnswer: "", checkMode: "strict", maxScore: 1 }),
    { earnedScore: 0, isCorrect: false },
  );
  // null student answer → 0
  assert.deepEqual(
    checkPart1Answer({ correctAnswer: "5.6", studentAnswer: null, checkMode: "strict", maxScore: 1 }),
    { earnedScore: 0, isCorrect: false },
  );
  // ordered
  assert.deepEqual(
    checkPart1Answer({ correctAnswer: "1,3,2", studentAnswer: "1,3,2", checkMode: "ordered", maxScore: 2 }),
    { earnedScore: 2, isCorrect: true },
  );
  // multi_choice
  assert.deepEqual(
    checkPart1Answer({ correctAnswer: "13", studentAnswer: "31", checkMode: "multi_choice", maxScore: 1 }),
    { earnedScore: 1, isCorrect: true },
  );
  // manual mode → 0 (Часть 2, no auto-check)
  assert.deepEqual(
    checkPart1Answer({ correctAnswer: "anything", studentAnswer: "x", checkMode: "manual", maxScore: 3 }),
    { earnedScore: 0, isCorrect: false },
  );
});

// ────────────────────────────────────────────────────────────────────────────
// F3 (mock-exams-v1-pilot-polish AC-P3) — numeric rounding tolerance for strict
// ────────────────────────────────────────────────────────────────────────────

test("numericRoundingMatch: AC-P3 cases", () => {
  // PASS: student точнее correct, округление до scale_of_correct совпадает
  assert.equal(numericRoundingMatch("0.216", "0.2"), true, "0.216 → round(.,1) = 0.2");
  // FAIL: student в той же шкале, но другое значение
  assert.equal(numericRoundingMatch("0.3", "0.2"), false, "0.3 != 0.2 at scale 1");
  // PASS: целочисленный correct, student чуть больше — round to 0 decimals = 5
  assert.equal(numericRoundingMatch("5.0001", "5"), true, "5.0001 → round(.,0) = 5");
  // FAIL: целочисленный correct, 5.5 округляется к 6 (JS Math.round half-up)
  assert.equal(numericRoundingMatch("5.5", "5"), false, "round(5.5,0) = 6, не 5");
  // PASS: RU локаль на student-side
  assert.equal(numericRoundingMatch("0,2", "0.2"), true, "RU comma decimal");
  // null: один из аргументов не numeric — caller fallback на строковое сравнение
  assert.equal(numericRoundingMatch("abc", "5"), null, "non-numeric → null");
});

test("checkPart1Answer: AC-P3 strict mode rounding fallback", () => {
  // PASS — 0.216 vs 0.2 → max_score
  assert.deepEqual(
    checkPart1Answer({ correctAnswer: "0.2", studentAnswer: "0.216", checkMode: "strict", maxScore: 1 }),
    { earnedScore: 1, isCorrect: true },
  );
  // FAIL — 0.3 vs 0.2 → 0
  assert.deepEqual(
    checkPart1Answer({ correctAnswer: "0.2", studentAnswer: "0.3", checkMode: "strict", maxScore: 1 }),
    { earnedScore: 0, isCorrect: false },
  );
  // PASS — RU locale + rounding
  assert.deepEqual(
    checkPart1Answer({ correctAnswer: "0.2", studentAnswer: "0,216", checkMode: "strict", maxScore: 1 }),
    { earnedScore: 1, isCorrect: true },
  );
  // FAIL — 5.5 vs 5 (рubric: НЕ округляем шире scale of correct)
  assert.deepEqual(
    checkPart1Answer({ correctAnswer: "5", studentAnswer: "5.5", checkMode: "strict", maxScore: 1 }),
    { earnedScore: 0, isCorrect: false },
  );
  // Non-numeric student — fallback to string compare, FAIL
  assert.deepEqual(
    checkPart1Answer({ correctAnswer: "5", studentAnswer: "abc", checkMode: "strict", maxScore: 1 }),
    { earnedScore: 0, isCorrect: false },
  );
});

test("AC-P3 guardrail: rounding tolerance does NOT bleed into other modes", () => {
  // ordered: 0.216 vs 0.2 трактуется как разные токены, не numeric match
  assert.deepEqual(
    checkPart1Answer({ correctAnswer: "0.2", studentAnswer: "0.216", checkMode: "ordered", maxScore: 1 }),
    { earnedScore: 0, isCorrect: false },
  );
  // multi_choice: digits-only set — другая семантика
  assert.deepEqual(
    checkPart1Answer({ correctAnswer: "13", studentAnswer: "1.3", checkMode: "multi_choice", maxScore: 1 }),
    { earnedScore: 0, isCorrect: false },
  );
});

test("checkPart1Answer: max_score=2 binary semantics", () => {
  // Some Part 1 tasks (e.g. №21 диаграмма) дают 2 балла binary — чек тот же,
  // только maxScore другой.
  const r = checkPart1Answer({
    correctAnswer: "1,3,2",
    studentAnswer: "1,3,2",
    checkMode: "ordered",
    maxScore: 2,
  });
  assert.equal(r.earnedScore, 2);
  assert.equal(r.isCorrect, true);
});

// ────────────────────────────────────────────────────────────────────────────
// AC-P4 (mock-exams-v1-pilot-polish 2026-05-25) — ФИПИ 2026 partial credit
// для multi_choice (KIM 5/9/14/18) и ordered (KIM 6/10/15/17). См. .claude/rules/45-mock-exams.md.
// ────────────────────────────────────────────────────────────────────────────

test("AC-P4: gradeMultiChoice — full credit для exact set match", () => {
  assert.equal(gradeMultiChoice("12", "12", 2), 2);
  assert.equal(gradeMultiChoice("12", "21", 2), 2, "order doesn't matter");
  assert.equal(gradeMultiChoice("123", "321", 2), 2);
  assert.equal(gradeMultiChoice("123", "132", 2), 2);
  assert.equal(gradeMultiChoice("123", "213", 2), 2);
});

test("AC-P4: gradeMultiChoice — partial для 1 substitution", () => {
  // correct="12": "32" → set {2,3} → 1 error (substitute 1→3)
  assert.equal(gradeMultiChoice("12", "32", 2), 1);
  assert.equal(gradeMultiChoice("12", "23", 2), 1);
  assert.equal(gradeMultiChoice("12", "42", 2), 1);
  assert.equal(gradeMultiChoice("12", "24", 2), 1);
  assert.equal(gradeMultiChoice("12", "52", 2), 1);
  assert.equal(gradeMultiChoice("12", "25", 2), 1);
  // 3-digit correct: one position substituted
  assert.equal(gradeMultiChoice("123", "124", 2), 1);
  assert.equal(gradeMultiChoice("123", "143", 2), 1);
  assert.equal(gradeMultiChoice("123", "423", 2), 1);
});

test("AC-P4: gradeMultiChoice — partial для 1 extra digit", () => {
  // correct="12": "123" → set {1,2,3} → 1 error (extra "3")
  assert.equal(gradeMultiChoice("12", "123", 2), 1);
  assert.equal(gradeMultiChoice("12", "312", 2), 1);
  assert.equal(gradeMultiChoice("12", "213", 2), 1);
  // 3-digit correct: 4-digit student
  assert.equal(gradeMultiChoice("123", "1234", 2), 1);
  assert.equal(gradeMultiChoice("123", "5123", 2), 1);
});

test("AC-P4: gradeMultiChoice — partial для 1 missing digit", () => {
  // correct="12": "22" → toSet → {2} (dedup) → 1 error (missing "1")
  assert.equal(gradeMultiChoice("12", "22", 2), 1);
  // correct="123": "12" → 1 error (missing "3")
  assert.equal(gradeMultiChoice("123", "12", 2), 1);
  assert.equal(gradeMultiChoice("123", "13", 2), 1);
  assert.equal(gradeMultiChoice("123", "23", 2), 1);
});

test("AC-P4: gradeMultiChoice — 0 для 2+ errors", () => {
  // correct="12": "33" → set {3} → matches=0, max(2,1)-0=2 errors → 0
  assert.equal(gradeMultiChoice("12", "33", 2), 0);
  // correct="12": "45" → 0 matches, max(2,2)-0=2 errors → 0
  assert.equal(gradeMultiChoice("12", "45", 2), 0);
  // 2 extras + 0 wrong (matches=2, max(2,4)-2=2 errors)
  assert.equal(gradeMultiChoice("12", "1234", 2), 0);
  // 2 wrong + 1 right
  assert.equal(gradeMultiChoice("123", "145", 2), 0);
  // All wrong
  assert.equal(gradeMultiChoice("123", "456", 2), 0);
});

test("AC-P4: gradeMultiChoice — edge cases", () => {
  // Empty student → 0
  assert.equal(gradeMultiChoice("12", "", 2), 0);
  // Empty correct → 0 (defensive — shouldn't happen in real data)
  assert.equal(gradeMultiChoice("", "12", 2), 0);
  // Separator-agnostic (reuse toSet parsing)
  assert.equal(gradeMultiChoice("12", "1,2", 2), 2);
  assert.equal(gradeMultiChoice("1,2", "12", 2), 2);
  // maxScore=1 (defensive — partial credit only applies if maxScore>=2)
  assert.equal(gradeMultiChoice("12", "32", 1), 0, "no partial when maxScore<2");
});

test("AC-P4: gradeMultiChoice — Егор pilot screenshot reproductions", () => {
  // Скриншот 2 пользователя: KIM 5 / 2, AI: 12, Верно: 123 → должно быть 1
  assert.equal(gradeMultiChoice("123", "12", 2), 1, "Egor KIM 5: 12 vs 123 → 1 missing");
  // Скриншот 3 пользователя: KIM 18 / 2, AI: 345, Верно: 35 → должно быть 1
  assert.equal(gradeMultiChoice("35", "345", 2), 1, "Egor KIM 18: 345 vs 35 → 1 extra");
});

test("AC-P4: gradeOrdered — full credit для exact match", () => {
  assert.equal(gradeOrdered("12", "12", 2), 2);
  assert.equal(gradeOrdered("1,2", "12", 2), 2, "separator-agnostic");
  assert.equal(gradeOrdered("12", "1,2", 2), 2, "separator-agnostic");
});

test("AC-P4: gradeOrdered — partial для 1 wrong position", () => {
  // correct="12":
  assert.equal(gradeOrdered("12", "22", 2), 1, "pos 0 wrong (substitute 1→2)");
  assert.equal(gradeOrdered("12", "32", 2), 1, "pos 0 wrong");
  assert.equal(gradeOrdered("12", "42", 2), 1, "pos 0 wrong");
  assert.equal(gradeOrdered("12", "11", 2), 1, "pos 1 wrong (substitute 2→1)");
  assert.equal(gradeOrdered("12", "13", 2), 1, "pos 1 wrong");
  assert.equal(gradeOrdered("12", "14", 2), 1, "pos 1 wrong");
});

test("AC-P4: gradeOrdered — 0 для both positions wrong", () => {
  // correct="12":
  assert.equal(gradeOrdered("12", "21", 2), 0, "both wrong (swap)");
  assert.equal(gradeOrdered("12", "33", 2), 0, "both wrong");
  assert.equal(gradeOrdered("12", "31", 2), 0, "both wrong");
  assert.equal(gradeOrdered("12", "44", 2), 0, "both wrong");
});

test("AC-P4: gradeOrdered — 0 для length mismatch (ФИПИ explicit)", () => {
  // ФИПИ: «Если количество символов в ответе больше требуемого, выставляется 0 баллов»
  assert.equal(gradeOrdered("12", "123", 2), 0, "extra digit → 0");
  assert.equal(gradeOrdered("12", "1234", 2), 0, "2 extras → 0");
  // Too short
  assert.equal(gradeOrdered("12", "1", 2), 0, "missing digit → 0");
});

test("AC-P4: gradeOrdered — edge cases", () => {
  // Empty student → 0
  assert.equal(gradeOrdered("12", "", 2), 0);
  // Empty correct → 0
  assert.equal(gradeOrdered("", "12", 2), 0);
  // maxScore=1 → no partial
  assert.equal(gradeOrdered("12", "13", 1), 0, "no partial when maxScore<2");
});

test("AC-P4: gradeOrdered — Егор pilot screenshot reproduction", () => {
  // Скриншот 2 пользователя: KIM 6 / 2, AI: 33, Верно: 32 → должно быть 1
  assert.equal(gradeOrdered("32", "33", 2), 1, "Egor KIM 6: pos 1 wrong (3 vs 2)");
});

test("AC-P4 guardrail: gradeOrdered ≠ gradeMultiChoice for swap", () => {
  // correct="12": "21" — order matters for ordered, doesn't for multi_choice
  assert.equal(gradeOrdered("12", "21", 2), 0, "ordered: both positions wrong → 0");
  assert.equal(gradeMultiChoice("12", "21", 2), 2, "multi_choice: set equal → 2");
});

test("AC-P4: checkPart1Answer dispatches multi_choice with partial", () => {
  // KIM 5/9/14/18: max_score=2, partial credit
  const r1 = checkPart1Answer({
    correctAnswer: "12",
    studentAnswer: "32",
    checkMode: "multi_choice",
    maxScore: 2,
  });
  assert.equal(r1.earnedScore, 1, "1 substitution → 1 балл");
  assert.equal(r1.isCorrect, false, "partial не is_correct (есть 1 ошибка)");

  // Full match
  const r2 = checkPart1Answer({
    correctAnswer: "12",
    studentAnswer: "21",
    checkMode: "multi_choice",
    maxScore: 2,
  });
  assert.equal(r2.earnedScore, 2);
  assert.equal(r2.isCorrect, true);

  // 2+ errors → 0
  const r3 = checkPart1Answer({
    correctAnswer: "12",
    studentAnswer: "45",
    checkMode: "multi_choice",
    maxScore: 2,
  });
  assert.equal(r3.earnedScore, 0);
  assert.equal(r3.isCorrect, false);
});

test("AC-P4: checkPart1Answer dispatches ordered with partial", () => {
  // KIM 6/10/15/17: max_score=2, partial credit
  const r1 = checkPart1Answer({
    correctAnswer: "12",
    studentAnswer: "32",
    checkMode: "ordered",
    maxScore: 2,
  });
  assert.equal(r1.earnedScore, 1, "1 position wrong → 1 балл");
  assert.equal(r1.isCorrect, false);

  // Both wrong → 0
  const r2 = checkPart1Answer({
    correctAnswer: "12",
    studentAnswer: "21",
    checkMode: "ordered",
    maxScore: 2,
  });
  assert.equal(r2.earnedScore, 0);
});

test("AC-P4 guardrail: partial credit ТОЛЬКО для multi_choice + ordered", () => {
  // strict mode: 1-digit diff still binary (no partial credit для strict)
  const r1 = checkPart1Answer({
    correctAnswer: "250",
    studentAnswer: "249",
    checkMode: "strict",
    maxScore: 1,
  });
  assert.equal(r1.earnedScore, 0, "strict: 1-digit diff still 0");

  // unordered: 1-element diff — binary (legacy behaviour, no partial)
  const r2 = checkPart1Answer({
    correctAnswer: "1,2,3",
    studentAnswer: "1,2,4",
    checkMode: "unordered",
    maxScore: 2,
  });
  assert.equal(r2.earnedScore, 0, "unordered: no partial credit");

  // task20: any digit diff is binary 0
  const r3 = checkPart1Answer({
    correctAnswer: "312",
    studentAnswer: "412",
    checkMode: "task20",
    maxScore: 2,
  });
  assert.equal(r3.earnedScore, 0, "task20: no partial credit");
});

// ────────────────────────────────────────────────────────────────────────────
// ordered_lenient — обществознание ЕГЭ № 6/13/15 (критерии Милады, 2026-07-22):
// «1 ошибка (неверный символ, ЛИШНЯЯ или НЕДОСТАЮЩАЯ позиция) — 1 балл; две и
// более — 0; цифры верны, но не в той последовательности — 0». Левенштейн ≤ 1.
// НЕ физический ordered (там длина ≠ → 0 по ФИПИ-физике).
// ────────────────────────────────────────────────────────────────────────────

test("ordered_lenient: full credit для exact match", () => {
  assert.equal(gradeOrderedLenient("22211", "22211", 2), 2);
  assert.equal(gradeOrderedLenient("2,2,2,1,1", "22211", 2), 2, "separator-agnostic");
});

test("ordered_lenient: 1 балл за лишнюю/недостающую позицию (скриншот Милады №15)", () => {
  // Скриншот 4 Милады: correct «22211», student «222111» → должен быть 1 (был 0)
  assert.equal(gradeOrderedLenient("22211", "222111", 2), 1, "Милада №15: лишняя позиция → 1");
  assert.equal(gradeOrderedLenient("22211", "2211", 2), 1, "недостающая позиция → 1");
  assert.equal(gradeOrderedLenient("22211", "22212", 2), 1, "1 неверный символ → 1");
});

test("ordered_lenient: 0 за 2+ ошибки и транспозицию", () => {
  assert.equal(gradeOrderedLenient("12345", "13245", 2), 0, "транспозиция (не в той последовательности) → 0");
  assert.equal(gradeOrderedLenient("22211", "21122", 2), 0, "2+ замен → 0");
  assert.equal(gradeOrderedLenient("22211", "2221133", 2), 0, "2 лишних позиции → 0");
  assert.equal(gradeOrderedLenient("22211", "222", 2), 0, "2 недостающих → 0");
});

test("ordered_lenient: edge cases", () => {
  assert.equal(gradeOrderedLenient("12", "", 2), 0, "пустой ответ → 0");
  assert.equal(gradeOrderedLenient("", "12", 2), 0, "пустой эталон → 0");
  assert.equal(gradeOrderedLenient("12", "13", 1), 0, "нет частичного при maxScore<2");
});

test("ordered_lenient: dispatch через checkPart1Answer", () => {
  const r1 = checkPart1Answer({
    correctAnswer: "22211",
    studentAnswer: "222111",
    checkMode: "ordered_lenient",
    maxScore: 2,
  });
  assert.equal(r1.earnedScore, 1, "лишняя позиция → 1 балл");
  assert.equal(r1.isCorrect, false);

  const r2 = checkPart1Answer({
    correctAnswer: "33123",
    studentAnswer: "33123",
    checkMode: "ordered_lenient",
    maxScore: 2,
  });
  assert.deepEqual(r2, { earnedScore: 2, isCorrect: true });
});

test("guardrail: физический ordered НЕ изменился (длина ≠ → 0)", () => {
  assert.equal(gradeOrdered("22211", "222111", 2), 0, "ФИПИ-физика: символов больше → 0");
});

// ────────────────────────────────────────────────────────────────────────────
// task20 для обществознания № 1/3/9/12 — «набор цифр, порядок неважен, любая
// ошибка → 0» (скриншот Милады: «32» при верном «23» должен давать полный балл).
// ────────────────────────────────────────────────────────────────────────────

test("task20 как режим social №1/3/9/12: порядок неважен, всё-или-ничего", () => {
  // Скриншот 4 Милады, №1: correct «23», student «32» → полный балл (был 0 при strict)
  assert.deepEqual(
    checkPart1Answer({ correctAnswer: "23", studentAnswer: "32", checkMode: "task20", maxScore: 1 }),
    { earnedScore: 1, isCorrect: true },
  );
  // Любая ошибка → 0
  assert.deepEqual(
    checkPart1Answer({ correctAnswer: "23", studentAnswer: "24", checkMode: "task20", maxScore: 1 }),
    { earnedScore: 0, isCorrect: false },
  );
  // Лишняя цифра → 0 (длина учитывается)
  assert.deepEqual(
    checkPart1Answer({ correctAnswer: "23", studentAnswer: "233", checkMode: "task20", maxScore: 1 }),
    { earnedScore: 0, isCorrect: false },
  );
});

test("AC-P4: backward compat — checkMultiChoice/checkOrdered (boolean) still work", () => {
  // Старые helpers сохранены для tests + clarity
  assert.equal(checkMultiChoice("12", "12"), true);
  assert.equal(checkMultiChoice("12", "32"), false, "1 error не full match");
  assert.equal(checkOrdered("1,3,2", "1,3,2"), true);
  assert.equal(checkOrdered("12", "32"), false, "1 error не full match");
});
