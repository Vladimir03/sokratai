# Student Homework Problem Screen — Spec

**Версия:** v0.1
**Дата:** 2026-05-09
**Автор:** Vladimir Kamchatkin (с дизайном от Claude Design)
**Статус:** draft
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

Новый mobile-first экран решения **одной** задачи внутри ДЗ для ученика. Экран совмещает две активности:

1. **Сократический диалог с AI** через чат (existing infrastructure — guided chat + Сократ AI идентичность). Каждое user-сообщение AI оценивает (`evaluateStudentAnswer`); при CORRECT задача засчитывается incremental.
2. **Single-shot сдача решения** через `<SubmitSheet>` — числовой ответ + фото решения от руки (multi-page PhotoStrip) + опциональный текст. AI проверяет synthesizing answer = numeric + text + photos через тот же `handleCheckAnswer` pipeline. Первый из двух путей закрывший задачу = winning result.

Mobile-only Phase 1, выкатывается через feature flag `profiles.feature_new_homework_chat` для пилотного подмножества учеников. Tablet (Phase 2) и Desktop (Phase 3) — отдельными спеками после feedback от Phase 1.

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

- **Coexistence через feature flag.** `profiles.feature_new_homework_chat boolean default false`. Пилот опт-ин: 5 учеников (Егор включит SQL'ом) → feedback неделю → 50 → all. Старый workspace остаётся fallback при `flag=false` ИЛИ viewport > 768px.
- **Hybrid grading «first-completed wins».** Чат incremental (`handleCheckAnswer` ставит status='completed' при CORRECT, как сейчас в GuidedHomeworkWorkspace) **И** SubmitSheet single-shot (synthesizes answer = `Числовой ответ: ${numeric}\n${text}` + photos[] как image_url, вызывает тот же `handleCheckAnswer`). После status='completed' SubmitSheet primary CTA меняется на «Следующая задача →».
- **Hint behavior — без cap'а.** Существующая %-деградация `available_score` сохраняется (per текущему backend). UI показывает «Подсказок: N» без 3-cap. **Не** реализуем round-numbers версию из дизайна.
- **`task_kind` enum миграция.** Новая колонка `homework_tutor_tasks.task_kind enum('numeric'|'extended'|'proof')` с backfill от `check_format`: `short_answer→numeric`, `detailed_solution→extended`. `proof` — manual mark тутором (Phase 2 tutor UI).
- **Submission storage — расширяем thread_messages.** Не создаём новую таблицу. Добавляем `message_kind='submission'` enum value + `submission_payload JSONB` колонку в `homework_tutor_thread_messages`. Reuse RLS, image_url infrastructure, чат-поток показывает submission как специальный bubble.
- **AI grading — reuse `evaluateStudentAnswer`** для submissions в Phase 1. Photo OCR + 4 verdict states (`no-work` / `step-error` / `unclear`) — Phase 2, отдельная спека про grading pipeline.
- **Отдельный `ProblemChatMessage` от `GuidedChatMessage`.** Pixel-perfect от дизайна (kicker «СОКРАТ» uppercase, bubble border-1 light, max-w 86%). Существующий `GuidedChatMessage` (production-flow для tutor viewer) не трогается.
- **Mobile-first feature-flag matching.** Frontend `StudentHomeworkDetail` при клике на задачу проверяет: если `profile.feature_new_homework_chat=true` И viewport<=768px → navigate(`/student/homework/:hwId/problem/:taskId`). Иначе → existing GuidedHomeworkWorkspace inline (как сейчас).

### Scope

**In scope (Phase 1):**

- Mobile layout (≤768px)
- Topbar + ProblemContext (peek/expanded) + ChatThread + ComposerMobile + SubmitSheet
- SubmitSheet с PhotoStrip (camera+gallery, multi-page), numeric input + unit, optional text, **submit button с реальным backend** (через `handleCheckAnswer` synthesis)
- Verdict overlay 3 состояния: `correct` (зелёная карточка с XP/streak), `incorrect-with-hint` (используем CORRECT/INCORRECT/ON_TRACK маппинг), `error` (network/AI fallback)
- Migrations: `task_kind`, `feature_new_homework_chat`, `submission_payload + message_kind extend`
- Backend: новые endpoints `GET /student/problem/:hwId/:taskId`, `POST /student/problem/:hwId/:taskId/submission`
- Frontend hooks: `useStudentProblemTask`, `useSubmitSolution`, реальные React Query keys
- Feature flag wrapper в `StudentHomeworkDetail`
- Hint behavior (existing % degradation + UI counter)
- `GET /problem/:taskId` возвращает meta: assignment.title, subject, task_no, task_total, task_score, task_score_max, task_kind, given (parsed из task_text при наличии), thread, hints used count
- AI Сократ identity в bubbles (reuse brand `sokrat-chat-icon.png`)
- Telemetry: `student_problem_screen_opened`, `student_submitsheet_opened`, `student_submission_sent`, `student_submission_verdict`

**Out of scope (deferred):**

- Voice recorder в SubmitSheet → Phase 2
- Autosave (PATCH/GET draft-submission) → Phase 2
- 4-step grading pipeline с Gemini OCR (no-work / step-error / unclear) → Phase 2 separate spec
- Tablet (Layout 2) + Desktop (Layout 3) → Phase 3 (`student-homework-problem-screen-multi-device.md`)
- Tutor UI — task_kind selector в TutorHomeworkCreate → Phase 2
- Hint cap = 3 (per UX answer — keeping no cap)
- Hint-ladder UI блок (только desktop, Phase 3)
- Math-keyboard «Σ Формула» (только desktop, Phase 3)
- IndexedDB offline → P2 follow-up
- A/B test new vs old guided chat → P2 (только после Phase 1 stable)

**Later (Phase 2/3):**

- Phase 2 backend grading pipeline: Gemini 3 Flash OCR + verdict states
- Phase 2 voice + autosave
- Phase 3 tablet/desktop split layouts (`student-problem-chat-multi-device.md`)
- Phase 4 cutover: удалить `feature_new_homework_chat` flag, redirect `/homework/:id` → новый screen, удалить `GuidedHomeworkWorkspace`

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

> **Когда** я смотрю результаты ДЗ ученика на пилоте feature flag, **я хочу** что бы submission через SubmitSheet попадал в `homework_tutor_thread_messages` как специальное сообщение `message_kind='submission'`, **чтобы** видеть его в `GuidedThreadViewer` рядом с обычными ответами, без новой UI-поверхности.

### Родитель (indirect)

> **Когда** мой ребёнок сдал задачу через SubmitSheet (фото от руки), **я хочу** получить push «Артём решил задачу 3 из 9», **чтобы** видеть прогресс. *(Phase 4 — отдельный scope)*

---

## 5. Technical Design

### Затрагиваемые файлы

**Migrations (3):**
- `supabase/migrations/20260509120000_add_task_kind_to_homework_tasks.sql` — добавить колонку + backfill
- `supabase/migrations/20260509120100_add_feature_new_homework_chat_flag.sql` — `profiles.feature_new_homework_chat boolean default false`
- `supabase/migrations/20260509120200_add_submission_payload_to_thread_messages.sql` — `submission_payload JSONB nullable` + extend `message_kind` enum с `'submission'`

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
- Modified: `src/pages/StudentHomeworkDetail.tsx` — feature flag wrapper в onClick handler задачи (redirect on mobile + flag=true)
- Modified: `src/types/homework.ts` — `task_kind` field в `StudentHomeworkTask`
- Modified: `src/lib/studentHomeworkApi.ts` — extend SELECT для `task_kind`

**Docs:**
- `docs/delivery/features/student-homework-problem-screen/spec.md` (этот файл)
- `docs/delivery/features/student-homework-problem-screen/tasks.md` (Step 5)
- `.claude/rules/40-homework-system.md` — добавить секцию «Student Homework Problem Screen — feature flag + submission contract»
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

**`profiles`:**
```sql
ALTER TABLE profiles
  ADD COLUMN feature_new_homework_chat boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN profiles.feature_new_homework_chat IS
  'Pilot feature flag for new mobile-first homework problem screen. Phase 1 default off; tutor manually opts students in via SQL.';
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
20260509120100  add_feature_new_homework_chat_flag
20260509120200  add_submission_payload_to_thread_messages
```

Все 3 — additive, idempotent (`IF NOT EXISTS` где можно), backward-compatible. Старый GuidedHomeworkWorkspace продолжает работать без изменений.

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

- **AC-1 (P0):** Миграции `20260509120000`, `20260509120100`, `20260509120200` применяются на staging без ошибок. После применения: 100% существующих `homework_tutor_tasks` имеют `task_kind` (через backfill `short_answer→numeric, detailed_solution→extended`). Все существующие профили имеют `feature_new_homework_chat = false`.
- **AC-2 (P0):** При `profile.feature_new_homework_chat=true` И viewport `<= 768px` И клике на задачу в `StudentHomeworkDetail` → navigate на `/student/homework/:hwId/problem/:taskId`. При `flag=false` ИЛИ viewport > 768px → existing inline GuidedHomeworkWorkspace без изменений (regression test).
- **AC-3 (P0):** Endpoint `GET /student/problem/:hwId/:taskId` возвращает 200 OK для assigned student с правильным shape (см. §5 API). Возвращает 403 для не-assigned student. Возвращает 404 если task не существует. Не leak'ает tutor-only поля (`solution_text`, `rubric_*`) — проверяется на staging через response body grep.
- **AC-4 (P0):** На route `/student/homework/:hwId/problem/:taskId`:
  - Topbar показывает «ЗАДАЧА N/M · {subject}» eyebrow + ДЗ title
  - ProblemContext по умолчанию **expanded** если thread пустой (`messages.length === 0`), **collapsed** если есть сообщения. Step-indicator корректен (done = task_states.status='completed' среди других задач, current = эта задача).
  - ChatThread рендерит system divider + AI bubbles (Сократ avatar + kicker «СОКРАТ») + user bubbles (справа, серым). Задача с пустым thread → только system divider, ученик начинает диалог.
  - ComposerMobile primary CTA «Сдать решение задачи» → открывает SubmitSheet
- **AC-5 (P0):** SubmitSheet:
  - Numeric input принимает запятую и точку («1,4» и «1.4» — обе валидны), unit suffix из task data
  - PhotoStrip: 1 + N тайлов 96×124 px, click → native `<input type="file" accept="image/*" capture="environment" multiple>`. После выбора → upload через existing `uploadStudentThreadImage` → ref в `photos[]`. Удаление через ✕ кнопку
  - Submit button **disabled** пока не выполнены `task_kind`-specific требования (see §5 POST submission)
  - При submit → POST с `{numeric, photos, text}` → backend grading → response → VerdictOverlay
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
- **AC-11 (P0):** `npm run lint && npm run build && npm run smoke-check` — все три зелёные. Lint baseline +0 на затронутых файлах.

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

Manual QA на staging:
1. Включить flag для тест-ученика: `UPDATE profiles SET feature_new_homework_chat=true WHERE id='<test_user_id>'`
2. Открыть `/homework/<existing_assignment_id>` на iPhone (DevTools mobile mode 375×667)
3. Кликнуть на задачу → ожидание: redirect на `/student/homework/.../problem/...`
4. Verify все AC-4 elements присутствуют
5. Открыть SubmitSheet → ввести numeric + добавить 1 фото → submit → ожидание verdict overlay
6. Кликнуть «Следующая задача» → navigate на следующую (или backlist если последняя)
7. Открыть на desktop (>768px) → ожидание: feature flag bypass, GuidedHomeworkWorkspace inline (regression)

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
2. **TASK-2: Миграция `feature_new_homework_chat` flag** (Claude Code, ~15 мин)
3. **TASK-3: Миграция `submission_payload` + extend `message_kind`** (Claude Code, ~30 мин)
4. **TASK-4: Backend `GET /student/problem/:hwId/:taskId`** (Claude Code, ~1 час)
5. **TASK-5: Backend `POST /student/problem/:hwId/:taskId/submission`** (Claude Code, ~1.5 часа — синтез answer + AI grading + message_kind=submission insert)
6. **TASK-6: Frontend hooks + types** (Claude Code, ~45 мин — `useStudentProblemTask`, `useSubmitSolution`, `studentProblemApi`, `task_kind` в типах)
7. **TASK-7: Frontend SubmitSheet с PhotoStrip + VerdictOverlay** (Claude Code, ~3 часа — самая большая task)
8. **TASK-8: Hookup HomeworkProblem.tsx — replace mock на real data** (Claude Code, ~1 час)
9. **TASK-9: Feature flag wrapper в StudentHomeworkDetail** (Claude Code, ~30 мин)
10. **TASK-10: Documentation: CLAUDE.md rule + .claude/rules/40-homework-system.md секция** (Claude Code, ~30 мин)
11. **TASK-11: Code review pass (Codex independent session)** (Codex, ~30 мин — review против AC-1..11)
12. **TASK-12: Manual QA on staging + enable flag для 5 пилотных учеников** (Vladimir, ~1 час)

**Total ETA:** ~10-11 часов работы (без QA), ~1.5 day с code review + manual QA.

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

Эта спека = **Phase 1 only**: mobile + chat + ProblemContext + SubmitSheet с reuse `handleCheckAnswer`. Phase 2/3 — отдельные спеки со своими scope/AC/деплоем.

**Phase 1 (this spec):** P0 = AC-1..AC-8, AC-11; P1 = AC-9, AC-10. Все в одном PR. ETA 1.5-2 дня.

**Phase 2 (отдельная спека `student-homework-problem-grading-pipeline.md`):** real Gemini OCR + 4 verdict states (correct / no-work / step-error / unclear) + voice recorder + autosave drafts + tutor task_kind selector в TutorHomeworkCreate. Старт после feedback от Phase 1 пилота (≥7 дней stability).

**Phase 3 (отдельная спека `student-homework-problem-multi-device.md`):** Tablet (Layout 2) + Desktop (Layout 3) с split-pane. Hint ladder UI блок. Math-keyboard в composer. Старт после Phase 2 stable.

**Phase 4 cutover (отдельная спека `student-homework-problem-cutover.md`):** удалить `feature_new_homework_chat` flag, redirect `/homework/:id` → новый screen, удалить `GuidedHomeworkWorkspace.tsx` + связанные mock fixtures. Старт после ≥80% positive pilot signals.

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
