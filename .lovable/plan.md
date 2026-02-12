

## Add "Edit one or all" choice for recurring lessons

When a user clicks "Редактировать" or "Отменить занятие" on a lesson that belongs to a series (`is_recurring === true`), show a choice dialog asking whether to apply the action to just this lesson or the entire series.

### UX Flow

1. User clicks on a recurring lesson (has the "Серия" badge)
2. The details dialog opens as usual
3. When user clicks "Редактировать" or "Отменить занятие":
   - If the lesson is NOT recurring -- proceed as before (no change)
   - If the lesson IS recurring -- show an intermediate choice: "Только это занятие" / "Все занятия серии"
4. Based on choice, apply the action accordingly

### Implementation Details

**File: `src/lib/tutorSchedule.ts`**

Add two new functions:

- `updateLessonSeries(lessonId, input)` -- finds the root lesson (via `parent_lesson_id` or the lesson itself if it's the root), then updates ALL lessons in the series that are still `booked` and have `start_at >= now()` with the same changes (except `start_at` which shifts by the same delta for each)
- `cancelLessonSeries(lessonId)` -- cancels all future lessons in the series

Both functions use the `parent_lesson_id` to find siblings: query `tutor_lessons` where `parent_lesson_id = rootId OR id = rootId`, filtered to future + booked.

**File: `src/pages/tutor/TutorSchedule.tsx` (LessonDetailsDialog)**

Add state for series action mode:

- `seriesAction`: `null | 'edit' | 'cancel'` -- tracks which action triggered the choice
- When `lesson.is_recurring` and user clicks "Редактировать" or "Отменить", set `seriesAction` and show two buttons instead of proceeding immediately
- "Только это занятие" proceeds with single-lesson logic (existing code)
- "Все занятия серии" calls the new series functions

For editing the series: update all future lessons with the same metadata changes (student, type, subject, notes). Date/time changes apply as a time-of-day shift to all future lessons in the series.

For cancelling the series: cancel all future lessons at once.

### Technical Changes

| File | Change |
|------|--------|
| `src/lib/tutorSchedule.ts` | Add `updateLessonSeries()` and `cancelLessonSeries()` functions |
| `src/lib/tutors.ts` | Add `cancelLessonSeries()` that cancels all future lessons in a series |
| `src/pages/tutor/TutorSchedule.tsx` | Add series choice UI in `LessonDetailsDialog` -- when `is_recurring`, show "Только это занятие" / "Все занятия серии" before proceeding with edit or cancel |

### UI for the choice

When a recurring lesson's "Редактировать" or "Отменить" is clicked, replace the footer buttons with:

```
[Только это занятие]  [Все занятия серии]
```

After the user picks, proceed with the corresponding single or bulk action. The choice step adds minimal UI complexity -- just a conditional render in the dialog footer.
