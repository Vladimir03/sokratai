

# План: Деплой Edge Functions и настройка cron

## Текущее состояние

### `payment-reminder` (готова ✅)
Функция полностью реализована:
- Вызывает RPC `get_lessons_needing_payment_reminder` 
- Отправляет Telegram-сообщения с inline-кнопками
- Помечает напоминания как отправленные через `mark_payment_reminder_sent`

### `telegram-bot` (требует доработки ⚠️)
Функция **НЕ обрабатывает** callback'и оплаты:
- `payment:paid:{lessonId}`
- `payment:paid_earlier:{lessonId}` 
- `payment:pending:{lessonId}`

Без этой обработки кнопки в Telegram-сообщениях **не будут работать**.

---

## План действий

### 1. Добавить обработку callback'ов оплаты в telegram-bot

Добавить в функцию `handleCallbackQuery` (после строки ~4500):

```typescript
// ============= PAYMENT CALLBACKS =============

if (data.startsWith("payment:")) {
  const parts = data.split(":");
  const action = parts[1]; // paid, paid_earlier, pending
  const lessonId = parts[2];
  
  // Вызываем RPC для обновления статуса
  const { data: success, error } = await supabase.rpc("update_lesson_payment", {
    _lesson_id: lessonId,
    _payment_status: action,
    _tutor_telegram_id: String(telegramUserId)
  });
  
  if (error || !success) {
    await sendTelegramMessage(telegramUserId, "❌ Не удалось обновить статус оплаты");
    return;
  }
  
  // Формируем сообщение-подтверждение
  const statusText = {
    paid: "✅ Отмечено как оплаченное",
    paid_earlier: "💳 Отмечено: оплачено ранее", 
    pending: "⏳ Отмечено: оплатит позже"
  }[action] || "Статус обновлен";
  
  // Редактируем исходное сообщение, убирая кнопки
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: telegramUserId,
      message_id: messageId,
      text: `${callbackQuery.message?.text}\n\n${statusText}`,
      parse_mode: "HTML"
    })
  });
  
  return;
}
```

### 2. Задеплоить обе функции

После добавления кода выполнить деплой:

| Функция | Действие |
|---------|----------|
| `telegram-bot` | Деплой с новым обработчиком |
| `payment-reminder` | Деплой (уже готова) |

### 3. Настроить cron-job для payment-reminder

Выполнить SQL через миграцию:

```sql
-- Включить расширения (если не включены)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Cron: каждые 5 минут вызывать payment-reminder
SELECT cron.schedule(
  'payment-reminder-job',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://vrsseotrfmsxpbciyqzc.supabase.co/functions/v1/payment-reminder',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZyc3Nlb3RyZm1zeHBiY2l5cXpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk0MjEzMDYsImV4cCI6MjA3NDk5NzMwNn0.fDleU99ULnIvtbiJqlKtgaabZzIWqqw6gZLWQOFAcKw"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
```

---

## Последовательность реализации

1. **Обновить `telegram-bot/index.ts`** — добавить обработку `payment:*` callback'ов
2. **Задеплоить `telegram-bot`**
3. **Задеплоить `payment-reminder`**
4. **Создать cron-job** через SQL миграцию

---

## Тестирование

1. Создать занятие и отметить его как `completed`
2. Включить `payment_reminder_enabled` в настройках календаря
3. Убедиться что `telegram_id` репетитора заполнен
4. Подождать 5 минут (или вызвать функцию вручную)
5. Проверить что пришло сообщение в Telegram с кнопками
6. Нажать кнопку — проверить что статус обновился в БД

