

## Business Dashboard for Pilot Conversion — Plan

### Goal
Add a CEO-focused "Бизнес" tab inside `/admin` answering: *"Is the free pilot converting into willingness to pay?"* — without disturbing existing analytics, CRM, ДЗ, payments tabs.

### Architecture decisions

**1. New tab, not replacing "Аналитика"**
- Add 5th `TabsTrigger` "Бизнес" in `Admin.tsx` (icon: `Briefcase` or `Target`).
- Existing analytics tab stays intact (it serves general platform metrics — useful for product, just not the CEO).

**2. Backend: new edge function `admin-business-dashboard`**
- Don't pollute `admin-analytics` with pilot-specific logic. Keep it isolated and additive.
- Same auth pattern: JWT + `is_admin` RPC check.
- POST body: `{ startDate, endDate, cohort: 'pilot' | 'all' }`.
- Returns single response shape with all metrics pre-computed (one call, fast read).

**3. Manual CRM tags — minimal additive table**
- New table `tutor_pilot_crm` (one row per tutor, additive, separate from `tutors`):
  - `tutor_user_id uuid PRIMARY KEY` (references `auth.users.id`)
  - `is_pilot boolean default false` — pilot cohort flag
  - `willing_to_pay text check in ('yes','maybe','no','unknown') default 'unknown'`
  - `risk_status text check in ('healthy','watch','at_risk') default 'healthy'`
  - `key_pain text` — short free-form
  - `notes text`, `updated_at`, `updated_by`
- RLS: only admins can SELECT/INSERT/UPDATE.
- Clearly **separate table** so it never gets confused with system fields.
- Pilot cohort source = `is_pilot = true` in this table. Default dashboard view = pilot cohort. Filter chip switches to "all tutors".

**4. Metric definitions (computed in edge function)**

All metrics computed over a 7-day rolling window (configurable via date picker, default last 7 days):

- **Started thread** = thread with ≥1 student message (`role='user'` AND `message_kind` in `('answer','hint_request','question')` OR fallback: any `role='user'` non-system message). Created_at of thread alone does NOT count.
- **Meaningful thread** = started thread AND any of: (a) `status='completed'`, (b) ≥1 task_state with `status='completed'`, (c) any task_state with `attempts>0` OR `hint_count>0` OR non-null `earned_score`/`ai_score`.
- **Active day for tutor** = day on which any of their students sent a student message.
- **Repeat Value Tutor** = ≥2 active days AND ≥3 meaningful threads in window.
- **Tutor intervention proxy** = thread has ≥1 `homework_tutor_thread_messages` row with `role='tutor'` AND `visible_to_student=true`. Labeled "proxy".
- **Autonomous Progress Rate** = meaningful threads without tutor intervention / all meaningful threads.
- **Core Workflow Completion Rate** = meaningful threads / started threads.
- **Tutor Revisit Rate** = tutors with ≥2 active days / total pilot tutors.
- **Meaningful Threads per Tutor** = median across pilot tutors (also avg as smaller text).
- **Students Reached** = distinct `student_id` from started threads in window.
- **At-Risk Tutor** = `<2` active days in 7d OR `<2` meaningful threads OR `risk_status='at_risk'`.
- **CEO Verdict** = computed server-side using the 3-tier rule from spec.

**5. Frontend structure**

New folder `src/components/admin/business/`:
- `BusinessDashboard.tsx` — container, fetches + handles state
- `VerdictCard.tsx` — top hero card (3 states with tooltip explainer)
- `BusinessMetricCard.tsx` — reusable card with title, value, sub, info-tooltip
- `AtRiskTutorsTable.tsx` — bottom compact table
- `CrmTagsSummary.tsx` — manual tags counts block, explicitly labeled "Ручные CEO-теги"
- `EditTutorTagsDialog.tsx` — admin can update willing_to_pay / risk_status / key_pain inline from at-risk table

Layout (top to bottom):
```text
[Header: Бизнес-дашборд + subtitle + date picker + cohort toggle]
[Verdict Card — full width, big]
[Row 1: Repeat Value Tutors | Willingness to Pay | At-Risk Tutors | Tutor Revisit Rate]
[Row 2: Meaningful Threads/Tutor | Workflow Completion | Autonomous Progress (proxy) | Students Reached]
[At-Risk Tutors table]
[Manual CRM tags summary — visually distinct, labeled "Ручные теги"]
```

Every metric card has an info `Tooltip` (using existing `@/components/ui/tooltip`) explaining: definition + calculation + direct/proxy.

### Files

**New:**
- `supabase/migrations/<timestamp>_tutor_pilot_crm.sql` — table + RLS
- `supabase/functions/admin-business-dashboard/index.ts` — single endpoint
- `src/components/admin/business/BusinessDashboard.tsx`
- `src/components/admin/business/VerdictCard.tsx`
- `src/components/admin/business/BusinessMetricCard.tsx`
- `src/components/admin/business/AtRiskTutorsTable.tsx`
- `src/components/admin/business/CrmTagsSummary.tsx`
- `src/components/admin/business/EditTutorTagsDialog.tsx`

**Modified (minimal):**
- `src/pages/Admin.tsx` — add 5th tab "Бизнес" with `BusinessDashboard` mount
- `supabase/config.toml` — register new function (default policy)

### Out of scope (explicit)
- No Product Discovery dashboard.
- No changes to existing `admin-analytics` function.
- No charts beyond simple value cards (CEO scan in <15s).
- No bulk CRM editing UI — only per-tutor edit from at-risk table for v1.
- No automatic pilot detection — pilot cohort is manually flagged via `is_pilot` (admin-editable). For v1 we'll seed it empty; admin marks tutors via the same edit dialog.

### Risks & mitigations
- **No tutors marked as pilot yet** → dashboard would be empty. Mitigation: cohort toggle defaults to "pilot" but if `is_pilot` count = 0, show inline empty-state with one-click "show all tutors" + hint to mark pilot tutors.
- **`message_kind` may be null on older messages** → started-thread check uses fallback: `role='user' AND (message_kind IS NULL OR message_kind != 'system')`.
- **Median calculation** done in Postgres via `percentile_cont(0.5)` to avoid loading all rows into Deno.

### Validation
- `npm run lint && npm run build && npm run smoke-check`
- Manual: open `/admin` → Бизнес tab → verify all 8 metric cards render, verdict card computes, edit-tag dialog persists.

