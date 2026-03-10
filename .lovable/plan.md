

## Build Errors Analysis

Three distinct issues causing the build to fail and the `/homework` page to show "Не удалось загрузить задания":

### Error 1: `homework_tutor_submissions` has no `created_at` column
In `studentHomeworkApi.ts` line 213, the query selects `created_at` from `homework_tutor_submissions`, but the table schema shows no such column. The table has `submitted_at` instead. This causes a TypeScript `SelectQueryError` which cascades to lines 224/226.

**Fix**: Change `.select('assignment_id, status, created_at')` to `.select('assignment_id, status, submitted_at')` and update `.order('created_at', ...)` to `.order('submitted_at', ...)`.

### Error 2: `TutorHomeworkAttemptSummary` type missing in `tutorHomeworkApi.ts`
The type is used at lines 695/697 but never defined or exported. `useTutorHomework.ts` tries to import it.

**Fix**: Add the missing interface in `tutorHomeworkApi.ts`:
```typescript
export interface TutorHomeworkAttemptSummary {
  id: string;
  assignment_id: string;
  student_id: string;
  status: string;
  attempt_no: number;
  submitted_at: string | null;
  total_score: number | null;
  total_max_score: number | null;
}
```

### Files to change
1. `src/lib/studentHomeworkApi.ts` -- Fix `created_at` → `submitted_at`
2. `src/lib/tutorHomeworkApi.ts` -- Add `TutorHomeworkAttemptSummary` interface

