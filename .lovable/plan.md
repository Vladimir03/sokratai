# План: Деплой Edge Functions и настройка cron

## ✅ ВЫПОЛНЕНО

### 1. `telegram-bot` — обработчик payment callbacks
Функция `handlePaymentCallback` уже была реализована (строки 2375-2450):
- Парсит `payment:status:lessonId`
- Вызывает RPC `update_lesson_payment`
- Редактирует сообщение, убирая кнопки

### 2. `payment-reminder` — отправка напоминаний
Функция полностью реализована и задеплоена.

### 3. Деплой Edge Functions ✅
- `telegram-bot` — задеплоен
- `payment-reminder` — задеплоен

### 4. Cron-job ✅
Создан cron job `payment-reminder-job`:
- Запускается каждые 5 минут (`*/5 * * * *`)
- Вызывает `payment-reminder` Edge Function

---

## Тестирование

1. Создать занятие и отметить его как `completed`
2. Включить `payment_reminder_enabled` в настройках календаря
3. Убедиться что `telegram_id` репетитора заполнен
4. Подождать 5 минут (или вызвать функцию вручную)
5. Проверить что пришло сообщение в Telegram с кнопками
6. Нажать кнопку — проверить что статус обновился в БД

