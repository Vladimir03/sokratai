# Phase 3 handoff: tablet + desktop split layouts

**Дата:** 2026-05-11
**Цель новой сессии:** реализовать **tablet (834×1100) + desktop (1280×860)** layouts для `/student/homework/:hwId/problem/:taskId`. Mobile (≤768px) уже live в production.
**Дизайн ref:** `docs/design_handoff_homework_chat/README.md` + три mock-screenshot'а (Mobile / Tablet / Desktop) — пользователь покажет, или см. `*.jsx`/screenshots в той же папке.

---

## Что делать в новой сессии

### Бутстрап (1-я команда)

Скажи Claude в новой сессии:

> Прочитай эти файлы перед началом работы — это handoff для Phase 3 (tablet + desktop layouts) homework problem screen:
> 1. `docs/delivery/features/student-homework-problem-screen/PHASE-3-HANDOFF.md` ← главный документ
> 2. `docs/delivery/features/student-homework-problem-screen/spec.md` — общая спека Phase 1 (mobile) + AC-1..AC-15 как baseline для Phase 3
> 3. `.claude/rules/40-homework-system.md` — раздел «Student Homework Problem Screen — single-task surface + submission contract» + раздел «viewport routing + submission contract»
> 4. `docs/design_handoff_homework_chat/README.md` — дизайн-handoff
> 5. `src/pages/student/HomeworkProblem.tsx` — текущий mobile screen (полностью функционален, не ломать)
>
> После чтения — сначала Plan mode → design split layout с точками breakpoint и переиспользованием существующих subcomponents. **Не** реализовывать новый composer / submission flow — реюз mobile.

---

## Phase 1 status (DONE, production)

### Что работает на mobile (≤768px)
- `/homework/:id` на mobile → `StudentHomeworkDetail` auto-redirect на `/student/homework/:hwId/problem/:taskId` с smart fallback (current_task_id → first not-completed → tasks[0])
- `HomeworkProblem` единый screen: топбар + `ProblemContext` (peek/expanded) + chat thread + composer
- Composer branches по `task_kind`:
  - `numeric` → `NumericAnswerComposer` (inline зелёный «Ответ...» + collapsible discussion)
  - `extended` / `proof` → big-CTA «Сдать решение задачи» → `SubmitSheet` (photo+text+numeric+voice)
- Submission flow: optimistic user bubble + typing dots → backend `runStudentAnswerGrading` → AI verdict bubble в чате (НЕ overlay)
- Hint flow: 💡 → `requestHint` → hint_reply bubble + degraded available_score
- Voice: `useVoiceRecorder` + `transcribeThreadVoice` (Groq Whisper)
- Identity: `GuidedChatMessage` perspective=student с tutor_profile (avatar+name)
- Mobile viewport bug fix: `useVisualViewportHeight` hook

### Production-критичные инварианты (НЕ нарушать в Phase 3)

1. **Mobile chat = discussion only.** Backend `saveThreadMessage` инкрементит `attempts` ТОЛЬКО для `message_kind='answer'` (legacy desktop path) — все остальные kind'ы (`question`, `hint_request`, etc.) scoring-neutral. **Phase 3 tablet/desktop chat должен оставаться scoring-neutral** для consistency.
2. **Submission через SubmitSheet** = единственный путь triggering `handleStudentSubmission` (extended/proof). Для numeric — `checkAnswer` через inline answer field.
3. **`task_states.task_order` НЕ существует в DB schema** — резолвить order_num через `assignmentDetails.tasks[task_id].order_num` map. Не добавлять `task_order` в `THREAD_SELECT` subselect — это вызовет PostgREST 500 (см. Phase 1.5.1 hotfix).
4. **Anti-leak:** `handleGetStudentProblem` SELECT whitelist — никаких `solution_*`, `rubric_*`, `ai_score_comment` в response.
5. **`AI_DISPLAY_NAME = 'Сократ AI'`** ВЕЗДЕ (не «Сократ»). Уже зафиксировано в `GuidedChatMessage` + inline typing dots.

---

## Phase 3 scope

### Из дизайн-handoff (3 form factors на одном screenshot'е)

**Tablet (834×1100):**
- Slim sidebar слева с условием задачи (StepIndicator + scrollable «Дано / Найти» + body + warn banner)
- Чат справа (≈55% ширины) с composer внизу
- Footer сверху-снизу: «Готов сдать решение?» + большая зелёная кнопка «Сдать решение задачи» (открывает SubmitSheet)

**Desktop (1280×860):**
- Top nav «Сократ AI / Домашка / Пробники / Чат / Тренажёр / Прогресс / Профиль» + user avatar
- Two-pane: задача слева (≈40%) с тем же ProblemContext, чат справа с composer + side actions chip-bar («Подсказки 1/3», «Σ Формула», «Не понял»)
- Right side actions:
  - Подсказки счётчик
  - Σ Формула (math-keyboard для desktop)
  - «Не понял» quick action
  - Большая «Сдать решение» кнопка справа сверху

**Mobile (≤768):** **уже сделано, не трогать**.

### Что переиспользовать

| Subcomponent | Reuse as-is? |
|---|---|
| `ProblemContext` | ✅ Yes — добавить `desktop` / `tablet` variant prop если нужно сменить spacing |
| `StepIndicator` | ✅ Yes — already clickable |
| `TaskImagesGallery` | ✅ Yes |
| `NumericAnswerComposer` | ⚠️ Адаптировать — на tablet/desktop discussion может быть always-visible (см. mockup), не collapsible |
| `SubmitSheet` | ⚠️ На desktop sheet может быть modal (centered card) вместо bottom-sheet; на tablet — bottom-sheet OK |
| `GuidedChatMessage` | ✅ Yes — perspective='student' |
| `TypingDots` | ✅ Yes |
| `useVisualViewportHeight` | ⚠️ Mobile-only сейчас. На desktop нужна `100vh` или fixed height — пересмотреть |
| `useSubmitSolution`, `requestHint`, `streamChat` | ✅ Yes |

### Что добавить

1. **Viewport breakpoints**
   - Сейчас только `useIsMobile()` ≤768. Нужны:
     - mobile: ≤768 (existing)
     - tablet: 769–1199
     - desktop: ≥1200
   - Решить: один компонент `HomeworkProblem` с conditional layout OR три отдельных компонента `MobileHomeworkProblem` / `TabletHomeworkProblem` / `DesktopHomeworkProblem`?
   - Recommend: один компонент с layout branches через CSS grid + responsive Tailwind (`md:` / `lg:` / `xl:`) для минимума разделения.

2. **Routing**
   - `StudentHomeworkDetail` сейчас редиректит ТОЛЬКО на mobile. На tablet/desktop остаётся inline `GuidedHomeworkWorkspace` (legacy).
   - В Phase 3: tablet+desktop тоже редиректят на новый `/student/homework/:hwId/problem/:taskId` screen.
   - **Большое решение**: Phase 4 cutover (отдельная spec) удалит `GuidedHomeworkWorkspace` совсем. Phase 3 НЕ удаляет — параллельный pивoт.

3. **Composer adaptation**
   - **Tablet/Desktop chat row** — может быть высота больше, hint+mic не нужно прятать (всё видно)
   - **Desktop side actions bar** — chip-bar справа («Подсказки 1/3», «Формула», «Не понял», large «Сдать решение» button)
   - **Discussion НЕ collapsible на tablet/desktop** (по мокапу — sing input всегда видим)

4. **Math keyboard «Σ Формула»** — Phase 3 desktop only:
   - Toggle button → opens math symbol picker
   - User taps LaTeX templates → inserts into answer / discussion input
   - Out-of-scope для tablet (per design — на desktop bar)

5. **Hint ladder UI block** — desktop only (per design):
   - Visible expandable «Подсказки» card в side panel с numbered hints (1/3, 2/3, 3/3)
   - Mobile: остаётся compact 💡 button

---

## Открытые вопросы для нового агента (обсудить с Vladimir)

### Q1: Один компонент или три?
- **(a) Один `HomeworkProblem` с CSS grid responsive layout** — меньше code duplication, всё в одном файле
- **(b) Три компонента** + routing wrapper — чище separation, но N×N maintenance
- **Default recommend: (a)** — единый `HomeworkProblem` с media query branches.

### Q2: Hint cap = 3 для desktop?
- Дизайн показывает «Подсказки 1/3» — это **cap'ed counter**
- Mobile решение Phase 1: **no cap** (existing %-degradation)
- Phase 3 product решение: ввести hint cap для UI consistency (3 max) на ВСЕХ form factors?
- Или: cap UI на desktop visual только, без backend change (показывать `min(hint_count, 3) / 3` визуально)?

### Q3: Math keyboard scope
- Только desktop? Или tablet тоже?
- Какой набор LaTeX templates? (`\frac`, `\sqrt`, `^2`, греческие, и т.д.)
- Существующий компонент в репо? (поискать `math-keyboard` / `formula-picker`)

### Q4: «Не понял» quick action
- На дизайне — chip-button в side bar desktop
- Action: вставляет фразу «Не понял, объясни подробнее» в discussion и отправляет? Или открывает predefined hint?

### Q5: SubmitSheet vs SubmitDialog для desktop
- Mobile: bottom-sheet (slide-up)
- Desktop: centered modal или сохранить bottom-sheet pattern?

### Q6: Phase 4 cutover включён?
- Сейчас на tablet/desktop редирект НЕ срабатывает — старый `GuidedHomeworkWorkspace` показывается inline
- В Phase 3: вкл редирект для tablet+desktop, или оставить parallel pivot?

---

## Ключевые файлы (must-read для нового агента)

### Frontend Phase 1 (production)
```
src/pages/student/HomeworkProblem.tsx          (main screen, 1300+ lines)
src/pages/StudentHomeworkDetail.tsx            (routing logic)
src/components/student/homework-problem/
├── NumericAnswerComposer.tsx
├── SubmitSheet.tsx
├── ProblemContext.tsx
├── StepIndicator.tsx
├── TaskImagesGallery.tsx
├── PhotoStrip.tsx
├── TypingDots.tsx
└── submitSheetInternal.ts                     (autosave draft helpers)
src/components/homework/GuidedChatMessage.tsx  (chat bubble — both perspectives)
src/components/AuthGuard.tsx                   (fullBleed prop, suppress modal)
src/hooks/useIsMobile.ts                       (≤768 breakpoint)
src/hooks/useVisualViewportHeight.ts           (mobile keyboard fix)
src/hooks/useStudentProblemTask.ts             (React Query)
src/hooks/useSubmitSolution.ts                 (mutation)
src/lib/studentProblemApi.ts                   (API client)
src/lib/studentHomeworkApi.ts                  (existing helpers — checkAnswer, requestHint, etc.)
src/lib/streamChat.ts                          (/chat endpoint)
```

### Legacy desktop (reference, parallel)
```
src/components/homework/GuidedHomeworkWorkspace.tsx (legacy desktop full chat)
src/components/homework/GuidedChatInput.tsx        (legacy answer+discussion fields)
src/components/homework/TaskStepper.tsx
```

### Backend (no changes expected for Phase 3)
```
supabase/functions/homework-api/index.ts
├── handleGetStudentProblem    (~5495)
├── handleStudentSubmission    (~6744)
├── handleCheckAnswer          (legacy)
├── handleRequestHint          (legacy)
├── runStudentAnswerGrading    (shared helper)
└── THREAD_SELECT constant     (~5949)
```

### Docs (must-read)
```
docs/delivery/features/student-homework-problem-screen/
├── spec.md                              (canonical, v0.3 implemented)
├── tasks.md                             (Phase 1 tasks, completed)
├── codex-review.md                      (Phase 1.0 review)
├── codex-review-phase-1x.md             (Phase 1.x review)
├── codex-review-mobile-chat.md          (Phase 1.4 review)
└── PHASE-3-HANDOFF.md                   ← этот файл
.claude/rules/40-homework-system.md      (особенно «Student Homework Problem Screen» секции)
.claude/rules/90-design-system.md        (waivers для emerald/amber/rose status colors + Radix Dialog для SubmitSheet)
.claude/rules/performance.md             (React Query keys, no framer-motion)
docs/design_handoff_homework_chat/       (дизайн-handoff)
```

---

## Product decisions history (для consistency)

Эти решения уже зафиксированы Vladimir'ом в Phase 1 — Phase 3 должна их соблюдать:

| Decision | Source | Value |
|---|---|---|
| Hint button location | B1 (preview-QA Phase 1.1) | Mobile: expandable group; **Tablet/Desktop: standalone в side bar** (дизайн) |
| Hint counter | B3 | Visible только при `hint_count > 0`, amber chip с Lightbulb |
| Hint cap | B5 | **No cap** на mobile. Phase 3: пересмотреть для desktop UI «1/3» |
| Score chip | B2 | Hybrid: `active → available_score` (live), `completed → earned_score` (emerald, frozen) |
| AI identity | preview-QA | «Сократ AI» (НЕ «Сократ») везде |
| Numeric task UI | Q3 (preview-QA Phase 1.3) | Inline NumericAnswerComposer (НЕ SubmitSheet) |
| Extended task UI | Q4 (preview-QA Phase 1.4) | SubmitSheet — photo OR text (numeric optional) |
| Proof task UI | Q1 (preview-QA Phase 1.5) | photo OR text (как extended без numeric) |
| Voice input | Q5 (preview-QA Phase 1.1) | Speech-to-text helper → append в text field |
| Autosave | Q12 (preview-QA Phase 1.1) | localStorage `submitsheet-draft-<taskId>` every 5s + restore on open + clear on CORRECT |
| Submission UX | preview-QA #6 (Phase 1.2) | Submission лендится в чат как bubble (НЕ overlay); SubmitSheet закрывается мгновенно |
| Back arrow target | preview-QA #3 | `/homework` (НЕ `/student/homework` — route не существует) |
| Mobile composer chat-row | preview-QA #1 (B1) | scoring-neutral discussion only |

---

## Verification checklist для Phase 3

После реализации tablet/desktop layouts:

1. **Tablet (834×1100)**:
   - Split layout: задача слева (~40%), чат справа (~60%)
   - StepIndicator + ProblemContext + photo gallery в левой колонке
   - Chat + composer в правой
   - Numeric: inline answer field над composer (как mobile)
   - Extended: big CTA внизу
   - Submission flow тот же что mobile

2. **Desktop (≥1200px)**:
   - Top global nav `<Navigation />` ВКЛ (AuthGuard БЕЗ fullBleed)
   - Two-pane split: задача слева (~35%), чат справа (~50%), side actions (~15%)
   - Side actions chip-bar: «Подсказки», «Σ Формула», «Не понял», «Сдать решение»
   - Math keyboard pop-up при click «Σ Формула»
   - Hint ladder card в side panel

3. **Mobile (≤768px) regression**:
   - Текущее поведение НЕ ломается
   - Composer branches working
   - Submit flow working

4. **All viewports**:
   - Discussion scoring-neutral (attempts только для answer)
   - Tutor видит ту же thread через `GuidedThreadViewer`
   - Identity rendering: tutor name+avatar, «Сократ AI» kicker

5. **CI**:
   - `npm run build` ✓
   - `npx eslint <touched>` 0 errors
   - `npm run smoke-check` ✓

---

## Phase 4 cutover (отдельная spec, после Phase 3 stable)

Удалить `GuidedHomeworkWorkspace.tsx`. Все viewport'ы используют новый screen. `useIsMobile` viewport gate удалить — universal redirect.

---

## Контакт

Vladimir Kamchatkin (`volodyakamchatkin@gmail.com`) — product owner. Все scope decisions через AskUserQuestion в plan mode.
