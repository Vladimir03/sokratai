

## Fix: Add Lesson Dialog Scroll + Lesson Series Creation Error

### Problem 1: Dialog not scrollable
The "Добавить занятие" dialog content overflows the viewport on smaller screens, making the "Создать" button unreachable.

### Problem 2: "Не удалось создать серию занятий"
The `createLesson` and `createLessonSeries` functions require `tutor_id` to insert into the `tutor_lessons` table (it's a NOT NULL column), but the calls from `TutorSchedule.tsx` never pass it. The insert fails silently and returns `null`, triggering the error toast.

---

### Fix Details

**File 1: `src/pages/tutor/TutorSchedule.tsx`**

1. Add `max-h-[80vh] overflow-y-auto` to the dialog content's inner `div` (the `space-y-4` container) so the form scrolls when it exceeds viewport height.
2. Pass `tutor_id` from the tutor context into both `createLesson()` and `createLessonSeries()` calls. The `AddLessonDialog` component already receives tutor data via its parent -- need to check how tutor ID is available and thread it through.

**File 2: `src/lib/tutorSchedule.ts`**

- Add `getCurrentTutor()` call inside `createLesson()` to auto-populate `tutor_id` when it's not provided. This ensures both direct calls and calls from `createLessonSeries` work correctly.

### Technical Details

| File | Change |
|------|--------|
| `src/lib/tutorSchedule.ts` | In `createLesson()`, if `input.tutor_id` is missing, fetch it via `getCurrentTutor()` and inject it before insert |
| `src/pages/tutor/TutorSchedule.tsx` | Add `max-h-[80vh] overflow-y-auto` to the dialog form container |

Both fixes are minimal and preserve all existing behavior and design.

