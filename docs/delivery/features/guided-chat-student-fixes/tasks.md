# Tasks: Guided Chat — Student-side fixes

**Spec:** `docs/delivery/features/guided-chat-student-fixes/spec.md`
**PRD:** `docs/delivery/features/guided-chat-student-fixes/prd.md`
**Job:** S1-1, S1-2, R1-3, R1-4

---

## TASK-1 (P0): Fix `performTaskAdvance` — корректное завершение треда

**Job:** S1-1, R1-4
**Agent:** Claude Code
**Files:**
- `supabase/functions/homework-api/index.ts` — функция `performTaskAdvance`
**AC:** AC-1, AC-2, AC-3

**Описание:**
`performTaskAdvance` неверно определяет «следующую» задачу как `sortedOrders[currentIdx + 1]` (следующую по индексу). Если студент решает последнюю задачу **по номеру**, а предыдущие ещё активны — `nextOrder = null`, тред ошибочно переводится в `completed`.

**Алгоритм исправления:**
После пометки текущей задачи как `completed` — найти первую незавершённую активную задачу среди оставшихся. Тред завершается **только** когда все task_states = `completed`.

```typescript
// Псевдокод нового алгоритма:
const remainingActiveOrders = sortedOrders.filter(
  (order) => order !== currentOrder && stateByOrder.get(order)?.status === 'active'
);

if (remainingActiveOrders.length > 0) {
  const nextOrder = remainingActiveOrders[0]; // sortedOrders уже sorted
  // update thread.current_task_order = nextOrder
  // insert system message
  return { nextOrder, threadCompleted: false };
} else {
  // ВСЕ задачи завершены
  // update thread.status = 'completed'
  // insert system message "Все задачи выполнены!"
  return { nextOrder: null, threadCompleted: true };
}
```

**Важно:** `stateByOrder` — snapshot до update. Текущая задача ещё числится `active` в map → фильтр `order !== currentOrder` обязателен.

**Guardrails:**
- Изменения строго внутри `performTaskAdvance`. НЕ трогать `handleRequestHint`, `provisionGuidedThread`, `handleCheckAnswer` (кроме вызова `performTaskAdvance`).
- НЕ менять контракт возвращаемого типа `AdvanceResult` (`{ nextOrder, threadCompleted }`).
- НЕ трогать RLS, миграции, типы frontend.
- Не затрагивать student-side код.

---

## TASK-2 (P1): Миграция `exam_type` + backend handlers

**Job:** R1-4, S1-2
**Agent:** Claude Code
**Files:**
- `supabase/migrations/20260406_add_exam_type_to_assignments.sql` (новый файл)
- `supabase/functions/homework-api/index.ts` — `handleCreateAssignment`, `handleUpdateAssignment`, `handleGetStudentAssignment`
**AC:** AC-4, AC-5, AC-6

**Описание:**
Добавить колонку `exam_type` в `homework_tutor_assignments`, принять её в create/update handlers, вернуть в student-assignment response.

**Шаги:**

1. **Миграция** (`supabase/migrations/20260406_add_exam_type_to_assignments.sql`):
```sql
ALTER TABLE homework_tutor_assignments
  ADD COLUMN IF NOT EXISTS exam_type VARCHAR NOT NULL DEFAULT 'ege'
  CONSTRAINT homework_tutor_assignments_exam_type_check
  CHECK (exam_type IN ('ege', 'oge'));
```

2. **`handleCreateAssignment`:** принять из body `exam_type?: 'ege' | 'oge'`, передать в INSERT (default `'ege'` если не указан).

3. **`handleUpdateAssignment`:** принять из body `exam_type?: 'ege' | 'oge'`, добавить в UPDATE payload (только если поле передано — не перетирать существующее).

4. **`handleGetStudentAssignment`:** добавить `exam_type` в SELECT из `homework_tutor_assignments`. Вернуть в response рядом с остальными полями.

**Guardrails:**
- `VALID_EXAM_TYPES = ['ege', 'oge']` — валидировать на входе как уже делается для `VALID_CHECK_FORMATS`.
- НЕ менять RLS policies.
- НЕ трогать `handleCheckAnswer`, `handleRequestHint`, guided-chat flow.
- Миграция безопасна на проде: `DEFAULT 'ege'`, ненарушает существующие строки.

---

## TASK-3 (P1): Frontend tutor — select «Тип экзамена» в L0 конструктора ДЗ ✅

**Job:** R1-4
**Agent:** Claude Code
**Status:** DONE — реализован в L0 (`TutorHomeworkCreate.tsx`, рядом с «Предмет», grid `md:grid-cols-2`), а не в L1 `HWExpandedParams.tsx` как планировалось. Обоснование: репетитор должен видеть тип экзамена сразу, без раскрытия L1.
**Files:**
- `src/pages/tutor/TutorHomeworkCreate.tsx` — select + state + payload
- `src/components/tutor/homework-create/types.ts` — `MetaState.exam_type`
- `src/lib/tutorHomeworkApi.ts` — `CreateAssignmentPayload`, `UpdateAssignmentPayload`
**AC:** AC-4

**Описание:**
Добавить нативный `<select>` «Тип экзамена» (ЕГЭ / ОГЭ) в L1 «Расширенные параметры» конструктора ДЗ. Аналогично уже существующим L1-параметрам.

**Шаги:**

1. В `HWExpandedParams.tsx` добавить prop `examType: 'ege' | 'oge'` и `onExamTypeChange: (v: 'ege' | 'oge') => void`.
2. Добавить `<select>` с двумя опциями:
   - `value="ege"` → label «ЕГЭ»
   - `value="oge"` → label «ОГЭ»
3. Стиль select: `font-size: 16px; touch-action: manipulation` (iOS Safari anti-zoom — то же что для `check_format` select в `HWTaskCard.tsx`). Класс `border-slate-200 rounded-md`.
4. В `tutorHomeworkApi.ts` добавить `exam_type?: 'ege' | 'oge'` в `CreateAssignmentPayload` и `UpdateAssignmentPayload`.
5. В `TutorHomeworkCreate.tsx` прокинуть значение из state → `HWExpandedParams` и в payload при create/update.

**Guardrails:**
- Dot-indicator в L1 toggle кнопке: НЕ добавлять для `exam_type` (ЕГЭ — это норма, не "нестандартный параметр").
- Нативный `<select>`, не custom dropdown.
- `font-size: 16px` на select — обязательно (iOS Safari).
- Никаких emoji. Только Lucide icons если нужна иконка.
- Не трогать student-side.

---

## TASK-4 (P1): Frontend student — динамический `examTypeLabel` в GuidedHomeworkWorkspace

**Job:** S1-1, S1-2
**Agent:** Claude Code
**Files:**
- `src/components/homework/GuidedHomeworkWorkspace.tsx`
- `src/types/homework.ts` — `StudentAssignment`
- `src/lib/studentHomeworkApi.ts` — `getStudentAssignment`
**AC:** AC-5, AC-6

**Описание:**
Заменить хардкод «ЕГЭ» в amber-баннере и AI-промпте на динамическую метку из `assignment.exam_type`.

**Шаги:**

1. **`src/types/homework.ts`:** добавить `exam_type: 'ege' | 'oge'` в тип `StudentAssignment`.

2. **`src/lib/studentHomeworkApi.ts`:** в `getStudentAssignment` добавить `exam_type` в SELECT-запрос к `homework_tutor_assignments`.

3. **`GuidedHomeworkWorkspace.tsx`:**
   - В начале компонента вычислить:
     ```typescript
     const examTypeLabel = assignment.exam_type === 'oge' ? 'ОГЭ' : 'ЕГЭ';
     ```
   - Строка ~1415 (amber banner): заменить хардкод:
     ```
     «как на ЕГЭ» → «как на ${examTypeLabel}»
     ```
   - Строка ~177 (функция `buildTaskContext`, options для `detailed_solution`):
     Добавить `examType?: 'ege' | 'oge'` в параметр `options`, заменить:
     ```
     «Мотивируй это подготовкой к ЕГЭ» → «Мотивируй это подготовкой к ${examTypeLabel}»
     ```
     Вызов `buildTaskContext` передаёт `checkFormat` и `examType`.

**Guardrails:**
- Emoji `📝` в баннере — допустимо (user-facing motivational text, не UI chrome).
- Fallback: если `exam_type` по какой-то причине не пришёл — дефолт `'ege'` (не падаем).
- Не трогать tutor-side файлы (`GuidedThreadViewer`, `TutorHomeworkDetail`).
- Не менять логику `buildTaskContext` кроме `examType` подстановки.
- Safari/iOS: изменения строго текстовые — никакого нового CSS.

---

## TASK-5: Validation — lint / build / smoke + ручной QA

**Job:** S1-1, R1-4
**Agent:** Claude Code (validation) + Vladimir (manual QA)
**Files:** — (no code)
**AC:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7

**Шаги:**
1. `npm run lint`
2. `npm run build`
3. `npm run smoke-check`
   (НЕ параллельно с build — конфликт `dist/`)

**Manual QA Fix 1 (AC-1, AC-2, AC-3):**
- Создать тестовое ДЗ из 3 задач
- Залогиниться как ученик
- Решить задачу #3 первой (пропустить #1, #2)
- Проверить: GuidedChatInput для #1 и #2 не задизейблен (AC-1)
- Проверить в Supabase: `homework_tutor_threads.status = 'active'` (AC-1)
- Решить #1 и #2 → проверить `status = 'completed'` и итоговый экран (AC-2)
- Проверить API: `/threads/:id/check` для #1 после решения #3 → 200, не 400 (AC-3)

**Manual QA Fix 2 (AC-4, AC-5, AC-6):**
- Открыть конструктор ДЗ → L1 → убедиться в наличии select «Тип экзамена» (AC-4)
- Создать ДЗ с `exam_type = 'oge'`, задачей с `check_format = 'detailed_solution'`
- Открыть как ученик → баннер содержит «как на ОГЭ» (AC-5)
- Создать ДЗ с дефолтным `exam_type` → баннер «как на ЕГЭ» (AC-6, регрессия)

---

## Порядок выполнения

```
TASK-1 (P0, backend-only)  ← независимый, деплоить первым
    ↓
TASK-2 (P1, migration + backend)
    ↓
TASK-3 + TASK-4 (P1, frontend, параллельно)
    ↓
TASK-5 (validation)
```

**TASK-1 может быть задеплоен отдельным PR до Fix 2** — критический баг, не ждать P1-изменений.

---

## Copy-paste промпты для агентов

### Prompt — TASK-1 (Fix performTaskAdvance)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст:
- SokratAI — AI-платформа для репетиторов физики ЕГЭ/ОГЭ (B2B primary buyer).
- Guided chat — ключевой продукт. Ученик решает задачи в произвольном порядке (не последовательно).
- Критический баг в пилоте: если студент решает последнюю задачу по номеру первой (другие ещё активны) — тред некорректно помечается completed, блокируя весь ввод.

Спека: docs/delivery/features/guided-chat-student-fixes/spec.md
PRD: docs/delivery/features/guided-chat-student-fixes/prd.md

Прочитай перед работой:
1. docs/delivery/features/guided-chat-student-fixes/spec.md (полностью)
2. CLAUDE.md (корень)
3. .claude/rules/10-safe-change-policy.md
4. .claude/rules/40-homework-system.md (секции: Свободный порядок задач, Task-lock fix, Realtime Е9)
5. supabase/functions/homework-api/index.ts — функцию performTaskAdvance и её вызовы

Задача (TASK-1):
Исправить performTaskAdvance в supabase/functions/homework-api/index.ts.

ТЕКУЩАЯ ЛОГИКА (неверная):
  nextOrder = sortedOrders[currentIdx + 1]  // следующий по порядку индекса
  if nextOrder === null → thread.status = 'completed'  // ОШИБКА: не учитывает пропущенные задачи

НОВАЯ ЛОГИКА:
  После пометки currentOrder как completed:
  1. Собрать оставшиеся активные задачи:
     remainingActiveOrders = sortedOrders.filter(
       order => order !== currentOrder && stateByOrder.get(order)?.status === 'active'
     )
  2. Если remainingActiveOrders.length > 0:
     - nextOrder = remainingActiveOrders[0]  // первый активный по возрастанию номера
     - обновить thread.current_task_order = nextOrder
     - вставить system message о переходе
     - return { nextOrder, threadCompleted: false }
  3. Если нет активных:
     - обновить thread.status = 'completed'
     - вставить system message "Все задачи выполнены!"
     - return { nextOrder: null, threadCompleted: true }

ВАЖНО: stateByOrder — snapshot до update. Текущая задача ещё числится 'active' → фильтр `order !== currentOrder` обязателен.

Scope ограничений:
- Менять ТОЛЬКО performTaskAdvance.
- НЕ трогать: handleRequestHint, provisionGuidedThread, RLS, миграции.
- НЕ менять сигнатуру AdvanceResult: { nextOrder: number | null, threadCompleted: boolean }.
- НЕ трогать frontend.

Acceptance (Given/When/Then):
- AC-1: Given ДЗ из 3 задач, When студент решает #3 первой, Then thread.status = 'active', input для #1 и #2 не заблокирован.
- AC-2: Given студент решил все 3 задачи в любом порядке, Then после последней thread.status = 'completed'.
- AC-3: Given студент решил #5 из 5, When POST /threads/:id/check для задачи #1, Then HTTP 200 (не 400 ALREADY_COMPLETED).

В конце:
1. Перечисли изменённые файлы.
2. Краткое summary изменений.
3. Запусти `npm run lint && npm run build && npm run smoke-check`.
4. Укажи, какие edge cases проверены (что если все задачи уже completed до advance?).
5. Self-check: изменения строго внутри performTaskAdvance, контракт AdvanceResult не нарушен.
```

### Prompt — TASK-2 (Миграция exam_type + backend)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст:
- Репетиторы готовят учеников к ОГЭ, а UI показывает «как на ЕГЭ» — нужна поддержка типа экзамена.
- Fix 2 в рамках guided-chat-student-fixes: добавить exam_type в homework_tutor_assignments.

Спека: docs/delivery/features/guided-chat-student-fixes/spec.md (секции Fix 2, Technical Design)

Прочитай перед работой:
1. docs/delivery/features/guided-chat-student-fixes/spec.md
2. CLAUDE.md
3. .claude/rules/10-safe-change-policy.md
4. .claude/rules/40-homework-system.md
5. supabase/functions/homework-api/index.ts — handleCreateAssignment, handleUpdateAssignment, handleGetStudentAssignment

Зависимость: TASK-1 завершён.

Задача (TASK-2):

Шаг 1 — МИГРАЦИЯ (новый файл supabase/migrations/20260406_add_exam_type_to_assignments.sql):
  ALTER TABLE homework_tutor_assignments
    ADD COLUMN IF NOT EXISTS exam_type VARCHAR NOT NULL DEFAULT 'ege'
    CONSTRAINT homework_tutor_assignments_exam_type_check
    CHECK (exam_type IN ('ege', 'oge'));

Шаг 2 — handleCreateAssignment:
  - Принять optional exam_type из body
  - Добавить VALID_EXAM_TYPES = ['ege', 'oge'] валидацию (аналог VALID_CHECK_FORMATS)
  - Добавить exam_type в INSERT (default 'ege')

Шаг 3 — handleUpdateAssignment:
  - Принять optional exam_type из body
  - Добавить в UPDATE payload только если передано (не перетирать)

Шаг 4 — handleGetStudentAssignment:
  - Добавить exam_type в SELECT из homework_tutor_assignments
  - Вернуть в response body

Guardrails:
- НЕ трогать RLS policies.
- НЕ трогать handleCheckAnswer, handleRequestHint.
- Миграция безопасна: DEFAULT 'ege', NOT NULL — не ломает существующие строки.
- Не трогать frontend.

Acceptance:
- AC-4 (backend часть): POST /assignments c { exam_type: 'oge' } → сохраняется в БД как 'oge'.
- AC-6 (backend часть): GET /assignments/:id/student → ответ содержит exam_type.

В конце:
1. Перечисли изменённые файлы.
2. `npm run lint && npm run build && npm run smoke-check`.
3. Self-check: VALID_EXAM_TYPES валидация добавлена, DEFAULT правильный.
```

### Prompt — TASK-3 (Frontend tutor: select в HWExpandedParams)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст:
- Репетитор должен указывать тип экзамена (ЕГЭ / ОГЭ) при создании ДЗ.
- Selector добавляется в L1 «Расширенные параметры» конструктора ДЗ.

Спека: docs/delivery/features/guided-chat-student-fixes/spec.md (Fix 2, UX/UI секция)

Прочитай перед работой:
1. docs/delivery/features/guided-chat-student-fixes/spec.md
2. CLAUDE.md
3. .claude/rules/80-cross-browser.md (iOS Safari: font-size 16px, touch-action: manipulation)
4. .claude/rules/90-design-system.md
5. src/components/tutor/HWExpandedParams.tsx (полностью)
6. src/lib/tutorHomeworkApi.ts — CreateAssignmentPayload, UpdateAssignmentPayload
7. src/pages/tutor/TutorHomeworkCreate.tsx — как прокидываются параметры в payload

Зависимость: TASK-2 завершён (exam_type принимается backend-ом).

Задача (TASK-3):

1. HWExpandedParams.tsx:
   - Добавить props: examType: 'ege' | 'oge', onExamTypeChange: (v: 'ege' | 'oge') => void
   - Добавить нативный <select> «Тип экзамена»:
     <label>Тип экзамена</label>
     <select value={examType} onChange={e => onExamTypeChange(e.target.value as 'ege' | 'oge')}>
       <option value="ege">ЕГЭ</option>
       <option value="oge">ОГЭ</option>
     </select>
   - Стиль select: font-size: 16px; touch-action: manipulation (iOS anti-zoom)
   - Классы: border-slate-200 rounded-md — консистентно с другими L1 полями

2. tutorHomeworkApi.ts:
   - Добавить exam_type?: 'ege' | 'oge' в CreateAssignmentPayload и UpdateAssignmentPayload

3. TutorHomeworkCreate.tsx:
   - Добавить examType в state (default: 'ege')
   - Прокинуть в HWExpandedParams
   - Включить в payload при create/update

Guardrails:
- Нативный <select>, не custom dropdown.
- font-size: 16px обязателен на select (iOS Safari auto-zoom).
- Dot-indicator в L1 кнопке: НЕ добавлять для exam_type.
- Никаких emoji в UI chrome.
- Не трогать student-side файлы.

Acceptance:
- AC-4: Открыть конструктор → L1 → видно select «Тип экзамена» (ЕГЭ / ОГЭ).
  При выборе ОГЭ + сохранении → exam_type='oge' в БД.

В конце:
1. Перечисли изменённые файлы.
2. `npm run lint && npm run build && npm run smoke-check`.
3. Self-check: font-size 16px на select, нет framer-motion, нет hover:scale.
```

### Prompt — TASK-4 (Frontend student: динамический examTypeLabel)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст:
- Текст баннера и AI-промпта для detailed_solution хардкодит «ЕГЭ».
- Репетитор Елена готовит учеников к ОГЭ — нужен динамический текст.

Спека: docs/delivery/features/guided-chat-student-fixes/spec.md (Fix 2)

Прочитай перед работой:
1. docs/delivery/features/guided-chat-student-fixes/spec.md
2. CLAUDE.md
3. .claude/rules/10-safe-change-policy.md
4. .claude/rules/40-homework-system.md
5. src/components/homework/GuidedHomeworkWorkspace.tsx (полностью, особенно строки ~145–180 buildTaskContext и ~1410–1420 amber banner)
6. src/types/homework.ts — тип StudentAssignment
7. src/lib/studentHomeworkApi.ts — getStudentAssignment

Зависимость: TASK-2 (exam_type возвращается backend-ом) + TASK-3 (exam_type сохраняется при создании ДЗ).

Задача (TASK-4):

1. src/types/homework.ts:
   - Добавить exam_type: 'ege' | 'oge' в тип StudentAssignment

2. src/lib/studentHomeworkApi.ts:
   - В getStudentAssignment добавить exam_type в SELECT

3. GuidedHomeworkWorkspace.tsx:
   a) Вычислить в компоненте:
      const examTypeLabel = assignment.exam_type === 'oge' ? 'ОГЭ' : 'ЕГЭ';

   b) Amber banner (~строка 1415):
      Найти текст «как на ЕГЭ» и заменить на `как на ${examTypeLabel}`

   c) buildTaskContext (~строки 145–180):
      - Добавить examType?: 'ege' | 'oge' в параметр options
      - Заменить хардкод «Мотивируй это подготовкой к ЕГЭ»
        на `Мотивируй это подготовкой к ${examTypeLabel}` где examTypeLabel = options.examType === 'oge' ? 'ОГЭ' : 'ЕГЭ'
      - Все вызовы buildTaskContext передают examType: assignment.exam_type

Guardrails:
- Emoji 📝 в баннере — допустимо (user-facing мотивационный текст).
- Fallback если exam_type undefined: дефолт 'ege' — платформа не падает.
- Не трогать tutor-side файлы (GuidedThreadViewer, TutorHomeworkDetail, HWTaskCard).
- Не менять логику buildTaskContext кроме подстановки examType.
- Никаких новых CSS, никаких framer-motion.

Acceptance:
- AC-5: ДЗ с exam_type='oge' и check_format='detailed_solution' → баннер содержит «как на ОГЭ».
- AC-6: ДЗ с exam_type='ege' (дефолт) → баннер содержит «как на ЕГЭ» (нет регрессии).

В конце:
1. Перечисли изменённые файлы.
2. `npm run lint && npm run build && npm run smoke-check`.
3. Self-check: fallback для undefined exam_type есть, tutor-side не затронут.
```

### Prompt — TASK-5 (Validation)

```
Твоя роль: QA-engineer в проекте SokratAI.

Контекст: мёрджим guided-chat-student-fixes (Bug 1 — performTaskAdvance + Bug 2 — exam_type) перед платным пилотом 15 апреля.

Спека: docs/delivery/features/guided-chat-student-fixes/spec.md (секция AC)

Зависимости: TASK-1, TASK-2, TASK-3, TASK-4 завершены.

Шаги:
1. npm run lint
2. npm run build
3. npm run smoke-check  (НЕ параллельно с build)

Manual QA — Fix 1 (Bug 1, AC-1..AC-3):
- Создать тестовое ДЗ из 3 задач в dev-среде
- Залогиниться как ученик
- Открыть задачу #3, отправить правильный ответ (guided chat)
- AC-1: GuidedChatInput для #1 и #2 НЕ задизейблен. В Supabase: thread.status = 'active'.
- AC-2: Решить #1 и #2 → thread.status = 'completed', итоговый экран показывается корректно.
- AC-3: После решения #3 (при активных #1, #2) — сделать API call POST /threads/:id/check для задачи #1 → HTTP 200, не 400.

Manual QA — Fix 2 (Bug 2, AC-4..AC-6):
- AC-4: Открыть конструктор ДЗ → L1 → есть select «Тип экзамена» (ЕГЭ / ОГЭ).
  Выбрать ОГЭ, сохранить → проверить в Supabase: exam_type = 'oge'.
- AC-5: Открыть это ДЗ как ученик, перейти к задаче с check_format='detailed_solution' →
  баннер содержит «как на ОГЭ».
- AC-6: Создать второе ДЗ с дефолтным exam_type → баннер «как на ЕГЭ» (нет регрессии).

Формат результата:
- Построчно по AC: PASS / FAIL + краткое описание что проверялось.
- Если FAIL — указать точный шаг воспроизведения и вернуть автору с указанием нужного TASK.
```
