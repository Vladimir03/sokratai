# Подзадача 1: Рефакторинг визарда ДЗ в Single-Page конструктор

**Родительский PRD:** `docs/features/specs/tutor-homework-create-send-v2.md`
**Тип задачи (doc 20):** Тип B — рефакторинг flow
**Job:** P0.1 — Собрать ДЗ по теме после урока
**Wedge:** Собрать ДЗ за 5–10 минут вместо 30–60
**Статус:** Phase 1 ✅ (2026-03-16) · Phase 2 ✅ (2026-03-16) · Phase 3 ✅ (2026-03-17) · Phase 4 ✅ (2026-03-17)
**Дата:** 2026-03-17

---

## 1. Суть изменения

Текущий `TutorHomeworkCreate.tsx` — это 3-шаговый визард (~1900 строк):
- **Шаг 1:** Метаданные (название, предмет, тема, дедлайн, режим)
- **Шаг 2:** Задачи + материалы
- **Шаг 3:** Выбор учеников + уведомление

Мы превращаем его в **single-page layout** с progressive disclosure:
- **L0 (всегда видно):** Тема + Кому + Задачи + Отправить
- **L1 (по клику):** Название, предмет, дедлайн, режим, инструкция, материалы

**Целевой результат:** 4–6 кликов от входа до отправки (вместо 8+).

---

## 2. Текущее состояние кода (audit)

### Файл: `src/pages/tutor/TutorHomeworkCreate.tsx` (~1900 строк)

**State management:**
```
currentStep: number (1 | 2 | 3)
title: string
subject: HomeworkSubject
topic: string
deadline: string | null
workflowMode: 'classic' | 'guided_chat'
draftTasks: DraftTask[]
materials: MaterialDraft[]
selectedStudentIds: string[]
selectedGroupId: string | null
notifyEnabled: boolean
messageTemplate: string
submitPhase: 'idle' | 'creating' | 'adding_materials' | 'assigning' | 'notifying' | 'done'
saveAsTemplate: boolean
```

**Внутренние компоненты (объявлены inline):**
- `StepMeta` — шаг 1 (форма метаданных)
- `StepTasks` — шаг 2 (задачи + материалы)
- `StepAssign` — шаг 3 (ученики + уведомление)
- `SubmitPhaseTracker` — индикатор фаз отправки
- `TaskCard` — карточка задачи (edit mode)
- `TemplatePickerSheet` — выбор шаблона

**Интеграции (НЕ трогать):**
- `KBPickerSheet` (внешний компонент, `src/components/tutor/KBPickerSheet.tsx`)
- `kbTaskToDraftTask()` — конвертер KB → DraftTask
- `handleSubmit()` — 4-фазный submit (create → materials → assign → notify)
- Image upload (primary + fallback bucket)
- Template save logic
- `useTutorStudents()`, `useTutorGroups()` hooks

### Файл: `src/pages/tutor/TutorHomeworkDetail.tsx` (~650 строк)
- Отдельная страница, НЕ затрагивается в этой подзадаче

---

## 3. Целевая архитектура (после рефакторинга)

### Новая структура файлов

```
src/pages/tutor/TutorHomeworkCreate.tsx          — основной контейнер (slim, ~300 строк)
src/components/tutor/homework-create/
  ├── HWHeaderSection.tsx                         — L0: Тема + Кому
  ├── HWExpandedParams.tsx                        — L1: Название, предмет, дедлайн, режим
  ├── HWTasksSection.tsx                          — Список задач + кнопки добавления
  ├── HWTaskCard.tsx                              — Карточка одной задачи (view/edit)
  ├── HWInstructionSection.tsx                    — L1: Инструкция для ученика
  ├── HWMaterialsSection.tsx                      — L1: Материалы (файлы, ссылки)
  ├── HWActionBar.tsx                             — Футер: Экспорт + Черновик + Отправить
  ├── HWSubmitSuccess.tsx                         — Inline success state после отправки
  └── HomeworkRecipientPicker.tsx                  — Combobox «Кому» (группы + ученики)
```

### Что меняется, а что нет

| Слой | Меняется? | Детали |
|------|----------|--------|
| **Layout / UI** | ✅ Да | Визард → single-page с секциями |
| **State (React)** | ✅ Частично | Убрать `currentStep`, добавить `showExpanded`, `showSuccess` |
| **handleSubmit** | ❌ Нет | Бизнес-логика остаётся как есть |
| **API (tutorHomeworkApi)** | ❌ Нет | Ни один endpoint не меняется |
| **KBPickerSheet** | ❌ Нет | Работает без изменений |
| **Image upload** | ❌ Нет | Primary + fallback bucket, логика та же |
| **Template logic** | ❌ Нет | Сохранение шаблона остаётся |
| **Types (DraftTask)** | ❌ Нет | Структура данных не меняется |
| **React Query keys** | ❌ Нет | Инвалидация остаётся прежней |

---

## 4. Фазы реализации

### Phase 1: Извлечение компонентов (НЕ меняя layout) ✅ DONE 2026-03-16

**Цель:** разбить монолитный файл на модули, сохраняя визард.

1. Выделить `StepMeta` → `HWHeaderSection.tsx` + `HWExpandedParams.tsx`
2. Выделить `TaskCard` → `HWTaskCard.tsx`
3. Выделить задачи из `StepTasks` → `HWTasksSection.tsx`
4. Выделить материалы из `StepTasks` → `HWMaterialsSection.tsx`
5. Выделить инструкцию → `HWInstructionSection.tsx`
6. Выделить выбор учеников из `StepAssign` → `HomeworkRecipientPicker.tsx`
7. Выделить footer → `HWActionBar.tsx`

**Критерий Phase 1 done:** визард работает как раньше, но из маленьких компонентов. `npm run lint && npm run build && npm run test` pass.

**Результат (2026-03-16):** компоненты извлечены в `src/components/tutor/homework-create/`. Дополнительно исправлены: `crypto.randomUUID()` → `generateUUID()` (Safari 15.0–15.3), `Card animate={false}`, `sm:` → `md:`, `new Date()` → `parseISO`, copy «чат с AI» → «Пошаговое решение с подсказками», placeholder задачи. `handleSubmit`, `KBPickerSheet`, image upload, template logic не тронуты.

### Phase 2: Single-page layout ✅ DONE 2026-03-16

**Цель:** убрать step-навигацию, показать все секции на одной странице.

1. Убрать `currentStep` state и step-навигацию
2. Отрисовать все секции последовательно:
   - `HWHeaderSection` (Тема + Кому) — always visible
   - `HWExpandedParams` — collapsible, default closed
   - `HWTasksSection` — always visible
   - `HWInstructionSection` — collapsible
   - `HWMaterialsSection` — collapsible
   - `HWActionBar` — sticky bottom
3. Auto-generate `title` из `topic + date`:
   ```typescript
   const autoTitle = useMemo(() => {
     const dateStr = format(new Date(), 'dd.MM', { locale: ru });
     return topic ? `ДЗ ${topic} ${dateStr}` : `ДЗ ${dateStr}`;
   }, [topic]);
   ```
4. Перенести `HomeworkRecipientPicker` в header (L0)
5. Validation: inline errors у каждой секции (не toast при шаге)

**Критерий Phase 2 done:** single-page работает, все поля доступны, submit отправляет ДЗ. lint/build/test pass.

**Результат (2026-03-16):** step-навигация убрана. Все секции на одной странице. Auto-title `ДЗ {topic} {dd.MM}` через `useMemo`. `validateAll()` — inline errors. Soft topic hint (amber, не красный). Groups/memberships fetch без step-gating. `kbTaskToDraftTask` перенесён в `HWTasksSection.tsx`. `CLAUDE.md` и `kb-tasks.md` обновлены.

### Phase 3: Progressive disclosure + polish ✅ DONE 2026-03-17

**Цель:** реализовать L0/L1 разделение и mobile layout.

1. По умолчанию скрыть: название, предмет, дедлайн, режим, инструкцию, материалы
2. Кнопка `[+ Расширенные параметры]` раскрывает L1
3. Mobile layout: sticky `HWActionBar` внизу экрана
4. Responsive: `md:` breakpoints для grid
5. Telegram-статус inline в `HomeworkRecipientPicker`
6. Warning-banner для учеников без Telegram с fallback

**Критерий Phase 3 done:** L0 path работает за 4–6 кликов. Mobile и desktop layouts корректны.

**Результат (2026-03-17):**
- L0 (всегда видно): Тема, Кому (HWAssignSection), Задачи, ActionBar
- L1 (collapsible, CSS grid animation): Название, Предмет, Дедлайн, Режим (HWExpandedParams) + Материалы (HWMaterialsSection)
- Кнопка «Расширенные параметры» / «Скрыть параметры» + dot indicator при наличии данных в L1
- Dot indicator учитывает: `title`, `subject !== 'physics'`, `deadline`, `workflow_mode !== 'guided_chat'`, `materials`
- Auto-expand L1 при ошибке валидации скрытого `subject`
- `_topicHint` non-blocking: фильтрация Hint-ключей из blocking check
- Default `subject: 'physics'` — L0 fast path без открытия L1
- Default `workflow_mode: 'guided_chat'` — guided mode по умолчанию
- `HWTasksSection`: материалы вынесены в L1 (удалены props `materials`/`onMaterialsChange`)
- `HWExpandedParams`: поле Тема перенесено в L0 контейнер
- lint/build/smoke-check pass

**Out of scope (Phase 3):** компактный `HomeworkRecipientPicker` (compact dropdown), `HWInstructionSection` (поле не существует в БД), `HWHeaderSection` как отдельный компонент. Эти пункты — кандидаты в Phase 5 или отдельный subtask.

### Phase 4: Inline success state ✅ DONE 2026-03-17

**Цель:** после отправки показать результат на той же странице.

1. `HWSubmitSuccess.tsx` — компонент с результатами
2. Per-student delivery status (✅/⚠️)
3. Кнопка «Скопировать ссылку» для учеников без Telegram
4. Навигация: «Открыть ДЗ», «Создать ещё», «← Домашки»
5. «Создать ещё» сбрасывает форму, но сохраняет `selectedGroupId`

**Критерий Phase 4 done:** полный цикл create→success на одной странице. lint/build/test pass.

**Результат (2026-03-17):**
- `HWSubmitSuccess.tsx` — inline success state, заменяет toast+navigate
- Per-student `StudentDeliveryStatus`: ✅ Уведомлен / ⚠️ Ошибка доставки / ✓ ДЗ назначено / ⚠️ нет Telegram
- `deliveryFailed` поле отделяет реальную ошибку Telegram от «уведомления отключены»
- «Создать ещё»: revoke blob URLs (memory-safe), recompute group students без effect re-trigger
- Subject вынесен из L1 в L0 (между Тема и Кому) — всегда виден, нельзя пропустить
- Dot indicator L1 обновлён: subject убран (он в L0)
- `handleSubmit` финальный блок: success state вместо toast, 4-phase core logic не тронут
- lint/build/smoke-check pass

---

## 5. Точные промпты для Claude Code

### 5.1. Phase 1 — Plan (первый запрос)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Нужно поработать над tutor feature:
Рефакторинг TutorHomeworkCreate из 3-шагового визарда в single-page конструктор.

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ;
- wedge: быстро собрать ДЗ и новую практику по теме урока;
- продукт = workspace / bundle: AI + база + домашки + материалы;
- AI = draft + action, а не generic chat.

Сначала обязательно прочитай документы:
1. docs/product/research/ajtbd/08-wedge-decision-memo-sokrat.md
2. docs/product/specs/tutor_ai_agents/14-ajtbd-product-prd-sokrat.md
3. docs/product/specs/tutor_ai_agents/16-ux-principles-for-tutor-product-sokrat.md
4. docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules-sokrat.md
5. docs/features/specs/tutor-homework-create-send-v2.md
6. docs/features/specs/subtask-01-single-page-hw-create.md
7. CLAUDE.md

Сейчас ничего не кодируй.

Нужно:
1. Сделать audit текущего TutorHomeworkCreate.tsx — перечислить все inline-компоненты, state vars, интеграции
2. Предложить план извлечения компонентов (Phase 1 из spec) — что в какой файл
3. Выделить assumptions и risks
4. Подтвердить, что handleSubmit, KBPickerSheet, image upload, template logic НЕ затрагиваются

Важно:
- не расширяй scope beyond wedge;
- не делай generic chat UX;
- не придумывай новые product decisions из воздуха;
- это Тип B (рефакторинг flow) — не добавляй новые фичи.

Формат ответа:
1. Executive summary
2. Current file audit
3. Extraction plan (файл → что содержит → props interface)
4. Assumptions
5. Risks
6. Recommendation: с чего начать первым
```

### 5.2. Phase 1 — Implementation

```
Ок, теперь реализуй Phase 1: Извлечение компонентов.

Следуй extraction plan из своего audit.
Создай файлы в src/components/tutor/homework-create/.

Требования:
- строго следовать docs и feature spec;
- НЕ менять layout (визард с 3 шагами пока остаётся);
- НЕ трогать handleSubmit, KBPickerSheet, image upload, template logic;
- каждый компонент должен иметь typed props interface;
- НЕ добавлять framer-motion (performance rule);
- structural breakpoints: md: для grid, не sm:;
- сохранить работающие части системы.

В конце:
1. changed files
2. что сделано
3. что осталось (Phase 2–4)
4. validation results (npm run lint && npm run build && npm run test)
5. self-check against docs 16, 17
6. какие документы нужно обновить после этой реализации
```

### 5.3. Phase 2 — Single-page layout

```
Теперь реализуй Phase 2: Single-page layout.

Следуй feature spec: docs/features/specs/subtask-01-single-page-hw-create.md, секция "Phase 2".

Что делать:
1. Убрать currentStep state и step-навигацию из TutorHomeworkCreate.tsx
2. Отрисовать все секции последовательно на одной странице
3. Auto-generate title из topic + дата
4. Перенести HomeworkRecipientPicker в header
5. Inline validation (не toast при переходе шага)

Что НЕ делать:
- НЕ менять handleSubmit logic
- НЕ менять API
- НЕ добавлять progressive disclosure (это Phase 3)
- НЕ добавлять success state (это Phase 4)

Сохрани:
- приоритет wedge;
- action-first UX;
- tutor workflow context.

В конце:
1. changed files
2. summary
3. out of scope (что осталось для Phase 3–4)
4. validation (npm run lint && npm run build && npm run test)
5. self-check: один primary CTA? action-first? не chat? naming по словарю doc 17?
6. docs-to-update checklist
```

### 5.4. Phase 3 — Progressive disclosure

```
Теперь реализуй Phase 3: Progressive disclosure + mobile.

Следуй feature spec: docs/features/specs/subtask-01-single-page-hw-create.md, секция "Phase 3".

Что делать:
1. L0 (всегда видно): Тема + Кому + Задачи + кнопки добавления + ActionBar
2. L1 (скрыто, раскрывается по клику "+ Расширенные параметры"):
   - Название, предмет, дедлайн, режим
   - Инструкция для ученика
   - Материалы
3. Mobile: HWActionBar sticky bottom
4. Desktop: ActionBar в конце страницы
5. Telegram-статус inline в HomeworkRecipientPicker (✅ / ⚠️)
6. Warning-banner для учеников без Telegram

Правила UI (doc 17):
- Structural breakpoints: md: для grid-cols/flex-row, НЕ sm:
- Card в grid: animate={false}
- Один primary CTA на экране: «Отправить ДЗ»
- Input font-size ≥ 16px (iOS auto-zoom prevention)

В конце:
1. changed files
2. summary
3. out of scope
4. validation
5. docs-to-update checklist
```

### 5.5. Phase 4 — Inline success

```
Теперь реализуй Phase 4: Inline success state.

Следуй feature spec: docs/features/specs/subtask-01-single-page-hw-create.md, секция "Phase 4".

Создай компонент HWSubmitSuccess.tsx.

Что он показывает:
- ✅ ДЗ отправлено!
- Тема · Группа · кол-во задач
- Per-student status:
  - ✅ Имя — уведомление отправлено
  - ⚠️ Имя — нет Telegram → [Скопировать ссылку для Имя]
- Навигация: [Открыть ДЗ] [Создать ещё] [← Домашки]

Данные: использовать результат из handleSubmit (sent, failed, assignment_id).
"Создать ещё": сбросить форму, сохранить selectedGroupId.

В конце:
1. changed files
2. summary
3. validation
4. docs-to-update checklist
```

---

## 6. Промпт для Code Review в ChatGPT (Codex / VS Code)

Этот промпт отправляется после каждой Phase:

```
Сделай code review реализованной tutor feature:
Рефакторинг TutorHomeworkCreate — Phase N (single-page конструктор ДЗ)

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ;
- wedge: быстро собрать ДЗ и новую практику по теме урока;
- продукт = AI + база + домашки + материалы;
- нельзя скатываться в generic chat UX.

Прочитай:
1. docs/product/specs/tutor_ai_agents/16-ux-principles-for-tutor-product-sokrat.md
2. docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules-sokrat.md
3. docs/features/specs/tutor-homework-create-send-v2.md
4. docs/features/specs/subtask-01-single-page-hw-create.md

Проверь (8 вопросов из doc 19):
1. Какой job усиливает эта реализация?
2. Усиливает ли она wedge?
3. Не уехал ли UX в generic chat?
4. Есть ли чёткий primary CTA?
5. Переводится ли AI output в действие?
6. Явны ли состояния результата?
7. Не прячется ли частый workflow слишком глубоко?
8. Не добавлен ли лишний scope?

Дополнительно проверь:
9. Нет ли framer-motion в новых компонентах (performance rule)?
10. Structural breakpoints: md: для grid, не sm:?
11. Card в grid: animate={false}?
12. Safari 15+ совместимость (нет lookbehind, нет new Date(string))?
13. React Query keys: ['tutor', 'homework', ...]?
14. Input font-size ≥ 16px (iOS)?
15. handleSubmit и KBPickerSheet не затронуты?

Формат ответа:
- Executive summary
- Must fix (блокеры)
- Should fix (важно, но не блокер)
- Nice to have (P2)
- Product drift risks
- UX risks
- Architecture/state risks
- Docs that may need update
```

---

## 7. Промпт для Lovable (визуальная доработка)

После того как Claude Code реализовал Phase 2–3, отправляем в Lovable:

```
Улучши визуальный дизайн страницы создания ДЗ для репетитора.

Контекст: это рабочее место репетитора по физике для сборки домашних заданий.
Файл: src/pages/tutor/TutorHomeworkCreate.tsx

Требования:
- Продукт = workspace, не чат. Выглядит как notion/linear, не как chatgpt.
- Один primary CTA: "Отправить ДЗ" (зелёный, #1B6B4A).
- Collapsible секции с мягкой анимацией (CSS transition, НЕ framer-motion).
- Task cards: компактные, с drag handle (≡), badge источника, inline edit.
- Mobile: sticky footer с кнопками, input font-size ≥ 16px.
- Palette: #1B6B4A (primary), #5B5FC7 (purple, группы), #E8913A (accent).

НЕ делай:
- Не добавляй framer-motion в компоненты ui/* (Card, Button, Badge)
- Не меняй handleSubmit и бизнес-логику
- Не меняй breakpoints (используй md:, не sm:)
- Не меняй API-вызовы
```

---

## 8. Migration constraints

### Что НЕЛЬЗЯ ломать

| Функционал | Почему | Как проверить |
|-----------|--------|---------------|
| `handleSubmit` 4 фазы | Core бизнес-логика | Создать ДЗ → назначить → уведомить → получить success |
| `KBPickerSheet` | Уже работает, tested | Открыть drawer → выбрать задачи → добавить в draft |
| Image upload (primary + fallback) | Хрупкий, dual-bucket | Загрузить фото в задачу → preview отображается |
| Template save / load | Используется репетиторами | Сохранить как шаблон → загрузить → задачи заполнены |
| KB provenance fields | Snapshot-механика | Добавить из KB → submit → homework_kb_tasks создана |
| Delivery status tracking | Telegram integration | Отправить → delivery_status per student |
| Группы | Пилотная функция | Выбрать группу → ученики auto-selected |

### Safari / Cross-browser checklist

```
□ Нет RegExp lookbehind (?<=...)
□ Нет new Date("2024-01-15 10:30:00") — только ISO или date-fns
□ Нет Array.at()
□ Нет structuredClone()
□ Input font-size ≥ 16px (iOS auto-zoom)
□ Нет 100vh на mobile (использовать 100dvh или -webkit-fill-available)
□ CSS transitions вместо framer-motion
□ -webkit-backdrop-filter если используется backdrop-filter
```

---

## 9. Acceptance Criteria (полный список)

### Functional

```
□ Все секции на одной странице (нет step-навигации)
□ L0: только Тема + Кому + Задачи + кнопки добавления + ActionBar
□ L1: раскрывается по клику «+ Расширенные параметры»
□ Название ДЗ auto-генерируется из topic + дата
□ Поле «Кому»: группы + ученики в одном dropdown
□ Telegram-статус видимый при выборе ученика (✅ / ⚠️)
□ Warning для учеников без Telegram + fallback (ссылка)
□ 3 способа добавить задачу: Из базы / Вручную / (P1: AI)
□ Task card: collapsed view + expand для edit
□ Task card: badge источника (Из базы / Ручной ввод)
□ Drag-and-drop для сортировки задач
□ Image upload работает (primary + fallback bucket)
□ KB picker работает без изменений
□ Template picker работает
□ Submit создаёт ДЗ + назначает + уведомляет (единый flow)
□ Inline success state с per-student status
□ «Скопировать ссылку» для учеников без Telegram
□ «Создать ещё» сбрасывает форму, сохраняет группу
□ Один primary CTA: «Отправить ДЗ»
□ ≤6 кликов от входа до отправки (L0 path)
```

### Technical

```
□ npm run lint — pass
□ npm run build — pass
□ npm run test — pass
□ Нет framer-motion в новых компонентах
□ Lazy import для тяжёлых компонентов
□ React Query keys: ['tutor', 'homework', ...]
□ Structural breakpoints: md: для grid-cols, не sm:
□ Card в grid: animate={false}
□ Input font-size ≥ 16px
□ Safari 15+ совместимость
□ Модуль TutorHomeworkCreate ≤ 400 строк (остальное в компонентах)
```

### Review (doc 19, 8 вопросов)

```
□ Job = P0.1 — Собрать ДЗ по теме после урока
□ Усиливает wedge (быстрее собрать и отправить)
□ Не generic chat
□ Primary CTA = «Отправить ДЗ»
□ AI output → action (задачи из KB → в ДЗ)
□ Состояния явные (draft → sending → success)
□ Частый workflow (L0) не спрятан
□ Нет лишнего scope
```

---

## 10. Definition of Done (doc 19)

```
1. ✓ Связь с job (P0.1) — задокументирована
2. ✓ Связь с wedge — сокращает время сборки + отправки
3. ✓ Feature spec — этот документ + родительский PRD
4. ✓ Claude Code реализовал Phase 1 (2026-03-16) — Phase 2–4 pending
5. □ ChatGPT (Codex) сделал review (после каждой фазы)
6. □ Замечания учтены
7. □ Фича не ломает UX/UI-канон (docs 16, 17)
8. □ Success signal: время от «Создать ДЗ» до «Отправлено» < 5 минут
9. □ Pilot-ready: вписана в pilot metrics (doc 18)
```
