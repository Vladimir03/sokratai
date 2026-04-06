# Feature Spec: Формат проверки из KB + развернутое решение

**Версия:** v0.2
**Дата:** 2026-04-01
**Автор:** Vladimir
**Статус:** phase2-in-progress (`kb_tasks.check_format` DB + seed done 2026-04-06; remaining follow-up = final QA)
**PRD:** `docs/delivery/features/check-format/prd.md`

---

## 0. Job Context

| Участник | Core Job | Sub-job | Ссылка на Граф |
|---|---|---|---|
| Репетитор (B2B) | R4: Сохранение контроля и качества при масштабировании | R4-1: Быстро собрать качественное ДЗ по теме урока | job-graph.md#R4 |
| Репетитор (B2B) | R1: Автоматическая проверка ДЗ | R1-3: Классификация ошибок, R1-4: Персональная обратная связь | job-graph.md#R1 |

### Wedge-связка

- **B2B-сегмент:** репетиторы физики ЕГЭ/ОГЭ с 10+ учениками
- **Wedge alignment:** Да — убирает 2 ручных шага при сборке ДЗ из KB (настройка баллов + формата)

### Pilot impact

Егор прямо запросил оба изменения. Без `check_format` ученики второй части ЕГЭ присылают голые ответы, AI не может классифицировать ошибки. Женя (2-й пилотный репетитор) подтвердил потребность через КИМ-структуру физики.

---

## 1. Summary

При добавлении задачи из KB в ДЗ — автоматически подгружать `max_score` (из `primary_score`) и `check_format` (из `answer_format`). В guided chat — enforcement: если `check_format === 'detailed_solution'` и ученик прислал только короткий ответ, AI отклоняет и просит показать ход решения.

Две связанные проблемы решаются вместе: E1 (баллы из KB) и E4 (формат «развернутое решение»), потому что обе правят один конвертер `kbTaskToDraftTask` и один AI-промпт.

---

## 2. Problem

### Текущее поведение

`kbTaskToDraftTask()` в `HWTasksSection.tsx` хардкодит `max_score: 1` для всех задач из KB, игнорируя `primary_score` (1-4 балла по КИМ ЕГЭ). Поля `check_format` не существует нигде в системе — AI одинаково проверяет КИМ №1 (краткий ответ, 1 балл) и КИМ №25 (развёрнутое решение, 3 балла).

### Боль

Репетитор вынужден вручную настраивать баллы для каждой задачи. Ученик может написать голый ответ «42» на задачу второй части ЕГЭ, и AI его примет. Репетитор не может потребовать от ученика показать ход решения через систему.

### Текущие «нанятые» решения

Егор вручную пишет в условие задачи «покажи ход решения». Это не enforcement — AI не отклоняет ответ без решения.

---

## 3. Solution

### Описание

Добавить поле `check_format` (`'short_answer' | 'detailed_solution'`) в `homework_tutor_tasks` и `kb_tasks`. При добавлении задачи из KB — автоматически подгружать `max_score` и `check_format`. В guided chat — AI enforcement по `check_format`.

### Ключевые решения

1. **Два значения enum, не три**: `short_answer` и `detailed_solution`. Промежуточные форматы (matching, ordering) откладываются
2. **Enforcement по длине, не по содержанию**: начинаем с простого порога длины ответа, уточняем по feedback
3. **Default `short_answer`**: наименее ограничительный, не ломает текущее поведение
4. **Fallback `max_score: 1`**: если `primary_score = null` в KB — текущее поведение сохраняется

### Scope

**In scope (P0 — Must-Have):**
- R1: `check_format` колонка в `homework_tutor_tasks` (миграция)
- R2: `kbTaskToDraftTask()` прокидывает `primary_score → max_score` и `answer_format → check_format`
- R3: Backend `handleCreateAssignment` / `handleUpdateAssignment` принимают и сохраняют `check_format`
- R4: AI enforcement в guided chat: `buildCheckPrompt()` добавляет инструкцию при `detailed_solution`
- R8: Student-side: `check_format` доступен ученику (тип `StudentHomeworkTask` + student API query + notice banner + placeholder + AI bootstrap)

**In scope (P1 — Nice-to-Have):**
- R5: `check_format` колонка в `kb_tasks` + default mapping по `kim_number` (1-20 → `short_answer`, 21-26 → `detailed_solution`)
- R6: UI в конструкторе ДЗ: отображать и позволять менять `check_format` на карточке задачи
- R7: UI в конструкторе ДЗ: отображать `max_score` из KB (readonly, editable в карточке)

**Out of scope:**
- Автоматический парсинг задач с neofamily/РЕШУ ЕГЭ (это Ж1, отдельная фича)
- Подробный scoring rubric с критериями ФИПИ (слишком сложно для MVP)
- Частичные баллы (0/1/2/3 вместо pass/fail) — после валидации AI качества
- Формат проверки для математики (другая структура КИМ)

---

## 4. User Stories

### Репетитор (Егор)
> Когда я добавляю задачу КИМ №25 из каталога Сократа в ДЗ, я хочу чтобы `max_score: 3` и `check_format: развернутое решение` подгрузились автоматически, чтобы не настраивать вручную каждую задачу.

> Когда я создаю задачу вручную (не из KB), я хочу выбрать формат проверки сам, чтобы контролировать поведение AI.

### Школьник
> Когда я решаю задачу второй части ЕГЭ и пишу только «42», AI говорит мне показать ход решения, чтобы я привыкал оформлять решения как на экзамене.

---

## 5. Technical Design

### Затрагиваемые файлы

**Frontend (Tutor):**
- `src/components/tutor/homework-create/HWTasksSection.tsx` — fix `kbTaskToDraftTask()`: прокидывать `primary_score` и `answer_format`
- `src/components/tutor/homework-create/types.ts` — добавить `check_format` в `DraftTask`
- `src/components/tutor/homework-create/HWTaskCard.tsx` — UI для `check_format` selector (P1)
- `src/lib/tutorHomeworkApi.ts` — добавить `check_format` в `CreateAssignmentTask` и `UpdateAssignmentTask`

**Frontend (Student, P0 — R8):**
- `src/types/homework.ts` — добавить `check_format` в `StudentHomeworkTask`
- `src/lib/studentHomeworkApi.ts` — добавить `check_format` в SELECT query `getStudentAssignment()`
- `src/components/homework/GuidedHomeworkWorkspace.tsx` — notice banner при `detailed_solution`, передача `check_format` в bootstrap и в `GuidedChatInput`
- `src/components/homework/GuidedChatInput.tsx` — dynamic `answerPlaceholder` prop

**Backend (Edge Functions):**
- `supabase/functions/homework-api/index.ts` — `handleCreateAssignment` и `handleUpdateAssignment`: принимать и сохранять `check_format`. `handleCheckAnswer`: передавать `check_format` в AI
- `supabase/functions/homework-api/guided_ai.ts` — `buildCheckPrompt()`: enforcement инструкция при `detailed_solution`

**Database:**
- Миграция: `ALTER TABLE homework_tutor_tasks ADD COLUMN check_format text NOT NULL DEFAULT 'short_answer'`
- Миграция (P1): `ALTER TABLE kb_tasks ADD COLUMN check_format text` (nullable, default null)

### Data Model

#### homework_tutor_tasks (новая колонка)

```sql
check_format text NOT NULL DEFAULT 'short_answer'
-- CHECK (check_format IN ('short_answer', 'detailed_solution'))
```

#### kb_tasks (P1, новая колонка)

```sql
check_format text DEFAULT NULL
-- NULL = не указан, используется fallback logic:
--   kim_number 1-20 → 'short_answer'
--   kim_number 21-26 → 'detailed_solution'
--   kim_number IS NULL → 'short_answer'
```

### API

#### homework-api: handleCreateAssignment

Существующий endpoint. Изменения:
- `CreateAssignmentTask` принимает optional `check_format: 'short_answer' | 'detailed_solution'`
- При insert в `homework_tutor_tasks` — прокидывать `check_format` (default `'short_answer'`)
- Валидация: `check_format` ∈ `['short_answer', 'detailed_solution']`

#### homework-api: handleUpdateAssignment

Аналогично create. При update задач — обновлять `check_format` если передан.

#### homework-api: handleCheckAnswer

Текущий flow:
1. Загружает task: `id, order_num, task_text, task_image_url, ocr_text, correct_answer, rubric_text, max_score`
2. Вызывает `evaluateStudentAnswer()` с `maxScore`

Изменения:
1. Добавить `check_format` в SELECT задачи
2. Передать `checkFormat` в `evaluateStudentAnswer()`

### AI Prompt Changes (guided_ai.ts)

#### evaluateStudentAnswer — новый параметр

```typescript
interface EvaluateStudentAnswerParams {
  // ... существующие поля
  checkFormat?: 'short_answer' | 'detailed_solution'; // NEW
}
```

#### buildCheckPrompt — enforcement логика

Если `checkFormat === 'detailed_solution'`:

```
Формат проверки: РАЗВЁРНУТОЕ РЕШЕНИЕ.
Ученик ОБЯЗАН показать ход решения (шаги, формулы, рассуждения).
Если ответ содержит только число/слово без хода решения —
выстави verdict: INCORRECT и в feedback попроси ученика показать ход решения.
Не принимай ответ без объяснения шагов.
```

Если `checkFormat === 'short_answer'` или не указан — текущее поведение без изменений.

**Порог «слишком короткий»**: enforcement через промпт, не через код. AI сам определяет, есть ли «ход решения». Но для надёжности: если `answer.length < 30` и `checkFormat === 'detailed_solution'` — добавить hint в промпт: «Ответ очень короткий для развёрнутого решения».

### kbTaskToDraftTask — fix конвертера

Текущий код (баг):
```typescript
max_score: 1, // hardcoded!
```

Исправление:
```typescript
max_score: task.primary_score ?? 1,
check_format: task.answer_format ?? task.check_format ?? inferCheckFormat(task.kim_number),
```

Где `inferCheckFormat`:
```typescript
function inferCheckFormat(kimNumber: number | null): 'short_answer' | 'detailed_solution' {
  if (kimNumber && kimNumber >= 21 && kimNumber <= 26) return 'detailed_solution';
  return 'short_answer';
}
```

### Миграции

**Migration 1 (P0):** `homework_tutor_tasks` — add `check_format`
```sql
ALTER TABLE homework_tutor_tasks
  ADD COLUMN check_format text NOT NULL DEFAULT 'short_answer';

-- Constraint
ALTER TABLE homework_tutor_tasks
  ADD CONSTRAINT homework_tutor_tasks_check_format_check
  CHECK (check_format IN ('short_answer', 'detailed_solution'));
```

**Migration 2 (P1):** `kb_tasks` — add `check_format` (nullable)
```sql
ALTER TABLE kb_tasks
  ADD COLUMN check_format text DEFAULT NULL;

ALTER TABLE kb_tasks
  ADD CONSTRAINT kb_tasks_check_format_check
  CHECK (check_format IS NULL OR check_format IN ('short_answer', 'detailed_solution'));
```

Реализовано в `main`:
- `supabase/migrations/20260401140000_add_check_format_to_kb_tasks.sql`
- `supabase/migrations/20260401140100_seed_check_format_kb_tasks.sql`

---

## 6. UX / UI

### Конструктор ДЗ — карточка задачи (P1)

В `HWTaskCard.tsx` добавить selector формата проверки:
- Dropdown/toggle: «Краткий ответ» / «Развёрнутое решение»
- Tooltip: «Краткий ответ — число/слово. Развёрнутое решение — ученик покажет ход решения»
- Если задача из KB — значение предзаполнено, но editable
- Если задача вручную — default `short_answer`

### Guided chat — student-facing UX для `detailed_solution` (P0, R8)

**Проблема**: ученик не знает что для этой задачи нужно решение, пока не получит 0 баллов. Это frustrating.

**Решение**: 3 точки, где ученик узнаёт про требование ДО отправки ответа:

**1. Notice banner** (под условием задачи в `GuidedHomeworkWorkspace`):
- Показывается если `currentTask.check_format === 'detailed_solution'`
- Текст: «Задача с развёрнутым решением — покажи ход решения, как на ЕГЭ. Без хода решения получишь 0 баллов.»
- Стиль: `bg-amber-50 border-l-4 border-amber-400 text-amber-800 text-sm p-3`
- Размещение: после task_text/image, перед chat messages
- Внутри collapsible-блока условия (видна при раскрытом условии)

**2. Placeholder в поле «Ответ»** (GuidedChatInput → AnswerField):
- Если `check_format === 'detailed_solution'`: placeholder = `«Напиши решение с ходом рассуждений...»`
- Если `check_format === 'short_answer'` или не указан: placeholder = `«Ответ...»` (текущий)
- Передаётся через новый prop `answerPlaceholder` из GuidedHomeworkWorkspace

**3. AI bootstrap message** (intro при первом открытии задачи):
- В `buildGuidedSystemPrompt('bootstrap')`: если `check_format === 'detailed_solution'`, добавить context: «Эта задача требует развёрнутого решения. Упомяни в intro что ученик должен показать ход решения, иначе получит 0 баллов. Мотивируй это подготовкой к ЕГЭ.»
- AI сам формулирует intro — не хардкодим текст, но задаём requirement

**Технический pre-req**: ~~`check_format` сейчас **НЕ доступен** на student side~~ ✅ Реализовано 2026-04-02:
- `StudentHomeworkTask.check_format: 'short_answer' | 'detailed_solution'` (строго типизирован)
- `getStudentAssignment()` включает `check_format` в SELECT
- Banner, placeholder, bootstrap — реализованы

### Guided chat — enforcement UX (после отправки)

Когда AI отклоняет короткий ответ на `detailed_solution` задачу:
- AI-сообщение в чате: «Для этой задачи нужно показать ход решения. Напиши шаги, которые привели к ответу»
- Verdict выставляется `INCORRECT` — ученик может повторить попытку с развёрнутым ответом
- AI спрашивает, а не блокирует (soft enforcement)

### UX-принципы (из doc 16)

- **Jobs-first**: убирает ручной шаг при сборке ДЗ (R4-1)
- **AI ведёт к действию**: enforcement формата — AI не просто проверяет, а направляет ученика
- **Не chat-first**: конструктор ДЗ остаётся workflow-driven, не chat

### UI-паттерны (из doc 17)

- **Один primary CTA**: формат проверки — secondary control на карточке задачи
- **Action layer на AI-результат**: AI-feedback включает конкретную просьбу показать решение
- **Badge статуса**: check_format можно показать badge на карточке задачи (optional)

---

## 7. Acceptance Criteria (testable)

- **AC-1**: Добавить задачу КИМ №25 (`primary_score: 3`, `answer_format: 'detailed_solution'`) из KB в ДЗ → в draft-задаче `max_score === 3` и `check_format === 'detailed_solution'` (не `1` и не `undefined`). PASS/FAIL.

- **AC-2**: Создать ДЗ с задачей `check_format: 'detailed_solution'` → ученик в guided chat отправляет ответ «42» → AI-ответ содержит просьбу показать ход решения и `verdict === 'INCORRECT'`. PASS/FAIL.

- **AC-3**: Создать ДЗ с задачей `check_format: 'short_answer'` → ученик отправляет ответ «42» → AI проверяет ответ как обычно (не просит ход решения). PASS/FAIL.

- **AC-4**: Создать задачу вручную (не из KB) → `check_format` по умолчанию `'short_answer'`, `max_score` по умолчанию `1`. PASS/FAIL.

- **AC-5**: В `homework_tutor_tasks` таблице новая колонка `check_format` с constraint `IN ('short_answer', 'detailed_solution')`. `npm run build` и `npm run smoke-check` проходят. PASS/FAIL.

- **AC-6**: Ученик открывает задачу с `check_format: 'detailed_solution'` в guided chat → видит notice banner «Задача с развёрнутым решением» + placeholder «Напиши решение с ходом рассуждений...» в поле ответа. Для задачи с `short_answer` — banner НЕ показан, placeholder = «Ответ...». PASS/FAIL.

---

## 8. Validation

### Как проверяем успех

- **Adoption** (3-7 дней): Егор создаёт ≥1 ДЗ с задачами из KB, где `max_score` и `check_format` подгрузились автоматически
- **AI accuracy** (3-7 дней): AI корректно отклоняет короткие ответы на задачи с `detailed_solution` в ≥80% случаев (проверить на 10+ реальных задачах КИМ 21-26)
- **False rejection** (3-7 дней): AI не отклоняет ложно ответы с ходом решения (false rejection < 10%)
- **Qualitative** (2-4 недели): Егор подтверждает, что ученики стали присылать решения
- **Retention** (2-4 недели): Егор продолжает использовать KB → ДЗ flow

### Связь с pilot KPI

Фича напрямую усиливает KPI «время сборки ДЗ» (убирает ручную настройку) и «качество AI-проверки» (enforcement формата).

### Smoke check

```bash
npm run lint && npm run build && npm run smoke-check
```

---

## 8. Risks

| Риск | Вероятность | Митигация |
|---|---|---|
| AI слишком строго отклоняет ответы (false rejection) | Средняя | Soft enforcement через промпт (AI спрашивает, не блокирует). Репетитор может сменить формат на `short_answer` |
| Ученик пишет длинный неправильный ответ и AI его принимает как «развёрнутый» | Средняя | AI проверяет и содержание и формат — не только длину |
| `primary_score = null` в KB задачах | Высокая | Fallback `max_score: 1`. Заполнится при seed новых задач с `kim_number` |
| Промпт для enforcement не работает стабильно | Средняя | Тест на 10+ задачах КИМ 21-26 перед release. Итерация промпта по feedback |

---

## 9. Implementation Tasks

> Переносятся в `check-format-tasks.md` после approve спека.

### Phase 1 — P0 (деплоим первым)

- [x] TASK-1: DB миграция — add `check_format` to `homework_tutor_tasks`
- [x] TASK-2: Backend types — add `check_format` to create/update task types in `homework-api/index.ts`
- [x] TASK-3: Fix `kbTaskToDraftTask()` — прокидывать `primary_score → max_score`, `answer_format → check_format`
- [x] TASK-4: Frontend types — add `check_format` to `DraftTask`, `CreateAssignmentTask`, `UpdateAssignmentTask`
- [x] TASK-5: AI enforcement — add `checkFormat` param to `evaluateStudentAnswer()`, update `buildCheckPrompt()` in `guided_ai.ts`
- [x] TASK-6: Wire `check_format` through `handleCheckAnswer` in `index.ts`
- [x] TASK-7a: Student-side: `check_format` в `StudentHomeworkTask` + student API query + notice banner + placeholder + bootstrap context
- [ ] TASK-7b: Smoke test + AC verification (AC-1 — AC-6)

### Phase 2 — P1 (fast follow-up)

- [x] TASK-8: DB миграция — add `check_format` to `kb_tasks`
- [x] TASK-9: UI — check_format selector в `HWTaskCard.tsx`
- [x] TASK-10: UI — max_score display/edit в `HWTaskCard.tsx`
- [x] TASK-11: Seed script — заполнить `check_format` в KB задачах по `kim_number`

---

## Parking Lot

- **Подробные rubrics по типу задачи ЕГЭ** — контекст: Егор (Е6) хочет AI промпты по школьному курсу физики. Revisit: после валидации базового enforcement
- **Частичные баллы (0/1/2/3)** — контекст: КИМ ЕГЭ имеет градацию баллов для второй части. Revisit: после накопления данных по AI-оценкам
- **Формат проверки для математики** — контекст: другая структура КИМ, другие типы задач. Revisit: при подключении репетиторов математики
- **Auto-inference `check_format` по тексту задачи** — контекст: не все задачи имеют `kim_number`. Revisit: когда будет достаточно данных для ML-классификатора

---

## Checklist перед approve

- [x] Job Context заполнен (секция 0)
- [x] Привязка к Core Job из Графа работ: R4-1 + R1-3/R1-4
- [x] Scope чётко определён (in/out + P0/P1)
- [x] UX-принципы из doc 16 учтены
- [x] UI-паттерны из doc 17 учтены
- [x] Pilot impact описан
- [x] Метрики успеха определены (leading + lagging)
- [x] Acceptance Criteria testable (5 штук, PASS/FAIL)
- [x] High-risk файлы не затрагиваются
- [x] Student/Tutor изоляция не нарушена
- [x] Parking Lot заполнен
- [x] Requirements приоритизированы (4× P0, 3�
