

## Problem

The `getStudentAssignment()` function in `src/lib/studentHomeworkApi.ts` (line 291) does not include `workflow_mode` or `max_attempts` in its SELECT query:

```sql
.select('id, title, subject, topic, description, deadline, status, created_at')
```

So `data.workflow_mode` is always `undefined`, and the condition on line 433 of `StudentHomeworkDetail.tsx` (`if (data.workflow_mode === 'guided_chat')`) is never true. The student always sees the classic view.

Additionally, `max_attempts` is hardcoded to `3` on line 319 instead of being fetched from the DB.

## Fix

**File: `src/lib/studentHomeworkApi.ts`**

1. **Line 291** -- Add `workflow_mode` and `max_attempts` to the SELECT:
```
.select('id, title, subject, topic, description, deadline, status, workflow_mode, max_attempts, created_at')
```

2. **Lines 317-324** -- Use the actual `max_attempts` from DB instead of hardcoded `3`:
```typescript
const result = {
  ...(assignment as any),
  max_attempts: (assignment as any).max_attempts ?? 3,
  workflow_mode: (assignment as any).workflow_mode ?? 'classic',
  updated_at: (assignment as any).created_at,
  tasks: ...,
  materials: ...,
  submissions,
} as unknown as StudentHomeworkAssignmentDetails;
```

This is a 2-line change. No migration or redeployment needed -- purely a frontend query fix.

