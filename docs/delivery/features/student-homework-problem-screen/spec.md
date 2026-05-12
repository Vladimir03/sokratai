# Student Homework Problem Screen — Spec

**Версия:** v0.2 (Phase 1.x revision after preview QA #1)
**Дата:** 2026-05-09 (v0.1) → 2026-05-10 (v0.2 scope expansion)
**Автор:** Vladimir Kamchatkin (с дизайном от Claude Design)
**Статус:** implemented (Phase 1.x, 2026-05-10 — full chat + voice + step nav + autosave + task images)
**Feature folder:** `docs/delivery/features/student-homework-problem-screen/`
**Связанные документы:**
- Дизайн-handoff: `docs/design_handoff_homework_chat/README.md` + `student-problem-chat.jsx` + скриншоты mobile/tablet/desktop
- Phase 1 mock-only реализация: commit `109a670` (HomeworkProblem.tsx + 7 sub-components)
- Текущий guided chat (заменяемый): `src/components/homework/GuidedHomeworkWorkspace.tsx`
- Контракты ДЗ: `.claude/rules/40-homework-system.md`

---

## Section 0: Job Context (обязательная)

### Какую работу закрывает фича

| Участник | Core Job | Sub-job | Ссылка |
|---|---|---|---|
| Школьник 8-11 кл (B2C) | S1 — Решить ДЗ и понять материал | S1-1: получить пошаговую помощь когда застрял; S1-2: сдать решение и получить балл; S1-3: понять, где ошибся | `docs/discovery/research/SokratAI_AJTBD_job-graphs/` |
| Репетитор (B2B, secondary) | R1 — Проверка ДЗ и оценка прогресса | R1-2: понять где ученик ошибается (через пере-просмотр чата) | (через GuidedThreadViewer, не меняется этой фичей) |
| Родитель (B2C, indirect) | P1 — Видеть, что ребёнок реально занимается | — | через push-уведомления tutor side, отдельный scope |

### Wedge-связка

- **B2B-сегмент:** B2B-1 (репетиторы физики ЕГЭ/ОГЭ) — primary, через retention учеников группы
- **B2C-сегмент:** B2C-1 (школьники 8-11 классов, готовящиеся к ЕГЭ/ОГЭ) — primary
- **Score матрицы:** wedge усиливается напрямую — это student-side surface, через который проходит **каждое** взаимодействие с ДЗ. Любая просадка UX обрушивает retention пилота на 4-й неделе.

### Pilot impact

Каждый ученик пилота 8-11 кл ежедневно проводит на этом экране 15-30 минут. Текущий `GuidedHomeworkWorkspace` функционален, но имеет два провала под mobile:

1. Нет single-shot «сдать решение» с фото от руки — для развёрнутых задач ЕГЭ это критично (на ЕГЭ часть 2 = ход решения от руки + ответ).
2. Условие задачи и чат на одном экране делят место — на iPhone SE (375px) ученик видит либо одно, либо другое, теряя контекст.

Новая поверхность решает оба и приводит mobile-UX в формат, привычный по Telegram (chat-bubble layout, sticky composer, bottom-sheet для сдачи). Это снимает фрикцию, которая в Неделе 2-3 пилота превращается в churn.

---

## 1. Summary

Новый mobile-first экран решения **одной** задачи внутри ДЗ для ученика.

**Phase 1.2 scope (revised 2026-05-10 после preview QA #6 — submission в чат):**

1. **Сократический диалог с AI через чат** (через существующий `/chat` endpoint streaming): paperclip + mic + text input в композере; каждое user-сообщение через `streamChat()` с `guidedHomeworkAssignmentId + guidedHomeworkTaskId`. User messages persist через `saveThreadMessage(..., 'question', taskId)`. AI reply — `message_kind='ai_reply'`. **Чат — discussion-only**: не вызывает `handleCheckAnswer`, не закрывает задачу.
2. **Single-shot сдача решения через `<SubmitSheet>`** — числовой ответ + фото решения от руки + опциональный текст + voice-to-text. SubmitSheet **только collects inputs + closes**; parent (`HomeworkProblem`) запускает `submitSolution` mutation в background. **Никакого VerdictOverlay** — ответ ученика лендится в чат как user bubble (`message_kind='submission'`, kicker «Решение к задаче»), AI verdict — assistant bubble (`message_kind='check_result'`, kicker «Проверка решения»). Студент видит полную историю работы с задачей в одном чате; репетитор видит то же через `GuidedThreadViewer`. Phase 1.2 рефакторинг preview-QA #6 (2026-05-10).
3. **SubmitSheet — единственный путь** triggering `handleCheckAnswer` на mobile. После CORRECT — primary CTA flip на «Следующая задача →»; auto-navigate **отключён**, чтобы студент успел прочитать AI verdict в чате; tap CTA когда готов.
4. **Hybrid first-completed-wins (Q4):** если задача уже `task_state.status='completed'` (через legacy desktop, например), новый mobile UI это видит — primary CTA сразу «Следующая задача →», SubmitSheet не открывает submission flow.
5. **Optimistic submission UX:** parent inserts (synthesized user bubble + typing dots) до начала mutation. После refetch — persisted submission + check_result bubbles замещают optimistic, либо при error — clean rollback + toast (form preserved через localStorage autosave).

**Mobile auto-redirect (Q1):** `StudentHomeworkDetail` на mobile (`useIsMobile()` ≤768px) делает useEffect-redirect на `/student/homework/<hwId>/problem/<targetTaskId>` сразу после load с smart fallback chain: `thread.current_task_id` → first not-completed → `tasks[0].id`. Это revert от click-intercept TASK-8 (codex re-review #3) после preview QA выявившей UX gap.

**Step navigation внутри HomeworkProblem (Q7):** клик по любой цифре в `StepIndicator` → `navigate('/student/homework/<hwId>/problem/<task[i].id>')`. URL = source of truth. Free order — все клики разрешены (mirror legacy «Свободный порядок задач» rule).

Mobile-only Phase 1, **выкатывается сразу всем mobile-юзерам** (viewport ≤768px). Desktop/tablet продолжают использовать existing `GuidedHomeworkWorkspace` до Phase 3 (fallback по viewport-детекции, не по profile flag). Tablet/Desktop — отдельными спеками после feedback от mobile rollout.

---

## 2. Problem

### Текущее поведение

Все ученики пилота используют `GuidedHomeworkWorkspace.tsx` (route `/homework/:id`). Это single-page on которой:
- Слева — TaskStepper с переключением задач
- Сверху — collapsible условие текущей задачи (на mobile collapsed by default — мешает чтению chat)
- В центре — guided chat с AI
- Снизу — composer с двумя полями ввода (Answer + Discussion)

### Боль (Job Mapping)

- **S1-1 «Получить помощь когда застрял»:** на iPhone SE 375px collapsed условие срабатывает реже, чем нужно — ученик не помнит формулу, скроллит вверх, теряет место в чате
- **S1-2 «Сдать решение»:** для развёрнутых задач (часть 2 ЕГЭ) сейчас единственный путь — печатать LaTeX в Answer-поле. Ученик пишет от руки на бумаге, а потом не знает как «сдать тетрадь» — фотография как вложение к chat-сообщению не воспринимается как «формальная сдача». Из этого — 0% submission rate на detailed_solution задачах с photo требованием в неделе 2 пилота.
- **S1-3 «Понять, где ошибся»:** AI-комментарий приходит как обычное chat-сообщение без визуального выделения. Ученик не различает «совет/наводящий» vs «итог проверки».

### Текущие «нанятые» решения

- WhatsApp / Telegram учителю: «вот фото моего решения» — нет автогрейдинга, нет hint'ов
- РЕШУ ЕГЭ: автогрейдинг есть, но только числовых ответов. Развёрнутые решения = self-check без AI
- Conventional homework workspace UX (домашка от других школ): слишком академический, как «электронный дневник», нет mobile-first

---

## 3. Solution

### Описание

Полное переоформление student-side homework solving experience согласно дизайн-handoff'у. Новый экран на route `/student/homework/:hwId/problem/:taskId` (один экран = одна задача). Mobile layout (Layout 1 из handoff'а):

- Topbar: back-стрелка + eyebrow «ЗАДАЧА N/M · Физика» + title ДЗ
- ProblemContext peek/expanded card с step-индикатором задач 1..N + «Дано/Найти» KaTeX-блок + warn-баннер про taskKind
- Chat-поток: AI bubbles слева (Сократ identity, brand avatar + kicker) + user bubbles справа (компактнее, серым) + system divider + typing-индикатор
- ComposerMobile: primary CTA «Сдать решение задачи» (открывает SubmitSheet) + chat input row (📎 + textarea + 🎤 + send)

`<SubmitSheet>` — bottom-sheet с 4 секциями (numeric / photos / text / voice), autosave footer, primary submit, verdict overlay при ответе.

Phase 1 = Mobile только. Tablet/Desktop fallback на старый `/homework/:id` (`GuidedHomeworkWorkspace`).

### Ключевые решения

- **Viewport-based routing — без feature flag.** Mobile (`≤768px`) → новый screen для **всех**. Tablet/Desktop (`>768px`) → existing `GuidedHomeworkWorkspace` (fallback до Phase 3). **Никакой profile.feature_new_homework_chat колонки**: пользователь явно выбрал «mobile сразу всем» вместо staged pilot. Risk: при критическом баге rollback только через `git revert` + `deploy-sokratai` (~3 мин), нет easy SQL-toggle. Принимаем этот trade-off ради скорости попадания UX в руки реальных учеников.
- **Hybrid grading «first-completed wins» (revised 2026-05-10 v0.2 + Phase 1.1):** на mobile **только SubmitSheet** triggers `handleCheckAnswer`. Mobile chat = **discussion-only через `/chat`** (не вызывает grading, не закрывает задачу). Если `task_state.status='completed'` уже стоит (например через legacy desktop `GuidedHomeworkWorkspace` answer-input — который ещё использует chat-incremental check), новый mobile UI это видит и flip'ит primary CTA на «Следующая задача →». Score фиксируется path'ом, который первым выставил completed. **NB:** legacy desktop continues with chat-incremental grading; this rule documents only the **mobile** path. Когда Phase 4 cutover удалит desktop workspace, hybrid-семантика свернётся к single SubmitSheet path.
- **Hint behavior — без cap'а.** Существующая %-деградация `available_score` сохраняется (per текущему backend). UI показывает «Подсказок: N» без 3-cap. **Не** реализуем round-numbers версию из дизайна.
- **`task_kind` enum миграция.** Новая колонка `homework_tutor_tasks.task_kind enum('numeric'|'extended'|'proof')` с backfill от `check_format`: `short_answer→numeric`, `detailed_solution→extended`. `proof` — manual mark тутором (Phase 2 tutor UI).
- **Submission storage — расширяем thread_messages.** Не создаём новую таблицу. Добавляем `message_kind='submission'` enum value + `submission_payload JSONB` колонку в `homework_tutor_thread_messages`. Reuse RLS, image_url infrastructure, чат-поток показывает submission как специальный bubble.
- **AI grading — reuse `evaluateStudentAnswer`** для submissions в Phase 1. Photo OCR + 4 verdict states (`no-work` / `step-error` / `unclear`) — Phase 2, отдельная спека про grading pipeline.
- **Отдельный `ProblemChatMessage` от `GuidedChatMessage`.** Pixel-perfect от дизайна (kicker «СОКРАТ» uppercase, bubble border-1 light, max-w 86%). Существующий `GuidedChatMessage` (production-flow для tutor viewer) не трогается.
- **Mobile detection через `useIsMobile()` hook.** Frontend `StudentHomeworkDetail` при клике на задачу проверяет viewport: `window.innerWidth <= 768` → navigate(`/student/homework/:hwId/problem/:taskId`). Иначе → existing GuidedHomeworkWorkspace inline. Resize listener — если ученик повернул iPad в портрет (становится mobile) при следующем клике на задачу пойдёт уже на новый screen. Acceptable.

### Scope

**In scope (Phase 1):**

- Mobile layout (≤768px)
- Topbar + ProblemContext (peek/expanded) + ChatThread + ComposerMobile + SubmitSheet
- SubmitSheet с PhotoStrip (camera+gallery, multi-page), numeric input + unit, optional text, **submit button с реальным backend** (через `handleCheckAnswer` synthesis)
- Verdict overlay 3 состояния: `correct` (зелёная карточка с XP/streak), `incorrect-with-hint` (используем CORRECT/INCORRECT/ON_TRACK маппинг), `error` (network/AI fallback)
- Migrations: `task_kind`, `submission_payload + message_kind extend` (всего 2, не 3)
- Backend: новые endpoints `GET /student/problem/:hwId/:taskId`, `POST /student/problem/:hwId/:taskId/submission`
- Frontend hooks: `useStudentProblemTask`, `useSubmitSolution`, реальные React Query keys
- Feature flag wrapper в `StudentHomeworkDetail`
- Hint behavior (existing % degradation + UI counter)
- `GET /problem/:taskId` возвращает meta: assignment.title, subject, task_no, task_total, task_score, task_score_max, task_kind, given (parsed из task_text при наличии), thread, hints used count
- AI Сократ identity в bubbles (reuse brand `sokrat-chat-icon.png`)
- Telemetry: `student_problem_screen_opened`, `student_submitsheet_opened`, `student_submission_sent`, `student_submission_verdict`

**Out of scope (deferred):**

- 4-step grading pipeline с Gemini OCR (no-work / step-error / unclear) → Phase 2 separate spec
- Tablet (Layout 2) + Desktop (Layout 3) → Phase 3 (`student-homework-problem-screen-multi-device.md`)
- Tutor UI — task_kind selector в TutorHomeworkCreate → Phase 2
- Hint cap = 3 (per UX answer — keeping no cap)
- Hint-ladder UI блок (только desktop, Phase 3)
- Math-keyboard «Σ Формула» (только desktop, Phase 3)
- Server-side autosave через PATCH endpoint → Phase 2 (Phase 1.x использует localStorage)
- Voice as first-class audio attachment (`voice_ref` в `submission_payload`) → Phase 2 (Phase 1.x = speech-to-text shortcut в text-поле)
- IndexedDB offline → P2 follow-up
- A/B test new vs old guided chat → P2 (только после Phase 1 stable)

**Reverted from Phase 1.0 deferral (now back in scope, 2026-05-10):**

- Сократический chat composer (paperclip + mic + text input) — теперь функциональный через `/chat` endpoint streaming (codex review #1 originally flagged dead chat affordance; v0.2 wires it to real backend instead of removing it).
- Voice recorder в SubmitSheet (Q11) — speech-to-text helper только.
- Autosave (Q12) — localStorage-based.
- Step indicator clicks (Q7) — внутри новой mobile screen.

**Later (Phase 2/3):**

- Phase 2 backend grading pipeline: Gemini 3 Flash OCR + verdict states
- Phase 2 voice + autosave
- Phase 3 tablet/desktop split layouts (`student-problem-chat-multi-device.md`)
- Phase 4 cutover: redirect `/homework/:id` → новый screen для desktop тоже, удалить `GuidedHomeworkWorkspace`

---

## 4. User Stories

### Школьник (primary)

> **Когда** я открываю задачу №3 из ДЗ на iPhone SE, **я хочу** одним свайпом видеть условие + чат с AI в одном экране, **чтобы** не скроллить туда-сюда между ними.
>
> **Когда** AI задал наводящий вопрос и я пытаюсь ответить, **я хочу** что бы клавиатура и input не съедали половину экрана, **чтобы** видеть свой ответ при наборе.
>
> **Когда** я готов сдать решение задачи (часть 2 ЕГЭ), **я хочу** одной кнопкой открыть форму, ввести числовой ответ + сфоткать решение от руки + (по желанию) пояснить голосом, **чтобы** не печатать LaTeX и не делать вид что чат — это «сдача».
>
> **Когда** AI проверил мой ответ, **я хочу** видеть итог (correct + балл / нужна доработка) как явную карточку, а не как обычное chat-сообщение, **чтобы** понимать «всё, задача засчитана» vs «продолжай решать».
>
> **Когда** я решил задачу (CORRECT), **я хочу** одной кнопкой перейти к следующей задаче, **чтобы** не возвращаться в список задач ДЗ.

### Репетитор (secondary)

> **Когда** мой ученик отправляет решение через SubmitSheet с фото от руки, **я хочу** что бы submission попадал в `homework_tutor_thread_messages` как специальное сообщение `message_kind='submission'`, **чтобы** видеть его в `GuidedThreadViewer` рядом с обычными ответами, без новой UI-поверхности.

### Родитель (indirect)

> **Когда** мой ребёнок сдал задачу через SubmitSheet (фото от руки), **я хочу** получить push «Артём решил задачу 3 из 9», **чтобы** видеть прогресс. *(Phase 4 — отдельный scope)*

---

## 5. Technical Design

### Затрагиваемые файлы

**Migrations (2):**
- `supabase/migrations/20260509120000_add_task_kind_to_homework_tasks.sql` — добавить колонку + backfill
- `supabase/migrations/20260509120100_add_submission_payload_to_thread_messages.sql` — `submission_payload JSONB nullable` + extend `message_kind` enum с `'submission'`

**Backend (`supabase/functions/homework-api/index.ts`):**
- Новый handler `handleGetStudentProblem(db, userId, hwId, taskId)` — возвращает single-task response с `{assignment, task, thread, student}` shape
- Новый handler `handleStudentSubmission(db, userId, hwId, taskId, body)` — принимает `{numeric, photos[], text}`, синтезирует answer string (`"Числовой ответ: X\n${text}"`), вызывает existing `evaluateStudentAnswer` с photos как image_url, пишет message с `message_kind='submission'` + `submission_payload` JSONB
- Routes:
  - `GET /student/problem/:hwId/:taskId`
  - `POST /student/problem/:hwId/:taskId/submission`

**Frontend:**
- Existing: `src/pages/student/HomeworkProblem.tsx` (заменить mock на real React Query)
- Existing: `src/components/student/homework-problem/SubmitSheetStub.tsx` → удалить, новый `SubmitSheet.tsx` (real component)
- Новый: `src/components/student/homework-problem/PhotoStrip.tsx` (multi-page upload)
- Новый: `src/components/student/homework-problem/VerdictOverlay.tsx` (3 состояния)
- Новый: `src/lib/studentProblemApi.ts` — fetch helpers для GET/POST endpoints
- Новый: `src/hooks/useStudentProblemTask.ts` (React Query)
- Новый: `src/hooks/useSubmitSolution.ts` (mutation)
- Modified: `src/pages/StudentHomeworkDetail.tsx` — viewport-based redirect в onClick handler задачи (через `useIsMobile()` hook)
- Modified: `src/types/homework.ts` — `task_kind` field в `StudentHomeworkTask`
- Modified: `src/lib/studentHomeworkApi.ts` — extend SELECT для `task_kind`

**Docs:**
- `docs/delivery/features/student-homework-problem-screen/spec.md` (этот файл)
- `docs/delivery/features/student-homework-problem-screen/tasks.md` (Step 5)
- `.claude/rules/40-homework-system.md` — добавить секцию «Student Homework Problem Screen — viewport routing + submission contract»
- `CLAUDE.md` rule — pointer к новой секции

### Data Model (изменения)

**`homework_tutor_tasks`:**
```sql
ALTER TABLE homework_tutor_tasks
  ADD COLUMN task_kind text
    CHECK (task_kind IN ('numeric', 'extended', 'proof'));

-- Backfill
UPDATE homework_tutor_tasks
  SET task_kind = CASE
    WHEN check_format = 'short_answer' THEN 'numeric'
    WHEN check_format = 'detailed_solution' THEN 'extended'
    ELSE 'extended'
  END
  WHERE task_kind IS NULL;

ALTER TABLE homework_tutor_tasks
  ALTER COLUMN task_kind SET NOT NULL,
  ALTER COLUMN task_kind SET DEFAULT 'extended';
```

**`homework_tutor_thread_messages`:**
```sql
ALTER TABLE homework_tutor_thread_messages
  ADD COLUMN submission_payload JSONB NULL;
COMMENT ON COLUMN homework_tutor_thread_messages.submission_payload IS
  'For message_kind=submission: structured JSON {numeric, photo_refs[], text, voice_ref?}.';

-- Extend message_kind CHECK constraint with 'submission'
-- (existing constraint в migration 20260306100000_guided_homework_threads.sql)
ALTER TABLE homework_tutor_thread_messages
  DROP CONSTRAINT IF EXISTS homework_tutor_thread_messages_message_kind_check;
ALTER TABLE homework_tutor_thread_messages
  ADD CONSTRAINT homework_tutor_thread_messages_message_kind_check
    CHECK (message_kind IS NULL OR message_kind IN (
      'answer', 'hint_request', 'question', 'bootstrap',
      'ai_reply', 'system', 'check_result', 'hint_reply',
      'tutor_message', 'tutor_note',
      'submission' -- new
    ));
```

### API

**`GET /functions/v1/homework-api/student/problem/:hwId/:taskId`**

Auth: student JWT.

Response:
```typescript
{
  assignment: {
    id: string;
    title: string;
    subject: string;
    deadline: string | null;
    status: 'draft' | 'active' | 'archived';
  };
  task: {
    id: string;
    order_num: number;
    task_text: string;
    task_image_url: string | null; // dual-format ref
    max_score: number;
    check_format: 'short_answer' | 'detailed_solution';
    task_kind: 'numeric' | 'extended' | 'proof';
  };
  task_total: number; // tasks.length для step indicator
  task_score: number; // computed final_score (override > earned > ai > status)
  thread: HomeworkThread; // existing shape, with task_states + messages
  student: {
    id: string;
    display_name: string | null;
  };
  hints_used: number; // task_state.hint_count для текущей задачи
}
```

**`POST /functions/v1/homework-api/student/problem/:hwId/:taskId/submission`**

Auth: student JWT (ownership через homework_tutor_student_assignments).

Request body:
```typescript
{
  numeric: string;          // canonical "1.4" или "1,4" — backend нормализует
  photos: string[];         // storage:// refs after upload (existing flow)
  text: string;             // optional reasoning
}
```

Behaviour:
1. Validate ownership через existing `homework_tutor_student_assignments` lookup
2. Validate task_kind requirements:
   - `numeric`: `numeric` обязателен, `photos[]` ignored
   - `extended` (default): `numeric` + `photos[].length >= 1` обязательны
   - `proof`: `photos[].length >= 1` обязателен, `numeric` ignored
3. Synthesize `answer` string: `"Числовой ответ: ${numeric}${text ? `\n${text}` : ''}"` (для proof — только text)
4. Insert message_kind='submission' message с `submission_payload = {numeric, photos, text}` И `image_url` = serialized photos (для совместимости с existing display)
5. Call existing `handleCheckAnswer` с synthesized answer + photos → AI grading через `evaluateStudentAnswer`
6. Return existing `CheckAnswerResponse` shape: `{verdict, ai_score, earned_score, available_score, max_score, hint_count, task_completed, next_task_order, thread_completed, total_tasks, thread}`

### Миграции (порядок применения)

```
20260509120000  add_task_kind_to_homework_tasks
20260509120100  add_submission_payload_to_thread_messages
```

Обе — additive, idempotent (`IF NOT EXISTS` где можно), backward-compatible. Старый GuidedHomeworkWorkspace продолжает работать без изменений.

---

## 6. UX / UI

### Wireframe / Mockup

`docs/design_handoff_homework_chat/` — handoff package с jsx-референсом, css, скриншотами. Mobile = Layout 1 в handoff README.

### UX-принципы (из doc 16)

- **AI = draft + action.** Чат AI оценивает каждый ответ → status. Не «слоп», не just-talk.
- **Mobile-first и большой touch target.** Все interactive элементы ≥ 44×44, `touch-action: manipulation`, `text-base` (16px) на input'ах для предотвращения iOS auto-zoom.
- **Не chat-only output.** SubmitSheet = explicit action layer над чатом.
- **«Ты» к ученику.** Все copy — на «ты» (см. design tone of voice).
- **Не нарушать boundary student/tutor:** новый screen — student-only, не импортирует tutor компоненты.

### UI-паттерны (из doc 17 + .claude/rules/90-design-system.md)

- **Token system:** только `bg-socrat-*`, `text-socrat-*`, никаких хардкод-hex
- **Lucide icons** в UI chrome (back arrow, paperclip, mic, send, camera, check-circle-2, chevron-up). Никаких emoji в нав/кнопках.
- **shadcn primitives:** Sheet (для SubmitSheet — focus-trap, role="dialog"), Button (CTA), Input (numeric), Textarea (text)
- **No framer-motion.** CSS keyframes из `tailwind.config.ts` (`homework-typing-dot`, `homework-sheet-slide-up`)
- **`React.memo`** на `ProblemChatMessage` (массив сообщений может расти до 50+)
- **Lazy KaTeX** через existing `MathText` lazy-import (`hasMath` детект перед KaTeX load)
- **Безопасность для Safari/iOS:** `100dvh` (не `100vh`), `border-separate` нигде не нужен (нет таблиц), всё avatar = lazy `<img loading="lazy">` через UserAvatar / SokratAvatar

---

## 7. Validation

### Acceptance Criteria (testable, all P0 unless marked)

- **AC-1 (P0):** Миграции `20260509120000`, `20260509120100` применяются на staging без ошибок. После применения: 100% существующих `homework_tutor_tasks` имеют `task_kind` (через backfill `short_answer→numeric, detailed_solution→extended`).
- **AC-2 (P0):** При viewport `<= 768px` `StudentHomeworkDetail` делает auto-redirect на `/student/homework/:hwId/problem/:targetTaskId` через `useEffect` после загрузки `useStudentAssignment + useStudentThread`. **Smart fallback chain (Q1):** `thread.current_task_id` → первая задача без `task_state.status='completed'` → `tasks[0].id`. При viewport > 768px → existing inline `GuidedHomeworkWorkspace` без изменений (regression test). Resize listener активный (`useIsMobile` + `matchMedia('change')`). *(Revision 2026-05-10: вернулись к auto-redirect после preview QA #1 — click-intercept (codex re-review #3) confused students who didn't realise they had to tap a circle to enter the new UI. Smart fallback на current task решает «всегда task #1» concern, который изначально мотивировал отказ от auto-redirect.)*
- **AC-3 (P0):** Endpoint `GET /student/problem/:hwId/:taskId` возвращает 200 OK для assigned student с правильным shape (см. §5 API). Возвращает **404 `NOT_FOUND`** для не-assigned student — privacy invariant: не раскрываем существование чужих ДЗ через status-code differential (mirrors `handleGetStudentAssignment`, `handleGetStudentThreadByAssignment`, `mock-exam-public::loadTutorCard`). Возвращает **404 `TASK_NOT_FOUND`** если задача не принадлежит указанному ДЗ. Не leak'ает tutor-only поля (`solution_text`, `solution_image_urls`, `rubric_text`, `rubric_image_urls`, `ai_score_comment`) — проверяется на staging через response body grep. *(Revision 2026-05-09: status code corrected from 403 → 404 per established student-endpoint privacy invariant; original draft wording was inconsistent with sibling endpoints. Codex review finding #6.)*
- **AC-4 (P0):** На route `/student/homework/:hwId/problem/:taskId`:
  - Route защищён auth gate (codex re-review #3 fix 2026-05-09): прямой URL без сессии редиректит на login, mobile full-bleed layout сохраняется (без global navigation chrome). Реализация — `<AuthGuard hideNavigation>` (или эквивалент) обёртывает route в `App.tsx`.
  - Topbar показывает «ЗАДАЧА N/M · {subject}» eyebrow + ДЗ title
  - ProblemContext по умолчанию **expanded** если thread пустой (`messages.length === 0`), **collapsed** если есть сообщения. Step-indicator корректен (done = task_states.status='completed' среди других задач, current = эта задача).
  - ChatThread фильтрует messages по `task_id === task.id` (legacy fallback `task_order === task.order_num`). Рендерит через **`GuidedChatMessage`** (Q13 reuse) с `perspective='student'` — brand Сократ identity (avatar + «СОКРАТ» kicker + muted-зелёный bubble), MathText, image attachments. Задача с пустым current-task thread → system divider «Начни решать задачу».
  - **Functional chat composer (Phase 1.x, Q3+Q5+Q6):** primary CTA «Сдать решение задачи» (открывает SubmitSheet) + chat row paperclip/mic/text/send.
    - **Chat send (Q3):** через `streamChat()` `/chat` endpoint streaming с `guidedHomeworkAssignmentId + guidedHomeworkTaskId`. User message persists через `saveThreadMessage(..., 'question', taskId)`. AI reply persists с `'ai_reply'`. **Discussion-only — не закрывает задачу.**
    - **Voice (Q5):** mic кнопка → `useVoiceRecorder.startRecording()` → on stop → `transcribeThreadVoice(threadId, blob)` (Groq Whisper) → транскрипт *append'ится* к существующему input (preserves user-typed prefix). Editable перед отправкой.
    - **Paperclip (Q6):** file input → `uploadStudentThreadImage` (homework-submissions bucket) → ref в local state, отправляется с user message.
- **AC-4a (P0, new in v0.2):** Task images gallery в `ProblemContext` expanded view рендерит multi-photo (до 5) через batched signed-URL endpoint (`useStudentTaskImagesSignedUrls`). Click на thumbnail → fullscreen Dialog с keyboard arrow nav + counter. Если `task_image_url` null → секция не рендерится. Q9 + Q10 from preview QA #1.
- **AC-4b (P0, new in v0.2):** Click на любую цифру в `StepIndicator` (внутри `HomeworkProblem`) → `navigate('/student/homework/<hwId>/problem/<task[i].id>')`. Free order — все задачи кликабельны (mirror legacy «Свободный порядок» rule). Click на текущую задачу — no-op. Q7 + Q8 from preview QA #1.
- **AC-4c (P0, new in v0.2):** Top-bar back arrow → `navigate('/student/homework')` (список ДЗ ученика). Q2 from preview QA #1.
- **AC-4d (P0, new in v0.2):** Functional chat composer:
  - **Text send:** caret в input → type → Enter / send button → user bubble lands optimistic, persists через `saveThreadMessage('user', ..., 'question', taskId)`, затем `streamChat()` через `/chat` endpoint. AI reply streams inline (preview bubble), затем persists с `'ai_reply'`.
  - **Voice (Q5):** mic кнопка toggle: idle → click → recording (red MicOff icon + duration counter в placeholder); recording → click stop → transcribe → транскрипт **appended** к существующему input.
  - **Paperclip (Q6):** click → native file picker → upload → preview pill «Фото · ✕» над input. Send включает refs в `image_url`.
- **AC-5 (P0):** SubmitSheet (Phase 1.4 revision 2026-05-11 — preview-QA #9 merged + photo-OR-text):
  - **Section structure для extended/proof (3 секции):**
    - Section 1 «Решение (фото или текст)» — combined: PhotoStrip + textarea. PhotoStrip упрощённый: `<input type="file" accept="image/*" multiple>` (БЕЗ `capture` attribute — iOS Safari показывает native sheet «Сфотографировать / Из галереи / Файл»; iPad-ученики могут загружать скриншоты решения). Textarea рядом для text-only решений (iPad scenario). Voice (Section 3) транскрибируется в эту textarea.
    - Section 2 «Ответ» (numeric) — только для extended/numeric task_kind. Для `extended` badge ВСЕГДА «по желанию» (preview-QA #9 relax — student может submit без numeric ответа); для `numeric` task_kind badge «обязательно» (но `numeric` task используют inline composer, не sheet — см. AC-12).
    - Section 3 «Голосом» — speech-to-text helper appends в Section 1 textarea.
  - Hint banner text для extended: «Покажи ход решения — фото или текст. Ответ по желанию.»
  - Numeric input принимает запятую и точку («1,4» и «1.4»), unit suffix из task data.
  - Submit button **disabled** пока не выполнены `task_kind`-specific требования:
    - `numeric`: `numeric.trim().length > 0`
    - `extended`: **photo OR text** (preview-QA #9 relax — iPad-ученики пишут решение в редакторе; backend `handleStudentSubmission` соответствует)
    - `proof`: `photos.length ≥ 1`
  - При submit → POST `/student/problem/.../submission` с `{numeric, photos, text}` → SubmitSheet **закрывается мгновенно**; submission landing в чате как `message_kind='submission'` bubble + AI verdict как `'check_result'` bubble (Phase 1.2 contract).
- **AC-5a (P0, new 2026-05-11 preview-QA #9):** Photo attachment в chat-send (discussion path):
  - File input `<input type="file" ref={fileInputRef}>` mounted **вне** composer conditional branch (HomeworkProblem.tsx) — было mounted только в extended-composer, что блокировало paperclip в `NumericAnswerComposer` (numeric task `fileInputRef.current` был `undefined` → click no-op).
  - Chat-send с photo БЕЗ text работает: inline placeholder `(фото)` / `(фото x${N})` синтезируется в `handleChatSend`. Раньше вызывали `buildGuidedAttachmentPlaceholder(attachmentRefs.length)` — функция expects `Array<{name,type}>`, не number → `.map` throws TypeError → send silently dropped.
- **AC-12 (P0, new in v0.3 preview-QA #8 2026-05-11):** Для `task_kind='numeric'` SubmitSheet **не используется**. Composer показывает inline `NumericAnswerComposer`:
  - Row 1: 💡 hint + green-bordered input «Ответ...» + send (primary green). Tap send → `checkAnswer` API (legacy `handleCheckAnswer` flow) → optimistic user bubble (`message_kind='answer'`) + typing dots → AI verdict в чате с `'check_result'` / `'ai_reply'` kind. На CORRECT → primary CTA flip на «Следующая задача» (через `isCurrentCompleted` derive).
  - Row 2: «Обсудить шаг с AI ▼» toggle (collapsed by default).
  - Row 3 (collapsible): 📎 + input «Спроси Сократа...» + 🎤 mic + send (slate). Discussion = `/chat` discussion (не закрывает задачу — Phase 1.2 contract).
  - Большая «Сдать решение задачи» CTA **удалена** для `numeric` — 1 клик = ответ = formal submission. Это самое популярное действие на numeric задачах.
- **AC-13 (P0, new in v0.3 preview-QA #8 2026-05-11):** Mobile viewport white-strip bug fix. Root container HomeworkProblem использует `style={{ height: useVisualViewportHeight() }}` вместо `h-[100dvh]` Tailwind class. Hook слушает `visualViewport.resize/scroll` events чтобы корректно отрабатывать virtual keyboard open/close и mobile address-bar toggle. Fallback `'100dvh'` для SSR / non-supporting browsers.
- **AC-14 (P0, new 2026-05-11 preview-QA #10 — codex review fix):** Discussion chat scoring-neutral. `saveThreadMessage` backend handler инкрементит `task_states.attempts` ТОЛЬКО для `role='user' && message_kind === 'answer'` (legacy answer-input path). Все остальные user kinds (`'question'`, `'hint_request'`, `'submission'`) — scoring-neutral. Без этого invariant'a discussion chat в mobile UI силенциально снижал `available_score` через ON_TRACK degradation. SubmitSheet submissions используют отдельный API endpoint (`handleStudentSubmission`) и не идут через `saveThreadMessage`.
- **AC-15 (P0, revised 2026-05-11 preview-QA #11 hotfix):** Step progress / next-task правильность. Frontend (`HomeworkProblem.tsx`) резолвит `task_order` через `assignmentDetails.tasks[].order_num` lookup по `task_id` (НЕ читает `s.task_order` напрямую — поле не существует в `homework_tutor_task_states` DB schema). Phase 1.5 codex fix #2 пытался добавить `task_order` в THREAD_SELECT subselect — это вернуло PostgREST 500 для всех thread fetches (student empty chat + tutor stuck loading). Hotfix: select rolled back, frontend использует canonical taskByIdMap pattern из legacy `GuidedHomeworkWorkspace`.
- **AC-16 (P0, new 2026-05-11 preview-QA #10 — codex review fix):** Completed-assignment routing. `HomeworkProblem::navigateAfterCorrect` no-next case → `/homework` (список ДЗ), не `/homework/:hwId`. `StudentHomeworkDetail` mobile useEffect: early exit на `thread.status === 'completed'` ИЛИ все tasks completed → `/homework`. Раньше: completed assignment redirected back to `tasks[0]` → loop в решённой задаче.
- **AC-17 (P0, new 2026-05-11 preview-QA #10):** `proof` task_kind contract = photo OR text (хотя бы одно). Numeric input скрыт (`showNumeric = false` для proof). Backend `handleStudentSubmission` proof branch: `photos.length >= 1 || textTrim.length > 0`. Use case: ОГЭ описания эксперимента, теоретические определения, ЕГЭ КИМ 21 — photo обязательно желательно, text допустим если задача чисто теоретическая.
- **AC-18 (P0, new 2026-05-11 preview-QA #10):** Onboarding modal **не блокирует** mobile homework problem screen. `<AuthGuard fullBleed>` рендерит ТОЛЬКО `{children}` (без `<OnboardingModal>`). Vladimir product decision: ученик переходит в ДЗ → сразу решает. Если onboarding критичен — Phase 2 добавит soft prompt или tutor enforcement.
- **AC-19 (P0, new 2026-05-11 preview-QA #10):** AI bubble identity consistent — везде «Сократ AI» (включая inline typing-dots в `HomeworkProblem`, не только persisted bubbles через `GuidedChatMessage::AI_DISPLAY_NAME`). Раньше hint optimistic + pre-stream interlude использовали «Сократ» (без «AI»), что давало inconsistent kicker в одном thread.
  - **Section 4 — Voice (Q11, new in v0.2):** mic кнопка → `useVoiceRecorder.startRecording()` → recording state визуально (red MicOff + counter «Xc») → click stop → `transcribeThreadVoice(taskId, blob)` (Groq Whisper) → транскрипт **appended** к section-3 textarea с `\n` separator (preserves user-typed prefix). Phase 1.x stores no audio blob; voice = pure speech-to-text. `voice_ref` в `submission_payload` всегда `null`.
  - **Autosave (Q12, new in v0.2):** при изменении `numeric/photos/text` каждые 5s → `localStorage.setItem('submitsheet-draft-<taskId>', JSON.stringify(draft))`. Footer caption «Черновик сохранён · X сек назад» обновляется live (recompute every 10s). On open — restore from localStorage if exists. On CORRECT verdict — `localStorage.removeItem(draftKey)` clears draft. На partial / error verdicts — draft preserved для retry.
- **AC-6 (P0):** VerdictOverlay реагирует на 3 состояния:
  - `correct` (verdict==CORRECT): зелёная карточка «Правильно! N/M баллов», CTA «Следующая задача →» (или «Назад к ДЗ» если это последняя). При тапе CTA — navigate
  - `partial`/`incorrect` (verdict==ON_TRACK или INCORRECT): жёлтая/красная карточка с feedback от AI, CTA «Продолжить решать» (закрывает overlay, возвращает в чат с новым AI message)
  - `error` (network/AI fail): toast с retry — submit data сохраняется в state, ученик может re-submit
- **AC-7 (P0):** После CORRECT (status=completed для task_state):
  - SubmitSheet primary CTA в Composer **меняется** на «Следующая задача →» (или «Завершить ДЗ» если последняя)
  - Открытие SubmitSheet после completion → disabled с подсказкой «Задача сдана. Перейди к следующей.»
  - Visit task через step-indicator → corresponding indicator показывает «done» (зелёный с галочкой)
- **AC-8 (P0):** Telemetry-события эмитятся в `window.dataLayer` (PII-free):
  - `student_problem_screen_opened` — `{assignmentId, taskId, taskNo, taskKind}`
  - `student_submitsheet_opened` — `{assignmentId, taskId, hadDraft}`
  - `student_submission_sent` — `{assignmentId, taskId, hasPhotos, photoCount, hasText, numericLength}`
  - `student_submission_verdict` — `{assignmentId, taskId, verdict, aiScore, maxScore}`
- **AC-9 (P1):** Hints — кнопка hint в composer работает через existing `handleRequestHint`. UI badge «Подсказок: N» обновляется. `available_score` деградирует через existing %-rules. **Без cap'а 3** (existing behaviour).
- **AC-10 (P1):** Mobile UX (iPhone SE 375×667 минимум):
  - Composer не съедается клавиатурой (`100dvh` + sticky-bottom)
  - SubmitSheet `max-h: 92%` оставляет видимый scrim сверху
  - PhotoStrip horizontal scroll работает + iOS swipe не съедается row-onClick (используем `touch-action: manipulation` где нужно)
  - KaTeX в условии задачи не overflow (max-w-full + break-words)
- **AC-11 (P0):** `npm run build && npm run smoke-check` — оба зелёные. **Lint: delta-only baseline** — `npm run lint` имеет ~709 pre-existing problems в репо (см. `.claude/rules/95-production-deploy.md` § «Будущие улучшения»); AC-11 требует **+0 errors на файлах, затронутых этой фичей** (Phase 1 frontend code в `src/components/student/homework-problem/`, `src/pages/student/HomeworkProblem.tsx`, `src/pages/StudentHomeworkDetail.tsx`, `src/lib/studentProblemApi.ts`, `src/lib/studentHomeworkApi.ts`, `src/hooks/useStudentProblemTask.ts`, `src/hooks/useSubmitSolution.ts`, `src/hooks/useIsMobile.ts`, `src/types/homework.ts`). Полный `npm run lint` зелёным **не требуется** для Phase 1 ship — это отдельная техническая задача (см. follow-up). *(Revision 2026-05-09: clarified delta-only scoping per codex review finding #10 — global lint baseline предшествует TASK-1 и не блокирует Phase 1 rollout.)*

### Связь с pilot KPI

- **Leading (через 3-7 дней пилота flag=true):**
  - 70% включённых учеников открывают новый screen в первые 3 дня
  - SubmitSheet open rate ≥ 50% от общего числа task-открытий (vs ~5% для текущего photo-attachment flow)
  - Submission completion rate (open → submit) ≥ 60%
- **Lagging (через 2-4 недели):**
  - Среднее время на задачу: -20% vs old workspace (target ~12 min vs current ~15 min)
  - Detailed_solution submission rate: +60% (target ~60% vs current ~0% photos через chat-attach)
  - Pilot retention неделя 4: ≥ 80% (без flag) vs ≥ 85% (с flag) — sanity check что новый screen не хуже

### Smoke check

```bash
npm run lint && npm run build && npm run smoke-check
```

Manual QA на staging (до prod deploy):
1. Открыть `/homework/<existing_assignment_id>` на тест-аккаунте на iPhone (DevTools mobile mode 375×667)
2. Кликнуть на задачу → ожидание: redirect на `/student/homework/.../problem/...`
3. Verify все AC-4 elements присутствуют
4. Открыть SubmitSheet → ввести numeric + добавить 1 фото → submit → ожидание verdict overlay
5. Кликнуть «Следующая задача» → navigate на следующую (или backlist если последняя)
6. Открыть на desktop (>768px) → ожидание: GuidedHomeworkWorkspace inline (regression на старый flow)
7. Тот же тест-аккаунт повернуть iPad в портрет (≤768px) → клик задачи → новый screen; обратно landscape (>768px) → старый flow

После PASS на staging — `deploy-sokratai` на VPS → live для **всех** mobile-юзеров одновременно. Rollback при критическом баге = `git revert <hash>` + `deploy-sokratai` (~3 мин).

---

## 8. Risks & Open Questions

| Риск | Вероятность | Митигация |
|---|---|---|
| Photo upload через `homework-submissions` bucket превышает 10 МБ на mobile (большие фото) | Средняя | Reuse existing `uploadStudentThreadImage` который имеет client-side size check 10 МБ. Toast при превышении. Phase 2: client-side compression до 1 МБ |
| SubmitSheet submit + AI grading занимает > 10 секунд → ученик перезагружает страницу | Средняя | Loading state с progress hint «Распознаём и проверяем…» (~5-15s ожидание). Submit invariant: state.submission остаётся в local React state до получения verdict (resilient к accidental refresh) |
| Verdict overlay показывается поверх SubmitSheet, и обе модалки конфликтуют focus-trap'ом | Средняя | VerdictOverlay рендерится **внутри** SubmitSheet z-stack (не отдельный fixed модал), управление фокусом — single context |
| Feature flag не покрыт всеми callsite'ами для редиректа (например, открытие задачи из Telegram deep link) | Низкая | В Phase 1 enable flag только через explicit SQL для известных пилотных учеников; они открывают задачи только через UI клики, не deep link. Phase 4 cutover уберёт необходимость |
| `task_kind='proof'` UI скрывает numeric input, но backend не проверяет → tutor поставил `proof` через SQL, ученик отправил через `numeric=null` | Низкая | Backend AC-5 validation: для `proof` numeric ignored, photos[] required; для `extended` numeric+photos оба required |
| Backend `handleCheckAnswer` для submission не различает обычный chat-answer и submission в `evaluateStudentAnswer` промпте | Средняя | Phase 1: synthesized answer достаточно текстуально явный («Числовой ответ: X\n${text}»), AI normally реагирует. Phase 2 spec: явный hint в промпте про submission semantics |
| **Критический баг в новом screen → ВСЕ mobile-юзера сразу страдают** (нет feature flag для SQL-toggle rollback) | Средняя | (1) Manual QA на staging до deploy — обязательная gate (TASK-11). (2) Rollback путь: `git revert <hash> && deploy-sokratai` (~3 мин). (3) Codex independent review (TASK-10) до prod deploy. (4) Phase 1 architectural simplicity (reuse handleCheckAnswer, no new grading pipeline) — снижает surface area для багов. (5) Старый GuidedHomeworkWorkspace остаётся в коде до Phase 4 — частичный rollback (на desktop) автоматический через viewport check |

### Открытые вопросы (все non-blocking для Phase 1)

| Вопрос | Кто решает | Блокирует Phase 1? |
|---|---|---|
| Какой именно visual treatment для VerdictOverlay при `partial/incorrect` (наполнение между «Правильно» и «Подсказка»)? | product (Vladimir) + design | нет, можно решить in-flight |
| После submit с фото — нужно ли показать ученику OCR-распознанный ход решения, чтобы убедиться что AI правильно прочитал? | product | нет, deferred Phase 2 |
| Cap на photos в SubmitSheet (sane limit) — 5? 10? unlimited? | product | нет, default 5 (per dual-format invariant `MAX_TASK_IMAGES`) |
| Voice recorder — auto-transcribe + добавить в `text` field или separate `voice_ref`? | product | нет, Phase 2 |
| Что если `task_kind='proof'` → ученик хочет числовой ответ всё равно (бывает в физике proof'ах)? | product | нет, Phase 1 = строго по taskKind, Phase 2 пересмотрим |

---

## 9. Implementation Tasks

> Полная нарезка → `docs/delivery/features/student-homework-problem-screen/tasks.md` (Шаг 5).

Краткий план (порядок выполнения):

1. **TASK-1: Миграция `task_kind`** (Claude Code, ~30 мин)
2. **TASK-2: Миграция `submission_payload` + extend `message_kind`** (Claude Code, ~30 мин)
3. **TASK-3: Backend `GET /student/problem/:hwId/:taskId`** (Claude Code, ~1 час)
4. **TASK-4: Backend `POST /student/problem/:hwId/:taskId/submission`** (Claude Code, ~1.5 часа — синтез answer + AI grading + message_kind=submission insert)
5. **TASK-5: Frontend hooks + types** (Claude Code, ~45 мин — `useStudentProblemTask`, `useSubmitSolution`, `studentProblemApi`, `task_kind` в типах)
6. **TASK-6: Frontend SubmitSheet с PhotoStrip + VerdictOverlay** (Claude Code, ~3 часа — самая большая task)
7. **TASK-7: Hookup HomeworkProblem.tsx — replace mock на real data** (Claude Code, ~1 час)
8. **TASK-8: Viewport-based redirect в StudentHomeworkDetail** (Claude Code, ~20 мин — только `useIsMobile()` hook)
9. **TASK-9: Documentation: CLAUDE.md rule + .claude/rules/40-homework-system.md секция** (Claude Code, ~30 мин)
10. **TASK-10: Code review pass (Codex independent session)** (Codex, ~30 мин — review против AC-1..11)
11. **TASK-11: Manual QA on staging → deploy-sokratai в прод** (Vladimir, ~1 час QA + 5 мин deploy)

**Total ETA:** ~9-10 часов работы (без QA), ~1.3 day с code review + manual QA + prod deploy.

---

## Parking Lot

- **Voice-to-text auto-fill в SubmitSheet text field** — голосовое объяснение транскрибируется через Groq Whisper (existing infra) и подмешивается в `text` поле. Revisit: после Phase 2 voice recorder.
- **Photo OCR превью «AI прочитал так:»** — после фото upload показать ученику распознанные шаги в LaTeX, чтобы он мог поправить orientation. Revisit: Phase 2 grading pipeline когда OCR станет first-class.
- **Гибрид submission в чат: `submission` message вместо primary CTA** — alternative UX где ученик прямо в чате печатает «Сдаю!» и AI открывает submit-flow inline. Revisit: после feedback от Phase 1 — может оказаться что separate SubmitSheet лучше.
- **Sticky-bottom verdict карточка вместо overlay** — после submission verdict не overlay'ом, а прокручиваемым sticky внизу чата. Revisit: A/B test после Phase 1.
- **`task_kind='proof'` UI с упрощённым PhotoStrip без numeric** — текущий design просто скрывает numeric, но для proof задач можно сделать «Загрузи фото доказательства» как primary CTA без bottom-sheet. Revisit: после tutor-side task_kind selector landed.
- **«Студенческий streak» visualization рядом со step-indicator** — show «N дней подряд решаешь» badge. Revisit: Phase 4, нужна XP/streak DB.
- **Pre-submission preview** — отдельный screen «Вот что отправляется AI» перед finalize. Revisit: если data на Phase 1 покажет высокий regret rate (ученики жалеют что отправили).

---

## Phase split (фичу нельзя сделать одной спекой)

Эта спека = **Phase 1 only**: mobile + chat + ProblemContext + SubmitSheet с reuse `handleCheckAnswer`. Phase 2/3/4 — отдельные спеки со своими scope/AC/деплоем.

**Phase 1 (this spec, ✅ landed 2026-05-09 + Phase 1.x preview QA fixes):** P0 = AC-1..AC-8, AC-11; P1 = AC-9, AC-10. Все в одном PR.

**Phase 2 (отдельная спека `student-homework-problem-grading-pipeline.md`, deferred):** real Gemini OCR + 4 verdict states (correct / no-work / step-error / unclear) + voice recorder + autosave drafts + tutor task_kind selector в TutorHomeworkCreate. Старт после feedback от Phase 1 пилота (≥7 дней stability).

**Phase 3 (plan-only spec `~/.claude/plans/toasty-weaving-meerkat.md`, ✅ landed 2026-05-12):** Tablet (769–1279) + Desktop (≥1280) split-pane. Math keyboard popover (LaTeX/Unicode templates). `AuthGuard fullBleed='below-xl'` mode для desktop global nav. Universal redirect в `StudentHomeworkDetail` (`useIsMobile()` gate удалён — все viewport'ы редиректят на новый screen). Hint ladder card в левой колонке desktop — **отложен** (отдельная спека). Hint cap **no cap** на всех viewport'ах (Phase 1 B5 invariant сохранён). 4-state verdict overlay — Phase 2 grading spec. Полный контракт в `.claude/rules/40-homework-system.md` → секция «Student Homework Problem Screen — Phase 3 split layouts (2026-05-12)».

**Phase 4 cutover (отдельная спека `student-homework-problem-cutover.md`, partially landed):** Phase 3 уже включил universal redirect (часть scope Phase 4 landed раньше). Осталось: физически удалить `GuidedHomeworkWorkspace.tsx`, `GuidedChatInput.tsx`, `TaskStepper.tsx` (после Phase 3 stable ≥7 дней) + grep tutor-side `GuidedThreadViewer` callsite'ы, если есть пересечения.

---

## Anti-scope-creep

После approval этой спеки:
- Любой новый requirement = новый PR с новой спекой / фазой
- «Ещё бы добавить voice до submission» → backlog → Phase 2
- «Что если родитель смотрит» → backlog → отдельный родитель-side spec
- Hotfix только для blocker'ов которые делают Phase 1 непригодной для пилота

---

## Checklist перед approve

- [x] Section 0 Job Context заполнена
- [x] AC testable (минимум 3, реальный список — 11)
- [x] P0/P1 распределены (8 P0, 2 P1, AC-11 = инфра-валидация)
- [x] Scope IN/OUT/LATER чёткий
- [x] UX-принципы из doc 16 учтены (AI = draft + action, mobile-first, «ты», student/tutor isolation)
- [x] UI-паттерны из doc 17 + .claude/rules/90-design-system.md учтены (tokens, lucide, shadcn, no framer-motion, Safari/iOS guarantees)
- [x] Pilot impact описан (S1-1, S1-2, S1-3 + leading/lagging metrics)
- [x] Open Questions перечислены, ни один не блокирует Phase 1
- [x] Risks с митигациями
- [x] Phase split описан
- [x] Parking Lot для будущих идей
- [x] Anti-scope-creep правило зафиксировано
- [x] Implementation Tasks краткий план (полный — в tasks.md)
- [x] High-risk файлы (AuthGuard, Chat.tsx, etc.) НЕ затрагиваются
- [x] Student/Tutor изоляция: новый screen — student-only, не импортирует tutor компоненты
