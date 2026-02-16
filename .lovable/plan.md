
## Исправление: обработка "email_exists" в getOrCreateProfile

### Проблема
Функция `getOrCreateProfile` в `telegram-bot/index.ts` не обрабатывает ситуацию, когда auth user с email `telegram_{id}@temp.sokratai.ru` уже существует, но в таблице `profiles` у него очищен `telegram_user_id`. Это приводит к ошибке `AuthApiError: A user with this email address has already been registered`.

### Решение
В функции `getOrCreateProfile` (строка ~695-708), после неудачного `createUser`, добавить fallback:

1. Если ошибка имеет код `email_exists`, найти существующего auth user по email через `supabase.auth.admin.listUsers()`
2. Обновить его `profiles` запись, восстановив `telegram_user_id` и `telegram_username`
3. Вернуть обновлённый profile

### Изменения

**Файл**: `supabase/functions/telegram-bot/index.ts`

В блоке после `createUser` (строки 695-708), заменить простой `throw` на:

```text
if (authError) {
  // Handle case where auth user already exists but profile lost telegram_user_id
  if (authError.message?.includes("already been registered")) {
    console.log("Auth user already exists, looking up by email:", tempEmail);
    
    const { data: listData } = await supabase.auth.admin.listUsers();
    const existingUser = listData?.users?.find(u => u.email === tempEmail);
    
    if (existingUser) {
      const { data: recoveredProfile, error: recoverError } = await supabase
        .from("profiles")
        .update({
          telegram_user_id: telegramUserId,
          telegram_username: telegramUsername,
          registration_source: "telegram",
        })
        .eq("id", existingUser.id)
        .select()
        .single();
      
      if (!recoverError && recoveredProfile) {
        console.log("Recovered existing profile:", recoveredProfile.id);
        return recoveredProfile;
      }
    }
  }
  
  console.error("Error creating user:", authError);
  throw new Error("Failed to create user");
}
```

### Результат
После этого исправления переход по ссылке `https://t.me/sokratai_ru_bot?start=tutor_KMSB8XLD` будет работать корректно: бот найдёт существующего пользователя, восстановит привязку Telegram и привяжет ученика к репетитору.

### Задеплоить
После изменения кода нужно задеплоить edge function `telegram-bot`.
