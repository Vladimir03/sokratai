

## Root Cause

The database confirms: assignment `4ce28a0e-b77e-4c97-b914-e6dc4717c046` has `workflow_mode = 'classic'` despite the switch being ON in the UI. This happened because the edge function `homework-api` was not yet redeployed with `workflow_mode` support when the assignment was created. The edge function defaulted unknown fields to `'classic'`.

**All 40 assignments in the database have `workflow_mode = 'classic'`** -- none were ever saved as `guided_chat`.

The frontend code is correct (sends `workflow_mode`), the edge function code is correct (saves it), and the student-side query is correct (reads it). The issue was purely a deployment timing gap.

## Fix Plan

### 1. Fix existing assignment data (SQL UPDATE via insert tool)

Update assignment `4ce28a0e-b77e-4c97-b914-e6dc4717c046` to `workflow_mode = 'guided_chat'`:

```sql
UPDATE homework_tutor_assignments 
SET workflow_mode = 'guided_chat' 
WHERE id = '4ce28a0e-b77e-4c97-b914-e6dc4717c046';
```

### 2. Provision guided chat thread for the assigned student

The student `ac96a528-4213-471b-ac9d-163a2af6397a` has a `homework_tutor_student_assignments` row but no thread exists yet. Need to:

1. Look up the `student_assignment_id` from `homework_tutor_student_assignments`
2. Insert a row into `homework_tutor_threads` 
3. Insert `homework_tutor_task_states` for each task (first = `active`, rest = `locked`)

This requires querying for the student_assignment ID and task IDs first, then inserting thread + task states.

### 3. Redeploy edge function

Redeploy `homework-api` to confirm latest code is live for future assignments.

### No frontend changes needed

The frontend already handles `workflow_mode === 'guided_chat'` correctly at line 433 of `StudentHomeworkDetail.tsx`.

