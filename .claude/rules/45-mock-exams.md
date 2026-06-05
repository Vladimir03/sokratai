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

`mock-exam-grade` runs as a background, fire-and-forget job from submit. Tutor approval stays mandatory; AI never AUTO-publishes the FINAL grade — but a **preliminary** AI result IS shown to the student post-submit (2026-06-02, item 2), clearly labelled, and the tutor still confirms/corrects.

- **Frozen JSON shape** (mirror in `src/types/mockExam.ts::MockExamPart2Draft`): `{ suggested_score: number|null, confidence: 'low'|'medium'|'high', elements_check:{I,II,III,IV}, comment_for_tutor, feedback, flags[], assigned_photo_indices?[] }`. Extend additively only.
- **`feedback` (2026-06-02, item 2)** — detailed «что верно/неверно» разбор shown to BOTH student and tutor (friendly, anti-spoiler). It is the ONLY `ai_draft_json` field besides `suggested_score` that may reach the student; `comment_for_tutor`/`flags`/`elements_check` stay tutor-only. Default `""` for pre-2026-06-02 attempts (re-grade to backfill).
- **Pre-approval Part 2 reveal (2026-06-02, item 2)** — `handleGetResult` now exposes, per task, `suggested_score` + `feedback` (extracted from `ai_draft_json`) + `solution_text`/`solution_image_urls` + `task_text`/`task_image_url` + `max_score`, labelled «предварительно — репетитор подтвердит». Reference solution revealed post-submit is intentional (one-shot exam, no retakes). `tutor_score`/`tutor_comment` still post-approval. NEVER expose `comment_for_tutor`/`flags`/`elements_check` to the student.
- Endpoint responses carry counters only for the **tutor list** — never raw `ai_draft_json`.
- **State machine:** `in_progress → submitted → ai_checking → awaiting_review → approved`. Submit leaves status `submitted`; the grader CAS-claims `submitted → ai_checking → awaiting_review`. Never set `ai_checking` directly in the submit handler.
- **Stale-lock = 120s** in all 3 callsites (grader CAS, `retry-part1-ocr`, `regrade-part2`). `retry` / `regrade` reject a fresh `ai_checking` (409 GRADING_IN_PROGRESS) unless stale.
- **Bulk Часть 2** = two-pass: Pass 1 assigns photos→KIM (`buildBulkAssignmentPrompt`), Pass 2 grades per-KIM in parallel. Persisted tutor `assigned_photo_indices` are NOT overwritten on regrade.
- **Tutor status preservation:** the bulk path never overwrites rows `status IN (tutor_approved, tutor_modified)` — only `ai_draft_json`.
- **Approve never blocks:** missing scores auto-zero with a transparent `tutor_comment` (no `INCOMPLETE_*` 400s).
- **`total_score` is STORED, not derived** — heatmap (`MockExamHeatmap.tsx`) and student result API read the column directly, no recompute. **Invariant: when non-null, `total_score = COALESCE(total_part1_score,0) + COALESCE(total_part2_score,0)`.** Every handler that writes `total_part1_score`/`total_part2_score` MUST resync `total_score` in the same UPDATE (guard `if (attempt.total_score !== null)` — pre-approval stays null). `handleApproveAll` writes all three together; `handleRecheckPart1` / `handlePart1ManualScore` / `handlePart1Finalize` touch part1 only → each resyncs. Drift bug 2026-06-01: recheck («Применить критерии ФИПИ») on an `approved` attempt raised part1 via partial credit but left `total_score` stale → ИТОГО showed 19 instead of 21 (part1 19 + part2 2). Backfill migration `20260601140000`. `manually_entered` is exempt (its `total_score` is tutor-entered, parts NULL).

## Part 1 — deterministic checker + OCR

- **Deno-mirror invariant (CRITICAL):** `src/lib/mockExamPart1Checker.ts` (browser preview + frontend) ↔ `supabase/functions/_shared/mock-exam-part1-checker.ts` (server submit / OCR / recheck) must stay logically identical. Grep both for `gradeMultiChoice` / `gradeOrdered` / `numericRoundingMatch` before merge. Symptom of drift: "preview says correct, final gives 0".
- **Partial credit (ФИПИ 2026):** `gradeMultiChoice` (KIM 5/9/14/18, set-error count) + `gradeOrdered` (KIM 6/10/15/17, Hamming distance) give 1 of max for a single error. All other modes binary — never bleed partial credit into strict / unordered / task20 / pair.
- **Strict-only rounding tolerance:** `numericRoundingMatch` is a fallback in `check_mode='strict'` only; scale = decimals in `correct`; never widen `student` beyond `correct`'s scale.
- **`score_source` enum** (`ocr` / `tutor` / `finalize_default` / `student_form`): every write to `mock_exam_attempt_part1_answers` must set it explicitly. The OCR re-run skip filter is `score_source === 'tutor'` only (never `earned_score IS NOT NULL`).
- **`ai_part1_ocr_json` canonical shape** = `{ cells:{[kim]:{value,confidence}}, __meta:{status:'success'|'failed', …} }`. Read via `.cells[kim]` + `.__meta.status`. Legacy rows pass through `normalizePart1OCRJson` in `handleGetAttempt`.
- **Tutor answer display resolves from BOTH sources (2026-06-02 fix):** the Часть 1 review must show the student answer as `student_answer ?? ai_part1_ocr_json.cells[kim].value` — typed/auto-saved first, else OCR-recognized. `TutorMockExamReview.tsx::resolvePart1StudentAnswer` is the single helper (used by `Part1SummaryCard` table, the counters, and both `Part1TaskDrillDownDialog` call-sites). Symptom of regressing this: tutor sees «без ответа» for a blank/OCR or NULL-`answer_method` attempt despite a real score (the form-card branch reads only `student_answer`). Counters: «верно/частично/неверно» from `earned_score` (`wrong` = `earned_score === 0` STRICTLY — never `?? 0`, else null-earned rows with a resolved answer mis-bucket as «неверно»), «не проверено» = `earned_score === null` + resolved present, «без ответа» = resolved value null. Never gate `wrong` on `student_answer !== null` (drops OCR rows → all counts read 0).
- **Blank thumbnail gating (2026-06-02):** `Part1SummaryCard` shows the uploaded ФИПИ blank / fallback photo ONLY when `answer_method !== 'form'` (i.e. null/legacy — where it may be a real OCR attempt mis-routed to the form card). Explicit `'form'` attempts may carry a leftover blank from a mode-switch — hide it (not grading-relevant; tutor-only, not a leak, but confusing).

## Часть 2 bulk photos — upload + delete (single bulk pack)

- **Model:** ONE bulk pack per attempt — `mock_exam_attempts.part2_bulk_photo_urls` (dual-format: single ref OR JSON-array), AI two-pass assigns photos→KIM. No per-task attach (removed Phase 5). Cap = `MAX_PART2_BULK_PHOTOS` (10), mirrored frontend (`StudentMockExam.tsx`) ↔ backend (`mock-exam-student-api`).
- **Append-only + CAS:** upload appends `[...existing, ref]` under a 3-retry CAS (`UPDATE … WHERE part2_bulk_photo_urls = rawCurrent`). `handleDeleteBulkPhoto` (`POST /attempts/:id/photo/delete`, body `{kind:'part2_bulk', photo_url}`) deletes **by identity, NOT index** (ChatGPT-5.5 review fix): client sends the signed `photo_url` it renders (or a raw `storage://` ref), backend normalizes to `{bucket,path}` and matches a stored ref by path. Index was unsafe — concurrent deletes shift indices, and the GET drops failed-to-sign URLs so the UI index can diverge from the stored index. Same 3-retry CAS re-matches by path each iteration, then `storage.remove()` the blob (best-effort, rule 50 order: clear DB ref first). Photo not found → 409 `PHOTO_ALREADY_REMOVED`.
- **Status drift guard (CRITICAL):** the delete CAS UPDATE MUST include `.eq("status","in_progress")` AND re-read `status` inside the retry loop. `handleSubmitAttempt` flips `status` to `submitted` WITHOUT touching `part2_bulk_photo_urls`, so a delete checked-once-before-the-loop would still CAS-match and remove a blob from a submitted attempt — and submit fires the grader (fire-and-forget) on those photos. Status drift → 409 `NOT_IN_PROGRESS`.
- **Student delete UX:** ✕ on each thumbnail must be always-visible (not hover — touch breaks, rule 80) + a confirm step; optimistic remove with restore-on-error + `toast.error`. Upload errors go to a toast too (tiny inline text was missed by pilot students).
- **Frontend single-flight on bulk mutations (2026-06-02 review fix):** delete is identity-keyed (by url), and while a delete is in flight (`deletingUrl !== null`) BOTH other deletes AND uploads are disabled — the bulk pack has one mutation at a time. Critically, restore-on-error MUST be a **functional re-add** (`setPart2BulkPhotos(prev => prev.includes(url) ? prev : [...prev, url])`), NOT a captured `snapshot` — restoring a stale snapshot would clobber a concurrent upload's signed URL that the backend already persisted.

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
