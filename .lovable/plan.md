

## Problem

The 54 Demidova tasks exist in the database but belong to **Egor** (`egor.o.blinov@gmail.com`). You are logged in as `kamchatkinvova@gmail.com`. Current RLS policies on `kb_folders` and `kb_tasks` enforce `owner_id = auth.uid()` — each user only sees their own folders and tasks.

You want **shared drafts**: all moderators see one common pool of moderation folders and tasks.

## Root Cause

- `kb_folders` SELECT policy: `owner_id = auth.uid()` — you can't see Egor's folders
- `kb_tasks` SELECT policy (for personal tasks): `owner_id = auth.uid()` — you can't see Egor's tasks
- Frontend `fetchRootFolders()` and `fetchFolder()` also filter by `owner_id = session.user.id`

## Plan

### 1. Add RLS policies for cross-moderator visibility

Add two new **permissive** SELECT policies:

```sql
-- Moderators can see folders owned by other moderators
CREATE POLICY "KB folders select moderator peers"
ON public.kb_folders FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'moderator') AND has_role(owner_id, 'moderator')
);

-- Moderators can see tasks owned by other moderators
CREATE POLICY "KB tasks select moderator peers"
ON public.kb_tasks FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'moderator') AND has_role(owner_id, 'moderator')
);
```

These are permissive (OR'd with existing policies), so normal users are unaffected.

### 2. Update frontend fetchers to include moderator peers' folders

In `useFolders.ts`, update `fetchRootFolders()` and `fetchFolder()`:
- Remove the `eq('owner_id', userId)` filter when querying folders/tasks for moderators
- Instead, fetch folders where `owner_id` is any moderator (or simply remove the owner filter and let RLS handle it)
- Since RLS already enforces visibility, the simplest approach is to remove the client-side `owner_id` filter entirely and rely on RLS

Specifically:
- `fetchRootFolders()`: remove `.eq('owner_id', userId)` from all three queries (folders, children count, tasks count). RLS will return only visible rows.
- `fetchFolder()`: the folder detail query already doesn't filter by owner_id, but the tasks query does need to include moderator peers' tasks.

### 3. Avoid duplicate folders in "Моя база"

Since both Egor and kamchatkinvova have their own "Черновики для сократа" folders, moderators will see all of them. The UI will show duplicate-named folders. Two options:
- **Quick fix**: Show the owner name as a subtitle on moderator-peer folders (e.g., "Черновики для сократа · Egor")
- **Minimal approach**: Just show all folders — moderators understand whose is whose

I'll go with showing all folders and adding a small owner indicator for folders not owned by the current user.

### 4. Add moderator UPDATE/DELETE policies (optional but needed for workflow)

Moderators should also be able to edit/move tasks in peers' folders. Add UPDATE policies:

```sql
CREATE POLICY "KB tasks update moderator peers"
ON public.kb_tasks FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'moderator') AND has_role(owner_id, 'moderator'))
WITH CHECK (has_role(auth.uid(), 'moderator'));
```

### Summary of changes

| File/Area | Change |
|-----------|--------|
| Migration (new) | Add 2-4 permissive RLS policies for moderator cross-visibility |
| `src/hooks/useFolders.ts` | Remove client-side `owner_id` filter in `fetchRootFolders` — rely on RLS |
| `src/components/kb/FolderCard.tsx` | Optional: show owner indicator for peer folders |

