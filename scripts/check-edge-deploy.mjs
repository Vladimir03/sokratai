#!/usr/bin/env node
/**
 * Edge-function deployment probe.
 *
 * Walks every function in supabase/functions/ and sends an OPTIONS request to
 * https://api.sokratai.ru/functions/v1/<fn>. Interpretation (rule 95 / 96):
 *   200/204/40x/405 → deployed and booting
 *   404             → NOT DEPLOYED (Supabase gateway NOT_FOUND_FUNCTION_BLOB)
 *   503             → deployed but BOOT-CRASHING (broken import / missing export)
 *
 * Context: on 2026-07-14 production was found serving 404 for 45 of 57
 * functions — Lovable had silently lost most of the deployed set (broke auth
 * emails, telegram-bot, YooKassa webhook, invites, manual student add).
 * Client symptom of a missing function: toast "Failed to send a request to
 * the Edge Function" (supabase-js FunctionsFetchError).
 *
 * Usage:  node scripts/check-edge-deploy.mjs
 * Exit code 1 when any function is missing or boot-crashing.
 * Recovery: ask the Lovable agent to redeploy the listed functions (or touch
 * each function file + push so the Lovable sync redeploys it).
 */

import { readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://api.sokratai.ru/functions/v1";
const FUNCTIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "functions");
const CONCURRENCY = 8;
const TIMEOUT_MS = 15000;

const names = readdirSync(FUNCTIONS_DIR)
  .filter((n) => !n.startsWith("_") && statSync(join(FUNCTIONS_DIR, n)).isDirectory())
  .sort();

async function probe(name) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/${name}`, { method: "OPTIONS", signal: controller.signal });
    return { name, status: res.status };
  } catch {
    return { name, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

const results = [];
for (let i = 0; i < names.length; i += CONCURRENCY) {
  const batch = names.slice(i, i + CONCURRENCY);
  results.push(...(await Promise.all(batch.map(probe))));
}

// Explicit allow-list: statuses proving the function is deployed AND booting.
// Anything else (5xx from the function, gateway oddities) counts as a failure —
// green output must never be reachable by exclusion (P1 review 2026-07-14:
// the old subtraction-based `ok` painted 61 timeouts / any 500 as ✅).
const OK_STATUSES = new Set([200, 204, 301, 302, 400, 401, 403, 405, 422, 429]);

const missing = results.filter((r) => r.status === 404);
const crashing = results.filter((r) => r.status === 503);
const unreachable = results.filter((r) => r.status === 0);
const badStatus = results.filter(
  (r) => r.status !== 0 && r.status !== 404 && r.status !== 503 && !OK_STATUSES.has(r.status),
);
const ok = results.filter((r) => OK_STATUSES.has(r.status));

console.log(`Edge deploy probe: ${results.length} functions, ${ok.length} OK`);
if (missing.length) {
  console.error(`\n❌ NOT DEPLOYED (404) — ${missing.length}:`);
  for (const r of missing) console.error(`   ${r.name}`);
}
if (crashing.length) {
  console.error(`\n❌ BOOT-CRASH (503) — ${crashing.length}:`);
  for (const r of crashing) console.error(`   ${r.name}`);
}
if (badStatus.length) {
  console.error(`\n❌ UNEXPECTED STATUS — ${badStatus.length}:`);
  for (const r of badStatus) console.error(`   ${r.status} ${r.name}`);
}
if (unreachable.length) {
  console.error(`\n⚠️ UNREACHABLE (timeout/network) — ${unreachable.length}: ${unreachable.map((r) => r.name).join(", ")}`);
}

if (missing.length || crashing.length || badStatus.length) {
  console.error("\nRecovery: Lovable agent → redeploy the functions above (see rule 95).");
  process.exit(1);
}
if (unreachable.length) {
  console.error("\nInconclusive: network failures — re-run when connectivity is stable.");
  process.exit(2);
}
console.log("✅ all edge functions deployed and booting");
