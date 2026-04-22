# Follow-up: «Активность учеников» — grouping by tutor_groups

**Version:** v1.0
**Date:** 2026-04-22
**Parent:** [tutor-dashboard-v2/spec.md](./spec.md) (Phase 1)
**Status:** approved
**Task:** TASK-10 (follow-up после TASK-9 landed 2026-04-22)

---

## 0. Job Context

| Participant | Core Job | Sub-job |
|---|---|---|
| Репетитор (B2B) | **R4** — Сохранение контроля и качества при масштабировании | R4-1 (быстрая оценка состояния по группам), R4-2 (видеть «больные» группы сразу) |

Репетитор у которого 24+ ученика в нескольких группах («ОГЭ 2026», «ЕГЭ 2026 на 100 баллов», etc.) хочет видеть активность **сгруппированной по группам** — как у него привычно на `/tutor/students`. Flat-список 24 учеников без секций теряет структурный контекст.

---

## 1. Problem

До TASK-10 таблица «Активность учеников» рендерилась как плоский список. Даже если у репетитора есть несколько групп, он не мог:
- Увидеть сколько учеников в каждой группе и какова их коллективная активность
- Найти конкретного ученика внутри известной группы одним взглядом
- Понять чем отличается активность в группах «ЕГЭ 2026» vs «ОГЭ 2026»

Screenshot от репетитора-пилота показывает как он структурирует себе учеников на `/tutor/students`:
- **ОГЭ 2026** (3): Глеб, Михаил, Илья ОГЭ 2026/2027
- **ЕГЭ 2026 на 100 баллов** (5): Lera, Анастасия, Григорий, Саша ЕГЭ 2026, Варвара

Такая же структура нужна и в блоке активности.

---

## 2. Solution

**Новый режим Segment-sort `groups`** — default когда у репетитора есть хотя бы одна активная группа. В этом режиме таблица показывает заголовки групп + счётчик учеников внутри. Остальные режимы (`attention`, `delta`, `name`) остаются flat.

### Segment layout

```
[ Группы ]  [ ⚠ 2 ]  [ По тренду ]  [ А→Я ]
```

- `Группы` (Lucide `FolderTree` 12px + «Группы») — новый first option, **default**.
- `⚠ N` — было default до TASK-10; теперь вторая позиция.
- `По тренду`, `А→Я` — без изменений.

При `sort === 'groups'`:
- Tbody содержит interleaved `<tr class="home-activity-group-header">` с `colspan=7` (icon + название + chip с count) + обычные student rows.
- Группы отсортированы **alphabetically** (`localeCompare('ru')`) по `short_name || name`.
- Секция **«Без группы»** всегда в конце независимо от alphabetical order.
- Students внутри группы — alphabetically (per default `sorted` ordering когда sort не `attention`/`delta`).

При других `sort`-режимах поведение **не меняется** — flat rendering как раньше.

### Default sort heuristic

```ts
const hasAnyGroup = items.some((s) => s.groupId !== null);
const [sort] = useState<ActivitySortMode>(() =>
  hasAnyGroup ? 'groups' : 'attention',
);
```

Если у репетитора 0 групп — default `attention` (как было до TASK-10). Если ≥ 1 group — default `groups`. Инициализация один раз на mount, не реагирует на pipeline add/remove группы в другой вкладке (в этом случае нужен ручной page refresh).

### Fallback к `'Без группы'`

- Ученик без активного membership → `groupId = null`, `groupName = null`.
- В UI попадает в секцию «Без группы» (всегда последняя).
- Сама секция рендерится только если в ней есть хотя бы 1 ученик.

### Graceful degradation

Если fetch `tutor_groups` / `tutor_group_memberships` падает (RLS / network) — hook логгирует warning и продолжает рендер со всеми `groupId = null` → все ученики попадают в «Без группы». Это лучше чем полная ошибка (`throw`) на блоке активности, потому что все остальные поля (weekly / hwAvg / hwTrend / attention) остаются валидными.

---

## 3. Data Model

Reused без изменений:

- **`tutor_groups`** — `id`, `tutor_id`, `name`, `short_name`, `color`, `is_active`, timestamps.
- **`tutor_group_memberships`** (junction) — `id`, `tutor_id`, `tutor_student_id`, `tutor_group_id`, `is_active`. UNIQUE `(tutor_student_id) WHERE is_active = true` — **один активный membership на ученика** (MVP ограничение).

FK chain: `tutor_student.id → tutor_group_memberships.tutor_student_id → tutor_groups.id`.

**Никаких миграций не нужно** — таблицы существуют с миграции 2026-02-23. Паттерны fetch уже используются в `src/lib/tutors.ts::getTutorGroups / getTutorGroupMemberships`.

---

## 4. API

`useTutorStudentActivity` расширен двумя дополнительными parallel Promise в Step 1:

```ts
supabase.from('tutor_groups')
  .select('id, name, short_name')
  .eq('tutor_id', tutor.id)
  .eq('is_active', true);

supabase.from('tutor_group_memberships')
  .select('tutor_student_id, tutor_group_id')
  .eq('tutor_id', tutor.id)
  .eq('is_active', true);
```

Построение `groupByStudentId: Map<string, GroupRow>` — O(n). Каждый `StudentActivity` получает новые поля:

```ts
{
  groupId: string | null;
  groupName: string | null;
  groupShortName: string | null;
}
```

Existing fields (weekly, hwAvg, hwTrend, attention) нетронуты.

---

## 5. Acceptance criteria

- **AC-G1**: Когда у репетитора есть ≥ 1 активная группа — на `/tutor/home` блок «Активность учеников» по умолчанию показывает mode `groups` с заголовками групп и счётчиками учеников.
- **AC-G2**: Segment control имеет 4 опции в порядке `Группы / ⚠ N / По тренду / А→Я`. Клик на любую переключает режим без потери прокрутки.
- **AC-G3**: Группы сортируются alphabetically по `short_name || name`. «Без группы» (если есть) — всегда в конце.
- **AC-G4**: Ученики без membership попадают в секцию «Без группы». Секция не рендерится если пустая.
- **AC-G5**: При 0 групп у репетитора default = `attention` (fallback). Segment всё равно показывает `Группы` как опцию, клик на неё рендерит одну секцию «Без группы» со всеми учениками.

---

## 6. Changed files

**Frontend (3 файла):**
- `src/hooks/useTutorStudentActivity.ts` — +fetch groups + memberships, +3 поля в `StudentActivity`, +resolve group per student.
- `src/components/tutor/home/StudentsActivityBlock.tsx` — +`'groups'` в `ActivitySortMode`, `GroupRowsFragment` component, `groupSections` useMemo, Segment item «Группы» first, default sort logic.
- `src/styles/tutor-dashboard.css` — `.home-activity-group-header` ruleset (header row background, padding, borders).

**Docs:**
- This file (new).
- `docs/delivery/features/tutor-dashboard-v2/tasks.md` — TASK-10 row + checklist.

**Никаких миграций / env vars / edge function изменений.** Существующие tables и RLS-policies (после TASK-9) уже достаточны.

---

## 7. Verification

1. **Local build:** `npm run lint && npm run build && npm run smoke-check` — green.
2. **Frontend smoke** на Lovable preview:
   - `/tutor/home` как test-tutor с группами (например, пилотный репетитор с «ОГЭ 2026», «ЕГЭ 2026 на 100 баллов»).
   - Блок «Активность учеников» показывает ~2–3 заголовка группы + обычные student rows под ними.
   - Count chip рядом с названием группы равен количеству рендерящихся под ним rows.
   - Клик по `⚠ 2` → flat-список (без заголовков); клик по `Группы` → обратно группировка.
   - На мобильном (375px) заголовки не ломают горизонтальный scroll таблицы (`touch-pan-x` `.t-table-wrap`).
3. **Regression check:**
   - Tutor без групп — default `attention`, таблица рендерит плоско как до TASK-10.
   - Ученик без membership → попадает в «Без группы» в конце списка (если sort = `groups`).
   - Sort переключение → ActivityRow memoisation сохраняется (нет ненужных re-renders).

---

## 8. Parking lot

- **Multi-group membership**: сейчас UNIQUE constraint на `(tutor_student_id) WHERE is_active=true` — один активный membership на ученика. Если в будущем тьютор сможет включить ученика в несколько групп (напр. «11 класс» × «ЕГЭ 2026»), потребуется change в `groupByStudentId` → `Map<string, GroupRow[]>` + рендер ученика в каждой группе либо primary group selector.
- **Group color / icon на заголовке**: сейчас используется Lucide `FolderTree` + текст. `tutor_groups.color` пока не используется — при накоплении групп можно добавить цветной accent.
- **Group-level metrics**: средний балл по группе, средний streak — aggregate row под заголовком. Не в scope Phase 1; revisit после накопления feedback.
- **Expand/collapse per group**: tutor может свернуть «закрытую» группу. Не в scope MVP.
- **Sort внутри группы через Segment**: сейчас всегда alphabetical. Можно пересортировать ученикам внутри группы через тот же Segment (`По тренду`, `А→Я`) — но это усложняет UX, в MVP не делаем.
- **Realtime refresh при изменении группы**: сейчас нужно вручную обновить страницу. Можно подписаться на `tutor_group_memberships` realtime INSERT/UPDATE.
