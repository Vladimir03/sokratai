

## Product Discovery Dashboard — Plan

### Goal
Add a 6th tab "Открытия" (Product Discovery) in `/admin` answering: *"Где продукт создаёт прогресс, а где требует доработки?"* Operational focus: help tutor see in the morning where to intervene.

### Architecture

**1. New tab in `Admin.tsx`** — icon `Lightbulb` or `Compass`, between "Бизнес" and "CRM". No changes to other tabs.

**2. New edge function `admin-product-discovery`**
- Same auth pattern as `admin-business-dashboard` (JWT + `is_admin` RPC).
- POST body: `{ startDate, endDate, tutorId?: string }`.
- Returns single response shape with all 11 metrics + morning review queue + pattern buckets pre-computed.
- Isolated from `admin-analytics` and `admin-business-dashboard` — different unit of analysis (thread, not tutor).

**3. No new DB tables, no migrations** — purely additive read-only computation from existing `homework_tutor_*` tables.

### Metric definitions (computed server-side)

Unit of analysis: **student_assignment thread** (`homework_tutor_threads`).

- **Started thread** = thread with ≥1 message where `role='user'` AND (`message_kind` IN `('answer','hint_request','question')` OR `message_kind IS NULL` for legacy data, EXCLUDING `message_kind='system'`).
- **Meaningful thread** = started thread with ANY: (a) `status='completed'`, (b) ≥1 task_state with `status='completed'`, (c) any task_state with `attempts>0` OR `hint_count>0`.
- **Tutor intervention** = thread has ≥1 message with `role='tutor'` AND `visible_to_student=true`. Labeled "proxy".
- **First student action timestamp** = MIN created_at where role=user AND non-system message_kind.
- **First meaningful timestamp** = earliest of: thread completed_at, first task_state completion, first attempt/hint event (use `task_states.updated_at` as proxy if no event log).
- **Needs attention** rules (any of):
  - started ≥24h ago AND no meaningful progress
  - hint_count ≥3 across all task_states AND no completed task
  - has tutor_message visible_to_student=true (already required help)
  - sum(attempts) ≥5 across task_states AND no completed task

### Pattern buckets (top 3 each)

**Success buckets** (computed over meaningful threads):
1. Completed without tutor intervention
2. Meaningful with 1–2 hints total
3. Completed after hint usage

**Failure buckets** (computed over started threads):
1. Started but no meaningful progress
2. High hint usage (≥3) without completion
3. Repeated attempts (≥5) without completion

Return as `{ label, count, share }[]` sorted desc.

### Morning Review Queue (operational)

Compact table data: top 30 needs_attention threads in window, with:
`thread_id, tutor_name, student_name, assignment_title, status, last_student_activity, total_hints, total_attempts, tutor_intervened, attention_reason[]`.

### Frontend structure

New folder `src/components/admin/discovery/`:
- `ProductDiscoveryDashboard.tsx` — container, fetches + state
- `DiscoveryMetricCard.tsx` — reusable card with title, value, sub, info-tooltip, optional "proxy" badge
- `MorningReviewQueue.tsx` — compact scannable table
- `PatternBuckets.tsx` — two side-by-side cards (success / failure) with top-3 lists

Reuse existing: `Card`, `Tooltip`, `Table`, `Badge` from `@/components/ui`.

Layout (top → bottom):
```text
[Header: Product Discovery + subtitle + date picker + tutor filter + "system data only" note]
[Row 1: Meaningful Progress Rate (NSM, larger) | Started Thread Rate | Thread Completion Rate | Needs Attention Rate]
[Row 2: Partial Useful Progress | Autonomous Progress (proxy) | Tutor Intervention Rate (proxy) | Median Time to Meaningful]
[Row 3: Morning Review Queue count card + period delta]
[Row 4: Top Successful Patterns | Top Failure Patterns]
[Bottom: Threads Requiring Morning Review table — compact, scrollable]
```

Every metric card has info `Tooltip` explaining: definition + formula + direct/proxy.

### Files

**New:**
- `supabase/functions/admin-product-discovery/index.ts`
- `src/components/admin/discovery/ProductDiscoveryDashboard.tsx`
- `src/components/admin/discovery/DiscoveryMetricCard.tsx`
- `src/components/admin/discovery/MorningReviewQueue.tsx`
- `src/components/admin/discovery/PatternBuckets.tsx`

**Modified (minimal):**
- `src/pages/Admin.tsx` — add 6th tab "Открытия"
- `supabase/config.toml` — register new function

### Out of scope (explicit)
- No subject breakdown.
- No manual CRM tags.
- No Product Verdict block.
- No Business Dashboard changes.
- No new DB tables/migrations.
- No vanity metrics (total users, total messages).
- No charts beyond simple cards + one compact table.

### Risks & mitigations
- **`message_kind` may be null on legacy messages** → use the same fallback as Business Dashboard: `role='user' AND (message_kind IS NULL OR message_kind != 'system')`.
- **No event log for "first meaningful moment"** → use `task_states.updated_at` as proxy for first-completion-or-progress event. Median computed in Postgres with `percentile_cont(0.5)`.
- **Large thread counts** → cap morning review queue to top 30 by recency × severity score; metric aggregates use `count(*)` directly.
- **Tutor filter empty state** → if tutor has no threads in window, show "Нет данных за период" inside cards (not error).

### Validation
- `npm run lint && npm run build && npm run smoke-check`
- Manual: `/admin` → "Открытия" tab → verify all 8 metric cards, both pattern blocks, morning review table render with real data; tooltips show; tutor filter narrows results.

