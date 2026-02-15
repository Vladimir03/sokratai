## 1.2 State Machine в боте
**Цель**: добавить управляемый режим «Домашка» без поломки текущего AI‑чата.

### In‑scope
- Новый модуль: `supabase/functions/telegram-bot/homework/state_machine.ts`
- CRUD состояния в `user_bot_state`.
- Роутинг команд `/homework`, `/cancel` и callback `hw_*`.

### Out‑of‑scope
- Любая логика распознавания/AI проверки.

### Функциональные требования
Состояния:
- `IDLE` (default): текущий поведение бота (AI‑чат) без изменений.
- `HW_SELECTING`: пользователь выбирает домашку.
- `HW_SUBMITTING`: приём фото/текста для задачи.
- `HW_CONFIRMING`: подтверждение отправки/перехода к проверке.

Переходы:
- `/homework` в любом состоянии → перейти в `HW_SELECTING` (показываем список доступных ДЗ для student).
- callback `hw_start:{assignment_id}` → `HW_SUBMITTING` с контекстом `{assignment_id, task_index:1, submission_id, images:[], text:''}`.
- `HW_SUBMITTING`:
  - фото: сохранить в контекст (или сразу в storage) и показать кнопку `[Далее]`
  - текст: сохранить в контекст
  - `/cancel`: reset → `IDLE`
- callback `hw_next`:
  - если есть ещё задачи: `task_index++`
  - если задачи кончились: перейти в `HW_CONFIRMING`
- callback `hw_submit` в confirming: финализировать submission → запуск AI‑проверки (в 1.4) → `IDLE`

### Нефункциональные требования
- State operations должны быть idempotent.
- Таймаут/cleanup: если `updated_at` старше N часов, можно auto reset в `IDLE` (или в 2.3).
- Никакие handlers AI‑чата не меняются, кроме раннего `if state != IDLE → homework_handler`.

### Интерфейс state_machine.ts
- `getState(userId): Promise<{state: string, context: any}>`
- `setState(userId, state, context): Promise<void>`
- `resetState(userId): Promise<void>`

### Приёмка
- В `IDLE` чат работает как раньше.
- `/homework` открывает режим домашки.
- `/cancel` возвращает к обычному чату.
- Callback‑кнопки корректно переключают состояние.

### Тест‑кейсы
- Пользователь отправляет фото в `IDLE` → идёт в чат (как раньше).
- Пользователь в `HW_SUBMITTING` отправляет текст → сохраняется как ответ, чат‑ответы не генерируются.
- Пользователь нажал `/cancel` на любом шаге → состояние сброшено.

### Инструкция для Codex/Claude
Добавь модуль state machine + минимальные изменения в `supabase/functions/telegram-bot/index.ts` для роутинга по состоянию. Не трогай логику AI‑чата кроме безопасного раннего возврата/ветвления.

---
