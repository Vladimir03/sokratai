## Что произошло

Репетитор пытался добавить ученика `alekeisavin@gmail.com` вручную. Фронт показал `Edge Function returned a non-2xx status code` — без объяснения. В логах `tutor-manual-add-student`:

```
INFO  Auth user already exists for email: alekeisavin@gmail.com
ERROR Failed to create auth user: AuthApiError ... code: "email_exists" (422)
→ функция вернула 500 "Failed to create student user"
```

То есть юзер с таким email **уже зарегистрирован** в системе (id `68152903-…`, lowercase exact match в `auth.users`). Но Step 1 lookup через `supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 })` его не нашёл → код пошёл на `createUser` → 422 → race-recovery (опять `listUsers` тем же способом) → опять не нашёл → 500 generic.

## Корневые причины (две)

1. **Lookup ненадёжен.** `auth.admin.listUsers` иногда возвращает неполный/пустой список (transient gateway hiccup, RU proxy, etc.) — ошибка игнорируется (`const { data: listData } = ...` без проверки `error`). И race-fallback после `email_exists` использует тот же ненадёжный путь.
2. **Ошибка не доносится до тутора.** Сервер возвращает generic `"Failed to create student user"`, а фронт через `supabase.functions.invoke` на non-2xx получает `FunctionsHttpError` где `data` обычно `null` — `tutors.ts` показывает `error.message` = «Edge Function returned a non-2xx status code».

## Что меняем

### Backend — `supabase/functions/tutor-manual-add-student/index.ts`

1. **Заменить ненадёжный `listUsers` lookup** на прямой SQL по `auth.users` через service_role:
   ```ts
   const { data: row } = await supabaseAdmin
     .schema('auth').from('users')
     .select('id, email')
     .ilike('email', email)   // case-insensitive
     .maybeSingle();
   ```
   Использовать и в Step 1, и в race-recovery после `email_exists`. Если `auth` схема недоступна через PostgREST — создать SECURITY DEFINER RPC `find_auth_user_id_by_email(text) returns uuid`.
2. **Если по email юзер найден (новый или race) — продолжать обычный flow** (привязка к тутору). НИКОГДА не возвращать 500 «email уже зарегистрирован», если мы только что нашли его id.
3. **Если найденный auth-юзер уже привязан к ДРУГОМУ туторскому workflow / имеет другую роль (tutor/admin)** — вернуть **409** с понятной русской ошибкой:
   ```json
   { "code": "EMAIL_BELONGS_TO_OTHER_ACCOUNT",
     "error": "Этот email уже зарегистрирован в Сократе как репетитор/админ. Используй другой email или попроси ученика войти и связаться с тобой по ссылке-приглашению." }
   ```
4. **Если listUsers/SQL-lookup вернул error** — не глотать, вернуть 503 с message «Не удалось проверить email. Попробуй ещё раз».
5. **Маппить все ошибки в JSON-payload** `{ code, error }` с осмысленным русским `error`. Никаких `"Failed to create student user"` / `"Internal server error"` без контекста.

### Frontend — `src/lib/tutors.ts::manualAddTutorStudent` (и `updateTutorStudentProfile`, `resetStudentPassword` тем же паттерном)

Парсить body даже когда `supabase.functions.invoke` возвращает `error` (FunctionsHttpError):
```ts
if (error) {
  let serverMsg: string | null = null;
  try {
    // FunctionsHttpError exposes raw Response via error.context
    const ctx = (error as any).context;
    if (ctx && typeof ctx.json === 'function') {
      const body = await ctx.json();
      if (body?.error) serverMsg = body.error;
    }
  } catch { /* ignore */ }
  throw new Error(serverMsg ?? error.message ?? 'Не удалось добавить ученика');
}
```
Тогда toast покажет именно русский текст из edge function.

### UX — `AddStudentDialog.tsx`

Toast при ошибке уже показывает `error.message`. После фронт-фикса выше — это будет понятная фраза. Дополнительно: если `code === 'EMAIL_BELONGS_TO_OTHER_ACCOUNT'` — подсветить поле Email красным.

## Закрепить правило

Новый rules-файл `.claude/rules/97-edge-function-error-contract.md` + ссылка из `AGENTS.md` / `CLAUDE.md` § «Известные хрупкие области». Содержит **4 hard rules**:

1. **Каждая edge function ОБЯЗАНА возвращать JSON `{ error: string, code?: string }` с человеческой русской фразой** в каждом non-2xx response. Никаких generic `"Internal server error"` / `"Failed to X"`. Голый `throw` → catch → русский fallback в `JSON.stringify`.
2. **Клиентский wrapper над `supabase.functions.invoke` ОБЯЗАН парсить тело ответа** при non-2xx (`error.context.json()`) и пробрасывать `body.error` как `Error.message`. Не показывать «Edge Function returned a non-2xx status code» юзеру никогда.
3. **`auth.admin.listUsers` НЕ использовать для lookup по email** — только прямой SQL `select id from auth.users where lower(email) = $1` (через service_role или SECURITY DEFINER RPC). `listUsers` ненадёжен на transient errors и не гарантирует видимость всех записей.
4. **Любой `email_exists` (422 из `auth.admin.createUser`) ОБЯЗАН быть пойман** и сконвертирован либо в успешное reuse существующего юзера (если контракт позволяет), либо в 409 с понятным русским объяснением. 500 generic после `email_exists` — баг.

Плюс short-list checklist для review новых edge functions.

## Файлы

- `supabase/functions/tutor-manual-add-student/index.ts` (lookup + error mapping)
- `src/lib/tutors.ts` (3 wrapper-функции — единый error-extractor helper)
- `.claude/rules/97-edge-function-error-contract.md` (NEW)
- `CLAUDE.md` § «Известные хрупкие области» — добавить ссылку на правило 97

## Validation

1. `npm run build` + `npm run smoke-check`.
2. Деплой edge function. Manual test: попробовать добавить ученика с уже зарегистрированным email — должен вернуться понятный 409 с русской фразой, фронт покажет её в toast.
3. Попробовать с новым email — должен пройти как раньше.
4. После merge выполнить `deploy-sokratai` на VPS (frontend изменён — `src/lib/tutors.ts`).
