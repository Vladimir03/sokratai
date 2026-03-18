

## Problem

`FolderPage.tsx` renders `TaskCard` without passing `onMoveToFolder`, so the "Переместить" menu item never appears — even though `TaskCard` already supports it (line 62).

There is no "move task to folder" mutation yet. Only "copy task to folder" exists (`useCopyTaskToFolder`). Moving = updating `folder_id` on an existing task.

## Plan

### 1. Add `useMoveTaskToFolder` hook in `src/hooks/useFolders.ts`

A simple mutation that updates `kb_tasks.folder_id` for an existing task owned by the current user:

```ts
async function moveTaskToFolder(taskId: string, targetFolderId: string) {
  const { error } = await supabase
    .from('kb_tasks')
    .update({ folder_id: targetFolderId, updated_at: new Date().toISOString() })
    .eq('id', taskId);
  if (error) throw error;
}

export function useMoveTaskToFolder() {
  // invalidate source + target folder queries + folder-tree
}
```

### 2. Create `MoveToFolderModal` component

Reuse the same folder-tree picker pattern from `CopyToFolderModal`, but call the move mutation instead of copy. File: `src/components/kb/MoveToFolderModal.tsx`. Exclude the current folder from selection.

### 3. Wire up in `FolderPage.tsx`

- Add state `movingTask: KBTask | null`
- Pass `onMoveToFolder={() => setMovingTask(task)}` to each `TaskCard`
- Render `MoveToFolderModal` when `movingTask` is set
- Invalidate the current folder on success so the moved task disappears from the list

### No database changes needed

RLS on `kb_tasks` already allows owners to update their own tasks. The `folder_id` column is updatable.

