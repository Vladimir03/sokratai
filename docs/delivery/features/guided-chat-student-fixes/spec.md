# Feature Spec: Guided Chat — Student-side fixes

**Версия:** v0.1
**Дата:** 2026-04-06
**Автор:** Vladimir Kamchatkin
**Статус:** draft

**PRD:** `docs/delivery/features/guided-chat-student-fixes/prd.md`
**Источники:** Егор + Елена (репетиторы), сигналы пилота 2026-04-06

---

## 0. Job Context

| Участник | Core Job | Sub-job |
|---|---|---|
| Ученик | S1 — подготовиться к экзамену | S1-1 (решать задачи), S1-2 (получать feedback) |
| Репетитор | R1 — автоматическая проверка ДЗ | R1-3 (доверять AI), R1-4 (давать ПОС) |

- **Wedge alignment:** Да — guided chat = core product в пилоте
- **Pilot impact:** Bug 1 блокирует workflow учеников в live-пилоте. Bug 2 снижает доверие к платформе у репетиторов, работающих с ОГЭ-сегментом. Оба бага влияют на конверсию 15 апреля.

---

## 1. Summary

Два независимых исправления в guided homework chat (student-side):

**Fix 1 (P0, критический):** В `performTaskAdvance` (backend) неверно определяется момент завершения треда. Тред помечается `completed` когда ученик решает задачу, стоящую **последней по номеру** — даже если более ранние задачи ещё активны. Это блокирует ввод ответов на все оставшиеся задачи. Исправление: тред завершается только когда **все** task_states переведены в `completed`.

**Fix 2 (P1, minor UX):** В amber-баннере и AI-промпте для задач с `check_format = 'detailed_solution'` хардкодировано слово «ЕГЭ». Репетиторы с ОГЭ-учениками видят некорректный текст. Исправление: добавить `exam_type` в `homework_tutor_assignments` и динамически подставлять метку в UI/промпт.

---

## 2. Problem

### Текущее поведение — Bug 1

`performTaskAdvance` определяет следующую задачу как `sortedOrders[currentIdx + 1]` (следующую в отсортированном массиве после текущей). Если ученик решает задачу с самым большим `order_num` — `currentIdx + 1` выходит за пределы массива, `nextOrder = null`, тред → `completed`.

Пример: ДЗ из 5 задач. Ученик решил #5 первой, пропустив #1–#4.
→ `performTaskAdvance` видит `nextOrder = null` → `thread.status = 'completed'`
→ backend: все последующие `check`/`hint` → `400 ALREADY_COMPLETED`
→ frontend: `threadStatus = 'completed'` → `GuidedChatInput disabled={true}` для всех задач

**Затронутые файлы (backend):**
- `supabase/functions/homework-api/index.ts` → `performTaskAdvance` (строки ~3246–3325)

**Затронутые места вызова:**
- `handleCheckAnswer` → `performTaskAdvance` (при `CORRECT` verdict)

### Текущее поведение — Bug 2

Хардкод «ЕГЭ» в двух местах `GuidedHomeworkWorkspace.tsx`:
1. Строка ~1415: amber-баннер: `«покажи ход решения, как на ЕГЭ. Без хода решения получишь 0 баллов»`
2. Строка ~177: AI-промпт system message: `«Мотивируй это подготовкой к ЕГЭ`

---

## 3. Solution

### Fix 1: `performTaskAdvance` — правильное определение завершённости

**Алгоритм после фикса:**
1. Пометить текущую задачу как `completed` (без изменений).
2. Собрать все task_states из `stateByOrder`.
3. Найти первую task_state со статусом `'active'` (кроме только что завершённой) — это `nextActiveOrder`.
4. Если `nextActiveOrder` найден → установить `thread.current_task_order = nextActiveOrder`, вставить system message, вернуть `{ nextOrder: nextActiveOrder, threadCompleted: false }`.
5. Если активных задач не осталось → пометить `thread.status = 'completed'`, вставить system message «Все задачи выполнены», вернуть `{ nextOrder: null, threadCompleted: true }`.

**Важно:** `nextActiveOrder` = ближайший по порядку номер задачи среди оставшихся активных, а не следующий по индексу в массиве. Сортировать `activeOrders` и брать первый.

**Scope:** только `performTaskAdvance` в `index.ts`. Не затрагивать `handleRequestHint`, `provisionGuidedThread`, фронтенд (frontend уже корректно реагирует на `thread_completed: true`).

### Fix 2: `exam_type` — динамический лейбл экзамена

**Шаги:**

**2a. Миграция:**
Добавить колонку `exam_type VARCHAR NOT NULL DEFAULT 'ege' CHECK (exam_type IN ('ege', 'oge'))` в `homework_tutor_assignments`.

**2b. Backend (homework-api):**
- `handleCreateAssignment` + `handleUpdateAssignment`: принимать optional `exam_type` в body, сохранять в БД.
- `handleGetStudentAssignment` (GET /assignments/:id/student): добавить `exam_type` в SELECT, вернуть в ответе.

**2c. Frontend — конструктор ДЗ (tutor-side):**
- `TutorHomeworkCreate.tsx` (L0, рядом с «Предмет»): добавить нативный `<select>` «Тип экзамена» (ЕГЭ / ОГЭ) в L0-секцию в виде grid `md:grid-cols-2` вместе с предметом. **Отклонение от спеки:** изначально планировался L1 (HWExpandedParams), перенесён в L0 для лучшей видимости — репетитор задаёт тип экзамена сразу, а не в скрытом разделе. `HWExpandedParams.tsx` не изменён по существу.
- `tutorHomeworkApi.ts`: добавить `exam_type` в `CreateAssignmentPayload` / `UpdateAssignmentPayload`.

**2d. Frontend — student-side:**
- `src/types/homework.ts` → `StudentAssignment`: добавить `exam_type: 'ege' | 'oge'`.
- `src/lib/studentHomeworkApi.ts` → `getStudentAssignment`: добавить `exam_type` в SELECT.
- `GuidedHomeworkWorkspace.tsx`:
  - Вычислить `examTypeLabel = assignment.exam_type === 'oge' ? 'ОГЭ' : 'ЕГЭ'`
  - Строка ~1415: заменить `«как на ЕГЭ»` → `«как на ${examTypeLabel}»`
  - Строка ~177: в `buildTaskContext()`, где `checkFormat === 'detailed_solution'` → заменить `«подготовкой к ЕГЭ»` → `«подготовкой к ${examTypeLabel}»`; передавать `examType` в `buildTaskContext` options.

### Scope

**In scope:**
- Fix 1: `performTaskAdvance` — алгоритм поиска следующей активной задачи (P0)
- Fix 2: миграция `exam_type` (P1)
- Fix 2: поддержка `exam_type` в create/update assignment handlers (P1)
- Fix 2: select «Тип экзамена» в L0 конструктора ДЗ (`TutorHomeworkCreate.tsx`) (P1) _(реализован в L0, а не L1 как планировалось изначально)_
- Fix 2: `exam_type` в student assignment API + динамический текст в UI/промпте (P1)

**Out of scope:**
- Data fix для тредов, уже ставших `completed` некорректно (отдельная задача если нужна)
- Новые типы экзаменов (ВПР, олимпиады)
- Изменения в scoring при смене `exam_type`
- Изменения в `GuidedThreadViewer` (tutor-side)

---

## 4. User Stories

### Ученик
> Когда я решаю задачи ДЗ не по порядку и решаю последнюю по номеру первой, я хочу, чтобы ввод к оставшимся задачам оставался активным до тех пор, пока я не решу их все.

> Когда я вижу баннер «развёрнутое решение», я хочу читать про **свой** экзамен (ОГЭ или ЕГЭ), а не про чужой.

### Репетитор
> Когда я создаю ДЗ для ОГЭ-ученика, я хочу выбрать «ОГЭ» в конструкторе, чтобы интерфейс ученика отражал это.

---

## 5. Technical Design

### Затрагиваемые файлы

| Файл | Что меняется |
|---|---|
| `supabase/functions/homework-api/index.ts` | `performTaskAdvance` — новый алгоритм поиска следующей активной задачи; `handleCreateAssignment`, `handleUpdateAssignment` — accept `exam_type`; `handleGetStudentAssignment` — return `exam_type` |
| `supabase/migrations/YYYYMMDD_add_exam_type_to_assignments.sql` | ALTER TABLE + DEFAULT |
| `src/types/homework.ts` | `StudentAssignment.exam_type: 'ege' \| 'oge'` |
| `src/lib/studentHomeworkApi.ts` | SELECT добавить `exam_type` |
| `src/lib/tutorHomeworkApi.ts` | `CreateAssignmentPayload` / `UpdateAssignmentPayload` — добавить `exam_type` |
| `src/components/homework/GuidedHomeworkWorkspace.tsx` | `examTypeLabel` + заменить хардкод в баннере и `buildTaskContext` |
| `src/pages/tutor/TutorHomeworkCreate.tsx` | `<select>` ЕГЭ/ОГЭ в L0 (рядом с «Предмет», grid md:grid-cols-2) |

### Data Model

```sql
-- Миграция
ALTER TABLE homework_tutor_assignments
  ADD COLUMN exam_type VARCHAR NOT NULL DEFAULT 'ege'
  CONSTRAINT homework_tutor_assignments_exam_type_check
  CHECK (exam_type IN ('ege', 'oge'));
```

Имя файла: `supabase/migrations/20260406_add_exam_type_to_assignments.sql`
(использовать дату деплоя в имени файла)

### Ключевая логика Fix 1

```typescript
// В performTaskAdvance, после того как текущая задача помечена completed:

// Найти все оставшиеся активные задачи
const remainingActiveOrders = sortedOrders.filter(
  (order) => order !== currentOrder && stateByOrder.get(order)?.status === 'active'
);

if (remainingActiveOrders.length > 0) {
  // Ближайший по номеру
  const nextOrder = remainingActiveOrders[0]; // sortedOrders уже отсортированы
  // ... update thread.current_task_order = nextOrder
  // ... insert system message
  return { nextOrder, threadCompleted: false };
} else {
  // ВСЕ задачи завершены
  // ... update thread.status = 'completed'
  // ... insert system message
  return { nextOrder: null, threadCompleted: true };
}
```

**Важно:** `stateByOrder` в момент вызова `performTaskAdvance` уже обновлён (текущая задача помечена `completed` выше по коду) — поэтому фильтр `order !== currentOrder` предохраняет от self-reference, но можно и просто фильтровать по `status === 'active'` после update.

**Проверить:** в `performTaskAdvance` `stateByOrder` передаётся как аргумент и содержит snapshot до обновления. Поэтому фильтровать как `order !== currentOrder && state.status === 'active'`.

### API изменения

`POST /assignments` и `PATCH /assignments/:id` — добавить в body:
```json
{ "exam_type": "ege" | "oge" }
```

`GET /assignments/:id/student` — добавить в ответ:
```json
{ "exam_type": "ege" | "oge" }
```

### Миграции
- `supabase/migrations/20260406_add_exam_type_to_assignments.sql`

---

## 6. UX / UI

### Fix 1 — без изменений UI
Изменения строго backend. Frontend уже корректно обрабатывает `thread_completed: true` и `threadStatus`.

### Fix 2 — конструктор ДЗ (tutor, L0)

Selector «Тип экзамена» размещён в **L0** (всегда виден) рядом с полем «Предмет» в grid `md:grid-cols-2` в `TutorHomeworkCreate.tsx`.

```
[ Предмет ▼ ]   [ Тип экзамена ▼ ]   ← L0, один ряд
```

- Стиль: нативный `<select>`, `font-size: 16px`, `touch-action: manipulation` (iOS Safari anti-zoom)
- Label: `text-sm font-medium text-slate-700`
- Dot-indicator в L1 toggle: НЕ показывать для `exam_type`
- **Обоснование L0:** репетитор должен сразу задать тип экзамена — это влияет на формулировки для ученика. Скрытый L1 параметр повышает риск забыть переключить.

### Fix 2 — student amber-баннер

```
📝 Задача с развёрнутым решением — покажи ход решения, как на {ЕГЭ|ОГЭ}. Без хода решения получишь 0 баллов.
```

Emoji `📝` сохраняется — это user-facing motivational текст (не UI chrome), допустимо по design-system.

### UX-принципы (doc 16)
- **AI = draft + action**: задача AI подсказать правила экзамена → текст должен быть точным для конкретного ученика
- **Minimize context switch**: конструктор не должен требовать переключения (L1 — скрытый параметр, не мешает основному flow)

### UI-паттерны (doc 17)
- Нативный `<select>` в L1, не custom dropdown
- `font-size: 16px` обязателен (iOS Safari auto-zoom)
- Токены: `border-slate-200 rounded-md` — консистентно с остальными L1-параметрами

### Cross-browser
- Нет новых CSS-паттернов. `<select>` безопасен во всех браузерах.
- Никаких `:has()`, `structuredClone()`, framer-motion.

---

## 7. Validation

### Acceptance Criteria (testable)

**Fix 1:**
- **AC-1:** Создать ДЗ из 3 задач. Ученик решает задачу #3 первой (задачи #1, #2 активны). **PASS:** ввод к #1 и #2 остаётся активным; `thread.status` в БД = `'active'`; `GuidedChatInput` не задизейблен.
- **AC-2:** Ученик решает все 3 задачи (в любом порядке). **PASS:** после решения последней незавершённой задачи `thread.status` = `'completed'`; итоговый экран показывается корректно.
- **AC-3:** Ученик решает #5 первой в ДЗ из 5 задач. `/threads/:id/check` для задачи #1 возвращает 200 (не `400 ALREADY_COMPLETED`).

**Fix 2:**
- **AC-4:** Репетитор открывает конструктор ДЗ → сразу в L0 (рядом с «Предмет») видит selector «Тип экзамена» (ЕГЭ/ОГЭ). При выборе ОГЭ и сохранении — `exam_type = 'oge'` в БД.
- **AC-5:** Ученик открывает ДЗ с `exam_type = 'oge'` и задачей `check_format = 'detailed_solution'`. **PASS:** баннер содержит «как на ОГЭ», не «как на ЕГЭ».
- **AC-6:** Ученик открывает ДЗ с `exam_type = 'ege'` (дефолт). **PASS:** баннер содержит «как на ЕГЭ» — нет регрессии.
- **AC-7:** `npm run lint && npm run build && npm run smoke-check` проходят без новых ошибок.

### Smoke check
```bash
npm run lint && npm run build && npm run smoke-check
```

### Метрики успеха
- Bug 1 closed: нет репортов о заблокированном вводе в пилоте (3–7 дней)
- Bug 2 closed: Елена подтверждает корректный текст для ОГЭ-учеников

---

## 8. Risks & Open Questions

| Риск | Вероятность | Митигация |
|---|---|---|
| `stateByOrder` — snapshot до update, текущая задача ещё числится `active` в map | Высокая | Фильтровать `order !== currentOrder && state.status === 'active'` (см. алгоритм выше) |
| Существующие треды ошибочно помечены `completed` в пилоте | Средняя | Зафиксировать количество в Supabase; при необходимости — ручной SQL fix (не через код) |
| `handleGetStudentAssignment` кешируется на клиенте — старый `exam_type` | Низкая | React Query TTL 5 мин; при смене `exam_type` в конструкторе — invalidate на tutor-side достаточно |
| Safari iOS: нативный select рендерится системно — `font-size` должен быть 16px | Известный | Уже применяется для других select в HWExpandedParams — копируем паттерн |

### Открытые вопросы
1. Нужен ли data fix для тредов, уже некорректно завершённых? → **Ответ:** оценить количество в Supabase. Если < 5 — ручной SQL. Если > 5 — задача в backlog.
2. Стоит ли показывать `exam_type` в student task list (вне guided chat)? → **Нет,** out of scope для v1.

---

## 9. Implementation Tasks (план)

> Полная нарезка → `tasks.md`

- [x] TASK-1 (P0): Fix `performTaskAdvance` — новый алгоритм поиска следующей активной задачи
- [x] TASK-2 (P1): Миграция `exam_type` + backend create/update/get-student handlers
- [x] TASK-3 (P1): Frontend — select «Тип экзамена» в L0 (рядом с «Предмет», `TutorHomeworkCreate.tsx`) + обновить API-типы _(реализован в L0, не L1)_
- [x] TASK-4 (P1): Frontend — student-side динамический `examTypeLabel` в баннере и промпте
- [x] TASK-5: Validation (lint/build/smoke + ручной QA по AC-1…AC-6)

---

## Parking Lot

- **Data fix существующих некорректных тредов** — контекст: в пилоте могут быть треды с `status='completed'` но незавершёнными задачами. Revisit: после оценки количества в Supabase.
- **Автоопределение `exam_type` по профилю репетитора** — контекст: если репетитор работает только с ОГЭ, дефолт должен быть ОГЭ. Revisit: после накопления данных о `exam_type` use rate.
- **Расширение: ВПР, олимпиада, вузовские** — revisit после paid pilot.

---

## Checklist перед approve

- [x] Job Context заполнен (S1, R1)
- [x] Scope чётко определён (in/out)
- [x] UX-принципы из doc 16 учтены
- [x] UI-паттерны из doc 17 учтены
- [x] Pilot impact описан
- [x] AC testable (6 критериев)
- [x] High-risk файлы: `homework-api/index.ts` затронут — только `performTaskAdvance` + add handlers, не AuthGuard/TutorGuard
- [x] Student/Tutor изоляция: Fix 1 только backend, Fix 2 изменяет tutor-side конструктор и student-side workspace раздельно
