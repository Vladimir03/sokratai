# Formula Round Phase 1 — QA Runbook (manual)

Supabase project ref: **vrsseotrfmsxpbciyqzc**
Functions host: `https://vrsseotrfmsxpbciyqzc.functions.supabase.co`

Run the static gate first (see `validation-report.md`). This runbook covers the runtime ACs that require a real browser, a real device (iOS Safari), and a live Supabase.

After each step, record `Pass / Fail / Note` in `validation-report.md`.

---

## Pre-flight

1. Confirm the standalone migration is applied on `vrsseotrfmsxpbciyqzc`:
   - Supabase Studio → Database → Migrations → look for `20260408160000_trainer_standalone_schema`.
   - If missing: stop, apply it, do not continue.
2. Confirm `trainer-submit` edge function is deployed (Studio → Edge Functions → `trainer-submit`).
3. Confirm secrets exist on that function: `TRAINER_IP_SALT`, `SUPABASE_SERVICE_ROLE_KEY` (or `SERVICE_ROLE_KEY`).
4. **Critical deploy/config check (see validation report finding F-1):** verify `trainer-submit` is deployed and invokable by anon. Quickest way:

   ```bash
   curl -i -X POST 'https://vrsseotrfmsxpbciyqzc.functions.supabase.co/trainer-submit' \
     -H 'content-type: application/json' \
     -d '{}'
   ```

   - Expected: HTTP 400 with JSON `{ "error": "invalid_payload", ... }` (function reached, payload rejected).
   - If HTTP 404 `NOT_FOUND` → **BLOCKER**. The function is not deployed to project `vrsseotrfmsxpbciyqzc`. Deploy `trainer-submit` first, then re-run the curl.
   - If HTTP 401 `Invalid JWT` → **BLOCKER**. Add to `supabase/config.toml`:
     ```toml
     [functions.trainer-submit]
     verify_jwt = false
     ```
     then redeploy. This is the default Supabase behavior — missing config = verify_jwt true.

---

## AC-1 — `/trainer` renders without auth (Chrome, Windows)

1. Open Chrome in Incognito → navigate to `https://sokratai.lovable.app/trainer` (or the preview URL).
2. Observe: HTTP 200, landing screen rendered, **no redirect** to `/login`.
3. DevTools → Network: first document response is 200, not 302.

**Record:** AC-1 Pass/Fail.

## AC-2 — Landing → round → 10 questions → result

1. Click the start button on the landing.
2. Play through **all 10 questions** (any answers — correctness not under test here).
3. Observe: no crashes, no console errors, round transitions smoothly, result screen shows score.

**Record:** AC-2 Pass/Fail + any console errors.

## AC-3 — Anonymous session id in localStorage

1. On `/trainer`, DevTools → Application → Local Storage → `https://sokratai.lovable.app`.
2. Find key `trainer_session_id`.
3. Confirm value is a string of length 16, `[A-Za-z0-9_-]` charset.
4. Note the value — you'll reuse it in AC-7.

**Record:** AC-3 Pass/Fail + captured value.

## AC-4 — Submit result → POST trainer-submit 200

1. DevTools → Network → filter `trainer-submit`.
2. On the final question, let the round submit automatically.
3. Inspect the POST:
   - Method: POST
   - Status: 200
   - Request payload contains **exactly**: `session_id`, `score`, `total`, `weak_formulas` (array), `duration_ms` (number, > 0), `client_started_at` (ISO 8601).
   - Response body contains `ok: true` or equivalent success shape.

**Record:** AC-4 Pass/Fail + paste full request payload into report.

## AC-6 — "Пройти ещё раз" reuses session_id

1. On the result screen, click «Пройти ещё раз».
2. DevTools → Application → Local Storage → confirm `trainer_session_id` is **the same** value as in AC-3.
3. Start and complete another round → new POST `trainer-submit` should carry the **same** `session_id`.

**Record:** AC-6 Pass/Fail.

## AC-7 — iOS Safari parity

Use a real iPhone if possible. Fallback: Chrome DevTools → Device Mode → iPhone 14 Pro + Safari UA is **not** sufficient for `touch-action` and `100dvh` but is acceptable for layout smoke.

1. Open `/trainer` in mobile Safari.
2. Visual: `min-h-[100dvh]` container fills the viewport under Safari's URL bar, no content clipped by the home indicator.
3. Tap any button: no visible 300 ms tap delay (`touch-action: manipulation` should be on interactive elements).
4. Focus any text input (if present): page **must not** zoom (`font-size ≥ 16px` / `text-base`).
5. Play a full round → submit → confirm POST 200 (proxy through a desktop DevTools if needed: enable Web Inspector on the iPhone + Mac Safari Develop menu).

**Record:** AC-7 Pass/Fail + any visual issues.

## AC-8 — Rate limit (**BLOCKER gate**)

From any machine:

```bash
for i in $(seq 1 25); do
  echo -n "req $i: "
  curl -sS -o /dev/null -w "%{http_code}\n" \
    -X POST 'https://vrsseotrfmsxpbciyqzc.functions.supabase.co/trainer-submit' \
    -H 'content-type: application/json' \
    -d '{"session_id":"qa-ratelimit-001","score":5,"total":10,"weak_formulas":["v=s/t"],"duration_ms":120000,"client_started_at":"2026-04-08T10:00:00Z"}'
done
```

- Expected: requests 1–20 return **200**, requests 21–25 return **429**.
- Wait 10 minutes, rerun 1 request → **200** (window resets).

**Record:** AC-8 Pass/Fail. **If Fail → BLOCKER, do not merge.**

Clean up after: `DELETE FROM public.formula_round_results WHERE session_id = 'qa-ratelimit-001';`

## AC-11 — Anon cannot SELECT trainer rows (**BLOCKER gate**)

1. Supabase Studio → SQL editor → **switch role to `anon`** (or run with `SET ROLE anon;`):

   ```sql
   SET ROLE anon;
   SELECT id, source, session_id FROM public.formula_round_results WHERE source = 'trainer' LIMIT 5;
   RESET ROLE;
   ```

   - Expected: 0 rows (policy `trainer_results_no_anon_read` returns `USING (false)`).

2. From the browser (while **logged out**), open DevTools console on `/trainer` and run:

   ```js
   const { data, error } = await window.supabase
     .from('formula_round_results')
     .select('*')
     .eq('source', 'trainer');
   console.log({ data, error });
   ```

   - Expected: `data` is empty array OR `error` is set (RLS). **Not** real rows.

3. Also confirm as `authenticated` you still get nothing sensitive (should also be 0 unless you wrote tutor read policy separately).

**Record:** AC-11 Pass/Fail. **If Fail → BLOCKER, do not merge.**

## Backend sanity (supporting AC-4 / AC-8)

Supabase Studio SQL (service role):

```sql
SELECT id, source, student_id, session_id,
       ip_hash IS NOT NULL AS has_ip_hash,
       score, total, duration_seconds, created_at
FROM public.formula_round_results
WHERE source = 'trainer'
ORDER BY created_at DESC
LIMIT 5;
```

Expected on the rows you just created:
- `source = 'trainer'`
- `student_id IS NULL`
- `session_id` matches the value from AC-3
- `has_ip_hash = true`
- `score`, `total`, `duration_seconds` match what you played

**Record:** note row count + any surprises.

---

## Reporting

After all rows are filled in, hand the updated `validation-report.md` to Vladimir with a **GO** or **NO-GO** summary at the top. Any BLOCKER fail (AC-8, AC-11, F-1) = NO-GO.
