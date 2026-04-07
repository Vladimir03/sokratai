# Spec — Homework Student Totals

**Status:** Draft
**Pipeline step:** 4 (SPEC)
**Owner:** Vladimir
**Date:** 2026-04-07
**Связанный PRD:** `./prd.md`
**Дизайн-референс:** `computer:///sessions/awesome-great-pasteur/mnt/SokratAI/HomeworkResultsV2Mock.jsx` — правые колонки таблицы Heatmap.

---

## Section 0 — Job Context

**Core Job:** R1-2 «Понять, что усвоил каждый ученик после ДЗ — за 30 секунд».

Связка с jobs: R1-3 (сравнить учеников), R3 (дотянуть отстающего).

Источник: `docs/discovery/product/tutor-ai-agents/15-backlog-of-jtbd-scenarios-sokrat.md`.

---

## Summary

Добавить в строку каждого ученика на `/tutor/homework/:id` (компонент `HeatmapGrid`) три правые колонки: **Балл (Σ score / Σ max)**, **Подсказки (Σ hint_count + chip при overuse)**, **Время (wall-clock от первого до последнего сообщения треда, в минутах)**. Данные приходят из расширенного `handleGetResults` в `homework-api`. Без сортировки в v1.

---

## Acceptance Criteria (testable)

- **AC-1:** В `HeatmapGrid` после колонок задач видны 3 правые колонки в порядке: Балл, Подсказки, Время. Заголовки: «Балл», иконка `Lightbulb`, «Время».
- **AC-2:** Для **сдавших** учеников:
  - Балл = `Σ final_score` по `task_scores` ÷ `Σ task.max_score`, формат `9/11`, шрифт `font-semibold text-slate-900`.
  - Подсказки = `Σ hint_count` по `task_scores`, число в `text-slate-500`. Если `Σ hint_count >= ceil(tasks.length * 0.6)` → чип `bg-amber-100 text-amber-900` с иконкой Lightbulb.
  - Время = `Math.max(1, round((last_message_at − first_message_at) / 60_000))` мин, формат `47 мин`.
- **AC-3:** Для **не сдавших** (нет thread'а или нет messages) — все три колонки показывают `—` (`text-slate-400`).
- **AC-4:** Для **в процессе** (thread существует, но `status != 'completed'`) — Балл и Подсказки показывают текущие агрегаты, Время = `— в процессе` (`text-slate-400`).
- **AC-5:** Сумма по строке = сумме баллов клеток той же строки (инвариант, тестируется визуально на staging-данных).
- **AC-6:** Hint chip в строке ученика **визуально совпадает** с hint chip из Results v2 P0-2 (одни константы и токены — `HINT_OVERUSE_THRESHOLD`, цвета).
- **AC-7:** На viewport ≤ 720px последние 3 колонки уезжают в горизонтальный скролл вместе с задачами; колонка имени остаётся sticky.
- **AC-8:** Клик по строке по-прежнему раскрывает drill-down (Results v2 TASK-6 не сломан); клик по ячейкам новых колонок не открывает drill-down другой задачи (`e.stopPropagation()` не нужен — клик по строке = expand).
- **AC-9:** `handleGetResults` возвращает в каждом `per_student` поля: `total_score`, `total_max`, `hint_total`, `total_time_minutes` (`number | null`). Поля additive, не ломают существующих consumer'ов.
- **AC-10:** `npm run lint && npm run build && npm run smoke-check` зелёный. Manual Safari/iOS на iPhone SE 375px — горизонтальный скролл работает, шрифт ≥14px не вызывает auto-zoom (это не input).

---

## Requirements

### P0-1. Backend: расширить `handleGetResults` агрегатами по ученику

**Файл:** `supabase/functions/homework-api/index.ts` → `handleGetResults`.

**Добавить в `per_student[*]`:**
- `total_score: number` — `Σ final_score` по `task_scores` (использует ту же `computeFinalScore` что и existing aggregates, не дублировать формулу).
- `total_max: number` — `Σ task.max_score` по всем задачам ДЗ (не по `task_scores` — иначе для не приступивших получим 0/0). Считается один раз вне цикла per_student.
- `hint_total: number` — `Σ hint_count` по `task_scores` (уже считается в Results v2 как proxy для needs_attention; вынести в response).
- `total_time_minutes: number | null` — `null` если нет thread/messages; иначе `Math.max(1, round((max(created_at) − min(created_at)) / 60000))` по `homework_tutor_thread_messages` ученика для этого assignment.

**SQL запрос для time:** один JOIN на `homework_tutor_threads` + агрегат `MIN/MAX(created_at)` по `homework_tutor_thread_messages` сгруппированный по `student_id`. Не делать N+1 — собрать в `Map<student_id, { first, last }>` одним запросом.

**TypeScript типы:** обновить `TutorHomeworkResultsPerStudent` в `src/lib/tutorHomeworkApi.ts` — additive поля.

**Acceptance:** AC-9. ✅ **Done 2026-04-07** — `handleGetResults` возвращает `total_score`, `total_max`, `hint_total`, `total_time_minutes` в каждом `per_student`. Время агрегируется двумя round-trip'ами (`homework_tutor_threads` всех статусов + `homework_tutor_thread_messages`), использует индекс `idx_thread_messages_thread (thread_id, created_at)`. Тип `TutorHomeworkResultsPerStudent` расширен additive-полями.

### P0-2. Frontend: 3 правые колонки в `HeatmapGrid`

**Файл:** `src/components/tutor/results/HeatmapGrid.tsx`.

**Изменения в `<colgroup>`:** добавить три новых `<col>` с шириной `90px` (балл), `60px` (подсказки), `90px` (время). Итог: `220 + 56·N + 90 + 60 + 90` px.

**Изменения в `<thead>`:** три новых `<th>`. Заголовки: «Балл» (text-right), `<Lightbulb className="w-3.5 h-3.5 inline" />` (text-right), «Время» (text-right). Sticky **не нужен** — это правый край таблицы.

**Изменения в `HeatmapRow`:** три новых `<td>` с данными из `per_student[*]`.

**Хелпер `formatTotalTime(min: number | null, status: 'completed' | 'in_progress' | 'not_started'): string`:**
- `not_started` → `—`
- `in_progress` → `— в процессе` (text-slate-400, text-xs)
- `completed` + null → `—`
- `completed` + N → `${N} мин`

Вынести вместе с `getCellStyle` / `formatScore` в `src/components/tutor/results/heatmapStyles.ts` — НЕ дублировать.

**Hint chip:** константа `HINT_OVERUSE_THRESHOLD = Math.ceil(tasks.length * 0.6)` уже импортируется в HeatmapGrid (TASK-5 Results v2). Использовать **её же**, не создавать вторую.

**`React.memo` на `HeatmapRow`** — уже есть, новые props добавляются как простые скаляры, ре-рендер не должен пострадать.

**Acceptance:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8. ✅ **Done 2026-04-08** — три правые колонки (Балл/Подсказки/Время) добавлены в `HeatmapGrid`. `formatTotalTime` + тип `StudentDisplayStatus` вынесены в `heatmapStyles.ts` (single source of truth). `HeatmapRow` расширен четырьмя scalar props (`totalScore`, `totalMax`, `totalTimeMinutes`, `displayStatus`) — `React.memo` shallow comparison сохранилась. Status derivation: `submitted=true → completed`; `submitted=false && total_time_minutes !== null → in_progress`; иначе `not_started`. Hint chip-дубликат «Много подсказок» удалён из sticky name column — единственный визуальный сигнал overuse теперь в колонке «Подсказки». Первая из новых колонок («Балл») отделена от задач через `border-l-2 border-slate-200` в `<th>` и `<td>`. Все новые `<td>` используют `text-sm` (14px) + `tabular-nums`. Константа `hintOveruseThreshold(taskCount)` остаётся единым источником — не дублируется.

**UX-отклонение от spec по AC-4 (in_progress):** spec требует «текущие агрегаты» в колонках Балл/Подсказки для в-процессе студентов. Backend (TASK-1) сейчас возвращает `total_score=0`, `hint_total=0` для `submitted=false` — литеральные `0/14` и `0` неотличимы от `not_started` и вводят репетитора в заблуждение. Принято UX-решение: для `in_progress` показывать `—` в Балл и Подсказки, `— в процессе` — только в колонке Время. Backend-апгрейд на партиальные агрегаты для in_progress — P1, отдельная итерация. При реализации frontend обязан обновить ветку `displayStatus === 'in_progress'` в `HeatmapRow`.

### P0-3. Сброс локального `StudentsList` (если ещё не сделан в Results v2 TASK-5)

Если на момент имплементации этой фичи в `TutorHomeworkDetail.tsx` ещё остались локальные fallback-колонки «Балл/Подсказки/Время» — удалить их. **Single source of truth** = `HeatmapGrid`. Никаких дублирующих колонок над/под таблицей.

**Acceptance:** AC-5 (нет рассинхрона). ✅ **Done 2026-04-08** — N/A: в `TutorHomeworkDetail.tsx` на момент TASK-2 дублирующих колонок «Балл/Подсказки/Время» нет. `StudentsList` был заменён на `HeatmapGrid` ещё в Results v2 TASK-5. Grep по `total_score` / `total_max` / `total_time_minutes` вне `HeatmapGrid` / `heatmapStyles` / `tutorHomeworkApi` — пусто.

---

## P1 / Parking Lot

- Сортировка по любой из 3 колонок (clickable header → state в `HeatmapGrid`, без backend-изменений).
- «Активное время» вместо wall-clock (sum интервалов между сообщениями ≤ 5 мин).
- Сравнение со средним по группе («время: 47 мин, +12 мин против среднего»).
- Колонка «попыток» (attempts).
- Денормализация `total_time_minutes` в `homework_tutor_threads` (если на пилоте `handleGetResults` начнёт тормозить).
- **Backend partial aggregates для `in_progress` + frontend ветка `displayStatus === 'in_progress'`** (review note 2026-04-08). `handleGetResults` сейчас возвращает `total_score=0` / `hint_total=0` для `submitted=false` — `HeatmapRow` маскирует это до `—` (UX-отклонение от AC-4). Когда backend начнёт считать частичные агрегаты для in-progress, **обязательно** обновить ветку `displayStatus === 'in_progress'` в `HeatmapGrid.tsx` чтобы Балл/Подсказки показывали `formatScore(...)` / `{hintTotal}` вместо em-dash.

---

## Risks

| # | Риск | Митигация |
|---|---|---|
| R1 | Wall-clock time обманчив (паузы) | Принимаем для v1; switch на active time — P1, отдельная итерация |
| R2 | `Σ task.max_score` для пустого ДЗ = 0 → деление на ноль | Backend защитный guard: если `total_max === 0` → не считать avg, frontend рендерит `—` |
| R3 | На iPhone SE 3 правые колонки выпадают за viewport | Принимаем — горизонтальный скролл уже работает в Heatmap (`overflow-x-auto touch-pan-x`) |
| R4 | Drift между `task_states.hint_count` и количеством `kind='hint'` сообщений | Источник истины — `task_states.hint_count` (как в Results v2). Backfill при необходимости вне scope этой фичи |
| R5 | Запрос `MIN/MAX(created_at)` без индекса медленный на больших ДЗ | Существующий индекс по `(thread_id, created_at)` достаточен. Проверить EXPLAIN на staging до релиза |

---

## Validation

```bash
npm run lint
npm run build
npm run smoke-check
```

Дополнительно:

- **Manual Chrome desktop:** ДЗ с 5 учениками — все 3 колонки видны без скролла; 26 задач × 10 учеников — горизонтальный скролл, last 3 cols в скролле.
- **Manual Safari macOS 15+:** sticky колонка имени работает, последние 3 колонки видны в скролле.
- **Manual iOS Safari iPhone SE 375px:** swipe horizontal достаёт 3 правые колонки; нет auto-zoom (cells — не inputs).
- **Cross-feature smoke:** клик по строке → drill-down (Results v2 TASK-6) работает; клик по клетке → drill-down с filter (TASK-6) работает; модалка правки балла (TASK-7) обновляет `total_score` строки после refetch.
- **Backend EXPLAIN** на staging: новый запрос на time не делает full scan `homework_tutor_thread_messages`.

> **Pre-merge owner checklist (review note 2026-04-08):** Reviewer (Claude Code) подтвердил статические проверки + lint baseline на PR-touched файлах. Перед merge **автор PR обязан** добавить в PR description:
> 1. Скриншоты Chrome desktop 5×7 + 10×26 (горизонтальный скролл достаёт «Время»);
> 2. Скриншот Safari macOS 15+ (sticky имя не дрожит при scroll);
> 3. Скриншот iPhone SE 375px (swipe horizontal достаёт три правые колонки, нет auto-zoom);
> 4. EXPLAIN на staging для `homework_tutor_thread_messages.in('thread_id', ...)` запроса — должен быть `Bitmap Index Scan` / `Index Scan` по `idx_thread_messages_thread`, **не** `Seq Scan`.

---

## Phasing

Семь требований нет — всего 3 P0. Делается одним PR. Без разбиения на фазы.

Порядок коммитов внутри PR:
1. Backend `handleGetResults` + типы (P0-1).
2. `heatmapStyles.ts` — добавить `formatTotalTime`.
3. `HeatmapGrid.tsx` — colgroup, thead, row.
4. Удаление дубликатов (P0-3, если есть).
5. Manual smoke + screenshots в PR description.

---

## Implementation Tasks

См. отдельный файл `tasks.md` (создаётся по запросу). На текущий момент — 1 задача для Claude Code, ревью Codex по чек-листу из `homework-results-v2/tasks.md` (тот же reviewer-промпт).

---

## История изменений

- **2026-04-07** — Draft, Vladimir. На основе мока `HomeworkResultsV2Mock.jsx` (правые колонки) и PRD `./prd.md`.
- **2026-04-07** — P0-1 (backend `handleGetResults` + тип `TutorHomeworkResultsPerStudent`) ✅ Done.
- **2026-04-08** — P0-2 (frontend 3 правые колонки в `HeatmapGrid`) ✅ Done. P0-3 ✅ N/A (дубликатов не осталось). Зафиксировано отклонение от AC-4 по in_progress — будет исправлено одновременно с backend-апгрейдом на партиальные агрегаты.
