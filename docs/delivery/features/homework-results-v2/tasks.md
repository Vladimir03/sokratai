# Tasks — Homework Results v2

Реализационные задачи для `spec.md` (`docs/delivery/features/homework-results-v2/spec.md`).

Каждая задача:
- привязана к **AC** из спеки;
- закреплена за конкретным агентом (Claude Code или Codex);
- содержит ссылки на канонические доки;
- имеет полный промпт для запуска агента в конце файла («Copy-paste промпты для агентов»).

Code review для **каждой** задачи проводит **Codex** независимо, без контекста автора (см. финальный промпт ревьюера).

---

## Phase 1 — Backend foundation (Неделя 1)

### TASK-1 — Миграция: `ai_score` / `tutor_score_override` в `homework_tutor_task_states`

- **Job:** R1-2 «Понять, что усвоено»; R4-1 «Скорректировать оценку».
- **AC:** AC-8 (backfill без downtime), частично AC-5 (колонки существуют для записи override).
- **Agent:** Claude Code.
- **Files:**
  - `supabase/migrations/20260408120000_add_scores_to_homework_tutor_task_states.sql` (новый)
  - `supabase/migrations/20260408120100_backfill_homework_tutor_task_states_scores.sql` (новый)
- **Что делаем:** добавляем nullable колонки `ai_score numeric(5,2)`, `ai_score_comment text`, `tutor_score_override numeric(5,2)`, `tutor_score_override_comment text`, `tutor_score_override_at timestamptz`, `tutor_score_override_by uuid references auth.users(id)`. Backfill: для всех существующих task_states со `status = 'completed'` и связанной задачей `homework_tutor_tasks` ставим `ai_score = max_score` если последний verdict был `CORRECT`, иначе `0`.
- **Guardrails:** additive only, нет DROP/RENAME, нет изменения existing nullable/default, RLS не трогаем. Backfill идемпотентен (`WHERE ai_score IS NULL`).
- **Validation:** `npm run lint && npm run build && npm run smoke-check`. Дополнительно — dry-run на staging-снапшоте.

### TASK-2 — Расширение `evaluateStudentAnswer` в `guided_ai.ts`

- **Job:** R2 «AI проверил так, как проверил бы я».
- **AC:** AC-9.
- **Agent:** Claude Code.
- **Files:**
  - `supabase/functions/homework-api/guided_ai.ts` — `evaluateStudentAnswer`, `EvaluateStudentAnswerParams`, system prompt
  - `supabase/functions/homework-api/index.ts` — `handleCheckAnswer`: запись `ai_score` / `ai_score_comment` в `homework_tutor_task_states`
- **Что делаем:** добавляем в возврат `evaluateStudentAnswer` поля `ai_score: number` и `ai_score_comment: string`. Для `check_format='short_answer'` — бинарно (`0` или `max_score`). Для `check_format='detailed_solution'` — целое или `0.5`-step значение в `[0..max_score]` + короткий комментарий «почему не максимум». Промпт явно ссылается на ФИПИ-критерии. `handleCheckAnswer` пишет результат в новые колонки task_states (overrides не трогаем).
- **Guardrails:**
  - Не менять контракт `verdict` (`CORRECT` / `PARTIAL` / `INCORRECT`).
  - `tryDeterministicShortAnswerMatch` для short_answer возвращает `ai_score = max_score` при CORRECT, `0` при INCORRECT — без вызова AI.
  - Hints + время **НЕ влияют** на `ai_score` (см. spec, Q2 resolution).
  - Не трогать `task_image_url` / signed URL pipeline.
- **Validation:** `npm run lint && npm run build && npm run smoke-check` + ручной прогон 3 ДЗ (short_answer × 1, detailed_solution × 1, mixed × 1) на staging.

---

## Phase 2 — UI + Telemetry (Недели 2–4)

### TASK-3 — Шапка-сводка результатов

- **Job:** R1-2.
- **AC:** AC-1.
- **Agent:** Claude Code.
- **Files:**
  - `src/pages/tutor/TutorHomeworkResults.tsx` — рефакторинг шапки
  - (опц.) `src/components/tutor/results/ResultsHeader.tsx` — выделить компонент, если файл `TutorHomeworkResults.tsx` уже большой
- **Что делаем:** в верхней части страницы рендерим карточку: название ДЗ, дедлайн (с urgency-badge), сводка `сдали N / всего M`, средний балл по ДЗ (`AVG(final_score / max_score)`), число «не приступал», число «требует внимания» (`hint overuse OR final_score < 0.3 * max_score`). Всё в один scroll-screen на десктопе (≤ ~280px высоты).
- **Guardrails:** Golos Text, токены `bg-accent`/`text-slate-*`, никаких emoji, никаких card-in-card, никакого `framer-motion`. На мобиле — 2 строки (название + метрики), без потери цифр.
- **Validation:** `npm run lint && npm run build && npm run smoke-check`. Manual Safari/iOS smoke на iPhone.

### TASK-4 — Action block: hint overuse chip + Telegram preset Dialog + email fallback

- **Job:** R3 «Дотянуть отстающего».
- **AC:** AC-6, AC-7, частично AC-2 (chip rendering).
- **Agent:** Claude Code.
- **Files:**
  - `src/pages/tutor/TutorHomeworkResults.tsx`
  - `src/components/tutor/results/RemindStudentDialog.tsx` (новый)
  - `src/lib/homeworkTelemetry.ts` — добавить событие `telegram_reminder_sent_from_results`
- **Что делаем:** константа `HINT_OVERUSE_THRESHOLD = Math.ceil(tasks.length * 0.6)`. Для каждого ученика-«не приступал» рендерим danger-пункт + кнопка «Напомнить». Кнопка открывает Radix Dialog с preset-message в editable `<textarea>` и кнопкой «Отправить». При наличии Telegram-ссылки → `sendTutorTelegramMessage` (или существующий API). Без Telegram → email через `_shared/email-sender.ts`. После успеха — toast + `homeworkTelemetry.track('telegram_reminder_sent_from_results', { assignmentId, studentId, kind })`. Учеников с `hints_used >= HINT_OVERUSE_THRESHOLD` помечаем chip «много подсказок» (`bg-amber-100 text-amber-900`).
- **Guardrails:**
  - НЕ fire-and-forget — без подтверждения юзера сообщение не уходит.
  - Preset-сообщение нейтральное, без давления.
  - Email-fallback обязателен (никогда не «нет канала»).
  - В payload telemetry **никаких** имён/email/текста сообщения.
- **Validation:** lint+build+smoke. Manual: 1 ученик с TG, 1 без TG (только email), 1 ученик с hint overuse.

### TASK-5 — Хитмап с цифрами и порогами цвета ✅ DONE (2026-04-07)

- **Job:** R1-2.
- **AC:** AC-2.
- **Agent:** Claude Code.
- **Files (фактические):**
  - `src/components/tutor/results/HeatmapGrid.tsx` (новый, ~340 строк)
  - `src/pages/tutor/TutorHomeworkDetail.tsx` (интеграция; **не** `TutorHomeworkResults.tsx` — удалён 2026-04-07)
  - `supabase/functions/homework-api/index.ts` — `handleGetResults` extension (per_student.task_scores)
  - `src/lib/tutorHomeworkApi.ts` — `TutorHomeworkResultsPerStudent.task_scores` тип
- **Что сделано:** табличный хитмап `students × tasks` заменил локальный `StudentsList`. Backend `handleGetResults` расширен полем `per_student[*].task_scores: { task_id; final_score; hint_count }[]` (использует существующий `computeFinalScore`). Цвет клетки по `final_score / max_score`:
  - `null` (нет в массиве `task_scores`) → `bg-slate-100 text-slate-400`, текст «—»
  - `< 0.3` → `bg-red-100 text-red-900`
  - `0.3..0.8` → `bg-amber-100 text-amber-900`
  - `>= 0.8` → `bg-emerald-100 text-emerald-900`
  Клик по строке → отдельная Card «Разбор ученика» под Materials с `GuidedThreadViewer`. Только один ученик раскрыт за раз. Cell-click → no-op (TASK-6).
- **Layout (iOS Safari critical):**
  - `<table>`: `border-separate border-spacing-0` (НЕ `border-collapse` — ломает sticky на iOS) + `<colgroup>` с `220px` + `56px×N` + `tableLayout: 'fixed'` + `width: 'max-content'`
  - Wrapping `<div>`: `overflow-x-auto touch-pan-x` (`touch-pan-x` обязателен — иначе row onClick съедает touchstart)
  - `React.memo` на `HeatmapRow` и `HeatmapCell`. `EMPTY_TASK_SCORES_MAP` shared module-scope
  - Локальный `DeliveryBadge` (раньше в Detail) переехал внутрь HeatmapGrid
- **Guardrails (соблюдены):**
  - Без `framer-motion`, только CSS `transition-colors`
  - Без emoji в клетках, Lucide `ChevronUp`/`ChevronDown`
  - `text-sm` (14px) в клетках — не input, iOS auto-zoom не сработает
  - `md:` breakpoint, не `sm:` (в текущем виде breakpoints не нужны вообще)
- **Validation:** ✅ `npm run lint` (194 errors / 31 warnings = baseline, +0), ✅ `npm run build` (17.94s), ✅ `npm run smoke-check`. Mobile horizontal scroll подтверждён программно (`scrollWidth 388 > clientWidth 342` на 375px viewport, scrollLeft работает) и визуально через preview (sticky колонка УЧЕНИК остаётся при scrollLeft, видимые задачи меняются с №1/№2 на №2/№3).
- **Bugfix follow-up:** initial implementation использовал `border-collapse` + `w-full` → на мобильном Safari горизонтальный скролл не работал, sticky-колонка ломалась. Фикс: `border-separate` + `<colgroup>` + `width: max-content` + `touch-pan-x`. Подробности в `.claude/rules/80-cross-browser.md` (новые правила про table sticky и table layout) и `.claude/rules/40-homework-system.md` (секция HeatmapGrid).

### TASK-6 — Drill-down: мини-карточки задач + reuse `GuidedThreadViewer` ✅ DONE (2026-04-07)

- **Job:** R1-2, R3.
- **AC:** AC-3, AC-4.
- **Agent:** Claude Code.
- **Files (фактические):**
  - `src/components/tutor/results/heatmapStyles.ts` (новый — `getCellStyle`, `formatScore` вынесены из HeatmapGrid во избежание react-refresh warning)
  - `src/components/tutor/results/TaskMiniCard.tsx` (новый — `React.memo`, ring selected, Lightbulb hint icon)
  - `src/components/tutor/results/StudentDrillDown.tsx` (новый — scroll row + GuidedThreadViewer с `key` remount)
  - `src/components/tutor/GuidedThreadViewer.tsx` (additive: `initialTaskFilter` + `hideTaskFilter` props)
  - `src/components/tutor/results/HeatmapGrid.tsx` (cell click + `onCellClick` + `selectedTaskId` props)
  - `src/pages/tutor/TutorHomeworkDetail.tsx` (drillDownTaskId state, handleCellClick, telemetry)
  - `src/lib/homeworkTelemetry.ts` (добавлен `'drill_down_expanded'`)
- **Что сделано:** клик по строке → `StudentDrillDown` раскрывается в Card «Разбор ученика» под Materials. Горизонтальный ряд `TaskMiniCard` (все задачи + «Все задачи»). Клик по мини-карточке → `key` меняется → viewer ремоунтится (сбрасывает E8/E9/scroll). `hideTaskFilter={true}` скрывает дублирующий pill-ряд внутри viewer. Клик по ячейке → `e.stopPropagation()` + expand student + set task. Telemetry `drill_down_expanded` с `firstProblemTaskOrder` cascade (red/hint → amber → null), ОДИН раз на expand через `lastDrillTrackedRef`.
- **Guardrails соблюдены:** нет cards-in-cards, `touch-pan-x` на scroll-ряду, `touch-manipulation` на cells и mini-cards, `React.memo` на TaskMiniCard.
- **Validation:** ✅ `npm run lint` (baseline +0), ✅ `npm run build`, ✅ `npm run smoke-check`. Manual: drill-down opens, TaskMiniCard selection, viewer remount on task switch, cell click sets task directly, realtime E9 works.

### TASK-7 — Модалка правки балла (`tutor_score_override`)

- **Job:** R4-1.
- **AC:** AC-5.
- **Agent:** Claude Code.
- **Files:**
  - `src/components/tutor/results/EditScoreDialog.tsx` (новый)
  - `src/lib/tutorHomeworkApi.ts` — функция `setTutorScoreOverride({ taskStateId, score, comment })`
  - `supabase/functions/homework-api/index.ts` — handler `PATCH /task-states/:id/score-override`
  - `src/lib/homeworkTelemetry.ts` — событие `manual_score_override_saved`
- **Что делаем:** на `TaskMiniCard` (TASK-6) — иконка Pencil (Lucide). Открывает Dialog: показывает `ai_score` (read-only), input для `tutor_score_override` (число с шагом 0.5, диапазон `[0..max_score]`), textarea для комментария, кнопки «Сохранить» / «Сбросить override». Сохранение → API → React Query invalidate **трёх** ключей:
  1. `['tutor', 'homework', 'results', assignmentId]`
  2. `['tutor', 'homework', 'detail', assignmentId]`
  3. `['tutor', 'homework', 'thread', threadId]`
  Telemetry: `manual_score_override_saved` с `{ assignmentId, taskId, aiScore, tutorScore, hadComment }`.
- **Guardrails:**
  - НЕ затирать `ai_score` — только пишем в `tutor_score_override*`.
  - `final_score = COALESCE(tutor_score_override, ai_score)` — единая формула, в spec и в API.
  - Backend проверяет ownership (репетитор владеет ДЗ) через RLS / explicit check.
  - `<input type="number">` `font-size: 16px` (iOS auto-zoom).
  - Никаких новых tutor query keys вне префикса `['tutor', ...]` (см. `tutorStudentCacheSync.ts`).
- **Validation:** lint+build+smoke + manual: правка балла, сброс override, refetch detail-страницы.

### TASK-8 — Telemetry: 4 события через `homeworkTelemetry.ts`

- **Job:** Cross-cutting (R1-2/R3/R4-1).
- **AC:** AC-10.
- **Agent:** Claude Code.
- **Files:**
  - `src/lib/homeworkTelemetry.ts` — добавить типы и события
  - точки вызова: `TutorHomeworkResults.tsx` (open, drill_down), `EditScoreDialog.tsx` (override saved), `RemindStudentDialog.tsx` (telegram/email sent)
- **Что делаем:** добавить в union `GuidedTelemetryEvent` (или соседний tutor-events union, если такой есть) 4 новых события:
  - `results_v2_opened` — payload: `{ assignmentId, submittedCount, totalCount }`
  - `drill_down_expanded` — payload: `{ assignmentId, studentId, firstProblemTaskOrder }`
  - `manual_score_override_saved` — payload: `{ assignmentId, taskId, aiScore, tutorScore, hadComment }`
  - `telegram_reminder_sent_from_results` — payload: `{ assignmentId, studentId, kind }` где `kind: 'remind' | 'praise'`
- **Guardrails:** нет PII (имени, email, текста сообщения, `task_text`, `ai_feedback`). Все ID — uuid строки. `kind` ограничен enum.
- **Validation:** lint+build+smoke + manual: открыть DevTools `window.dataLayer`, проверить что все 4 события улетают.

### TASK-9 — Регрессионная проверка Safari/iOS + cross-tab consistency

- **Job:** R1-2.
- **AC:** AC-11.
- **Agent:** Claude Code (создаёт чек-лист) + ручной прогон Vladimir.
- **Files:**
  - `docs/delivery/features/homework-results-v2/qa-checklist.md` (новый)
- **Что делаем:** маркдаун-чек-лист: 26 × 10 хитмап (Chrome desktop), drill-down + viewer remount, модалка правки балла, Telegram Dialog, email fallback. Safari macOS 15+: формы 16px input, скролл хитмапа. iOS Safari iPhone SE 375px: горизонтальный скролл, no auto-zoom. Cross-tab: Detail → Results → Detail кеш консистентен. Telemetry sanity. По каждому пункту — чекбокс и поле «прошёл/не прошёл/issue link».
- **Guardrails:** не редактировать прод-код, только документ. Не использовать emoji в чек-листе (правило design system).
- **Validation:** не нужна — это документ.

---

## Copy-paste промпты для агентов

Запускаются по очереди. Каждый промпт — самодостаточный, агент получает его без дополнительного контекста. После каждой задачи Codex проводит независимое ревью (последний промпт в файле).

### Промпт TASK-1 — Claude Code

```
Ты — Claude Code, реализуешь TASK-1 фичи Homework Results v2 в репозитории SokratAI.

Перед началом ОБЯЗАТЕЛЬНО прочитай:
1. .claude/rules/00-read-first.md
2. CLAUDE.md
3. .claude/rules/40-homework-system.md
4. .claude/rules/10-safe-change-policy.md
5. docs/delivery/features/homework-results-v2/spec.md (вся секция Requirements + Risks + Phasing)

Задача: добавить две миграции, которые расширяют таблицу homework_tutor_task_states новыми колонками для AI- и репетиторских баллов, и заполняют их для существующих completed task_states.

Файлы (создать новые):
- supabase/migrations/20260408120000_add_scores_to_homework_tutor_task_states.sql
- supabase/migrations/20260408120100_backfill_homework_tutor_task_states_scores.sql

Колонки (все nullable, без default ломающих RLS):
- ai_score numeric(5,2)
- ai_score_comment text
- tutor_score_override numeric(5,2)
- tutor_score_override_comment text
- tutor_score_override_at timestamptz
- tutor_score_override_by uuid references auth.users(id)

Backfill: для completed task_states с известным max_score и последним verdict CORRECT — ai_score = max_score; для INCORRECT — ai_score = 0. Идемпотентно (WHERE ai_score IS NULL).

Acceptance criteria из spec.md: AC-8.

Guardrails:
- Только additive ALTER TABLE ADD COLUMN, никаких DROP/RENAME.
- НЕ менять RLS policies.
- Backfill в отдельной миграции, в одной транзакции, идемпотентен.
- НЕ трогать high-risk файлы (AuthGuard, TutorGuard, Chat.tsx, TutorSchedule.tsx, telegram-bot/index.ts).
- НЕ обновлять зависимости.

В конце ОБЯЗАТЕЛЬНО:
- Запусти: npm run lint && npm run build && npm run smoke-check
- Если что-то красное — исправь и повтори.
- Сообщи список изменённых файлов и результат validation.
```

### Промпт TASK-2 — Claude Code

```
Ты — Claude Code, реализуешь TASK-2 фичи Homework Results v2.

Перед началом прочитай:
1. .claude/rules/00-read-first.md, CLAUDE.md, .claude/rules/40-homework-system.md, .claude/rules/10-safe-change-policy.md
2. docs/delivery/features/homework-results-v2/spec.md (особенно Q2 resolution в Open Questions и AC-9)
3. supabase/functions/homework-api/guided_ai.ts (полностью)
4. supabase/functions/homework-api/index.ts — функция handleCheckAnswer

Задача: расширить evaluateStudentAnswer чтобы возвращала ai_score и ai_score_comment, и записать эти поля в homework_tutor_task_states из handleCheckAnswer.

Контракт ai_score:
- check_format = 'short_answer': бинарно — 0 или max_score (берётся из tryDeterministicShortAnswerMatch для CORRECT/INCORRECT, AI не вызывается отдельно для скора).
- check_format = 'detailed_solution': целое или 0.5-step значение в [0..max_score], промпт ссылается на ФИПИ-критерии. Для каждого балла < max — короткий ai_score_comment «почему не максимум» (1–2 предложения, без LaTeX).

Hints и время в guided-чате НЕ ВЛИЯЮТ на ai_score.

Acceptance criteria: AC-9.

Guardrails:
- НЕ менять контракт verdict (CORRECT / PARTIAL / INCORRECT).
- НЕ трогать pipeline передачи изображений в AI (signed URL → base64).
- НЕ записывать в tutor_score_override (это другая ручка).
- НЕ менять FORBIDDEN_HINT_PHRASES логику generateHint.
- НЕ обновлять зависимости.
- Респектить .claude/rules/80-cross-browser.md и performance.md.

В конце ОБЯЗАТЕЛЬНО:
- npm run lint && npm run build && npm run smoke-check
- Список изменённых файлов и результат.
```

### Промпт TASK-3 — Claude Code

```
Ты — Claude Code, реализуешь TASK-3 фичи Homework Results v2.

Перед началом прочитай:
1. .claude/rules/00-read-first.md, CLAUDE.md
2. .claude/rules/90-design-system.md, .claude/rules/80-cross-browser.md, .claude/rules/performance.md
3. docs/discovery/product/tutor-ai-agents/16-ux-principles-for-tutor-product-sokrat.md, 17-ui-patterns-and-component-rules-sokrat.md
4. docs/delivery/features/homework-results-v2/spec.md (P0-1, AC-1)
5. src/pages/tutor/TutorHomeworkResults.tsx (целиком)

Задача: добавить шапку-сводку в /tutor/homework/:id/results. Должна помещаться в один scroll-screen на десктопе (≤ ~280px) и читаемо разваливаться в 2 строки на мобиле.

Содержимое шапки: название ДЗ, дедлайн (с urgency badge: overdue/today/soon/normal), «сдали N / всего M», средний балл по ДЗ AVG(final_score / max_score), число «не приступал», число «требует внимания» (hint overuse OR final_score < 0.3 * max_score).

final_score = COALESCE(tutor_score_override, ai_score). Если AC-9 ещё не вмержен в этой ветке — fallback на task_states.status (CORRECT = max_score, INCORRECT = 0).

Acceptance criteria: AC-1.

Guardrails:
- Golos Text, токены bg-accent/text-slate-*, никаких emoji в chrome.
- НЕ карточка-в-карточке.
- НЕ framer-motion.
- Структурный breakpoint md:, НЕ sm:.
- React.memo для вынесенного компонента ResultsHeader, если он рендерится в списке.
- Lucide иконки.

В конце:
- npm run lint && npm run build && npm run smoke-check
- Список файлов и результат.
```

### Промпт TASK-4 — Claude Code

```
Ты — Claude Code, реализуешь TASK-4 фичи Homework Results v2.

Перед началом прочитай:
1. .claude/rules/00-read-first.md, CLAUDE.md
2. .claude/rules/60-telegram-bot.md, .claude/rules/70-notifications.md, .claude/rules/90-design-system.md
3. docs/delivery/features/homework-results-v2/spec.md (P0-2, AC-6, AC-7)
4. src/pages/tutor/TutorHomeworkResults.tsx
5. src/lib/homeworkTelemetry.ts
6. supabase/functions/_shared/email-sender.ts (контракт sendHomeworkNotificationEmail)

Задача: action block для каждого ученика, который «не приступал» — danger-пункт + кнопка «Напомнить». Кнопка открывает Radix Dialog с preset-message в editable textarea и кнопкой «Отправить». Telegram → существующий API. Без Telegram → email-fallback. После успеха — toast + telemetry. Дополнительно — chip «много подсказок» для учеников с hints_used >= ceil(tasks.length * 0.6) (HINT_OVERUSE_THRESHOLD).

Файлы:
- src/pages/tutor/TutorHomeworkResults.tsx — интеграция
- src/components/tutor/results/RemindStudentDialog.tsx — новый
- src/lib/homeworkTelemetry.ts — событие telegram_reminder_sent_from_results

Acceptance criteria: AC-6, AC-7.

Guardrails:
- НЕ fire-and-forget. Без подтверждения юзера сообщение не уходит.
- Email-fallback обязателен.
- В payload telemetry НИКАКИХ имён/email/текста сообщения.
- Preset нейтральный, без давления и манипуляций.
- 16px font-size в textarea (iOS auto-zoom).
- НЕ emoji в UI chrome.

В конце:
- npm run lint && npm run build && npm run smoke-check
- Список файлов и результат.
```

### Промпт TASK-5 — Claude Code

```
Ты — Claude Code, реализуешь TASK-5 фичи Homework Results v2.

Перед началом прочитай:
1. .claude/rules/00-read-first.md, CLAUDE.md
2. .claude/rules/90-design-system.md, .claude/rules/80-cross-browser.md, .claude/rules/performance.md
3. docs/delivery/features/homework-results-v2/spec.md (P0-3, AC-2)
4. src/pages/tutor/TutorHomeworkResults.tsx

Задача: создать HeatmapGrid (students × tasks). Колонка имени sticky. Клетка 56px × 44px минимум. Цвет по final_score / max_score:
- null → bg-slate-100 text-slate-400, в клетке «—»
- < 0.3 → bg-red-100 text-red-900
- 0.3..0.8 → bg-amber-100 text-amber-900
- >= 0.8 → bg-emerald-100 text-emerald-900

Внутри клетки — число баллов. От ширины ~720px — горизонтальный скролл.

Файлы:
- src/components/tutor/results/HeatmapGrid.tsx — новый
- src/pages/tutor/TutorHomeworkResults.tsx — интеграция

Acceptance criteria: AC-2.

Guardrails:
- НЕ framer-motion. Только CSS transition-colors.
- НЕ emoji.
- React.memo на ячейку и строку.
- Структурный breakpoint md:, НЕ sm:.
- Никаких новых тяжёлых библиотек (recharts/etc).

В конце:
- npm run lint && npm run build && npm run smoke-check
- Manual smoke: 26 × 10 на десктопе и iPhone (опиши что проверил).
- Список файлов и результат.
```

### Промпт TASK-6 — Claude Code

```
Ты — Claude Code, реализуешь TASK-6 фичи Homework Results v2.

Перед началом прочитай:
1. .claude/rules/00-read-first.md, CLAUDE.md
2. .claude/rules/40-homework-system.md (особенно секции про GuidedThreadViewer, E8 task context, E9 realtime)
3. .claude/rules/90-design-system.md, .claude/rules/performance.md
4. docs/delivery/features/homework-results-v2/spec.md (P0-4, AC-3, AC-4)
5. src/components/tutor/GuidedThreadViewer.tsx
6. src/pages/tutor/TutorHomeworkResults.tsx

Задача: по клику на строку ученика в HeatmapGrid раскрывается inline-блок с горизонтальным рядом TaskMiniCard и GuidedThreadViewer с taskFilter = selectedTaskId. Клик по TaskMiniCard меняет selectedTaskId; viewer ремоунтится через key={selectedTaskId}. Кольцо выбранной мини-карточки — ring-2 ring-slate-800. Telemetry drill_down_expanded с firstProblemTaskOrder.

Файлы:
- src/components/tutor/results/StudentDrillDown.tsx — новый
- src/components/tutor/results/TaskMiniCard.tsx — новый, React.memo
- src/pages/tutor/TutorHomeworkResults.tsx — интеграция

Acceptance criteria: AC-3, AC-4.

Guardrails:
- НЕ переписывать GuidedThreadViewer. Только проп taskFilter и enabled={true}.
- Lazy mount viewer (enabled только на expand).
- НЕ ломать E8 task context block и E9 realtime INSERT subscription.
- НЕ карточки-в-карточках (используй разделители/spacing вместо вложенных border).
- НЕ framer-motion.

В конце:
- npm run lint && npm run build && npm run smoke-check
- Manual: открыть drill-down, переключить 3 задачи подряд, проверить ремоунт viewer и realtime.
- Список файлов и результат.
```

### Промпт TASK-7 — Claude Code

```
Ты — Claude Code, реализуешь TASK-7 фичи Homework Results v2.

Перед началом прочитай:
1. .claude/rules/00-read-first.md, CLAUDE.md
2. .claude/rules/40-homework-system.md, .claude/rules/performance.md (особенно React Query key-конвенция и tutorStudentCacheSync.ts)
3. docs/delivery/features/homework-results-v2/spec.md (P0-5, AC-5)
4. src/lib/tutorHomeworkApi.ts
5. supabase/functions/homework-api/index.ts

Задача: модалка правки балла. Pencil-иконка на TaskMiniCard. Dialog показывает ai_score (read-only), input number (шаг 0.5, диапазон [0..max_score]) для tutor_score_override, textarea для комментария, кнопки «Сохранить» / «Сбросить override». Сохранение → API PATCH /task-states/:id/score-override → React Query invalidate ТРЁХ ключей:
1. ['tutor', 'homework', 'results', assignmentId]
2. ['tutor', 'homework', 'detail', assignmentId]
3. ['tutor', 'homework', 'thread', threadId]

Telemetry manual_score_override_saved.

Файлы:
- src/components/tutor/results/EditScoreDialog.tsx — новый
- src/lib/tutorHomeworkApi.ts — setTutorScoreOverride
- supabase/functions/homework-api/index.ts — handler PATCH /task-states/:id/score-override
- src/lib/homeworkTelemetry.ts — событие manual_score_override_saved

Acceptance criteria: AC-5.

Guardrails:
- НЕ затирать ai_score. Override пишется только в tutor_score_override*.
- final_score = COALESCE(tutor_score_override, ai_score). Используй эту формулу везде.
- Backend проверяет ownership ДЗ через RLS / explicit check (не доверяй клиенту).
- input type=number font-size 16px (iOS).
- НЕ нарушать React Query префикс ['tutor', ...] (см. tutorStudentCacheSync.ts).
- НЕ обновлять зависимости.

В конце:
- npm run lint && npm run build && npm run smoke-check
- Manual: правка балла → проверь что Detail-страница ученика показывает обновлённый final_score без перезагрузки.
- Список файлов и результат.
```

### Промпт TASK-8 — Claude Code

```
Ты — Claude Code, реализуешь TASK-8 фичи Homework Results v2.

Перед началом прочитай:
1. .claude/rules/00-read-first.md, CLAUDE.md
2. src/lib/homeworkTelemetry.ts
3. docs/delivery/features/homework-results-v2/spec.md (P0-7, AC-10)

Задача: добавить 4 telemetry-события и подключить их в точках вызова. Все события улетают через существующий gtag/dataLayer pipeline.

События и payloads:
- results_v2_opened: { assignmentId, submittedCount, totalCount }
- drill_down_expanded: { assignmentId, studentId, firstProblemTaskOrder: number | null }
- manual_score_override_saved: { assignmentId, taskId, aiScore, tutorScore, hadComment: boolean }
- telegram_reminder_sent_from_results: { assignmentId, studentId, kind: 'remind' | 'praise' }

Точки вызова:
- TutorHomeworkResults.tsx — results_v2_opened (useEffect один раз при mount)
- StudentDrillDown.tsx — drill_down_expanded при первом expand
- EditScoreDialog.tsx — manual_score_override_saved после успешного PATCH
- RemindStudentDialog.tsx — telegram_reminder_sent_from_results после успешной отправки

Acceptance criteria: AC-10.

Guardrails:
- В payload НИКАКИХ имён/email/текста сообщения/task_text/ai_feedback.
- ID — uuid строки.
- kind ограничен enum через TS literal type.
- Дополнить TS-типы, а не bypass через any.

В конце:
- npm run lint && npm run build && npm run smoke-check
- Manual: открой DevTools, проверь window.dataLayer на каждом из 4 событий.
- Список файлов и результат.
```

### Промпт TASK-9 — Claude Code (документ)

```
Ты — Claude Code. Создай qa-checklist.md для фичи Homework Results v2.

Прочитай:
1. docs/delivery/features/homework-results-v2/spec.md (секции Validation и Risks)
2. .claude/rules/80-cross-browser.md

Задача: создать docs/delivery/features/homework-results-v2/qa-checklist.md — markdown-чек-лист с галочками. Покрытие:
- Chrome desktop: 26 × 10 хитмап, drill-down, viewer remount, EditScoreDialog flow, RemindStudentDialog (TG и email-fallback).
- Safari macOS 15+: формы 16px input, скролл хитмапа.
- iOS Safari iPhone SE 375px: горизонтальный скролл, no auto-zoom, touch-action: manipulation.
- Cross-tab consistency: Detail → Results → Detail, кеш ключей не stale.
- Telemetry sanity: window.dataLayer содержит все 4 события без PII.
- Backfill smoke (Phase 1): количество строк task_states до/после миграции совпадает, ai_score IS NOT NULL для всех completed.

По каждому пункту — chekbox + поле «прошёл/issue link».

Acceptance criteria: AC-11.

Guardrails:
- Не редактируй прод-код.
- НЕ emoji (правило design system).
- Markdown без HTML, без таблиц на 100 колонок.

Validation: не нужна (документ).
```

### Промпт ревьюера — Codex (запускается ОТДЕЛЬНО для каждой завершённой задачи)

```
Ты — Codex, независимый code-reviewer. У тебя НЕТ контекста того, как автор реализовал задачу. Твоя цель — найти регрессии, нарушения guardrails и spec-mismatch до мерджа.

Задача на ревью: TASK-N фичи Homework Results v2 (подставь номер).

Перед началом прочитай:
1. .claude/rules/00-read-first.md, CLAUDE.md
2. docs/delivery/features/homework-results-v2/spec.md (целиком, особенно секции Acceptance Criteria и Risks)
3. docs/delivery/features/homework-results-v2/tasks.md — секция TASK-N
4. .claude/rules/10-safe-change-policy.md, .claude/rules/40-homework-system.md, .claude/rules/80-cross-browser.md, .claude/rules/performance.md, .claude/rules/90-design-system.md, .claude/rules/70-notifications.md, .claude/rules/60-telegram-bot.md (применимо)

Затем посмотри diff PR (git diff main...HEAD или diff конкретного commit).

Проверь по чек-листу:

A. Соответствие AC из спеки. Каждый AC, привязанный к TASK-N, должен быть выполним и проверяем по диффу.

B. Guardrails из секции TASK-N в tasks.md — выполнены все.

C. Cross-browser:
- Нет crypto.randomUUID, structuredClone, Array.at, Object.hasOwn.
- Нет new Date(string) с не-ISO форматом — используется parseISO.
- Нет 100vh, overflow: clip, scrollbar-gutter.
- input/textarea/select font-size >= 16px.

D. Performance:
- Нет framer-motion.
- Тяжёлые компоненты lazy.
- React.memo на list-item.
- Нет тяжёлых зависимостей в shared-компонентах.
- Нет new dependencies в package.json без согласования.

E. React Query (если применимо):
- Префикс ['tutor', ...] для tutor-запросов.
- Корректные invalidations согласно spec (AC-5: три ключа).

F. Security:
- Нет утечек ai_feedback / task_text / PII в telemetry.
- RLS / ownership проверяется на backend для PATCH/POST.
- Никаких secret в коде.

G. Design system:
- Golos Text (не Inter/Roboto).
- Цвета через токены (bg-accent, не bg-[#1B6B4A]).
- Lucide icons, не emoji в chrome.
- Нет cards-in-cards.
- Структурные breakpoints — md:, не sm:.

H. Migrations (если применимо):
- Additive only.
- RLS не сломан.
- Backfill идемпотентен.

I. Validation:
- Автор приложил результат npm run lint && build && smoke-check (зелёный).
- Если красное — review BLOCKED.

Формат ответа:
1. Сводка: APPROVED / REQUEST CHANGES / BLOCKED.
2. Список найденных проблем с указанием файла и строки.
3. Для каждой проблемы — категория (A..I) и предложение фикса.
4. Если всё чисто — явно перечисли AC, которые ты подтвердил выполненными.

НЕ запускай команды/билды/миграции от имени автора. Только статический анализ диффа и кода.
```
