
## Отвязка Telegram от репетитора kamchatkinvova@gmail.com

### Текущие данные
- **Tutor ID**: `70ff3df8-f081-4ed1-83bb-4d1a1f80f795`
- **telegram_id**: `385567670`
- **telegram_username**: `Analyst_Vladimir`

### Что нужно сделать
Выполнить SQL-миграцию, которая обнулит поля `telegram_id` и `telegram_username` у этого репетитора. Для возможности отката значения сохранены выше.

### SQL для применения

```text
-- Сохранённые значения для отката:
-- telegram_id: 385567670
-- telegram_username: Analyst_Vladimir

UPDATE public.tutors
SET telegram_id = NULL,
    telegram_username = NULL,
    updated_at = now()
WHERE id = '70ff3df8-f081-4ed1-83bb-4d1a1f80f795';
```

### SQL для отката (при необходимости)

```text
UPDATE public.tutors
SET telegram_id = '385567670',
    telegram_username = 'Analyst_Vladimir',
    updated_at = now()
WHERE id = '70ff3df8-f081-4ed1-83bb-4d1a1f80f795';
```

### Также нужно проверить profiles

Таблица `profiles` тоже может содержать `telegram_user_id` и `telegram_username` для user_id `420b1476-6988-4f00-b435-09400420d145`. Если да, их тоже нужно обнулить, чтобы при привязке нового Telegram-аккаунта не было конфликтов.

### Результат
После применения в дашборде репетитора пропадёт строка "Telegram: @Analyst_Vladimir", и Telegram-аккаунт Analyst_Vladimir можно будет привязать к другому репетитору для тестирования бота с домашками.
