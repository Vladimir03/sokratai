

## Plan: KB Picker wider + image thumbnails; HWTaskCard image preview

Two issues:
1. KB Picker Sheet is too narrow (460px ≈ 25% of screen) — widen to ~75%
2. PickerTaskCard doesn't show image thumbnails for tasks with attachments
3. HWTaskCard doesn't show image preview when task has `kb_attachment_url` but no uploaded image (shows only amber badge text)

### Changes

**1. `src/components/tutor/KBPickerSheet.tsx`**

- Change Sheet width from `w-[460px]` to `w-[75vw] max-w-[900px]` (line 573)
- In `PickerTaskCard`: add image thumbnail next to task text
  - Parse `task.attachment_url` via `parseAttachmentUrls`
  - Resolve first ref to signed URL via `getKBImageSignedUrl` (same pattern as `TaskCard.tsx`)
  - Show small thumbnail (48×48 or 64×64) with `object-cover rounded` styling
  - Only load when attachment exists (lazy, same `useEffect` pattern as TaskCard)

**2. `src/components/tutor/homework-create/HWTaskCard.tsx`**

- When task has `kb_attachment_url` but no `task_image_path` (no uploaded image): resolve `kb_attachment_url` to signed URL and show a small preview thumbnail instead of just the amber text badge
  - Use `getKBImageSignedUrl` from `kbApi.ts` to resolve `storage://` → signed URL
  - Show thumbnail (48×48) in the image section area, with the existing amber badge text

### Technical details

- `getKBImageSignedUrl(ref: string): Promise<string | null>` already exists in `src/lib/kbApi.ts`
- `parseAttachmentUrls` handles both single refs and JSON arrays
- Signed URLs are cached by the function internally
- Image loading uses the standard `useEffect` + cancelled flag pattern from `TaskCard.tsx`

