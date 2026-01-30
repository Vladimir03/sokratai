

## План: Создание таблицы payments и исправление подписки

### Часть 1: Миграция базы данных

Создать таблицу `payments` для хранения истории платежей YooKassa:

```sql
-- Таблица платежей
CREATE TABLE IF NOT EXISTS public.payments (
  id TEXT PRIMARY KEY,                    -- ID платежа от YooKassa
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount DECIMAL(10, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'RUB',
  status TEXT NOT NULL DEFAULT 'pending', -- pending, succeeded, canceled
  subscription_days INTEGER NOT NULL DEFAULT 30,
  idempotency_key TEXT,
  webhook_data JSONB,                     -- Полные данные от webhook
  subscription_activated_at TIMESTAMPTZ,
  subscription_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Индексы
CREATE INDEX idx_payments_user_id ON public.payments(user_id);
CREATE INDEX idx_payments_status ON public.payments(status);

-- RLS
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Пользователи видят свои платежи
CREATE POLICY "Users can view their own payments"
  ON public.payments FOR SELECT
  USING (auth.uid() = user_id);

-- Service role для webhook
CREATE POLICY "Service role can manage all payments"
  ON public.payments FOR ALL
  USING (true);

-- Триггер updated_at
CREATE TRIGGER update_payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION handle_updated_at();
```

---

### Часть 2: Обновление данных

Исправить дату подписки для пользователя **Максончик**:

```sql
UPDATE public.profiles
SET subscription_expires_at = '2026-02-28 23:59:59+00'  -- 29.02.2026 нет, февраль 2026 имеет 28 дней
WHERE id = '3195b69e-4e36-4cab-a661-05846e160449';
```

> **Примечание:** 2026 год не високосный, поэтому максимальная дата февраля — **28.02.2026**.

---

### Часть 3: Ручная вставка платежа

Добавить запись о вчерашнем платеже для истории:

```sql
INSERT INTO public.payments (
  id, user_id, amount, currency, status, 
  subscription_days, subscription_activated_at, 
  subscription_expires_at, created_at
) VALUES (
  'manual_20260129_maksimkak1',           -- Ручной ID
  '3195b69e-4e36-4cab-a661-05846e160449', -- user_id Максончика
  699.00,                                  -- Стоимость Premium
  'RUB',
  'succeeded',
  30,
  '2026-01-29 20:41:00+00',               -- Время активации (вчера 20:41 UTC)
  '2026-02-28 23:59:59+00',               -- Истекает 28.02.2026
  '2026-01-29 20:41:00+00'                -- Время платежа
);
```

---

### Итоговый результат

| Действие | Статус |
|----------|--------|
| Таблица `payments` создана | ✅ |
| Максончик: expires_at = 28.02.2026 | ✅ |
| Платёж записан в историю | ✅ |

После применения миграции все будущие платежи через YooKassa webhook будут автоматически сохраняться в таблице `payments`.

