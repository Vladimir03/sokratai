

## Problem

Edge function `homework-api` returns 500 on `POST /assignments` because line 285 inserts `group_id` into `homework_tutor_assignments`, but the database table has no such column.

Error from logs:
```
Could not find the 'group_id' column of 'homework_tutor_assignments' in the schema cache
```

## Fix

Two options:
1. **Add `group_id` column** to `homework_tutor_assignments` via migration (if mini-groups homework is needed)
2. **Remove `group_id`** from the insert in the edge function (simpler, since mini-groups for homework isn't active)

**Recommended**: Option 2 — remove `group_id` from the insert statement in `homework-api/index.ts` (lines 254-256 validation + line 285 insert). This is the minimal fix. The validation block (lines 254-256) and the insert field (line 285) both reference `group_id`.

### Changes

**`supabase/functions/homework-api/index.ts`**:
- Remove `group_id` validation (lines 254-256)
- Remove `group_id` from insert object (line 285)

Then redeploy the `homework-api` edge function.

