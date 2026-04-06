# PRD: Guided Chat — Фиксация задачи при проверке и подсказке

**Статус:** Draft
**Дата:** 2026-04-01
**Автор:** Vladimir × Claude (Cowork)
**Ticket:** #2 из batch Егора (P0)

---

## 1. Job Context

- **Core Job:** S1 — Получить подсказку при застревании
- **Sub-job:** S1-2 — Выбрать правильный подход к решению
- **Segment:** Ученики репетиторов физики ЕГЭ/ОГЭ (13-18 лет)
- **Wedge alignment:** Косвенно — если guided mode раздражает, ученики бросают ДЗ → репетитор не видит ценности → churn
- **Pilot impact:** UX-блокер — ломает основной flow решения ДЗ. Ученики Егора жалуются.

---

## 2. Problem

Ученик работает над задачей 5 в guided mode. Он отправляет ответ (неверный) или просит подсказку. Вместо того чтобы остаться на задаче 5 и получить feedback по ней, система автоматически перебрасывает его на задачу 3, которую он ещё не решил.

**Цитата Егора:** «Нужно строго оставаться в рамках диалога по одной задаче. Если я не решил третью, но дал неверный ответ на пятую или спросил подсказку по пятой — он меня кидает на диалог по третьей задаче автоматически.»

**Workaround:** нет разумного workaround — ученик каждый раз вручную возвращается на задачу 5, теряя контекст и мотивацию.

**Цена бездействия:** высокий churn в guided mode. Если ученики бросают ДЗ, репетитор не видит результатов → не продлевает пилот.

---

## 3. Root Cause (диагностика кода)

Свободный порядок задач был реализован в Sprint 2026-03-19: backend принимает `task_order` от клиента, все `task_states` создаются как `active`. Однако **frontend синхронизация ломает свободный порядок**.

**Цепочка бага:**

1. Ученик на задаче 5 (`currentTaskOrder = 5`), отправляет ответ
2. Frontend вызывает `checkAnswer(threadId, answer, taskOrder=5)` — корректно
3. Backend обрабатывает ответ по задаче 5 — корректно
4. Backend возвращает полный `updatedThread`, включая `current_task_order` из БД
5. `current_task_order` в БД = 3 (установлено ранее при `provisionGuidedThread` или `performTaskAdvance`)
6. **Frontend `syncThreadFromResponse()` безусловно перезаписывает `currentTaskOrder` на значение из `updatedThread.current_task_order`** → ученик перебрасывается на задачу 3

**Проблемный код** (`GuidedHomeworkWorkspace.tsx`, `syncThreadFromResponse`):

```typescript
const newOrder = updatedThread.current_task_order; // ← слепо берёт из бэкенда
setCurrentTaskOrder((prevOrder) => {
  if (prevOrder !== newOrder) {
    // ... сохраняет draft, загружает draft другой задачи
  }
  return newOrder; // ← перезаписывает выбор ученика
});
```

**Затронутые paths:**
- `handleCheckAnswer` → `syncThreadFromResponse` (после проверки ответа)
- `handleHint` → `syncThreadFromResponse` (после запроса подсказки)

---

## 4. Solution

**Принцип:** `currentTaskOrder` на фронтенде — primary source of truth для навигации. Backend `current_task_order` — fallback для восстановления сессии, не для навигации.

**Что делаем:**

`syncThreadFromResponse()` больше не перезаписывает `currentTaskOrder` безусловно. Навигация на другую задачу происходит только когда:
- Текущая задача **завершена** (`verdict === 'correct'`) и у задачи `status` изменился на `completed`
- Ученик **сам** нажал на другую задачу в `TaskStepper`

Во всех остальных случаях (неверный ответ, подсказка, ошибка) — ученик остаётся на той задаче, над которой работает.

---

## 5. Scope

### IN (делаем)

- **Frontend fix:** `syncThreadFromResponse` не перезаписывает `currentTaskOrder`, если текущая задача не была только что завершена
- **Auto-advance при correct:** если ученик правильно ответил на задачу → предложить переход на следующую незавершённую задачу (soft navigation, не принудительный)
- **Restore-on-load:** при первой загрузке thread (refresh страницы) — использовать `current_task_order` из БД как initial state (это единственный легитимный case для backend-driven navigation)

### OUT (не делаем)

- Backend изменение `performTaskAdvance` — он продолжает обновлять `current_task_order` в БД (нужен для restore-on-load)
- Изменение API контракта `/threads/:id/check` и `/threads/:id/hint` — response format остаётся тот же
- UI redesign TaskStepper — он уже корректно показывает статусы задач
- Уведомление репетитору о порядке решения ученика — отдельная фича

### LATER (потом)

- Мягкое предложение «Задача 3 ещё не решена, хотите вернуться?» — after pilot, когда появятся данные о паттернах решения
- Analytics: трекинг порядка решения задач учеником — полезно, но не в scope P0 fix

---

## 6. User Stories

**Ученик решает ДЗ в свободном порядке:**

- Как ученик, я хочу получить feedback по задаче 5 и остаться на задаче 5, чтобы продолжить работать над ней, даже если задача 3 ещё не решена.

- Как ученик, я хочу попросить подсказку по задаче 5 и увидеть подсказку на экране задачи 5, а не быть переброшенным на другую задачу.

- Как ученик, после правильного ответа на задачу 5 я хочу видеть, что задача отмечена как завершённая, и выбрать следующую задачу самостоятельно.

**Ученик возвращается к ДЗ после перерыва:**

- Как ученик, когда я возвращаюсь к ДЗ после закрытия браузера, я хочу оказаться на последней задаче, над которой работал, чтобы не искать, где остановился.

---

## 7. Requirements

### Must-Have (P0)

**R1: Стабильная навигация при check/hint**
`syncThreadFromResponse` не меняет `currentTaskOrder` после получения ответа от `checkAnswer` и `requestHint`.

Acceptance criteria:
- [ ] Ученик на задаче 5 отправляет неверный ответ → остаётся на задаче 5, видит feedback по задаче 5
- [ ] Ученик на задаче 5 запрашивает подсказку → остаётся на задаче 5, видит подсказку по задаче 5
- [ ] `currentTaskOrder` не меняется при вызове `syncThreadFromResponse` для check/hint responses

**R2: Auto-advance при correct только на завершённую задачу**
Когда `checkAnswer` возвращает `verdict: 'correct'` и task_state текущей задачи стал `completed`, фронтенд переключает на следующую незавершённую задачу.

Acceptance criteria:
- [ ] Ученик на задаче 5 отправляет правильный ответ → задача 5 отмечена completed в TaskStepper
- [ ] Если есть незавершённые задачи — фронтенд переключает на ближайшую следующую active
- [ ] Если все задачи completed — ученик остаётся на последней завершённой, видит итоговое состояние

**R3: Restore-on-load**
При первой загрузке workspace (mount компонента) — `currentTaskOrder` инициализируется из `thread.current_task_order`.

Acceptance criteria:
- [ ] Ученик закрывает браузер на задаче 5 → backend `current_task_order = 5` → при повторном открытии видит задачу 5
- [ ] Если `current_task_order` указывает на completed задачу — показать первую active задачу

### Nice-to-Have (P1)

**R4: Визуальное подтверждение correct**
После правильного ответа — короткая визуальная индикация (зелёная галка, toast или анимация на TaskStepper step) перед авто-переходом, чтобы ученик понял, что задача завершена.

Acceptance criteria:
- [ ] При correct ответе ученик видит визуальный feedback минимум 800ms до переключения задачи
- [ ] Нет framer-motion в homework компонентах (CSS transition/animation only)

### Future (P2)

**R5: Soft suggestion вернуться к пропущенным**
После завершения задачи — если есть пропущенные (active, без сообщений) задачи с меньшим номером — показать ненавязчивое предложение вернуться.

---

## 8. Success Criteria

### Ведущие индикаторы (1-2 недели после fix)

| Метрика | Цель | Как измерить |
|---------|------|--------------|
| Жалобы на перебрасывание задач | 0 | Feedback от Егора |
| Completion rate guided ДЗ | +10-20% vs текущий | `homework_tutor_threads.status = 'completed'` / total threads |
| Среднее время на задачу | без резких скачков | timestamp delta в `thread_messages` |

### Запаздывающие индикаторы (3-4 недели)

| Метрика | Цель | Как измерить |
|---------|------|--------------|
| Ученики, решающие >80% задач в ДЗ | рост | task_states `completed` / total per thread |
| Повторное использование guided mode репетитором | стабильно или рост | assignments per week |

---

## 9. Risks

| Риск | Вероятность | Митигация |
|------|-------------|-----------|
| Auto-advance при correct может раздражать, если ученик хочет перечитать feedback | Средняя | R4 (визуальная пауза 800ms). Если жалобы — убрать auto-advance, оставить manual |
| `current_task_order` в БД рассинхронизируется с реальной позицией ученика | Низкая | Используем его только для restore-on-load, не для navigation |
| Другие места в коде читают `threadCurrentTaskOrder` state | Низкая | Проверить все references при реализации |

---

## 10. Technical Context (для Spec)

### Файлы в scope изменений

| Файл | Изменение |
|------|-----------|
| `src/components/homework/GuidedHomeworkWorkspace.tsx` | `syncThreadFromResponse` — убрать безусловную перезапись `currentTaskOrder`. Добавить логику: менять только при task completion |
| `src/components/homework/GuidedHomeworkWorkspace.tsx` | `handleCheckAnswer` — после correct verdict, определить next active task и навигировать |

### Файлы НЕ в scope

| Файл | Причина |
|------|---------|
| `supabase/functions/homework-api/index.ts` | Backend корректен — принимает `task_order`, обрабатывает правильно. `performTaskAdvance` обновляет `current_task_order` в БД — это ОК для restore |
| `src/lib/studentHomeworkApi.ts` | API клиент корректно передаёт `task_order` |
| `src/components/homework/TaskStepper.tsx` | Уже корректно отображает active/completed статусы |

---

*Следующий шаг pipeline: Step 4 (SPEC) → technical design + testable AC.*
