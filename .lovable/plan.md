

## Fix: Image previews missing in edit mode

### Root cause

In `TutorHomeworkCreate.tsx` (lines 188-201), the edit prefill sets `task_image_path` from the DB (`t.task_image_url`, which is a `storage://` ref), but never resolves it to a signed HTTP URL for `task_image_preview_url`. Without a preview URL, `HWTaskCard` shows only the file name and a generic icon — no actual image.

### Fix

**`src/pages/tutor/TutorHomeworkCreate.tsx`** — after setting tasks in the edit prefill `useEffect`, resolve `task_image_path` → signed URL for each task:

```typescript
// After setTasks(...) in the edit prefill useEffect:
// Resolve storage:// refs to signed preview URLs
const resolvedTasks = [...newTasks]; // the tasks array just set
Promise.all(
  resolvedTasks.map(async (t, i) => {
    if (t.task_image_path) {
      const url = await getHomeworkImageSignedUrl(t.task_image_path);
      if (url) resolvedTasks[i] = { ...resolvedTasks[i], task_image_preview_url: url };
    }
  })
).then(() => setTasks([...resolvedTasks]));
```

Import `getHomeworkImageSignedUrl` from `@/lib/tutorHomeworkApi` (already partially imported).

### Result

Edit mode will show full image previews (48×48 thumbnails) for all tasks with `storage://` image refs, identical to newly uploaded images.

