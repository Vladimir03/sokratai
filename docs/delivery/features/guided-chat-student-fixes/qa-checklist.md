# QA Checklist: Task-Scoped AI Context (Bug 1)

## Pre-requisites
- ДЗ из 3+ задач, active, assigned to student
- Student account с доступом к ДЗ

## Scenario 1: Reorder after student started
1. Student opens homework, sends message in task #1
2. Tutor reorders tasks (task #1 becomes task #3)
3. Student reloads page
4. **PASS:** Message history follows the original task (now at position #3), not the new task at position #1
5. **PASS:** AI bootstrap/question/hint for the moved task use its correct text and image
6. **PASS:** TaskStepper pills correctly reflect visited state after reorder

## Scenario 2: Task text edit after assignment issued
1. Student opens homework, gets bootstrap for task #1
2. Tutor edits task #1 text
3. Student reloads, sends question about task #1
4. **PASS:** `check` and `hint` endpoints use updated task text (server-authoritative)
5. **PASS:** `question` flow uses updated text after React Query refetch

## Scenario 3: Cross-task context isolation
1. Student sends messages in task #1 and task #2
2. Switch to task #2, request hint
3. **PASS:** AI hint references only task #2 context, not task #1 messages
4. **PASS:** Message list shows only task #2 messages
5. Switch back to task #1
6. **PASS:** Task #1 history is intact and isolated

## Scenario 4: Advance guard with task_id
1. Student has NOT interacted with AI on task #3
2. Call `/threads/:id/advance` for task #3
3. **PASS:** Returns 400 NO_INTERACTION (guard correctly checks by task_id)

## Scenario 5: Tutor viewer post-reorder
1. Student completes tasks, tutor views results
2. Tutor had reordered tasks after student started
3. **PASS:** Tutor viewer shows messages under correct (current) task numbers
4. **PASS:** Task filter pills show correct task order
5. **PASS:** "Задача N" label in message timestamp reflects current order, not historical

## Scenario 6: Legacy messages (pre-migration, no task_id)
1. If any messages exist without `task_id` (pre-migration)
2. **PASS:** Fallback to `task_order` matching works correctly
3. **PASS:** No crash or empty history

## Migration backfill diagnostic
```sql
-- Check for assignments where reorder happened before migration
-- (messages with task_order that don't match current task order_num)
SELECT
  htm.id AS message_id,
  htm.thread_id,
  htm.task_order AS stored_order,
  htm.task_id AS backfilled_task_id,
  htt.order_num AS current_order
FROM homework_tutor_thread_messages htm
JOIN homework_tutor_tasks htt ON htt.id = htm.task_id
WHERE htm.task_id IS NOT NULL
  AND htm.task_order IS NOT NULL
  AND htm.task_order != htt.order_num
LIMIT 50;
```
If this returns rows, those messages had their `task_id` backfilled from a stale `task_order`. Manual review needed.
