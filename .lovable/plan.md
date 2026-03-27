

## Fix: `hw_reorder_tasks` function missing from database

### Root cause

The migration `20260319100000_hw_reorder_tasks_atomic.sql` exists in the repo but was never applied to the production database. When the PUT handler tries to call `hw_reorder_tasks` RPC, it fails with "Could not find the function in the schema cache" → 500.

### Fix

Apply the migration to create the `hw_reorder_tasks` PL/pgSQL function. The SQL is already written and correct in `supabase/migrations/20260319100000_hw_reorder_tasks_atomic.sql`. We need to run it as a new migration since the old one was apparently skipped.

**New migration**: Create `hw_reorder_tasks(UUID, JSONB)` function — same content as the existing migration file. This is a `SECURITY DEFINER` function granted only to `service_role`.

### Also: image preview issue

The screenshot shows no image preview for the second task (which has `task_image_url: storage://kb-attachments/demidova2025/z1_25.svg`). This was addressed in the previous fix (resolving `task_image_path` → signed URL in edit prefill). If it's still not working, it may be because the `getHomeworkImageSignedUrl` function doesn't handle `storage://kb-attachments/...` paths (different bucket). Will verify after the reorder fix.

