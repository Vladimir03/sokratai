

## Problem

- **kamchatkinvova@gmail.com** has 53 tasks in "Черновики для сократа" (folder `997471c7`). Both users have the `moderator` role.
- **egor.o.blinov@gmail.com** has 3 tasks in "Черновики для Сократа" (folder `59f40091`) and 0 in a duplicate "Черновики для сократа" (folder `d9b1b759`). No code bug — it's a data issue: the tasks were only ever created in kamchatkinvova's folder.

## Plan

**Single SQL migration** to:

1. **Copy 53 tasks** from kamchatkinvova's "Черновики для сократа" into egor's "Черновики для Сократа" folder — inserting them with `owner_id = egor's user_id`, preserving all task content (text, answer, solution, attachments, exam, kim_number, etc.), and setting `source_label = 'my'`.

2. **Delete the duplicate empty folder** "Черновики для сократа" (`d9b1b759`) belonging to egor to clean up the UI.

### SQL logic (simplified)

```sql
-- 1. Copy 53 tasks
INSERT INTO kb_tasks (folder_id, owner_id, topic_id, subtopic_id, exam, kim_number,
  primary_score, text, answer, solution, answer_format, source_label,
  attachment_url, solution_attachment_url)
SELECT
  '59f40091-...'::uuid,           -- egor's "Черновики для Сократа"
  'a7212758-...'::uuid,           -- egor's user_id
  topic_id, subtopic_id, exam, kim_number, primary_score,
  text, answer, solution, answer_format, 'my',
  attachment_url, solution_attachment_url
FROM kb_tasks
WHERE folder_id = '997471c7-...'; -- kamchatkinvova's folder

-- 2. Remove duplicate empty folder
DELETE FROM kb_folders WHERE id = 'd9b1b759-...';
```

No code changes needed — only a database migration.

