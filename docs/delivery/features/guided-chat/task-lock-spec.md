# Feature Spec: Guided Chat — Task Lock (фиксация задачи при check/hint)

**Версия:** v0.1
**Дата:** 2026-04-01
**Автор:** Vladimir × Claude (Cowork)
**Статус:** implemented
**PRD:** `docs/delivery/features/guided-chat/task-lock-prd.md`
**Ticket:** #2 из batch Егора (P0)

---

## 0. Job Context (обязательная секция)

### Какую работу закрывает эта фича?

| Участник | Core Job | Sub-job | Ссылка на Граф |
|---|---|---|---|
| Школьник (B2C) | S1: Получить подсказку при застревании | S1-2: Выбрать правильный подход к решению | job-graph.md#S1 |
| Репетитор (B2B) | R2: Мониторинг прогресса | R2-3: Утренний обзор AI-сессий учеников | job-graph.md#R2 |

### Wedge-связка

- **B2B-сегмент:** Репетиторы физики ЕГЭ/ОГЭ с 10+ учениками
- **Wedge alignment:** Косвенно — если guided mode раздражает, ученики бросают ДЗ → репетитор не видит ценности → churn → pilot failure

### Pilot impact

UX-блокер guided mode. Ученики Егора теряют контекст задачи при каждом check/hint. Без фикса guided mode непригоден для повседневного использования → 0% weekly active на guided ДЗ.

---

## 1. Summary

При проверке ответа или запросе подсказки в guided mode ученик перебрасывается на другую задачу вместо того, чтобы остаться на текущей. Причина — `syncThreadFromResponse()` безусловно синхронизирует `currentTaskOrder` с `current_task_order` из БД, игнорируя выбор ученика. Фикс: разделить sync данных (messages, task_states) и sync навигации (currentTaskOrder). Навигация меняется только при task completion или явном действии ученика.

Дополнительно: после правильного ответа — визуальное подтверждение (зелёная анимация) с паузой перед авто-переходом.

---

## 2. Problem

### Текущее поведение

1. Ученик открывает задачу 5 в guided chat
2. Отправляет ответ (неверный) или просит подсказку
3. Frontend вызывает `checkAnswer(threadId, answer, taskOrder=5)` — корректно
4. Backend возвращает ответ + `updatedThread` с `current_task_order = 3` (из БД)
5. `syncThreadFromResponse()` на строке 739/981 перезаписывает `currentTaskOrder = 3`
6. Ученик перебрасывается на задачу 3

### Боль

Ученик теряет контекст задачи, над которой работает. Вынужден каждый раз вручную возвращаться. На ДЗ из 15+ задач это критично — ученик бросает.

### Текущие «нанятые» решения

Ученик вручную нажимает на нужную задачу в TaskStepper после каждого перебрасывания. Workaround неприемлемый — ломает UX.

---

## 3. Solution

### Описание

Разделить `syncThreadFromResponse()` на две независимые операции:
- **Data sync**: обновить messages, task_states, thread status — всегда
- **Navigation sync**: изменить `currentTaskOrder` — только при task completion

### Ключевые решения

**KD-1: Frontend-first navigation.** `currentTaskOrder` управляется только двумя источниками: (a) ученик нажал на задачу в TaskStepper, (b) текущая задача завершена → авто-переход на следующую active. Backend `current_task_order` используется только при mount (restore-on-load).

**KD-2: Auto-advance с визуальной паузой.** После `verdict === 'CORRECT'` — 1200ms пауза с зелёной анимацией на TaskStepper, затем авто-переход. Пауза даёт ученику время увидеть «правильно» и прочитать начало AI-feedback.

**KD-3: Backend не меняется.** `performTaskAdvance` продолжает обновлять `current_task_order` в БД — это нужно для restore-on-load. API contract неизменен.

### Scope

**In scope:**
- Рефакторинг `syncThreadFromResponse` → отделение data sync от navigation sync
- Auto-advance при correct с delay и визуальным feedback (R4)
- Restore-on-load при mount из `thread.current_task_order`
- Backend `current_task_order` update после correct (для restore)

**Out of scope:**
- Изменения backend `homework-api/index.ts`
- Изменения `studentHomeworkApi.ts` (API client)
- Редизайн TaskStepper
- Analytics порядка решения задач
- «Мягкое предложение» вернуться к пропущенным задачам

---

## 4. User Stories

### Школьник

> Когда я решаю задачу 5 и отправляю неверный ответ, я хочу остаться на задаче 5 и увидеть feedback по ней, чтобы продолжить работу без потери контекста.

> Когда я прошу подсказку по задаче 5, я хочу увидеть подсказку на экране задачи 5, а не быть переброшенным на другую задачу.

> Когда я правильно отвечаю на задачу, я хочу увидеть визуальное подтверждение успеха и плавный переход к следующей задаче.

> Когда я возвращаюсь к ДЗ после закрытия браузера, я хочу оказаться на последней задаче, над которой работал.

---

## 5. Technical Design

### Затрагиваемые файлы

| Файл | Изменение | Строки (approx) |
|------|-----------|------------------|
| `src/components/homework/GuidedHomeworkWorkspace.tsx` | Рефакторинг `syncThreadFromResponse`, добавление `syncDataOnly`, логика auto-advance с delay, CSS-класс для correct animation | L435-462, L706-808, L968-1010 |
| `src/components/homework/TaskStepper.tsx` | Новый prop `celebratingTaskOrder` для анимации correct | L24-28 (interface) |

### Файлы НЕ в scope

| Файл | Причина |
|------|---------|
| `supabase/functions/homework-api/index.ts` | Backend корректен, `performTaskAdvance` нужен для restore |
| `src/lib/studentHomeworkApi.ts` | API client корректно передаёт `task_order` |
| `src/hooks/useStudentHomework.ts` | Не затрагивается — thread data приходит через React Query |

### Data Model

Без изменений. Нет новых таблиц, колонок или RPC.

### API

Без изменений. Response format `CheckAnswerResponse` и `RequestHintResponse` сохраняется.

### Миграции

Нет.

---

### 5.1 Детальный technical design

#### CHANGE-1: Разделение `syncThreadFromResponse` на data sync и full sync

**Текущий код (L435-462):**
```typescript
const syncThreadFromResponse = useCallback((updatedThread: HomeworkThread) => {
  // ...normalize messages, set task states...
  const newOrder = updatedThread.current_task_order;
  setCurrentTaskOrder((prevOrder) => {
    if (prevOrder !== newOrder) {
      // ...save/restore drafts...
    }
    return newOrder; // ← BUG: перезаписывает выбор ученика
  });
  setThreadCurrentTaskOrder(newOrder);
  setThreadStatus(updatedThread.status);
}, []);
```

**Новый код:**

```typescript
/**
 * Sync thread DATA (messages, task_states, status) without changing navigation.
 * Called after check/hint responses — student stays on their chosen task.
 */
const syncThreadDataOnly = useCallback((updatedThread: HomeworkThread) => {
  const normalizedMessages = (updatedThread.homework_tutor_thread_messages ?? []).map((msg) => ({
    ...msg,
    message_delivery_status: toDeliveryStatus(msg.message_delivery_status),
  }));
  setMessages(normalizedMessages);
  setTaskStates(updatedThread.homework_tutor_task_states ?? []);
  setThreadCurrentTaskOrder(updatedThread.current_task_order);
  setThreadStatus(updatedThread.status);
}, []);
```

**Убираем старый `syncThreadFromResponse` полностью.** Навигация будет управляться отдельной логикой в `handleCheckAnswer`.

#### CHANGE-2: Обновление `handleCheckAnswer` — auto-advance при correct с delay

**Текущий код (L739):**
```typescript
syncThreadFromResponse(response.thread);
```

**Новый код:**
```typescript
// Sync data (messages, task_states) — student stays on current task
syncThreadDataOnly(response.thread);

if (response.verdict === 'CORRECT') {
  // R4: Visual celebration on TaskStepper
  setCelebratingTaskOrder(taskOrder);

  // Find next active task for auto-advance
  const updatedStates = response.thread.homework_tutor_task_states ?? [];
  const nextActive = updatedStates
    .filter((s) => s.status === 'active' && s.task_order !== taskOrder)
    .sort((a, b) => {
      // Prefer tasks after current, then wrap around
      const aKey = a.task_order > taskOrder ? a.task_order : a.task_order + 1000;
      const bKey = b.task_order > taskOrder ? b.task_order : b.task_order + 1000;
      return aKey - bKey;
    })[0];

  if (response.thread_completed) {
    toast.success('Все задачи завершены!');
    // No auto-advance — student stays on last task, sees completed view
    setTimeout(() => setCelebratingTaskOrder(null), 1200);
  } else if (nextActive) {
    toast.success('Правильно! Переходим к следующей задаче.');
    // Delay auto-advance for visual feedback (R4)
    setTimeout(() => {
      setCelebratingTaskOrder(null);
      switchToTask(nextActive.task_order);
    }, 1200);
  } else {
    // No more active tasks but thread not complete? Stay on current.
    setTimeout(() => setCelebratingTaskOrder(null), 1200);
  }
} else if (response.verdict === 'ON_TRACK') {
  // Student stays on current task — no navigation change
  // ... existing tracking code ...
} else {
  // INCORRECT / CHECK_FAILED — student stays on current task
  // ... existing tracking/toast code ...
}
```

**Новый state:**
```typescript
const [celebratingTaskOrder, setCelebratingTaskOrder] = useState<number | null>(null);
```

#### CHANGE-3: Обновление `handleHint` — data sync only

**Текущий код (L981):**
```typescript
syncThreadFromResponse(response.thread);
```

**Новый код:**
```typescript
syncThreadDataOnly(response.thread);
```

Одна строка — замена вызова. Ученик остаётся на текущей задаче.

#### CHANGE-4: Restore-on-load (без изменений)

Текущий `useEffect` на L391-408 уже корректен:
```typescript
useEffect(() => {
  if (thread) {
    // ...
    setCurrentTaskOrder(thread.current_task_order);
    // ...
  }
}, [thread]);
```

Это единственное место, где backend `current_task_order` легитимно управляет навигацией. **Не менять.**

Дополнение: если `current_task_order` указывает на completed задачу, перенаправить на первую active:

```typescript
useEffect(() => {
  if (thread) {
    // ...existing code...
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
    // ...
  }
}, [thread]);
```

#### CHANGE-5: TaskStepper — celebration animation (R4)

**Новый prop в `TaskStepper.tsx`:**
```typescript
interface TaskStepperProps {
  tasks: TaskStepItem[];
  currentTaskOrder: number;
  onTaskClick?: (orderNum: number) => void;
  celebratingTaskOrder?: number | null; // NEW
}
```

**Rendering logic (inside step item):**
```tsx
const isCelebrating = task.order_num === celebratingTaskOrder;

<div
  className={cn(
    'transition-all duration-300',
    isCelebrating && 'ring-2 ring-green-500 scale-110 bg-green-50',
  )}
>
  {/* existing step content */}
  {isCelebrating && (
    <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-green-500 text-white text-[10px] animate-bounce">
      ✓
    </span>
  )}
</div>
```

**CSS rules:**
- Используем только Tailwind utility classes + `animate-bounce` (встроенная CSS animation)
- **Нет framer-motion** (запрет из `performance.md`)
- `transition-all duration-300` для плавного scale/ring перехода
- `animate-bounce` для ✓ badge — привлекает внимание без тяжёлой библиотеки

#### CHANGE-6: Race guard update

`celebratingTaskOrder` добавить в race guard `handleTaskClick`:

```typescript
const handleTaskClick = useCallback((orderNum: number) => {
  if (!visitedTaskOrders.has(orderNum)) return;
  if (isStreaming || isCheckingAnswer || isRequestingHint || isUploading) return;
  if (celebratingTaskOrder !== null) return; // Block navigation during celebration
  switchToTask(orderNum);
}, [visitedTaskOrders, isStreaming, isCheckingAnswer, isRequestingHint, isUploading, celebratingTaskOrder, switchToTask]);
```

---

## 6. UX / UI

### Wireframe

Нет изменений в layout. Единственное визуальное изменение — кратковременная зелёная анимация на TaskStepper step при correct.

**Состояния TaskStepper step:**
```
[default]    → серый круг с номером
[active]     → синее кольцо (текущая задача)
[completed]  → зелёный круг с галкой
[celebrating]→ зелёное кольцо + scale 110% + bouncing ✓ badge (1200ms)
```

### UX-принципы (из doc 16)

- **Принцип 1 (Jobs-first):** ученик хочет решить конкретную задачу — система не должна его перебрасывать
- **Принцип «AI = draft + action»:** AI feedback привязан к конкретной задаче, не к абстрактному чату
- **Антипаттерн из doc 16:** «Показать AI» → мы показываем результат работы (feedback по задаче 5), а не заставляем ученика искать его

### UI-паттерны (из doc 17)

- `touch-action: manipulation` на TaskStepper steps (уже есть)
- `font-size: 16px`+ на input полях (уже есть, не затрагиваем)
- CSS transitions вместо framer-motion (ОБЯЗАТЕЛЬНО)

---

## 7. Acceptance Criteria (testable)

### AC-1: Неверный ответ — ученик остаётся на задаче

**Given:** ученик на задаче 5 (currentTaskOrder = 5), задача 3 не решена
**When:** ученик отправляет неверный ответ на задачу 5
**Then:** ученик остаётся на задаче 5, видит AI-feedback по задаче 5, TaskStepper показывает кольцо на задаче 5

**Smoke test:**
```
1. Открыть guided ДЗ с 5+ задачами
2. Перейти на задачу 5 (минуя 3)
3. Ввести заведомо неверный ответ → Enter
4. Проверить: активная задача = 5, feedback виден в чате задачи 5
```

### AC-2: Подсказка — ученик остаётся на задаче

**Given:** ученик на задаче 5
**When:** ученик запрашивает подсказку (кнопка «Подсказка»)
**Then:** ученик остаётся на задаче 5, видит подсказку в чате задачи 5

**Smoke test:**
```
1. Открыть guided ДЗ, перейти на задачу 5
2. Нажать «Подсказка»
3. Проверить: активная задача = 5, подсказка видна в чате задачи 5
```

### AC-3: Правильный ответ — celebrate + auto-advance

**Given:** ученик на задаче 3, задача 4 не решена (active)
**When:** ученик отправляет правильный ответ на задачу 3
**Then:**
1. Задача 3 получает зелёную анимацию (ring + scale + bounce ✓) на ~1200ms
2. Toast «Правильно! Переходим к следующей задаче.»
3. Через 1200ms ученик переключается на задачу 4 (ближайшая active)
4. TaskStepper: задача 3 = completed (зелёная галка), задача 4 = active (кольцо)

**Smoke test:**
```
1. Открыть guided ДЗ, ответить правильно на задачу 3
2. Проверить: зелёная анимация на степпере ~1 секунду
3. Проверить: автопереход на задачу 4
4. Проверить: задача 3 отмечена completed
```

### AC-4: Все задачи завершены

**Given:** осталась одна незавершённая задача (задача 7)
**When:** ученик отправляет правильный ответ на задачу 7
**Then:**
1. Задача 7 получает зелёную анимацию
2. Toast «Все задачи завершены!»
3. Ученик остаётся на задаче 7 (нет куда переходить)
4. Показывается completed view

### AC-5: Restore-on-load

**Given:** ученик работал над задачей 5, закрыл браузер
**When:** ученик снова открывает guided ДЗ
**Then:** открывается задача 5 (из `thread.current_task_order`)

**Given:** `current_task_order` в БД = 3, но задача 3 уже completed
**When:** ученик открывает guided ДЗ
**Then:** открывается первая active задача (не completed задача 3)

### AC-6: Race guard — нет навигации во время celebration

**Given:** ученик только что правильно ответил, зелёная анимация активна
**When:** ученик пытается нажать на другую задачу в TaskStepper
**Then:** нажатие игнорируется до завершения анимации (1200ms)

### AC-7: Кросс-браузер

**Given:** Safari 15+ (macOS/iOS) и Chrome 90+
**When:** все AC-1 через AC-6
**Then:** поведение идентично

**Специфичные проверки:**
- CSS `animate-bounce` работает в Safari 15+
- `transition-all` с `scale` работает в Safari 15+
- `setTimeout` 1200ms работает корректно при tab-in-background (Safari throttling)

---

## 8. Validation

### Как проверяем успех?

| Метрика | Порог | Как измерить |
|---------|-------|--------------|
| Жалобы на перебрасывание | 0 за 2 недели | Feedback от Егора |
| Guided ДЗ completion rate | +10-20% vs baseline | `homework_tutor_threads WHERE status = 'completed'` / total |
| Среднее кол-во решённых задач | рост | `homework_tutor_task_states WHERE status = 'completed'` per thread |

### Связь с pilot KPI (из doc 18)

- **70% weekly active:** fix устраняет UX-блокер → ученики не бросают guided ДЗ → active usage растёт
- **«Saves time» language:** если guided mode работает гладко → репетитор не тратит время на разбор жалоб учеников
- **50% renewal intent:** broken guided mode = 0 value from guided ДЗ → фикс = prerequisite для renewal

### Smoke check

```bash
npm run lint && npm run build && npm run smoke-check
```

---

## 9. Risks & Open Questions

### Risks

| Риск | Вероятность | Митигация | Статус |
|------|-------------|-----------|--------|
| `setTimeout` 1200ms throttled в Safari background tab → ученик ждёт дольше | Низкая | Safari throttles setTimeout to 1000ms min в background — delay будет ~1-2s, допустимо | accepted |
| Ученик привык к auto-navigate и ожидает его на non-correct → confusion | Низкая | Баг, а не фича — ученики жалуются, не просят вернуть | accepted |
| Другие компоненты читают `threadCurrentTaskOrder` и ожидают sync | Низкая | Grep codebase — `threadCurrentTaskOrder` используется только для comparison, не для navigation | accepted |
| `celebratingTaskOrder` setTimeout cleanup при unmount | Средняя | `useEffect` cleanup: `return () => clearTimeout(timerRef)` | **mitigated** — `celebrationTimerRef` + cleanup useEffect + clear on manual switch |

### Открытые вопросы

1. **[Engineering, non-blocking]** Нужно ли обновлять `current_task_order` в БД при ручном переключении задачи учеником (для лучшего restore-on-load)?
   → Предварительно: нет. `performTaskAdvance` уже обновляет при completion. Ручное переключение — легковесное, не стоит дополнительного API call.

2. **[Product, non-blocking]** Оптимальная длительность celebration delay: 800ms vs 1200ms vs 1500ms?
   → Начать с 1200ms, скорректировать по feedback Егора.

---

## 10. Implementation Tasks

> Переносятся в `task-lock-tasks.md` после approve спека.

- [x] **TASK-1:** Создать `syncThreadDataOnly` — data sync без navigation (CHANGE-1)
- [x] **TASK-2:** Обновить `handleCheckAnswer` — data sync + auto-advance с delay при correct (CHANGE-2)
- [x] **TASK-3:** Обновить `handleHint` — data sync only (CHANGE-3)
- [x] **TASK-4:** Обновить restore-on-load — fallback на first active если `current_task_order` → completed (CHANGE-4)
- [x] **TASK-5:** TaskStepper `celebratingTaskOrder` prop + CSS animation (CHANGE-5)
- [x] **TASK-6:** Race guard — block navigation during celebration (CHANGE-6)
- [x] **TASK-7:** setTimeout cleanup — useRef + useEffect cleanup для timer (`celebrationTimerRef` + cleanup useEffect + clear on switchToTask)
- [ ] **TASK-8:** QA — протестировать все AC в Chrome + Safari

---

## Checklist перед approve

- [x] Job Context заполнен (секция 0)
- [x] Привязка к Core Job из Графа работ (S1-2, R2-3)
- [x] Scope чётко определён (in/out)
- [x] UX-принципы из doc 16 учтены (Jobs-first, AI=draft+action)
- [x] UI-паттерны из doc 17 учтены (touch-action, no framer-motion)
- [x] Pilot impact описан (UX-блокер, prerequisite для renewal)
- [x] Метрики успеха определены (completion rate, 0 жалоб)
- [x] High-risk файлы не затрагиваются (Chat.tsx, AuthGuard — не в scope)
- [x] Student/Tutor изоляция не нарушена (только student homework компоненты)
- [x] No framer-motion в homework компонентах (CSS only)
- [x] Safari 15+ совместимость проверена (animate-bounce, transition-all)
