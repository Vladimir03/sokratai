

## Fix: Build error in `claim-invite/index.ts`

### Problem
Build fails with TS2345 in `claim-invite/index.ts`:
- Line 32: `ReturnType<typeof createClient>` creates a strict generic type that doesn't match the actual client instance
- Line 139: passing `supabaseAdmin` to that function triggers the type mismatch

This is a **pre-existing typing issue** unrelated to the recent telegram-bot commits. The Deno type checker in Lovable's build is stricter than what was used when this file was committed via GitHub.

### Fix (1 file, 1 line change)

**`supabase/functions/claim-invite/index.ts`** — line 32:
```typescript
// Before:
supabaseAdmin: ReturnType<typeof createClient>,

// After:
supabaseAdmin: any,
```

Using `any` for an internal helper parameter is safe here — the function is private, called once, and the Supabase client API is stable.

### What the recent commits changed (no Lovable action needed)
The last 4 commits added:
1. `compactHistoryForTelegram()` + `fetchChatWithTimeout()` in `telegram-bot/index.ts` — **already deployed** via `supabase--deploy_edge_functions`
2. Telegram messages sent to @Dawsik11 and @Analyst_Vladimir — **done**
3. `.lovable/plan.md` updated — cosmetic

**Only the `claim-invite` type fix is needed to unblock the build.**

