## 1.4 Полный flow (Telegram → Storage → Vision → AI → результат)
**Цель**: собрать end‑to‑end сценарий сдачи домашки учеником с записью в БД и выдачей результатов.

### In‑scope
- `supabase/functions/telegram-bot/homework/homework_handler.ts`
- Inline keyboard UX
- Запись в Storage `homework-images`
- Запись результатов в `homework_submissions` + `homework_submission_items`
- Итоговый формат результатов

### UX (Telegram)
1) `/homework` → список активных ДЗ (кнопки `hw_start:{assignment_id}`).
2) Выбор ДЗ → показать задачу 1 + кнопки: `[📷 Фото]` (инструкция), `[Далее]` (disabled пока нет ответа), `[Отмена]`.
3) Пользователь отправляет фото/текст → подтверждение, кнопка `[Далее]`.
4) На последней задаче → `[✅ Отправить на проверку]`.
5) После AI‑проверки → сообщение с результатом + кнопка `[🧠 Разобрать ошибки]` (sprint 3).

### Основные функции
- `handleHomeworkCommand(user)` → список ДЗ
- `handleHomeworkSelection(assignment_id, user)` → создать/получить submission, показать задачу 1
- `handlePhotoSubmission(message)` → скачать файл Telegram, сохранить в Storage, обновить submission_item
- `handleTextSubmission(message)` → сохранить текст
- `handleNextTask(callback)` → следующая задача
- `runAICheck(submission_id)` → цикл по items: recognize→check→save→aggregate totals
- `formatResults(submission)` → итоговый текст

### Правила данных
- `homework_submissions` создаём при старте домашки (status `in_progress`).
- `homework_submission_items` создаём при первом показе задач (пустые) или по мере ответа.
- На `submit` фиксируем `submitted_at`, выставляем `submitted`, затем `ai_checked`.

### Ошибки/edge cases
- Ученик прислал >4 фото на задачу → показать предупреждение и игнорировать лишнее.
- Нет ответа (ни фото, ни текст) → не давать перейти дальше.
- Ошибка AI‑вызова → статус `submitted`, но `ai_checked` не ставить; вернуть: «не удалось проверить, попробуйте позже».

### Приёмка
- Полный сценарий проходит на тестовом assignment.
- Файлы появляются в Storage по конвенции пути.
- Итог: `Итого X/Y`, по задачам ✅/❌ с коротким фидбеком.
- AI‑чат не сломан.

### Тест‑кейсы
- 3 задачи, 1 фото на каждую → сохранение и проверка
- 1 задача, текстовый ответ → проверка
- Отмена на середине → состояние сбрасывается, submission остаётся `in_progress`

### Инструкция для Codex/Claude
Реализуй `homework_handler.ts` и интеграцию в `index.ts` для callback `hw_*`. Сохрани совместимость с текущей архитектурой telegram‑бота. Добавь утилиты для скачивания Telegram файла и загрузки в Storage.

---

# Спринт 2 — API + push + уведомления
