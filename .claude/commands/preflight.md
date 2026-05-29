---
description: SokratAI pre-merge gate — RU-bypass grep, typecheck, smoke-check, build + QA/deploy reminders. Run before any commit or merge.
allowed-tools: Bash(git diff:*), Bash(git status:*), Bash(npm run smoke-check), Bash(npm run typecheck), Bash(npm run build), Bash(npx tsc:*)
---

You are running SokratAI's **pre-merge gate**. Execute the checks below **sequentially** (never run `build` and `smoke-check` at the same time — they collide in `dist/`). Then print a compact PASS/FAIL table and a single **GO / NO-GO** verdict. This is a read-only gate: do NOT commit, push, or deploy — the human decides.

If `$ARGUMENTS` is non-empty, treat it as a scope hint (a subsystem to pay extra attention to); otherwise check the whole staged set.

## 1 · RU-bypass guard — HARD BLOCKER
The #1 production rule: client code must never reach the RU-blocked direct Supabase domain (`AGENTS.md` → "CRITICAL — Network & RU bypass").
- Run `git diff --staged -- src | grep -nE "supabase\.co"`. If nothing is staged, run `git diff -- src | grep -nE "supabase\.co"` and note you are checking the working tree, not the index.
- **FAIL** if any non-comment line in `src/**` contains `*.supabase.co` (other than `api.sokratai.ru`), `${...}.supabase.co`, `VITE_SUPABASE_URL`, or an `@/integrations/supabase/client` import — that breaks `sokratai.ru` for every RU user without a VPN.
- IGNORE comment lines and `api.sokratai.ru`. Edge functions (`supabase/functions/**`) legitimately use `*.supabase.co` via `rewriteToDirect` — out of scope for this gate.

## 2 · Typecheck — HARD GATE
`npm run build` uses esbuild and does **NOT** typecheck. Run `npm run typecheck` (or `npx tsc --noEmit` if that script is absent). **FAIL** on any type error.

## 3 · Smoke-check — HARD GATE
Run `npm run smoke-check` (the CI quality gate: anti-leak whitelists, dual write-paths, criteria-templates, `refetchOnWindowFocus` invariant, …). **FAIL** on non-zero exit; surface the exact failing section.

## 4 · Build — HARD GATE
Run `npm run build` (compile sanity). **FAIL** on error. Run AFTER smoke-check, never concurrently.

## 5 · Constructor QA — REMINDER (conditional)
If the diff touches `TutorHomeworkCreate.tsx`, `HWTasksSection.tsx`, `HWTaskCard.tsx`, or `HWMaterialsSection.tsx`: remind that rule 40's manual homework-constructor QA checklist must be run, and the commit message must carry `Manual QA: checklist в .claude/rules/40-homework-system.md пройден`.

## 6 · Deploy — REMINDER (conditional)
If the diff touches `src/**`, `index.html`, `package.json`, `vite.config.ts`, `tailwind.config.ts`, or `public/**`: remind that `sokratai.ru` does NOT auto-update — after merge to `main`, run `deploy-sokratai` on the VPS (rule 95), and add the "🚀 Deploy needed" block to the final message.

## Verdict
Print one line per check (✅/❌ for gates 1–4, ℹ️ for reminders 5–6), then:
- **GO** — all hard gates pass.
- **NO-GO** — list exactly what to fix, in order.
