

## Исправление: восстановление "осиротевшего" auth user без profile

### Проблема

Auth-пользователь `3c9e408c` (email: `telegram_385567670@temp.sokratai.ru`) существует в `auth.users`, но **не имеет записи в `public.profiles`**. Текущий recovery-код делает `UPDATE profiles ... WHERE id = '3c9e408c'`, но обновлять нечего -- 0 строк.

### Решение

Два изменения:

**1. `getOrCreateProfile` в `telegram-bot/index.ts` (строки ~721-737)**

Если auth user найден, но UPDATE вернул пустой результат -- значит profile отсутствует. Нужно вставить (`INSERT`) новую запись в `profiles`:

```text
if (existingUser) {
  // Try update first
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

  // Profile row missing -- create it
  console.log("Profile missing for auth user, inserting:", existingUser.id);
  const { data: insertedProfile, error: insertError } = await supabase
    .from("profiles")
    .insert({
      id: existingUser.id,
      username: telegramUsername || `user_${telegramUserId}`,
      telegram_user_id: telegramUserId,
      telegram_username: telegramUsername,
      registration_source: "telegram",
      trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select()
    .single();

  if (!insertError && insertedProfile) {
    console.log("Created missing profile:", insertedProfile.id);
    return insertedProfile;
  }
  console.error("Failed to insert profile:", insertError);
}
```

**2. `tutor-manual-add-student/index.ts` (строки ~106-119)**

Та же ситуация: при ручном добавлении `createUser` может упасть с `email_exists`. Нужно добавить аналогичный fallback:
- Поймать ошибку `email_exists`
- Найти существующего auth user по email через `listUsers`
- Использовать его ID как `studentId`

### Деплой

После изменения обоих файлов задеплоить:
- `telegram-bot`
- `tutor-manual-add-student`

### Результат

- Ссылка `https://t.me/sokratai_ru_bot?start=tutor_KMSB8XLD` заработает для `@Analyst_Vladimir`
- Ручное добавление репетитором тоже будет работать корректно для пользователей с "осиротевшим" auth user
