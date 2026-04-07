# Tasks — Homework Student Totals

**Status:** Draft
**Pipeline step:** 5 (TASKS)
**Owner:** Vladimir
**Date:** 2026-04-07
**Спека:** `./spec.md`
**PRD:** `./prd.md`

---

## Обзор

3 задачи, один PR, без разбиения на фазы (3 P0 < 5, см. Phasing в spec.md).

| # | Задача | Агент | Файлы | Покрывает AC |
|---|---|---|---|---|
| TASK-1 | Backend: per-student агрегаты в `handleGetResults` | Claude Code | `supabase/functions/homework-api/index.ts`, `src/lib/tutorHomeworkApi.ts` | AC-9 |
| TASK-2 | Frontend: 3 правые колонки в `HeatmapGrid` + `formatTotalTime` | Claude Code | `src/components/tutor/results/HeatmapGrid.tsx`, `src/components/tutor/results/heatmapStyles.ts` | AC-1..AC-8, AC-10 |
| TASK-3 | Cleanup: удалить дублирующие колонки в `TutorHomeworkDetail.tsx` (если остались) | Claude Code | `src/pages/tutor/TutorHomeworkDetail.tsx` | AC-5 |
| REVIEW | Независимое code-review по чек-листу | Codex | — | все |

Порядок в PR: TASK-1 → TASK-2 (heatmapStyles сначала, потом HeatmapGrid) → TASK-3 → manual smoke.

---

## TASK-1 — Backend: per-student агрегаты

**Job:** R1-2 (понять что усвоил каждый ученик).
**Agent:** Claude Code.
**Files:** `supabase/functions/homework-api/index.ts` (`handleGetResults`), `src/lib/tutorHomeworkApi.ts` (тип `TutorHomeworkResultsPerStudent`).
**Acceptance:** AC-9.

### Что сделать
1. В `handleGetResults` добавить в каждый `per_student[*]` additive поля:
   - `total_score: number` — `Σ final_score` через существующий `computeFinalScore(ts, maxScore)`. Не дублировать формулу.
   - `total_max: number` — `Σ task.max_score` по **всем задачам ДЗ** (посчитать один раз вне цикла per_student). **Не** суммировать по `task_scores`, иначе для не приступивших будет 0/0.
   - `hint_total: number` — `Σ hint_count` по `task_scores` ученика.
   - `total_time_minutes: number | null` — `null` если нет thread или messages; иначе `Math.max(1, round((maxCreatedAt - minCreatedAt) / 60000))`.
2. Time-агрегат одним запросом: JOIN `homework_tutor_threads` → `homework_tutor_thread_messages`, `MIN/MAX(created_at)` с `GROUP BY student_id`. Результат в `Map<student_id, { first: string; last: string }>`. **Никакого N+1.**
3. Guard: если `total_max === 0` — всё равно вернуть `total_score: 0`, `total_max: 0` (frontend отрендерит `—`).
4. Обновить тип `TutorHomeworkResultsPerStudent` в `src/lib/tutorHomeworkApi.ts` — добавить 4 поля. Additive, существующих consumer'ов не ломаем.

### Guardrails
- Не трогать существующие поля `task_scores`, `needs_attention`, `submitted`.
- Не денормализовать в `homework_tutor_threads` (P1, см. Parking Lot).
- EXPLAIN новый time-запрос на staging перед мержем — должен использовать индекс `(thread_id, created_at)`, не full scan.
- `.claude/rules/40-homework-system.md` → "Merged Detail + Results страница" — не ломать semantic invariant `needs_attention`.

### Mandatory end block
```
npm run lint
npm run build
npm run smoke-check
```
Перечислить изменённые файлы и вывод EXPLAIN нового запроса.

---

## TASK-2 — Frontend: 3 правые колонки в HeatmapGrid

**Job:** R1-2, R1-3.
**Agent:** Claude Code.
**Files:** `src/components/tutor/results/HeatmapGrid.tsx`, `src/components/tutor/results/heatmapStyles.ts`.
**Acceptance:** AC-1..AC-8, AC-10.
**Depends on:** TASK-1 (нужны поля в response).

### Что сделать
1. В `heatmapStyles.ts` добавить и экспортировать helper:
   ```ts
   export function formatTotalTime(
     min: number | null,
     status: 'completed' | 'in_progress' | 'not_started'
   ): string
   ```
   - `not_started` → `—`
   - `in_progress` → `— в процессе`
   - `completed` + `null` → `—`
   - `completed` + N → `${N} мин`
2. В `HeatmapGrid.tsx`:
   - `<colgroup>`: добавить три `<col>` — `90px` (балл), `60px` (подсказки), `90px` (время). Итог ширины: `220 + 56·N + 90 + 60 + 90`.
   - `<thead>`: три новых `<th className="text-right">`: «Балл», `<Lightbulb className="w-3.5 h-3.5 inline" aria-hidden />` с `aria-label="Подсказки"`, «Время». Sticky не нужен.
   - `HeatmapRow`: три новых `<td className="text-right">` с данными из `per_student[*].total_score / total_max / hint_total / total_time_minutes`.
   - Статус ученика для `formatTotalTime`: вывести через существующие поля (`submitted`, наличие thread/messages). Если thread completed → `'completed'`, если есть активный thread без completion → `'in_progress'`, иначе `'not_started'`.
   - Форматирование балла: `formatScore(total_score, total_max)` (уже есть в heatmapStyles), класс `font-semibold text-slate-900`. Если `total_max === 0` → `—` `text-slate-400`.
   - Hint cell: число в `text-slate-500`. Если `hint_total >= HINT_OVERUSE_THRESHOLD` (существующая константа, **не дублировать**) → чип `bg-amber-100 text-amber-900 rounded-full px-2 py-0.5` с inline Lightbulb 12px.
3. `React.memo(HeatmapRow)` остаётся. Новые props — скалярные, ре-рендер не страдает.
4. Горизонтальный скролл родительского `<div>` уже `overflow-x-auto touch-pan-x` — не трогать.

### Guardrails
- **Не возвращать** `w-full` на `<table>` — сожмёт столбцы, сломает скролл. Оставить `width: max-content` + `table-layout: fixed`.
- **Не менять** `border-separate border-spacing-0` на `border-collapse` — sticky name column сломается в Safari (`.claude/rules/80-cross-browser.md`).
- Клик по новым ячейкам не должен триггерить другой drill-down — поведение row click (expand) остаётся. `e.stopPropagation` на cell click сохранить только там где он уже есть (TASK-6 Results v2).
- Font-size ≥14px на новых `<td>` — не inputs, auto-zoom на iOS не сработает, но всё равно не опускать ниже.
- Lucide Lightbulb, не emoji (`.claude/rules/90-design-system.md` → anti-patterns #1).
- Не импортировать `framer-motion` (`.claude/rules/performance.md`).
- `HINT_OVERUSE_THRESHOLD` берём из уже существующего места в проекте (Results v2 TASK-5). Если он локален в HeatmapGrid — ок, просто использовать. Новых констант не вводить.

### Manual QA (входит в AC-10)
- Chrome desktop: ДЗ 5×7 задач — всё видно; 10×26 — горизонтальный скролл, sticky имя работает.
- Safari macOS 15+: sticky работает.
- iOS Safari iPhone SE 375px: swipe horizontal достаёт 3 правые колонки, нет auto-zoom.
- Cross-feature: row click → drill-down (Results v2 TASK-6) не сломан; cell click → drill-down с filter работает; edit-score modal (TASK-7) после refetch обновляет `total_score`.

### Mandatory end block
```
npm run lint
npm run build
npm run smoke-check
```
Перечислить изменённые файлы + приложить скриншоты Chrome desktop, Safari macOS, iPhone SE (DevTools emulation).

---

## TASK-3 — Cleanup дублирующих колонок

**Job:** consistency (AC-5).
**Agent:** Claude Code.
**Files:** `src/pages/tutor/TutorHomeworkDetail.tsx`.
**Acceptance:** AC-5.

### Что сделать
- Проверить, остались ли в `TutorHomeworkDetail.tsx` (или соседних компонентах) локальные колонки «Балл / Подсказки / Время» над/под таблицей, или локальные агрегаты по ученику, дублирующие новые данные из `HeatmapGrid`.
- Если остались — удалить. Single source of truth = `HeatmapGrid`.
- Если не остались — в PR описании явно написать "TASK-3: no duplicates found, no-op".

### Guardrails
- Не удалять шапку-сводку (`ResultsHeader`) — она показывает метрики по **группе**, не по ученику.
- Не ломать action block «Требует внимания» — там другой набор полей.
- `.claude/rules/40-homework-system.md` → secton "Merged Detail + Results страница" — канонический URL `/tutor/homework/:id`, не трогать route.

### Mandatory end block
```
npm run lint
npm run build
npm run smoke-check
```

---

## Copy-paste промпты для агентов

### Промпт для TASK-1 (Claude Code)

```
Ты — Software Engineer в проекте SokratAI. Прочитай перед началом:
1. .claude/rules/00-read-first.md
2. CLAUDE.md
3. .claude/rules/10-safe-change-policy.md
4. .claude/rules/40-homework-system.md (особенно секции HeatmapGrid и Merged Detail + Results)
5. .claude/rules/performance.md
6. docs/delivery/features/homework-student-totals/spec.md
7. docs/delivery/features/homework-student-totals/prd.md

Задача: TASK-1 — расширить handleGetResults в supabase/functions/homework-api/index.ts полями total_score, total_max, hint_total, total_time_minutes в каждом элементе per_student.

Требования:
- total_score = Σ final_score через существующий computeFinalScore(ts, maxScore). Формулу НЕ дублировать.
- total_max = Σ task.max_score по всем задачам ДЗ (считать ОДИН раз вне цикла per_student, не суммировать по task_scores).
- hint_total = Σ hint_count по task_scores ученика.
- total_time_minutes: ОДИН SQL запрос с JOIN homework_tutor_threads → homework_tutor_thread_messages, MIN/MAX(created_at) GROUP BY student_id, собрать в Map. Math.max(1, round(diff_ms / 60000)). null если нет thread/messages.
- Guard: total_max === 0 → вернуть total_score: 0, total_max: 0 (не делить).
- Обновить тип TutorHomeworkResultsPerStudent в src/lib/tutorHomeworkApi.ts (additive).
- Никакого N+1. EXPLAIN запроса на staging — должен использовать индекс (thread_id, created_at).

Acceptance: AC-9 из spec.md.

Guardrails:
- Additive поля, не ломать существующих consumer'ов.
- Не трогать task_scores, needs_attention, submitted, semantic invariant needs_attention.
- Не денормализовать в homework_tutor_threads.

В конце обязательно:
npm run lint
npm run build
npm run smoke-check

Приложи список изменённых файлов и вывод EXPLAIN нового запроса.
```

### Промпт для TASK-2 (Claude Code)

```
Ты — Software Engineer в проекте SokratAI. Прочитай перед началом:
1. .claude/rules/00-read-first.md
2. CLAUDE.md
3. .claude/rules/40-homework-system.md (секции HeatmapGrid и Drill-down)
4. .claude/rules/80-cross-browser.md
5. .claude/rules/90-design-system.md
6. .claude/rules/performance.md
7. docs/delivery/features/homework-student-totals/spec.md

Задача: TASK-2 — добавить в src/components/tutor/results/HeatmapGrid.tsx три правые колонки Балл/Подсказки/Время. Helper formatTotalTime вынести в src/components/tutor/results/heatmapStyles.ts.

Требования:
1. heatmapStyles.ts → export function formatTotalTime(min: number|null, status: 'completed'|'in_progress'|'not_started'): string
   - not_started → '—'
   - in_progress → '— в процессе'
   - completed + null → '—'
   - completed + N → `${N} мин`
2. HeatmapGrid.tsx:
   - colgroup: три новых col — 90px, 60px, 90px
   - thead: три новых th (text-right). Заголовки: «Балл», Lightbulb icon (aria-label="Подсказки"), «Время». НЕ sticky.
   - HeatmapRow: три новых td (text-right) с total_score/total_max, hint_total, total_time_minutes из per_student.
   - Балл: formatScore(total_score, total_max), font-semibold text-slate-900. total_max===0 → '—' text-slate-400.
   - Подсказки: число text-slate-500. Если hint_total >= HINT_OVERUSE_THRESHOLD (существующая константа, НЕ дублировать) → чип bg-amber-100 text-amber-900 rounded-full px-2 py-0.5 + Lightbulb 12px inline.
   - Время: formatTotalTime(...). Статус вычислить из submitted + thread state.
3. React.memo(HeatmapRow) сохранить. Новые props — скалярные.

Acceptance: AC-1..AC-8, AC-10 из spec.md.

КРИТИЧНЫЕ guardrails (Safari/iOS):
- НЕ возвращать w-full на table — сломает горизонтальный скролл.
- НЕ менять border-separate → border-collapse — sticky name column сломается в Safari.
- НЕ импортировать framer-motion.
- Lucide Lightbulb, не emoji.
- font-size ≥14px на новых td.
- Не вводить вторую HINT_OVERUSE_THRESHOLD константу.

Manual QA обязателен:
- Chrome desktop: 5×7 и 10×26
- Safari macOS 15+
- iOS Safari iPhone SE 375 (DevTools emulation ок)
- Cross-feature: row click → drill-down не сломан, cell click → drill-down + filter работает, edit-score modal обновляет total_score после refetch.

В конце обязательно:
npm run lint
npm run build
npm run smoke-check

Приложи скриншоты и список изменённых файлов.
```

### Промпт для TASK-3 (Claude Code)

```
Ты — Software Engineer в проекте SokratAI. Прочитай:
1. CLAUDE.md
2. .claude/rules/40-homework-system.md (секция Merged Detail + Results)
3. docs/delivery/features/homework-student-totals/spec.md (P0-3)

Задача: TASK-3 — проверить src/pages/tutor/TutorHomeworkDetail.tsx на наличие локальных колонок Балл/Подсказки/Время над или под HeatmapGrid (остатки до Results v2 TASK-5). Если есть — удалить. Single source of truth = HeatmapGrid.

Если дубликатов нет — описать "no-op" в PR description, не вносить изменений.

Guardrails:
- НЕ удалять ResultsHeader (метрики по группе, не по ученику).
- НЕ трогать ResultsActionBlock.
- НЕ менять route /tutor/homework/:id.

Acceptance: AC-5.

В конце:
npm run lint
npm run build
npm run smoke-check
```

### Промпт для независимого code-review (Codex)

```
Ты — независимый reviewer (Codex) для проекта SokratAI. Задача — проверить PR по фиче homework-student-totals (добавление колонок Балл/Подсказки/Время в HeatmapGrid) против AC-1..AC-10 в docs/delivery/features/homework-student-totals/spec.md.

Перед ревью прочитай:
1. docs/delivery/features/homework-student-totals/spec.md
2. docs/delivery/features/homework-student-totals/prd.md
3. .claude/rules/40-homework-system.md (секции HeatmapGrid, Drill-down, Merged Detail + Results)
4. .claude/rules/80-cross-browser.md
5. .claude/rules/90-design-system.md
6. .claude/rules/performance.md

Чек-лист (пройти по каждому пункту и дать verdict PASS/FAIL + обоснование):

A. Acceptance Criteria
   - AC-1: порядок и заголовки колонок (Балл, Lightbulb icon, Время)
   - AC-2: форматы для сдавших (score/max, hint число + chip при overuse, время в мин)
   - AC-3: не сдавшие — три прочерка
   - AC-4: в процессе — Балл/Подсказки текущие, Время «— в процессе»
   - AC-5: row sum = сумме клеток (нет локальных дубликатов)
   - AC-6: hint chip визуально идентичен Results v2 (одна константа, одни токены)
   - AC-7: 720px → horizontal scroll, sticky имя
   - AC-8: row click → drill-down работает, cell click не ломает
   - AC-9: backend additive поля (total_score/total_max/hint_total/total_time_minutes)
   - AC-10: lint/build/smoke-check зелёный + manual Safari/iOS

B. Guardrails архитектуры
   - Single source of truth = HeatmapGrid
   - Нет дублирования computeFinalScore
   - Нет денормализации time в homework_tutor_threads
   - HINT_OVERUSE_THRESHOLD не продублирован
   - formatTotalTime в heatmapStyles.ts, не в HeatmapGrid

C. Cross-browser (Safari/iOS)
   - border-separate border-spacing-0 сохранён
   - width: max-content + table-layout: fixed сохранён (w-full НЕ вернулся)
   - touch-pan-x на скроллящем div сохранён
   - font-size ≥14px на новых td
   - sticky name column не сломана

D. Performance
   - React.memo(HeatmapRow) сохранён
   - Нет framer-motion
   - Нет N+1 в backend time-агрегате (один JOIN, один GROUP BY)

E. Design system
   - Lucide Lightbulb, не emoji
   - Цвета из палитры (bg-amber-100, text-slate-*, bg-accent), без hardcoded hex
   - Golos Text наследуется

F. React Query
   - Нет новых query keys (данные через существующий results query)
   - Нет лишних invalidate

G. Security / RLS
   - Новый time-запрос уважает RLS на homework_tutor_thread_messages
   - Backend не экспортирует raw timestamps в лишних местах

H. Migrations
   - Миграций нет (только код). Если добавлены — проверить naming и rollback.

I. Validation
   - npm run lint зелёный
   - npm run build зелёный
   - npm run smoke-check зелёный
   - EXPLAIN нового time-запроса приложен
   - Скриншоты Chrome/Safari/iPhone SE приложены

Формат ответа:
- По каждому пункту A-I: PASS / FAIL / N/A + одно предложение.
- В конце: общий verdict (APPROVE / REQUEST CHANGES) + топ-3 findings если REQUEST CHANGES.
```

---

## История изменений

- **2026-04-07** — Draft, Vladimir. 3 задачи + reviewer prompt на основе spec.md.
