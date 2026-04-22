# Follow-up: «Последние действия учеников» — edge function + unread + deep-link + kind split

**Version:** v1.1 (TASK-8 extension)
**Date:** 2026-04-22
**Parent:** [tutor-dashboard-v2/spec.md](./spec.md) (Phase 1)
**Status:** approved
**Tasks:** TASK-7 (base), TASK-8 (Case A / Case B split)

## Changelog

- **v1.0 (TASK-7, 2026-04-22):** edge function handler + unread + deep-link. Блок показывал только треды с student message (единственный case — «переписка»).
- **v1.1 (TASK-8, 2026-04-22):** расширение до «Последние действия учеников» — добавлен Case A («ученик открыл задачу, но не написал»); блок поднимает через `task_states.updated_at`; `kind` discriminator в payload; ChatRow рендерит system-style «Открыл задачу №N» для Case A.
- **v1.1.1 (TASK-8 review fixes, 2026-04-22):** по фидбеку Codex:
  - **BLOCKER fix**: снята зависимость prefetch-ordering от `thread.updated_at` (handleCheckAnswer / handleRequestHint его не бампят → top-50 мог терять свежие items). Теперь fetch без ORDER BY + LIMIT 500 (pilot safety cap), sort по `latestEventAt` в Deno. Belt-and-suspenders: check/hint теперь тоже обновляют `thread.updated_at` (для будущих consumer-ов).
  - **HIGH fix**: ChatRow драйвит visual unread от `chat.unread`, counter badge только при `unreadCount > 0`. Case A (нет student messages, но есть task-advance) теперь показывает bold name + dot, без числа.
  - **MEDIUM fix**: wire-level `lastAuthor` для Case A — `'ai'` (ближайший legacy-safe author), не `'system'`. Старые TASK-7 клиенты рендерят разумный chip; новые — branch на `kind` и игнорируют author для Case A. Тип union сужен до `'student' | 'tutor' | 'ai'`.
  - **LOW fix**: empty-state copy обновлён — «Пока нет активности учеников» + «Как только ученик откроет задачу или напишет в guided chat — событие появится здесь».

---

## 0. Job Context

| Participant | Core Job | Sub-job |
|---|---|---|
| Репетитор (B2B) | **R4** — Сохранение контроля и качества при масштабировании | R4-2 (реагировать на проблемы проактивно) |
| Репетитор (B2B) | **R3** — Рутина ведения (расписание, оплаты, чаты) | R3-1 (проверить что сегодня) |

Wedge-связка: без этого блока tutor не видит на главной что ученик написал в guided chat. Родитель-wedge (ДЗ workflow) без видимости обратной связи теряет половину ценности.

---

## 1. Problem

### Наблюдение

На `/tutor/home` в блоке «Последние диалоги» постоянно показывается empty state «Пока нет сообщений от учеников», хотя в guided chat по конкретной ДЗ ученик написал ответы (скриншот 2 → `/tutor/homework/41b09b81-bbff-454c-b5c8-b4c56dff9299`, VladimirKam, «30»).

### Root cause

`useTutorRecentDialogs` (старая версия) использовал **хрупкий PostgREST-паттерн** с nested `.eq()` через 3 уровня JOIN:

```ts
.eq(
  'homework_tutor_threads.homework_tutor_student_assignments.homework_tutor_assignments.tutor_id',
  tutorUserId,
)
```

PostgREST embed-фильтры **молча возвращают пустой результат** при любом несоответствии — RLS / inner-join filtering / отсутствии helper-функции. Сравнение: `TutorHomeworkDetail` читает тред **через edge function с service_role** — RLS обходит, всё работает. Это архитектурная трещина: одна tutor-surface через PostgREST, другая через edge function.

### Дополнительный gap

- Клик по ChatRow ведёт просто на `/tutor/homework/:hwId` без указания конкретного ученика. Детальная страница остаётся в overview-режиме, тьютор вручную кликает в HeatmapGrid.
- Нет unread-сигнала — невозможно понять на главной, какие сообщения тьютор уже видел, а какие новые.

---

## 2. Solution

### Approach

Переписать `useTutorRecentDialogs` на новый edge function handler `GET /recent-dialogs` — **архитектурная консистентность** с `handleGetThread` / `handleGetResults` / `handleGetAssignment`. Добавить unread-трекинг (новая колонка `tutor_last_viewed_at`) и deep-link (`?student=<id>`).

### Ключевые решения

**КР-1. Edge function вместо PostgREST.**
Новый handler `handleGetRecentDialogs` в `supabase/functions/homework-api/index.ts` делает всё server-side с service_role: batch-SELECT threads (отфильтрованы по `tutor_id = auth.uid()` + `last_student_message_at IS NOT NULL`) → dedup by student_id в Deno → batch-fetch latest messages → резолв студент-имён. Это убирает PostgREST nested-filter фрагильность.

**КР-2. Additive migration `tutor_last_viewed_at`.**
Колонка `TIMESTAMPTZ NULL` на `homework_tutor_threads`. `NULL` = "тьютор никогда не открывал" = unread. Без RLS изменений (полица на threads уже покрывает UPDATE). Partial index `idx_homework_tutor_threads_student_message_desc` ускоряет aggregation.

**КР-3. Fire-and-forget mark-viewed.**
`GuidedThreadViewer` при mount (tutor-side) вызывает `POST /threads/:id/viewed-by-tutor` и инвалидирует `['tutor','home','recent-dialogs']`. Реф-sentinel `markedViewedForRef` — одна сетевая сессия на mount. На ошибку — `markedViewedForRef.current = null` для retry при следующем mount.

**КР-4. Deep-link через query param.**
`navigate('/tutor/homework/:hwId?student=:sid')`. `TutorHomeworkDetail` читает через `useSearchParams`, сидирует `expandedStudentId` при смене `id`+`student`, скроллит к Card «Разбор ученика» через `ref` (один скролл на pair). Manual collapse сохраняется — sentinel `scrolledForRef` не re-scroll'ит.

**КР-5. Автор последнего сообщения как chip.**
`ChatRow` получает `lastAuthor: 'student' | 'tutor' | 'ai'` из edge function. Chip с использованием существующих `.t-chip--warning/--info/--neutral` (rule 90). Unread = жёлтая точка (6×6) + bold name.

### Scope

**In scope (P0):**
1. Migration `20260422120000_add_tutor_last_viewed_at_to_homework_threads.sql`.
2. `handleGetRecentDialogs` + `handleMarkThreadViewed` в edge function.
3. Rewrite `useTutorRecentDialogs` на edge function.
4. `ChatRow` author chip + unread indicator.
5. `TutorHome.handleOpenDialog` + studentId query param.
6. `TutorHomeworkDetail` deep-link (`useSearchParams` + scroll-to).
7. `GuidedThreadViewer` fire-and-forget mark-viewed.
8. Helper `markThreadViewedByTutor` + `getTutorRecentDialogs` в `tutorHomeworkApi.ts`.

**Out of scope (Parking lot):**
- Realtime подписка на `recent-dialogs` (Phase B.2).
- Отдельный `/tutor/chats` page для pagination.
- Unread count (не только boolean flag).
- Telegram / email messages в блоке.

---

## 3. Technical Design

### Data model

**Migration** (`supabase/migrations/20260422120000_add_tutor_last_viewed_at_to_homework_threads.sql`):

```sql
ALTER TABLE public.homework_tutor_threads
  ADD COLUMN IF NOT EXISTS tutor_last_viewed_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_homework_tutor_threads_student_message_desc
  ON public.homework_tutor_threads (student_assignment_id, last_student_message_at DESC)
  WHERE last_student_message_at IS NOT NULL;
```

### API contracts

#### `GET /recent-dialogs` (tutor)

Response:

```ts
{
  items: RecentDialogItem[]; // up to 5
}

interface RecentDialogItem {
  studentId: string;
  name: string;
  stream: 'ЕГЭ' | 'ОГЭ';
  lastAuthor: 'student' | 'tutor' | 'ai';
  unread: boolean;
  preview: string;            // ≤ 80 chars, '(фото)' / '(вложение)' fallback
  at: string;                 // ISO timestamp; frontend converts to relative
  hwId: string;               // assignment_id
  hwTitle: string;
}
```

Server-side algorithm (see `handleGetRecentDialogs` in `supabase/functions/homework-api/index.ts`):

1. Load threads with `last_student_message_at IS NOT NULL` sorted DESC, limit 50 (pre-fetch for dedup).
2. Dedup by `student_assignment.student_id` in Deno (PostgREST has no DISTINCT ON).
3. For top-5 threads: batch-fetch latest message (skip `visible_to_student=false` tutor notes).
4. Batch-resolve student names via `tutor_students` + `profiles.username` fallback.
5. Compute `lastAuthor` from `role` (user → student, tutor → tutor, assistant/system → ai).
6. Compute `unread = last_student_message_at > (tutor_last_viewed_at ?? 0)`.

#### `POST /threads/:id/viewed-by-tutor` (tutor)

Response:

```ts
{ ok: true; viewed_at: string /* ISO */ }
```

Ownership: verifies `thread → student_assignment → assignment.tutor_id === auth.uid()`.

### Frontend integration

**`useTutorRecentDialogs` (rewrite):**
- Calls `getTutorRecentDialogs()` from `tutorHomeworkApi.ts`.
- Maps `at` from ISO to relative string via `formatRelativeShort` (same helper as before).
- Query key: `['tutor', 'home', 'recent-dialogs']` (performance.md §2c).

**`ChatRow` (primitive):**
- `AUTHOR_LABEL` map: `student → 'Ученик'`, `tutor → 'Вы'`, `ai → 'AI'`.
- `AUTHOR_CHIP_CLASS`: `.t-chip--warning/info/neutral` (existing tokens).
- Unread dot: 6×6 `var(--sokrat-state-warning-fg)` same as `StudentsActivityBlock` attention-dot.
- `font-weight: 700` on name when unread.
- `aria-label` includes author + unread state.

**`TutorHome.handleOpenDialog`:**
```ts
navigate(`/tutor/homework/${dialog.hwId}?student=${encodeURIComponent(dialog.studentId)}`);
```

**`TutorHomeworkDetail` (deep-link):**
- `useSearchParams().get('student')` → `initialStudentId`.
- `useState<string | null>(initialStudentId)` for `expandedStudentId`.
- `useEffect` on `[id, initialStudentId]` re-seeds on URL change.
- `drillDownRef` + `scrolledForRef` sentinel scrolls once per `id|student` pair.

**`GuidedThreadViewer` (fire-and-forget):**
- `useEffect` on `[enabled, threadId]` calls `markThreadViewedByTutor(threadId)`.
- `markedViewedForRef` prevents duplicate calls in same mount.
- On success: `queryClient.invalidateQueries(['tutor','home','recent-dialogs'])`.
- On error: log warn, clear ref for retry.

---

## 4. TASK-8 — Case A / Case B split

### Определение

Для каждого thread tutor'а вычисляем:

```ts
const lastStudentMessageAtMs = parseIso(thread.last_student_message_at);
const lastTaskStateAtMs      = max(task_states.updated_at) per thread;
const latestEventAtMs        = max(lastStudentMessageAtMs, lastTaskStateAtMs);

const kind: RecentDialogKind =
  lastStudentMessageAtMs === 0 || lastTaskStateAtMs > lastStudentMessageAtMs
    ? 'task_opened'    // Case A
    : 'conversation';  // Case B
```

Треды без signals (`latestEventAtMs === 0`) отбрасываются — provisioned thread без activity неинтересен.

### Case A — `task_opened`

- **Signal:** `max(homework_tutor_task_states.updated_at)` per thread превышает `last_student_message_at` **или** ученик не писал вовсе.
- **Покрывает:** первое открытие задачи (task_state `locked → active`), advance на следующую после решения предыдущей. Bootstrap AI intro **не** обнуляет сигнал (per product решению).
- **Payload:**
  ```ts
  {
    kind: 'task_opened',
    lastAuthor: 'system',
    preview: 'Открыл задачу №N',
    taskOrder: N,                   // из thread.current_task_order
    at: latestEventAtMs (ISO),
    ...
  }
  ```
- **Frontend render (ChatRow):** Lucide `BookOpen` (12px) + «Задача №N» в `.t-chip--neutral`; preview-строка italic, цвет `var(--sokrat-fg3)`.

### Case B — `conversation`

- **Signal:** есть student message и он новее `max(task_states.updated_at)`.
- **Preview:** содержимое последнего видимого message (текущее TASK-7 поведение).
- **Frontend render:** без изменений — author chip (Ученик/Вы/AI) + content preview.

### Sort order

Все items вместе по `latestEventAt DESC`, dedup by `student_id` (один ученик = latest thread). Case A и B перемешаны — приоритет по времени.

### Unread (extended)

- Было: `unread = last_student_message_at > tutor_last_viewed_at`.
- Стало: `unread = latestEventAt > tutor_last_viewed_at` — task-advance тоже считается за «новое событие» для тьютора.
- `unreadCount` (Telegram-style counter badge) остаётся = число student messages после visit; для Case A всегда `0` (student не писал).

### Performance

- Добавлен batch-fetch `homework_tutor_task_states` WHERE `thread_id IN (50 ids)` — 1 query, ordered DESC, JS-side group by thread. Index `idx_task_states_thread` (из базовой миграции `20260306100000`) обеспечивает O(log n) lookup.
- Initial thread fetch: `updated_at DESC` как broad net (любая запись обновляет поле) + post-sort по honest `latestEventAt`.

### Backward compat

- Старые deploy-ы edge function не возвращают `kind` / `taskOrder` — фронтенд-хук `mapItem` ставит `kind: 'conversation'` по умолчанию. ChatRow в этом случае рендерит как TASK-7.
- RecentDialogItem `kind?: RecentDialogKind` — optional в transit, required в runtime DialogItem.

---

## 5. Acceptance Criteria

### TASK-7 (base)

- **AC-R1** ✅ На `/tutor/home` блок показывает строки для учеников, которые написали в guided chat.
- **AC-R2** ✅ Каждая строка имеет автор-метку (`Ученик` / `AI` / `Вы`).
- **AC-R3** ✅ Unread-индикатор активен если `last_student_message_at > tutor_last_viewed_at`.
- **AC-R4** ✅ Клик по ChatRow → `/tutor/homework/:hwId?student=:sid` → Detail auto-раскрывает «Разбор ученика».
- **AC-R5** ✅ После mount `GuidedThreadViewer` `tutor_last_viewed_at` обновляется; на возвращении на `/tutor/home` unread сброшен.
- **AC-R6** ✅ Один ученик = одна строка (dedup by student_id).
- **AC-R7** ✅ Edge function использует service_role (RLS bypass), консистентно с `handleGetThread`.
- **AC-R8** ✅ Миграция additive — `tutor_last_viewed_at IS NULL` ≡ unread.

### TASK-8 (Case A / Case B)

- **AC-R9** ✅ Ученик открыл задачу и не писал по ней → строка с `kind='task_opened'` + italic «Открыл задачу №N».
- **AC-R10** ✅ Если ученик написал после task-advance → `kind='conversation'`, preview = latest message content.
- **AC-R11** ✅ Sort order = `latestEventAt` DESC; Case A и B перемешаны.
- **AC-R12** ✅ Bootstrap AI intro не обнуляет Case A (signal — `task_states.updated_at`, не message content).
- **AC-R13** ✅ Клик по Case A row → тот же deep-link `/tutor/homework/:hwId?student=:sid`.

---

## 5. Changed files

**Backend:**
- `supabase/migrations/20260422120000_add_tutor_last_viewed_at_to_homework_threads.sql` (new)
- `supabase/functions/homework-api/index.ts` (+ `handleGetRecentDialogs`, `handleMarkThreadViewed`, 2 routes)

**Frontend:**
- `src/hooks/useTutorRecentDialogs.ts` (rewrite)
- `src/components/tutor/home/primitives/ChatRow.tsx` (badge + unread)
- `src/pages/tutor/TutorHome.tsx` (`handleOpenDialog`)
- `src/pages/tutor/TutorHomeworkDetail.tsx` (`useSearchParams` + scroll-to)
- `src/components/tutor/GuidedThreadViewer.tsx` (fire-and-forget mark-viewed)
- `src/lib/tutorHomeworkApi.ts` (+ `getTutorRecentDialogs`, `markThreadViewedByTutor`, `RecentDialogItem`)

**Docs:**
- This file (new)
- `docs/delivery/features/tutor-dashboard-v2/tasks.md` (TASK-7 entry)
- `.claude/rules/40-homework-system.md` (invariant section про `tutor_last_viewed_at`)

---

## 6. Verification

1. **Migration apply** (Supabase / Lovable Cloud): `\d homework_tutor_threads` confirms `tutor_last_viewed_at TIMESTAMPTZ`.
2. **Backend smoke:**
   ```bash
   curl -X GET "$SUPABASE_URL/functions/v1/homework-api/recent-dialogs" \
     -H "Authorization: Bearer $TUTOR_JWT"
   # → { items: [{ studentId, name, stream, lastAuthor, unread, preview, at, hwId, hwTitle }] }
   ```
3. **Frontend smoke** (Lovable preview):
   - `/tutor/home` → блок показывает `VladimirKam` / `Жена` если у них есть messages.
   - Клик на ChatRow → landing на `/tutor/homework/:id?student=:sid` → «Разбор ученика» раскрыт, viewport scrolled.
   - Back to `/tutor/home` → unread-dot исчез.
4. **Build:** `npm run lint && npm run build && npm run smoke-check` — all green.
5. **Responsive:** 375px → ChatRow truncate preview корректно, chip не переносится.
6. **A11y:** Enter/Space на ChatRow — native `<button>`; `aria-label` включает `unread` state.

---

## 7. Parking Lot

- **Realtime subscription** на `homework_tutor_thread_messages` INSERT для instant refresh блока без reload. Сейчас `staleTime: 30s` + `refetchOnWindowFocus` достаточно; upgrade при необходимости.
- **«Все чаты» page** — отдельный `/tutor/chats` с pagination, сейчас кнопка ведёт на `/tutor/homework`.
- **Unread count (not boolean)** — показать "3 новых" вместо просто точки.
- **Telegram / email ingress** — messages из Telegram bot / emails когда появятся.
- **`ai_flag` integration** — AI confidence сигнал в chip («AI сомневается»).
