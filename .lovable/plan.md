

## Plan: KB image auto-upload + empty task cleanup

Two issues to fix:

### 1. Auto-upload KB attachment as real task image

**Problem**: When a task is added from KB with `kb_attachment_url`, it shows a small amber badge "Фото из базы" instead of a proper image preview like manually uploaded images.

**Fix in `HWTasksSection.tsx` → `kbTaskToDraftTask`**:
- After converting KB task to draft, resolve `kb_attachment_url` via `getKBImageSignedUrl` to get a signed HTTP URL
- Set that URL as `task_image_preview_url` on the draft task so the existing image preview UI in HWTaskCard renders it immediately
- Set `task_image_path` to the `kb_attachment_url` value (the `storage://` ref) so the backend receives it as the task image
- Set `task_image_name` to filename extracted from the storage ref

This makes KB images display identically to manually uploaded images — full preview in the image section, not just a badge.

**Also in `HWTaskCard.tsx`**: Remove or simplify the `KBAttachmentBadge` component — it's no longer needed when `kb_attachment_url` is properly mapped to `task_image_path`/`task_image_preview_url`.

### 2. Remove empty first task when adding from KB

**Problem**: Constructor starts with one empty task. When tutor adds from KB, the KB task becomes task 2, leaving an empty task 1.

**Fix in `HWTasksSection.tsx` → `handleAddFromKB`**:
- Before appending KB tasks, check if any existing tasks are "empty" (no text, no image, no answer)
- If the first task is empty and untouched, remove it before adding KB tasks
- Helper: `isEmptyTask(t)` = `!t.task_text.trim() && !t.task_image_path && !t.correct_answer.trim() && !t.kb_task_id`

### Files changed
- `src/components/tutor/homework-create/HWTasksSection.tsx` — `kbTaskToDraftTask` resolves image, `handleAddFromKB` removes empty tasks
- `src/components/tutor/homework-create/HWTaskCard.tsx` — simplify/remove `KBAttachmentBadge` (image now shows in standard image section)

### Technical note
- `getKBImageSignedUrl` is async — `kbTaskToDraftTask` will need to become async, or image resolution happens in `handleAddFromKB` after conversion
- The `storage://` ref stored in `task_image_path` is already handled by the backend submit flow

