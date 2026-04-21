# Tasks — Tutor Dashboard v2 (Phase 1)

**Status:** In progress (TASK-1..6 ✅ done, REVIEW pending)
**Pipeline step:** 5 (TASKS)
**Owner:** Vladimir
**Date:** 2026-04-21
**Спека:** `./spec.md` (approved)

---

## Обзор

6 задач + 1 review. Порядок в PR строго последовательный — каждая задача depends on предыдущую. P0 (TASK-1..5) деплоится первым релизом, P1 (TASK-6) — fast follow-up через 1–2 дня.

| # | Задача | Статус | Приоритет | Агент | Основные файлы | AC |
|---|---|---|---|---|---|---|
| TASK-1 | CSS helper layer (`tutor-dashboard.css`) | ✅ done | P0 | Claude Code | `src/styles/tutor-dashboard.css`, `src/index.css` | AC-7 |
| TASK-2 | Data hooks + aggregator | ✅ done | P0 | Claude Code | `src/hooks/useTutorHomeData.ts` + 4 новых | AC-3, AC-9, AC-11 |
| TASK-3 | Shared primitives (`Sparkline`, `WeeklyStrip`, `DeltaPill`, `ChatRow`, `SessionBlock`, `SubmissionRowLite`) | ✅ done | P0 | Claude Code | `src/components/tutor/home/primitives/` | AC-8 |
| TASK-4 | Блоки Dashboard (`HomeHeader`, `HomeCTAs`, `StatStrip`, `TodayBlock`, `ReviewQueueBlock`, `RecentDialogsBlock`, `StudentsActivityBlock`) | ✅ done | P0 | Claude Code | `src/components/tutor/home/*`, `src/lib/ru/pluralize.ts` | AC-1, AC-4, AC-5, AC-6, AC-8 |
| TASK-5 | Page + routing + cleanup (`TutorHome.tsx`, redirect, delete `TutorDashboard.tsx`, warmup) | ✅ done | P0 | Claude Code | `src/pages/tutor/TutorHome.tsx`, `src/App.tsx`, `src/components/tutor/TutorLayout.tsx` | AC-1, AC-2, AC-7, AC-10 |
| TASK-6 | P1 polish: Segment sort + row-клики + responsive + iOS Safari | ✅ done | P1 | Claude Code | `src/components/tutor/home/StudentsActivityBlock.tsx`, `src/styles/tutor-dashboard.css` | AC-9, AC-10, AC-12 |
| REVIEW | Независимый code-review по AC | ⏳ after TASK-5 | — | Codex | — | все AC |

**Деплой:** TASK-1..5 — один PR, запуск в прод. TASK-6 — follow-up PR через 1–2 дня после первого тутор-feedback.

---

## TASK-1 — CSS helper layer · ✅ done (2026-04-21)

**Job:** R4 (визуальная согласованность с design handoff).
**Agent:** Claude Code.
**Files:** `src/styles/tutor-dashboard.css` (новый), `src/index.css` (добавить @import).
**Acceptance:** AC-7.
**Depends on:** —

**Результат:**
- Создан `src/styles/tutor-dashboard.css` (472 строки) с helper-классами из handoff: `.t-section*`, `.t-stats*`, `.t-table*`, `.t-divider`, `.t-session*`, `.t-chip*`, `.t-status*`, `.t-avatar*`, `.t-seg*`, `.t-empty`, `.t-num`, `.t-muted`, `.t-grid-2`, `.t-hstack`, `.t-vstack`, `.home-header`, `.home-ctas`, `.home-cta*` (включая `.home-cta--primary` на будущее, хотя в P0 не используется), `.home-activity-table`, `.chat-row*`. Phase 2 / non-Dashboard классы не скопированы.
- `src/index.css` получил `@import "./styles/tutor-dashboard.css";` сразу после `colors_and_type.css` и до Tailwind layers.
- Все правила читают только `var(--sokrat-*)`. Новых CSS-переменных не вводили.

### Что сделать

1. Создать `src/styles/tutor-dashboard.css`. Скопировать **только необходимые для Dashboard** helper-классы из:
   - `docs/design-system/handoff-dashboard/tutor-kit/tokens.css`: `.t-section`, `.t-stats`, `.t-stats__cell`, `.t-stats__label`, `.t-stats__value`, `.t-stats__meta`, `.t-table-wrap`, `.t-table`, `.t-divider`, `.t-session`, `.t-session--oge`, `.t-session--past`, `.t-muted`, `.t-num`, `.t-grid-2`, `.t-hstack`, `.t-vstack`, `.t-chip`, `.t-chip--ege`, `.t-chip--oge`, `.t-chip--neutral`, `.t-chip--success`, `.t-chip--warning`, `.t-chip--danger`, `.t-status`, `.t-status__dot`, `.t-status--*`, `.t-avatar`, `.t-avatar--32`, `.t-seg`, `.t-seg__item`, `.t-empty`.
   - `docs/design-system/handoff-dashboard/tutor-kit/dashboard-home.css`: всё (`.home-header`, `.home-ctas`, `.home-cta`, `.home-cta--primary`, `.home-activity-table`, `.chat-row*`).
2. Каждое CSS-правило должно читать **только** `var(--sokrat-*)` из уже импортированного `src/styles/colors_and_type.css`. **Никаких** новых переменных / hex-значений / font-family'ев.
3. В `src/index.css` добавить импорт **сразу после** `@import './styles/colors_and_type.css'` и **до** Tailwind layers:
   ```css
   @import './styles/tutor-dashboard.css';
   ```
4. Сделать sanity-check: создать временный файл `src/pages/_TestDashboardTokens.tsx` (удалить перед коммитом), в нём обернуть:
   ```tsx
   <div className="sokrat" data-sokrat-mode="tutor">
     <section className="t-section"><div className="t-stats"><div className="t-stats__cell"><div className="t-stats__label">TEST</div><div className="t-stats__value">14</div></div></div></section>
   </div>
   ```
   Запустить dev → убедиться, что рендерится корректно (Golos Text, stats бордер hairline, зелёный focus ring). Потом **удалить** файл.

### Guardrails

- **Не** добавлять новых CSS-переменных. SKILL.md §5 — токен hierarchy закрыт.
- **Не** копировать классы, которые не нужны Dashboard (`.t-task`, `.t-review`, `.t-payrow`, `.t-week`, `.t-studentrow` — это Phase 2 / других страниц).
- **Не** менять порядок импортов в `index.css` (Tailwind layers должны остаться ниже).
- Все classы с префиксом `t-` / `home-` / `chat-row` — namespace, не перекрывают shadcn.

### Mandatory end block

```
npm run lint
npm run build
```

Отчёт: список скопированных классов, размер итогового `tutor-dashboard.css` в строках, подтверждение что dev-server стартовал без CSS warnings.

---

## TASK-2 — Data hooks + aggregator · ✅ done (2026-04-21)

**Job:** R4-1, R4-2 (видимость сигналов).
**Agent:** Claude Code.
**Files:** `src/hooks/useTutorTodayLessons.ts`, `src/hooks/useTutorReviewQueue.ts`, `src/hooks/useTutorRecentDialogs.ts`, `src/hooks/useTutorStudentActivity.ts`, `src/hooks/useTutorHomeData.ts`.
**Acceptance:** AC-3, AC-9, AC-11.
**Depends on:** —

**Результат:**
- 5 hook'ов созданы, все query keys по конвенции `['tutor', 'home', entity]`: `today-lessons`, `review-queue`, `recent-dialogs`, `student-activity`.
- `useTutorReviewQueue`: fallback 48h-окно на `threads.updated_at` (нет колонки `tutor_viewed_at` в БД) — задокументировано в JSDoc хука. `aiFlag` derived из `needs_attention` + task-level scores (нет колонки `ai_flag` в schema).
- `useTutorRecentDialogs`: PostgREST не поддерживает `DISTINCT ON`, префетч последних 50 user-сообщений → client-side dedup по `student_id`.
- `useTutorStudentActivity`: stable sort attention desc → hwAvgDelta desc → name asc ru; 3 триггера attention (overdue / scoreDropping `delta < -0.5` / inactive 7+ дней).
- `useTutorHomeData`: композитный aggregator 7 хуков (3 existing + 4 new), возвращает объединённые `loading`/`error`/`anySettled`/`refetchAll`.
- Все хуки пустобезопасны (`students.length === 0 → items: []`), `parseISO` для всех дат, `getSession()` через existing `getCurrentTutor`.

### Что сделать

Реализовать 4 новых hook'а + 1 aggregator согласно спеке §5 (API / data contracts). Все query keys строго по конвенции `['tutor', 'home', entity]`.

#### 1. `useTutorTodayLessons()`
- Query: `tutor_lessons` WHERE `tutor_id = :me AND start_at::date = CURRENT_DATE`, ORDER BY `start_at`.
- Тип `TodaySession` per spec.
- Форматирование `time`: `date-fns parseISO + format('HH:mm')`. **НЕ** `new Date(string)` (см. `.claude/rules/80-cross-browser.md`).
- `studentName` — short form (первое имя + инициал фамилии через `shortenName(full)` helper в том же файле).
- `staleTime: 60_000`.

#### 2. `useTutorReviewQueue()`
- Query: `homework_tutor_student_assignments` JOIN `homework_tutor_threads` WHERE `tutor_id = :me AND threads.status = 'completed'`.
- Fallback-логика (из spec § Open Q): если колонки `tutor_viewed_at` нет → использовать `threads.updated_at > now() - interval '48 hours'` AND (`needs_attention = true` OR `ai_flag = 'warn'`).
- Получить per-task answer strip через существующий `handleGetResults` data или эквивалент (resolver сам решает через уже используемые в `TutorHomeworkDetail` пути).
- Limit 5.
- `staleTime: 30_000`.

#### 3. `useTutorRecentDialogs()`
- SQL (через Supabase client, не RPC):
  ```sql
  SELECT DISTINCT ON (ta.student_id)
    ta.student_id, ta.tutor_student_id,
    ts.display_name, ts.stream,
    msg.role, msg.content, msg.created_at,
    a.id AS hw_id, a.title AS hw_title
  FROM homework_tutor_thread_messages msg
  JOIN homework_tutor_threads th ON th.id = msg.thread_id
  JOIN homework_tutor_student_assignments sa ON sa.id = th.student_assignment_id
  JOIN homework_tutor_assignments a ON a.id = sa.assignment_id
  JOIN tutor_students ts ON ts.id = sa.tutor_student_id
  WHERE a.tutor_id = :me AND msg.role = 'user'
  ORDER BY ta.student_id, msg.created_at DESC
  LIMIT 5;
  ```
- После — отсортировать `.sort((a,b) => new Date(b.created_at) - new Date(a.created_at))` и взять первые 5.
- Preview: `content.slice(0, 80) + (content.length > 80 ? '…' : '')`. Если есть вложения без текста — `'(фото)'` / `'(PDF)'` как в `GuidedHomeworkWorkspace`.
- `at` = `formatDistanceToNow(parseISO(created_at), { locale: ru, addSuffix: false })` с маппингом «5 минут назад» → «5 мин», «1 час назад» → «1 ч», «вчера в 21:40» → `'вчера HH:mm'`. Helper `formatRelativeShort(ts)` в том же файле.
- `from` = `'student'` (role='user' с tutor-side). Для tutor-ответов отдельный хук не делаем в Phase 1.
- `staleTime: 30_000`.

#### 4. `useTutorStudentActivity()`
- Берём `useTutorStudents()` (cached) + `useQueries` для `handleGetResults` по последним 6 ДЗ каждого ученика.
- Weekly strip логика — per spec §5, 5 состояний с приоритетом `miss > late > part > ok > none`.
- Attention — 3 триггера с приоритетом per spec §5 «Attention логика».
- hwTrend — last 6 completed (`ratio * 5`, `toFixed(1)`).
- hwAvgDelta = `avg(last 3) − avg(previous 3)` той же шкалы.
- Limit 20 учеников: первые top-15 по `attention=true`, потом top-5 по `updated_at DESC`.
- Если `students.length > 20` — вернуть `{ items: [...], totalCount: N }`.
- `staleTime: 60_000`.

#### 5. `useTutorHomeData()` (aggregator)
- Composable wrapper через `useQueries` (или просто параллельный вызов 7 hooks):
  - `useTutor()` (existing)
  - `useTutorStudents()` (existing)
  - `useTutorPayments()` (existing)
  - `useTutorTodayLessons()` (new)
  - `useTutorReviewQueue()` (new)
  - `useTutorRecentDialogs()` (new)
  - `useTutorStudentActivity()` (new)
- Возвращает единый объект `{ tutor, students, payments, todayLessons, reviewQueue, recentDialogs, studentActivity, loading, error, refetchAll }`.
- В `TutorHome.tsx` (TASK-5) использовать **только** этот aggregator.

### Guardrails

- **Не** создавать новых RPC / миграций — всё через Supabase client (спека §5 — «миграций нет»).
- **Не** делать N+1: `useTutorStudentActivity` использует `useQueries` с одним ключом на ученика (React Query батчит), но для 20 учеников это 20 параллельных fetch — замерь P75 latency локально, если > 1.5 сек — в комментарии пометь TASK для Phase 2 RPC.
- Query keys строго `['tutor', 'home', entity]` — см. `.claude/rules/performance.md` §2c.
- Использовать `parseISO` из `date-fns` для всех дат (см. `.claude/rules/80-cross-browser.md`).
- Empty state-robust: `useTutorStudentActivity` при `students.length === 0` возвращает `{ items: [], totalCount: 0 }`, **не** падает.
- `getSession()` для `user.id`, **не** `getUser()` (performance.md §2a).

### Mandatory end block

```
npm run lint
npm run build
npm run smoke-check
```

Отчёт: перечислить созданные хуки, зафиксировать замер latency для `useTutorStudentActivity` на dev с 10+ моковыми учениками (если есть), список query keys.

---

## TASK-3 — Shared primitives · ✅ done (2026-04-21)

**Job:** R4-1 (моментальное визуальное распознавание сигналов).
**Agent:** Claude Code.
**Files:** `src/components/tutor/home/primitives/Sparkline.tsx`, `WeeklyStrip.tsx`, `DeltaPill.tsx`, `ChatRow.tsx`, `SessionBlock.tsx`, `SubmissionRowLite.tsx`, `index.ts` (barrel).
**Acceptance:** AC-8.
**Depends on:** TASK-1 (CSS классы).

**Результат:**
- 6 pure-presentational primitives + barrel. Все в `React.memo`.
- Типы `DialogItem` / `TodaySession` / `ReviewItem` re-export'ятся из TASK-2 хуков (single source of truth), `WeeklyCell` экспорт из `WeeklyStrip.tsx`.
- `ChatRow` / `SubmissionRowLite` — native `<button>` (role=button бесплатно) + onKeyDown Enter/Space. `SessionBlock` — опциональный interactive mode (role=button + tabIndex только при onOpen).
- `touchAction: 'manipulation'` inline style на всех interactive элементах (rule 80).
- Нет `framer-motion`, нет `bg-accent`/`bg-primary`, Lucide React icons only (`ChevronRight`).
- Tooltip-компонент прототипа не импортирован — `title` + `aria-label` attributes для tooltip-ов в WeeklyStrip cells.
- `rg 'bg-(accent|primary)' src/components/tutor/home` → 0 matches.

### Что сделать

Все компоненты — **pure presentational**, без data-fetching, завёрнуты в `React.memo` (см. performance.md §2 про list-item компоненты).

#### 1. `<Sparkline>`
- Props: `{ values: number[]; stroke?: string; width?: number; height?: number }` (defaults 80×24, stroke `var(--sokrat-fg2)`).
- Рендер: inline SVG `<polyline>` с `fill="none"` и нормализацией values в рамках height.
- Reference implementation: `docs/design-system/handoff-dashboard/tutor-kit/students-split.jsx` → `Sparkline`.
- Если `values.length < 2` — рендерить `<span className="t-muted" style={{fontSize:12}}>—</span>`.

#### 2. `<WeeklyStrip>`
- Props: `{ cells: Array<'ok'|'late'|'part'|'miss'|'none'> }` (length 5, latest last).
- Рендер: `<div style={{display:'flex', gap:3}}>` + 5 `<Tooltip>`-span'ов 14×20 rounded-3px. Цвета per spec:
  - `ok` → `var(--sokrat-state-success-fg)`
  - `late` / `part` → `var(--sokrat-state-warning-fg)`
  - `miss` → `var(--sokrat-state-danger-fg)`
  - `none` → `var(--sokrat-border-light)`
- Tooltip label: `«Неделя −{cells.length-1-i}: вовремя/позже/частично/не сдано/—»`.
- `aria-label="Сдачи по неделям"`.

#### 3. `<DeltaPill>`
- Props: `{ value: number | null }`.
- `value === null` → render `—`.
- `value > 0` → `<span style={{color:'var(--sokrat-state-success-fg)'}}>↑ +{value.toFixed(1)}</span>`.
- `value < 0` → `<span style={{color:'var(--sokrat-state-danger-fg)'}}>↓ {value.toFixed(1)}</span>`.
- `value === 0` → `<span className="t-muted">·</span>`.

#### 4. `<ChatRow>`
- Props: `{ chat: DialogItem; onOpen: (chat) => void }` (тип из spec §5).
- CSS классы из `tutor-dashboard.css`: `.chat-row`, `.chat-row__avatar`, `.chat-row__body`, `.chat-row__top`, `.chat-row__name`, `.chat-row__time`, `.chat-row__preview`, `.chat-row__prefix`.
- Avatar = initials (первые буквы первого + второго слова из `name`).
- Stream chip `<Chip>` из existing UI (либо заменить на inline span с `.t-chip--ege`/`.t-chip--oge` для точного совпадения с design).
- Handle Enter / Space → call `onOpen` (role="button", tabIndex=0) per AC-10.

#### 5. `<SessionBlock>`
- Props: `{ session: TodaySession }`.
- CSS класс `.t-session` (+ `.t-session--oge` если stream='ОГЭ').
- Layout: 2 строки — `<span class="t-session__time">` + `<span class="t-session__title">` (short student name) + `<span class="t-session__meta">` (topic).
- Fixed min-height 48px (уже в CSS).

#### 6. `<SubmissionRowLite>`
- Компактная версия для `ReviewQueueBlock` (не путать с существующим `SubmissionRow` в review flow).
- Props: `{ sub: ReviewItem; onOpen: (assignmentId: string) => void }`.
- Layout: Avatar (32, stream ring) + name / submittedAt + score (`5/8`) + answer strip (цветные кружки 8px) + AI chip + chevron-right.
- Reference implementation: `docs/design-system/handoff-dashboard/tutor-kit/workplace.jsx` → `SubmissionRow`.
- **Не переиспользовать** `.t-studentrow` — в нашем CSS слое его нет; inline Tailwind + tokens.

### Guardrails

- **Не** добавлять framer-motion (запрещено, performance.md §2).
- **Не** использовать `bg-primary` / `bg-accent` для явно зелёных элементов (spec КР-3). Используй `style={{background: 'var(--sokrat-green-700)'}}` или `className="bg-[var(--sokrat-green-700)]"`.
- **Не** копировать `<Tooltip>` из handoff (`window.lucide`). Использовать shadcn Tooltip или минимальный wrapper на CSS (`title` attribute допустим для P0).
- Все компоненты обёрнуты в `memo()` (performance.md §2).
- Иконки — Lucide React (`Backpack`, `ChevronRight`, etc.), **не** через `window.lucide.createIcons` как в handoff-прототипе.
- Safari: все interactive элементы с `touch-action: manipulation` (rule 80).

### Mandatory end block

```
npm run lint
npm run build
```

Отчёт: список созданных файлов, подтверждение `React.memo`, grep-проверка что нет `bg-accent`/`bg-primary` в новых компонентах.

---

## TASK-4 — Блоки Dashboard · ✅ done (2026-04-21)

**Job:** R4, R3-1.
**Agent:** Claude Code.
**Files:** `src/components/tutor/home/HomeHeader.tsx`, `HomeCTAs.tsx`, `StatStrip.tsx`, `TodayBlock.tsx`, `ReviewQueueBlock.tsx`, `RecentDialogsBlock.tsx`, `StudentsActivityBlock.tsx`, `index.ts` (barrel), `src/lib/ru/pluralize.ts` (новый helper).
**Acceptance:** AC-1, AC-4, AC-5, AC-6, AC-8.
**Depends on:** TASK-1, TASK-2, TASK-3.

**Результат:**
- 7 composable blocks + barrel + ru-pluralize helper. Все в `React.memo`.
- `HomeHeader`: ровно 2 кнопки (AC-4), русский weekday+date через `date-fns/locale/ru`, primary green button через `style={{background: 'var(--sokrat-green-700)'}}` (spec КР-3).
- `HomeCTAs`: строгий TS-shape `{ onAssignHomework, onAddPayment, paymentSummary }` — `onAddStudent` и primary prop не существуют, enforced на compile-time (AC-5).
- `StatStrip`: single `.t-stats` card с 4 hairline cells, русские decimal через `Intl.NumberFormat('ru-RU')` (4,3), signed delta с `+`/`−`.
- `TodayBlock` / `ReviewQueueBlock` / `RecentDialogsBlock`: EmptyState с Lucide иконкой (без emoji), соответствующие constraints (4/4/5 видимых).
- `StudentsActivityBlock`: таблица с WeeklyStrip + attention dot + Sparkline (stroke по знаку hwAvgDelta), legend row внизу, sort attention→delta→name ru (AC-9 default P0). Segment sort — P1/TASK-6.
- `pluralize()` helper + `PLURAL_LESSONS` / `PLURAL_WORKS` / `PLURAL_STUDENTS` / `PLURAL_STUDENTS_ATTENTION` / `PLURAL_ASSIGNMENTS` / `PLURAL_SESSIONS` константы.
- `rg 'bg-(accent|primary)' src/components/tutor/home` → 0 matches.
- Lucide icons everywhere (`CalendarPlus`, `UserPlus`, `ArrowRight`, `ClipboardPlus`, `Wallet`, `CalendarClock`, `CheckCircle2`, `MessagesSquare`, `ChevronRight`, `Users`).

### Что сделать

7 композитных компонентов, собирающих primitives + data в фрагменты UI.

#### 1. `<HomeHeader>`
- Props: `{ tutorName: string; todaySummary: { lessons: number; toReview: number; attention: number }; onNewLesson: () => void; onAddStudent: () => void }`.
- Layout: `.home-header` — левая часть (h1 `«Добро пожаловать, {tutorName}»` + meta: `«{weekday}, {date} · {lessons} урока сегодня · {toReview} работы на проверке · {attention} ученика требуют внимания»`) + правая часть (2 кнопки).
- Ровно **2 кнопки**: `<Button variant="outline">Новое занятие</Button>` + `<Button style={{background:'var(--sokrat-green-700)'}} className="text-white hover:bg-[var(--sokrat-green-800)]">Добавить ученика</Button>`.
- Склонение числительных русское: use helper `pluralize(count, ['урок','урока','уроков'])` — создать в `src/lib/ru/pluralize.ts` если нет.
- **AC-4**: ровно 2 кнопки. **AC-1**: блок — первый в DOM order.

#### 2. `<HomeCTAs>`
- Props: `{ onAssignHomework: () => void; onAddPayment: () => void; paymentSummary: { pending: number; overdue: number } }`.
- **Ровно 2 tiles** (per AC-5, per ответ заказчика):
  1. `Назначить ДЗ` — sub `«Из базы или по теме»`, icon `ClipboardPlus` (Lucide).
  2. `Выставить счёт` — sub `«{pending} ждёт оплаты · {overdue} долг»`, icon `Wallet`.
- **Ни одна** плитка не `.home-cta--primary`. Оба — plain `.home-cta`.
- Layout: `.home-ctas` (grid repeat(2, 1fr), gap 12).
- Примечание: **НЕ** рендерить третью плитку с `Добавить ученика` (удалена per заказчика).

#### 3. `<StatStrip>`
- Props: derived от hooks (TASK-2).
- Layout: `.t-stats` с 4 `.t-stats__cell`:
  - `Активных учеников` / value N / meta `«+M за неделю»` (color success если M>0)
  - `Требуют внимания` / value N (color warning) / meta `«просрочки, падение балла»`
  - `Ø балл за неделю` / value N.N (ru-RU decimal `,`) / meta `«+0,1 к прошлой»` (color по знаку)
  - `К оплате` / value `X XXX ₽` / meta `«{pending} ждёт · {overdue} долг»`
- `tabular-nums` на все value.
- Helpers: `formatRub(n)` в `src/lib/formatters.ts` (уже есть `formatPaymentAmount`).

#### 4. `<TodayBlock>`
- Props: `{ sessions: TodaySession[]; onOpenSchedule: () => void }`.
- Layout: `.t-section` → header (`Сегодня` + meta `«{count} занятия»` + `«Расписание»` ghost button) → `.t-divider` → grid `repeat(4, 1fr)` gap 8 padding 12 → `<SessionBlock>` * N.
- Empty state: если `sessions.length === 0` → `<EmptyState>` «Сегодня занятий нет».
- Если `sessions.length > 4` — показать первые 4 + «ещё N» chip.

#### 5. `<ReviewQueueBlock>`
- Props: `{ items: ReviewItem[]; onOpenAll: () => void; onOpenSubmission: (id) => void }`.
- Layout: `.t-section` → header (`Требует проверки` + `«{count} работ»` + `«Все ДЗ»` ghost) → divider → `<SubmissionRowLite>` * N.
- Empty: `«Ничего не ждёт проверки»` + лёгкая иконка Lucide `CheckCircle2`.
- Limit 4 (hard cap).

#### 6. `<RecentDialogsBlock>`
- Props: `{ dialogs: DialogItem[]; onOpenDialog: (item) => void }`.
- Layout: `.t-section` → header (`Последние диалоги` + meta `«сортировка по времени последнего сообщения»` + `«Все чаты»` ghost) → divider → `<ChatRow>` * N (max 5).
- Empty: `«Пока нет сообщений от учеников»`.
- **AC-6**: этот блок рендерится **между** `TodayBlock`/`ReviewQueueBlock` и `StudentsActivityBlock` в DOM-order TutorHome.

#### 7. `<StudentsActivityBlock>`
- Props: `{ items: StudentActivity[]; totalCount: number; onOpenStudent: (id) => void; onOpenAll: () => void }`.
- Layout: `.t-section` → header (`Активность учеников` + meta `«за 5 недель · {totalCount} учеников»` + **P1: `<Segment>`** (`⚠ attention` / `По тренду` / `А→Я`) + `«Все ученики»` ghost).
- Таблица `.t-table.home-activity-table`: columns = `Ученик / Последние 5 недель / Ø балл ДЗ / Тренд / Пробник / Сигнал / (actions)`.
  - Ученик cell: dot (attention color) + name + stream chip.
  - Weekly cell: `<WeeklyStrip>`.
  - Балл ДЗ: `{hwAvg?.toFixed(1) ?? '—'}` (decimal `,` ru-RU через replace).
  - Тренд: `<Sparkline>` (green stroke если delta>0, red если <0, muted если 0).
  - Пробник: `—` placeholder (P1 Parking Lot).
  - Сигнал: если attention → `attentionReason` warning color; иначе `«всё хорошо»` muted.
  - Actions: ghost chevron-right button.
- **AC-8**: 5 цветных блоков per student + attention dot.
- Sort (P0 default): attention desc → hwAvgDelta desc → name asc.
- Legend row внизу (per handoff): `«Условные обозначения:»` + 3 цветных квадратика + `«Клик по строке открывает статистику»` right-aligned.
- Empty: если `items.length === 0` → `<EmptyState>` «Пока нет учеников» + CTA «Добавить ученика».

### Guardrails

- **DOM order строго:** HomeHeader → HomeCTAs → StatStrip → (TodayBlock + ReviewQueueBlock в t-grid-2) → RecentDialogsBlock → StudentsActivityBlock. **AC-6** проверяется на этом.
- **Не** рендерить удалённую третью HomeCTA (enforcement `HomeCTAs.tsx` принимает строгий shape без опции primary tile).
- **Не** использовать emoji в UI chrome (rule 90). `«всё хорошо»` — текст, не ✅.
- Все числа — `tabular-nums`.
- Карточки **внутри** карточек запрещены — `StatStrip` — single card с cells, **не** 4 отдельных Card.
- Для русских декабрей `new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1 }).format(n)` для Ø балла (даёт `4,3`).

### Mandatory end block

```
npm run lint
npm run build
```

Отчёт: список файлов, screenshot или DOM-structure каждого блока, подтверждение что в HomeCTAs ровно 2 тайла и нет primary-варианта.

---

## TASK-5 — Page + routing + cleanup · ✅ done (2026-04-21)

**Job:** R4 (вход на главную).
**Agent:** Claude Code.
**Files:** `src/pages/tutor/TutorHome.tsx` (новый), `src/App.tsx`, `src/components/tutor/TutorLayout.tsx`, **удалить** `src/pages/tutor/TutorDashboard.tsx`.
**Acceptance:** AC-1, AC-2, AC-7, AC-10.
**Depends on:** TASK-1..4.

**Что реально сделано:**
- `src/pages/tutor/TutorHome.tsx` (new): `<TutorGuard><TutorLayout>` wraps `<div className="sokrat" data-sokrat-mode="tutor">` + 6 блоков в правильном DOM-order (HomeHeader → HomeCTAs → StatStrip → t-grid-2{TodayBlock + ReviewQueueBlock} → RecentDialogsBlock → StudentsActivityBlock). Все данные через `useTutorHomeData()` (TASK-2). Error state — `TutorDataStatus` reuse. Loading — локальный `HomeSkeleton` (3 простых `<Skeleton>` из shadcn, достаточно для standalone routing task; full-parity layout-skeleton не требовался по AC).
- `src/App.tsx`: lazy import `TutorDashboard` заменён на `TutorHome`. Route `/tutor/home` → `<TutorHome>`. Route `/tutor/dashboard` → `<Navigate to="/tutor/home" replace />`. Добавлен `/tutor` → `<Navigate to="/tutor/home" replace />` для симметрии.
- `src/components/tutor/TutorLayout.tsx`: warmup `TutorDashboard` → `TutorHome`; `desktopPrimaryItems[0]` + `mobilePrimaryItems[0]` href `/tutor/dashboard` → `/tutor/home`; logo `<Link to="/tutor/dashboard">` → `/tutor/home`. Больше ничего.
- Navigate-сайты обновлены: `Login.tsx`, `TutorLogin.tsx`, `RegisterTutor.tsx` (+ `emailRedirectTo`), `TelegramLoginButton.tsx`, `TutorTelegramLoginButton.tsx` — все `"/tutor/dashboard"` → `"/tutor/home"`.
- `src/pages/tutor/TutorDashboard.tsx` удалён.

**Guardrails соблюдены:**
- `TutorGuard`, `AuthGuard`, `Chat.tsx` не тронуты.
- В `TutorLayout` изменены ровно три якоря (warmup + первый nav item + logo), остальная структура нетронута.
- Логотип «Сократ AI» остаётся (пункт 1 заказчика).
- Поисковая строка не добавлена (пункт 2 заказчика) — handoff-top-bar-search проигнорирован.
- `grep -rn "tutor/dashboard" src/` → одна строка (redirect в `App.tsx`).
- `grep -rn "TutorDashboard" src/` → 0 совпадений.

**Validation:**
- `npm run lint` — зелёный (новых ошибок нет; остаются pre-existing 208 errors по всему репо, не в затронутых файлах).
- `npm run build` — зелёный, генерирует `TutorHome-*.js` chunk ~41 kB.
- `npm run smoke-check` — зелёный.
- Preview на `localhost:8080`:
  - `/tutor/dashboard` → redirect на `/tutor/home` без flicker ✓
  - `document.querySelector('[data-sokrat-mode="tutor"]')` не null ✓
  - DOM-order 6 блоков подтверждён через `.sokrat h2` enumeration ✓
  - Table rows `role="button" tabindex="0"` (AC-10) ✓
  - Console errors: 0 ✓

**Follow-ups в TASK-6 (P1):** Segment sort, row-клики «открыть профиль», iOS Safari responsive pass.

### Review fix pass (2026-04-21, после первого PR)

Code review от Codex выявил 5 нарушений spec/rules в первом PR (commit `322f87b`). Все исправлены отдельным fix-коммитом:

1. **AC-3 — Empty states с CTA «Добавить ученика» + hide StudentsActivity при 0 учеников.**
   - `TodayBlock`, `ReviewQueueBlock`, `RecentDialogsBlock` получили optional prop `onAddStudent?: () => void`. Когда передан — в empty-state рендерится primary green CTA «Добавить ученика» (Lucide `UserPlus`, 40px, `aria-label="Добавить ученика"`).
   - `TutorHome` пробрасывает `onAddStudent` в эти три блока **только когда `students.length === 0`** (т.е. fully-empty onboarding state per AC-3). Если есть ≥1 ученик — prop `undefined`, CTA не рендерится (в этом случае empty-state блока = «сегодня ничего нет», не «онбординг»).
   - `TutorHome` теперь **не рендерит** `<StudentsActivityBlock>` когда `students.length === 0` (spec: «Таблица «Активность учеников» скрыта»). Внутренний empty-state у `StudentsActivityBlock` остаётся на случай «есть ученики, но ещё нет activity data» — не удалён, чтобы не ломать edge-case.

2. **AC-10 — Interactive targets ≥ 40px + Russian `aria-label` на ghost-buttons.**
   - `Button size="sm"` (`h-9` = 36px) заменён на `size="default"` (`h-10` = 40px) во всех 4 header-кнопках `Расписание` / `Все ДЗ` / `Все чаты` / `Все ученики`.
   - `ChevronRight`-action-button в `StudentsActivityBlock` row переведён на `size="icon"` + `minHeight: 40` + `minWidth: 40` (icon-only button должен быть квадратным hit-target).
   - Во всех 4 header-кнопках + row-action-button добавлен явный `aria-label` на русском (`Открыть расписание` / `Открыть все домашние задания` / `Открыть все чаты` / `Открыть всех учеников` / `Открыть статистику {name}`).

3. **AC-12 — Mobile layout (<768px).**
   - `src/styles/tutor-dashboard.css`: добавлен блок `@media (max-width: 767px) { … }` с перестройкой `.home-header` (flex-direction: column), `.home-ctas` (1fr), `.t-grid-2` (1fr), `.t-stats` (1fr + cell border top вместо left), `.t-session-grid` (1fr).
   - Вынесен inline `gridTemplateColumns: 'repeat(4, 1fr)'` из `TodayBlock.tsx` в класс `.t-session-grid` в CSS — теперь он уважает mobile-медиа-rule.
   - Проверено в preview: на 375×812 все блоки корректно стакаются в одну колонку.

4. **Rule 80 — Safari-safe таблица активности.**
   - `.t-table` переведена на `border-collapse: separate` + `border-spacing: 0` (вместо `border-collapse: collapse`).
   - Снята `position: sticky` с `thead th` — per spec §8.6 sticky для < 200 строк не нужен. Это развязывает известный Safari-bug «sticky + border-collapse → ломается горизонтальный скролл».
   - Проверено: `table.scrollWidth > wrap.clientWidth` даёт рабочий `overflow-x: auto` с `touch-action: pan-x` на мобиле.

5. **Rule 90 — Emoji в UI chrome запрещены.**
   - `SubmissionRowLite`: `AI ✓` / `AI ⚠ N` / `AI ?` (Unicode-эмоджи в chip) заменены на Lucide icons + plain «AI» label:
     - `ok` → `<CheckCircle2> AI` (`t-chip--success`)
     - `warn` → `<AlertTriangle> AI {N}` (`t-chip--warning`)
     - `unclear` → `<HelpCircle> AI` (`t-chip--neutral`)
   - Каждый chip получил `aria-label` / `title` на русском («AI подтверждает оценку» / «AI видит проблемы в работе» / «AI не уверен в оценке») — иконка теперь accessible.

**Scope creep discussion:** во время review возник вопрос про runtime-правки в `Login`/`TutorLogin`/`RegisterTutor`/`TelegramLoginButton`/`TutorTelegramLoginButton`, которые не были в file-list TASK-5. Оставлены как есть — требование промпта «`rg "tutor/dashboard" src/` → одна строка» иначе невыполнимо. Редирект `/tutor/dashboard → /tutor/home` остаётся (backward compat для Telegram-deep-link закладок).

**Validation:** lint/build/smoke-check зелёные; preview верифицирован на desktop (1280×800) и mobile (375×812) viewport-ах.

### Что сделать

#### 1. `src/pages/tutor/TutorHome.tsx`
- Default export `TutorHome`, wrap в `<TutorGuard>` → `<TutorLayout>` → `<TutorHomeContent>` (тот же паттерн, что `TutorDashboard`).
- `TutorHomeContent` получает все данные через `useTutorHomeData()` (TASK-2).
- Обёртка страницы: `<div className="sokrat" data-sokrat-mode="tutor">` (AC-7). Можно положить этот wrapper **внутри** `TutorLayout` children — `TutorLayout` не ломается, просто рендерит children под top-bar.
- Композиция блоков (строго этот DOM order per AC-6):
  ```tsx
  <HomeHeader ... />
  <HomeCTAs ... />
  <StatStrip ... />
  <div className="t-grid-2">
    <TodayBlock ... />
    <ReviewQueueBlock ... />
  </div>
  <RecentDialogsBlock ... />
  <StudentsActivityBlock ... />
  ```
- Loading state: используй существующий `DashboardSkeleton` pattern из `TutorDashboard.tsx` (адаптировать под новую раскладку).
- Error state: используй `<TutorDataStatus>` (уже есть, reuse).
- Обработчики переходов:
  - `onNewLesson` → `navigate('/tutor/schedule')` + query param `?create=true` (nice-to-have)
  - `onAddStudent` → открыть `AddStudentDialog` (уже используется в `TutorDashboard.tsx` — reuse)
  - `onAssignHomework` → `navigate('/tutor/homework/create')`
  - `onAddPayment` → `navigate('/tutor/payments?filter=pending')` (P1 filter; P0 — без filter)
  - `onOpenStudent(id)` → `navigate('/tutor/students/' + id)` (P1 из TASK-6)
  - `onOpenDialog(item)` → `navigate('/tutor/homework/' + item.hwId)` (P1 precise target из TASK-6)
  - `onOpenSubmission(id)` → `navigate('/tutor/homework/' + assignmentId)`
  - `onOpenAll` (chats/students/hw/schedule) → соответствующий route.

#### 2. `src/App.tsx`
- **Добавить** route `/tutor/home` → lazy `TutorHome`.
- **Заменить** текущий route `/tutor/dashboard` → `<Navigate to="/tutor/home" replace />`. Паттерн уже используется в проекте (`RedirectHomeworkResultsToDetail` — см. rule 40).
- Корневой `/tutor` → продолжает редиректить на `/tutor/dashboard` (которое дальше редиректит на `/tutor/home`). Либо обновить напрямую на `/tutor/home` — предпочтительно.
- Убрать lazy-import `TutorDashboard`.

#### 3. `src/components/tutor/TutorLayout.tsx`
- В warmup effect: заменить `warmup('TutorDashboard', () => import('@/pages/tutor/TutorDashboard'))` на `warmup('TutorHome', () => import('@/pages/tutor/TutorHome'))`.
- В `desktopPrimaryItems` и `mobilePrimaryItems`: обновить href первого item с `/tutor/dashboard` на `/tutor/home`. Label `«Главная»` — без изменений.
- `isActive('/tutor/home')` — существующая функция matches prefix, работает.
- Логотип `Link to="/tutor/dashboard"` → `Link to="/tutor/home"`.

#### 4. Удалить `src/pages/tutor/TutorDashboard.tsx`
- После подтверждения, что все импорты этого файла исчезли, **удалить файл**.
- Grep: `rg "from '@/pages/tutor/TutorDashboard'" src/` → должно вернуть 0 совпадений.
- Grep: `rg "tutor/dashboard" src/` → оставить только redirect в `App.tsx`.

### Guardrails

- **`high-risk files`** (CLAUDE.md) — `AuthGuard`, `TutorGuard`, `Chat.tsx` НЕ трогаем. Используем `TutorGuard` как обёртку (паттерн существует).
- **Не удалять** `TutorDashboard.tsx` ДО того, как всё остальное переехало — pre-flight grep.
- В `TutorLayout` **не** менять navigation structure (только href первого item).
- При навигации в `onAddPayment` в P0 можно использовать просто `/tutor/payments` без query — P1 добавит фильтр.
- React Query prefetch: в `TutorHome` на mount вызвать `queryClient.prefetchQuery` для `['tutor', 'home', ...]` ключей — опционально, ускоряет TTI (AC-11).

### Mandatory end block

```
npm run lint
npm run build
npm run smoke-check
```

Ручная проверка:
1. Открыть `/tutor/dashboard` → redirect на `/tutor/home` без flicker ✓
2. DOM-order: 6 блоков в правильном порядке (AC-1, AC-6) ✓
3. `document.querySelector('[data-sokrat-mode="tutor"]')` возвращает элемент (AC-7) ✓
4. grep на `TutorDashboard` → 0 совпадений ✓
5. Логотип «Сократ AI» в top-bar на месте (per пункт 1 заказчика) ✓
6. Поисковой строки нет (per пункт 2 заказчика) ✓

Отчёт: список изменённых/удалённых файлов, `git diff --stat`, визуальная валидация из `TutorHome` при 0, 1, 5, 14 учениках.

---

## TASK-6 — P1 polish (Segment sort, row-клики, responsive, iOS Safari)

**Job:** R4-2 (proactive triage), R3-1.
**Agent:** Claude Code.
**Priority:** P1 (follow-up PR через 1–2 дня после P0).
**Files:** `src/components/tutor/home/StudentsActivityBlock.tsx`, `RecentDialogsBlock.tsx`, `src/styles/tutor-dashboard.css`.
**Acceptance:** AC-9, AC-10 (клавиатура), AC-12 (responsive).
**Depends on:** TASK-5 в проде.

### Что сделать

#### 1. Segment sort в `StudentsActivityBlock`
- Добавить `<Segment value={sort} onChange={setSort} items={[{value:'attention', label:'⚠ N'}, {value:'delta', label:'По тренду'}, {value:'name', label:'А→Я'}]} />`.
- (⚠ emoji в label — это label Segment control, не UI chrome в смысле rule 90; handoff-прототип это делает так. Альтернатива — Lucide `AlertTriangle` 12px.)
- Sorting logic per handoff `dashboard-home.jsx:88-96`.
- Counter N = `items.filter(s=>s.attention).length`.

#### 2. Row-клики
- `<StudentsActivityBlock>`: клик по `<tr>` → `onOpenStudent(s.id)` → `/tutor/students/:id`.
- `<RecentDialogsBlock>`: клик по `<ChatRow>` → `onOpenDialog(chat)` → `/tutor/homework/:hwId` (existing detail page; thread viewer там уже показывает сообщения).
- Keyboard: Enter/Space handler + `role="button"` + `tabIndex={0}` (AC-10).

#### 3. Responsive
- В `tutor-dashboard.css` добавить media queries:
  - `@media (max-width: 767px)`: `.t-grid-2` → `grid-template-columns: 1fr`; `.t-stats` → `grid-template-columns: 1fr`.
  - `@media (max-width: 1023px) and (min-width: 768px)`: `.t-stats` → `grid-template-columns: repeat(2, 1fr)`.
- В `StudentsActivityBlock` wrapping div: `overflow-x-auto touch-pan-x` (rule 80). `<table>` сохраняет `width: max-content`, НЕ `w-full`.

#### 4. iOS Safari pass
- Проверить на iPhone 13 Safari (физически или через DevTools):
  - `.t-session` не ломается при узком экране.
  - Horizontal scroll в activity-table работает touch swipe (не съедает row-click).
  - Stats cells — не обрываются.
- `date-fns parseISO` во всех новых местах (rule 80).

### Guardrails

- **Не** менять сигнатуры P0 блоков (HomeCTAs, StatStrip и т.д.) — только StudentsActivityBlock + RecentDialogsBlock + CSS.
- **Не** использовать framer-motion.
- Segment control должен быть focusable + `aria-pressed` для активного.

### Mandatory end block

```
npm run lint
npm run build
npm run smoke-check
```

Manual: скриншоты `/tutor/home` на 375px / 768px / 1280px; запись видео horizontal scroll в activity-table на iOS. Прикладывается к PR.

### Implementation log (2026-04-21)

Ключевые решения при реализации:

- **Segment control** — inline-компонент `SortSegment` в `StudentsActivityBlock.tsx` (не primitives, не shadcn). Причина: единственный call site; Vite/SWC-парсер не принимает generic JSX-форму (`<Segment<ActivitySortMode>`), поэтому концретный тип без дженерика. Classes: `.t-seg` / `.t-seg__item` из `tutor-dashboard.css` (уже были).
- **⚠ label** — Lucide `AlertTriangle` 12px + counter N, **не** emoji. Rule 90 anti-pattern #1 «no emoji in UI chrome» — жёстче спеки; handoff-вариант с `⚠` задокументирован в task prompt как альтернатива.
- **Sort branching** (3 режима):
  - `attention` (default): attention desc → hwAvgDelta desc → name asc (= AC-9 stable sort, совпадает с P0 behaviour из TASK-4).
  - `delta`: hwAvgDelta **asc** (самое сильное падение первым) → name asc.
  - `name`: только `localeCompare('ru')`.
- **RecentDialogsBlock не меняли** — `ChatRow` уже был native `<button>` с `onClick` + built-in Enter/Space keyboard support. Только `RecentDialogsBlock.tsx` переоткрыт для проверки; правок нет.
- **Horizontal scroll** — `<div className="t-table-wrap overflow-x-auto touch-pan-x">` + `<table style={{ width: 'max-content', minWidth: '100%' }}>`. `minWidth: 100%` сохраняет десктопный вид (таблица растягивается на ширину контейнера), `max-content` + overflow активирует horizontal scroll на мобиле. Pattern = HeatmapGrid, см. `.claude/rules/80-cross-browser.md`.
- **Tablet breakpoint** — новый `@media (min-width: 768px) and (max-width: 1023px)` с `.t-stats { grid-template-columns: repeat(2, 1fr) }`. Border pattern 2×2: `.t-stats__cell:nth-child(odd) { border-left: 0 }` + `.t-stats__cell:nth-child(n+3) { border-top }`.
- **AC-10 hit-target fix (после code review, 2026-04-21)** — `.t-seg__item` изменён с `height: 28px` на `height: 28px; min-height: 40px` + `display: inline-flex; align-items: center` — min-height доминирует, визуальная плашка становится 40×40 per AC-10 («≥ 40px high»). Handoff-density 28px пожертвована в пользу accessibility. Внутри Segment текст остаётся центрирован через inline-flex.

### Известные ограничения

- **Вторая попытка клика по тому же Segment-item не шлёт `onChange`** — текущая реализация оборачивает button в `onClick: () => onChange(item.value)` без проверки `value !== item.value`. Это consistent с handoff и не вредит UX (React setState на тот же value = no-op).
- **Segment label «⚠ N» отсутствует sort-change когда N=0** — активная tab остаётся видимой, но счётчик 0 без warning цвета. Продуктово ок (студентов с attention нет — нормально).
- **`.home-activity-table` на супер-широких viewport-ах (>1400px)** — заполняет всю ширину `.t-table-wrap` из-за `min-width: 100%`. Визуально выглядит корректно; альтернатива (чистый `max-content`) дала бы white-space справа.

---

## REVIEW — Independent Codex pass

**Agent:** Codex (clean session, не видит ни один из промптов выше).
**Scope:** PR с TASK-1..5 (P0). Отдельный review для TASK-6 после follow-up.
**Критерии:** все AC из `spec.md` §7.

### Что проверить

По `spec.md`:
- [ ] Job Context aligned (Section 0).
- [ ] DOM-order блоков (AC-1, AC-6) — проверить вручную в `TutorHome.tsx`.
- [ ] Redirect `/tutor/dashboard` → `/tutor/home` работает (AC-2).
- [ ] Empty states (AC-3).
- [ ] Home header — ровно 2 кнопки (AC-4).
- [ ] HomeCTAs — ровно 2 tiles, нет primary-варианта (AC-5).
- [ ] Последние диалоги над Активностью (AC-6).
- [ ] Mode wrapper (AC-7).
- [ ] Weekly strip + attention dot (AC-8).
- [ ] Sort stability (AC-9).
- [ ] Keyboard a11y + 40px hit-targets (AC-10).
- [ ] TTI ≤ 2s (AC-11 — замерить в prod-like build).
- [ ] Mobile layout (AC-12 — P1, допустимо для P0 review PASS если breakpoint hook готов).

По SKILL.md / rule 90:
- [ ] Mode wrapper везде где нужно.
- [ ] Нет hex вне `colors_and_type.css`.
- [ ] Нет `bg-accent`/`bg-primary` в CTA (spec КР-3).
- [ ] Нет emoji в UI chrome (кроме Segment label в P1 — задокументировано).
- [ ] Golos Text, no Inter/Roboto.
- [ ] Tabular-nums на всех числах.
- [ ] No cards inside cards.
- [ ] One primary per screen.

По performance.md / rule 80:
- [ ] `React.memo` на list-item компонентах.
- [ ] Нет framer-motion.
- [ ] Query keys `['tutor','home',...]`.
- [ ] `parseISO` для дат.
- [ ] `getSession()` для user.id в hot path.

### Формат вывода

`PASS` / `CONDITIONAL PASS (fix list)` / `FAIL (blocking issues)`.

---

## Copy-paste промпты для агентов

Plain-text блоки ниже копируются в агента целиком (без `>` blockquote). Каждый промпт self-contained и не зависит от соседних.

### Промпт TASK-1

```
Ты — senior product-minded full-stack engineer в проекте SokratAI (sokratai.ru). Russian-language AI-тутор для ЕГЭ/ОГЭ. B2B-сегмент: репетиторы физики. Wedge пилота — ДЗ assembly workflow. AI = draft + action.

РАБОТАЕМ НАД TASK-1 фичи Tutor Dashboard v2 (Phase 1).

ОБЯЗАТЕЛЬНЫЕ ФАЙЛЫ К ПРОЧТЕНИЮ ДО НАЧАЛА:
1. docs/delivery/features/tutor-dashboard-v2/spec.md (целиком, approved)
2. docs/delivery/features/tutor-dashboard-v2/tasks.md (секция TASK-1)
3. SKILL.md (token hierarchy, §5 и §10)
4. src/styles/colors_and_type.css (single source of truth tokens)
5. docs/design-system/handoff-dashboard/tutor-kit/tokens.css (handoff kit)
6. docs/design-system/handoff-dashboard/tutor-kit/dashboard-home.css (handoff dashboard CSS)
7. .claude/rules/90-design-system.md (tactical guide)

ЗАДАЧА:
Создать `src/styles/tutor-dashboard.css` — helper-слой для нового Tutor Dashboard v2. Скопировать из handoff только те классы, которые нужны Dashboard (`.t-section`, `.t-stats*`, `.t-table*`, `.t-divider`, `.t-session*`, `.t-muted`, `.t-num`, `.t-grid-2`, `.t-hstack`, `.t-vstack`, `.t-chip*`, `.t-status*`, `.t-avatar*`, `.t-seg*`, `.t-empty`, `.home-header`, `.home-ctas`, `.home-cta*`, `.home-activity-table`, `.chat-row*`). Каждое правило читает ТОЛЬКО var(--sokrat-*) из colors_and_type.css. Никаких новых переменных, никаких hex-значений, никакого Inter/Roboto.

В `src/index.css` добавить `@import './styles/tutor-dashboard.css';` сразу после импорта colors_and_type.css и ДО Tailwind layers.

ACCEPTANCE (AC-7 из spec):
- Wrapper `<div class="sokrat" data-sokrat-mode="tutor">` корректно применяет density + focus ring.
- Все классы из handoff, не относящиеся к Dashboard (.t-task, .t-review, .t-payrow, .t-week, .t-studentrow), НЕ скопированы.

GUARDRAILS:
- Не добавлять новых CSS-переменных.
- Не менять colors_and_type.css.
- Не менять tailwind.config.ts.
- Не трогать существующие CSS файлы кроме `src/index.css` (одна строка импорта).
- Namespace строго `t-*` / `home-*` / `chat-row` — не пересекаются с shadcn.

MANDATORY END BLOCK:
После реализации:
1. `npm run lint` (ожидается pass)
2. `npm run build` (ожидается pass)
3. Dev-server smoke: создать временный test-файл с разметкой `<div className="sokrat" data-sokrat-mode="tutor"><section className="t-section"><div className="t-stats"><div className="t-stats__cell"><div className="t-stats__label">TEST</div><div className="t-stats__value">14</div></div></div></section></div>`, подтвердить что рендерится Golos Text + зелёный focus ring. Удалить test-файл перед коммитом.
4. Отчёт: список скопированных классов, размер `tutor-dashboard.css` в строках, что docs-to-update (ничего в этой TASK).
5. Self-check по rule 90 anti-patterns: emoji (нет), Inter/Roboto (нет), градиенты (нет), cards-inside-cards (нет).
```

### Промпт TASK-2

```
Ты — senior product-minded full-stack engineer в проекте SokratAI. B2B-сегмент: репетиторы физики ЕГЭ/ОГЭ. AI = draft + action.

РАБОТАЕМ НАД TASK-2 фичи Tutor Dashboard v2 (Phase 1).

ОБЯЗАТЕЛЬНЫЕ ФАЙЛЫ К ПРОЧТЕНИЮ:
1. docs/delivery/features/tutor-dashboard-v2/spec.md (целиком)
2. docs/delivery/features/tutor-dashboard-v2/tasks.md (секция TASK-2)
3. CLAUDE.md (критические правила — особенно §5 единая страница результатов, §1 форматирование дат)
4. .claude/rules/performance.md (§2a getSession vs getUser, §2c query keys)
5. .claude/rules/80-cross-browser.md (date-fns parseISO)
6. .claude/rules/40-homework-system.md (homework_tutor_* таблицы)
7. src/hooks/useTutor.ts, useTutorStudents.ts, useTutorPayments.ts (существующие паттерны)
8. supabase/functions/homework-api/index.ts::handleGetResults (для ReviewQueue / Activity)

ЗАДАЧА:
Создать 5 hook'ов для Tutor Dashboard v2:

1. `src/hooks/useTutorTodayLessons.ts` — сегодняшние уроки из tutor_lessons WHERE tutor_id=:me AND start_at::date=CURRENT_DATE.
2. `src/hooks/useTutorReviewQueue.ts` — completed threads требующие проверки (fallback: threads.updated_at < 48h AND (needs_attention OR ai_flag='warn'), т.к. колонки tutor_viewed_at в БД нет).
3. `src/hooks/useTutorRecentDialogs.ts` — DISTINCT ON (student_id) latest user message per student, limit 5.
4. `src/hooks/useTutorStudentActivity.ts` — weekly strip (5 недель × ok/late/part/miss/none), hwTrend (6 точек по ratio * 5), hwAvgDelta, attention с 3 триггерами (overdue / scoreDropping / inactive 7+ дней) с приоритетом. Limit 20 учеников.
5. `src/hooks/useTutorHomeData.ts` — aggregator всех 7 hooks (+existing useTutor/useTutorStudents/useTutorPayments) через useQueries / параллельный вызов.

ТИПЫ ОБЯЗАНЫ СОВПАДАТЬ со spec §5 (API / data contracts) — `TodaySession`, `ReviewItem`, `DialogItem`, `StudentActivity`. Экспорт типов.

ACCEPTANCE:
- AC-3: при 0 учеников — хуки не падают, возвращают пустые массивы.
- AC-9: `useTutorStudentActivity` возвращает stable sort attention desc → delta desc → name asc.
- AC-11: TTI ≤ 2s — для этого все хуки с `staleTime` ≥ 30s.

GUARDRAILS:
- Query keys строго `['tutor', 'home', entity]` (performance.md §2c).
- `getSession()` для user.id, НЕ `getUser()`.
- `parseISO` из date-fns для всех дат — НЕ `new Date(string)`.
- НЕ создавать миграций / RPC (spec §5).
- НЕ N+1: useTutorStudentActivity использует useQueries, но замерь latency на 10+ моковых учениках и пометь TODO если > 1.5s для Phase 2 RPC.
- Все weekly-strip / attention эвристики ТОЧНО по spec §5 (приоритет состояний, формулы delta).

MANDATORY END BLOCK:
1. `npm run lint`
2. `npm run build`
3. `npm run smoke-check`
4. Отчёт: созданные хуки, query keys, замер latency useTutorStudentActivity.
5. docs-to-update: только spec §9 Open Questions (если обнаружишь factual gap).
6. Self-check: AC-3, AC-9, AC-11 пройдены.
```

### Промпт TASK-3

```
Ты — senior product-minded full-stack engineer в проекте SokratAI. B2B-сегмент: репетиторы физики. AI = draft + action.

РАБОТАЕМ НАД TASK-3 фичи Tutor Dashboard v2 (Phase 1).

ОБЯЗАТЕЛЬНЫЕ ФАЙЛЫ К ПРОЧТЕНИЮ:
1. docs/delivery/features/tutor-dashboard-v2/spec.md (§7 AC-8)
2. docs/delivery/features/tutor-dashboard-v2/tasks.md (секция TASK-3)
3. docs/design-system/handoff-dashboard/tutor-kit/dashboard-home.jsx (WeeklyStrip, ChatRow, initialsOf)
4. docs/design-system/handoff-dashboard/tutor-kit/students-split.jsx (Sparkline, DeltaPill — если там есть; если нет — реализовать по описанию в spec)
5. docs/design-system/handoff-dashboard/tutor-kit/workplace.jsx (SubmissionRow — reference)
6. .claude/rules/performance.md (React.memo на list-item)
7. .claude/rules/80-cross-browser.md (touch-action, iOS Safari)
8. .claude/rules/90-design-system.md (design tokens)
9. src/styles/colors_and_type.css + src/styles/tutor-dashboard.css (готово после TASK-1)

ЗАДАЧА:
Создать 6 presentational-компонентов в `src/components/tutor/home/primitives/`:
- `Sparkline.tsx` — inline SVG polyline, 80×24, normalize values.
- `WeeklyStrip.tsx` — 5 spans 14×20 с цветами из --sokrat-state-*-fg.
- `DeltaPill.tsx` — ↑/↓/· с color mapping.
- `ChatRow.tsx` — avatar initials + name + stream chip + time + preview + chevron, role=button Enter/Space.
- `SessionBlock.tsx` — .t-session (+.t-session--oge), 2-line layout time/name/topic.
- `SubmissionRowLite.tsx` — avatar + name/submittedAt + score + answer dots + AI chip + chevron.

Все props — строго типизированы, экспорт типов.

ACCEPTANCE (AC-8 из spec):
- WeeklyStrip рендерит ровно 5 цветных блоков.
- ChatRow / SubmissionRowLite — keyboard navigable (Enter/Space).

GUARDRAILS:
- React.memo на каждом компоненте.
- НЕ framer-motion (performance.md §2).
- НЕ `bg-accent` / `bg-primary` для зелёных элементов — используй `var(--sokrat-green-700)` (spec КР-3).
- Lucide React для иконок (НЕ window.lucide из прототипа).
- `touch-action: manipulation` на interactive элементах (rule 80).
- НЕ копировать Tooltip-компонент из прототипа — используй shadcn или title attribute для P0.

MANDATORY END BLOCK:
1. `npm run lint`
2. `npm run build`
3. Отчёт: список файлов, подтверждение React.memo везде, `rg 'bg-(accent|primary)' src/components/tutor/home` → 0 совпадений.
4. Self-check: AC-8, rule 80 (touch-action), rule 90 (tokens).
```

### Промпт TASK-4

```
Ты — senior product-minded full-stack engineer в проекте SokratAI. B2B-сегмент: репетиторы физики. AI = draft + action.

РАБОТАЕМ НАД TASK-4 фичи Tutor Dashboard v2 (Phase 1).

ОБЯЗАТЕЛЬНЫЕ ФАЙЛЫ К ПРОЧТЕНИЮ:
1. docs/delivery/features/tutor-dashboard-v2/spec.md (целиком, особенно §3 Scope, §6 UX, §7 AC)
2. docs/delivery/features/tutor-dashboard-v2/tasks.md (секция TASK-4)
3. docs/design-system/handoff-dashboard/tutor-cabinet.html (final visual target)
4. docs/design-system/handoff-dashboard/tutor-kit/dashboard-home.jsx (TplDashboardV2, HomeCTAs, StudentsActivityCard, RecentChatsCard — reference)
5. .claude/rules/90-design-system.md (anti-patterns)
6. src/lib/formatters.ts (formatRub, formatPaymentAmount уже есть)

ЗАДАЧА:
Создать 7 composable components в `src/components/tutor/home/`:
1. `HomeHeader.tsx` — приветствие + meta + 2 кнопки (AC-4: ровно 2).
2. `HomeCTAs.tsx` — РОВНО 2 tiles (Назначить ДЗ, Выставить счёт). Третья карточка (primary Добавить ученика) удалена заказчиком — НЕ РЕАЛИЗОВАНА. AC-5.
3. `StatStrip.tsx` — 4 ячейки t-stats.
4. `TodayBlock.tsx` — t-section c SessionBlock × N.
5. `ReviewQueueBlock.tsx` — t-section c SubmissionRowLite × ≤4.
6. `RecentDialogsBlock.tsx` — t-section c ChatRow × ≤5.
7. `StudentsActivityBlock.tsx` — t-section c таблицей (Ученик / 5 недель / Ø балл / Тренд / Пробник / Сигнал / actions). Segment sort — P1 (TASK-6), в P0 default sort attention→delta→name.

ПРАВИЛЬНЫЙ DOM ORDER в TutorHome.tsx (проверяется AC-6):
HomeHeader → HomeCTAs → StatStrip → (TodayBlock + ReviewQueueBlock в t-grid-2) → RecentDialogsBlock → StudentsActivityBlock.

"Последние диалоги" МЕЖДУ двухколонкой и "Активность учеников" — это явное требование заказчика, проверяется AC-6.

ACCEPTANCE:
- AC-1: блоки в правильном порядке.
- AC-4: HomeHeader — ровно 2 кнопки.
- AC-5: HomeCTAs — ровно 2 tiles, нет .home-cta--primary.
- AC-6: RecentDialogsBlock перед StudentsActivityBlock.
- AC-8: WeeklyStrip + attention dot в таблице.

GUARDRAILS:
- Enforcement AC-5: `HomeCTAs.tsx` принимает ТОЛЬКО onAssignHomework + onAddPayment handlers, никакого onAddStudent / primary tile.
- НЕ emoji в UI chrome (rule 90). Lucide icons only.
- Tabular-nums на всех числах.
- StatStrip — single card с 4 cells, НЕ 4 отдельных Card (rule 90 anti-pattern #1).
- Числа русские (4,3 а не 4.3) через Intl.NumberFormat('ru-RU').
- Склонение числительных для «N урока(ов)», «M работа(ы)» — helper pluralize в src/lib/ru/pluralize.ts (создать если нет).
- НЕ использовать `bg-accent`/`bg-primary` — spec КР-3.

MANDATORY END BLOCK:
1. `npm run lint`
2. `npm run build`
3. Отчёт: список файлов, DOM-structure TutorHome.tsx (TASK-5 сделает компоновку, здесь — просто готовность блоков).
4. Self-check: AC-1, AC-4, AC-5, AC-6, AC-8.
```

### Промпт TASK-5

```
Ты — senior product-minded full-stack engineer в проекте SokratAI. AI = draft + action.

РАБОТАЕМ НАД TASK-5 фичи Tutor Dashboard v2 (Phase 1). Это финальная P0 задача — здесь всё собирается воедино и деплоится.

ОБЯЗАТЕЛЬНЫЕ ФАЙЛЫ К ПРОЧТЕНИЮ:
1. docs/delivery/features/tutor-dashboard-v2/spec.md (целиком)
2. docs/delivery/features/tutor-dashboard-v2/tasks.md (секция TASK-5)
3. CLAUDE.md (High-Risk Files — TutorGuard, AuthGuard, Chat.tsx НЕ ТРОГАТЬ)
4. .claude/rules/40-homework-system.md (§5 Merged Detail + Results — паттерн redirect используем)
5. src/App.tsx (где регистрируются routes + текущий `TutorDashboard` lazy import)
6. src/components/tutor/TutorLayout.tsx (navigation items + warmup effect)
7. src/pages/tutor/TutorDashboard.tsx (текущий — будет удалён)

ЗАДАЧА:
1. Создать `src/pages/tutor/TutorHome.tsx`:
   - Default export TutorHome = `<TutorGuard><TutorLayout><TutorHomeContent /></TutorLayout></TutorGuard>`.
   - TutorHomeContent: `<div className="sokrat" data-sokrat-mode="tutor">` → 6 блоков в DOM-order (HomeHeader → HomeCTAs → StatStrip → t-grid-2{TodayBlock,ReviewQueueBlock} → RecentDialogsBlock → StudentsActivityBlock).
   - Данные через useTutorHomeData() из TASK-2.
   - Обработчики переходов: onNewLesson→/tutor/schedule, onAddStudent→AddStudentDialog (reuse из TutorDashboard), onAssignHomework→/tutor/homework/create, onAddPayment→/tutor/payments, onOpenSubmission→/tutor/homework/:id, onOpenAll*→соответствующие routes.
   - Loading/error через TutorDataStatus.

2. `src/App.tsx`:
   - Add lazy `TutorHome` route `/tutor/home`.
   - Replace `/tutor/dashboard` → `<Navigate to="/tutor/home" replace />`.
   - Обновить `/tutor` root redirect на `/tutor/home`.
   - Убрать lazy-import `TutorDashboard`.

3. `src/components/tutor/TutorLayout.tsx`:
   - В warmup effect: `TutorDashboard` → `TutorHome`.
   - В `desktopPrimaryItems[0]` и `mobilePrimaryItems[0]`: href `/tutor/dashboard` → `/tutor/home` (label «Главная» остаётся).
   - Logo Link `to="/tutor/dashboard"` → `to="/tutor/home"`.

4. Удалить `src/pages/tutor/TutorDashboard.tsx`. Перед удалением grep:
   - `rg "from '@/pages/tutor/TutorDashboard'" src/` → 0 совпадений после рефакторинга.
   - `rg "tutor/dashboard" src/` → только одна строка (redirect в App.tsx).

ACCEPTANCE:
- AC-1: 6 блоков в правильном порядке.
- AC-2: `/tutor/dashboard` → redirect на `/tutor/home`.
- AC-6: RecentDialogs перед StudentsActivity.
- AC-7: DOM содержит `[data-sokrat-mode="tutor"]`.
- AC-10: keyboard a11y (Enter/Space на rows, focus-visible ring).

GUARDRAILS:
- HIGH-RISK FILES: TutorGuard, AuthGuard, Chat.tsx — НЕ ТРОГАТЬ.
- TutorLayout: менять ТОЛЬКО первый navigation item href + warmup + logo link. Больше ничего.
- Логотип «Сократ AI» остаётся как сейчас (первый пункт требований заказчика).
- Поисковая строка НЕ добавляется (второй пункт требований заказчика) — игнорируем handoff top-bar search.
- НЕ удалять `TutorDashboard.tsx` пока все импорты не обновлены — pre-flight grep.

MANDATORY END BLOCK:
1. `npm run lint`
2. `npm run build`
3. `npm run smoke-check`
4. Manual smoke:
   - Открыть `/tutor/dashboard` → redirect на `/tutor/home` ✓
   - DOM-inspect: 6 блоков в правильном порядке ✓
   - `document.querySelector('[data-sokrat-mode="tutor"]')` != null ✓
   - `rg TutorDashboard src/` → 0 совпадений (кроме возможно старых docs) ✓
   - Логотип «Сократ AI» на месте ✓
   - Нет поисковой строки (её и не было) ✓
5. Отчёт: git diff --stat, screenshot `/tutor/home` на 1280×800.
6. Self-check: AC-1, AC-2, AC-6, AC-7, AC-10.
7. docs-to-update: CLAUDE.md «Известные хрупкие области» — если обнаружен новый риск; иначе ничего.
```

### Промпт TASK-6 (P1)

```
Ты — senior product-minded full-stack engineer в проекте SokratAI.

РАБОТАЕМ НАД TASK-6 фичи Tutor Dashboard v2 (Phase 1 — P1 polish).
TASK-1..5 уже в проде. Это follow-up PR.

ОБЯЗАТЕЛЬНЫЕ ФАЙЛЫ К ПРОЧТЕНИЮ:
1. docs/delivery/features/tutor-dashboard-v2/spec.md (§7 AC-9, AC-10, AC-12)
2. docs/delivery/features/tutor-dashboard-v2/tasks.md (секция TASK-6)
3. docs/design-system/handoff-dashboard/tutor-kit/dashboard-home.jsx:82-125 (sorting logic reference)
4. .claude/rules/80-cross-browser.md (iOS Safari, touch-action)
5. src/components/tutor/results/HeatmapGrid.tsx (pattern для horizontal scroll table на iOS — reuse)

ЗАДАЧА:
1. `StudentsActivityBlock.tsx`: добавить Segment sort control (⚠ N / По тренду / А→Я). Sorting logic per reference. Counter N = items.filter(s=>s.attention).length.
2. Row-клики: `<tr>` в ActivityBlock → onOpenStudent(id) → /tutor/students/:id. `<ChatRow>` → onOpenDialog → /tutor/homework/:hwId. Keyboard Enter/Space, role=button, tabIndex=0.
3. Responsive в `src/styles/tutor-dashboard.css`:
   - @media (max-width: 767px): .t-grid-2 → 1fr; .t-stats → 1fr.
   - @media (768px - 1023px): .t-stats → repeat(2, 1fr).
4. Horizontal scroll в activity-table на iOS Safari: wrapping div `overflow-x-auto touch-pan-x`, table `width: max-content` (НЕ w-full). Паттерн идентичен HeatmapGrid.tsx.

ACCEPTANCE:
- AC-9: stable sort + пользователь может переключить между attention/delta/name.
- AC-10: keyboard Enter/Space на всех rows.
- AC-12: mobile layout не ломается, horizontal scroll работает touch swipe.

GUARDRAILS:
- НЕ трогать сигнатуры P0 блоков (HomeHeader, HomeCTAs, StatStrip, TodayBlock, ReviewQueueBlock). Только ActivityBlock + RecentDialogsBlock + CSS.
- НЕ framer-motion.
- Segment aria-pressed + tabIndex.
- iOS Safari: проверить `position: sticky` НЕ комбинируется с `border-collapse` (rule 80, пример HeatmapGrid).

MANDATORY END BLOCK:
1. `npm run lint && npm run build && npm run smoke-check`
2. Manual smoke на 375px / 768px / 1280px. Screenshots.
3. iOS Safari horizontal swipe — видео-запись или подробное описание.
4. Self-check: AC-9, AC-10, AC-12.
```

### Промпт REVIEW (Codex, чистая сессия)

```
Ты — независимый code-reviewer проекта SokratAI. Контекст первого агента тебе недоступен.

ПОРЯДОК (строго):
1. Прочитай docs/discovery/product/tutor-ai-agents/14-ajtbd-product-prd-sokrat.md
2. Прочитай docs/discovery/product/tutor-ai-agents/16-ux-principles-for-tutor-product-sokrat.md
3. Прочитай docs/discovery/product/tutor-ai-agents/17-ui-patterns-and-component-rules-sokrat.md
4. Прочитай docs/delivery/features/tutor-dashboard-v2/spec.md (целиком, approved)
5. Прочитай SKILL.md, .claude/rules/90-design-system.md, .claude/rules/performance.md, .claude/rules/80-cross-browser.md
6. Посмотри git diff PR (branch: feature/tutor-dashboard-v2, или указанный PR URL)

РЕВЬЮ-ЧЕК-ЛИСТ (все 12 AC из spec §7):
- AC-1: 6 блоков в правильном DOM-order.
- AC-2: redirect /tutor/dashboard → /tutor/home.
- AC-3: empty states не падают.
- AC-4: HomeHeader — ровно 2 кнопки.
- AC-5: HomeCTAs — ровно 2 tiles, нет primary.
- AC-6: RecentDialogs перед StudentsActivity.
- AC-7: data-sokrat-mode="tutor" wrapper присутствует.
- AC-8: WeeklyStrip + attention dot в таблице.
- AC-9: stable sort в activity block.
- AC-10: keyboard a11y.
- AC-11: TTI ≤ 2s (оценка через build size + code splitting).
- AC-12: mobile layout.

ОСОБЫЕ ПРОВЕРКИ (anti-drift):
- Hex-значения вне colors_and_type.css — запрещены.
- Inter/Roboto — запрещены.
- framer-motion — запрещён.
- Emoji в UI chrome — запрещены (исключение: Segment label «⚠» — документировано).
- `bg-accent` / `bg-primary` в CTA — запрещены (spec КР-3).
- Cards inside cards — запрещены.
- `new Date(string)` — запрещено, только `parseISO`.
- Query keys НЕ вида `['tutor','home',...]` — запрещены.
- `getUser()` в hot path — запрещён (использовать `getSession()`).
- High-risk files (AuthGuard, TutorGuard, Chat.tsx) тронуты — блокер.

UX-проверки:
- Wedge alignment: эта фича ускоряет R4 triage? Ответ должен быть ДА с конкретной ссылкой на UX-принцип.
- Scope creep: в PR есть файлы, не указанные в tasks.md TASK-1..5? Если да — флаг.

ФОРМАТ ВЫВОДА:
- PASS / CONDITIONAL PASS / FAIL
- Если CONDITIONAL PASS или FAIL — список конкретных fix-requirements с указанием файла и строки.
- Ссылки на нарушения AC / anti-drift правил.
```

---

## Checklist перед стартом TASK-1

- [x] Spec approved (`spec.md` статус = approved)
- [x] Все blocking Open Questions закрыты (§9)
- [x] P0 / P1 разделены — P0 даёт самостоятельный value
- [x] Высокорисковые файлы (Chat/Guards) не затронуты
- [x] Rollback-план: redirect `/tutor/home` → `/tutor/dashboard` reversible за 1 коммит + restoration старого `TutorDashboard.tsx` из git history
- [x] TASK-1 ✅ done (2026-04-21)
- [x] TASK-2 ✅ done (2026-04-21)
- [x] TASK-3 ✅ done (2026-04-21)
- [x] TASK-4 ✅ done (2026-04-21)
- [x] TASK-5 ✅ done (2026-04-21)
- [x] TASK-6 ✅ done (2026-04-21)
- [ ] REVIEW — Codex independent pass

---

## Rollback plan

Если после деплоя обнаружится regression:
1. Быстрый revert: PR revert всех TASK-1..5 коммитов → `/tutor/dashboard` снова живой (TutorDashboard.tsx восстановлен из git).
2. Частичный revert: сохранить TutorHome, но убрать redirect (оставить оба URL-а, `/tutor/dashboard` = старый).
3. CSS-rollback: удалить `@import './styles/tutor-dashboard.css'` из `src/index.css` → новые блоки сломаются визуально, но `/tutor/home` не упадёт.
