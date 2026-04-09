## Problem

When a tutor tries to manually add a student, the toast shows a generic "Edge Function returned a non-2xx status code" error. Two issues:

1. **Poor error handling in frontend**: `supabase.functions.invoke()` returns a generic error message for any non-2xx response. The actual error details (e.g., "Email or Telegram username is required") are in the `data` field, but the code only reads `error.message`.
2. **Missing from CI deploy**: `tutor-manual-add-student` is not listed in `.github/workflows/deploy-supabase-functions.yml`, so it may become stale after code changes.

## Changes

### 1. Fix error handling in `src/lib/tutors.ts` (~line 402-415)

Update `manualAddTutorStudent` to extract the actual error message from the function's response body:

```ts
export async function manualAddTutorStudent(
  input: ManualAddTutorStudentInput,
): Promise<ManualAddTutorStudentResponse> {
  const { data, error } = await supabase.functions.invoke("tutor-manual-add-student", {
    body: input,
  });

  if (error) {
    console.error("Error adding student manually:", error, "data:", data);
    const detail =
      (data && typeof data === "object" && typeof data.error === "string")
        ? data.error
        : error.message || "Не удалось добавить ученика";
    throw new Error(detail);
  }

  return data as ManualAddTutorStudentResponse;
}
```

### 2. Add to CI deploy workflow `.github/workflows/deploy-supabase-functions.yml`

Add `supabase functions deploy tutor-manual-add-student` and `supabase functions deploy tutor-update-student` to the deploy script.

### 3. Redeploy edge function

Deploy `tutor-manual-add-student` to ensure it's current.

Whrite what was the problem and why!