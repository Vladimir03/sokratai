
## Fix: Homework Results Crash + Add AI/Submission Details to Tutor View

### Root Cause (Bug 1: "Не сдано" despite submission)

The `/assignments/:id/results` endpoint in `homework-api` crashes every time with:
```
ReferenceError: Cannot access 'taskMap' before initialization
```

In `homework-api/index.ts`, `taskMap` is **declared on line 1027** but **used on line 992** (inside a `.map()` callback). JavaScript's `const` has a Temporal Dead Zone, so accessing it before declaration throws a ReferenceError.

Because the results endpoint always crashes (500), the `TutorHomeworkDetail` page never gets `results.per_student`, so every student shows "Не сдано" even though submissions exist in the database.

**Fix**: Move the `taskMap` declaration (lines 1027-1030) **before** the `perStudent` block (before line 977).

### Enhancement (Bug 2: Show AI results and student solutions)

Currently the `TutorHomeworkDetail` page only shows a flat student list with status badges. The tutor needs to see:
- Student's submitted photos/text answers
- AI check results (score, feedback, confidence, error type)

The `TutorHomeworkResults` page already has this UI (`StudentExpandRow`, `TaskItemReview`, `StudentImage`), but the detail page (`/tutor/homework/:id`) doesn't use it.

**Fix**: Enhance the `StudentsList` component in `TutorHomeworkDetail.tsx` to show expandable rows with submission details when results data is available. Each student row will expand to show:
- Student answer images (with signed URL loading)
- Student text answer
- AI verdict (correct/incorrect), score, confidence percentage
- AI feedback text
- AI error type badge

### Changes

**1. `supabase/functions/homework-api/index.ts`** (edge function fix)
- Move `taskMap` declaration from lines 1027-1030 to before line 977
- This is a 4-line move that fixes the crash

**2. `src/pages/tutor/TutorHomeworkDetail.tsx`** (frontend enhancement)
- Add expandable student rows with submission details
- Show student answer images using signed URLs (reuse `getHomeworkImageSignedUrl`)
- Display AI check results: score, feedback, confidence, error type
- Add collapsible/expandable UI with ChevronDown/ChevronUp icons
- Mobile-responsive layout

### Technical Details

- No database changes needed
- Edge function `homework-api` will be redeployed
- No new dependencies required
- The `TutorHomeworkResults` page remains as the full-featured results view; the detail page gets a lighter inline preview of submissions
