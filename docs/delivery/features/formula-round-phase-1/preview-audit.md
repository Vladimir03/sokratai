# Preview Audit: Formula Round Phase 1

**Дата:** 2026-04-08
**Статус:** TASK-0 complete — блокеров для TASK-1 нет

> Этот документ закрывает Open Question #1 из `spec.md`:
> «используется ли в preview существующая `homework_tutor_*` схема или параллельная?»
>
> **Ответ: параллельная.** Подробности — в секции «Гэпы».

---

## 1. REUSE / MIGRATE / DROP — таблица

### Формула-движок (`src/lib/formulaEngine/`)

| Файл | Решение | Обоснование |
|---|---|---|
| `src/lib/formulaEngine/types.ts` | **REUSE + minor tweak** | Типы корректны. `RoundConfig.lives` и `RoundResult.livesRemaining` сохраняем в engine API (не ломаем `generateRound`), но скрываем в UI. Единственное добавление — `FormulaRoundConfig` interface для `formula_round_config jsonb` payload (Phase 1 schema). |
| `src/lib/formulaEngine/formulas.ts` | **REUSE 1:1** | 12 формул кинематики. Phase 1 seed формирует `kb_tasks` из `mechanics-formulas.json` — engine-массив и DB-seed независимы. |
| `src/lib/formulaEngine/questionGenerator.ts` | **REUSE 1:1** | Вся логика генерации (3 типа, mutation library, distractor selection) переиспользуется без изменений. |
| `src/lib/formulaEngine/index.ts` | **REUSE 1:1** | Barrel-export. |

### Карточки (`src/components/homework/formula-round/`)

| Файл | Решение | Обоснование |
|---|---|---|
| `BuildFormulaCard.tsx` | **REUSE 1:1** | Логика токенов/numerator/denominator без изменений. |
| `TrueOrFalseCard.tsx` | **REUSE 1:1** | Без изменений. |
| `SituationCard.tsx` | **REUSE 1:1** | Без изменений. |
| `FeedbackOverlay.tsx` | **REUSE 1:1** | Без изменений. |
| `RoundProgress.tsx` | **MIGRATE** | Убрать сердечки-жизни из UI (Phase 1 — без жизней). Заменить на простую `N / M` прогресс-строку. Props `lives` и `livesLost` — удалить или игнорировать. |
| `FormulaRoundScreen.tsx` | **MIGRATE** | Две точки: (1) убрать «game over» при `livesRemaining === 0` — ученик проходит все 10 вопросов вне зависимости от ошибок; (2) убрать передачу lives в `RoundProgress`. Логика answer-dispatch по картам — без изменений. |
| `RoundResultScreen.tsx` | **MIGRATE → переименовать в `FormulaRoundResultScreen.tsx`** | Убрать секцию «Жизни остались: N». Поменять CTA: `onClose` → «Вернуться к ДЗ» (сигнализирует `GuidedHomeworkWorkspace` перейти к следующей задаче); добавить `onNextTask?: () => void`. Добавить тихую XP-плашку (`bg-slate-50 border-slate-200`). Props: `onRetryErrors` сохраняется. |

### Page / Route

| Файл | Решение | Обоснование |
|---|---|---|
| `src/pages/StudentFormulaRound.tsx` | **MIGRATE → DROP as page** | Вспомогательные функции `getFormulaPool()`, `toRoundConfig()`, `buildQuestions()` + preview auth bypass (PREVIEW_TESTERS + PREVIEW_ROUNDS + `isPreviewHost()`) мигрируют в `FormulaRoundPlayer.tsx`. Standalone page удаляется. |
| `src/App.tsx` route `/homework/:id/round/:roundId` | **DROP** | Маршрут убирается. Теперь раунд рендерится inline в `GuidedHomeworkWorkspace`. Preview QA-ссылки из `formula-round-seed.sql` обновляются (новый URL). |

### API / Hooks

| Файл | Решение | Обоснование |
|---|---|---|
| `src/lib/formulaRoundApi.ts` | **DROP + replace** | Весь файл — preview-specific. Интерфейсы `FormulaRound`, `FormulaRoundResultRecord`, `SaveFormulaRoundResultResponse` и функции `fetchFormulaRound / fetchFormulaRoundResults / saveFormulaRoundResult` привязаны к старым `/formula-rounds/*` endpoints и старым таблицам. Заменяются новыми функциями `getFormulaRoundConfig`, `submitFormulaRoundAttempt`, `getFormulaRoundAttempts` в `studentHomeworkApi.ts` (согласно spec 5.1). |
| `src/hooks/useFormulaRound.ts` | **DROP + replace** | Хуки для preview-API. Заменяются новыми хуками в рамках `studentHomeworkApi.ts` / отдельного `useFormulaRound.ts` с новой сигнатурой. |

### Backend

| Файл/секция | Решение | Обоснование |
|---|---|---|
| `homework-api/index.ts` — `FormulaRoundRecord` interface | **DROP** | Preview type для старой схемы. |
| `homework-api/index.ts` — `verifyFormulaRoundOwnership()` | **DROP** | Работает с `formula_rounds` таблицей. Заменяется проверкой через `homework_tutor_tasks` + RLS. |
| `homework-api/index.ts` — `handleGetFormulaRound()` | **DROP** | Preview endpoint `GET /formula-rounds/:roundId`. |
| `homework-api/index.ts` — `handleListFormulaRoundResults()` | **DROP** | Preview endpoint `GET /formula-rounds/:roundId/results`. |
| `homework-api/index.ts` — `handleCreateFormulaRoundResult()` | **DROP** | Preview endpoint `POST /formula-rounds/:roundId/results`. Клиент доверял своему score — новый submit endpoint делает server-side validation. |
| `homework-api/index.ts` — route matchers для `formula-rounds/*` | **DROP** | Три `if (seg[0] === "formula-rounds" ...)` блока на строках ~4898-4912. |
| `homework-api/README.md` — секция «Student Formula Round Endpoints» | **DROP / rewrite** | Документирует preview endpoints. Перезаписать после TASK-2. |

### DB / Migrations / Seed

| Артефакт | Решение | Обоснование |
|---|---|---|
| `supabase/migrations/20260405083400_...sql` | **DROP via new migration** | Создаёт `formula_rounds` + `formula_round_results` — параллельная preview схема. Заменяется Phase 1 схемой (`task_kind` в `homework_tutor_tasks` + `formula_round_attempts` + `formula_round_item_results`). Новая миграция `DROP TABLE IF EXISTS formula_round_results, formula_rounds` нужна до деплоя Phase 1. |
| `supabase/migrations/20260405083626_...sql` | **PARTIAL DROP** | Auth users + profiles создаются здесь — они переиспользуются в новом seed. Но `INSERT INTO formula_rounds ...` устарела — при дропе таблицы `formula_rounds` этот insert упадёт. Новая seed-миграция должна заменить `formula_rounds` row на `homework_tutor_tasks` row с `task_kind='formula_round'`. |
| `supabase/seed/formula-round-seed.sql` | **MIGRATE** | Файл содержит `workflow_mode: 'classic'` в assignments — колонка уже дропнута (миграция `20260406120000_drop_classic_homework.sql`). Также создаёт row в `formula_rounds` — устаревшая схема. Весь DML-блок assignments + formula_rounds нужно переписать под Phase 1 схему (создать assignment + `homework_tutor_tasks` row с `task_kind='formula_round'`). Auth users/profiles блок — оставить. |
| `src/integrations/supabase/types.ts` | **auto-regen** | Авто-генерируется из schema после новых миграций. Не трогать вручную. |

---

## 2. Preview-only маршруты и их судьба

| Маршрут / endpoint | Источник | Судьба |
|---|---|---|
| `GET /homework/:id/round/:roundId` (React route) | `src/App.tsx` строка 164 | **DROP** — маршрут убирается. Inline render в `GuidedHomeworkWorkspace`. |
| Preview QA-ссылки в seed-файле (`?student=<uuid>`) | `supabase/seed/formula-round-seed.sql` строки 7-17 | **MIGRATE** — обновить URL на `?taskId=<task_uuid>` или аналогичный preview-param когда student homework workflow поддержит formula_round. Preview bypass `isPreviewHost()` и PREVIEW_TESTERS переезжают в `FormulaRoundPlayer.tsx`. |
| `GET /formula-rounds/:roundId` | `homework-api/index.ts` | **DROP** — заменяется `GET /assignments/:id/tasks/:taskId/formula-round/config` |
| `GET /formula-rounds/:roundId/results` | `homework-api/index.ts` | **DROP** — заменяется `GET /assignments/:id/tasks/:taskId/formula-round/results/:studentId` |
| `POST /formula-rounds/:roundId/results` | `homework-api/index.ts` | **DROP** — заменяется `POST /assignments/:id/tasks/:taskId/formula-round/submit` (с server-side validation) |

---

## 3. Preview-only таблицы / колонки и их судьба

| Таблица / колонка | Статус | Судьба |
|---|---|---|
| `formula_rounds` (вся таблица) | Существует в DB | **DROP** — новая миграция `DROP TABLE IF EXISTS formula_rounds CASCADE`. Данных prod нет, только dev seed. |
| `formula_round_results` (вся таблица) | Существует в DB | **DROP** — `DROP TABLE IF EXISTS formula_round_results`. |
| `homework_tutor_tasks.task_kind` | Не существует | **ADD** — миграция 1 (`20260408110000_add_formula_round_task_kind.sql`). |
| `homework_tutor_tasks.formula_round_config` | Не существует | **ADD** — та же миграция 1. |
| `formula_round_attempts` (новая таблица) | Не существует | **CREATE** — миграция 2 (`20260408110100_create_formula_round_tables.sql`). |
| `formula_round_item_results` (новая таблица) | Не существует | **CREATE** — та же миграция 2. |
| `kb_tasks.kb_task_kind` | Не существует | **ADD** — миграция 3 (`20260408110200_add_kb_formula_kind.sql`). |

---

## 4. Гэпы между preview и spec

### Архитектурный гэп (главный)

Preview использует **параллельную схему** (`formula_rounds` → `formula_round_results`), напрямую связанную с `homework_tutor_assignments`. Spec требует **интеграцию в `homework_tutor_tasks`** с `task_kind='formula_round'` и отдельными таблицами попыток.

Следствия:
- Completion раунда в preview **не влияет** на `homework_tutor_task_states` → в `HeatmapGrid` раунд невидим.
- Results в preview — это flat `score`/`total` без per-item breakdown → tutor drill-down (`FormulaRoundDrillDown`) в preview не реализован.
- Preview маршрут — standalone, не inline в homework workflow.

### Гэп: жизни vs без жизней

Preview: `RoundConfig.lives=3`, `FormulaRoundScreen` завершает раунд досрочно при `livesRemaining===0`, `RoundProgress` показывает сердечки, `RoundResultScreen` показывает остаток жизней.

Spec (Phase 1): «без жизней» — ученик проходит все 10 вопросов, жизни не отображаются.

Затронутые файлы: `FormulaRoundScreen.tsx`, `RoundProgress.tsx`, `RoundResultScreen.tsx` (+ rename).

### Гэп: server-side validation

Preview: client считает `score`/`total`, сохраняет батчем через `POST /formula-rounds/:roundId/results`. Backend **не проверяет** правильность ответов — доверяет клиенту.

Spec: server-side validation в `formula_round.ts` (новый модуль), записывает per-item результаты в `formula_round_item_results`. `accuracy × max_score → final_score` считается на сервере.

### Гэп: KB-формулы

Preview: формулы — только в `src/lib/formulaEngine/formulas.ts` (статический TS-массив). В `kb_tasks` формул нет.

Spec: 12 формул кинематики seed-ятся в `kb_tasks` с `kb_task_kind='formula'`. Tutor в `KBPickerSheet` выбирает тему (`formula_topic` mode). `formula_round_item_results` ссылаются на `kb_tasks.id` через `formula_kb_task_id`.

Следствие: нужна миграция `kb_task_kind`, seed-миграция из `mechanics-formulas.json`, и маппинг engine-формул по `formulaId` на `kb_tasks.id`.

### Гэп: tutor UI

Preview: нет ни одного tutor-компонента для formula rounds — ни конструктор, ни HeatmapGrid, ни drill-down.

Spec: `HWFormulaRoundCard.tsx`, `KBPickerSheet` mode `formula_topic`, `FormulaRoundDrillDown.tsx`, HeatmapGrid column icon.

### Гэп: inline vs standalone

Preview: `StudentFormulaRound.tsx` — отдельная страница с `Navigation` + `AuthGuard`. Ученик переходит на отдельный URL.

Spec: `FormulaRoundPlayer.tsx` рендерится **внутри** `GuidedHomeworkWorkspace.tsx` при `task.task_kind === 'formula_round'`. `TaskStepper` отображает раунд как один шаг наравне с задачами.

### Гэп: seed сломан (критично)

`supabase/seed/formula-round-seed.sql` содержит `workflow_mode: 'classic'` в INSERT в `homework_tutor_assignments` — колонка **удалена** миграцией `20260406120000_drop_classic_homework.sql`. Seed не работает на текущей schema. Нужно исправить в рамках TASK-1.

---

## 5. Сверка spec 5.1 vs реальность

### Файлы из spec 5.1 «Затрагиваемые файлы»

**Новые файлы** — не существуют, создавать с нуля:

| Файл из spec | Статус |
|---|---|
| `src/components/tutor/HWFormulaRoundCard.tsx` | ❌ Не существует |
| `src/components/tutor/results/FormulaRoundDrillDown.tsx` | ❌ Не существует |
| `src/components/homework/formula-round/FormulaRoundPlayer.tsx` | ❌ Не существует |
| `src/components/homework/formula-round/FormulaExplanationCard.tsx` | ❌ Не существует |
| `src/components/homework/formula-round/FormulaRoundResultScreen.tsx` | ❌ Не существует (мигрирует из `RoundResultScreen.tsx`) |
| `supabase/functions/homework-api/formula_round.ts` | ❌ Не существует |
| Миграция `20260408110000_add_formula_round_task_kind.sql` | ❌ Не существует |
| Миграция `20260408110100_create_formula_round_tables.sql` | ❌ Не существует |
| Миграция `20260408110200_add_kb_formula_kind.sql` | ❌ Не существует |
| Миграция `20260408120000_seed_mechanics_formulas.sql` | ❌ Не существует |

**Изменяемые файлы** — все существуют ✓:

`TutorHomeworkCreate.tsx`, `HWTasksSection.tsx`, `KBPickerSheet.tsx`, `TutorHomeworkDetail.tsx`, `HeatmapGrid.tsx`, `GuidedHomeworkWorkspace.tsx`, `src/types/homework.ts`, `studentHomeworkApi.ts`, `tutorHomeworkApi.ts`, `homework-api/index.ts`.

### Файлы preview, которые spec 5.1 не упоминает

Эти файлы существуют в preview, но не фигурируют в spec. Требуют явного решения:

| Файл | Решение |
|---|---|
| `src/pages/StudentFormulaRound.tsx` | DROP page, логика → `FormulaRoundPlayer.tsx` |
| `src/lib/formulaRoundApi.ts` | DROP + replace |
| `src/hooks/useFormulaRound.ts` | DROP + replace |
| `src/lib/formulaEngine/` (все 4 файла) | REUSE 1:1 — spec не упоминает, потому что они не меняются |
| `src/components/homework/formula-round/FormulaRoundScreen.tsx` | MIGRATE (убрать lives logic) |
| `src/components/homework/formula-round/RoundProgress.tsx` | MIGRATE (убрать сердечки) |
| `src/components/homework/formula-round/RoundResultScreen.tsx` | MIGRATE → rename `FormulaRoundResultScreen.tsx` |
| `BuildFormulaCard.tsx`, `TrueOrFalseCard.tsx`, `SituationCard.tsx`, `FeedbackOverlay.tsx` | REUSE 1:1 |
| `supabase/migrations/20260405083400_...sql` | DROP via новая DROP-миграция |
| `supabase/migrations/20260405083626_...sql` | PARTIAL DROP (formula_rounds insert → устаревает) |
| `supabase/seed/formula-round-seed.sql` | MIGRATE (fix workflow_mode, заменить formula_rounds → homework_tutor_tasks) |
| `homework-api/README.md` | DROP formula round section, rewrite после TASK-2 |

**Расхождение со spec 5.1:** spec не включает в список файлы preview-инфраструктуры (`StudentFormulaRound.tsx`, `formulaRoundApi.ts`, `useFormulaRound.ts`, preview migrations). Это нормально — spec описывает целевое состояние, а не переходный путь. Данный документ (TASK-0) заполняет этот пробел.

---

## 6. Открытые риски

| Риск | Уровень | Митигация |
|---|---|---|
| `formula_rounds` / `formula_round_results` уже в prod DB — DROP может сломать если какой-то сервис их читает | Низкий | Проверено: единственный consumer — preview frontend (`formulaRoundApi.ts`) и backend handlers — оба будут удалены в рамках Phase 1. Cascade DROP через `formula_round_results` безопасен. |
| `workflow_mode` в `formula-round-seed.sql` — seed уже сломан | Высокий | Фиксируется в TASK-1 как часть seed-миграции. Нельзя запустить локальный QA без фикса. |
| `RoundConfig.lives` / `RoundResult.livesRemaining` — fields остаются в engine types, но скрыты в UI | Низкий | Если через 2 фазы добавят optional lives — поле уже есть. Если нет — чистый drop в Phase 2. Не создаёт runtime проблем. |
| Server-side answer validation в `formula_round.ts` — нужно реализовать ту же логику что в `questionGenerator.ts` | Средний | `questionGenerator.ts` экспортирует `BUILD_RECIPES` и все ответы. Валидатор импортирует их напрямую — не дублирует логику. Но `formula_round.ts` — Deno edge function, нужно убедиться что импорт из `./questionGenerator` корректен в Supabase Functions context. |
| Маппинг `formulaId` (engine string, напр. `"kin.01"`) на `kb_tasks.id` (UUID) | Средний | Seed-миграция создаёт `kb_tasks` с deterministic UUID (фиксированные, не `gen_random_uuid()`). `FormulaRoundPlayer` должен получать config с UUID из API, не из engine. Нужен маппинг `kin.01 → UUID` в seed или в `formula_round_config.formulas[]`. |
| `kb_tasks` с `kb_task_kind='formula'` попадут в существующие `fetch_catalog_tasks_v2` запросы | Высокий | Фиксируется в TASK-1/2: добавить `WHERE kb_task_kind = 'problem'` в `fetch_catalog_tasks_v2`. Без этого существующий KB-каталог будет показывать формулы как задачи. |
| Preview-bypass (`PREVIEW_TESTERS`, `isPreviewHost()`) — нужен в `FormulaRoundPlayer`, но Phase 1 embed — inline в homework workflow | Средний | Inline render не требует standalone preview bypass. PREVIEW_TESTERS могут авторизоваться обычным путём через seed-аккаунты и открыть ДЗ. Preview bypass `?student=` для standalone страницы — более не нужен. Удалить вместе с `StudentFormulaRound.tsx`. |

---

## 7. Recommendation: можно начинать TASK-1?

**Да, без блокеров.** Open Question #1 закрыт: preview использует параллельную схему, объём миграционной работы понятен.

**Порядок TASK-1:**

1. Новая DROP-миграция для `formula_round_results`, `formula_rounds` (cleanup preview tables).
2. Миграция 1: `task_kind` + `formula_round_config` в `homework_tutor_tasks`.
3. Миграция 2: `formula_round_attempts` + `formula_round_item_results` + RLS.
4. Миграция 3: `kb_task_kind` в `kb_tasks` + фильтр `kb_task_kind='problem'` в `fetch_catalog_tasks_v2` / `fetch_catalog_tasks_all`.
5. Seed-миграция (Миграция 4): 12 формул кинематики из `mechanics-formulas.json` → `kb_tasks` с фиксированными UUID.
6. Обновить `supabase/seed/formula-round-seed.sql`: убрать `workflow_mode`, заменить `formula_rounds` INSERT на `homework_tutor_tasks` INSERT с `task_kind='formula_round'` и `formula_round_config` JSONB.
7. Smoke check: `npm run lint && npm run build && npm run smoke-check`.

**Параллельно с TASK-1 можно начинать:**
- TASK-2 (backend handlers) — не зависит от frontend
- Migrate `RoundProgress.tsx` + `FormulaRoundScreen.tsx` (убрать lives) — независимо от schema

**Блокер для TASK-4 (student inline):** нужны TASK-1 (schema) + TASK-2 (backend submit endpoint) + `homework_tutor_tasks.task_kind` в `handleGetAssignment` (TASK-2).
