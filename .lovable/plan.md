

## Plan: Fix Telegram login token update silently failing

### Root Cause

The `telegram-bot` edge function creates a Supabase client with `SUPABASE_SERVICE_ROLE_KEY` (line 28). However, during `handleWebLogin`, it calls `supabase.auth.verifyOtp()` (lines 1137/1168) which **mutates the client's internal auth state** — switching from service_role to the verified user's session.

After `verifyOtp()`, the subsequent `.from("telegram_login_tokens").update(...)` (line 1246) runs under the **user's session context**, not service_role. Since `telegram_login_tokens` has RLS enabled with **zero policies**, the update is silently denied (returns 0 rows updated, no error).

The bot logs "Token verified successfully" because it doesn't check the update result. The token stays "pending" in the DB, and the frontend polling never sees "verified".

### Fix

In `supabase/functions/telegram-bot/index.ts`, create a **separate** Supabase admin client for the token update (or create a separate client for `verifyOtp` so the main client isn't tainted).

The simplest fix: create the admin client for the token update explicitly with `{ auth: { persistSession: false, autoRefreshToken: false } }`, and use a **fresh** service_role client for the update after `verifyOtp()`.

#### Change in `supabase/functions/telegram-bot/index.ts`

1. After the `verifyOtp()` call and session extraction (around line 1245), create a fresh admin client:

```typescript
// Use a fresh client to avoid session contamination from verifyOtp
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const { error: updateError } = await adminClient
  .from("telegram_login_tokens")
  .update({
    telegram_user_id: telegramUserId,
    user_id: profile.id,
    status: "verified",
    verified_at: new Date().toISOString(),
    session_data: {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    },
  })
  .eq("id", tokenData.id);

if (updateError) {
  console.error("Failed to update token:", updateError);
}
```

2. Alternatively (and more robust): change the **global** `supabase` client initialization at line 28 to disable session persistence:

```typescript
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
```

This prevents `verifyOtp()` from contaminating the client state. This is the **preferred** approach since it fixes the root cause globally and prevents similar bugs elsewhere in the 6900-line file.

3. Redeploy `telegram-bot` edge function.

### Technical details

- **Table**: `telegram_login_tokens` has RLS enabled, zero policies
- **Service role normally bypasses RLS**, but after `verifyOtp()` the client uses the user's JWT instead
- The `verifyOtp` result is only needed for its return value (session tokens) — the client-side session state is unwanted
- Adding `persistSession: false` to the global client is safe because edge functions are stateless — there's no session to persist

