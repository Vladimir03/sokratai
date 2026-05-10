Status: FAIL

Re-review of Phase 1.x scope expansion (commit df3c70c..984dd4c).

Findings:

[blocker] `SubmitSheet` can still lose the student's draft after a non-CORRECT verdict if the submit happens before the 5s autosave tick. Autosave is interval-only (`src/components/student/homework-problem/SubmitSheet.tsx:207`), submit does not synchronously persist the current `{numeric, photos, text}` (`src/components/student/homework-problem/SubmitSheet.tsx:286`), and `handleVerdictContinue` closes the sheet for ON_TRACK/INCORRECT without saving (`src/components/student/homework-problem/SubmitSheet.tsx:330`). On reopen, the restore effect resets to blank when localStorage has no draft (`src/components/student/homework-problem/SubmitSheet.tsx:194`). This violates Q12/S1-2: partial/error retries must preserve student-owned work.

[major] Chat context is not end-to-end for S1-1: the new mobile `streamChat` call omits both `taskContext` and `studentImageUrls` (`src/pages/student/HomeworkProblem.tsx:257`). It only sends plain `{role, content}` messages and task image refs (`src/pages/student/HomeworkProblem.tsx:244`, `src/pages/student/HomeworkProblem.tsx:249`), so for text-only tasks the AI does not receive the task condition, and for paperclip messages the uploaded student image is persisted to the thread but not passed to the AI. The legacy working path explicitly sends `taskContext` and resolved student image URLs (`src/components/homework/GuidedHomeworkWorkspace.tsx:929`, `src/components/homework/GuidedHomeworkWorkspace.tsx:934`). This makes Q6 paperclip misleading and weakens the core "Получить помощь когда застрял" path.

[major] SubmitSheet voice is wired to the wrong backend identifier. `handleVoiceClick` calls `transcribeThreadVoice(taskId, ...)` and the comment calls `taskId` a synthetic thread id (`src/components/student/homework-problem/SubmitSheet.tsx:380`, `src/components/student/homework-problem/SubmitSheet.tsx:393`). The API client posts to `/threads/:threadId/transcribe-voice`, and the backend verifies actual thread ownership before transcribing (`src/lib/studentHomeworkApi.ts:140`, `supabase/functions/homework-api/index.ts:5638`). A task UUID is not a thread UUID, so Section 4 voice transcription will return "Thread not found" for normal users. Q11 is not implemented end-to-end.

[major] Mobile auto-redirect can race before `useStudentThread` resolves, defeating the smart fallback chain. `StudentHomeworkDetail` starts the thread query on mobile (`src/pages/StudentHomeworkDetail.tsx:42`) but the redirect effect does not wait for its loading/fetched state (`src/pages/StudentHomeworkDetail.tsx:44`). If assignment data arrives first, `thread` is still undefined, `states` is empty, and the route falls through to `tasks[0]` (`src/pages/StudentHomeworkDetail.tsx:56`, `src/pages/StudentHomeworkDetail.tsx:65`). That is the exact "always task #1" failure Q1/v0.2 was meant to avoid.

[major] Optimistic chat cleanup is not race-safe and can erase an unsaved AI reply. If assistant message persistence fails, the code marks the temp assistant bubble as failed (`src/pages/student/HomeworkProblem.tsx:312`), but the unconditional `setTimeout(() => setOptimisticMessages([]), 800)` still removes it (`src/pages/student/HomeworkProblem.tsx:330`). Because `invalidateQueries` is not awaited (`src/pages/student/HomeworkProblem.tsx:325`), slow refetches can also produce a visible disappearance/reappearance gap. This violates the review focus requirement that the student not lose messages and that optimistic/persisted thread de-duplication be correct.

[major] Canonical docs still contradict the approved Q3/Q4 product decision. The spec's v0.2 summary says chat is discussion-only and never calls `handleCheckAnswer` (`docs/delivery/features/student-homework-problem-screen/spec.md:49`), but the same spec still says "Чат incremental (`handleCheckAnswer` ставит status='completed')" (`docs/delivery/features/student-homework-problem-screen/spec.md:103`), and `.claude/rules/40-homework-system.md` repeats "каждое user-сообщение -> handleCheckAnswer" (`.claude/rules/40-homework-system.md:1174`). Future agents will read the rule file as canonical and may reintroduce the wrong grading path.

[minor] `StepIndicator` navigation is still coupled to `homework_tutor_task_states` rather than the assignment task list. `handleStepClick` resolves the target only through `data.thread.homework_tutor_task_states.find(...)` and silently returns if the state row or `task_id` is missing (`src/pages/student/HomeworkProblem.tsx:413`). Q7 says URL is source of truth and click on `task[i]` should navigate to `tasks[i].id`; this is probably OK while provisioning creates all states, but it is brittle for lazy/legacy drift.

[minor] localStorage autosave catches quota errors but does not prune old `submitsheet-draft-*` keys. The write is wrapped (`src/components/student/homework-problem/SubmitSheet.tsx:221`), but quota exceeded is a silent no-op (`src/components/student/homework-problem/SubmitSheet.tsx:225`). A student opening many tasks can lose autosave for the current task with no visible signal.

Required fixes:

1. Persist the current SubmitSheet draft synchronously before submit and before closing any non-CORRECT/error verdict, then clear only on CORRECT. Keep the stored shape limited to `{numeric, photos, text, savedAt}`.
2. Make `HomeworkProblem` chat match the legacy working contract: pass task context, resolve and pass the latest student attachment refs as `studentImageUrls`, and keep chat as discussion-only (no `handleCheckAnswer` from this path).
3. Pass the real `threadId` into `SubmitSheet` and use it for `transcribeThreadVoice`, or add a task-scoped transcription endpoint with an explicit backend contract.
4. Gate mobile auto-redirect until `useStudentThread` has resolved on mobile, then apply `current_task_id -> first unfinished -> first task`.
5. Replace timeout-based optimistic cleanup with deterministic reconciliation: keep failed temp messages visible, await/refetch or remove only temp ids that have persisted equivalents, and avoid clearing newer optimistic messages.
6. Reconcile `spec.md` and `.claude/rules/40-homework-system.md` so Q3/Q4 are unambiguous: mobile chat is discussion-only; SubmitSheet is the only mobile path triggering grading; completed state flips the CTA.
7. Prefer resolving step navigation from an assignment tasks array, or make the API return enough task id/order data so state provisioning drift cannot make step clicks no-op.
8. Add bounded draft cleanup or at least a visible autosave failure state when localStorage quota is exceeded.

Resolved since previous review:

- The chat row is no longer a dead UI shell: text send calls `/chat`, mic uses `useVoiceRecorder`, and paperclip uploads/persists an attachment ref.
- `GuidedChatMessage` is reused for AI/user bubbles with `perspective="student"`, matching Q13.
- ProblemContext now renders `task_image_url` through a multi-photo gallery with a fullscreen Dialog.
- Step circles are clickable in the new screen, with free-order navigation semantics.
- Primary CTA correctly flips away from SubmitSheet when `task_state.status === 'completed'`.
- CHECK_FAILED now receives a retry handler in the verdict overlay path.
- Targeted lint on the six requested files is clean.

Checks:

Job alignment: S1-2 is close but draft preservation has a blocker on fast-submit partial/error paths. S1-1 text chat streams, but it lacks task text and does not send attached student images to AI. S1-3 verdict modes still render, and CHECK_FAILED retry is now wired.

Product invariants: SubmitSheet remains the explicit grading action, and I found no `handleCheckAnswer` call from `HomeworkProblem.tsx` chat. Hybrid completed CTA flip is implemented. The doc source of truth still says the opposite in one canonical section and must be corrected.

Anti-leak: The v0.2 frontend does not request `solution_*`, `rubric_*`, or `ai_score_comment`; `handleGetStudentProblem` still uses a student-safe task whitelist. `/chat` guided context fetches tutor solution server-side. localStorage draft content is student-owned only.

Performance: `GuidedChatMessage` is memoized. React Query key for the problem screen remains `['student','problem', hwId, taskId]`, and chat invalidates that key after send. The current optimistic cleanup is the main performance/UX race.

Routing: Back arrow goes to `/student/homework`. `useStudentThread('')` is disabled correctly via `enabled: Boolean(assignmentId)`. The auto-redirect thread-loading race is a release risk.

Validation run by Codex: `npm run build` initially failed inside the sandbox with Vite config access denied, then passed after escalation. `npx eslint src/pages/student/HomeworkProblem.tsx src/components/student/homework-problem/SubmitSheet.tsx src/components/student/homework-problem/ProblemContext.tsx src/components/student/homework-problem/StepIndicator.tsx src/components/student/homework-problem/TaskImagesGallery.tsx src/pages/StudentHomeworkDetail.tsx` passed with 0 errors. `git diff --check origin/main` exited 0; git printed non-blocking permission warnings for `C:\Users\kamch/.config/git/ignore`.

Risk awareness: No privacy leak found in this increment. The main prod risks are losing student draft work, sending students to the wrong task on mobile open, and giving AI chat insufficient context despite showing functional chat controls.
