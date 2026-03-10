

## Problem

In `supabase/functions/homework-api/index.ts`, the `handleDeleteAssignment` function has a **stale `if (error)` check on line 1775** that sits *after* the `try/catch` block. The `error` variable from line 1761 (`const { error }`) is block-scoped inside the `try` and not accessible outside it. This causes `ReferenceError: error is not defined` every time.

The second click gives "Assignment not found" (404) because the first attempt partially succeeds (deletes child records) before crashing, leaving the assignment in a broken state — or the assignment was already deleted but the final response never reached the client.

## Fix

**File**: `supabase/functions/homework-api/index.ts`

Remove lines 1775-1778 (the dead `if (error)` block after the catch). The error is already handled inside the `catch` block on lines 1769-1773.

```typescript
// REMOVE these lines (1775-1778):
  if (error) {
    console.error("homework_api_request_error", { route: "DELETE /assignments/:id", error: error.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to delete assignment");
  }
```

Then redeploy the `homework-api` edge function.

