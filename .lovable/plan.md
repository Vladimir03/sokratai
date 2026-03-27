

## Fix: KB Picker Sheet width constrained by `sm:max-w-sm`

### Root cause

The `SheetContent` component in `src/components/ui/sheet.tsx` (line 41) applies `sm:max-w-sm` (384px) to the `right` side variant. This overrides the `w-[75vw]` set in `KBPickerSheet.tsx` on any screen ≥640px — explaining why it looks small on desktop.

### Changes

**`src/components/tutor/KBPickerSheet.tsx` (line 604)**

Override the sheet's built-in max-width by adding `!max-w-none` (or `sm:max-w-none`) to the className, so the `w-[75vw]` actually takes effect:

```
className="flex w-[75vw] max-w-none flex-col gap-0 p-0"
```

This removes the 900px cap too — 75vw will apply universally. On mobile (390px viewport), 75vw ≈ 293px which matches screenshot 2 nicely. On 1440px desktop, 75vw = 1080px — generous but appropriate for a task browser.

No changes to `sheet.tsx` (shared component, affects all sheets app-wide).

### Not changing
- `src/components/ui/sheet.tsx` — the `sm:max-w-sm` default is fine for other sheets
- Mobile behavior — already good per user feedback

