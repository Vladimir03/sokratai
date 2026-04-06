# Tasks: Guided Chat — Task Lock

**Spec:** `docs/delivery/features/guided-chat/task-lock-spec.md`
**PRD:** `docs/delivery/features/guided-chat/task-lock-prd.md`
**Ticket:** #2 из batch Егора (P0)
**Prompt patterns:** `docs/discovery/product/tutor-ai-agents/20-claude-code-prompt-patterns-sokrat.md` (Type C — UX polish/fix)
**Дата:** 2026-04-01

---

## Обзор

8 задач, 2 файла. Задачи 1-4 — последовательные (зависят друг от друга). Задача 5 — параллельная с 1-4 (отдельный файл). Задачи 6-8 — финализация.

```
TASK-1 (syncThreadDataOnly)
    ↓
TASK-2 (handleCheckAnswer — auto-advance)       TASK-5 (TaskStepper — celebration)
    ↓                                                ↓
TASK-3 (handleHint — data sync only)                 │
    ↓                                                │
TASK-4 (restore-on-load — completed fallback)        │
    ↓                                                │
    └──────────────── TASK-6 (race guard) ───────────┘
                          ↓
                     TASK-7 (timer cleanup)
                          ↓
                     TASK-8 (QA + validation)
```

---

## TASK-1: Создать `syncThreadDataOnly` — data sync без навигации

**Job:** S1-2 (core fix — student stays on chosen task)
**Agent:** Claude Code
**Files:** `src/components/homework/GuidedHomeworkWorkspace.tsx`
**AC:** AC-1, AC-2 (prerequisite)
**Зависимости:** нет

### Что делать

Заменить `syncThreadFromResponse` на `syncThreadDataOnly`. Новая функция синхронизирует messages, task_states, threadStatus — но **НЕ меняет `currentTaskOrder`**.

### Промпт для агента

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ
- wedge: быстро собрать ДЗ и новую практику по теме урока
- AI = draft + action, а не generic chat
- Это UX-fix P0: ученик перебрасывается на другую задачу при check/hint в guided mode

Сначала обязательно прочитай:
1. docs/delivery/features/guided-chat/task-lock-spec.md — секция 5.1, CHANGE-1
2. CLAUDE.md
3. .claude/rules/40-homework-system.md

Задача:
В файле src/components/homework/GuidedHomeworkWorkspace.tsx:

1. Найди функцию syncThreadFromResponse (около строки 435).
2. Замени её на syncThreadDataOnly согласно CHANGE-1 из спеки:
   - Оставь: setMessages(normalizedMessages), setTaskStates(...), setThreadCurrentTaskOrder(...), setThreadStatus(...)
   - Убери: всю логику setCurrentTaskOrder — блок const newOrder = ... → setCurrentTaskOrder(...) и связанное сохранение/восстановление drafts
3. Обнови все ссылки на syncThreadFromResponse в dependency arrays useCallback — замени на syncThreadDataOnly.
4. НЕ меняй вызовы syncThreadFromResponse в handleCheckAnswer и handleHint пока — это TASK-2 и TASK-3.

Acceptance Criteria (из спеки):
- AC-1: Given: ученик на задаче 5, задача 3 не решена. When: ученик отправляет неверный ответ на задачу 5. Then: ученик остаётся на задаче 5, видит AI-feedback по задаче 5.
- AC-2: Given: ученик на задаче 5. When: ученик запрашивает подсказку. Then: ученик остаётся на задаче 5, видит подсказку в чате задачи 5.
(Эти AC станут проверяемыми после TASK-2 и TASK-3 — текущая задача создаёт prerequisite.)

Guardrails:
- Не расширяй scope beyond этого одного файла
- Не меняй backend (supabase/functions/)
- Не меняй API client (studentHomeworkApi.ts)
- Не добавляй новые зависимости
- Safari 15+ совместимость: нет Array.at(), structuredClone(), Object.hasOwn()

В конце обязательно:
1. Перечисли changed files
2. Дай краткий summary реализации
3. Покажи validation results: npm run lint
4. Напиши, какие документы нужно обновить после этой реализации
5. Self-check: реализация не противоречит docs 16 (UX principles) и 17 (UI patterns)
```

---

## TASK-2: Обновить `handleCheckAnswer` — auto-advance с delay при correct

**Job:** S1-2 + R4 visual confirmation
**Agent:** Claude Code
**Files:** `src/components/homework/GuidedHomeworkWorkspace.tsx`
**AC:** AC-1, AC-3, AC-4
**Зависимости:** TASK-1

### Что делать

В `handleCheckAnswer`: заменить `syncThreadFromResponse(response.thread)` на `syncThreadDataOnly(response.thread)`. Добавить логику auto-advance при `verdict === 'CORRECT'` с 1200ms delay и celebration state.

### Промпт для агента

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ
- wedge: быстро собрать ДЗ и новую практику по теме урока
- AI = draft + action, а не generic chat
- Это UX-fix P0 + nice-to-have R4 visual celebration

Сначала обязательно прочитай:
1. docs/delivery/features/guided-chat/task-lock-spec.md — секция 5.1, CHANGE-2
2. CLAUDE.md
3. .claude/rules/40-homework-system.md
4. .claude/rules/80-cross-browser.md

Задача:
В файле src/components/homework/GuidedHomeworkWorkspace.tsx:

1. Добавь новый state:
   const [celebratingTaskOrder, setCelebratingTaskOrder] = useState<number | null>(null);

2. В handleCheckAnswer (около строки 739), замени:
   syncThreadFromResponse(response.thread);
   на:
   syncThreadDataOnly(response.thread);

3. Внутри блока if (response.verdict === 'CORRECT'), ПЕРЕД существующими toast/tracking вызовами, добавь celebration + auto-advance логику из CHANGE-2:
   - setCelebratingTaskOrder(taskOrder)
   - Найти next active task из response.thread.homework_tutor_task_states (prefer tasks после текущей, wrap around)
   - setTimeout(() => { setCelebratingTaskOrder(null); switchToTask(nextActive.task_order); }, 1200)
   - Если response.thread_completed — без auto-advance, только celebration 1200ms, toast «Все задачи завершены!»
   - Если нет next active — только celebration 1200ms

4. Сохрани ВСЕ существующие toast и tracking вызовы (не удаляй toast.success, trackGuidedHomeworkEvent).

5. Убедись что switchToTask в dependency array useCallback для handleCheckAnswer.

Acceptance Criteria (из спеки):
- AC-1: Given: ученик на задаче 5, задача 3 не решена. When: ученик отправляет неверный ответ на задачу 5. Then: ученик остаётся на задаче 5, видит AI-feedback по задаче 5, TaskStepper показывает кольцо на задаче 5.
- AC-3: Given: ученик на задаче 3, задача 4 active. When: ученик отправляет правильный ответ на задачу 3. Then: (1) зелёная анимация на задаче 3 ~1200ms, (2) toast «Правильно! Переходим к следующей задаче.», (3) через 1200ms автопереход на задачу 4, (4) задача 3 = completed.
- AC-4: Given: осталась одна незавершённая задача 7. When: ученик отправляет правильный ответ. Then: (1) зелёная анимация, (2) toast «Все задачи завершены!», (3) ученик остаётся на задаче 7, (4) completed view.

Guardrails:
- Не расширяй scope beyond этого одного файла
- Не меняй backend (supabase/functions/)
- Не добавляй framer-motion (запрет из performance.md — только CSS transitions + animate-bounce)
- Safari 15+: НЕ используй Array.at() (Safari < 15.4). Используй arr[0] после .sort()
- Safari 15+: НЕ используй structuredClone(), Object.hasOwn(), crypto.randomUUID()

В конце обязательно:
1. Перечисли changed files
2. Дай краткий summary реализации
3. Покажи validation results: npm run lint
4. Напиши, какие документы нужно обновить после этой реализации
5. Self-check: реализация не противоречит docs 16 (UX principles) и 17 (UI patterns)
```

---

## TASK-3: Обновить `handleHint` — data sync only

**Job:** S1-2
**Agent:** Claude Code
**Files:** `src/components/homework/GuidedHomeworkWorkspace.tsx`
**AC:** AC-2
**Зависимости:** TASK-1

### Что делать

Одна строка: в `handleHint` заменить `syncThreadFromResponse(response.thread)` на `syncThreadDataOnly(response.thread)`.

### Промпт для агента

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ
- wedge: быстро собрать ДЗ и новую практику по теме урока
- AI = draft + action, а не generic chat
- Это UX-fix P0: ученик перебрасывается на другую задачу при запросе подсказки

Сначала обязательно прочитай:
1. docs/delivery/features/guided-chat/task-lock-spec.md — секция 5.1, CHANGE-3
2. CLAUDE.md

Задача:
В файле src/components/homework/GuidedHomeworkWorkspace.tsx:

1. В функции handleHint (около строки 981), замени:
   syncThreadFromResponse(response.thread);
   на:
   syncThreadDataOnly(response.thread);

2. Обнови dependency array useCallback если syncThreadFromResponse упоминался — замени на syncThreadDataOnly.

Больше ничего менять не нужно. Это минимальное изменение — одна строка.

Acceptance Criteria (из спеки):
- AC-2: Given: ученик на задаче 5. When: ученик запрашивает подсказку (кнопка «Подсказка»). Then: ученик остаётся на задаче 5, видит подсказку в чате задачи 5.

Guardrails:
- Не расширяй scope — только handleHint в этом одном файле
- Не меняй handleCheckAnswer (это TASK-2)
- Не меняй backend
- Не добавляй новые зависимости

В конце обязательно:
1. Перечисли changed files
2. Дай краткий summary реализации
3. Покажи validation results: npm run lint
4. Напиши, какие документы нужно обновить после этой реализации
5. Self-check: реализация не противоречит docs 16 (UX principles) и 17 (UI patterns)
```

---

## TASK-4: Обновить restore-on-load — fallback на first active

**Job:** S1-2 (restore context after browser close)
**Agent:** Claude Code
**Files:** `src/components/homework/GuidedHomeworkWorkspace.tsx`
**AC:** AC-5
**Зависимости:** TASK-1

### Что делать

В `useEffect` инициализации (около строки 391): после `setCurrentTaskOrder(thread.current_task_order)`, добавить fallback — если `current_task_order` указывает на completed задачу, перенаправить на первую active.

### Промпт для агента

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ
- wedge: быстро собрать ДЗ и новую практику по теме урока
- AI = draft + action, а не generic chat
- Это UX-fix: ученик при возврате в ДЗ может оказаться на уже завершённой задаче

Сначала обязательно прочитай:
1. docs/delivery/features/guided-chat/task-lock-spec.md — секция 5.1, CHANGE-4
2. CLAUDE.md

Задача:
В файле src/components/homework/GuidedHomeworkWorkspace.tsx:

1. Найди useEffect инициализации (около строки 391), где setCurrentTaskOrder(thread.current_task_order).

2. Сразу ПОСЛЕ setCurrentTaskOrder(thread.current_task_order) добавь fallback:
   const states = thread.homework_tutor_task_states ?? [];
   const targetState = states.find((s) => s.task_order === thread.current_task_order);
   if (targetState?.status === 'completed') {
     const firstActive = states
       .filter((s) => s.status === 'active')
       .sort((a, b) => a.task_order - b.task_order)[0];
     if (firstActive) {
       setCurrentTaskOrder(firstActive.task_order);
     }
   }

3. НЕ убирай setCurrentTaskOrder(thread.current_task_order) — он нужен как default. Fallback только перезаписывает если target completed.

Acceptance Criteria (из спеки):
- AC-5a: Given: ученик работал над задачей 5, закрыл браузер. When: ученик снова открывает guided ДЗ. Then: открывается задача 5 (из thread.current_task_order).
- AC-5b: Given: current_task_order в БД = 3, но задача 3 уже completed. When: ученик открывает guided ДЗ. Then: открывается первая active задача (не completed задача 3).

Guardrails:
- Не расширяй scope — только useEffect инициализации в этом одном файле
- Не меняй handleCheckAnswer или handleHint
- Не меняй backend
- Safari 15+: не используй Array.at()

В конце обязательно:
1. Перечисли changed files
2. Дай краткий summary реализации
3. Покажи validation results: npm run lint
4. Напиши, какие документы нужно обновить после этой реализации
5. Self-check: реализация не противоречит docs 16 (UX principles) и 17 (UI patterns)
```

---

## TASK-5: TaskStepper — celebration animation (R4)

**Job:** R4 visual confirmation
**Agent:** Claude Code
**Files:** `src/components/homework/TaskStepper.tsx`, `src/components/homework/GuidedHomeworkWorkspace.tsx`
**AC:** AC-3, AC-4
**Зависимости:** нет (параллельно с TASK-1..4)

### Что делать

Добавить prop `celebratingTaskOrder` в TaskStepper. При совпадении — зелёное кольцо, scale, bouncing ✓ badge. Передать prop из GuidedHomeworkWorkspace.

### Промпт для агента

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ
- wedge: быстро собрать ДЗ и новую практику по теме урока
- AI = draft + action, а не generic chat
- Это R4 visual confirmation: при правильном ответе ученик видит 1200ms зелёную анимацию на степпере

Сначала обязательно прочитай:
1. docs/delivery/features/guided-chat/task-lock-spec.md — секция 5.1, CHANGE-5
2. CLAUDE.md
3. .claude/rules/performance.md (запрет framer-motion в UI-компонентах)
4. .claude/rules/80-cross-browser.md

Задача:

Файл 1: src/components/homework/TaskStepper.tsx

1. Добавь новый optional prop в interface:
   celebratingTaskOrder?: number | null;

2. В рендеринге каждого step item, добавь condition:
   const isCelebrating = task.order_num === celebratingTaskOrder;

3. Когда isCelebrating:
   - Добавь на контейнер step: ring-2 ring-green-500 scale-110 bg-green-50 (добавь transition-all duration-300)
   - Добавь overlay badge:
     {isCelebrating && (
       <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-green-500 text-white text-[10px] animate-bounce">
         ✓
       </span>
     )}
   - Убедись что step container имеет relative для позиционирования badge

Файл 2: src/components/homework/GuidedHomeworkWorkspace.tsx

4. Передай celebratingTaskOrder prop в TaskStepper в active chat view (около строки 1316).
   НЕ передавай в completed view (около строки 1298).

Acceptance Criteria (из спеки):
- AC-3 (visual part): Given: ученик правильно ответил на задачу 3. Then: (1) задача 3 получает зелёную анимацию (ring + scale + bounce ✓) на ~1200ms, (2) после анимации задача 3 = completed (зелёная галка).
- AC-4 (visual part): Given: ученик правильно ответил на последнюю задачу. Then: задача получает зелёную анимацию, ученик остаётся на ней.

Guardrails:
- НЕ добавляй framer-motion — ТОЛЬКО Tailwind CSS utilities и animate-bounce (performance.md)
- touch-action: manipulation на clickable elements (если ещё нет)
- Safari 15+: animate-bounce и transition-all с scale работают — проверено
- НЕ трогай логику handleCheckAnswer (это TASK-2)
- Step container должен быть relative (для absolute badge)

В конце обязательно:
1. Перечисли changed files
2. Дай краткий summary реализации
3. Покажи validation results: npm run lint
4. Напиши, какие документы нужно обновить после этой реализации
5. Self-check: реализация не противоречит docs 16 (UX principles) и 17 (UI patterns)
```

---

## TASK-6: Race guard — block navigation during celebration

**Job:** S1-2 (prevent confusion during transition)
**Agent:** Claude Code
**Files:** `src/components/homework/GuidedHomeworkWorkspace.tsx`
**AC:** AC-6
**Зависимости:** TASK-2, TASK-5

### Что делать

Добавить `celebratingTaskOrder !== null` в race guard `handleTaskClick`.

### Промпт для агента

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ
- wedge: быстро собрать ДЗ и новую практику по теме урока
- AI = draft + action, а не generic chat
- Это UX-guard: во время 1200ms celebration анимации ученик не должен мочь перепрыгнуть на другую задачу

Сначала обязательно прочитай:
1. docs/delivery/features/guided-chat/task-lock-spec.md — секция 5.1, CHANGE-6
2. CLAUDE.md

Задача:
В файле src/components/homework/GuidedHomeworkWorkspace.tsx:

1. Найди handleTaskClick (около строки 1087). Текущий guard:
   if (isStreaming || isCheckingAnswer || isRequestingHint || isUploading) return;

2. Добавь condition:
   if (isStreaming || isCheckingAnswer || isRequestingHint || isUploading || celebratingTaskOrder !== null) return;

3. Добавь celebratingTaskOrder в dependency array useCallback для handleTaskClick.

Acceptance Criteria (из спеки):
- AC-6: Given: ученик только что правильно ответил, зелёная анимация активна (celebratingTaskOrder !== null). When: ученик пытается нажать на другую задачу в TaskStepper. Then: нажатие игнорируется до завершения анимации (1200ms).

Guardrails:
- Минимальное изменение — только handleTaskClick race guard
- Не меняй handleCheckAnswer или handleHint
- Не добавляй новые зависимости

В конце обязательно:
1. Перечисли changed files
2. Дай краткий summary реализации
3. Покажи validation results: npm run lint
4. Напиши, какие документы нужно обновить после этой реализации
5. Self-check: реализация не противоречит docs 16 (UX principles) и 17 (UI patterns)
```

---

## TASK-7: setTimeout cleanup — useRef для timer

**Job:** Engineering hygiene
**Agent:** Claude Code
**Files:** `src/components/homework/GuidedHomeworkWorkspace.tsx`
**AC:** (implicit — prevent memory leaks)
**Зависимости:** TASK-2

### Что делать

Добавить `useRef` для celebration timer и `useEffect` cleanup, чтобы `setTimeout` не сработал после unmount компонента.

### Промпт для агента

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ
- wedge: быстро собрать ДЗ и новую практику по теме урока
- Это engineering cleanup: prevent memory leak от celebration setTimeout при unmount

Сначала обязательно прочитай:
1. docs/delivery/features/guided-chat/task-lock-spec.md — общий контекст
2. CLAUDE.md

Задача:
В файле src/components/homework/GuidedHomeworkWorkspace.tsx:

1. Добавь ref для timer:
   const celebrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

2. В handleCheckAnswer, везде где setTimeout(() => { setCelebratingTaskOrder(null); ... }, 1200), замени на:
   celebrationTimerRef.current = setTimeout(() => {
     setCelebratingTaskOrder(null);
     // ... switchToTask if applicable
   }, 1200);

3. Добавь cleanup useEffect:
   useEffect(() => {
     return () => {
       if (celebrationTimerRef.current) {
         clearTimeout(celebrationTimerRef.current);
       }
     };
   }, []);

4. Также clear timer при ручном переключении задачи — в switchToTask:
   if (celebrationTimerRef.current) {
     clearTimeout(celebrationTimerRef.current);
     celebrationTimerRef.current = null;
     setCelebratingTaskOrder(null);
   }

Guardrails:
- Используй ReturnType<typeof setTimeout> для типа (не NodeJS.Timeout — это Node, не browser)
- Не меняй логику celebration/advance — только добавь ref + cleanup
- Safari 15+: setTimeout + clearTimeout работают одинаково

В конце обязательно:
1. Перечисли changed files
2. Дай краткий summary реализации
3. Покажи validation results: npm run lint
4. Напиши, какие документы нужно обновить после этой реализации
5. Self-check: реализация не противоречит docs 16 (UX principles) и 17 (UI patterns)
```

---

## TASK-8: QA — валидация + кросс-браузер

**Job:** Quality gate
**Agent:** Claude Code
**Files:** нет изменений
**AC:** AC-1 через AC-7
**Зависимости:** TASK-1..7

### Что делать

Запустить validation pipeline. Проверить все AC вручную (описание smoke tests в спеке).

### Промпт для агента

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ
- Это финальная QA-проверка P0 UX-fix для guided chat: ученик перебрасывался на другую задачу при check/hint

Сначала обязательно прочитай:
1. docs/delivery/features/guided-chat/task-lock-spec.md — секция 7 (Acceptance Criteria)
2. CLAUDE.md
3. .claude/rules/80-cross-browser.md (Safari compatibility)

Задача:

1. Запусти validation:
   npm run lint && npm run build && npm run smoke-check

2. Если lint/build ошибки — исправь и повтори.

3. Прочитай финальный diff: git diff — убедись что:
   - Нет изменений в supabase/functions/homework-api/index.ts (backend не в scope)
   - Нет изменений в src/lib/studentHomeworkApi.ts (API client не в scope)
   - Нет framer-motion import (запрет из performance.md)
   - Нет Array.at(), structuredClone(), crypto.randomUUID(), Object.hasOwn() (Safari < 15.4)
   - Нет RegExp lookbehind (?<=...) (Safari < 16.4)

4. Проверь список изменённых файлов — должно быть ровно 2:
   - src/components/homework/GuidedHomeworkWorkspace.tsx
   - src/components/homework/TaskStepper.tsx

5. Верифицируй каждый AC по diff:
   - AC-1: syncThreadDataOnly вызывается в handleCheckAnswer — НЕ меняет currentTaskOrder
   - AC-2: syncThreadDataOnly вызывается в handleHint — НЕ меняет currentTaskOrder
   - AC-3: handleCheckAnswer при CORRECT → setCelebratingTaskOrder → setTimeout 1200ms → switchToTask(nextActive)
   - AC-4: handleCheckAnswer при thread_completed → celebration без auto-advance, toast «Все задачи завершены!»
   - AC-5: useEffect инициализации → fallback на first active если current_task_order → completed
   - AC-6: handleTaskClick guard включает celebratingTaskOrder !== null
   - AC-7: нет запрещённых API (проверено в п.3)

Acceptance Criteria (все 7 из спеки):
- AC-1: Wrong answer → stay on task 5
- AC-2: Hint → stay on task 5
- AC-3: Correct → celebrate 1200ms + auto-advance to next active
- AC-4: All completed → celebrate + stay on last task
- AC-5: Restore-on-load → last task or first active (if completed)
- AC-6: Race guard → no navigation during celebration
- AC-7: Cross-browser Safari 15+ / Chrome 90+

6. Если всё OK — PASS. Если ошибки — перечисли конкретно с номером AC.

В конце обязательно:
1. Перечисли changed files
2. Дай краткий summary: какие AC прошли, какие нет
3. Покажи validation results
4. Напиши, какие документы нужно обновить:
   - .claude/rules/40-homework-system.md (добавить секцию про task-lock fix)
   - docs/delivery/features/guided-chat/task-lock-spec.md (обновить статус)
5. Self-check: реализация не противоречит docs 16 (UX principles) и 17 (UI patterns)
```

---

## Сводка: Task → AC mapping

| Task | AC покрытие | Файл |
|------|-------------|------|
| TASK-1 | AC-1, AC-2 (prerequisite) | GuidedHomeworkWorkspace.tsx |
| TASK-2 | AC-1, AC-3, AC-4 | GuidedHomeworkWorkspace.tsx |
| TASK-3 | AC-2 | GuidedHomeworkWorkspace.tsx |
| TASK-4 | AC-5 | GuidedHomeworkWorkspace.tsx |
| TASK-5 | AC-3, AC-4 (visual) | TaskStepper.tsx + GuidedHomeworkWorkspace.tsx |
| TASK-6 | AC-6 | GuidedHomeworkWorkspace.tsx |
| TASK-7 | (cleanup) | GuidedHomeworkWorkspace.tsx |
| TASK-8 | AC-1..AC-7 | validation only |

Все 7 AC покрыты. AC-7 (кросс-браузер) проверяется в TASK-8 через lint/build + запрещённые паттерны.
