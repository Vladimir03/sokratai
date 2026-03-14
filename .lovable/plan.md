

## Problem

The `kb_tasks` table is missing the `solution_attachment_url` column. The code references it in 6 files, but the column was never added via migration. This causes:
1. Build errors (TS2339 — property does not exist)
2. Runtime "Не удалось создать задачу" when saving a task with solution photos

## Plan

### 1. Add the missing column via database migration

```sql
ALTER TABLE public.kb_tasks
ADD COLUMN IF NOT EXISTS solution_attachment_url TEXT DEFAULT NULL;
```

No RLS changes needed — existing policies on `kb_tasks` already cover all columns.

### 2. No code changes needed

All frontend code (`CreateTaskModal`, `EditTaskModal`, `TaskCard`, `useFolders`, `useKnowledgeBase`, types) already correctly references `solution_attachment_url`. Once the column exists, the auto-generated types will update and all build errors will resolve.

