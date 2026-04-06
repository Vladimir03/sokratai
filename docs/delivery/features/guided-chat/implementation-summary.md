# Guided Homework Chat: Implementation Summary (Phases 1 + 2 + 2.1 + 3)

Status: Phases 1 + 2 + 2.1 + 3 shipped. Reliability hardening for answer checking, OCR grounding, and fair scoring shipped on 2026-03-28.

---

## What Was Built

Guided Homework Chat replaces the batch submit-wait-check homework flow with a task-by-task interactive chat between Student and AI, where the tutor can observe. A student opens an assignment, sees the first task, and works through it in a chat. After interacting with AI, they advance to the next task. The tutor can review the full chat history per student.

---

## Phase 1: Schema, Thread Provisioning, UI Toggle

**Commit:** `5b084c8` (branch `claude/heuristic-germain`)
**Goal:** Database foundation, thread lifecycle, tutor creation toggle, student routing.

### Database (migration `20260306100000`)

| Table | Purpose |
|---|---|
| `homework_tutor_threads` | One per (student_assignment), tracks `status`, `current_task_order` |
| `homework_tutor_thread_messages` | Chat history: `role` (user/assistant/system), `content`, optional `image_url`, `task_order` |
| `homework_tutor_task_states` | Per-task progress: `status` (locked/active/completed/skipped), `attempts`, `best_score` |

RLS policies: students can SELECT their own threads/messages/states through `student_assignment` ownership chain.

### Thread Provisioning

When a tutor assigns a homework to students (single-mode guided chat, classic removed 2026-04-06):
1. `POST /assignments/:id/assign` creates `homework_tutor_student_assignments` rows.
2. For each student_assignment, a thread is upserted (idempotent via UNIQUE constraint).
3. Task states are upserted for every task: first task = `active`, rest = `locked`.

Result: student opens the assignment and the thread is already ready.

### Backend API

- **`GET /threads/:id`** -- returns thread with nested messages + task_states, verifies ownership.

### Frontend

- **`StudentHomeworkDetail.tsx`** -- renders guided-chat workspace (replaced in Phase 2).
- **`studentHomeworkApi.ts`** -- `getStudentThreadByAssignment()` queries via RLS.
- **`useStudentHomework.ts`** -- `useStudentThread(assignmentId)` hook, query key `['student','homework','thread', id]`, staleTime 30s.

### Types (`src/types/homework.ts`)

```
ThreadStatus = 'active' | 'completed' | 'abandoned'
TaskStateStatus = 'locked' | 'active' | 'completed' | 'skipped'
HomeworkThread, HomeworkThreadMessage, HomeworkTaskState
```

---

## Phase 2: Student Interactive Workspace

**Commit:** `15e6bc4` + `4820bed` (integrity fixes) (branch `claude/heuristic-germain`)
**Goal:** Working chat workspace: SSE streaming, message persistence, task advancement, task image display.

### New Components (5 files)

| File | Size | Purpose |
|---|---|---|
| `streamChat.ts` | 213 lines | SSE streaming utility, extracted from Chat.tsx. Retry with backoff, AbortController timeout (Safari-safe), error codes (LIMIT_REACHED, PAYMENT_REQUIRED, RATE_LIMIT). Posts to `/functions/v1/chat`. |
| `GuidedChatMessage.tsx` | 188 lines | Markdown + LaTeX renderer. Lazy-loaded ReactMarkdown. LaTeX preprocessing (`\[..\]` -> `$$..$$`). Role-based styling (user right/blue, assistant left/grey, system center/muted). |
| `GuidedChatInput.tsx` | 98 lines | Simple textarea. Auto-resize, Enter to send, Shift+Enter newline. iOS-safe: 16px font, touch-action:manipulation. |
| `TaskStepper.tsx` | 114 lines | Horizontal scrollable progress bar. Circle per task with status color. Auto-scroll to active. Connecting lines. |
| `GuidedHomeworkWorkspace.tsx` | 459 lines | Main orchestrator. Layout: header -> stepper -> task panel -> chat -> input. Manages messages, streaming, task advancement. Lazy-loaded in StudentHomeworkDetail. |

### Backend Endpoints (homework-api)

**`POST /threads/:id/messages`** (student)
- Saves user or assistant message.
- Validates: ownership, non-empty content.
- Integrity: assistant messages must follow a user message (prevents fake AI history).
- Side effect: increments `attempts` on active task_state for user messages.
- Returns saved message with 201.

**`POST /threads/:id/advance`** (student)
- Marks current task completed, unlocks next (or completes thread).
- Server guard: requires >= 1 assistant message for current task_order.
- Score clamping: client-provided score clamped to 0-100.
- Inserts system messages for transitions.
- Returns full updated thread.

### Frontend API

- `saveThreadMessage(threadId, role, content, taskOrder)` -- POST to edge function.
- `advanceTask(threadId, score?)` -- POST to edge function, returns updated thread.

### Message Flow

1. Student types message -> optimistic add to UI.
2. `saveThreadMessage()` persists user message (async, non-blocking).
3. `streamChat()` sends last 15 messages + task context to `/functions/v1/chat`.
4. AI response streamed delta-by-delta into UI.
5. On stream done, assistant message saved via `saveThreadMessage()`.
6. "Zadacha vypolnena" button appears after >= 1 AI reply -> calls `advanceTask()`.

### AI Context

```
Zadanie: "{title}" po predmetu {subject}.
Tema: {topic}.
Zadacha {N} iz {total}: {task_text}
Izobrazhenie usloviya: {task_image_url}  (if present)

Pomogi ucheniku razobrat'sya. Zadavaj navodyaschie voprosy.
Ne davaj gotovyj otvet srazu. Ob"yasnyaj po shagam, LaTeX.
```

### Chunk Size

`GuidedHomeworkWorkspace` is lazy-loaded: separate 17.24 kB chunk (gzipped ~5 kB).

---

## Phase 2.1: UX Polish and Tutor Read-Only View

**Commit:** `3164b5a` (branch `main`)
**Goal:** UI state machine, question/hint modes, message reliability, tutor thread viewer, telemetry.

### UI State Machine

```
GuidedHomeworkUiStatus:
  'awaiting_answer'    -- waiting for student input
  'streaming_ai'       -- AI is responding
  'ready_to_advance'   -- AI replied, student can advance
  'advancing'          -- calling advanceTask
  'send_error'         -- message save failed
```

Each state has a visible badge with label and color. Controls (hint/question/advance) disabled based on state.

### Three Input Modes

| Mode | Trigger | message_kind | Behavior |
|---|---|---|---|
| Answer (default) | Any message without mode switch | `answer` | AI checks correctness |
| Hint | "Podkladka" button | `hint_request` | AI gives short hint without solution |
| Question | "Zadat' vopros" button | `question` | AI answers question, auto-resets to answer mode |

### message_kind (Optional Backward-Compatible)

New optional field on `homework_tutor_thread_messages`:

```
GuidedMessageKind = 'answer' | 'hint_request' | 'question' | 'ai_reply' | 'system'
```

- Edge function tries insert WITH `message_kind` first; falls back to insert WITHOUT if column doesn't exist.
- Client queries also use try-with/try-without pattern.
- Old threads work without it. New threads populate it automatically.
- Displayed as tiny label above user messages ("Otvet", "Podskazka", "Vopros").

### Message Delivery Status

```
MessageDeliveryStatus = 'sending' | 'sent' | 'failed'
```

- Optimistic UI: message appears instantly as `sending`.
- On save success: `sent`.
- On save failure: `failed`, retry button shown on bubble.
- Retry re-sends to server and updates status.

### First-Run Auto-Bootstrap

When thread has zero messages, workspace auto-sends an AI intro for the first task. Tracked as `guided_first_run_intro` telemetry event.

### Task Panel Enhancements

- Task image display with signed URL + zoom modal on click.
- Assignment materials accessible from panel.
- Task stepper tooltips showing task text and status label.

### Navigation Controls

- "Predydushchaya" / "Sleduyushchaya" buttons for task navigation.
- Visited-task tracking: can revisit any previously seen task.
- Clicking completed/active task in stepper switches view.

### Tutor Read-Only Thread Viewer

**Component:** `GuidedThreadViewer` (inside `TutorHomeworkResults.tsx`).

- Collapsible panel: "Guided-tred uchenika (read-only)".
- Lazy-loaded via `enabled: opened` in React Query.
- Task filter buttons (all tasks or specific task).
- Messages shown with role badge, task reference, timestamp, full content.
- No input or mutation controls.

**API:** `GET /assignments/:id/students/:studentId/thread` (tutor endpoint).
- Returns thread + task metadata + student profile.
- Intentionally omits `message_kind` from SELECT for backward compatibility.
- Query key: `['tutor','homework','guided-thread', assignmentId, studentId]`.

### Telemetry

`src/lib/homeworkTelemetry.ts` -- pushes events to console + Google Analytics dataLayer/gtag.

Events tracked: `guided_send_click`, `guided_send_failed`, `guided_retry_click`, `guided_retry_success`, `guided_retry_failed`, `guided_hint`, `guided_question_mode`, `guided_advance_click`, `guided_advance_success`, `guided_advance_failed`, `guided_assistant_save_failed`, `guided_stream_failed`, `guided_prev`, `guided_next`, `guided_first_run_intro`.

---

## Phase 3: AI Checking, Hints, Scoring

**Goal:** Turn guided homework into a scored task-by-task workflow with answer checking, hint degradation, and auto-advance on correct final answers.

### Student Answer Check

`POST /threads/:id/check` now:
- saves the student's green-field answer with `message_kind = "answer"`
- evaluates the answer against `task_text`, `correct_answer`, `rubric_text`, task image, latest student images, and recent task-scoped conversation history
- returns one of four verdicts:

```
GuidedVerdict = 'CORRECT' | 'ON_TRACK' | 'INCORRECT' | 'CHECK_FAILED'
```

- `CORRECT` completes the current task and auto-advances the thread
- `ON_TRACK` keeps the task open without marking the final answer as complete
- `INCORRECT` increments `wrong_answer_count` and degrades available score
- `CHECK_FAILED` means evaluation was not reliable; no score or attempt penalty is applied

### Hints and Score Degradation

- `POST /threads/:id/hint` generates a short guided hint and increments `hint_count`
- Available score is recomputed with:

```
computeAvailableScore(maxScore, wrongCount, hintCount)
= maxScore * max(0.5, 1 - 0.1 * (wrongCount + hintCount))
```

- Floor is 50% of task score
- `ON_TRACK` answers are free for the first two occurrences; starting from the third, they degrade score like a hint

### Reliability Hardening (2026-03-28)

The guided-homework AI paths were hardened to fix real student-facing failures on graph tasks:

- **Fair failure state:** `CHECK_FAILED` was introduced so AI / gateway / JSON failures no longer look like student mistakes
- **Deterministic short-answer fast-path:** short numeric or factual answers can now be accepted before the AI call:
  - `2,5` and `2.5`
  - `2.5 м/с`
  - `v = 2,5 м/с`
- **Concrete unit alias normalization:** common physics units are normalized through explicit alias mapping (`m/s`, `km/h`, `kg`, `N`, `Pa`, etc.) instead of fragile character-by-character replacement
- **Unified context across Answer / Hint / Discussion:** backend `check` and `hint` paths now select `message_kind`, drop system transition messages from `conversationHistory`, and use OCR-backed task facts
- **Graph anti-hallucination guidance:** prompts now explicitly tell AI not to invent coordinates, axis values, scale labels, or intermediate numbers if they cannot be read confidently from text, OCR, or image
- **Backend OCR reuse:** when `homework_tutor_tasks.ocr_text` is missing, the backend recognizes the task image once, persists OCR, and reuses it in future checks/hints
- **Attempts fairness:** `attempts` are incremented only for real learning verdicts (`CORRECT`, `ON_TRACK`, `INCORRECT`), not for `CHECK_FAILED`

### New / Updated Files for Phase 3

| File | Purpose |
|---|---|
| `supabase/functions/homework-api/guided_ai.ts` | answer evaluation, hint generation, deterministic short-answer fast-path, graph grounding |
| `supabase/functions/homework-api/index.ts` | `/check` and `/hint` runtime wiring, OCR ensure helper, fair scoring / attempts updates |
| `supabase/functions/homework-api/vision_checker.ts` | raw-response preview on JSON parse failures for observability |
| `src/components/homework/GuidedHomeworkWorkspace.tsx` | frontend handling for `CHECK_FAILED`, OCR-aware discussion/bootstrap context |
| `src/types/homework.ts` | `CheckAnswerResponse.verdict` extended with `CHECK_FAILED` |
| `src/lib/homeworkTelemetry.ts` | `guided_answer_check_failed` telemetry event |

---

## What's NOT Implemented Yet

| PRD Feature | Status | Target Phase |
|---|---|---|
| `await_mode` state machine (answer/question) on server | Client-only (message_kind) | Phase 3 |
| Tutor writes messages into student thread | Not implemented | Phase 4 |
| Tutor messages as AI instructional context | Not implemented | Phase 4 |
| Guided-mode reporting in tutor cabinet | Partial (read-only viewer) | Phase 5 |
| Migration guard for old assignments | Done (classic removed 2026-04-06) | Phase 5 |
| Separate chat quota (no general /chat usage) | Not implemented (uses shared endpoint) | Phase 5 |
| Task bank and folders | Not started | Phase 6 |

---

## File Inventory

### New Files Created

| File | Phase | Lines |
|---|---|---|
| `src/lib/streamChat.ts` | 2 | 213 |
| `src/components/homework/GuidedChatMessage.tsx` | 2 + 2.1 | ~230 |
| `src/components/homework/GuidedChatInput.tsx` | 2 | 98 |
| `src/components/homework/TaskStepper.tsx` | 2 + 2.1 | ~140 |
| `src/components/homework/GuidedHomeworkWorkspace.tsx` | 2 + 2.1 | ~650 |
| `src/lib/homeworkTelemetry.ts` | 2.1 | ~60 |

### Modified Files

| File | Phase | Changes |
|---|---|---|
| `supabase/functions/homework-api/index.ts` | 1 + 2 + 2.1 | Thread provisioning, GET/POST endpoints, advance, tutor thread viewer |
| `src/lib/studentHomeworkApi.ts` | 1 + 2 + 2.1 | getStudentThreadByAssignment, saveThreadMessage (+ message_kind), advanceTask |
| `src/hooks/useStudentHomework.ts` | 1 | useStudentThread hook |
| `src/pages/StudentHomeworkDetail.tsx` | 1 + 2 | guided_chat routing, lazy-loaded workspace |
| `src/types/homework.ts` | 1 + 2.1 | Thread/message/state types, message_kind, delivery status, UI status |
| `src/lib/tutorHomeworkApi.ts` | 2.1 | getTutorStudentGuidedThread |
| `src/pages/tutor/TutorHomeworkResults.tsx` | 2.1 | GuidedThreadViewer component |
| `src/pages/tutor/TutorHomeworkCreate.tsx` | 1 | guided-chat assignment create flow |

### Database Migration

| Migration | Phase |
|---|---|
| `20260306100000` | 1 -- tables + RLS + indexes |
| `message_kind` column | 2.1 -- optional, backward-compatible, may not yet be deployed |

---

## Architecture Decisions

1. **Separate tables** (not reusing `chats/chat_messages`): homework threads are per-assignment, multi-party, task-scoped. General chat is single-user, topic-free.

2. **Hybrid AI orchestration**: client drives the conversation (saves messages, streams from `/functions/v1/chat`), edge function handles persistence and state. This avoids duplicating SSE streaming code in homework-api.

3. **Shared chat endpoint**: guided homework currently uses the same `/functions/v1/chat` as general chat. This means it consumes the same daily limits. Decoupling is planned for Phase 5.

4. **message_kind backward compatibility**: optional field with try-with/try-without insert pattern. Allows deployment without requiring immediate migration.

5. **Manual advance (Phase 2)**: student clicks "Zadacha vypolnena" after AI interaction. Server-side AI evaluation (auto-correct/auto-advance) is Phase 3.
