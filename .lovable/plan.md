

## Plan: Fix build errors in 3 edge functions

### Critical issue (user-facing)
`tutor-manual-add-student` crashes with `getUserByEmail is not a function`. This blocks tutors from adding students.

### Root cause
`supabaseAdmin.auth.admin.getUserByEmail()` doesn't exist in the Supabase JS client. The correct approach is `listUsers` with email filter.

### Changes

#### 1. Fix `supabase/functions/tutor-manual-add-student/index.ts`
Replace both `getUserByEmail(email)` calls (lines 187 and 271) with:
```typescript
const { data: listData } = await supabaseAdmin.auth.admin.listUsers({
  filter: `email.eq.${email}`,
  page: 1, perPage: 1,
});
const foundUser = listData?.users?.[0] ?? null;
```

#### 2. Fix `supabase/functions/chat/index.ts`
- **Line 1107**: Fix type error — add explicit typing to `adminSupabase` creation: `createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })`
- **Line 1138**: Fix typo `taskPromptImageDataUrl` → `taskPromptImageDataUrls.length > 0`

#### 3. Fix `supabase/functions/process-email-queue/index.ts`
- **Line 57**: Change `ReturnType<typeof createClient>` to `any` to fix SupabaseClient generic mismatch
- **Lines 159, 164**: Add explicit types for `msg` and `id` parameters
- Remaining type errors on lines 214/221/330 are the same `moveToDlq` signature issue, fixed by the `any` param type

#### 4. Redeploy all 3 functions
- `tutor-manual-add-student` (critical — blocks student registration)
- `chat`
- `process-email-queue`

### Technical details
- `getUserByEmail` was never a public method in `@supabase/supabase-js` v2 — the `(as any)` cast hid the compile error but it fails at runtime
- The `listUsers` API with filter is the correct replacement
- The chat/process-email-queue type errors are generic inference mismatches from recent SDK updates — using `any` for the admin client param is safe in edge functions

