

## Plan: Improve image display in KB Picker and HW Task Card

### Problem

1. **KBPickerSheet**: Task cards show tiny 48x48 thumbnails that are unreadable. The catalog (screenshot 3) shows full-width images — the picker should match that quality.
2. **HWTaskCard**: After adding a KB task, the image preview is also 48x48 with a raw storage path shown. Should display a proper large preview.

### Changes

#### 1. `src/components/tutor/KBPickerSheet.tsx` — `PickerTaskCard` redesign

Current layout: horizontal row with 48x48 thumbnail + text + button.

New layout inspired by catalog `TaskCard`:
- **Header row**: SourceBadge + KIM number + "В ДЗ" button (right-aligned)
- **Text**: `MathText` with `line-clamp-3` (instead of 2)
- **Image below text**: full-width, `max-h-48 object-contain rounded-xl border` — same as catalog collapsed preview
- Image-only tasks (`[Задача на фото]` marker): hero image `max-h-64`, text hidden
- Remove the tiny 48x48 thumbnail entirely

This matches the catalog UX from screenshot 3.

#### 2. `src/components/tutor/homework-create/HWTaskCard.tsx` — larger image preview

Current: 48x48 thumbnail with filename + raw storage path.

New:
- Image preview: `max-h-48 w-full object-contain rounded-lg border` (full-width, large)
- Keep filename + remove button on a row above the image
- Remove the raw `storage://` path display (useless to tutor)

### Files
- `src/components/tutor/KBPickerSheet.tsx` — redesign `PickerTaskCard` layout
- `src/components/tutor/homework-create/HWTaskCard.tsx` — enlarge image preview section

### Not changing
- `src/components/kb/TaskCard.tsx` — already good (screenshot 3)
- Sheet width — already fixed to 75vw

