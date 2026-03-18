

## Problem

The 54 Demidova 2025 tasks exist in the database but are owned by user `a7212758-8cdd-4d7c-8608-4fedcb34d74c` and stored in that user's "Черновики для сократа" folder (`d9b1b759-...`).

You are logged in as `kamchatkinvova@gmail.com` (`420b1476-6988-4f00-b435-09400420d145`), who has a separate "Черновики для сократа" folder (`997471c7-5440-46f6-bca8-7e11b9476c63`).

RLS on `kb_tasks` filters by `owner_id = auth.uid()`, so these tasks are invisible to you. The folder query in `useFolders.ts` also filters `.eq('owner_id', session.user.id)`.

## Fix

Run a single data UPDATE (via the insert/update tool, not a migration) to reassign all 54 tasks:

```sql
UPDATE kb_tasks
SET owner_id  = '420b1476-6988-4f00-b435-09400420d145',
    folder_id = '997471c7-5440-46f6-bca8-7e11b9476c63',
    updated_at = NOW()
WHERE folder_id = 'd9b1b759-cc97-4e9d-a12d-921c6ac6e90f'
  AND source_label = 'demidova_2025';
```

This moves all 54 tasks into **your** "Черновики для сократа" folder. No code changes needed — the frontend already queries by `owner_id = auth.uid()` and will display them immediately.

Optionally, clean up the orphaned folders owned by `a7212758-...` if that user is not real:

```sql
DELETE FROM kb_folders WHERE owner_id = 'a7212758-8cdd-4d7c-8608-4fedcb34d74c';
```

## No code changes

The frontend (`useFolders.ts`, `FolderPage.tsx`) already handles this correctly — it queries folders and tasks by `owner_id`. Once the data is reassigned, the 54 tasks will appear.

