

## Fix: KBPickerSheet width capped by `sm:max-w-sm` in Sheet component

### Root cause

The `sheetVariants` in `src/components/ui/sheet.tsx` (line 41) defines the `right` side variant with `sm:max-w-sm` — this caps the sheet at **384px** on screens ≥640px, overriding the `w-[75vw]` set in `KBPickerSheet.tsx`.

The `max-w-none` class in KBPickerSheet's className loses specificity against the CVA variant's `sm:max-w-sm`.

### Fix

**`src/components/ui/sheet.tsx`** — Remove the `sm:max-w-sm` constraint from the `right` (and `left`) side variants. This is a global Sheet component, but the default `w-3/4` (75%) remains as fallback width. Consumers that need narrower sheets can pass their own `max-w-*` via className.

Alternatively, to avoid touching the shared UI component: override specificity in `KBPickerSheet.tsx` by using `!max-w-none` (Tailwind important modifier). This is the safer, scoped approach.

### Recommended approach (scoped)

**`src/components/tutor/KBPickerSheet.tsx`** line 607 — change `max-w-none` to `!max-w-none` so it wins over the variant's `sm:max-w-sm`:

```
className="flex w-[75vw] !max-w-none flex-col gap-0 p-0"
```

Single line change. Sheet stays 75vw on desktop and mobile.

