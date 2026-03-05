

## Problem

The `telegram-bot` edge function crashes on boot with:
```
The requested module './homework/homework_handler.ts' does not provide an export named 'MAX_ATTEMPTS'
```

`index.ts` line 17 imports `MAX_ATTEMPTS` from `homework_handler.ts`, but that file has no such export. It only has a private `getAssignmentMaxAttempts()` async function that reads the value from DB.

## Fix

1. **Add `export const MAX_ATTEMPTS = 3`** to `homework_handler.ts` (as a default/display constant)
2. Redeploy `telegram-bot`

This is the minimal fix. The constant is used in `index.ts` for display messages (e.g. "Попытка X из MAX_ATTEMPTS") and error handling, not for actual enforcement (which happens inside `createSubmissionForAttempt` via DB lookup).

### Changes

**`supabase/functions/telegram-bot/homework/homework_handler.ts`** — add before the Feature 4 section (~line 569):
```typescript
export const MAX_ATTEMPTS = 3;
```

Then redeploy `telegram-bot`.

