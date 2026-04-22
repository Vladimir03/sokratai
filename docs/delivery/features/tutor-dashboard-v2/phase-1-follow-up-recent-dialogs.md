# Follow-up: «Последние диалоги» — fix empty state + deep-link + unread

**Version:** v1.0
**Date:** 2026-04-22
**Parent:** [tutor-dashboard-v2/spec.md](./spec.md) (Phase 1)
**Status:** approved
**Task:** TASK-7 (follow-up after TASK-6 landed on 2026-04-21)

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

## 4. Acceptance Criteria

- **AC-R1** ✅ На `/tutor/home` блок «Последние диалоги» показывает строки для учеников, которые написали в guided chat.
- **AC-R2** ✅ Каждая строка имеет автор-метку (`Ученик` / `AI` / `Вы`).
- **AC-R3** ✅ Unread-индикатор (жёлтая точка + bold name) активен если `last_student_message_at > tutor_last_viewed_at`.
- **AC-R4** ✅ Клик по ChatRow → `/tutor/homework/:hwId?student=:sid` → страница Detail auto-раскрывает «Разбор ученика» и скроллит к нему.
- **AC-R5** ✅ После mount `GuidedThreadViewer` `tutor_last_viewed_at` обновляется; на возвращении на `/tutor/home` unread-индикатор сброшен.
- **AC-R6** ✅ Один ученик = одна строка (dedup by student_id).
- **AC-R7** ✅ Edge function использует service_role (RLS bypass), консистентно с `handleGetThread`.
- **AC-R8** ✅ Миграция additive — `tutor_last_viewed_at IS NULL` обрабатывается как "never viewed" → все existing threads с сообщениями ученика помечаются unread до первого визита.

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
