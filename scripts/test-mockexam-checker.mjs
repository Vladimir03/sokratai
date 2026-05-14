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
// task20 — mapping
// ────────────────────────────────────────────────────────────────────────────

test("checkTask20: exact digit-mapping", () => {
  assert.equal(checkTask20("31", "31"), true);
  assert.equal(checkTask20("312", "3,1,2"), true, "separators stripped");
  assert.equal(checkTask20("312", "3 1 2"), true, "whitespace stripped");
  assert.equal(checkTask20("312", "321"), false, "different mapping");
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
