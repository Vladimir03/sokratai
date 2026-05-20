# 97 — Edge Function Error Contract

Правило родилось из бага 2026-05-20: репетитор не смог добавить ученика
`alekeisavin@gmail.com`, фронт показал `Edge Function returned a non-2xx status code`.
Корневая причина — комбинация ненадёжного `auth.admin.listUsers` lookup и generic
`{ error: "Failed to create student user" }` 500 без human-readable текста.

Эти 4 правила **обязательны** для каждой новой/правленой edge function
и каждого client-side wrapper над `supabase.functions.invoke`.

## 1. Каждый non-2xx ответ — JSON `{ error, code? }` с русской фразой

```ts
return new Response(
  JSON.stringify({
    code: "EMAIL_BELONGS_TO_OTHER_ACCOUNT",
    error: "Этот email уже зарегистрирован в Сократе как репетитор. Используй другой email.",
  }),
  { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
);
```

- Запрещены generic фразы вроде `"Internal server error"`, `"Failed to X"`, `"Bad request"`
  без контекста. Текст должен говорить пользователю **что произошло** и **что делать**.
- `code` — short SCREAMING_SNAKE для machine handling (по желанию).
- В `catch (e)` всегда инлайнить `e.message` в `error` — это часто содержит ключевую деталь
  (`AuthApiError: A user with this email address has already been registered`).

## 2. Client wrapper над `supabase.functions.invoke` парсит body

`supabase-js` оборачивает non-2xx в `FunctionsHttpError` с бесполезным
`message = "Edge Function returned a non-2xx status code"`. Реальный JSON лежит
в `error.context` (это `Response`). Использовать helper:

```ts
import { extractEdgeFunctionError } from '@/lib/edgeFunctionError';

const { data, error } = await supabase.functions.invoke("my-fn", { body });
if (error) {
  const { message, code } = await extractEdgeFunctionError(error, data, "Не удалось ...");
  const err = new Error(message);
  if (code) (err as Error & { code?: string }).code = code;
  throw err;
}
```

- Никогда не показывать пользователю строку «non-2xx status code».
- Toast должен показать `error.message` — после helper'а это будет русская фраза от сервера.

## 3. `auth.admin.listUsers` НЕ использовать для lookup по email

`listUsers({ page, perPage })` ненадёжен:
- transient errors silently → пустой массив (мы не проверяем `error`);
- pagination кап `perPage <= 1000` — на любом проекте 1000+ юзеров lookup сломается;
- проектный RU proxy / cold start иногда возвращает частичные данные.

Канонический lookup — SECURITY DEFINER RPC `find_auth_user_id_by_email(text) returns uuid`
(миграция `20260520_find_auth_user_id_by_email.sql`):

```ts
const { data: foundId, error } = await supabaseAdmin
  .rpc("find_auth_user_id_by_email", { p_email: email });
if (error) { /* return 503 with "Не удалось проверить email" */ }
```

Функция доступна только `service_role`. Lowercase-сравнение встроено.

## 4. `email_exists` от `auth.admin.createUser` — это НЕ 500

Когда `createUser` бросает `AuthApiError code: "email_exists"`:
- **либо** мы можем reuse существующий аккаунт (например, ученик когда-то зарегистрировался
  сам, а сейчас репетитор хочет привязать его к себе) — re-lookup через RPC #3 и продолжать;
- **либо** возвращать **409** с понятной фразой вроде «Этот email уже зарегистрирован …».

Generic 500 после `email_exists` — баг. Симптом нарушения правила: в логах
`ERROR Failed to create auth user: AuthApiError ... email_exists` + response 500
`Failed to create student user`.

## Review checklist для новой edge function

- [ ] Все `return new Response(..., { status: 4xx|5xx })` содержат `{ error: <русская фраза>, code? }`.
- [ ] `catch (e)` в самом конце — `error` включает `e.message`.
- [ ] Lookup по email — через `find_auth_user_id_by_email` RPC, не `listUsers`.
- [ ] `auth.admin.createUser` обёрнут try-логикой для `email_exists` → reuse или 409.
- [ ] Соответствующий client wrapper использует `extractEdgeFunctionError`.
