# RU Auth Bypass — Hard Rules

Этот документ — **единый источник правды** для auth flows в SokratAI. Цель: предотвратить регрессии регистрации репетиторов/учеников в РФ без VPN, которые блокировали продакшен в мае 2026 (см. `~/.claude/plans/compressed-sparking-spindle.md`).

**ЛЮБОЕ изменение auth flow** должно сначала пройти этот документ. Если меняешь signup-flow / OAuth callback / email confirmation — обнови этот файл синхронно.

---

## Архитектура (canonical)

```
Frontend (sokratai.ru)              Selectel Moscow VPS               Supabase Cloud
─────────────────────               ──────────────────                ───────────────
RegisterTutor / SignUp ─────POST───▶ api.sokratai.ru/auth/v1/signup ─▶ creates auth.users row
                                     (Email confirm: sends email)      (email_confirmed_at=NULL)
                                                                        sends email via SMTP
                                                                        link → api.sokratai.ru/.../email-verify
       ▲                                                                  │
       │                                                                  │
       │  user clicks confirmation link in inbox                          │
       │                                                                  ▼
       │                            api.sokratai.ru/functions/v1/        verifyOtp via anon
       │                            email-verify ◀──────────────────────  client → session minted
       │                              │
       │                              │ (server-side)
       │                              │  1. read user.user_metadata
       │                              │  2. assignTutorRoleIfNeeded (admin client, exact allow-list)
       │                              │  3. flushConsentIntent (admin client)
       │                              │  4. apply trial_intent if set
       │                              ▼
       └────────── 302 redirect: {{ .RedirectTo }}#access_token=...&refresh_token=...
                  (e.g. /tutor/home or /chat)


GoogleAuthButton                    Selectel Moscow VPS               Google
────────────────                    ──────────────────                ──────
click ────GET intendedRole=...─────▶ api.sokratai.ru/.../oauth-google-init
                                     │ HMAC-signs state {redirectTo, intendedRole, nonce, issuedAt}
                                     │ derives intendedRole=tutor only if rawRequest==tutor AND
                                     │   redirectTo.pathname startsWith /tutor/ (defense-in-depth)
                                     ▼
                                     302 → accounts.google.com (redirect_uri = oauth-google-callback)
                                                                                    │
                                                                                    │
       ▲                                                                            │
       │                                                                            │
       │                            api.sokratai.ru/.../oauth-google-callback ◀── code
       │                              │
       │                              │ server-to-server token exchange
       │                              │ admin.createUser → magiclink → verifyOtp
       │                              │ if isNewUser AND intendedRole=tutor:
       │                              │   assign user_roles.tutor (FATAL if fails)
       │                              │   insert tutors row (non-fatal)
       │                              ▼
       └────────── 302 redirect: redirectTo#access_token=...
                  (e.g. /tutor/home — TutorGuard waits for INITIAL_SESSION before checking role)


TelegramLoginButton                 Selectel Moscow VPS               Telegram
───────────────────                 ──────────────────                ────────
click ─────POST?action=create──────▶ api.sokratai.ru/.../telegram-login-token
                                     │ INSERT token row, return T
       ◀────── token T ──────────────┘

window.open(t.me/sokratai_ru_bot?start=login_T)                       ◀── юзер нажимает /start
                                                                          │
                                                                          ▼
                            api.sokratai.ru/.../telegram-bot::handleWebLogin
                              │ admin.createUser (если новый)
                              │ admin.generateLink → verifyOtp → session
                              │ UPDATE telegram_login_tokens.status='verified'
                              │   .session_data, .user_id (через fresh tokenWriter client)
                              │
       ◀────── polling каждые 2 сек ─┘
                              │
client setSession({access, refresh}) → navigate
```

---

## Hard Rules — Frontend

### 1. **НИКОГДА** не возвращайся к sync `getSession()` в guard'ах

`AuthGuard.tsx` и `TutorGuard.tsx` должны **ждать `INITIAL_SESSION` event** перед auth-decisionом. Sync `supabase.auth.getSession()` в `useEffect` возвращает `null` ДО того, как supabase-js успевает auto-parse URL hash `#access_token=...` от наших edge functions.

**Симптом нарушения:** infinite loop Google → /tutor/home → /register-tutor → Google (юзер видит ту же форму после consent).

**Каноничный pattern:**
```tsx
const initialFired = useRef(false);

const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
  if (!initialFired.current && event === "INITIAL_SESSION") {
    initialFired.current = true;
    checkAccess(session);
    return;
  }
  if (event === "SIGNED_IN") checkAccess(session);
  if (event === "SIGNED_OUT") navigate("/login");
});

// 3-second safety net в случае browser quirk
const fallback = setTimeout(() => {
  if (!initialFired.current) {
    initialFired.current = true;
    checkAccess();
  }
}, 3000);
```

### 2. **НИКОГДА** не silent-fail на `!data.session` после `signUp()`

При email confirm required, `supabase.auth.signUp()` возвращает `user` без `session`. Если код продолжает (например, вызывает `assign-tutor-role` без user JWT → 401), юзер видит non-actionable error и не понимает что делать.

**Каноничный pattern:**
```tsx
if (!authData.session) {
  toast.info("Мы отправили письмо для подтверждения email. Откройте его и нажмите ссылку, чтобы завершить регистрацию.", { duration: 10000 });
  return; // НЕ вызывать assign-tutor-role / recordConsent без сессии
}
```

### 3. **НИКОГДА** не делай consent record / role assign client-side для email-flow

Email-flow signUp возвращает БЕЗ сессии. Любой клиентский `recordConsent` или `supabase.functions.invoke` потерпит fail (нет user JWT) или silent skip.

Вместо этого: **сохрани intent в `user_metadata.consent_intent`** при `signUp({ options: { data: {...} } })`. `email-verify` flush'нет server-side через admin client после `verifyOtp`.

**Каноничные signUp options:**
```tsx
options: {
  data: {
    username: ...,
    signup_source: "tutor-register",       // см. TUTOR_SIGNUP_SOURCES allow-list
    consent_intent: "web-signup-tutor",    // flushed в email-verify
    trial_intent: true,                    // optional, ставит trial_started_at
  },
  emailRedirectTo: `${window.location.origin}/tutor/home`,
}
```

### 4. **НИКОГДА** не передавай `intendedRole="tutor"` со страниц БЕЗ consent gate

Login-страницы (`/login`, `/tutor/login`) НЕ должны передавать `intendedRole="tutor"` в `GoogleAuthButton`. Иначе brand-new юзер кликает «Login» → Google создаёт user → callback auto-assigns tutor role → bypass offer/privacy consent.

`intendedRole="tutor"` разрешён ТОЛЬКО на:
- `/register-tutor` (RegisterTutor.tsx) — есть consent checkbox
- `/tutor/signup-trial` (TutorSignupTrial.tsx) — есть consent checkbox

### 5. **НИКОГДА** не используй `window.open("t.me/...")` без QR-fallback

Windows / Linux desktop без Telegram Desktop не обрабатывает `t.me` deep link корректно — открывает web-страницу t.me где `?start=` НЕ передаётся боту. Polling умирает по 5-минутному timeout, юзер видит «зависло».

Каноничный pattern в `TutorTelegramLoginButton.tsx` / `TelegramLoginButton.tsx`: рендерить **QR-код рядом с кнопкой**, чтобы юзер мог сосканировать с phone:
```tsx
{currentToken && !isIOS() && (
  <QRCode value={`https://t.me/${botName}?start=login_${currentToken}`} ... />
)}
```

### 5a. **НИКОГДА** guard re-verification на auth-событии не должна размонтировать кабинет (form-loss на tab-switch)

`supabase-js` переэмитит `SIGNED_IN` на возврате вкладки (session-recovery на `visibilitychange`), **не только при логине**. Guard, обёртывающий write-поверхности (`TutorGuard` → `AppFrame` → все `/tutor/*`; `AuthGuard` → student-роуты), на повторном auth-событии **НЕ должен** дёргать `setLoading(true)` / `setError()`, пока пользователь уже `authorized` — иначе `<Outlet/>` размонтируется и **открытые формы теряют локальный `useState`** (ДЗ-конструктор, `AddStudentDialog`, KB `CreateTaskModal`, AI-загрузчик) при переключении **вкладок** (баг Егора #41, 3 репетитора, 2026-07-06; alt-tab между окнами не триггерит — там нет `visibilitychange`).

Каноничные паттерны:
- **`AuthGuard`** — fire-once: `handleSession` выходит по `if (sessionHandled.current) return;` → повторный `SIGNED_IN` = no-op.
- **`TutorGuard`** — «тихая» ре-верификация: `authorizedRef` (зеркало `authorized` без stale-closure) + `silent = authorizedRef.current && !forceRecheck` → при `silent` НЕ трогать `loading`/`error` (фоновая проверка не сносит кабинет; согласуется с rule 95 tiered-errors). Блокирующий UI — ТОЛЬКО первая проверка (`authorized === false`) или `forceRecheck` (кнопка «Повторить»).
- **`SIGNED_IN` — 3-way по юзеру/кэшу:** `isCacheValid(id)` (тот же юзер, кэш свежий) → держим mounted, **`verifiedAt` НЕ бампать** (иначе 10-мин role-TTL становится скользящим «последний фокус», роль не перепроверяется); `tutorAuthCache.userId === id` (тот же юзер, кэш протух) → silent `checkAccess()`; иначе (другой/неизвестный юзер) → `setAuthorized(false)` + `checkAccess(true)` (блок спиннером до проверки новой роли — не показываем данные прежнего юзера).

**Инвариант:** новый guard / новое auth-событие с re-check → mirror `authorizedRef` / `sessionHandled`; не бампать TTL-таймстамп на cached focus-событии; user-change → блокирующая проверка, same-user re-verify → тихо. **Симптом нарушения:** «введённые данные и форма пропадают при переходе на соседнюю вкладку». Build-лог: memory `project_tab_switch_form_loss_2026_07_06.md`.

---

## Hard Rules — Backend (Edge Functions)

### 6. **НИКОГДА** не доверяй client-supplied `intendedRole` без двух signals

`oauth-google-init` принимает `intendedRole` query param, но **не доверяй ему слепо**:

```typescript
// Path-based defense-in-depth (oauth-google-init/index.ts):
const redirectIsTutorSurface = redirectPath.startsWith("/tutor/");
const intendedRole =
  requestedRole === "tutor" && redirectIsTutorSurface ? "tutor" : "student";
```

Tutor role auto-assigned ТОЛЬКО когда:
1. `intendedRole=tutor` явно передан, **И**
2. `redirectTo.pathname` начинается с `/tutor/`, **И**
3. В callback: `isNewUser === true` (existing accounts preserved)

### 7. **НИКОГДА** не используй regex для security-adjacent role check

В `email-verify::assignTutorRoleIfNeeded`, проверка `signup_source` должна быть **exact allow-list**, не regex:

```typescript
// CANONICAL — exact allow-list
const TUTOR_SIGNUP_SOURCES = new Set([
  "tutor-register",         // RegisterTutor.tsx
  "tutor-landing-trial",    // TutorSignupTrial.tsx
  "google-oauth-tutor",     // oauth-google-callback
  "telegram-oauth-tutor",   // telegram-bot
]);

// FORBIDDEN — too permissive ("not-tutor", "fake-tutor-thing" match)
const isTutor = /tutor/i.test(signupSource);
```

При добавлении нового entrypoint — расширь `TUTOR_SIGNUP_SOURCES` явно.

### 8. **НИКОГДА** не делай role insert failure non-fatal

Если `INSERT INTO user_roles` падает в `email-verify` или `oauth-google-callback`, **НЕ продолжай с 302 на `/tutor/home`** — TutorGuard увидит no role → bounce обратно на `/register-tutor` → infinite loop.

Каноничный pattern:
```typescript
if (roleErr) {
  console.error(JSON.stringify({ event: "..._role_insert_failed", ... }));
  return redirectToError("role_finalization_failed", FALLBACK_LOGIN_URL);
}
```

Tutor row failure (`tutors` table) — **non-fatal** (TutorGuard passes на role alone, profile metadata backfill'ится при первом edit).

### 9. **НИКОГДА** не хардкодь `redirect_to=https://sokratai.ru/tutor/home` в email template

Supabase email templates **глобальные** (per-type). Если template hardcode'ит `/tutor/home`, student signup тоже попадёт туда → TutorGuard выкинет → loop.

**Каноничный шаблон Email Templates → Confirm signup:**
```
https://api.sokratai.ru/functions/v1/email-verify?token_hash={{ .TokenHash }}&type=signup&redirect_to={{ .RedirectTo }}
```

`{{ .RedirectTo }}` — per-call variable из `signUp({ options: { emailRedirectTo: '...' } })`. RegisterTutor передаёт `/tutor/home`, SignUp — `/chat`.

### 10. **НИКОГДА** не SELECT `*` или не whitelist columns в auth edge functions

`oauth-google-callback`, `email-verify`, `telegram-bot::handleWebLogin` НИКОГДА:
- НЕ логируют `email` / `user_id` / Telegram tokens (PII / privacy-sensitive)
- НЕ возвращают `tutors`-row внутренние поля (`telegram_id`, `telegram_username`, `booking_link`) в публичных endpoint'ах

Структурированные events типа `console.warn(JSON.stringify({event, timestamp, reason?}))` — OK. Logs **boolean/status only**, без identifiers.

### 11. **ОБЯЗАТЕЛЬНО** проверь `supabase/config.toml` + deploy workflow при добавлении edge function

При создании нового edge function:
1. Добавь запись в `supabase/config.toml`:
   ```toml
   [functions.NEW_FUNCTION]
     verify_jwt = false  # или true в зависимости от auth path
   ```
2. Добавь deploy command в `.github/workflows/deploy-supabase-functions.yml`:
   ```yaml
   supabase functions deploy NEW_FUNCTION --no-verify-jwt
   ```
3. Запусти `node scripts/supabase-drift-check.mjs` — должно показать `deploy not in config: (none)`

**Симптом нарушения:** edge function существует в `supabase/functions/` но не deploy'ится на production → 404 для всех вызовов.

### 11a. Публичный edge function: клиент шлёт anon-ключ, не полагайся на `verify_jwt=false` из config

`verify_jwt=false` в `config.toml` означает «функция публичная, ключ не нужен» — **но Lovable иногда деплоит новую функцию с `verify_jwt=true`** (config не подхвачен сразу). Тогда gateway возвращает **401 `UNAUTHORIZED_NO_AUTH_HEADER`** на keyless-запрос ДО входа в функцию — публичная страница показывает «не удалось загрузить» (инцидент 2026-06-11, `public-student-report`/«Отчёт родителю»).

**Правило:** клиент публичной функции, вызываемый **без сессии** (родитель/аноним), ОБЯЗАН слать **anon publishable key** в обоих заголовках:
```ts
import { SUPABASE_PUBLISHABLE_KEY } from '@/lib/supabaseClient';
fetch(url, { headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}` } });
```
Anon-ключ — валидный JWT, поэтому gateway пропускает запрос и при `verify_jwt=true`, и при `=false` → не зависим от того, применился ли config. (Внутри функция всё равно работает под `service_role`.) Reference: `src/lib/publicReportApi.ts`. `config.toml` `verify_jwt=false` всё равно держим (правильный intent), но он больше не load-bearing.

**Диагностика «публичная страница не грузится»:** `curl` функцию БЕЗ ключа — `401 UNAUTHORIZED_NO_AUTH_HEADER` = gateway держит verify_jwt=true (или config не применён) → шли anon-ключ; `404` = функция не задеплоена; `503` = boot-crash (битый импорт, rule 95).

**Агентский deploy-тул Lovable ИГНОРИРУЕТ `verify_jwt=false` (инцидент 2026-07-14, КРИТИЧНО).** `supabase--deploy_edge_functions` (через который агент Lovable «передеплой функцию X») деплоит с **включённым** JWT-гейтом, даже когда `config.toml` говорит `false` → keyless-вызов ловит `401 UNAUTHORIZED_NO_AUTH_HEADER` на gateway. **Sync-on-push деплой (обычный `git push` в main → Lovable подтягивает) уважает `config.toml`** — это единственный надёжный путь для публичных функций. Симптом после «точечного редеплоя через агента»: часть публичных функций внезапно 401.
- **Browser-navigation функции (OAuth-init: `oauth-yandex-init`/`oauth-vk-init`, `email-verify`, `invite-preview`) клиентским anon-ключом НЕ чинятся** — браузер идёт на них 302-редиректом/переходом БЕЗ заголовков, послать ключ физически негде. Для них `verify_jwt=false` — обязателен по-настоящему.
- **Восстановление:** touch-коммит (тривиальный комментарий в `index.ts` функции) → `git push` → Lovable sync передеплоит с правильным `verify_jwt`. Верификация: keyless `curl` → 302 (init) / функция-специфичный 4xx (не gateway 401).

---

## Hard Rules — Ops (Supabase Dashboard manual actions)

После любого изменения auth flow, проверь:

### A. Authentication → URL Configuration
- **Site URL:** `https://sokratai.ru` (НЕ `https://vrsseotrfmsxpbciyqzc.supabase.co` — заблокирован в РФ)
- **Additional Redirect URLs:** `https://sokratai.ru/**`, `https://sokratai.lovable.app/**`, `https://api.sokratai.ru/**`

### B. Authentication → Email Templates → "Confirm signup"
- Body:
  ```
  https://api.sokratai.ru/functions/v1/email-verify?token_hash={{ .TokenHash }}&type=signup&redirect_to={{ .RedirectTo }}
  ```
- НЕ `{{ .ConfirmationURL }}` (default → ведёт на заблокированный `*.supabase.co`)
- НЕ hardcoded `redirect_to=https://sokratai.ru/tutor/home` (Rule 9)

### C. Google Cloud Console → OAuth Client → Authorized redirect URIs
- Должен включать: `https://api.sokratai.ru/functions/v1/oauth-google-callback`

### D. После backend deploy → frontend deploy на VPS
```bash
ssh -i "$HOME\.ssh\sokratai_proxy" root@185.161.65.182
deploy-sokratai
```

---

## Провайдеры авторизации — соответствие 406-ФЗ (2026-07-07)

Закон о штрафах за авторизацию через иностранные сервисы (КоАП, Госдума 2026-06-09; базовый запрет 406-ФЗ с 01.12.2023):
российские сайты авторизуют пользователей ТОЛЬКО через телефон РФ / Госуслуги (ЕСИА) / ЕБС / **российскую** ИС
(VK ID, Yandex ID, Sber ID, Mail.ru). Иностранные (Google, Apple, **Telegram**) — запрещены. Ответственность на владельце сайта.

**Действующая модель:**
- **Email+пароль** — оставлен (серая зона, прямого запрета нет).
- **Yandex ID + VK ID** — кастомный RU-bypass OAuth через `_shared/oauth-helpers.ts` (зеркало Google-флоу). Yandex: userinfo
  `login.yandex.ru/info` (id_token нет). VK: OAuth 2.1 + **PKCE** (`code_verifier` в signed state), email-absent → синтетический
  `vk_<id>@vk.sokratai.ru`.
- **Google-вход** — убран из UI (5 страниц входа + `LoginProvidersSection`); `oauth-google-*`/`GoogleAuthButton` = **DORMANT**
  (удалить после прод-verify Yandex/VK).
- **Telegram-вход** — кнопки убраны; **бот (уведомления/pay/ДЗ/инвайты) НЕ тронут** (rule 60). `*TelegramLoginButton.tsx` = DORMANT
  (smoke-guard держит компоненты).

**Миграция Telegram-only (~30 акк., email `telegram_<id>@temp.sokratai.ru`):** бот **`/parol`** → `/set-password?t=` → edge
**`student-set-password`** (verify_jwt=false, service_role) ставит email+пароль на **существующий** аккаунт
(`admin.updateUserById(email_confirm:true)`, история цела; reuse `telegram_login_tokens.action_type='set_password'` — миграций
нет, у колонки нет CHECK; зеркало `student-register` updateUserById+EMAIL_TAKEN + `student-claim` CAS single-use). Разовый пуш
всем 30 — **`telegram-migrate-push`** (admin `x-admin-key`==`BROADCAST_SECRET`, парсит tgid из email, dry_run). **Бот НЕ минтит
сессию** — только выдаёт токен → не «Telegram-авторизация».

**Инвариант для нового OAuth-провайдера:** только российская ИС; зеркалить `_shared/oauth-helpers.ts` (signState/verifyState,
deriveIntendedRole path-guard, findOrCreateUser, mintSession, assignTutorRoleIfNeeded); расширять `ConsentSource` +
`TUTOR_SIGNUP_SOURCES`; кнопка → `api.sokratai.ru/functions/v1/oauth-<p>-init`; `config.toml verify_jwt=false` + deploy-workflow
(rule 11). Ops: приложение провайдера (callback на `api.sokratai.ru`) + секреты `*_OAUTH_CLIENT_ID/SECRET`.

**⚠️ Lovable-sync стирает незакоммиченное:** эта работа дважды пропадала (Lovable перезаписал working tree своим cloud-state,
удалив uncommitted файлы Phase 1). **Коммить auth-изменения сразу** (первый landing — main `8bbb2a7`), не оставляй в working tree.

---

## Канонические файлы (не дублировать логику)

| Файл | Назначение |
|---|---|
| [src/lib/supabaseClient.ts](src/lib/supabaseClient.ts) | Hardcoded `SUPABASE_URL = 'https://api.sokratai.ru'`. Никогда не fall through на `import.meta.env.VITE_SUPABASE_URL` |
| [src/lib/consent.ts](src/lib/consent.ts) | `ConsentSource` union, `recordConsent`, `applyPendingConsent`. Mirror `TUTOR_SIGNUP_SOURCES` если расширяешь |
| [src/components/AuthGuard.tsx](src/components/AuthGuard.tsx) | Student routes guard. Waits for INITIAL_SESSION |
| [src/components/TutorGuard.tsx](src/components/TutorGuard.tsx) | Tutor routes guard. Module-level cache + INITIAL_SESSION wait |
| [src/components/YandexAuthButton.tsx](src/components/YandexAuthButton.tsx) + [VkAuthButton.tsx](src/components/VkAuthButton.tsx) | Yandex ID / VK ID OAuth init (mirror GoogleAuthButton). RU-compliant |
| [supabase/functions/_shared/oauth-helpers.ts](supabase/functions/_shared/oauth-helpers.ts) | Shared RU-bypass OAuth mechanics (HMAC state, session mint, role assign) — oauth-yandex/vk-* |
| [oauth-yandex-init](supabase/functions/oauth-yandex-init/index.ts) + callback · [oauth-vk-init](supabase/functions/oauth-vk-init/index.ts) + callback | Yandex/VK OAuth (VK = OAuth 2.1 + PKCE, email-absent fallback) |
| [student-set-password](supabase/functions/student-set-password/index.ts) + [SetPasswordPage.tsx](src/pages/SetPasswordPage.tsx) | Telegram-only миграция: `/parol` → email+пароль на существующий аккаунт (CAS token) |
| [telegram-migrate-push](supabase/functions/telegram-migrate-push/index.ts) | Разовый пуш всем 30 Telegram-only (admin `x-admin-key`) |
| [src/components/GoogleAuthButton.tsx](src/components/GoogleAuthButton.tsx) | **DORMANT** (Google убран, 406-ФЗ). `intendedRole` default `student` |
| [src/components/TutorTelegramLoginButton.tsx](src/components/TutorTelegramLoginButton.tsx) | **DORMANT** login (бот не тронут). Tutor Telegram flow + QR |
| [src/components/TelegramLoginButton.tsx](src/components/TelegramLoginButton.tsx) | **DORMANT** login (бот не тронут). Student Telegram flow + QR |
| [supabase/functions/email-verify/index.ts](supabase/functions/email-verify/index.ts) | RU-bypass email confirmation. Exact `TUTOR_SIGNUP_SOURCES` allow-list |
| [supabase/functions/oauth-google-init/index.ts](supabase/functions/oauth-google-init/index.ts) | **DORMANT**. Custom OAuth init |
| [supabase/functions/oauth-google-callback/index.ts](supabase/functions/oauth-google-callback/index.ts) | **DORMANT**. isNewUser guard, role finalization fatal-on-fail |
| [docs/delivery/engineering/runbooks/tutor-cant-signup-ru.md](docs/delivery/engineering/runbooks/tutor-cant-signup-ru.md) | Support runbook |

---

## Известные deferred follow-ups (Round 4 review)

После 3 раундов ChatGPT-5.5 code review остались **non-blocking** improvements:

1. **P1 — OAuth consent flush gap — ЧАСТИЧНО ЗАКРЫТ 2026-07-20 (ревью 5.6 P1 #5).** Student-поверхности: `AuthGuard.handleSession` теперь зовёт `applyPendingConsent(uid)` рядом с `claimPendingInvite` → возврат Яндекс/VK на `/student/schedule` (и любую AuthGuard-страницу) записывает согласие. **Tutor-путь остаётся deferred**: возврат на `/tutor/home` идёт через `TutorGuard`, который flush НЕ делает. Полное решение (deferred): carry `consentSource` в signed OAuth state → flush server-side в callback (mirror email-flow `consent_intent`).

2. **P2 — Error UI invisible.** `email-verify` redirect'ит role failure на `/login?email_verify_error=role_finalization_failed`, OAuth callback — на `/login?oauth_error=...`. Login.tsx / TutorLogin.tsx **не читают** эти query params → юзер видит обычный login screen, не понимает что произошло. **Решение (deferred):** добавить `useEffect` с `useSearchParams` на Login + TutorLogin, mapping error codes на toast.error с user-friendly текстом.

При работе над любой из этих задач — соблюдай Rules 1-11 выше.

---

## Онбординг-активация v2 — беспарольный claim + регистрация + OTP (2026-07-01)

Хэндофф репетитор→ученик (create-then-claim). Спека: `docs/delivery/features/onboarding-activation-v2/`. Build-лог: memory `project_onboarding_activation_v2.md`. План `~/.claude/plans/v2-dapper-lamport.md`.

**Per-student claim-код (`tutor_students.claim_token`, миграции `20260701120000` + **пересмотр `20260720120000`** — запрос №43 Егора, решения владельца 2026-07-20):**
- **МНОГОРАЗОВЫЙ до регистрации** (было: одноразовый + TTL 30 дней — создавало lockout: заходивший-но-незарегистрированный ученик, потерявший сессию, блокировался навсегда). `student-claim` POST **НЕ обнуляет** токен; `claimed_at`/`claim_channel` — write-once (`.is('claimed_at', null)`, аналитика первого входа). **TTL снят.** «Код умирает» при установке реальной почты+пароля: `student-register` и `student-set-password` нуллят `claim_token` по `student_id` (все связки).
- **Гейт «зарегистрирован» = реальный email И `last_sign_in_at`** (оба через AND) — в RPC `tutor_ensure_student_claim_token` (RAISE `STUDENT_ALREADY_ACTIVE`, идентификатор сохранён — фронт матчит regex) и в `student-claim` POST (403 `ALREADY_ACTIVE`). temp-email+вход = застрявший плейсхолдер → код работает/переиздаётся; реальный email без входа = email проставлен репетитором до claim → тоже ок; реальный email+вход = сам владеет аккаунтом → блок. ⚠ `homework-api::handleConnectStudentByEmail` **намеренно строже** (гейт по `last_sign_in_at`): он ставит email и шлёт письмо с claim-ссылкой — для заходившего такая ссылка тут же упёрлась бы в registered-гейт (мёртвая ссылка в письме); заходивший подключается кодом из ConnectStudentSheet.
- **Два формата, различаются длиной:** короткий **8 симв.** из алфавита referral (`ABCDEFGHJKMNPQRSTUVWXYZ23456789`, UPPERCASE, отображение `XXXX-XXXX` через `formatClaimCode`) — минтит RPC; legacy **32-hex** (ссылки в обороте работают вечно; `handleConnectStudentByEmail` тоже минтит hex — валидно). RPC ротирует legacy→короткий при следующем открытии ConnectStudentSheet (репетитор в этот момент видит новый код; ранее отправленная неоткрытая ссылка гаснет — принято). Нормализация ввода — `normalizeToken` в `student-claim` (strip дефисов/пробелов, регистр) + зеркало в `Login.tsx`.
- **Подбор кода** гасится rate-limit'ом по IP в `student-claim` POST: `_shared/throttle.ts::throttleCheck` (извлечён из `student-otp-request`, таблица `auth_otp_throttle`, fail-open), 60/15 мин (класс за CGNAT-IP). Энтропия 31^8 ≈ 8.5×10¹¹.
- **Вход по коду**: ученик открывает `/c/{код}` ИЛИ вводит код на `/login` (блок «У меня есть код от репетитора» → navigate `/c/{код}` — один claim-surface, `StudentClaimPage`). Шаг «Ещё один шаг» (почта+пароль) — **пропускаемый** («Позже», решение владельца): код многоразовый, доступ не теряется, надж повторится.
- **Security-модель (явное решение владельца):** код = стоячий bearer до регистрации; репетитор может войти в аккаунт своего незарегистрированного ученика — совпадает с существующей возможностью `reset-student-password`, гаснет при регистрации.
- **Гонки закрыты (ревью ChatGPT-5.6, 2026-07-20 — НЕ откатывать):** (а) TOCTOU в `student-claim` — re-check СВЕЖИХ `claim_token` + registered-гейта ПОСЛЕ `generateLink`, непосредственно перед `verifyOtp` (иначе параллельная регистрация → минт сессии на уже-зарегистрированный аккаунт по погашенному коду); (б) RPC-UPDATE несёт атомарный `NOT EXISTS(registered)` в WHERE (анти-«воскрешение» кода после регистрации); (в) kill-триггеры — retry-once; **residual `student-set-password`**: /parol-пользователь мог никогда не входить в веб → real email + `last_sign_in_at NULL` проходит registered-гейт, т.е. при финальном провале kill код остаётся жив на аккаунте с паролем — принятый remote-risk (transient сразу после успешного updateUserById), мониторить `set_password_token_kill_failed` в /admin «Ошибки».
- **Порядок деплоя пакета (КРИТИЧНО, ревью P1 #1):** edge (`student-claim` + kill-триггеры) → верифицировать live → миграция RPC → **фронт (`deploy-sokratai`) СТРОГО ПОСЛЕДНИМ**. Новый фронт на старом edge = «Позже» после одноразового consume → потеря сессии без пути назад (старый RPC блокирует переиздание по `last_sign_in_at`).
- Запись токена ТОЛЬКО через SECURITY DEFINER RPC `tutor_ensure_student_claim_token(p_tutor_student_id)` (ownership `auth.uid → tutors.id`, генерит-если-NULL атомарно, CAS `IS NOT DISTINCT FROM` + registered-`NOT EXISTS`) ИЛИ внутри `homework-api` под service_role.

**Новые edge-функции (минт сессии — паттерн `email-verify`/`oauth-google-callback`):**
- **`student-claim`** (`verify_jwt=false`): `GET ?t=` → OG-превью + redirect на SPA `/c/{token}` (mirror `invite-preview`, escapeHtml + no-store, **НЕ consume** — скрейперы безопасны); `POST {token}` → `admin.generateLink({type:'magiclink'})` → `verifyOtp({type:'magiclink'})` → session JSON + `tutor_name` + `preview` (anti-leak: только title/subject/N задач). Клиент `supabase.auth.setSession(...)`.
- **`student-register`** (`verify_jwt=true`): доустановка email+пароля поверх claim-сессии через `admin.updateUserById(uid, {password, email, email_confirm:true})` — смена email **БЕЗ верификации** (client `updateUser({email})` форсил бы письмо). Collision → 409 `EMAIL_TAKEN`. **Не новый signUp** (пользователь создан плейсхолдером).
- **`student-otp-request`** (`verify_jwt=false`): «войти по коду» — `admin.generateLink({type:'magiclink'})` → письмо через наш RU-safe email-пайплайн (`_shared/email-sender.ts::sendStudentLoginLinkEmail`) со ссылкой на `api.sokratai.ru/functions/v1/email-verify?type=magiclink` (НЕ `*.supabase.co`). Anti-enumeration: нейтральный ответ.
- **`email-verify`** расширен: `ALLOWED_TYPES += "magiclink"`. Tutor-role finalization для magiclink-входа ученика → skipped (signup_source не tutor). Redirect allow-list не трогать.

**Инварианты:** claim/register/otp вызываются клиентом через `supabase.functions.invoke` (anon-key в apikey+Authorization, rule 96 #11a — проходит и при verify_jwt true/false). Токены/PII не логируются. `/c/:token` — SPA вне AuthGuard (сам минтит). Persistent session уже сконфигурирована в `supabaseClient` (`persistSession`/`autoRefreshToken`). Контакт ученика опционален при добавлении (rule 60 ослаблено); канал/claim нужен до первой отправки ДЗ (гейт «Подключить» — `students_without_channel` в обоих assign-эндпоинтах `homework-api`, `ConnectStudentSheet`). Серверная воронка — `analytics_events` (service_role-only, PII-free, `_shared/analytics.ts`).

**Канонические файлы (доп.):** `supabase/functions/{student-claim,student-register,student-otp-request}/index.ts`, `_shared/analytics.ts`, `src/pages/StudentClaimPage.tsx` (`/c/:token`), `src/lib/studentClaimApi.ts`, `src/components/tutor/ConnectStudentSheet.tsx`, `src/utils/telegramLinks.ts::getStudentClaimShareLink`, `supabase/functions/homework-api/index.ts::{computeStudentsWithoutChannel,handleConnectStudentByEmail}`.

---

## Сброс пароля — recovery RU-bypass (2026-07-14)

`/forgot-password` (общий для учеников и репетиторов) → `resetPasswordForEmail(redirectTo: /reset-password)`. Цепочка:
- **`auth-email-hook`** — `rewriteConfirmationUrl` переписывает ссылки типов **`signup` / `recovery` / `magiclink`** на `api.sokratai.ru/functions/v1/email-verify?type=<тип>` (fallback redirect по типу: recovery → `/reset-password`). `email_change`/`invite`/`reauthentication` — не переписываются (нет verified-flow). `EMAIL_SUBJECTS` — русские.
- **`email-verify`** — `ALLOWED_TYPES = {signup, magiclink, recovery}` (обязан совпадать с `REWRITE_TYPES` хука). Для `recovery`: role/consent-финализация **пропускается** (существующий аккаунт; фатальный `role_failed` не должен ронять сброс), fallback redirect = `/reset-password`.
- **`ResetPassword.tsx`** — 3-state gate `checking|ready|invalid`: **НЕ полагаться на `PASSWORD_RECOVERY`** (событие стреляет при парсе hash ДО маунта lazy-страницы); любая сессия → форма, `INITIAL_SESSION` без сессии → карточка «ссылка истекла» + CTA `/forgot-password`; читает `?email_verify_error=` через `readAuthRedirectError`. После смены пароля — `signOut()` → `/login`.

## Смена пароля отзывает сессию → минтить свежую (КРИТИЧНО, 2026-07-20)

**Инвариант: любой `admin.updateUserById({password})` для ЗАЛОГИНЕННОГО пользователя ОБЯЗАН вернуть свежую сессию, а клиент — `setSession`.** GoTrue при смене пароля **удаляет ВСЕ session-строки**; access-token несёт `session_id` → мгновенно мёртв на GoTrue-валидирующих endpoint'ах (edge, `/auth/v1/user`), хотя PostgREST (только подпись+exp) ещё живёт. Симптом: ученик разлогинивается на СЛЕДУЮЩЕМ edge-запросе после регистрации/смены пароля (репорт Егора: «вылет на выборе класса»; клик по классу = 0 сетевых, просто экран поверх гонки 401→refresh-fail→signOut). ВПН — регулятор таймингов, не причина.

- **Канон — `_shared/mint-session.ts::mintFreshSession(admin, url, anonKey, email, expectedUserId)`**: `generateLink(magiclink)` → `verifyOtp` (паттерн `student-claim`) + **identity-гард `verifyData.user.id === expectedUserId`** (P2 ревью 5.6: конкурентная смена email могла бы отдать чужую сессию → при mismatch возвращаем null). Fail-soft: null → клиент на старой (не хуже).
- **Клиент ОБЯЗАН `setSession`** из ответа (`StudentClaimPage.handleRegister`, `Profile.tsx` смена пароля). Без этого фикс не работает — держит мёртвые токены.
- **`student-account` перечитывает АКТУАЛЬНЫЙ email** (`getUserById(user.id)`) перед минтом (снимок `user.email` мог устареть при гонке смены email).
- **Покрыто:** `student-register`, `student-account/update-password`. **Латентно так же (follow-up):** `tutor-account` (пароль репетитора), `tutor-manual-add-student` `reset-student-password` (кикает ученика с его устройства) — тот же `mintFreshSession`-паттерн при доработке.
- **Deploy:** `student-account` ОБЯЗАН быть в deploy-workflow (был пропущен — P1 ревью; фронт ждёт `data.session`, старый edge вернул бы только `{success:true}` → разлогин остаётся).

## Инвайт залогиненного ученика — one-click claim (2026-07-14)

`InvitePage` (`/invite/:code`) на маунте проверяет `getSession()` + best-effort `rpc('is_tutor')`: сессия ученика → карточка «Присоединиться к репетитору {имя}» (прямой `claimInvite`, `already_linked` = успех); сессия репетитора → предупреждение + «Выйти» (авто-claim для tutor запрещён). Ветки «email уже зарегистрирован» ОБЯЗАНЫ сохранять `pending_invite_code` в localStorage + переключать на login-режим — иначе привязка теряется навсегда (баг 2026-07-14: QR-инвайт зарегистрированного ученика молча не привязывал).

## OAuth state — компактный формат <255 символов + nonce-cookie (2026-07-14)

VK ID портил наш ~350-символьный state (PKCE-verifier внутри) → системный `invalid_state` у КАЖДОГО входа. Инварианты (+ фиксы ревью ChatGPT-5.6 р.1):
- **VK — server-side state store (КРИТИЧНО, 2026-07-14):** VK ID **корраптит/режет OAuth `state` длиннее ~128 символов**. Компактный подписанный state с inline PKCE-verifier = ~195 → VK ломает → `invalid_state` (why=`sig`/`malformed`) на КАЖДОМ входе; Яндекс (~128, без verifier) проходит. **Фикс:** payload (`redirectTo/intendedRole/codeVerifier/promo/ref`) кладётся в таблицу **`oauth_state_store`** (миграция `20260714160000`, service_role-only, one-time+TTL) под короткий handle (~32 симв.), в URL VK едет ТОЛЬКО handle. `oauth-vk-init` → `newStateHandle`+`storeOAuthState`, cookie=`handle`; `oauth-vk-callback` дискриминирует по `.`: содержит → legacy compact (verifyStateDetailed, rollout-fallback), нет → handle (`loadAndConsumeOAuthState` + nonce-check cookie==handle). **Никогда не класть PKCE-verifier VK в URL.** **Яндекс НЕ тронут** (128 работает, rule 10) — остаётся на `buildCompactStatePayload`+`signStateBounded`.
- Compact-путь (Яндекс + VK-rollback): state через `buildCompactStatePayload` (короткие ключи `r/o/i/v/p/f/t/n`, path-only redirect ≤120 симв., verifier 32 байта = RFC-минимум 43 символа, promo/ref ≤32) + `signStateBounded` — жёсткий бюджет `MAX_STATE_CHARS=240`. **Никогда не подписывать голым `signState` в init.**
- **Login-CSRF binding (двухэтапный выкат):** init ставит HttpOnly-cookie `sok_oauth_nonce_{vk|yandex}` (= `n` из state, `Path=/functions/v1/`, SameSite=Lax) через ручной 302 (`Response.redirect` не даёт заголовков); callback зовёт `verifyNonceCookie` ДО использования payload. HMAC доказывает целостность, но НЕ принадлежность браузеру — без cookie атакующий скармливает жертве свой callback-URL и логинит её в свой аккаунт. **Этап 1 — `NONCE_ENFORCE=false` (warn-only):** провал → лог `oauth_nonce_would_block`, вход НЕ блокируется. Флип в `true` ТОЛЬКО когда (а) init с Set-Cookie подтверждён на проде И (б) несколько дней без легитимных `would_block` в логах. Причина этапности: включить enforce при старом init на проде = заблокировать ВСЕ входы (compact-state уже несёт `n`, а cookie никто не ставит) — edge деплоится Lovable-sync'ом с непредсказуемым лагом. Legacy-state (без `n`) exempt всегда.
- Callback'и используют `verifyStateDetailed` + `normalizeStatePayload` (принимает и legacy long-key формат) и при провале редиректят с PII-free диагностикой `&why=sig|ttl|malformed|missing_fields|nonce_cookie_missing|nonce_mismatch&len=<N>`.
- `STATE_TTL_MS` = 30 мин (школьник на SMS-подтверждении легко превышает 10).
- Тексты `OAUTH_CALLBACK_ERRORS` (`src/lib/authErrors.ts`) — провайдер-нейтральные («сервис входа»), никогда не называть конкретного провайдера; префиксные коды `vk_*`/`yandex_*` ловит `translateProviderOAuthError`.

## Доп. инварианты фиксов ревью (2026-07-14, р.1)

- **`claim-invite` — серверный гейт репетитора:** аккаунт с ролью `tutor` получает **403 `TUTOR_ACCOUNT`** (проверка `user_roles`, сбой проверки → 500, НЕ fail-open). Клиентский `rpc('is_tutor')` в InvitePage — только UX (спрятать кнопку), читать `{data, error}` явно (`supabase.rpc` НЕ бросает исключений — молчаливый error = «ученик» = fail-open).
- **`ResetPassword` signOut:** проверять `{error}`; на сбое (RU DPI) — гарантированный `signOut({ scope: "local" })`, иначе recovery-сессия остаётся жить локально.
- **auth-email-hook:** signup-fallback = корень `sokratai.ru`, НИКОГДА `/tutor/home` (правило #9 — фолбэк общий для студентов); НЕ логировать exception-объект `new URL(...)` (в message вшита входная строка с token) и email получателя (правило #10).
- **`scripts/check-edge-deploy.mjs`:** зелёный вывод ТОЛЬКО по явному allow-list статусов; 5xx = failure, все таймауты = exit 2 (inconclusive) — никогда не «OK вычитанием».

## История

| Дата | Event | Spec/PR |
|---|---|---|
| 2026-05-03 | Phase B migration: Lovable → Selectel Moscow VPS (api.sokratai.ru) | CLAUDE.md «Network & Infrastructure» |
| 2026-05-04 | Patch B+1: rewriteToProxy для signed URLs | dc39116 |
| 2026-05-16 | RU auth critical fix — Rounds 1-3 (initial fix + reviewer feedback) | `~/.claude/plans/compressed-sparking-spindle.md` |
| 2026-07-06 | Tab-switch form-loss: `TutorGuard` `SIGNED_IN` (session-recovery на visibilitychange) → `checkAccess`→`setLoading(true)` размонтировал `/tutor` кабинет → потеря стейта форм ДЗ/ученик/задача. Фикс: тихая ре-верификация + 3-way `SIGNED_IN` (rule 5a) | memory `project_tab_switch_form_loss_2026_07_06.md` |
| 2026-07-20 | Пакет J2 (запросы №43/47/79, Егор/Елена): claim-код стал **коротким (8 симв.) и многоразовым до регистрации** (секция «Онбординг-активация v2» переписана — гейт «зарегистрирован», dual-format, rate-limit, kill-триггеры, TOCTOU-гарды); вход по коду на `/login`; Yandex/VK на `/invite/:code` (+`onBeforeRedirect` персист, consent-flush в AuthGuard); студенческое OG для `/invite/`+`/c/` (rule 95). Ревью ChatGPT-5.6: 5×P1+3×P2 закрыты (`9764722`). Порядок деплоя: edge → миграция `20260720120000` → фронт последним | memory `project_j2_onboarding_2026_07_20` |
| 2026-07-07 | Login DPI-resilience: `TutorLogin` email-вход висел на «Вход...» бесконечно (РФ-DPI роняет `signInWithPassword`/`is_tutor` — одиночные критичные запросы без таймаута). Фикс: `src/lib/authRetry.ts` (`callAuthWithRetry` — таймаут 10с/попытка + 1 ретрай ТОЛЬКО на сетевой сбой; `{error}` вроде неверного пароля резолвится без ретрая → fast-fail) + честный тост «Сеть не отвечает… попробуйте с VPN». **Инвариант: happy-path и auth-ошибки НЕ задеты** — таймаут/ретрай активны лишь при обрыве. Milada-репорт (у неё обе роли были, блок = сеть). Repro нельзя headless (нужны креды) — хелпер юнит-проверен в preview | `src/lib/authRetry.ts` |
| 2026-07-07 | 406-ФЗ: убран Google + Telegram-**вход** из UI; добавлены Yandex ID + VK ID (`_shared/oauth-helpers.ts` + кнопки `{Yandex,Vk}AuthButton`); email+пароль оставлен; Telegram-**бот** не тронут. Миграция Telegram-only (~30 акк.): бот `/parol` → `/set-password` → edge `student-set-password` ставит email+пароль на существующий аккаунт (история цела; reuse `telegram_login_tokens`, миграций нет; бот НЕ минтит сессию) | `~/.claude/plans/1-rustling-key.md` |
| 2026-07-14 | Авария: Lovable потерял 45/57 edge-функций (`NOT_FOUND_FUNCTION_BLOB`) → сломаны auth-письма/OTP/инвайты/добавление учеников/бот/оплаты. Восстановлено через Lovable MCP + `email_domain--setup_email_infra`. Фиксы поверх: recovery RU-bypass, one-click invite claim, компактный OAuth state (VK), русификация ошибок. Probe: `scripts/check-edge-deploy.mjs` (rule 95) | план `sharded-bouncing-popcorn.md` |
| 2026-07-08 | Онбординг-тупик #2: после signup без сессии (email-confirm) репетитора выкидывало тостом → покидал продукт. Фикс — **`src/components/auth/EmailConfirmWaiting.tsx`** (экран «Подтвердите почту» + `supabase.auth.resend({type:'signup'})` + «Изменить почту»), смонтирован в `RegisterTutor`/`TutorSignupTrial` вместо `toast+return`. **Чисто клиентский UX — email-verify edge / конфиг Supabase / назначение роли НЕ тронуты.** **Инвариант авто-впуска (review P1):** слушатель `onAuthStateChange` навигирует ТОЛЬКО на `SIGNED_IN` с `session.user.id !== baselineUserIdRef` (baseline пишется из `INITIAL_SESSION`); **НЕ реагировать на `INITIAL_SESSION`** — он реплеит текущую/устаревшую сессию на маунте и увёл бы уже-вошедшего (напр. ученика) на `/tutor/home` до подтверждения нового email | memory `project_activation_aha_left_shift_2026_07_08` |

При появлении новых regression'ов в auth flow в РФ — **сначала** проверь этот файл, потом runbook, потом plan-файл.
