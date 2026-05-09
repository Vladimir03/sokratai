# Tasks — Student Homework Problem Screen

Реализационные задачи для `spec.md` (`docs/delivery/features/student-homework-problem-screen/spec.md`).

Каждая задача:
- привязана к **AC** из спеки
- закреплена за конкретным агентом (Claude Code или Codex)
- содержит ссылки на канонические доки
- имеет полный промпт для запуска агента в финальной секции «Copy-paste промпты для агентов»

Code review для **каждой** задачи проводит **Codex** независимо (без контекста автора), см. финальный промпт ревьюера.

---

## Phase 1 — DB foundation (~1 час)

### TASK-1 — Миграция `task_kind` enum в `homework_tutor_tasks`

- **Job:** S1-2 (сдать решение и получить балл) — task_kind управляет shape SubmitSheet'а.
- **AC:** AC-1.
- **Agent:** Claude Code.
- **Files:**
  - `supabase/migrations/20260509120000_add_task_kind_to_homework_tasks.sql` (новый)
- **Что делаем:** добавляем nullable колонку `task_kind text CHECK (task_kind IN ('numeric', 'extended', 'proof'))`. Backfill: `short_answer→numeric, detailed_solution→extended`. После backfill — `NOT NULL` + `DEFAULT 'extended'`. Идемпотентно (`IF NOT EXISTS`).
- **Guardrails:** additive only, нет DROP/RENAME. Backfill идемпотентен (`WHERE task_kind IS NULL`). Existing tutor конструктор ДЗ продолжает работать без изменений (новые задачи получают default `'extended'`). Migration номер `20260509120000` — следующий после `20260508130000_fix_mock_exams_rls_recursion.sql`.
- **Validation:** dry-run на staging. После apply: `SELECT task_kind, count(*) FROM homework_tutor_tasks GROUP BY task_kind` — все строки classified.

### TASK-2 — Миграция `feature_new_homework_chat` flag в `profiles`

- **Job:** S1 (вся фича — за flag'ом)
- **AC:** AC-1.
- **Agent:** Claude Code.
- **Files:**
  - `supabase/migrations/20260509120100_add_feature_new_homework_chat_flag.sql` (новый)
- **Что делаем:** `ALTER TABLE profiles ADD COLUMN feature_new_homework_chat boolean NOT NULL DEFAULT false;` + COMMENT с описанием pilot purpose.
- **Guardrails:** additive, default `false` — никто не меняет поведение существующих учеников. Никаких RLS-изменений (existing self-read policy уже покрывает новое поле).
- **Validation:** apply migration → `SELECT count(*) FROM profiles WHERE feature_new_homework_chat IS NULL` = 0.

### TASK-3 — Миграция `submission_payload` JSONB + extend `message_kind` enum

- **Job:** S1-2.
- **AC:** AC-1, AC-5 (формат submission'а).
- **Agent:** Claude Code.
- **Files:**
  - `supabase/migrations/20260509120200_add_submission_payload_to_thread_messages.sql` (новый)
- **Что делаем:**
  ```sql
  ALTER TABLE homework_tutor_thread_messages
    ADD COLUMN IF NOT EXISTS submission_payload JSONB NULL;
  COMMENT ON COLUMN homework_tutor_thread_messages.submission_payload IS
    'For message_kind=submission: structured JSON {numeric: string, photos: string[], text: string, voice_ref?: string|null}.';
  ALTER TABLE homework_tutor_thread_messages
    DROP CONSTRAINT IF EXISTS homework_tutor_thread_messages_message_kind_check;
  ALTER TABLE homework_tutor_thread_messages
    ADD CONSTRAINT homework_tutor_thread_messages_message_kind_check
      CHECK (message_kind IS NULL OR message_kind IN (
        'answer','hint_request','question','bootstrap','ai_reply','system','check_result','hint_reply','tutor_message','tutor_note','submission'
      ));
  ```
- **Guardrails:** existing constraint values сохраняются (расширение списка). `submission_payload` nullable — старые сообщения не ломаются. RLS (existing) применяется автоматически.
- **Validation:** insert mock-submission через psql:
  ```sql
  INSERT INTO homework_tutor_thread_messages (thread_id, role, content, message_kind, submission_payload)
  VALUES ('<test_thread>', 'user', 'test', 'submission', '{"numeric":"1.4","photos":[],"text":""}'::jsonb);
  ```
  Не должно падать на CHECK constraint.

---

## Phase 2 — Backend (~2.5 часа)

### TASK-4 — Backend `GET /student/problem/:hwId/:taskId`

- **Job:** S1-1 (получить помощь когда застрял).
- **AC:** AC-3, AC-4 (ProblemContext data shape).
- **Agent:** Claude Code.
- **Files:**
  - `supabase/functions/homework-api/index.ts` — новый handler `handleGetStudentProblem`, новый route в `homeworkApiHandler`
- **Что делаем:**
  1. Реализовать `async function handleGetStudentProblem(db, userId, hwId, taskId, cors)`.
  2. Validate UUID hwId + taskId.
  3. Verify ownership: `SELECT id FROM homework_tutor_student_assignments WHERE assignment_id=hwId AND student_id=userId` — 404 если нет.
  4. Load assignment (`id, title, subject, deadline, status` через `homework_tutor_assignments`).
  5. Load tasks list — `SELECT id, order_num, task_text, task_image_url, max_score, check_format, task_kind FROM homework_tutor_tasks WHERE assignment_id=hwId ORDER BY order_num`. Тут же находим целевую task.
  6. Load thread (через existing `THREAD_SELECT` from CLAUDE.md rule 8a + dual-host validator).
  7. Compute `task_score` через existing `computeFinalScore(task_state, max_score)` для целевой задачи.
  8. Compute `hints_used` = `task_state.hint_count ?? 0` для целевой задачи.
  9. Resolve `student.display_name` через existing `resolveStudentDisplayName(db, sa.id)`.
  10. Return shape per spec §5 API.
  11. Routing: `if (method === 'GET' && pathSegments[1] === 'student' && pathSegments[2] === 'problem')` — match `:hwId/:taskId` из pathSegments.
- **Guardrails:**
  - Anti-leak: НЕ селектить `solution_text`, `solution_image_urls`, `rubric_text`, `rubric_image_urls`, `ai_score_comment` (per CLAUDE.md rule 9 student leak protection)
  - Reuse существующих helper'ов (computeFinalScore line 673, resolveStudentDisplayName line 4808 после full_name fix)
  - Dual-host validator для signed URLs не нужен (этот endpoint не возвращает signed URLs — только storage:// refs, фронт резолвит сам)
  - RLS: namespace student-only, ownership через homework_tutor_student_assignments (тот же паттерн что existing handleGetStudentAssignment)
- **Validation:** `npm run lint && npm run build && npm run smoke-check`. Manual: curl с student JWT → 200 + правильный shape; curl с другим student → 403; curl на несуществующий taskId → 404.

### TASK-5 — Backend `POST /student/problem/:hwId/:taskId/submission`

- **Job:** S1-2.
- **AC:** AC-5 (validation), AC-6 (verdict mapping), AC-7 (after CORRECT behaviour), AC-8 (telemetry hook server-side optional).
- **Agent:** Claude Code.
- **Files:**
  - `supabase/functions/homework-api/index.ts` — новый handler `handleStudentSubmission`, новый route
- **Что делаем:**
  1. Validate body shape: `{ numeric: string, photos: string[], text: string }`. Reject 400 если не соответствует.
  2. Validate task_kind requirements:
     - `task.task_kind === 'numeric'`: `numeric.trim().length > 0` обязательно, photos[] ignored (можно [])
     - `task.task_kind === 'extended'`: `numeric.trim().length > 0` И `photos.length >= 1` обязательно
     - `task.task_kind === 'proof'`: `photos.length >= 1` обязательно, numeric ignored (можно "")
     - Возврат 400 `VALIDATION` с конкретным missing field
  3. Validate photo refs (existing `extractStudentThreadAttachmentRefs` pattern — каждый ref = `storage://homework-submissions/{userId}/...`)
  4. Synthesize `answerText`:
     ```ts
     const lines = [];
     if (task.task_kind !== 'proof' && numeric.trim()) lines.push(`Числовой ответ: ${numeric.trim()}`);
     if (text.trim()) lines.push(text.trim());
     const answerText = lines.join('\n') || '(см. фото решения)';
     ```
  5. Insert submission message: `homework_tutor_thread_messages` с `role='user'`, `message_kind='submission'`, `content=answerText`, `image_url=serializeAttachmentRefs(photos)`, `submission_payload={numeric, photos, text}`, `task_id=taskId`, `task_order=task.order_num`.
  6. **Reuse existing `handleCheckAnswer` flow** для AI grading: invoke evaluateStudentAnswer с params {studentAnswer: answerText, taskText, taskImageUrls (resolved), studentImageUrls (resolved photos), checkFormat, ...}. Получить result `{verdict, ai_score, ai_score_comment, feedback}`.
  7. Записать AI result в `homework_tutor_task_states` (через existing logic в handleCheckAnswer): `ai_score`, `earned_score = computeEarnedFromAvailableScore(...)`, `status='completed'` if CORRECT, `hint_count` без изменений.
  8. Insert AI reply message с `role='assistant'`, `message_kind='check_result'`, content=feedback.
  9. Compute `task_completed`, `next_task_order`, `thread_completed` (existing logic).
  10. Return CheckAnswerResponse shape (existing).
- **Guardrails:**
  - Validation order: ownership → body shape → task_kind → photo refs → AI grading
  - Same anti-leak invariants (не селектим solution_*/rubric_*)
  - `evaluateStudentAnswer` retry semantics — те же что в handleCheckAnswer (1 retry on AI fail, fallback feedback)
  - `submission_payload` JSONB serialize строго `{numeric, photos, text}` — без user_input объектов (избегаем XSS injection через text → photo render)
  - photo refs валидируются по дозволенным prefix'ам (existing `isAllowedSignedStorageUrl` после Patch B+2 — оба host'а)
- **Validation:** `npm run smoke-check`. Manual: создать test ДЗ → student opens new screen → submit valid numeric+photo → response shape correct + status='completed' если AI grades CORRECT; submit invalid (no photo для extended) → 400.

---

## Phase 3 — Frontend foundation (~1.5 часа)

### TASK-6 — Frontend hooks + types + API client

- **Job:** S1-1, S1-2.
- **AC:** AC-3, AC-4 (data shape used by UI).
- **Agent:** Claude Code.
- **Files:**
  - `src/lib/studentProblemApi.ts` (новый) — `getStudentProblem(hwId, taskId)`, `submitSolution(hwId, taskId, payload)` через existing `requestStudentHomeworkApi` pattern
  - `src/hooks/useStudentProblemTask.ts` (новый) — React Query `useQuery({queryKey: ['student','problem', hwId, taskId], queryFn: () => getStudentProblem(...)})`
  - `src/hooks/useSubmitSolution.ts` (новый) — `useMutation` с invalidate `['student','problem', hwId, taskId]` + `['student','homework', hwId]` (для парент-страницы списка задач)
  - `src/types/homework.ts` — добавить `task_kind?: 'numeric' | 'extended' | 'proof'` в `StudentHomeworkTask`. Default `'extended'` если undefined (defensive — на случай старых записей)
- **Что делаем:**
  - API client функции через existing `requestStudentHomeworkApi` (уже работает с auth headers)
  - React Query keys строго `['student', 'problem', hwId, taskId]` — НЕ путать с `['student','homework', hwId]` (это парент)
  - Mutation: на success — invalidate child + parent keys + toast «Ответ отправлен» (если verdict !== CORRECT) или ничего (CORRECT — сам verdict overlay)
- **Guardrails:**
  - Не дублировать React Query keys (см. `.claude/rules/performance.md` §2c)
  - Все типы additive — `StudentHomeworkTask.task_kind` optional для backward compat
- **Validation:** `npm run build` зелёный, types correct. Manual через DevTools React Query DevTools (если установлен).

### TASK-7 — Frontend SubmitSheet (real component) + PhotoStrip + VerdictOverlay

- **Job:** S1-2, S1-3 (понять где ошибся через verdict overlay).
- **AC:** AC-5, AC-6.
- **Agent:** Claude Code.
- **Files:**
  - `src/components/student/homework-problem/SubmitSheet.tsx` (новый — заменяет SubmitSheetStub.tsx)
  - `src/components/student/homework-problem/PhotoStrip.tsx` (новый)
  - `src/components/student/homework-problem/VerdictOverlay.tsx` (новый)
  - `src/components/student/homework-problem/SubmitSheetStub.tsx` — DELETE (заменён)
- **Что делаем:**

  **SubmitSheet:**
  - Reuse design из stub: scrim + slide-up + grab handle + header + body + footer
  - Body: numeric input + PhotoStrip + optional textarea (text reasoning)
  - Numeric input: `<input type="number" inputMode="decimal" lang="ru" />` с `font-size: 16px` (iOS no auto-zoom). Принимает запятую И точку — нормализация `value.replace(',', '.')` перед submit
  - Conditional rendering по `task.task_kind`:
    - `numeric`: только numeric (photos hidden)
    - `extended`: numeric + photos (default)
    - `proof`: только photos (numeric hidden)
  - Textarea optional всегда
  - Submit button disabled пока validation не пройдена
  - On submit → `useSubmitSolution.mutate({numeric, photos, text})` → loading state «Распознаём и проверяем…» (5-15s) → on success render `<VerdictOverlay verdict={...} aiScore={...} maxScore={...} feedback={...} onContinue={...} onNext={...} />`

  **PhotoStrip:**
  - Horizontal scroll row тайлов 96×124 (per design CSS `.subm-photo`)
  - Каждый тайл: thumbnail (object-fit cover) + бейдж page-номера + ✕ delete
  - Add-tile: dashed border, иконка камеры + текст «Сфотографировать» или «Ещё страница»
  - Click add-tile → triggers `<input type="file" accept="image/*" capture="environment" multiple>` (existing pattern из ChatInput.tsx)
  - Загрузка через existing `uploadStudentThreadImage` (от `src/lib/studentHomeworkApi.ts`) → `storage://...` ref в state
  - Loading state per тайл: spinner overlay
  - Cap = 5 photos (existing `MAX_TASK_IMAGES` из `src/lib/attachmentRefs`)

  **VerdictOverlay:**
  - 3 состояния:
    - `correct`: bg `bg-emerald-100`, иконка CheckCircle2 48×48, title «Правильно! N/M баллов», CTA «Следующая задача →» (primary) + «Остаться на задаче» (ghost)
    - `partial` (verdict=ON_TRACK или INCORRECT с ai_score>0): bg `bg-amber-100`, AlertTriangle 48×48, title «Почти — продолжай решать», feedback text, CTA «Закрыть» → закрывает overlay → возвращает в чат с новым AI message (через invalidate query)
    - `incorrect` (verdict=INCORRECT с ai_score=0): bg `bg-red-100`, CircleHelp 48×48, title «Нужно поработать ещё», feedback, CTA «Закрыть» аналогично
  - Render внутри SubmitSheet z-stack (single focus context)
  - `role="status" aria-live="polite"` для loading, `aria-live="assertive"` для verdict
- **Guardrails:**
  - shadcn Sheet (для focus trap) — уже использовали в SubmitSheetStub
  - PhotoStrip touch-pan-x для iOS swipe (см. `.claude/rules/80-cross-browser.md`)
  - 16px text-size на input/textarea (iOS no auto-zoom)
  - `loading="lazy"` на photo thumbnails
  - Не использовать framer-motion (запрещён, см. performance.md)
  - VerdictOverlay не fixed модал (single context); рендерится conditionally в SubmitSheet body
- **Validation:** `npm run lint && npm run build`. Manual on staging: open SubmitSheet → upload 2 фото → submit → loading → verdict. Test 3 verdict variants через staging task data.

---

## Phase 4 — Wiring + feature flag (~1.5 часа)

### TASK-8 — Hookup `HomeworkProblem.tsx` — replace mock на real data

- **Job:** S1-1, S1-2.
- **AC:** AC-4, AC-7.
- **Agent:** Claude Code.
- **Files:**
  - `src/pages/student/HomeworkProblem.tsx` — replace mock imports на `useStudentProblemTask`
  - `src/pages/student/HomeworkProblem.fixtures.ts` — DELETE (mock больше не нужны)
- **Что делаем:**
  1. Import `useStudentProblemTask` instead of mock fixtures
  2. `const { data, isLoading, error } = useStudentProblemTask(hwId, taskId)`
  3. Loading state — full-screen spinner (или existing PageLoader)
  4. Error state — centered card «Не удалось загрузить задачу» с retry button
  5. Replace mock `mockTask` references на `data.task`, `mockChatThread` на `data.thread.homework_tutor_thread_messages`
  6. Compute `taskScore` from `data.task_score`
  7. ProblemContext default-collapsed логика: `useState(messages.length > 0)` — expanded если thread пустой, collapsed если есть messages
  8. After CORRECT (`task_state.status === 'completed'`): primary CTA меняется с «Сдать решение задачи» на «Следующая задача →» (next task в списке) или «Назад к ДЗ» (если последняя)
  9. SubmitSheet onSubmit hook:
     - Use `useSubmitSolution` mutation
     - On verdict overlay close → если verdict==CORRECT → navigate(`/student/homework/${hwId}/problem/${nextTaskId}`) или `/homework/${hwId}` если последняя
  10. Telemetry (via `homeworkTelemetry.ts` extension):
      - On mount → `student_problem_screen_opened`
      - On SubmitSheet open → `student_submitsheet_opened`
      - On submit → `student_submission_sent`
      - On verdict → `student_submission_verdict`
- **Guardrails:**
  - Не запускать сразу в `auth.uid` контекст — `useStudentProblemTask` сам проверит auth через existing `requestStudentHomeworkApi`
  - Все telemetry events PII-free (только id + counts + verdict literal)
  - Mock fixtures файл удалить — больше не testbench (по `.claude/rules/40-homework-system.md` правилу о canonical sources)
- **Validation:** `npm run lint && npm run build`. Manual: открыть на staging → задача загружается → SubmitSheet работает → verdict реальный.

### TASK-9 — Feature flag wrapper в `StudentHomeworkDetail`

- **Job:** safety rollout.
- **AC:** AC-2.
- **Agent:** Claude Code.
- **Files:**
  - `src/pages/StudentHomeworkDetail.tsx` — modify task-click handler
  - `src/hooks/useFeatureFlag.ts` (новый, mini-hook) — `useFeatureNewHomeworkChat()` reads `profile.feature_new_homework_chat` через existing useStudentProfile hook (или новый `useProfileSelf` если нет)
  - `src/hooks/useViewportSize.ts` (новый, mini-hook) — `useIsMobile()` returns `window.innerWidth <= 768`, listens resize events
- **Что делаем:**
  1. В `StudentHomeworkDetail` — где сейчас клик на задачу открывает inline GuidedHomeworkWorkspace, добавить wrapper:
     ```tsx
     const isMobile = useIsMobile();
     const enabled = useFeatureNewHomeworkChat();
     const onTaskClick = (taskId: string) => {
       if (isMobile && enabled) {
         navigate(`/student/homework/${hwId}/problem/${taskId}`);
       } else {
         // existing inline behavior
         setSelectedTaskOrder(taskOrder);
       }
     };
     ```
  2. `useFeatureNewHomeworkChat`: `const profile = useUserProfile()` → return `profile?.feature_new_homework_chat === true`
  3. `useIsMobile`: useEffect → `window.matchMedia('(max-width: 768px)')` listener, return boolean
- **Guardrails:**
  - Default fallback (`false` flag OR desktop) → ничего не меняется visually
  - Resize re-evaluates: ученик повернул iPad в landscape → может уйти на desktop; портрет → mobile. Acceptable.
  - Не блокировать render первоначальный — useState initial `null` → render как `false` пока profile load → потом перевычислить
- **Validation:** `npm run smoke-check`. Manual: enable flag для test user → mobile DevTools → клик на задачу → новый screen; desktop → старый inline behavior.

### TASK-10 — Documentation: CLAUDE.md + rules

- **Job:** project hygiene (single source of truth).
- **AC:** N/A (мета-задача, но требуется per `.claude/rules/00-read-first.md`).
- **Agent:** Claude Code.
- **Files:**
  - `.claude/rules/40-homework-system.md` — добавить секцию «Student Homework Problem Screen — feature flag + submission contract» с invariants
  - `CLAUDE.md` — pointer на новую секцию rule 40
  - `docs/delivery/features/student-homework-problem-screen/spec.md` — статус `draft` → `implemented` (после TASK-11 review pass)
- **Что делаем:**

  Новая секция в `.claude/rules/40-homework-system.md` (после существующей «Hint quality» или в конец):

  ```markdown
  ### Student Homework Problem Screen — feature flag + submission contract (2026-05-09)

  Новая mobile-first поверхность student-side ДЗ за feature-flag'ом `profiles.feature_new_homework_chat boolean default false`. Phase 1 = mobile only (≤768px viewport); desktop fallback на existing GuidedHomeworkWorkspace до Phase 3.

  **Routing invariants:**
  - Route `/student/homework/:hwId/problem/:taskId` (новый screen)
  - Route `/homework/:id` (старый GuidedHomeworkWorkspace) — остаётся для desktop И не-flagged students
  - `StudentHomeworkDetail` task-click handler делает feature-flag check + viewport check; редиректит ТОЛЬКО при обоих true

  **Submission storage invariants:**
  - SubmitSheet submissions пишутся в существующую таблицу `homework_tutor_thread_messages` с `message_kind='submission'`
  - `submission_payload JSONB` shape: `{numeric: string, photos: string[], text: string, voice_ref?: string|null}`
  - Поле `image_url` ТОЖЕ заполняется (serialized photos refs) — для совместимости с existing chat display и tutor `GuidedThreadViewer`
  - НЕ создавать отдельную таблицу `homework_tutor_submissions` (была удалена в migration `20260406120000_drop_classic_homework.sql`, не возрождаем)

  **Grading invariants:**
  - Phase 1: SubmitSheet submission → backend синтезирует `answerText` (Числовой ответ: X\n${text}) → reuse `handleCheckAnswer` для AI grading. **Без отдельного grading pipeline.**
  - Hybrid: чат incremental + SubmitSheet single-shot. **First-completed wins** — какой первым выставил `task_state.status='completed'`, тот и фиксирует score
  - После `status='completed'`: SubmitSheet primary CTA меняется на «Следующая задача →»; повторный open SubmitSheet — disabled

  **task_kind invariant:**
  - `homework_tutor_tasks.task_kind enum('numeric'|'extended'|'proof')`
  - `numeric`: SubmitSheet требует только numeric input
  - `extended` (default): SubmitSheet требует numeric + ≥1 photo
  - `proof`: SubmitSheet требует только ≥1 photo (numeric hidden)
  - Backfill из `check_format`: `short_answer→numeric, detailed_solution→extended`. `proof` — manual mark тутором (Phase 2 UI)

  **Hint behavior — без cap'а 3:**
  - Существующая `available_score` %-degradation сохраняется (см. handleRequestHint)
  - UI показывает «Подсказок: N» **без** жёсткого 3-cap
  - Не путать с дизайн-handoff'ом который показывает «Подсказка 1/3» — там был mock, мы оставляем existing logic

  **Phase split:**
  - Phase 1 (этот rule): mobile + chat + ProblemContext + SubmitSheet с reuse `handleCheckAnswer`
  - Phase 2 (отдельная спека): real Gemini OCR pipeline + 4 verdict states + voice + autosave
  - Phase 3 (отдельная спека): tablet + desktop split layouts
  - Phase 4 (отдельная спека): cutover — удалить flag, redirect old route, удалить GuidedHomeworkWorkspace

  **Спека:** `docs/delivery/features/student-homework-problem-screen/spec.md`.
  ```

  В `CLAUDE.md` добавить bullet в существующую секцию rules после rule 8a:

  ```markdown
  16. **Student Homework Problem Screen — Phase 1 mobile (2026-05-09)** — новая student-side поверхность ДЗ за feature flag `profiles.feature_new_homework_chat`. Mobile-only (≤768px). Submission через `message_kind='submission'` + `submission_payload` JSONB. Reuse `handleCheckAnswer` для grading. Hybrid first-completed-wins с existing chat. Контракты: `.claude/rules/40-homework-system.md` → секция «Student Homework Problem Screen — feature flag + submission contract». Спека: `docs/delivery/features/student-homework-problem-screen/spec.md`
  ```
- **Guardrails:** не дублировать существующие правила. Не убирать существующий контент. Дата в формате `2026-MM-DD`.
- **Validation:** прочитать обновлённые секции, убедиться что внутренние ссылки рабочие (`./` относительные пути корректны).

---

## Phase 5 — Review + QA (~1.5 часа)

### TASK-11 — Code review pass (Codex independent session)

- **Job:** quality gate.
- **AC:** AC-1..AC-11 (review проверяет все).
- **Agent:** Codex (чистая сессия, без контекста Claude Code автора).
- **Files:** READ-ONLY review всех затронутых файлов
- **Что делаем:**

  Codex — независимый ревьюер. Контекст автора недоступен. Прогон строго по канонам.

  Codex прочитает (порядок):
  1. `docs/discovery/product/tutor-ai-agents/14-ajtbd-product-prd-sokrat.md`
  2. `docs/discovery/product/tutor-ai-agents/16-ux-principles-for-tutor-product-sokrat.md`
  3. `docs/discovery/product/tutor-ai-agents/17-ui-patterns-and-component-rules-sokrat.md`
  4. `docs/delivery/features/student-homework-problem-screen/spec.md`
  5. `git diff` против `origin/main`

  Codex проверяет:
  - Job alignment: новый screen усиливает S1 (вся целевая job)?
  - UX drift: respect `.claude/rules/90-design-system.md` (tokens, lucide, no framer-motion)?
  - Scope creep: только Phase 1 (mobile + reuse handleCheckAnswer)? Photo OCR / verdict states-расширение / tablet НЕ примешаны?
  - AC-1..AC-11 выполнены через cross-check: миграции применены, endpoint shape соответствует §5, feature flag работает symmetrically (mobile + flag → новый, остальное → старый)?
  - Anti-leak invariants: handleGetStudentProblem не возвращает `solution_text/rubric_*/ai_score_comment`?
  - Performance: React.memo на массиве сообщений? lazy MathText?
  - Safari/iOS: `100dvh`, 16px input, touch-pan-x на photo strip?

  Формат: `PASS / CONDITIONAL PASS / FAIL`. При FAIL — конкретный список fixes.
- **Guardrails:** Codex не пишет код, только review document. Findings — файл `docs/delivery/features/student-homework-problem-screen/codex-review.md`.
- **Validation:** review file существует, статус `PASS` или fixes applied + re-review до `PASS`.

### TASK-12 — Manual QA on staging + enable flag для 5 пилотных учеников

- **Job:** pilot rollout.
- **AC:** AC-2 (regression), AC-4..AC-7 (happy path), AC-10 (mobile UX).
- **Agent:** Vladimir (manual).
- **Files:**
  - SQL ad-hoc для enable flag: `UPDATE profiles SET feature_new_homework_chat=true WHERE id IN (...) ;` для 5 пилотных учеников Егора
- **Что делаем:**
  1. Verify все 3 миграции применились на staging
  2. Verify `npm run smoke-check` зелёный
  3. Pick 5 пилотных учеников (Егор подскажет — самые активные)
  4. Включить flag SQL
  5. Test cases (на iPhone SE / Android Chrome):
     - Open existing assignment → click task → verify navigate на новый screen
     - Submit numeric+photo для extended task → verify verdict overlay → click «Следующая» → navigate
     - Submit invalid (missing photo для extended) → verify validation error
     - Open на desktop (>768px) → verify regression: GuidedHomeworkWorkspace inline (фолбэк)
     - Disable flag SQL для 1 ученика → verify fallback на старый flow
  6. Сообщить Егору что 5 учеников теперь на новом UI; собирать feedback неделю
  7. Если PASS на всех 5 — расширить на 50 учеников через bulk `UPDATE profiles SET ... WHERE id IN (...)`
- **Guardrails:** Phase 1 не выкатывается на ВСЕХ — только на 5 → 50 → all через explicit SQL. Никакого автоматического enable.
- **Validation:** test report — markdown в `docs/delivery/features/student-homework-problem-screen/qa-report.md` с PASS/FAIL по каждому test case + список feedback от пилотных учеников.

---

## Copy-paste промпты для агентов

> Для каждого TASK-N один self-contained блок. Скопировать в чат с агентом. Промпт включает: role, context, canonical reads, task description, AC, guardrails, mandatory end block (per doc 19/20).

### TASK-1 prompt (Claude Code)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI (B2B+B2C wedge для репетиторов физики ЕГЭ/ОГЭ).

Контекст:
- Сегмент: пилотные репетиторы физики, ученики 8-11 классов
- Wedge: AI = draft + action — каждое student-action создаёт data, не just-talk
- Это TASK-1 из docs/delivery/features/student-homework-problem-screen/tasks.md (Phase 1)

Прочитай (порядок):
1. docs/delivery/features/student-homework-problem-screen/spec.md (вся спека)
2. CLAUDE.md (project rules)
3. .claude/rules/40-homework-system.md (homework system contracts)
4. supabase/migrations/20260508130000_fix_mock_exams_rls_recursion.sql (последняя existing migration — для convention)

Задача:
Создай миграцию `supabase/migrations/20260509120000_add_task_kind_to_homework_tasks.sql`:
1. ADD COLUMN task_kind text CHECK (task_kind IN ('numeric', 'extended', 'proof')) — nullable initially
2. Backfill: UPDATE homework_tutor_tasks SET task_kind = CASE WHEN check_format = 'short_answer' THEN 'numeric' WHEN check_format = 'detailed_solution' THEN 'extended' ELSE 'extended' END WHERE task_kind IS NULL;
3. ALTER COLUMN task_kind SET NOT NULL, SET DEFAULT 'extended'
4. Idempotent (используй IF NOT EXISTS / IF NOT EXISTS guards где применимо)

AC (Given / When / Then):
- Given существующие homework_tutor_tasks записи с разными check_format
- When apply migration
- Then 100% строк имеют task_kind set; new rows получают default 'extended'; check_format не меняется

Guardrails:
- Additive only — никаких DROP/RENAME existing columns
- Backfill идемпотентен (WHERE task_kind IS NULL)
- Не трогать RLS, indexes, triggers
- Не трогать другие таблицы
- Migration номер 20260509120000 — после последнего existing 20260508130000

Mandatory end block в твоём ответе:
- Changed files: список новых/изменённых
- Summary: 2-3 строки что сделано
- Validation: команда для запуска (npm run smoke-check + dry-run SQL)
- Docs to update: какие documents требуют обновления (если есть)
- Self-check: соблюдены ли AC, guardrails, .claude/rules/40-homework-system.md инварианты?
```

### TASK-2 prompt (Claude Code)

```
Твоя роль: senior full-stack engineer в SokratAI.

Контекст: Phase 1 student homework problem screen за feature flag.

Прочитай:
1. docs/delivery/features/student-homework-problem-screen/spec.md
2. .claude/rules/40-homework-system.md

Задача:
Создай миграцию `supabase/migrations/20260509120100_add_feature_new_homework_chat_flag.sql`:
- ALTER TABLE profiles ADD COLUMN feature_new_homework_chat boolean NOT NULL DEFAULT false;
- COMMENT с описанием pilot purpose
- Idempotent

AC: после migration все existing profiles имеют flag=false; никаких permission errors.

Guardrails: additive, default false, никаких RLS изменений.

Mandatory end block: changed files, summary, validation, docs-to-update, self-check.
```

### TASK-3 prompt (Claude Code)

```
Твоя роль: senior full-stack engineer в SokratAI.

Контекст: Phase 1 student homework problem screen — submission через `message_kind='submission'` + `submission_payload JSONB`.

Прочитай:
1. docs/delivery/features/student-homework-problem-screen/spec.md (особенно §5 Technical Design — Data Model)
2. .claude/rules/40-homework-system.md (homework_tutor_thread_messages контракты)
3. supabase/migrations/20260306100000_guided_homework_threads.sql (existing CHECK constraint на message_kind)

Задача:
Создай миграцию `supabase/migrations/20260509120200_add_submission_payload_to_thread_messages.sql`:

1. ALTER TABLE homework_tutor_thread_messages ADD COLUMN IF NOT EXISTS submission_payload JSONB NULL;
2. COMMENT ON COLUMN ... ('For message_kind=submission: structured JSON {numeric: string, photos: string[], text: string, voice_ref?: string|null}.');
3. DROP CONSTRAINT IF EXISTS homework_tutor_thread_messages_message_kind_check;
4. ADD CONSTRAINT с расширенным enum: ['answer','hint_request','question','bootstrap','ai_reply','system','check_result','hint_reply','tutor_message','tutor_note','submission']

AC:
- Existing message_kind values сохраняются работают (test через INSERT mock с каждым existing kind)
- Новый 'submission' kind принимается
- submission_payload nullable — старые сообщения не ломаются

Guardrails:
- НЕ удалять existing message_kind values из enum
- НЕ создавать отдельную таблицу submissions (была удалена в 20260406120000_drop_classic_homework.sql, не возрождать)
- RLS не трогаем — existing policies покрывают новое поле автоматически

Mandatory end block: changed files, summary, validation (включая INSERT тест каждого kind), docs-to-update, self-check.
```

### TASK-4 prompt (Claude Code)

```
Твоя роль: senior backend engineer в SokratAI.

Контекст: Phase 1 student homework problem screen. Нужен GET endpoint для одной задачи + thread.

Прочитай:
1. docs/delivery/features/student-homework-problem-screen/spec.md (§5 API)
2. .claude/rules/40-homework-system.md (особенно «Эталонное решение для AI и anti-leak» + «Patch B+2 dual-host validator»)
3. CLAUDE.md правило 9 (student leak protection)
4. supabase/functions/homework-api/index.ts (existing handlers — handleGetStudentAssignment, computeFinalScore, resolveStudentDisplayName, fetchFullThread)

Задача:
Создай в `supabase/functions/homework-api/index.ts`:

1. Новый handler `async function handleGetStudentProblem(db, userId, hwId, taskId, cors)`:
   - Validate UUID hwId + taskId — 400 INVALID_ID если нет
   - Verify ownership: SELECT id FROM homework_tutor_student_assignments WHERE assignment_id=hwId AND student_id=userId — 404 NOT_FOUND если нет
   - Load assignment: SELECT id, title, subject, deadline, status FROM homework_tutor_assignments WHERE id=hwId
   - Load tasks list (для task_total + поиска целевой task): SELECT id, order_num, task_text, task_image_url, max_score, check_format, task_kind FROM homework_tutor_tasks WHERE assignment_id=hwId ORDER BY order_num
   - Найти target task; если не найден — 404 TASK_NOT_FOUND
   - Load thread через existing fetchFullThread (используй THREAD_SELECT)
   - Compute task_score через existing computeFinalScore(task_state_for_target_task, task.max_score)
   - Compute hints_used = task_state.hint_count ?? 0
   - Resolve student.display_name через existing resolveStudentDisplayName(db, sa.id)
   - Return shape:
     {
       assignment: {id, title, subject, deadline, status},
       task: {id, order_num, task_text, task_image_url, max_score, check_format, task_kind},
       task_total: tasks.length,
       task_score: number,
       thread: HomeworkThread (с tutor_profile через resolveTutorProfileForAssignment),
       student: {id, display_name},
       hints_used: number
     }

2. Подключи route в существующем handler:
   - GET /student/problem/:hwId/:taskId
   - Match через pathSegments.length === 3 && pathSegments[0]==='student' && pathSegments[1]==='problem'

AC:
- 200 OK с правильным shape для assigned student
- 403 для не-assigned student
- 404 для несуществующего hwId/taskId
- НЕ возвращает solution_text, solution_image_urls, rubric_text, rubric_image_urls, ai_score_comment (anti-leak)

Guardrails:
- Reuse existing helpers (computeFinalScore, resolveStudentDisplayName, fetchFullThread, resolveTutorProfileForAssignment)
- Anti-leak: column whitelist на каждом SELECT'е
- Не модифицировать existing handlers (только additive)
- Patch B+2 dual-host validator не нужен (return — storage:// refs, не resolved URLs)

Mandatory end block: changed files (с line ranges), summary, validation (curl examples с staging JWT), docs-to-update, self-check.
```

### TASK-5 prompt (Claude Code)

```
Твоя роль: senior backend engineer в SokratAI.

Контекст: Phase 1 student homework problem screen — POST submission endpoint. Reuse handleCheckAnswer для AI grading.

Прочитай:
1. docs/delivery/features/student-homework-problem-screen/spec.md (§5 API + Solution.ключевые решения «Hybrid grading»)
2. .claude/rules/40-homework-system.md (homework системные контракты + AI image bucket whitelist)
3. supabase/functions/homework-api/index.ts (handleCheckAnswer, evaluateStudentAnswer integration)
4. supabase/functions/homework-api/guided_ai.ts (evaluateStudentAnswer signature)

Задача:
Создай в `supabase/functions/homework-api/index.ts`:

1. Новый handler `async function handleStudentSubmission(db, userId, hwId, taskId, body, cors)`:
   - Validate body shape {numeric: string, photos: string[], text: string} — 400 INVALID_BODY если не соответствует
   - Verify ownership (как в TASK-4)
   - Load task (только for task_kind, max_score, check_format, task_text, task_image_url)
   - Validate task_kind requirements:
     - 'numeric': numeric.trim() обязателен
     - 'extended': numeric.trim() И photos.length >= 1
     - 'proof': photos.length >= 1
     - Возврат 400 VALIDATION с конкретным missing field
   - Validate photo refs через existing extractStudentThreadAttachmentRefs pattern
   - Synthesize answerText:
     const lines = [];
     if (task.task_kind !== 'proof' && numeric.trim()) lines.push(`Числовой ответ: ${numeric.trim()}`);
     if (text.trim()) lines.push(text.trim());
     const answerText = lines.join('\n') || '(см. фото решения)';
   - Resolve thread (existing logic — provisionGuidedThread если нет)
   - Insert submission message в homework_tutor_thread_messages:
     {role: 'user', message_kind: 'submission', content: answerText, image_url: serializeAttachmentRefs(photos), submission_payload: {numeric, photos, text}, task_id: taskId, task_order: task.order_num, thread_id, ...}
   - Reuse handleCheckAnswer logic для grading (можно extract в helper или вызвать handleCheckAnswer напрямую с synthesized body)
   - Return CheckAnswerResponse shape (existing)

2. Routing: POST /student/problem/:hwId/:taskId/submission

AC:
- 200 OK с verdict + ai_score + earned_score + thread updated
- 400 для невалидного body / task_kind requirements не выполнены
- task_state.status='completed' если verdict==CORRECT
- Submission message сохранён в БД с message_kind='submission' + submission_payload
- AI feedback message сохранён с message_kind='check_result'
- Anti-leak: submission_payload в response = тот что прислал client + photo refs (не resolved URLs)

Guardrails:
- Reuse handleCheckAnswer infrastructure (НЕ дублировать AI grading logic)
- Photo refs валидируются по existing isAllowedSignedStorageUrl (Patch B+2)
- НЕ создавать новую таблицу submissions
- evaluateStudentAnswer не получает специальных hint'ов про submission semantics в Phase 1 (Phase 2 spec)
- submission_payload JSONB serialize строго structured object (no raw user input в полях которые render как HTML)

Mandatory end block: changed files, summary, validation (manual curl examples), docs-to-update, self-check.
```

### TASK-6 prompt (Claude Code)

```
Твоя роль: senior frontend engineer в SokratAI (React + TypeScript + React Query + shadcn-ui + Tailwind).

Контекст: Phase 1 student homework problem screen — frontend hooks + types. Backend endpoints из TASK-4 + TASK-5 готовы.

Прочитай:
1. docs/delivery/features/student-homework-problem-screen/spec.md (§5 API, §3 Solution)
2. .claude/rules/performance.md (React Query keys conventions)
3. src/lib/studentHomeworkApi.ts (existing API client — для reference)
4. src/hooks/ (existing hooks для pattern reference)
5. src/types/homework.ts (StudentHomeworkTask)

Задача:
Создай:

1. src/lib/studentProblemApi.ts:
   - export interface StudentProblemTask shape (per spec §5)
   - export interface StudentProblemResponse {assignment, task, task_total, task_score, thread, student, hints_used}
   - export async function getStudentProblem(hwId, taskId): Promise<StudentProblemResponse>
   - export interface SubmitSolutionPayload {numeric: string, photos: string[], text: string}
   - export async function submitSolution(hwId, taskId, payload): Promise<CheckAnswerResponse>
   - Use existing requestStudentHomeworkApi internal helper

2. src/hooks/useStudentProblemTask.ts:
   - export function useStudentProblemTask(hwId, taskId)
   - useQuery({queryKey: ['student','problem', hwId, taskId], queryFn, staleTime: 0, retry: 1})
   - Disabled если !hwId || !taskId

3. src/hooks/useSubmitSolution.ts:
   - export function useSubmitSolution(hwId, taskId)
   - useMutation({mutationFn: (payload) => submitSolution(...)})
   - onSuccess: invalidate ['student','problem', hwId, taskId] + ['student','homework', hwId]

4. src/types/homework.ts:
   - Добавить task_kind?: 'numeric' | 'extended' | 'proof' в StudentHomeworkTask interface (после check_format)
   - Default 'extended' если undefined

AC:
- Types compile (npm run build green)
- React Query keys строго ['student','problem', ...] (per .claude/rules/performance.md §2c)
- Mutation invalidates правильные keys
- StudentHomeworkTask.task_kind optional (backward compat)

Guardrails:
- НЕ дублировать existing API client setup
- НЕ создавать новую axios instance — reuse requestStudentHomeworkApi
- types.task_kind optional — old code не ломается

Mandatory end block: changed files, summary, validation (npm run build + lint), docs-to-update, self-check.
```

### TASK-7 prompt (Claude Code)

```
Твоя роль: senior frontend engineer в SokratAI (React 18 + TypeScript + shadcn-ui + Tailwind).

Контекст: Phase 1 student homework problem screen. Дизайн-handoff: `docs/design_handoff_homework_chat/`. SubmitSheetStub (commit 109a670) заменяется на реальный SubmitSheet. PhotoStrip + VerdictOverlay — новые компоненты.

Прочитай:
1. docs/delivery/features/student-homework-problem-screen/spec.md (AC-5, AC-6, §6 UX/UI)
2. docs/design_handoff_homework_chat/README.md (Layout 1 mobile + SubmitSheet section)
3. docs/design_handoff_homework_chat/student-problem-chat.jsx (SubmitSheet/PhotoStrip/SubmitResult JSX reference)
4. docs/design_handoff_homework_chat/student-chat.css (.subm-* CSS classes)
5. .claude/rules/90-design-system.md (token system, no framer-motion, lucide-only)
6. .claude/rules/80-cross-browser.md (iOS Safari guarantees)
7. src/components/student/homework-problem/SubmitSheetStub.tsx (existing stub — заменяется)
8. src/components/homework/GuidedChatInput.tsx (existing photo upload pattern)
9. src/lib/studentHomeworkApi.ts::uploadStudentThreadImage (reuse)
10. src/components/common/UserAvatar.tsx (reuse pattern)

Задача:
Создай 3 файла:

1. src/components/student/homework-problem/SubmitSheet.tsx (заменяет stub):
   - Props: {open, onClose, task: {id, order_num, max_score, task_kind, answer_unit?}, onSubmitted: (verdict, score, max) => void, hwId, taskId}
   - State: numeric (string), photos (storage_refs[]), text (string), isSubmitting, verdict (null | response)
   - Body conditional rendering:
     - Hint banner (info bg) с taskKind-описанием
     - Section 1 Numeric: render если task_kind !== 'proof'. Input type="number" inputMode="decimal" font-size: 16px, label «Числовой ответ» + «обязательно» pill (если required), unit suffix
     - Section 2 Photos: render если task_kind в ['extended', 'proof']. <PhotoStrip /> embedded
     - Section 3 Optional Text: textarea, label «Дополнить текстом» + «по желанию» pill
     - Section 4 Voice: SKIP в Phase 1 (Phase 2 added)
   - Footer: «Черновик сохранён» placeholder + Submit button
   - Submit button disabled пока validation:
     - 'numeric': numeric.trim().length > 0
     - 'extended': numeric.trim() && photos.length >= 1
     - 'proof': photos.length >= 1
   - On submit → useSubmitSolution.mutate({numeric, photos, text}) → loading state «Распознаём и проверяем…» → on success → render <VerdictOverlay /> внутри SubmitSheet body (z-stack)
   - On verdict close → onClose() + parent navigate (через onSubmitted callback)
   - Closing: prevent close while isSubmitting
   - Reuse existing CSS keyframes из tailwind.config.ts (homework-sheet-slide-up)

2. src/components/student/homework-problem/PhotoStrip.tsx:
   - Props: {photos: string[] (storage_refs), onAdd: (ref: string) => void, onRemove: (ref: string) => void, max?: number (default 5)}
   - Horizontal scroll row тайлов 96×124 с touch-pan-x
   - Каждый тайл: thumbnail (resolved URL via async getStudentTaskImageSignedUrl), page badge (1-based), ✕ delete button
   - Add tile: dashed border, иконка камеры, текст "Сфотографировать" / "Ещё страница"
   - Click add → triggers hidden <input type="file" accept="image/*" capture="environment" multiple>
   - Upload через uploadStudentThreadImage → onAdd(storageRef)
   - Per-tile loading state (spinner overlay)
   - Cap: max=5 (existing MAX_TASK_IMAGES)

3. src/components/student/homework-problem/VerdictOverlay.tsx:
   - Props: {verdict: 'CORRECT' | 'ON_TRACK' | 'INCORRECT' | 'CHECK_FAILED', aiScore, maxScore, feedback, onContinue, onNext}
   - Conditional rendering 3 states:
     - CORRECT: bg-emerald-100, CheckCircle2 48×48, title «Правильно! N/M баллов», CTA «Следующая задача →» (primary) + «Остаться» (ghost)
     - ON_TRACK или INCORRECT с aiScore>0: bg-amber-100, AlertTriangle 48×48, title «Почти — продолжай решать», feedback text, CTA «Закрыть»
     - INCORRECT с aiScore=0 OR CHECK_FAILED: bg-red-100, CircleHelp 48×48, title «Нужно поработать ещё», feedback, CTA «Закрыть»
   - role="status" aria-live="assertive" для verdict
   - Render внутри parent SubmitSheet z-stack (single focus context, не отдельный fixed модал)

Удалить:
- src/components/student/homework-problem/SubmitSheetStub.tsx (DELETE)

AC:
- shadcn Sheet primitive (focus-trap)
- 16px font-size на inputs (iOS no auto-zoom)
- touch-pan-x на PhotoStrip
- loading="lazy" на photo thumbnails
- НЕ framer-motion (CSS keyframes only)
- Tailwind tokens только (bg-socrat-*, никаких hex)
- Lucide icons (CheckCircle2, AlertTriangle, CircleHelp, ChevronUp, X, Camera)

Guardrails:
- Reuse uploadStudentThreadImage (НЕ создавать новый upload helper)
- Reuse existing keyframes (homework-sheet-slide-up)
- VerdictOverlay не fixed модал — рендерится внутри SubmitSheet body conditional
- Не использовать legacy CSS classes из handoff'а (.subm-*) напрямую — маппить в Tailwind
- Submit data сохраняется в local React state до получения verdict — resilient к accidental navigation

Mandatory end block: changed files, summary, validation (lint + build, manual on staging), docs-to-update, self-check.
```

### TASK-8 prompt (Claude Code)

```
Твоя роль: senior frontend engineer в SokratAI.

Контекст: Phase 1 student homework problem screen. Hooks (TASK-6) + SubmitSheet (TASK-7) готовы. Replace mock в HomeworkProblem.tsx на real data.

Прочитай:
1. docs/delivery/features/student-homework-problem-screen/spec.md (AC-4, AC-7)
2. src/pages/student/HomeworkProblem.tsx (existing mock-only)
3. src/pages/student/HomeworkProblem.fixtures.ts (delete этот файл)
4. src/lib/homeworkTelemetry.ts (extension target)

Задача:
1. Modify src/pages/student/HomeworkProblem.tsx:
   - Replace `mockTask` import → `useStudentProblemTask(hwId, taskId)`
   - Replace `mockChatThread` → `data.thread.homework_tutor_thread_messages`
   - Loading state — full-screen spinner (можно reuse PageLoader или Loader2)
   - Error state — centered Card «Не удалось загрузить задачу» + retry
   - ProblemContext default-collapsed логика: useState(messages.length > 0) — expanded если thread пустой, collapsed если есть messages
   - After CORRECT (task_state.status === 'completed' для текущей задачи):
     - Primary CTA меняется на «Следующая задача →» или «Назад к ДЗ»
     - On click — navigate(`/student/homework/${hwId}/problem/${nextTaskId}`) или `/homework/${hwId}`
   - SubmitSheet onSubmitted handler:
     - Если verdict==CORRECT → close overlay → trigger «Следующая задача» navigation
     - Иначе → close overlay → invalidate query → возврат в чат
   - Telemetry (extend src/lib/homeworkTelemetry.ts):
     - student_problem_screen_opened — useEffect once on mount per (hwId, taskId)
     - student_submitsheet_opened — onClick CTA
     - student_submission_sent — at submit
     - student_submission_verdict — on verdict response
     - PII-free payloads (ids + counts + verdict literal)

2. DELETE src/pages/student/HomeworkProblem.fixtures.ts (mock больше не нужны)

AC:
- Loading state работает (SWR-like fallback)
- Error state с retry button
- ProblemContext default-collapsed для непустого thread
- After CORRECT — CTA меняется + click navigates
- 4 telemetry events эмитятся

Guardrails:
- Не залипнуть на refetch — invalidate точечный (не префикс)
- Telemetry payloads PII-free (только ids + verdict literal + counts)
- Не использовать deprecated mock fixtures после удаления

Mandatory end block: changed files (включая deleted fixtures.ts), summary, validation, docs-to-update, self-check.
```

### TASK-9 prompt (Claude Code)

```
Твоя роль: senior frontend engineer в SokratAI.

Контекст: Phase 1 feature flag rollout. New screen активируется только при mobile + feature_new_homework_chat=true.

Прочитай:
1. docs/delivery/features/student-homework-problem-screen/spec.md (AC-2)
2. src/pages/StudentHomeworkDetail.tsx (existing inline GuidedHomeworkWorkspace flow)

Задача:
1. Создай src/hooks/useFeatureNewHomeworkChat.ts:
   - useQuery {queryKey: ['student','profile','feature-flags'], queryFn: () => fetch profile.feature_new_homework_chat}
   - return boolean (default false during loading)

2. Создай src/hooks/useIsMobile.ts:
   - useEffect → window.matchMedia('(max-width: 768px)') listener
   - State: isMobile (default читается из innerWidth at mount)
   - Return boolean

3. Modify src/pages/StudentHomeworkDetail.tsx:
   - Import оба hook
   - В onTaskClick handler (где сейчас открывается inline GuidedHomeworkWorkspace):
     ```
     const isMobile = useIsMobile();
     const enabled = useFeatureNewHomeworkChat();
     const onTaskClick = (taskId: string) => {
       if (isMobile && enabled) {
         navigate(`/student/homework/${hwId}/problem/${taskId}`);
       } else {
         setSelectedTaskOrder(taskOrder); // existing
       }
     };
     ```
   - Никаких других изменений

AC:
- mobile + flag=true → navigate to new screen
- desktop → existing inline behavior (regression check)
- flag=false → existing inline behavior

Guardrails:
- useFeatureNewHomeworkChat: SQL fetch profile.feature_new_homework_chat — reuse existing user profile API если есть, иначе новый minimal endpoint в supabase.from('profiles')
- useIsMobile: SSR-safe (initial state читается через `typeof window !== 'undefined'` guard)
- Никаких других изменений в StudentHomeworkDetail кроме onClick logic
- Resize event пересчитывает (ученик повернул iPad)

Mandatory end block: changed files, summary, validation (manual mobile vs desktop test), docs-to-update, self-check.
```

### TASK-10 prompt (Claude Code)

```
Твоя роль: technical writer для SokratAI internal documentation.

Контекст: Phase 1 завершён (TASKS 1-9 done). Документация требует обновления.

Прочитай:
1. docs/delivery/features/student-homework-problem-screen/spec.md
2. docs/delivery/features/student-homework-problem-screen/tasks.md (контекст для TASK-10)
3. .claude/rules/40-homework-system.md (для format reference)
4. CLAUDE.md (для format)

Задача:
1. Дополни .claude/rules/40-homework-system.md новой секцией «Student Homework Problem Screen — feature flag + submission contract (2026-05-09)»:
   - Routing invariants
   - Submission storage invariants
   - Grading invariants (hybrid first-completed-wins)
   - task_kind invariant
   - Hint behavior — без cap'а 3
   - Phase split (Phase 1 / 2 / 3 / 4)
   Полный контент — см. tasks.md TASK-10 раздел.

2. Дополни CLAUDE.md новый rule (после rule 8a) — pointer на новую секцию rules/40 + краткое описание.

3. Обнови spec.md статус: draft → implemented (после TASK-11 PASS).

AC:
- .claude/rules/40-homework-system.md содержит новую секцию (existing content не удалён)
- CLAUDE.md содержит новый rule entry
- spec.md статус обновлён

Guardrails:
- НЕ удалять existing rules
- НЕ дублировать (если совпадает с rule 8 — link, не copy)
- Дата формат 2026-MM-DD

Mandatory end block: changed files, summary, validation (read обновлённые файлы для smoke), self-check.
```

### TASK-11 prompt (Codex — independent reviewer)

```
Ты — независимый ревьюер SokratAI. Контекст автора (Claude Code) тебе недоступен.

ПОРЯДОК (строго):
1. Прочитай docs/discovery/product/tutor-ai-agents/14-ajtbd-product-prd-sokrat.md
2. Прочитай docs/discovery/product/tutor-ai-agents/16-ux-principles-for-tutor-product-sokrat.md
3. Прочитай docs/discovery/product/tutor-ai-agents/17-ui-patterns-and-component-rules-sokrat.md
4. Прочитай docs/delivery/features/student-homework-problem-screen/spec.md (вся спека)
5. Прочитай docs/delivery/features/student-homework-problem-screen/tasks.md (TASKS 1-10)
6. Посмотри git diff против origin/main для всех затронутых файлов

ПРОВЕРЬ:

**Job alignment:**
- Усиливает ли реализация S1 (Решить ДЗ и понять)? Конкретно S1-1, S1-2, S1-3?
- Не нарушает ли product invariants (AI = draft + action, не chat-only)?

**UX/UI canon:**
- Tokens system: только bg-socrat-*, никаких hex?
- Lucide icons в UI chrome?
- shadcn primitives (Sheet, Button, Input)?
- НЕ framer-motion?
- Mobile-first, 100dvh, 16px text-size на inputs?
- touch-pan-x на horizontal scrolls (PhotoStrip)?

**Scope creep:**
- Только Phase 1 (mobile + reuse handleCheckAnswer)?
- Photo OCR / 4-state verdict / tablet/desktop НЕ примешаны?

**AC выполнены:**
- AC-1: 3 миграции применяются + backfill корректен?
- AC-2: feature flag + viewport check симметричен?
- AC-3: GET /student/problem не leak'ает solution_text/rubric_*/ai_score_comment?
- AC-4: ProblemContext default-collapsed логика для пустого/непустого thread?
- AC-5: SubmitSheet validation per task_kind?
- AC-6: VerdictOverlay 3 состояния?
- AC-7: After CORRECT — CTA меняется?
- AC-8: 4 telemetry events PII-free?
- AC-11: lint + build + smoke-check зелёный?

**Anti-leak invariants:**
- handleGetStudentProblem column whitelist?
- submission_payload structured (no XSS surface)?

**Performance:**
- React.memo на массиве сообщений?
- React Query keys строго ['student','problem', ...]?
- Lazy KaTeX через MathText?

ФОРМАТ:
Создай файл `docs/delivery/features/student-homework-problem-screen/codex-review.md` с заголовком:
- Status: PASS / CONDITIONAL PASS / FAIL
- Findings: numbered list (severity: blocker / major / minor) с file:line ссылками
- Required fixes: список действий

При CONDITIONAL PASS / FAIL — Claude Code применит fixes → re-review.
```

### TASK-12 prompt (Vladimir — manual QA)

```
Manual QA на staging для Phase 1 student homework problem screen.

Pre-conditions:
- Все миграции (TASK 1-3) применены на staging
- Backend deploy (TASK 4-5) прошёл
- Frontend deploy (TASK 6-9) прошёл — Lovable preview обновился
- Codex review (TASK-11) PASS

Setup:
1. На staging выбери 5 пилотных учеников Егора (попроси у Егора список самых активных)
2. SQL: UPDATE profiles SET feature_new_homework_chat=true WHERE id IN (...);
3. Verify SELECT count(*) FROM profiles WHERE feature_new_homework_chat=true; = 5

Test cases (на iPhone SE 375×667 viewport DevTools):

[ ] TC-1: Open /homework/<existing_assignment_id> as test student → click on first task → expect navigate to `/student/homework/.../problem/...`
[ ] TC-2: Verify topbar (Задача N/M · Subject + ДЗ title)
[ ] TC-3: Verify ProblemContext default expanded для пустого thread
[ ] TC-4: Type message в chat input → AI отвечает (existing chat работает)
[ ] TC-5: Open SubmitSheet → upload 1 фото via camera input → enter numeric "1.4" → submit → expect verdict overlay
[ ] TC-6: After CORRECT verdict → click «Следующая задача →» → navigate на следующую
[ ] TC-7: Try submit с missing photo для extended task → expect validation error
[ ] TC-8: Disable flag для 1 ученика SQL → reload → expect inline GuidedHomeworkWorkspace (regression)
[ ] TC-9: Open на desktop (1280px DevTools) → expect old inline GuidedHomeworkWorkspace (regression)
[ ] TC-10: Open в Safari iOS (real device если возможно) → проверить 100dvh, swipe, no auto-zoom

Создай файл docs/delivery/features/student-homework-problem-screen/qa-report.md:
- Status: PASS / FAIL
- Test cases с PASS/FAIL/notes
- Skip-list: что не протестировал и почему
- Feedback от пилотных учеников (после ≥7 дней): список цитат + classification confirms/contradicts

После PASS:
1. Расширить flag на 50 учеников через bulk SQL
2. Через 7 дней stability — рассмотреть Phase 2 spec start
```

### Финальный (универсальный) review-промпт для любого TASK

```
Это итеративный re-review после применения fixes из предыдущего review.

Прочитай заново:
1. docs/delivery/features/student-homework-problem-screen/codex-review.md (предыдущие findings)
2. git log + diff с момента предыдущего review

Проверь:
- Все BLOCKER findings закрыты?
- MAJOR findings закрыты или в acknowledged-list (с обоснованием)?
- MINOR findings закрыты или deferred to backlog?

Обнови codex-review.md:
- Status: PASS / CONDITIONAL PASS / FAIL
- Дельта vs предыдущий review

При PASS → TASK-12 (Vladimir manual QA) может стартовать.
```

---

## Definition of Done (per Pipeline Шаг 6)

После прохождения всех TASK 1-12:

1. ✓ Job/scenario linkage: S1-1, S1-2, S1-3
2. ✓ Wedge linkage: B2B-1 + B2C-1 wedge усиление
3. ✓ Feature spec: spec.md
4. ✓ Claude Code implementation: TASK 1-10
5. ✓ Codex review: TASK-11 PASS
6. ✓ Feedback incorporated: TASK-12 manual QA
7. ✓ No UX/UI-canon breakage: tokens + lucide + shadcn проверено в TASK-11
8. ✓ Success signal defined: leading + lagging metrics в spec §7
9. ✓ Pilot metrics mapped: см. spec §7 «Связь с pilot KPI»

После DoD: deploy-sokratai на VPS + flag enable для 5 пилотных учеников.
