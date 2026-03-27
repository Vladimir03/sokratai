

## Fix: Homework notifications broken — `profiles.email` column doesn't exist

### Root Cause

Both `homework-api/index.ts` (line 1264) and `homework-reminder/index.ts` (line 165) query `profiles.select("id, telegram_user_id, email")`, but the `profiles` table has **no `email` column**. This causes the PostgREST query to fail, returning an error that triggers `return jsonError(cors, 500, "DB_ERROR", ...)` — silently aborting the entire notify flow before any channel (push, telegram, email) is attempted.

This is why George shows "Не уведомлён" despite having a linked Telegram account.

### Fix options

**Option A (minimal fix — remove email from profiles query, get email from auth.users):**
- Remove `email` from the `profiles` select
- Use `dbService.auth.admin.listUsers()` or `getUserById()` to fetch emails from `auth.users` for the email cascade step
- More complex, slower (N+1 or batch auth calls)

**Option B (recommended — add `email` column to profiles):**
- Add migration: `ALTER TABLE profiles ADD COLUMN email TEXT`
- Populate from `auth.users` via a one-time backfill
- Add trigger to keep in sync on auth user creation/update
- Both edge functions work as-is after migration

**Option C (quickest — split the query, gracefully handle missing email):**
- Change `.select("id, telegram_user_id, email")` → `.select("id, telegram_user_id")` in both files
- For email, use `dbService.auth.admin.listUsers()` filtered by student IDs, or query `auth.users` directly from service role
- This unblocks push + telegram immediately

### Recommended approach: Option C (quick unblock)

This is a production-down bug. Fix it fast:

1. **`homework-api/index.ts`** (line 1264): change select to `"id, telegram_user_id"`, then fetch emails separately via `auth.admin` for students who need email fallback
2. **`homework-reminder/index.ts`** (line 165): same change
3. **Deploy** both edge functions
4. **Verify** by re-sending notification to George

### Technical details

**homework-api/index.ts** changes (~lines 1262-1318):
- `.select("id, telegram_user_id, email")` → `.select("id, telegram_user_id")`
- After profiles query, fetch emails from `auth.users` via service-role client:
  ```ts
  // Fetch emails from auth for email cascade
  for (const sid of studentIds) {
    const { data } = await dbService.auth.admin.getUserById(sid);
    if (data?.user?.email && !data.user.email.endsWith('@temp.sokratai.ru')) {
      emailMap[sid] = data.user.email;
    }
  }
  ```
- Remove the `p.email` check from the profiles loop

**homework-reminder/index.ts** (~line 165): identical fix

**Deploy**: `homework-api`, `homework-reminder`

### Files to modify
1. `supabase/functions/homework-api/index.ts` — fix profiles select + add auth email lookup
2. `supabase/functions/homework-reminder/index.ts` — same fix

