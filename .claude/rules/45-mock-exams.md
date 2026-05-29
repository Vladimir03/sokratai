# Mock Exams (`mock_exam_*`)

Mock-exams pilot (ЕГЭ physics, variant 1). Invariants distilled from the build-out (Phases 1–6 + pilot polish AC-P3..P11 + TASK-16/17). Round-by-round history + full specs: `docs/delivery/features/mock-exams-v1*/` and `~/.claude/plans/1-functional-meteor.md`.

## Anti-leak — STATE-AWARE (do NOT copy homework's tutor-only model)

Mock-exam reveal depends on `attempt.status` — it is **not** "never show the student":

- **pre-submit** (`in_progress` / `paused`) → result endpoint refuses (409 / 410). `correct_answer` must never load into process memory.
- **post-submit, pre-approval** (`submitted` / `ai_checking` / `awaiting_review`) → reveal Часть 1 only (`correct_answer`, `kim_number`); Часть 2 = totals only.
- **post-approval** (`approved`) → reveal Часть 2 (`solution_text`, `tutor_score`, `tutor_comment`) — this IS the value proposition.
- **`ai_draft_json` / `ai_part1_ocr_json`** → never to the student, any status (tutor-only artifacts).

Contrast with homework: `solution_text` / `rubric_*` there are tutor-only **forever** (rule 40). If a reviewer flags "solution_text leak on the result page", confirm via the `status === 'approved'` gate — post-approval reveal is **by design**.

Endpoint hardening (`mock-exam-public`, `mock-exam-student-api`):
- Column-whitelisted SELECT (never `*`). Tutor-card whitelist = `name, avatar_url, bio, subjects` only — never `telegram_id`, `booking_link`, `email`.
- Conditional SELECT by `isApproved`: pre-approval must not load `task_text` / `solution_text` / `topic` into memory (defense-in-depth).
- Any new pre-submit status MUST be added to the result-endpoint early-reject and excluded from the post-submit allowlist (the `paused` leak, H1, came from missing this).
- Student RLS column guards: students may only write `earned_score IS NULL` + `score_source='student_form'` (blocks `score_source` spoofing).

## AI graders — frozen contract, never auto-publish

`mock-exam-grade` runs as a background, fire-and-forget job from submit. Tutor approval stays mandatory; AI never publishes to the student.

- **Frozen JSON shape** (mirror in `src/types/mockExam.ts::MockExamPart2Draft`): `{ suggested_score: number|null, confidence: 'low'|'medium'|'high', elements_check:{I,II,III,IV}, comment_for_tutor, flags[], assigned_photo_indices?[] }`. Extend additively only.
- Endpoint responses carry counters only — never `ai_draft_json` / `suggested_score`.
- **State machine:** `in_progress → submitted → ai_checking → awaiting_review → approved`. Submit leaves status `submitted`; the grader CAS-claims `submitted → ai_checking → awaiting_review`. Never set `ai_checking` directly in the submit handler.
- **Stale-lock = 120s** in all 3 callsites (grader CAS, `retry-part1-ocr`, `regrade-part2`). `retry` / `regrade` reject a fresh `ai_checking` (409 GRADING_IN_PROGRESS) unless stale.
- **Bulk Часть 2** = two-pass: Pass 1 assigns photos→KIM (`buildBulkAssignmentPrompt`), Pass 2 grades per-KIM in parallel. Persisted tutor `assigned_photo_indices` are NOT overwritten on regrade.
- **Tutor status preservation:** the bulk path never overwrites rows `status IN (tutor_approved, tutor_modified)` — only `ai_draft_json`.
- **Approve never blocks:** missing scores auto-zero with a transparent `tutor_comment` (no `INCOMPLETE_*` 400s).

## Part 1 — deterministic checker + OCR

- **Deno-mirror invariant (CRITICAL):** `src/lib/mockExamPart1Checker.ts` (browser preview + frontend) ↔ `supabase/functions/_shared/mock-exam-part1-checker.ts` (server submit / OCR / recheck) must stay logically identical. Grep both for `gradeMultiChoice` / `gradeOrdered` / `numericRoundingMatch` before merge. Symptom of drift: "preview says correct, final gives 0".
- **Partial credit (ФИПИ 2026):** `gradeMultiChoice` (KIM 5/9/14/18, set-error count) + `gradeOrdered` (KIM 6/10/15/17, Hamming distance) give 1 of max for a single error. All other modes binary — never bleed partial credit into strict / unordered / task20 / pair.
- **Strict-only rounding tolerance:** `numericRoundingMatch` is a fallback in `check_mode='strict'` only; scale = decimals in `correct`; never widen `student` beyond `correct`'s scale.
- **`score_source` enum** (`ocr` / `tutor` / `finalize_default` / `student_form`): every write to `mock_exam_attempt_part1_answers` must set it explicitly. The OCR re-run skip filter is `score_source === 'tutor'` only (never `earned_score IS NOT NULL`).
- **`ai_part1_ocr_json` canonical shape** = `{ cells:{[kim]:{value,confidence}}, __meta:{status:'success'|'failed', …} }`. Read via `.cells[kim]` + `.__meta.status`. Legacy rows pass through `normalizePart1OCRJson` in `handleGetAttempt`.

## Pause / multi-session (AC-P10)

- `exam_mode` = `simulation` (wall-clock, no pause) | `training` (active-time + pause). **Immutable after first start.** Do not confuse with `MockExamMode = blank|form|manual_entry` (data-collection method).
- `sessions` JSONB (`{started_at, ended_at}[]`) + `total_active_ms`; status adds `paused`. Active time = sum(closed sessions) + (now − latest open); never wall-clock for `training`.
- Pause only in `training` (frontend hides + backend rejects as defense-in-depth). CAS guards on pause/resume for multi-tab. `paused` redirects out of the taking surface.
- Tutor `default_exam_mode` = recommendation; the student choice wins (override indicator shown). Persist `default_exam_mode` in `handleCreateAssignment` — don't rely on the DB default.

## Seed + recipient management

- Seed (`supabase/seed/mock_exams_variant_1.sql`) is generated by `scripts/build-mock-exam-seed.py` from `docs/.../variant1-tasks.json` (deterministic uuid5). Edit the JSON + regenerate — never hand-edit `seed.sql`. `scripts/enhance-mock-exam-with-latex.py` is a deprecated stub — don't run it.
- `mock_exam_variant_tasks` has **no** `updated_at` column; resync migrations UPDATE `task_text` only (never `correct_answer` / `max_score` / `check_mode` without a separate spec).
- Recipient mgmt (`mock-exam-tutor-api`): `assign-students` (idempotent, cascade push + telegram notify), `DELETE assignment` (FK cascade), `DELETE attempt`. Never block delete by status — use a context-aware confirmation in the UI.
- Variant PDF in bucket `mock-exam-variant-pdfs` must be sliced to question pages only (`scripts/slice-variant-pdf.py`) — answer/criteria pages must not leak. Visual-review every page before upload.

## Subject

Variant 1 = physics ЕГЭ. `_shared/mock-exam-prompts.ts` uses `resolveSubjectRubric` (rule 40 → subject-rubric layer) with `subject:'physics'`, `exam_type:'ege'`. For a non-physics variant: add `mock_exam_variants.subject`, pass it through to the prompt builder — the rubric module is already subject-agnostic.
