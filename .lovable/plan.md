

## Plan: Fix Build Errors + Configure Push & Email Infrastructure

### Part 1 — Fix Build Errors (3 files)

**1. `supabase/functions/process-email-queue/index.ts`** — 7 TS errors
- Change `moveToDlq` parameter type from `ReturnType<typeof createClient>` to `any` (same pattern as claim-invite fix)
- Add explicit `any` type annotations on `.map((msg: any)` and `.filter((id: any)` lambdas
- All `supabase` argument mismatches resolve from the `any` parameter fix

**2. `supabase/functions/tutor-manual-add-student/index.ts`** — 2 TS errors
- `getUserByEmail` doesn't exist on the Supabase auth admin API. Replace with `listUsers({ filter: email })` pattern or use `supabase.from('auth.users')` query. The correct Supabase approach: use `supabase.auth.admin.listUsers()` with filter, or query profiles table by email first, then `getUserById`.

**3. `src/lib/pushApi.ts`** — 1 TS error (Uint8Array assignability)
- Add `as BufferSource` assertion on the return of `urlBase64ToUint8Array`, or change return type to use `new Uint8Array(...) as unknown as BufferSource`

### Part 2 — VAPID Keys for Web Push

Generate VAPID keys and configure:
- Add secret `VAPID_PUBLIC_KEY` (edge function)
- Add secret `VAPID_PRIVATE_KEY` (edge function)  
- Add secret `VAPID_SUBJECT` = `mailto:support@sokratai.ru` (edge function)
- Add secret `VITE_VAPID_PUBLIC_KEY` (frontend env — same public key)

User will need to generate keys via `npx web-push generate-vapid-keys` and paste them.

### Part 3 — Email Secrets

- Add secret `PUBLIC_APP_URL` = `https://sokratai.ru`
- `LOVABLE_API_KEY` already exists ✅

### Part 4 — Deploy Edge Functions

Deploy: `push-subscribe`, `process-email-queue`

### Part 5 — Email Infrastructure Verification

Email domain `notify.sokratai.ru` is verified ✅. Verify cron job exists for `process-email-queue` (was set up by `setup_email_infra` earlier). If missing, re-run `setup_email_infra`.

### Execution Order

1. Fix 3 build errors (parallel file edits)
2. Add secrets (VAPID keys — requires user input)
3. Deploy edge functions
4. Verify cron job

