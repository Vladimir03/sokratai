

## Fix Build Errors

There are 3 groups of TypeScript errors to fix:

### 1. Edge Function: `yookassa-webhook/index.ts` (6 errors)

**Problem**: The `validatePaymentInDatabase` function types `supabase` as `ReturnType<typeof createClient>` but the generic types don't match, causing the query result to be typed as `never`.

**Fix**: Change the `supabase` parameter type to `any` (since this is a Deno edge function with no generated types) and cast the result appropriately. This is the simplest fix that preserves all existing security logic.

```typescript
// Change line 41 from:
supabase: ReturnType<typeof createClient>,
// To:
supabase: any,
```

### 2. `TutorGuard.tsx` (3 errors, lines 96-97)

**Problem**: `supabase.rpc("is_tutor", ...)` returns a `PostgrestFilterBuilder` (thenable but not a strict `Promise`). Passing it to `withTimeout<T>(promise: Promise<T>, ...)` causes a type mismatch. The destructured `{ data, error }` then resolves to type `{}` / `never`.

**Fix**: Wrap the RPC call with `Promise.resolve()` so it becomes a proper `Promise`, or call `.then()` on it before passing to `withTimeout`. The simplest approach:

```typescript
const { data, error: rpcError } = await withTimeout(
  supabase.rpc("is_tutor", { _user_id: session.user.id }).then((r: any) => r),
  RPC_TIMEOUT_MS,
  "..."
);
```

Alternatively, just remove `withTimeout` wrapper and `await` the RPC directly if the timeout is not critical.

### 3. `TutorSchedule.tsx` (2 errors)

**Error 1 (line 362)**: `createLessonSeries()` (from `tutorSchedule.ts`) uses a local `CreateLessonInput` that requires `tutor_id`, but the call site doesn't pass it. However, `createLessonSeries` internally calls `getCurrentTutor()` to get the tutor_id. The local interface in `tutorSchedule.ts` has `tutor_id` as required. Fix: make `tutor_id` optional in the local `CreateLessonInput` interface in `tutorSchedule.ts` (it's already fetched inside the function).

**Error 2 (line 507)**: `Select onValueChange={setLessonType}` -- `onValueChange` provides `string`, but `setLessonType` expects `LessonType`. Fix: wrap with a cast: `onValueChange={(v) => setLessonType(v as LessonType)}`.

---

### Summary of Changes

| File | Change |
|------|--------|
| `supabase/functions/yookassa-webhook/index.ts` | Change `supabase` param type to `any` |
| `src/components/TutorGuard.tsx` | Wrap RPC call to produce a proper Promise type |
| `src/lib/tutorSchedule.ts` | Make `tutor_id` optional in local `CreateLessonInput` |
| `src/pages/tutor/TutorSchedule.tsx` | Cast `onValueChange` value to `LessonType` |

All fixes are minimal type corrections with zero behavioral or UX impact.

