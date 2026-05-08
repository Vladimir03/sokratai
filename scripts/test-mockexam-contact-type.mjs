#!/usr/bin/env node
// Mock Exams v1 — unit tests for `detectContactType` heuristic.
//
// Same loader pattern as `scripts/test-mockexam-checker.mjs`: transpile the
// .ts source via esbuild (already a Vite dep), import compiled module via
// data: URL, run assertions with node:test.
//
// Run: node scripts/test-mockexam-contact-type.mjs
//
// Spec: docs/delivery/features/mock-exams-v1/spec.md AC-6 (lead capture).
// Why this test exists: an inline heuristic in PublicMockInvite previously
// classified `@username` as email (because it «contains @»). A real lead
// (Telegram `@misha_dad`) saw "репетитор свяжется в email" instead of
// "в Telegram" — caught only in smoke 2026-05-07. Test locks the contract
// so the regression can't sneak back.

import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { transformSync } from "esbuild";

const sourcePath = new URL("../src/lib/mockExamContactType.ts", import.meta.url);
const source = readFileSync(sourcePath, "utf8");
const compiled = transformSync(source, { loader: "ts", format: "esm" }).code;
const dataUrl = "data:text/javascript;base64," + Buffer.from(compiled).toString("base64");
const mod = await import(dataUrl);

const { detectContactType } = mod;

// ────────────────────────────────────────────────────────────────────────────
// Telegram cases (leading @, bare username, phone, t.me link)
// ────────────────────────────────────────────────────────────────────────────

test("detectContactType: leading @ → telegram (regression guard)", () => {
  assert.equal(detectContactType("@misha_dad"), "telegram");
  assert.equal(detectContactType("@anna_mom_2"), "telegram");
  assert.equal(detectContactType("@a"), "telegram");
});

test("detectContactType: bare username → telegram", () => {
  assert.equal(detectContactType("misha_dad"), "telegram");
  assert.equal(detectContactType("anna_mom_2026"), "telegram");
});

test("detectContactType: phone → telegram (no @)", () => {
  assert.equal(detectContactType("+79991234567"), "telegram");
  assert.equal(detectContactType("89991234567"), "telegram");
});

test("detectContactType: t.me link → telegram (no @)", () => {
  assert.equal(detectContactType("t.me/misha_dad"), "telegram");
  assert.equal(detectContactType("https://t.me/misha_dad"), "telegram");
});

// ────────────────────────────────────────────────────────────────────────────
// Email cases (non-leading @)
// ────────────────────────────────────────────────────────────────────────────

test("detectContactType: standard email → email", () => {
  assert.equal(detectContactType("parent@example.com"), "email");
  assert.equal(detectContactType("anna.kuznetsova@yandex.ru"), "email");
  assert.equal(detectContactType("a@b.co"), "email");
});

// ────────────────────────────────────────────────────────────────────────────
// Edge cases (whitespace, empty, double @)
// ────────────────────────────────────────────────────────────────────────────

test("detectContactType: leading whitespace stripped before classification", () => {
  assert.equal(detectContactType("  @misha_dad"), "telegram");
  assert.equal(detectContactType("  parent@example.com"), "email");
});

test("detectContactType: empty string → telegram (default)", () => {
  // Empty / whitespace: server validation will reject anyway, but the
  // heuristic must not throw and must return a stable default. Telegram
  // is the wedge primary contact channel, so default there.
  assert.equal(detectContactType(""), "telegram");
  assert.equal(detectContactType("   "), "telegram");
});

test("detectContactType: double @ at start → telegram (still leading)", () => {
  // Pathological input — server will reject. Heuristic stays consistent.
  assert.equal(detectContactType("@@parent"), "telegram");
});
