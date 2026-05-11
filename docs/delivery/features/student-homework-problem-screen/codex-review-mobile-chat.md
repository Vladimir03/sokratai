Status: FAIL

Review of mobile student homework chat experience (commits bffd97c..8d37978).

Findings:

[blocker] Mobile discussion messages are not scoring-neutral: `HomeworkProblem` saves ordinary chat discussion as `message_kind='question'` through `saveThreadMessage` (`src/pages/student/HomeworkProblem.tsx:351`), but the backend increments `homework_tutor_task_states.attempts` for every user message regardless of `message_kind` (`supabase/functions/homework-api/index.ts:5839`). Later, `runStudentAnswerGrading` uses `attempts` to decide when ON_TRACK answers start counting as hints / score degradation (`supabase/functions/homework-api/index.ts:6478`). A student can therefore ask Сократ a few discussion questions and then lose available score on their first formal partial answer. This violates the Phase 1 contract: mobile chat is discussion-only; only numeric inline answer / SubmitSheet should affect grading state.

[major] Step progress and next-task navigation depend on `task_state.task_order`, but student thread responses do not include that field. `THREAD_SELECT` returns task states without `task_order` (`supabase/functions/homework-api/index.ts:5935`), while the mobile screen sorts states for `nextTaskId` by `s.task_order` (`src/pages/student/HomeworkProblem.tsx:654`) and paints completed circles from `s.task_order` (`src/pages/student/HomeworkProblem.tsx:892`). In the actual wire shape these values are `undefined`, so completed tasks are not reliably green and the "Следующая задача" target depends on incidental nested-row order.

[major] Final "Назад к ДЗ" on mobile can loop back into the problem screen after all tasks are completed. When `HomeworkProblem` has no `nextTaskId`, it navigates to `/homework/:hwId` (`src/pages/student/HomeworkProblem.tsx:873`), but `StudentHomeworkDetail` on mobile falls through to `tasks[0].id` when there is no current task and no unfinished task (`src/pages/StudentHomeworkDetail.tsx:65`, `src/pages/StudentHomeworkDetail.tsx:73`). A completed assignment therefore reopens task 1 instead of returning to the homework list/detail.

[major] `proof` tasks are no longer "photos only" end-to-end. `SubmitSheet` renders the merged "Решение (фото или текст)" textarea whenever `showPhotos` is true, including `task_kind='proof'` (`src/components/student/homework-problem/SubmitSheet.tsx:410`, `src/components/student/homework-problem/SubmitSheet.tsx:434`), and voice transcription appends into that same text state (`src/components/student/homework-problem/SubmitSheet.tsx:350`). The backend also includes `textTrim` in the synthesized proof answer (`supabase/functions/homework-api/index.ts:6906`). This contradicts the approved contract: proof = Section 1 photos only.

[major] `AuthGuard fullBleed` still renders the onboarding modal over the full-screen homework UI (`src/components/AuthGuard.tsx:85`). The route skips Navigation chrome, but a non-onboarded student can still get a blocking modal on top of the mobile chat problem screen. The review focus explicitly says onboarding / push opt-in surfaces must not block this full-bleed mobile UI.

[minor] AI bubble branding uses "Сократ AI" instead of the approved kicker "Сократ". The brand icon is correct (`sokrat-chat-icon.png`), but `GuidedChatMessage` sets `AI_DISPLAY_NAME = 'Сократ AI'` and renders that above assistant bubbles (`src/components/homework/GuidedChatMessage.tsx:18`, `src/components/homework/GuidedChatMessage.tsx:426`). Streaming typing dots use "Сократ", so the identity is inconsistent inside the same screen.

[minor] `student_hint_requested` is emitted but not registered in the typed telemetry taxonomy. The call exists and is PII-free (`src/pages/student/HomeworkProblem.tsx:513`), but `homeworkTelemetry.ts` still documents / types only the four original student problem events (`src/lib/homeworkTelemetry.ts:90`, `src/lib/homeworkTelemetry.ts:296`). Also, `student_submitsheet_opened.hadDraft` is hardcoded to `false` even when localStorage has a draft (`src/pages/student/HomeworkProblem.tsx:1159`).

Required fixes:

1. Make discussion saves scoring-neutral. Do not increment `attempts` for `message_kind='question'` / discussion chat; keep attempts for formal answer / check paths only.
2. Stop reading `task_order` from `HomeworkTaskState`. Either enrich the student thread response with a joined order, or compute order from `assignmentDetails.tasks` by `task_id` for done circles, next task, and fallback step resolution.
3. Fix completed-assignment mobile routing: when `thread.status==='completed'` or all tasks are completed, render a completed detail/list state or navigate to `/homework`, not back to `tasks[0]`.
4. Gate proof UI and backend synthesis to photos-only, or record an explicit owner decision that proof now allows text/voice.
5. Suppress onboarding / opt-in overlays for the full-bleed problem route, or add a non-blocking variant approved by product.
6. Rename the assistant kicker to "Сократ" consistently in `GuidedChatMessage`.
7. Add `student_hint_requested` to `homeworkTelemetry.ts` event union, payload type, overload/table, and compute real `hadDraft` for `student_submitsheet_opened`.

Resolved since previous review:

- Mobile chat is now functional: text streams through `/chat`, paperclip uploads, mic transcribes, and assistant replies persist.
- SubmitSheet no longer owns a verdict overlay; submission + check_result now land in the chat with optimistic bubbles.
- SubmitSheet voice now uses the real `threadId`, and transcript appends into the merged Section 1 textarea for extended tasks.
- Autosave persists synchronously on submit and clears only on CORRECT.
- Mobile redirect now waits for `useStudentThread` before applying the current/unfinished/first fallback.
- Auth route is now wrapped in `AuthGuard fullBleed`, so unauthenticated direct loads get the normal auth redirect.
- File input is mounted outside the numeric/extended conditional, so numeric discussion paperclip has a live ref.
- Photo-only discussion sends no longer call the old `buildGuidedAttachmentPlaceholder(number)` bug path.

Checks:

Mobile UX correctness: FAIL. Numeric vs extended/proof branching exists, hint is available in both branches, and file input placement is fixed. Remaining blockers are scoring side effects from discussion chat, `proof` text/voice drift, and unreliable step completion/next-task behavior.

Anti-leak: PASS. `handleGetStudentProblem` uses assignment/task whitelists and does not return `solution_*`, `rubric_*`, or `ai_score_comment`; `THREAD_SELECT` exposes only raw `submission_payload` and strips `ai_score_comment`; `/chat` guided context fetches tutor solution server-side.

Performance: PASS with caution. `GuidedChatMessage` is memoized, query keys are consistent, `useVisualViewportHeight` removes listeners on unmount, and html/body overflow is restored. The extra `useStudentAssignment(hwId)` round-trip exists only for step navigation; acceptable for Phase 1, but it should also become the source of truth for task order if finding #2 is fixed client-side.

Submission contract: FAIL. Extended `photo OR text` is implemented in UI and backend. Numeric inline correctly uses `checkAnswerApi`. Proof still accepts text/voice despite the photos-only contract.

Identity rendering: PARTIAL. Tutor messages receive name/avatar fallback props. AI bubbles use the brand icon, but the kicker copy is "Сократ AI" instead of "Сократ".

Routing: FAIL. Back arrow goes to `/homework`, and mobile redirect waits for thread load. Completed-assignment and empty-task cases are still weak: all-completed redirects back to task 1; `tasks.length === 0` leaves the mobile "Открываем задачу..." shell indefinitely.

Telemetry: PARTIAL. Payloads I found are PII-free. `student_problem_screen_opened` has a fire-once sentinel. Hint telemetry fires before optimistic bubble insertion. The hint event is missing from the typed registry, and `hadDraft` is not real.

Validation: `npm run build` failed inside the sandbox with Vite/esbuild access denied, then passed after escalated rerun. `npx eslint <touched files>` passed with 0 errors. `git diff --check origin/main^^^^^^^^` exited 0 with non-blocking git ignore permission warnings. Extra: `npm run typecheck` passed.

Risk awareness: No privacy leak found. The release risks are product-visible: casual AI discussion can silently reduce available score, completed task status can render incorrectly, and the final mobile route can trap students back in a solved problem.
