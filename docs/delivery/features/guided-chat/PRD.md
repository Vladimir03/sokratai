# PRD: Guided Homework Chat for Tutor + Student + AI

Version: 2.0 (post Phase 1 + 2 + 2.1 implementation)
Date: 2026-03-07

---

## Summary

Guided Homework Chat replaces the legacy batch "submit all answers -> wait for AI check" homework flow with a task-by-task interactive dialogue between Student and AI. The student solves one task at a time in a chat-like workspace, receives hints, asks questions, and advances upon completing each task. The tutor observes progress in real time and can intervene directly in the chat. AI evaluates answers, manages scoring, and provides pedagogical guidance.

### Key Decisions (unchanged from v1)

- New `homework_tutor_threads` domain, NOT retrofitting `chats/chat_messages`.
- Homework guided chat does NOT consume general `/chat` daily limits (to be decoupled in Phase 5; currently shared).
- Legacy `homework_tutor_submissions` becomes a derived read-model for guided mode.
- Task bank and folders are a separate initiative (Phase 6).

---

## Current State of Implementation

| Phase | Status | Scope |
|---|---|---|
| Phase 1: Schema + Provisioning | DONE | DB tables, RLS, thread creation on assign, workflow_mode toggle |
| Phase 2: Student Workspace | DONE | Chat UI, SSE streaming, message persistence, task advancement |
| Phase 2.1: UX Polish | DONE | State machine, hint/question modes, message reliability, tutor read-only viewer, telemetry |
| Phase 3: AI Orchestration + Scoring | NOT STARTED | Answer checking, score degradation, auto-advance, await_mode server state |
| Phase 4: Tutor Participation | NOT STARTED | Tutor writes into thread, tutor messages as AI context |
| Phase 5: Compatibility + Rollout | NOT STARTED | Derived sync, quota separation, reporting, migration guard |
| Phase 6: Task Bank + Folders | NOT STARTED | Catalog, folders, task picker, reusable task sets |

See `implementation-summary.md` for detailed technical inventory of Phases 1-2.1.

---

## Data Model

### Existing Tables (implemented)

```
homework_tutor_assignments
  + workflow_mode TEXT NOT NULL DEFAULT 'classic'  -- 'classic' | 'guided_chat'

homework_tutor_threads
  id              UUID PK
  student_assignment_id  UUID UNIQUE FK -> homework_tutor_student_assignments
  status          TEXT  -- 'active' | 'completed' | 'abandoned'
  current_task_order     INT
  created_at, updated_at

homework_tutor_thread_messages
  id              UUID PK
  thread_id       UUID FK -> threads (CASCADE)
  role            TEXT  -- 'user' | 'assistant' | 'system'
  content         TEXT
  image_url       TEXT nullable
  task_order      INT nullable
  message_kind    TEXT nullable  -- 'answer' | 'hint_request' | 'question' | 'ai_reply' | 'system'
  created_at

homework_tutor_task_states
  id              UUID PK
  thread_id       UUID FK -> threads
  task_id         UUID FK -> homework_tutor_tasks
  status          TEXT  -- 'locked' | 'active' | 'completed' | 'skipped'
  attempts        INT DEFAULT 0
  best_score      INT nullable
  created_at, updated_at
  UNIQUE(thread_id, task_id)
```

### Schema Changes Required for Phase 3

```sql
-- Task states: add scoring and await_mode
ALTER TABLE homework_tutor_task_states
  ADD COLUMN available_score  NUMERIC(8,2),   -- degrades per wrong answer/hint
  ADD COLUMN earned_score     NUMERIC(8,2),   -- set on correct answer
  ADD COLUMN wrong_answer_count INT DEFAULT 0,
  ADD COLUMN hint_count         INT DEFAULT 0,
  ADD COLUMN await_mode   TEXT DEFAULT 'answer',  -- 'answer' | 'question'
  ADD COLUMN context_summary    TEXT,            -- compressed context for task re-entry
  ADD COLUMN last_ai_feedback   TEXT;            -- latest AI evaluation text

-- Thread messages: add author tracking for Phase 4
ALTER TABLE homework_tutor_thread_messages
  ADD COLUMN author_user_id  UUID nullable,     -- null for AI, set for student/tutor
  ADD COLUMN visible_to_student BOOLEAN DEFAULT true;  -- tutors can send hidden notes
```

### Schema Changes Required for Phase 4

```sql
-- Threads: add tutor tracking
ALTER TABLE homework_tutor_threads
  ADD COLUMN last_student_message_at  TIMESTAMPTZ,
  ADD COLUMN last_tutor_message_at    TIMESTAMPTZ;
```

---

## API Surface

### Student Endpoints (implemented)

| Method | Path | Phase | Status |
|---|---|---|---|
| GET | `/threads/:id` | 1 | Done |
| POST | `/threads/:id/messages` | 2 | Done |
| POST | `/threads/:id/advance` | 2 | Done |

### Student Endpoints (Phase 3)

| Method | Path | Purpose |
|---|---|---|
| POST | `/threads/:id/hint` | Request a hint for current task. Increments `hint_count`, degrades `available_score`, AI responds with hint. |
| POST | `/threads/:id/check` | Submit answer for AI evaluation. If correct: sets `earned_score`, auto-advances. If wrong: increments `wrong_answer_count`, degrades score, AI gives guidance. |

**Note:** Phase 2 uses manual advance. Phase 3 replaces it with `POST /check` which auto-advances on correct answer and removes the "Zadacha vypolnena" button.

### Tutor Endpoints

| Method | Path | Phase | Status |
|---|---|---|---|
| GET | `/assignments/:id/students/:studentId/thread` | 2.1 | Done (read-only) |
| POST | `/assignments/:id/students/:studentId/thread/messages` | 4 | Planned |

### Internal (no client-facing)

| Operation | Phase | Trigger |
|---|---|---|
| Thread + task_states provisioning | 1 | Done -- on `POST /assignments/:id/assign` |
| Derived sync to submissions/items | 5 | Planned -- on task completion |

---

## UX Flows

### Student Workspace (implemented)

```
Open /homework/:id (guided_chat assignment)
  |
  v
[TaskStepper] -- horizontal progress bar, all tasks
  |
[Task Panel] -- task text + task image + materials
  |
[Chat Area] -- message history + streaming AI
  |
[Controls] -- Hint | Question | Advance + Input
```

**UI State Machine (implemented):**

| State | Badge | Input Enabled | Advance Enabled |
|---|---|---|---|
| `awaiting_answer` | "Zhdem otvet" | Yes | No |
| `streaming_ai` | "II dumaet" | No | No |
| `ready_to_advance` | "Mozhno perejti" | Yes | Yes |
| `advancing` | "Perekhodim" | No | No |
| `send_error` | "Oshibka otpravki" | Yes (retry) | No |

**Input Modes (implemented):**

| Mode | Button | message_kind | AI Behavior |
|---|---|---|---|
| Answer | (default) | `answer` | Checks correctness (Phase 3: AI eval; Phase 2: no eval) |
| Hint | "Podskazka" | `hint_request` | Short hint, no solution |
| Question | "Zadat' vopros" | `question` | Focused answer, auto-resets to answer mode |

**Message Delivery (implemented):**
- Optimistic add -> save to server -> status: sending -> sent/failed.
- Failed messages show retry button on bubble.

### Student Workspace (Phase 3 changes)

1. **Answer submission flow changes:** Student message -> AI evaluates -> if correct: "Pravilno!" + score + auto-advance to next task. If wrong: "Nepravilno" + hint + stays on task.
2. **Remove "Zadacha vypolnena" button.** Advance is automatic on correct answer.
3. **Score display:** Show `available_score` in task panel. Show degradation after each wrong answer/hint.
4. **Hint flow changes:** Hint request -> AI gives pedagogical hint -> `available_score` degrades by 10%.

### Tutor Workspace (Phase 4)

1. Tutor opens `TutorHomeworkResults` -> selects student -> sees guided thread viewer.
2. Tutor can type messages into the same thread (with `author_user_id` set).
3. Tutor messages visible to student in chat.
4. AI does NOT respond to tutor messages directly.
5. AI includes tutor messages as `instructional_context` in next student AI-run.
6. Tutor can send hidden notes (`visible_to_student = false`) that only affect AI context.

---

## Scoring and AI Rules (Phase 3)

### Score Degradation

- Base score = `task.max_score`.
- Each wrong answer: `-10%` of original.
- Each hint: `-10%` of original.
- Floor: `50%` of original.
- Formula: `available_score = max_score * max(0.5, 1 - 0.1 * (wrong_answer_count + hint_count))`.
- On correct answer: `earned_score = available_score`.
- On thread completion without solving: `earned_score = 0` (unless tutor override).

### AI Prompt Structure (Phase 3)

```
[System]
Role: homework tutor for subject {subject}, topic {topic}.
Task {N}/{total}: {task_text}
{task_image OCR if available}
Available score: {available_score}/{max_score}
Wrong attempts: {wrong_answer_count}, Hints used: {hint_count}
Assignment materials: {materials summary}
{tutor_hidden_notes if any}

[Task-scoped message history: last 15 messages for current task]

[If answer mode]
Evaluate the student's answer. If correct, respond EXACTLY with:
VERDICT: CORRECT
{praise and brief explanation}
If incorrect, respond EXACTLY with:
VERDICT: INCORRECT
{brief pedagogical hint without giving the answer}

[If hint mode]
Give a short hint that guides the student toward the solution
without revealing the answer directly.

[If question mode]
Answer the student's question about the task.
Do not reveal the answer to the task itself.
```

### AI Evaluation Protocol (Phase 3)

1. Student sends answer -> saved with `message_kind: 'answer'`.
2. Backend calls AI evaluation (NOT client-side streaming; server-to-server).
3. AI response parsed for `VERDICT: CORRECT` or `VERDICT: INCORRECT`.
4. If CORRECT:
   - `earned_score = available_score`.
   - Task_state.status = `completed`.
   - Auto-advance to next task.
   - System message: "Zadacha {N} vypolnena! Bal: {earned}/{max}. Perekhodim k zadache {N+1}."
5. If INCORRECT:
   - `wrong_answer_count++`.
   - `available_score` recalculated.
   - AI hint saved as assistant message.
   - Stays on current task.

**Architecture decision:** Phase 3 moves AI evaluation to server-side (edge function) instead of client-side streaming, because:
- Verdict parsing must be trusted (client can't decide correct/incorrect).
- Score writes must be server-authoritative.
- Client still sees streaming via SSE from the edge function relaying AI response.

---

## Telemetry (implemented)

Events pushed to console + Google Analytics dataLayer:

| Event | Trigger |
|---|---|
| `guided_send_click` | Student sends message |
| `guided_send_failed` | Message save failed |
| `guided_retry_click` | Student retries failed message |
| `guided_retry_success/failed` | Retry result |
| `guided_hint` | Hint requested |
| `guided_question_mode` | Question mode activated |
| `guided_advance_click` | Advance button clicked |
| `guided_advance_success/failed` | Advance result |
| `guided_stream_failed` | AI streaming error |
| `guided_prev/next` | Task navigation |
| `guided_first_run_intro` | First AI intro generated |

### Phase 3 Telemetry Additions

| Event | Trigger |
|---|---|
| `guided_answer_correct` | AI verdict: correct |
| `guided_answer_incorrect` | AI verdict: incorrect |
| `guided_score_degraded` | available_score decreased |
| `guided_all_completed` | All tasks finished |

---

## Phase Breakdown (Updated)

### Phase 3: AI Orchestration + Scoring

**Goal:** Server-side answer evaluation, automatic scoring, auto-advance on correct, hint/question score impact.

**Subtasks:**
1. DB migration: add `available_score`, `earned_score`, `wrong_answer_count`, `hint_count`, `await_mode`, `context_summary`, `last_ai_feedback` to `homework_tutor_task_states`.
2. Backend: `POST /threads/:id/check` endpoint. Calls AI with task context + student answer. Parses verdict. Updates scores. Auto-advances on correct.
3. Backend: `POST /threads/:id/hint` endpoint. Calls AI for hint. Increments `hint_count`. Degrades `available_score`.
4. Backend: AI prompt templates for answer evaluation, hint generation, question answering.
5. Frontend: Replace manual "Zadacha vypolnena" with automatic advance on correct verdict.
6. Frontend: Display `available_score` in task panel. Show degradation animation.
7. Frontend: Handle CORRECT/INCORRECT verdict responses in UI (success animation vs "try again").
8. Backend: Initialize `available_score = max_score` in thread provisioning.
9. Separate `/functions/v1/guided-chat` endpoint (or extend `homework-api` to handle streaming) so guided homework doesn't share general chat limits.

**Acceptance:**
- Wrong answer decreases available_score by 10%, displayed immediately.
- Hint request decreases available_score by 10%.
- Score never goes below 50% of max.
- Correct answer sets earned_score = available_score and auto-advances.
- Student cannot manually advance (no button).
- AI evaluation is server-authoritative, not client-parseable.

### Phase 4: Tutor Participation

**Goal:** Tutor can write into student thread. Tutor messages serve as AI instructional context.

**Subtasks:**
1. DB migration: add `author_user_id`, `visible_to_student` to messages. Add `last_student_message_at`, `last_tutor_message_at` to threads.
2. Backend: `POST /assignments/:id/students/:studentId/thread/messages` (tutor endpoint). Saves message, does NOT trigger AI response.
3. Frontend: Tutor thread viewer gets input field. Tutor can write messages scoped to current/any task.
4. Frontend: Student sees tutor messages in chat with "Tutor" badge.
5. Backend: AI prompt includes tutor messages as `instructional_context` when generating next student response.
6. Backend: Hidden notes support (`visible_to_student = false`).
7. Backend: Tutor can reset task (set status back to `active`, clear `earned_score`).

**Acceptance:**
- Tutor message appears in student thread.
- AI does NOT respond to tutor message.
- AI includes tutor message in context for next student AI-run.
- Hidden notes affect AI but are invisible to student.

### Phase 5: Compatibility and Rollout

**Goal:** Guided mode coexists with legacy. Reporting works for both.

**Subtasks:**
1. Derived sync: when guided task is completed, write matching `homework_tutor_submission_items` row.
2. Tutor results pages: show guided scores alongside legacy submission scores.
3. Quota separation: guided homework uses separate daily limit (or no limit, per PRD).
4. Migration guard: `workflow_mode` default is `classic`, existing assignments unaffected.
5. Reporting: total score per student = sum of earned_scores across tasks.
6. Export: allow tutor to export thread transcript as PDF.

**Acceptance:**
- Legacy assignments keep current attempt/submit/AI-check behavior.
- Tutor cabinet shows guided results in same table as legacy.
- Guided homework does not consume /chat limits.
- Existing data is not affected by new schema.

### Phase 6: Task Bank + Folders (separate initiative)

**Goal:** Reusable task catalog with hierarchical organization.

**Subtasks:**
1. Task bank table: `homework_tutor_bank_tasks` with folder structure.
2. Folder/subfolder UI in tutor cabinet.
3. "Add to homework" flow from bank to assignment wizard.
4. Import/export tasks.
5. Task templates and sharing between tutors.

---

## Test Plan

### Implemented (Phase 1+2+2.1)

- [x] Assignment with `guided_chat` creates thread and task_states for every assigned student.
- [x] Student without Telegram gets working thread on site.
- [x] Student sends text message, AI responds via streaming.
- [x] Task stepper shows correct statuses.
- [x] Advance button requires >= 1 AI reply (server + client guard).
- [x] Score clamped to 0-100 on server.
- [x] Assistant messages must follow user messages (server guard).
- [x] Task image displayed in workspace and included in AI context.
- [x] Message retry on save failure.
- [x] Hint/question mode changes message_kind.
- [x] Tutor can read student thread (read-only viewer).
- [x] Telemetry events fire for key interactions.
- [x] Existing `classic` assignments keep current behavior unchanged.
- [x] Lazy loading: workspace is separate chunk, does not bloat main bundle.
- [x] iOS Safari: 16px font on inputs, 100dvh, touch-action:manipulation, no forbidden APIs.

### Phase 3 Tests

- [ ] Student sends correct answer -> AI responds with CORRECT -> auto-advance.
- [ ] Student sends wrong answer -> AI responds with INCORRECT -> stays on task.
- [ ] Wrong answer decreases available_score by 10%.
- [ ] Hint request decreases available_score by 10%.
- [ ] Score never below 50% of max_score.
- [ ] Correct answer sets earned_score = available_score.
- [ ] All tasks correct -> thread completed with total score.
- [ ] AI evaluation is server-authoritative (client cannot override).
- [ ] Guided homework does NOT consume general /chat quota.

### Phase 4 Tests

- [ ] Tutor message appears in student thread with "Tutor" badge.
- [ ] AI does NOT respond to tutor message.
- [ ] AI includes tutor message in context for next student response.
- [ ] Hidden note NOT visible to student, but affects AI context.
- [ ] Tutor can reset task to active state.

### Phase 5 Tests

- [ ] Derived submission_items created on task completion.
- [ ] Tutor results page shows guided scores.
- [ ] Legacy assignments unaffected by new schema.

---

## Assumptions

1. Guided homework chat is website-first. Telegram remains notification channel only.
2. Realtime delivery uses Supabase Realtime where possible (not yet implemented; currently polling via React Query staleTime).
3. Phase 3 moves AI evaluation server-side (edge function), replacing client-side streaming for answer checking. Hints and questions may still use client-side streaming.
4. `message_kind` column migration is deployed before Phase 3 (currently optional/backward-compatible).
5. Scoring uses NUMERIC(8,2) for fractional scores (10% degradation steps).

---

## Open Questions

1. **Should hints have a cap?** PRD doesn't specify max hints per task. Suggestion: no cap, but score floor at 50% naturally limits incentive.
2. **Should question mode degrade score?** Current PRD: no. Questions are free. Only hints and wrong answers degrade.
3. **OCR for task images:** Phase 3 AI prompt mentions OCR. Should we pre-OCR task images at upload time, or send image URL to multimodal AI? Current AI (Gemini) supports multimodal. Decision: send image URL, no separate OCR step.
4. **Realtime updates:** Should tutor see student messages in real-time (Supabase Realtime), or is polling sufficient? Suggestion: Supabase Realtime channel per thread for Phase 4.
5. **Thread abandonment:** When is a thread marked `abandoned`? Suggestion: tutor manually closes, or auto-abandon after assignment deadline passes.
