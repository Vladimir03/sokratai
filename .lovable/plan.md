

## Fix: Lesson click not opening edit dialog

### Root Cause

The `LessonBlock` component has `draggable` attribute. On click (especially with tiny mouse movement), the browser fires `dragstart` -> `dragend` -> `click` in that order.

1. `dragstart` sets `isLessonDragInProgressRef.current = true`
2. `dragend` schedules reset via `setTimeout(0)` (next microtask)
3. `click` fires -- `handleLessonClick` checks the ref, sees `true`, returns early
4. Only then does `setTimeout` callback run and reset the ref to `false`

Result: clicking a lesson never opens the details dialog.

### Fix

In `handleLessonDragEnd`, track whether the drag actually moved the lesson (i.e. a drop happened with position change). For the click handler, use a different approach: track actual drag distance rather than relying on `isLessonDragInProgressRef` alone.

**Simplest fix**: In `LessonBlock`, use `onMouseDown`/`onMouseUp` to detect a true click (no significant movement) and call `onClick` directly, bypassing the drag interference. Or alternatively, in `handleLessonDragEnd`, immediately reset `isLessonDragInProgressRef` (no setTimeout) and instead use `suppressNextGridClickRef` to prevent grid click.

### Proposed Change (minimal)

**File: `src/pages/tutor/TutorSchedule.tsx`**

Change `handleLessonDragEnd` to reset the ref immediately (not via setTimeout), and rely on `suppressNextGridClickRef` for preventing the grid click after drag:

```typescript
const handleLessonDragEnd = useCallback(() => {
  setDragPreview(null);
  draggedLessonDurationRef.current = 60;
  // Reset immediately so click handler is not blocked
  isLessonDragInProgressRef.current = false;
  draggedLessonIdRef.current = null;
  suppressNextGridClickRef.current = true;
}, []);
```

This way:
- Simple clicks: `dragstart` may fire but `dragend` resets ref immediately -> `click` fires and ref is `false` -> dialog opens
- Real drags: The drop handler processes the move and `suppressNextGridClickRef` prevents the grid from also opening the "add lesson" dialog

| File | Change |
|------|--------|
| `src/pages/tutor/TutorSchedule.tsx` | Remove `setTimeout` wrapper in `handleLessonDragEnd`, reset ref immediately, set `suppressNextGridClickRef = true` |

This is a one-line change with zero visual or UX impact beyond fixing the bug.
