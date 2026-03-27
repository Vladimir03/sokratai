## Diagnosis: `disable_ai_bootstrap` not saved to DB

### Root cause

The assignment "Налоги" (`82145896`) was created at `2026-03-27T13:39:03Z` with `disable_ai_bootstrap: false` in the DB, despite the user toggling it OFF in the UI.

**The frontend code and backend code are both correct.** The toggle logic works properly:

- Toggle OFF → `disable_ai_bootstrap: true` in state → sent in POST body → backend writes `b.disable_ai_bootstrap === true`

**Most likely cause**: the `homework-api` edge function was not yet deployed with the `disable_ai_bootstrap` code when the assignment was created. The migration added the column (default `false`), but the edge function still running the old code would ignore the `disable_ai_bootstrap` field in the request body, resulting in the DB default `false`.

### Fix

1. **Redeploy `homework-api**` edge function to ensure the latest code is live
2. **Manually fix the existing assignment** via SQL: `UPDATE homework_tutor_assignments SET disable_ai_bootstrap = true WHERE id = '82145896-0476-4698-9a5a-bb715abb307a'`
3. **Test end-to-end**: create a new assignment with AI bootstrap disabled, verify DB value is `true`, verify student sees no intro messages.  
также сделай по дефолту выключенный тоггл AI вступления

### Files changed

None — this is a deployment issue, not a code bug.

### Technical details

- Column exists: `disable_ai_bootstrap boolean NOT NULL DEFAULT false` ✓
- Backend code (line 377): `disable_ai_bootstrap: b.disable_ai_bootstrap === true` ✓
- Frontend sends: `disable_ai_bootstrap: meta.disable_ai_bootstrap ?? false` ✓
- Toggle logic: `checked={!(meta.disable_ai_bootstrap ?? false)}`, `onCheckedChange={(checked) => onChange({ ...meta, disable_ai_bootstrap: !checked })}` ✓
- Student guard (line 1088): `if (assignment.disable_ai_bootstrap) { skip bootstrap }` ✓