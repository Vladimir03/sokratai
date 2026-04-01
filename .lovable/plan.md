

## Fix: Student homework page crash ("Cannot access 'le' before initialization")

The published site crashes with a TDZ (Temporal Dead Zone) error because of two issues in the codebase.

### Root cause

**Issue 1: Missing `task_order` on `HomeworkTaskState` type**
`src/types/homework.ts` line 152 — the `HomeworkTaskState` interface lacks `task_order: number`. The DB returns this field, but TypeScript doesn't know about it. 11 references in `GuidedHomeworkWorkspace.tsx` fail compilation.

**Issue 2: `switchToTask` used before declaration**
`GuidedHomeworkWorkspace.tsx` line 840 — `checkAnswer` callback references `switchToTask` in its dependency array, but `switchToTask` is defined at line 1106. This causes a TDZ error at runtime (the "Cannot access 'le' before initialization" — where `le` is the minified variable name for `switchToTask`).

### Fix plan

**File 1: `src/types/homework.ts`**
- Add `task_order: number;` to the `HomeworkTaskState` interface (after `task_id`)

**File 2: `src/components/homework/GuidedHomeworkWorkspace.tsx`**
- Move `switchToTask` callback declaration **before** `checkAnswer` (before line ~700, after `syncThreadDataOnly` and other dependencies it uses)
- This resolves both the build error and the runtime TDZ crash

### Impact
- Fixes the production crash for all students opening guided homework
- No database changes needed
- No backend changes needed

