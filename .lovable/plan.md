

## Problem

Two issues in the score editing dialog:
1. "Сбросить override" button text is not understandable for Russian-speaking tutors
2. After saving a tutor override and reopening the dialog, AI score shows "—" instead of the actual AI score, because the backend doesn't return `ai_score` separately in `task_scores`

## Root Cause (Issue #2)

The backend `handleGetResults` returns `task_scores` with `final_score` (which becomes the override value when set), `hint_count`, and `has_override` — but NOT `ai_score`. The frontend in `StudentDrillDown.tsx` (line 136) tries to guess: if `has_override` is true, it passes `aiScore={null}` because it can't distinguish the AI score from the override. This causes the "AI: —/2" display.

## Changes

### 1. Backend: `supabase/functions/homework-api/index.ts`

In the `handleGetResults` function (~line 2148), add `ai_score` to the task_scores output:

```ts
taskScoresByStudent[studentId][ts.task_id] = {
  final_score: Math.round(finalScore * 100) / 100,
  hint_count: hintCount,
  has_override: ts.tutor_score_override != null,
  ai_score: ts.ai_score != null ? Math.round(Number(ts.ai_score) * 100) / 100 : null,
};
```

Redeploy `homework-api`.

### 2. Frontend type: `src/lib/tutorHomeworkApi.ts`

Add `ai_score` to the `task_scores` type (~line 515):

```ts
task_scores: {
  task_id: string;
  final_score: number;
  hint_count: number;
  has_override?: boolean;
  ai_score?: number | null;  // ← add
}[];
```

### 3. Frontend: `src/components/tutor/results/StudentDrillDown.tsx`

- Store `ai_score` in `taskMeta` alongside other fields
- Pass actual `ai_score` to `EditScoreDialog` instead of guessing:

```ts
// Line ~136: replace guessing logic
aiScore={editingTask.ai_score ?? null}
currentOverride={editingTask.has_override ? editingTask.score : null}
```

### 4. Frontend: `src/components/tutor/results/EditScoreDialog.tsx`

- Line 196: "Сбросить override" → "Сбросить правку"
- Line 121: toast "Override сброшен" → "Правка сброшена"

