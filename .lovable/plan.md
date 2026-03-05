

## Problem

The `ai-check` endpoint returns **403 `NOT_TUTOR`** because the currently **deployed** version of `homework-api` doesn't have the student route placed before the `getTutorOrThrow()` call. The source code is already correct (the student ai-check route is matched at line 1953, before the tutor check at line 1957), but the function was not redeployed after this fix was added.

## Fix

**Redeploy the `homework-api` edge function.** No code changes needed — the source already has the correct routing order.

This single deployment will fix the "Проверить сейчас" button for students.

