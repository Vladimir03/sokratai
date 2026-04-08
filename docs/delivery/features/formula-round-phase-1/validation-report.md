# Formula Round Phase 1 — Validation Report

**Date:** 2026-04-08
**Branch:** main (uncommitted trainer pivot)
**Target env:** Supabase project `vrsseotrfmsxpbciyqzc` + Lovable preview
**Reviewer:** Claude Code (static gate only)
**Manual runtime gate:** pending — see `qa-runbook.md`

## TL;DR

**NO-GO until manual runbook is executed AND finding F-1 is resolved.**

Static gate is clean (lint/build/smoke green, legacy removed, lazy chunk emitted, RLS policy present in migration). But one deploy/config BLOCKER was found that must be verified before any merge, and all runtime ACs (AC-1..4, 6, 7, 8, 11) still require a real browser + real Supabase.

## Static gate results (executed by Claude)

| Check | Command | Result | Notes |
|---|---|---|---|
| Lint (trainer files) | `npm run lint \| grep -iE 'trainer\|formula-round'` | ✅ Pass | Zero trainer-related lint errors. Pre-existing lint noise in unrelated files (telegram-bot, chat/index.ts) is baseline, not a regression. |
| Build | `npm run build` | ✅ Pass | `built in 19.05s`, no errors. |
| Smoke-check | `npm run smoke-check` | ✅ Pass | All guardrails green. |
| Lazy chunk (AC-9) | `dist/assets/TrainerPage-*.js` | ✅ Pass | `TrainerPage-BgKLmxWC.js` — 38.25 kB raw / 12.29 kB gzip. Separate chunk, not in main bundle. |
| Legacy removed (AC-10) | `grep -rn 'StudentFormulaRound\|formulaRoundApi\|useFormulaRound' src/` | ✅ Pass | Empty output. |
| No homework imports (AC-5) | `grep -rnE 'homework\|studentHomework' src/pages/TrainerPage.tsx src/lib/trainerApi.ts src/hooks/useTrainerSession.ts` | ✅ Pass | Empty output. |
| RLS policy in migration | `supabase/migrations/20260408160000_trainer_standalone_schema.sql:74-80` | ✅ Pass (file) | Policy `trainer_results_no_anon_read FOR SELECT TO anon USING (false)` is defined. **Runtime confirmation still required (AC-11).** |

## AC-by-AC status

| AC | Description | Status | Notes |
|---|---|---|---|
| AC-1 | `/trainer` renders without auth, no redirect | ⏸ Blocked | Runbook §AC-1. Needs Chrome Incognito on live URL. |
| AC-2 | Full 10-question round playable end-to-end | ⏸ Blocked | Runbook §AC-2. |
| AC-3 | `trainer_session_id` (16 chars) in localStorage | ⏸ Blocked | Runbook §AC-3. Code review confirms generator exists; runtime not verified. |
| AC-4 | POST `trainer-submit` returns 200 with full payload shape | ⏸ Blocked | Runbook §AC-4. **See F-1 below — current live pre-flight returned 404 NOT_FOUND.** |
| AC-5 | No homework/studentHomework imports in trainer module | ✅ Pass | Static grep clean. |
| AC-6 | «Пройти ещё раз» reuses same `session_id` | ⏸ Blocked | Runbook §AC-6. |
| AC-7 | iOS Safari parity (100dvh, no auto-zoom, no tap delay) | ⏸ Blocked | Runbook §AC-7. Needs real iPhone or Mac Safari Develop menu. |
| AC-8 | Rate limit: 20 requests / 10 min per ip_hash → 429 | ⏸ Blocked — **BLOCKER gate** | Runbook §AC-8. Migration defines `idx_formula_round_results_trainer_recent` and function defines `RATE_LIMIT_MAX_SUBMITS = 20`, `RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000`. Must be verified at runtime. |
| AC-9 | Trainer lazy-loaded as own chunk | ✅ Pass | `TrainerPage-BgKLmxWC.js` 38.25 kB in `dist/assets/`. |
| AC-10 | Legacy preview-flow removed | ✅ Pass | Static grep clean. |
| AC-11 | Anon cannot SELECT trainer rows | ⏸ Blocked — **BLOCKER gate** | Runbook §AC-11. Policy exists in migration file; runtime enforcement not verified on target project. |

Legend: ✅ Pass · ❌ Fail · ⏸ Blocked (needs manual runbook) · 🟡 Partial

## Findings

### F-1 — **`trainer-submit` missing from config and deploy workflow — confirmed BLOCKER**

**Severity:** High. Blocks AC-4 entirely and makes AC-1/6/7 impossible to validate end-to-end.

**Evidence:**
- `supabase/config.toml` lists `verify_jwt` flags for every public edge function (`chat`, `telegram-bot`, `homework-reminder`, etc.) but has **no entry** for `trainer-submit`.
- `.github/workflows/deploy-supabase-functions.yml` deploys a fixed allow-list of functions and **did not include** `trainer-submit` at all.
- Live pre-flight POST to `https://vrsseotrfmsxpbciyqzc.functions.supabase.co/trainer-submit` returned HTTP 404:
  ```json
  { "code": "NOT_FOUND", "message": "Requested function was not found" }
  ```
- Supabase CLI default is `verify_jwt = true`. Even after deployment, missing config would still risk anon POSTs being rejected with HTTP 401 `Invalid JWT` before the function body executes.
- `.claude/rules/40-homework-system.md` explicitly documents: "`trainer-submit` — публичный endpoint без JWT-check". The config file does not reflect this.
- The function source (`supabase/functions/trainer-submit/index.ts`) does not read `Authorization`, consistent with the intent of being public — but that only matters if the function is deployed and the gateway lets the request through.

**Why static gate didn't catch it earlier:** lint/build/smoke don't touch Supabase config. It's only visible when you either (a) read `config.toml` or (b) hit the deployed function with `curl`.

**Proposed fix:** Do both:

```toml
[functions.trainer-submit]
verify_jwt = false
```

And include the function in the deploy workflow:

```yaml
supabase functions deploy trainer-submit --no-verify-jwt
```

Then redeploy the function.

**Verification step:** Runbook pre-flight step 4 now distinguishes:
- `400 invalid_payload` → function exists and is publicly invokable, continue.
- `401 Invalid JWT` → deployed but verify_jwt policy still wrong.
- `404 NOT_FOUND` → function not deployed to the target project ref.

**Status after this finding:** repo fix prepared, runtime still pending redeploy. Do not merge based on repo state alone; re-run the curl after deployment.

### F-2 — Pre-existing lint noise (non-blocking, not a regression)

`npm run lint` reports 194 errors / 31 warnings across `supabase/functions/chat/index.ts`, `telegram-bot/`, `tailwind.config.ts`, etc. **Zero** of them are in trainer files (`TrainerPage.tsx`, `trainerApi.ts`, `useTrainerSession.ts`, `formulaEngine/*`). This is existing tech debt unrelated to Phase 1 and should not block the merge, but is noted for awareness.

### F-3 — Schema drift caveat already documented

CLAUDE.md and the migration file both acknowledge that the current table uses `student_id` / `round_id` / `duration_seconds` (not `user_id` / `formula_round_id` / `duration_ms`). The edge function and frontend payload already send `duration_ms` in the request body and `trainer-submit` is expected to convert/store appropriately. Runbook AC-4 backend sanity query reads `duration_seconds` from the row — worth spot-checking that the conversion happens server-side and the stored value is sane (e.g. ~ 120 s for a ~2 min round).

## Next actions for Vladimir

1. **Resolve F-1 first.** Deploy `trainer-submit` to project `vrsseotrfmsxpbciyqzc` and keep `verify_jwt = false`. Re-run the pre-flight curl from `qa-runbook.md` §4. Do not proceed until it returns 400 on an empty body.
2. Run the full runbook in Chrome (Windows) + iOS Safari.
3. **Hard gate on AC-8 and AC-11.** Either fails → do not push to Lovable, do not merge. Both are exploit-class regressions if shipped broken.
4. Fill this table (replace ⏸ with ✅ / ❌) and hand back for final GO/NO-GO.
5. Only after all rows are ✅: `git push`.

## Appendix: raw evidence

### Build output (trainer chunk)

```
dist/assets/TrainerPage-BgKLmxWC.js    38.25 kB │ gzip:  12.29 kB
✓ built in 19.05s
```

### Migration policy

```sql
-- supabase/migrations/20260408160000_trainer_standalone_schema.sql:74-80
DROP POLICY IF EXISTS trainer_results_no_anon_read ON public.formula_round_results;

CREATE POLICY trainer_results_no_anon_read
  ON public.formula_round_results
  FOR SELECT
  TO anon
  USING (false);
```

### Rate-limit constants in function

```ts
// supabase/functions/trainer-submit/index.ts:19-20
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_SUBMITS = 20;
```
