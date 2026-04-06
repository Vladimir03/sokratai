# Tutor Mini-Groups MVP User Flows

Last updated: 2026-02-23  
Related PRD: `docs/product/tutor-mini-groups-prd.md`

This file contains step-by-step flows and state details for MVP-first implementation.

## 1) Assumptions and Invariants

1. MVP keeps the current model: one lesson row equals one student (`tutor_lessons` remains personalized).
2. Mini-group exists as UI aggregation plus batch orchestration only.
3. Existing contracts are reused:
   - lessons/schedule APIs as-is
   - homework mass-assign with `student_ids[]`
   - payment completion/callbacks per lesson
4. No migration and no edge contract changes in MVP.

## 2) State Vocabulary (MVP)

| State key | Meaning |
|---|---|
| `single` | Regular lesson card without group marker. |
| `group-aggregated` | 2+ lessons in one slot aggregated into one group card. |
| `group-action-pending` | Batch action in progress for group members. |
| `group-action-partial-failed` | Batch action succeeded for some members and failed for others. |
| `group-create-pending` | Batch creation of per-student lessons for one mini-group. |
| `group-create-partial-failed` | Group creation failed for subset of students. |
| `assign-pending` | Group homework assignment is running. |
| `assign-partial-failed` | Assignment/notify failed for subset of students/variants. |

## 3) Flow A: Tutor Schedule (Aggregated Group Card)

### A1. Weekly render and aggregation

Goal: show one group card instead of N separate cards for the same group slot.

Steps:

1. Load weekly lessons via existing schedule fetch.
2. Parse first line of each `notes` for group marker.
3. Build aggregation key `(gid, start_at, duration_min)`.
4. Group lessons by key.
5. Render:
   - one group card if group size >= 2
   - normal single card otherwise
6. For each group card, show:
   - label: user group name or fallback name
   - participant count
   - compact status badges (`booked/completed/cancelled/mixed`)

Edge handling:

1. Marker parse error -> render as single card + non-blocking warning in logs.
2. Only one lesson with marker -> single card fallback.
3. Mixed statuses -> card badge `mixed`, details in drawer.

Performance notes:

1. Aggregation must use memoized computation on already loaded lessons.
2. No extra network requests for grouping.
3. Target: no noticeable lag in weekly view for 100+ lesson rows.

### A2. Group card drawer/modal

Goal: fast one-place operations on the whole mini-group.

Drawer content:

1. Group title and slot metadata.
2. Participant list with per-student status and payment snapshot.
3. Quick actions:
   - move slot (batch update)
   - cancel lessons (batch cancel)
   - complete lessons (batch complete)
4. Placeholder CTAs:
   - assign homework to group
   - open payments details

### A3. Partial failure UX pattern (shared)

When batch action returns mixed results:

1. Keep successful operations (no implicit rollback).
2. Show result summary:
   - `success_count`
   - `failed_count`
   - per-student error rows
3. Show primary CTA `Retry failed`.
4. Keep drawer open until user closes it explicitly.

## 4) Flow B: Create/Edit Lesson (Mini-group mode)

### B1. Entry and mode selection

Goal: preserve existing single-student flow while adding group mode.

Steps:

1. Open existing Add Lesson dialog.
2. Default mode remains `single`.
3. Optional toggle `Mini-group` enables group mode.

### B2. Group create happy path

Steps:

1. Select 2+ students.
2. Fill shared lesson fields (date/time/duration/subject/lesson type).
3. Set optional custom group name.
4. System generates `gid` and marker in notes header.
5. System creates one standard lesson per selected student.
6. Success response returns created count and any failures.
7. UI refreshes schedule and shows one aggregated card.

Naming behavior:

1. If custom name provided -> use as group card title.
2. If empty -> fallback:
   - two students: `Name1 + Name2`
   - 3+ students: `Name1 + N`

### B3. Create error states

1. Validation fail (fewer than 2 students) -> inline message, no requests.
2. Partial creation fail -> show created vs failed rows + retry action.
3. Full fail -> no schedule mutation, keep form inputs.

Compatibility notes:

1. Single mode request/response stays unchanged.
2. Existing edit flow for single lessons remains valid.

## 5) Flow C: Homework for Group

### C1. Mode "Same for all"

Steps:

1. Select target group.
2. Create or pick assignment.
3. Submit one assign call with all participants via `student_ids[]`.
4. Optional notify call using existing endpoint.
5. Show summary (assigned/failed/notified).

### C2. Mode "A/B/C (beta)"

Goal: anti-copying variation without backend contract changes.

Steps:

1. Select target group and choose `A/B/C (beta)`.
2. Create 2-3 assignment variants in UI sequence.
3. Deterministically distribute students across variants:
   - stable sort by `student_id`
   - round-robin assignment (A, B, C, A, B, C...)
4. For each variant, call existing assign endpoint with variant-specific `student_ids[]`.
5. Trigger notify per variant (optional).
6. Show consolidated summary:
   - by variant
   - by student
   - by failed reason

Beta notes:

1. Mark A/B/C as experimental in UI.
2. Keep fallback to "same for all" always available.

### C3. Homework partial failure states

1. Assignment created but assign failed -> show retry assign.
2. Assign succeeded but notify failed -> assignment remains valid, notify retry only.
3. Mixed variant outcomes -> consolidated report with per-variant status.

## 6) Flow D: Payments in Group Context

Goal: keep per-student payment behavior unchanged while exposing group-level context.

Steps:

1. Open group drawer from schedule.
2. Show participant payment statuses (`pending`, `paid`, `overdue`).
3. Completing group session triggers per-lesson completion for each participant.
4. Display per-student results with success/error rows.
5. Allow manual per-student correction from existing payment UI.

Non-goals in this flow:

1. No group-level merged invoice entity.
2. No callback contract changes (`payment:*:lesson_id` unchanged).
3. No schema change in `tutor_payments`.

## 7) Cross-flow Error Matrix

| Scenario | User-visible behavior | Recovery |
|---|---|---|
| Marker removed manually in notes | Lesson falls back to single card | User can recreate group marker via edit flow |
| Move/cancel/complete partial fail | Success + failed breakdown in drawer | Retry failed for remaining rows |
| Homework notify fail | Assignment still active, notify status warning | Retry notify only |
| Student has custom pricing | Group summary shows student-specific amount/status | Adjust only affected student payment |
| Student absent in group lesson | Mark/complete others only | Keep absent student's lesson pending/cancelled |

## 8) QA Checklist (MVP)

1. Aggregation:
   - 2+ lessons with same marker and slot render as one card.
   - single lessons render unchanged.
2. Actions:
   - move/cancel/complete on group updates all members.
   - partial failures produce detailed report and retry path.
3. Homework:
   - same-for-all uses current `student_ids[]` flow.
   - A/B/C distribution is deterministic for same input.
4. Payments:
   - completion still creates/updates per-student payment.
   - callback integrations remain unchanged.
5. Performance:
   - weekly screen remains responsive with 100+ lesson rows.
