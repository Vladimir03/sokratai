

## Unified Mini-Group Lesson: Architecture Redesign

### Problem

Currently, creating a mini-group lesson generates N separate `tutor_lessons` rows (one per student), linked by a shared `group_session_id`. This causes:
1. Confusing UX: button says "Создать 2 занятий" instead of "Создать занятие"
2. Partial failures: one student's lesson can fail while another succeeds (screenshot 2-3 shows "Создано 1 из 2")
3. Payment/action complexity: each student row is managed independently

### Goal

One `tutor_lessons` row per mini-group session. Students are tracked via a new junction table.

### Database Changes

**New table: `tutor_lesson_participants`**

```text
tutor_lesson_participants
├── id               uuid PK
├── lesson_id        uuid FK → tutor_lessons.id ON DELETE CASCADE
├── tutor_student_id uuid FK → tutor_students.id
├── student_id       uuid (denormalized for fast joins)
├── payment_status   text DEFAULT 'unpaid'
├── payment_amount   integer
├── paid_at          timestamptz
├── created_at       timestamptz DEFAULT now()
└── UNIQUE(lesson_id, tutor_student_id)
```

RLS: tutor owns the lesson → can CRUD participants.

**Changes to `tutor_lessons` for mini-group rows:**
- `tutor_student_id` and `student_id` remain NULL for group lessons (no single student)
- `group_session_id`, `group_source_tutor_group_id`, `group_title_snapshot`, `group_size_snapshot` stay as-is

**Update `complete_lesson_and_create_payment` RPC:**
- For group lessons, create one `tutor_payments` row per participant from `tutor_lesson_participants`

### Frontend Changes

**1. `src/lib/tutorScheduleGroupCreate.ts`** — Simplify completely:
- Instead of looping over members and creating N lessons, create ONE lesson via `createLesson()` with `group_session_id`, `group_source_tutor_group_id`, etc.
- Then INSERT all members into `tutor_lesson_participants` in a single batch
- No more partial-failure/retry logic needed for creation (single INSERT + batch participants)
- Remove `MiniGroupCreateResultItem`, `MiniGroupCreateSummary`, and the batch retry pattern

**2. `src/pages/tutor/TutorSchedule.tsx`** — Creation dialog:
- Remove `groupCreateSummary` state and retry UI
- Button text changes from "Создать N занятий" → "Создать занятие"
- Remove per-student error display and "Повторить неуспешные" button
- Single `createLesson()` call + participants insert

**3. `src/pages/tutor/TutorSchedule.tsx`** — Calendar display:
- Grouped card rendering stays mostly the same, but now based on lesson's own `group_session_id` field rather than bucketing multiple lessons
- The card shows participant names from `tutor_lesson_participants` instead of from separate lesson rows
- Fetch participants when opening a group lesson details dialog

**4. `src/lib/tutorScheduleGroupActions.ts`** — Group actions:
- **Move**: update single lesson's `start_at` (one UPDATE, no per-student loop)
- **Cancel**: cancel single lesson (one UPDATE)
- **Complete**: complete single lesson, then create `tutor_payments` for each participant based on their `hourly_rate_cents`
- Remove per-student partial result pattern for move/cancel (they're atomic now)
- Keep per-student payment tracking for complete action

**5. `src/types/tutor.ts`** — Add:
```typescript
export interface TutorLessonParticipant {
  id: string;
  lesson_id: string;
  tutor_student_id: string;
  student_id: string;
  payment_status: string;
  payment_amount: number | null;
  paid_at: string | null;
}
```

**6. LESSON_SELECT in `src/lib/tutorSchedule.ts`**:
- For group lessons, add a way to fetch participants (either via nested select or separate query)

### Migration Path for Existing Data

The migration SQL will include a data migration step:
- For existing lessons with `group_session_id`, create `tutor_lesson_participants` entries from those individual rows
- Then consolidate: keep one lesson per `group_session_id` (the earliest), delete duplicates
- Or: leave old data as-is and only apply new logic going forward (simpler, less risky)

### Scope & Risk

This is a large change touching ~6 files and 1 new table. The highest risk is the `complete_lesson_and_create_payment` RPC which needs to handle both single and group lessons. I recommend:
1. Apply DB migration first (new table + RPC update)
2. Update frontend creation flow
3. Update display/actions
4. Test end-to-end

