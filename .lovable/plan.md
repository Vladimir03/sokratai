

## Problem

The frontend code is already correct -- `TutorHomeworkResults.tsx` already has the guided_chat branch (lines 938-956) that uses `assigned_students` instead of `submissions`, and renders `GuidedStudentRow` with `GuidedThreadViewer`. All backend endpoints exist in the edge function code (`POST /thread/messages`, `POST /thread/tasks/:order/reset`, `GET /thread`).

The issue is **deployment**: `homework-api` is not in the CI auto-deploy list (`.github/workflows/deploy-supabase-functions.yml`). The edge function on production may be stale and missing the Phase 3/4 endpoints (tutor message posting, task reset, scoring).

## Plan

### 1. Redeploy `homework-api` edge function

Use the Supabase deploy tool to push the latest `homework-api` code to production. This ensures all endpoints are live:
- `POST /assignments/:id/students/:studentId/thread/messages` (tutor messages)
- `POST /assignments/:id/students/:studentId/thread/tasks/:order/reset` (task reset)
- `GET /assignments/:id/students/:studentId/thread` (tutor thread viewer)
- `workflow_mode` support in assignment creation and retrieval

### 2. Add `homework-api` to CI deployment workflow

Add `supabase functions deploy homework-api` to `.github/workflows/deploy-supabase-functions.yml` so future pushes auto-deploy it.

### 3. Verify data: assignment 4ce28a0e has workflow_mode = 'guided_chat'

Confirm the earlier SQL fix took effect. If not, re-apply:
```sql
UPDATE homework_tutor_assignments SET workflow_mode = 'guided_chat' WHERE id = '4ce28a0e-b77e-4c97-b914-e6dc4717c046';
```

No frontend code changes needed -- everything is already implemented.

