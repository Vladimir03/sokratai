# Tasks: Формат проверки из KB + развернутое решение

**Spec**: `docs/delivery/features/check-format/spec.md`
**PRD**: `docs/delivery/features/check-format/prd.md`
**Дата**: 2026-04-01

---

## Phase 1 — P0 (деплоим первым)

### ~~TASK-1: DB миграция — add `check_format` to `homework_tutor_tasks`~~ ✅

**Job**: R4-1
**Agent**: Claude Code
**Files**: `supabase/migrations/` (новый файл)
**AC**: AC-5

**Что делаем:**
Добавить колонку `check_format text NOT NULL DEFAULT 'short_answer'` в таблицу `homework_tutor_tasks` с CHECK constraint `IN ('short_answer', 'detailed_solution')`.

---

### ~~TASK-2: Frontend types — add `check_format` to `DraftTask`, `CreateAssignmentTask`, `UpdateAssignmentTask`~~ ✅

**Job**: R4-1
**Agent**: Claude Code
**Files**: `src/components/tutor/homework-create/types.ts`, `src/lib/tutorHomeworkApi.ts`
**AC**: AC-4

**Что делаем:**
1. В `DraftTask` добавить `check_format: 'short_answer' | 'detailed_solution'`
2. В `CreateAssignmentTask` добавить optional `check_format?: 'short_answer' | 'detailed_solution'`
3. В `UpdateAssignmentTask` добавить optional `check_format?: 'short_answer' | 'detailed_solution'`

---

### ~~TASK-3: Fix `kbTaskToDraftTask()` — прокидывать `primary_score → max_score`, `answer_format → check_format`~~ ✅

**Job**: R4-1
**Agent**: Claude Code
**Files**: `src/components/tutor/homework-create/HWTasksSection.tsx`
**AC**: AC-1, AC-4

**Что делаем:**
1. Заменить `max_score: 1` на `max_score: task.primary_score ?? 1`
2. Добавить `check_format: task.answer_format ?? inferCheckFormat(task.kim_number)`
3. Создать helper `inferCheckFormat(kimNumber: number | null)`: `kim_number` 21-26 → `'detailed_solution'`, остальное → `'short_answer'`
4. Default для ручных задач: `check_format: 'short_answer'`

---

### ~~TASK-4: Backend — accept and store `check_format` in homework-api~~ ✅

**Job**: R4-1
**Agent**: Claude Code
**Files**: `supabase/functions/homework-api/index.ts`
**AC**: AC-4, AC-5

**Что делаем:**
1. `handleCreateAssignment`: принимать `check_format` из тела задачи, валидировать `∈ ['short_answer', 'detailed_solution']`, передавать в INSERT
2. `handleUpdateAssignment`: аналогично, передавать в UPDATE
3. Default если не передан: `'short_answer'`

---

### ~~TASK-5: AI enforcement — add `checkFormat` to `evaluateStudentAnswer()`, update prompt~~ ✅

**Job**: R1-3, R1-4
**Agent**: Claude Code
**Files**: `supabase/functions/homework-api/guided_ai.ts`
**AC**: AC-2, AC-3

**Что делаем:**
1. Добавить `checkFormat?: 'short_answer' | 'detailed_solution'` в `EvaluateStudentAnswerParams` (или аналогичный интерфейс)
2. В `buildCheckPrompt()` (или где строится system prompt для проверки):
   - Если `checkFormat === 'detailed_solution'`: добавить блок в промпт: «Формат проверки: РАЗВЁРНУТОЕ РЕШЕНИЕ. Ученик ОБЯЗАН показать ход решения. Если ответ — только число/слово без хода решения, выстави score: 0 и попроси показать ход решения.»
   - Если `checkFormat === 'short_answer'` или не указан: без изменений
3. Дополнительный hint если `answer.length < 30` и `checkFormat === 'detailed_solution'`

---

### ~~TASK-6: Wire `check_format` through `handleCheckAnswer`~~ ✅

**Job**: R1-3
**Agent**: Claude Code
**Files**: `supabase/functions/homework-api/index.ts`
**AC**: AC-2, AC-3

**Что делаем:**
1. В `handleCheckAnswer`: добавить `check_format` в SELECT задачи (рядом с `max_score`)
2. Передать `checkFormat: task.check_format` в `evaluateStudentAnswer()`

---

### ~~TASK-7: Smoke test + AC verification~~ ✅

**Job**: R4-1
**Agent**: Claude Code
**Files**: —
**AC**: AC-1 — AC-5

**Что делаем:**
1. `npm run lint && npm run build && npm run smoke-check`
2. Проверить что все типы корректны и нет TS ошибок
3. Проверить что `kbTaskToDraftTask()` для задачи с `primary_score: 3` возвращает `max_score: 3`
4. Проверить что default `check_format` = `'short_answer'`

---

## Phase 2 — P1 (fast follow-up)

### TASK-8: DB миграция — add `check_format` to `kb_tasks` + extend KBTask type

**Job**: R4-1
**Agent**: Claude Code
**Files**: `supabase/migrations/` (новый файл), `src/types/kb.ts`
**AC**: —
**Зависимости**: TASK-11 (seed) зависит от этой миграции

**Что делаем:**
1. SQL-миграция: `ALTER TABLE kb_tasks ADD COLUMN check_format text DEFAULT NULL` с CHECK constraint `IN ('short_answer', 'detailed_solution')`
2. Добавить `check_format: string | null` в интерфейс `KBTask` в `src/types/kb.ts` (сейчас поля нет — есть только `answer_format`)

---

### TASK-9: UI — check_format selector в `HWTaskCard.tsx`

**Job**: R4-1
**Agent**: Claude Code
**Files**: `src/components/tutor/homework-create/HWTaskCard.tsx`
**AC**: AC-1

**Что делаем:**
1. Добавить dropdown/select «Формат проверки» после поля «Макс. баллов» в двухколоночном grid (строки ~293-318)
2. Значения: `short_answer` → «Краткий ответ», `detailed_solution` → «Развёрнутое решение»
3. При изменении — вызвать `onUpdate({ ...task, check_format: value })`
4. Если задача из KB (`kb_task_id` есть) — значение предзаполнено, но editable
5. Tooltip: «Краткий ответ — число/слово. Развёрнутое решение — ученик покажет ход решения»

**Текущая структура HWTaskCard (для ориентира):**
- Header: номер задачи + кнопки
- Textarea: текст задачи
- Image upload
- Grid 2 cols: «Правильный ответ» (left) + «Макс. баллов» (right)
- Rubric section (collapsible)

---

### TASK-10: UI — max_score display из KB

**Job**: R4-1
**Agent**: Claude Code
**Files**: `src/components/tutor/homework-create/HWTaskCard.tsx`
**AC**: AC-1

**Что делаем:**
Поле `max_score` уже есть в HWTaskCard (number input, строки ~308-318). Задача — visual hint что значение пришло из KB:
1. Если `task.kb_task_id` существует и `max_score > 1` — показать subtle label «из КБ» рядом с полем
2. Поле остаётся editable (репетитор может переопределить)

**Примечание**: основная работа (прокидывание `primary_score → max_score`) уже сделана в TASK-3. Этот таск — только UI polish.

---

### TASK-11: Seed script — заполнить `check_format` в KB задачах по `kim_number`

**Job**: R4-1
**Agent**: Claude Code
**Files**: `supabase/migrations/` (новый файл)
**AC**: —
**Зависимости**: после TASK-8 (колонка должна существовать)

**Что делаем:**
Data migration — заполнить `check_format` для существующих KB-задач:
```sql
UPDATE kb_tasks
SET check_format = CASE
  WHEN kim_number >= 21 AND kim_number <= 26 THEN 'detailed_solution'
  ELSE 'short_answer'
END
WHERE kim_number IS NOT NULL AND check_format IS NULL;
```

### TASK-12: Smoke test + QA Phase 2

**Job**: R4-1
**Agent**: Claude Code
**Files**: —
**AC**: AC-1

**Что делаем:**
1. `npm run lint && npm run build && npm run smoke-check`
2. Проверить что KBTask тип содержит `check_format`
3. Проверить что HWTaskCard рендерит selector формата проверки
4. Проверить что при добавлении задачи из KB с `kim_number: 25` → check_format = `detailed_solution` и max_score = 3

---

## Copy-paste промпты для агентов

### TASK-1

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: SokratAI — платформа для репетиторов физики ЕГЭ/ОГЭ. Wedge: быстрая сборка ДЗ. AI = draft + action.

Прочитай перед работой:
1. docs/delivery/features/check-format/spec.md (Section 5: Technical Design → Миграции)
2. CLAUDE.md
3. .claude/rules/40-homework-system.md

Задача: создать SQL-миграцию для добавления колонки check_format в homework_tutor_tasks.

Шаги:
1. Создать файл миграции в supabase/migrations/ с timestamp-именем
2. SQL:
   ALTER TABLE homework_tutor_tasks
     ADD COLUMN check_format text NOT NULL DEFAULT 'short_answer';
   ALTER TABLE homework_tutor_tasks
     ADD CONSTRAINT homework_tutor_tasks_check_format_check
     CHECK (check_format IN ('short_answer', 'detailed_solution'));

Acceptance Criteria:
- AC-5: колонка check_format существует в homework_tutor_tasks
- constraint IN ('short_answer', 'detailed_solution')
- npm run build && npm run smoke-check проходят

Guardrails:
- НЕ трогать другие таблицы
- НЕ менять существующие колонки
- Safari/cross-browser не релевантно (backend)

По завершении:
- Список изменённых файлов
- Краткое summary
- npm run lint && npm run build && npm run smoke-check
```

### TASK-2 + TASK-3 (объединённый промпт — зависимые изменения)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: SokratAI — платформа для репетиторов физики ЕГЭ/ОГЭ. Wedge: быстрая сборка ДЗ. AI = draft + action. Сейчас kbTaskToDraftTask() хардкодит max_score: 1 — это баг. Нужно прокидывать primary_score из KB и добавить новое поле check_format.

Прочитай перед работой:
1. docs/delivery/features/check-format/spec.md (полностью)
2. CLAUDE.md
3. .claude/rules/40-homework-system.md
4. .claude/rules/50-kb-module.md
5. src/components/tutor/homework-create/types.ts
6. src/components/tutor/homework-create/HWTasksSection.tsx (функция kbTaskToDraftTask)
7. src/lib/tutorHomeworkApi.ts (типы CreateAssignmentTask, UpdateAssignmentTask)
8. src/types/kb.ts (KBTask — поля primary_score, answer_format, kim_number)

Задача: добавить check_format в frontend types и исправить конвертер kbTaskToDraftTask.

Шаги:
1. В src/components/tutor/homework-create/types.ts:
   - Добавить в DraftTask: check_format: 'short_answer' | 'detailed_solution'
   - Default значение при создании ручной задачи: 'short_answer'

2. В src/lib/tutorHomeworkApi.ts:
   - Добавить optional check_format?: 'short_answer' | 'detailed_solution' в CreateAssignmentTask
   - Добавить optional check_format?: 'short_answer' | 'detailed_solution' в UpdateAssignmentTask

3. В src/components/tutor/homework-create/HWTasksSection.tsx:
   - Создать helper функцию inferCheckFormat(kimNumber: number | null):
     if (kimNumber && kimNumber >= 21 && kimNumber <= 26) return 'detailed_solution';
     return 'short_answer';
   - В kbTaskToDraftTask() заменить:
     max_score: 1  →  max_score: task.primary_score ?? 1
   - Добавить:
     check_format: task.answer_format ?? inferCheckFormat(task.kim_number)

4. Проверить все места где создаётся DraftTask вручную (не из KB) — добавить check_format: 'short_answer' как default.

Acceptance Criteria:
- AC-1: задача КИМ №25 (primary_score: 3, answer_format: 'detailed_solution') из KB → draft: max_score === 3, check_format === 'detailed_solution'
- AC-4: ручная задача → check_format === 'short_answer', max_score === 1
- TypeScript компилируется без ошибок

Guardrails:
- НЕ трогать kb.ts (KBTask тип) — только читаем из него
- НЕ добавлять framer-motion
- НЕ менять бизнес-логику создания/обновления ДЗ
- Модуль Student НЕ трогать

По завершении:
- Список изменённых файлов
- Краткое summary
- npm run lint && npm run build && npm run smoke-check
```

### TASK-4 + TASK-5 + TASK-6 (объединённый промпт — backend)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: SokratAI — платформа для репетиторов физики ЕГЭ/ОГЭ. Добавляем поле check_format ('short_answer' | 'detailed_solution') для задач ДЗ. При check_format === 'detailed_solution' AI должен отклонять ответы без хода решения.

Прочитай перед работой:
1. docs/delivery/features/check-format/spec.md (Section 5: Technical Design)
2. CLAUDE.md
3. .claude/rules/40-homework-system.md
4. supabase/functions/homework-api/index.ts (handleCreateAssignment, handleUpdateAssignment, handleCheckAnswer)
5. supabase/functions/homework-api/guided_ai.ts (evaluateStudentAnswer, buildCheckPrompt или аналог)

Задача: backend — принимать/сохранять check_format + AI enforcement в guided chat.

Шаги:

ЧАСТЬ A — CRUD (TASK-4):
1. В handleCreateAssignment:
   - Принимать check_format из task body
   - Валидация: check_format ∈ ['short_answer', 'detailed_solution'] (если передан)
   - Default: 'short_answer'
   - Передавать в INSERT в homework_tutor_tasks
2. В handleUpdateAssignment:
   - Аналогично — принимать и обновлять check_format

ЧАСТЬ B — AI enforcement (TASK-5):
1. В guided_ai.ts, в интерфейс параметров evaluateStudentAnswer:
   - Добавить checkFormat?: 'short_answer' | 'detailed_solution'
2. В buildCheckPrompt (или где строится system prompt для проверки ответа):
   - Если checkFormat === 'detailed_solution', добавить в промпт:
     «Формат проверки: РАЗВЁРНУТОЕ РЕШЕНИЕ.
     Ученик ОБЯЗАН показать ход решения (шаги, формулы, рассуждения).
     Если ответ содержит только число/слово без хода решения — выстави score: 0
     и в feedback попроси ученика показать ход решения.
     Не принимай ответ без объяснения шагов.»
   - Дополнительно: если answer.length < 30 и checkFormat === 'detailed_solution',
     добавить hint: «Ответ ученика очень короткий для развёрнутого решения.»
   - Если checkFormat === 'short_answer' или undefined — без изменений

ЧАСТЬ C — Wiring (TASK-6):
1. В handleCheckAnswer:
   - Добавить check_format в SELECT задачи (рядом с max_score, correct_answer и т.д.)
   - Передать checkFormat: task.check_format в evaluateStudentAnswer()

Acceptance Criteria:
- AC-2: задача с check_format: 'detailed_solution' → ученик отправляет '42' → AI отвечает с просьбой показать ход решения, score === 0
- AC-3: задача с check_format: 'short_answer' → ученик отправляет '42' → AI проверяет как обычно
- AC-4: create assignment без check_format → default 'short_answer' в БД

Guardrails:
- НЕ менять логику hint / question / bootstrap paths — только answer (check)
- НЕ трогать auth / JWT логику
- НЕ менять handleNotifyStudents, handleTutorPostMessage
- Изображения: НЕ менять текущую логику storage:// → signed URL → base64
- edge function: НЕ добавлять новые npm зависимости

По завершении:
- Список изменённых файлов
- Краткое summary
- npm run lint && npm run build && npm run smoke-check
```

### TASK-7

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Прочитай перед работой:
1. docs/delivery/features/check-format/spec.md (Section 7: Acceptance Criteria)
2. CLAUDE.md

Задача: финальная валидация Phase 1 check-format фичи.

Шаги:
1. npm run lint
2. npm run build
3. npm run smoke-check
4. Проверить TypeScript: нет ошибок компиляции
5. Проверить что kbTaskToDraftTask() для задачи с primary_score: 3, kim_number: 25 вернёт max_score: 3, check_format: 'detailed_solution'
6. Проверить что kbTaskToDraftTask() для задачи с primary_score: null, kim_number: 5 вернёт max_score: 1, check_format: 'short_answer'
7. Проверить что DraftTask тип содержит check_format
8. Проверить что CreateAssignmentTask и UpdateAssignmentTask содержат optional check_format
9. Проверить что handleCheckAnswer SELECT включает check_format
10. Проверить что evaluateStudentAnswer принимает checkFormat

Acceptance Criteria:
- AC-1 через AC-5: все PASS
- Нет lint warnings, build errors, smoke failures

По завершении:
- Список проверенных AC с результатом PASS/FAIL
- Любые найденные проблемы
```

---

## Phase 2 — Copy-paste промпты для агентов

### TASK-8 + TASK-11 (объединённый промпт — миграция KB + seed)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: SokratAI — платформа для репетиторов физики ЕГЭ/ОГЭ. Wedge: быстрая сборка ДЗ. AI = draft + action. Мы добавляем поле check_format в систему. Phase 1 уже добавила check_format в homework_tutor_tasks. Сейчас Phase 2: добавляем check_format в kb_tasks (каталог задач) и заполняем для существующих задач.

Прочитай перед работой:
1. docs/delivery/features/check-format/spec.md (Section 5: Technical Design → Миграции, Migration 2)
2. CLAUDE.md
3. .claude/rules/50-kb-module.md
4. src/types/kb.ts (интерфейс KBTask — сейчас НЕ содержит check_format)

Задача: добавить check_format в kb_tasks (DB + тип) и заполнить для существующих задач по kim_number.

Шаги:

ЧАСТЬ A — Миграция (TASK-8):
1. Создать файл миграции в supabase/migrations/ с timestamp-именем (формат: YYYYMMDDHHMMSS_описание.sql)
2. SQL:
   ALTER TABLE kb_tasks
     ADD COLUMN check_format text DEFAULT NULL;
   ALTER TABLE kb_tasks
     ADD CONSTRAINT kb_tasks_check_format_check
     CHECK (check_format IS NULL OR check_format IN ('short_answer', 'detailed_solution'));

ЧАСТЬ B — Тип KBTask (TASK-8):
3. В src/types/kb.ts найти интерфейс KBTask (строки ~71-109)
4. Добавить поле: check_format: string | null;
5. Разместить рядом с полем answer_format (строка ~83) — логическая группировка

ЧАСТЬ C — Seed (TASK-11):
6. Создать ОТДЕЛЬНЫЙ файл миграции (timestamp позже чем ЧАСТЬ A!)
7. SQL:
   UPDATE kb_tasks
   SET check_format = CASE
     WHEN kim_number >= 21 AND kim_number <= 26 THEN 'detailed_solution'
     ELSE 'short_answer'
   END
   WHERE kim_number IS NOT NULL AND check_format IS NULL;

Acceptance Criteria:
- kb_tasks таблица имеет nullable колонку check_format
- constraint: NULL или IN ('short_answer', 'detailed_solution')
- KBTask тип в TypeScript содержит check_format: string | null
- Все задачи с kim_number 21-26 получают 'detailed_solution', остальные 'short_answer'
- npm run build && npm run smoke-check проходят

Guardrails:
- НЕ трогать homework_tutor_tasks (уже сделано в Phase 1)
- НЕ менять модерационные триггеры (trg_kb_before_update_block_dup, trg_kb_after_update_moderation, trg_kb_after_insert_moderation)
- НЕ менять fingerprint логику
- НЕ менять Source→Copy model
- Seed = UPDATE ONLY, не INSERT и не DELETE

По завершении:
- Список изменённых файлов
- Краткое summary
- npm run lint && npm run build && npm run smoke-check
```

### TASK-9 + TASK-10 (объединённый промпт — UI конструктора ДЗ)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: SokratAI — платформа для репетиторов физики ЕГЭ/ОГЭ. Wedge: быстрая сборка ДЗ. AI = draft + action. В Phase 1 мы добавили check_format в DraftTask и homework_tutor_tasks. Сейчас Phase 2: добавляем UI для check_format в конструктор ДЗ.

Прочитай перед работой:
1. docs/delivery/features/check-format/spec.md (Section 6: UX / UI)
2. CLAUDE.md
3. .claude/rules/80-cross-browser.md (Safari rules!)
4. .claude/rules/performance.md (НЕ framer-motion в shared компонентах)
5. src/components/tutor/homework-create/HWTaskCard.tsx (текущая структура карточки)
6. src/components/tutor/homework-create/types.ts (DraftTask — уже содержит check_format)

Задача: добавить selector формата проверки и visual hint для max_score на карточке задачи.

Шаги:

ЧАСТЬ A — check_format selector (TASK-9):
1. В HWTaskCard.tsx найти двухколоночный grid (строки ~293-318): «Правильный ответ» (left) + «Макс. баллов» (right)
2. Добавить НИЖЕ этого grid новую строку с <select> или кастомным dropdown:
   - Label: «Формат проверки»
   - Опции: «Краткий ответ» (value: 'short_answer') и «Развёрнутое решение» (value: 'detailed_solution')
   - onChange: onUpdate({ ...task, check_format: e.target.value })
   - Текущее значение: task.check_format
3. Добавить tooltip/hint text под selector (мелкий серый текст):
   - short_answer: «Число, слово или формула»
   - detailed_solution: «AI потребует ход решения от ученика»
4. CSS: select с full width, стилизация как у существующих input-ов в карточке
   - font-size: 16px МИНИМУМ (Safari iOS auto-zoom!)
   - touch-action: manipulation на select

ЧАСТЬ B — max_score KB hint (TASK-10):
5. Рядом с полем «Макс. баллов» (number input):
   - Если task.kb_task_id существует (задача из KB) и task.max_score > 1:
     показать маленький badge «из КБ» (text-xs text-muted-foreground)
   - Поле остаётся editable
6. Это ТОЛЬКО visual hint, не функциональное изменение

Acceptance Criteria:
- AC-1: задача КИМ №25 из KB → карточка показывает check_format = «Развёрнутое решение» и max_score = 3 с badge «из КБ»
- Ручная задача → check_format selector = «Краткий ответ» (default)
- Selector editable для всех задач (и из KB, и ручных)
- npm run build проходит
- На iOS Safari нет auto-zoom при tap на select (font-size >= 16px)

Guardrails:
- НЕ добавлять framer-motion (HWTaskCard — shared component)
- НЕ менять структуру props HWTaskCardProps (check_format уже в DraftTask)
- НЕ менять логику onUpdate / onRemove
- НЕ трогать image upload секцию
- НЕ использовать :has() CSS selector (Safari < 15.4)
- НЕ использовать Array.at(), structuredClone() (Safari compat)
- Select элемент: font-size >= 16px (iOS auto-zoom prevention)

По завершении:
- Список изменённых файлов
- Краткое summary
- npm run lint && npm run build && npm run smoke-check
- Скриншот описания: как выглядит карточка с новым selector
```

### TASK-12

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Прочитай перед работой:
1. docs/delivery/features/check-format/spec.md (Section 7: Acceptance Criteria)
2. CLAUDE.md

Задача: финальная валидация Phase 2 check-format фичи.

Шаги:
1. npm run lint
2. npm run build
3. npm run smoke-check
4. Проверить TypeScript: нет ошибок компиляции
5. Проверить что KBTask тип в src/types/kb.ts содержит check_format: string | null
6. Проверить что kb_tasks таблица имеет колонку check_format (grep в миграциях)
7. Проверить что HWTaskCard.tsx рендерит select/dropdown для check_format
8. Проверить что select имеет font-size >= 16px (Safari auto-zoom)
9. Проверить что kbTaskToDraftTask() для задачи с kim_number: 25, primary_score: 3 →
   DraftTask: check_format === 'detailed_solution', max_score === 3
10. Проверить что kbTaskToDraftTask() для задачи с kim_number: 5, primary_score: 1 →
    DraftTask: check_format === 'short_answer', max_score === 1
11. Проверить что seed-миграция обновляет kb_tasks.check_format по kim_number

Acceptance Criteria:
- AC-1: PASS (end-to-end KB → draft → ДЗ с корректными check_format и max_score)
- Нет lint warnings, build errors, smoke failures
- Нет Safari-несовместимых паттернов в новом коде

По завершении:
- Список проверенных AC с результатом PASS/FAIL
- Любые найденные проблемы
```
