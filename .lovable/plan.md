

## Problem Analysis

Two separate bugs, both stemming from guided_chat not being accounted for in certain code paths.

### Issue 1: Student list shows "Назначено" and "0/3 попыток" for completed guided_chat assignment

**Root cause**: `listStudentAssignments()` in `src/lib/studentHomeworkApi.ts` (lines 212-233) only queries `homework_tutor_submissions` for status and attempt count. Guided chat assignments don't create submissions -- they use threads. So `attemptsMap` is empty, resulting in `attempts_used: 0` and `latest_submission_status: null` (which maps to "Назначено").

**Fix**: After fetching submission-based attempts, also query `homework_tutor_threads` for guided_chat assignments to determine completion status. For guided_chat assignments:
- Check thread status (`completed` → map to `latest_submission_status: 'ai_checked'`)
- Set `attempts_used: 1` if thread exists (since guided_chat has one continuous thread, not discrete attempts)

Also need to fetch `workflow_mode` and `max_attempts` in the initial SELECT (lines 186-197) -- currently missing from the join query.

### Issue 2: Tutor can't see guided thread viewer on results page

**Root cause**: The `handleGetResults` edge function endpoint (lines 1228-1414) builds `per_student` exclusively from `homework_tutor_submissions`. For guided_chat, there are no submissions → `per_student` is empty → the UI shows "Пока нет работ от учеников" instead of the `GuidedStudentRow` components.

However, looking at line 939: `assignment?.workflow_mode === 'guided_chat' && assignmentQuery.data?.assigned_students` -- this condition bypasses `per_student` entirely and uses `assigned_students` instead. So **this should already work** if `assignment.workflow_mode` is correctly returned.

Wait -- let me re-check. Line 777: `const assignment = assignmentQuery.data?.assignment;` and line 939 checks `assignment?.workflow_mode`. The API returns the full row via `select("*")` so `workflow_mode: 'guided_chat'` should be there.

The `per_student` empty list goes to the `groupedStudents.length === 0` path at line 959, but only if the guided_chat condition at line 939 is **false**. If `workflow_mode === 'guided_chat'`, line 939-956 takes precedence.

So if `workflow_mode` is correctly `'guided_chat'` in the DB (confirmed), and the edge function returns it (confirmed via `select("*")`), the tutor side should work. Let me verify this is actually deployed.

Actually, the issue might be that `results` query returns empty `per_student` and the component shows "Пока нет работ" before the assignment query resolves. Let me check the render order -- line 779: `const loading = (assignmentQuery.isLoading || resultsQuery.isLoading) && !assignment && !results;`. If `assignmentQuery` is still loading but `resultsQuery` has resolved with empty `per_student`, `loading` could be false, and `assignment` is undefined, so the guided_chat branch at 939 fails (assignment is undefined), falling through to the classic branch showing empty state.

Actually no -- line 779 uses `&&`. If `assignment` is falsy (not yet loaded), `loading` is true only if one of them is still loading. But once both are loaded, `assignment` is set and `workflow_mode` check works.

**The real issue might be simpler**: The edge function might not be deployed with the latest code. Let me verify.

## Plan

### 1. Fix `listStudentAssignments` in `src/lib/studentHomeworkApi.ts`

**a)** Add `workflow_mode, max_attempts` to the Supabase join SELECT (line 186-197):
```
homework_tutor_assignments!inner(
  id, title, subject, topic, description, deadline, status,
  workflow_mode, max_attempts, created_at
)
```

**b)** After the submissions query (lines 212-233), add a query for guided_chat thread status:
- Query `homework_tutor_threads` joined through `homework_tutor_student_assignments` to get thread `status` for assignments where `workflow_mode === 'guided_chat'`
- For completed threads: set `latest_submission_status` to `'ai_checked'` and `attempts_used` to `1`
- For active threads: set `latest_submission_status` to `'in_progress'` and `attempts_used` to `1`

**c)** In the mapping (lines 235-251), use actual `max_attempts` and `workflow_mode` from assignment data instead of hardcoded `3`.

### 2. Redeploy `homework-api` edge function

Ensure the latest code with `workflow_mode` support is live. This fixes the tutor-side issue if it's a deployment gap.

### 3. Verify tutor results page logic

The frontend code at line 939 already handles guided_chat correctly using `assigned_students`. If `workflow_mode` is returned from the API (which it should be with `select("*")`), the tutor should see `GuidedStudentRow` with `GuidedThreadViewer` for each student. No frontend changes needed for issue 2.

## Files to change

1. **`src/lib/studentHomeworkApi.ts`** -- Update `listStudentAssignments` to handle guided_chat threads
2. **Edge function redeployment** -- Redeploy `homework-api`

