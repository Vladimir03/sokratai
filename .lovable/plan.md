
# План: Исправление ошибки сборки и настройка роли репетитора для Дарьи

## Задача 1: Исправить ошибку TypeScript в chat/index.ts

### Проблема
В строке 465 переменная `userId` типа `string` получает значение `body.userId`, которое может быть `undefined` (согласно интерфейсу `ChatRequestBody`).

### Решение
Нужно изменить логику проверки — сначала получить значение, потом проверить его наличие:

**Файл:** `supabase/functions/chat/index.ts` (строки 461-472)

```typescript
// Было:
let userId: string;

if (isServiceRole) {
  const body = await req.json() as ChatRequestBody;
  userId = body.userId;  // ❌ Ошибка: body.userId может быть undefined
  
  if (!userId) {
    return new Response(...);
  }
  ...
}

// Станет:
let userId: string;

if (isServiceRole) {
  const body = await req.json() as ChatRequestBody;
  
  if (!body.userId) {  // ✅ Проверяем сначала
    return new Response(JSON.stringify({ error: "userId required for service role requests" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  
  userId = body.userId;  // ✅ Теперь TypeScript знает, что это string
  ...
}
```

---

## Задача 2: Настройка роли репетитора для Дарьи

### Текущее состояние
| user_id | email | Роль tutor | Профиль tutors |
|---------|-------|------------|----------------|
| `936cd7e6-e5f3-42b6-bac7-ad3d6dc263ff` | vlasovadasha2710@mail.ru | ❌ Нет | ❌ Нет |
| `77ff2fec-c0fa-47cc-9300-b1ac23862663` | tg_1180622424@telegram.user | ❌ Нет | ❌ Нет |

### SQL-команды для выполнения

Нужно добавить роль `tutor` для обоих аккаунтов и создать профиль репетитора для **основного** email-аккаунта:

```sql
-- 1. Добавить роль tutor для email-аккаунта
INSERT INTO user_roles (user_id, role) 
VALUES ('936cd7e6-e5f3-42b6-bac7-ad3d6dc263ff', 'tutor');

-- 2. Добавить роль tutor для telegram-аккаунта
INSERT INTO user_roles (user_id, role) 
VALUES ('77ff2fec-c0fa-47cc-9300-b1ac23862663', 'tutor');

-- 3. Создать профиль репетитора для email-аккаунта
INSERT INTO tutors (user_id, name, booking_link)
VALUES (
  '936cd7e6-e5f3-42b6-bac7-ad3d6dc263ff', 
  'Дарья', 
  'tutor-936cd7e6'
);

-- 4. Создать профиль репетитора для telegram-аккаунта
INSERT INTO tutors (user_id, name, booking_link)
VALUES (
  '77ff2fec-c0fa-47cc-9300-b1ac23862663', 
  'Дарья', 
  'tutor-77ff2fec'
);
```

> **Примечание:** Два отдельных профиля создаются потому, что это технически разные аккаунты. Если в будущем понадобится объединить их (чтобы ученики были общие), нужно будет связать Telegram с основным email-аккаунтом.

---

## Техническая секция

### Изменения в коде

| Файл | Изменение |
|------|-----------|
| `supabase/functions/chat/index.ts` | Переставить проверку `!body.userId` перед присваиванием (строки 465-472) |

### SQL-операции (через insert tool)

1. `INSERT INTO user_roles` — 2 записи для обоих user_id
2. `INSERT INTO tutors` — 2 записи с профилями репетитора

### Деплой функций

После исправления ошибки нужно задеплоить функцию `chat`:
```
supabase functions deploy chat
```
