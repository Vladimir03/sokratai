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

## Канонические файлы (не дублировать логику)

| Файл | Назначение |
|---|---|
| [src/lib/supabaseClient.ts](src/lib/supabaseClient.ts) | Hardcoded `SUPABASE_URL = 'https://api.sokratai.ru'`. Никогда не fall through на `import.meta.env.VITE_SUPABASE_URL` |
| [src/lib/consent.ts](src/lib/consent.ts) | `ConsentSource` union, `recordConsent`, `applyPendingConsent`. Mirror `TUTOR_SIGNUP_SOURCES` если расширяешь |
| [src/components/AuthGuard.tsx](src/components/AuthGuard.tsx) | Student routes guard. Waits for INITIAL_SESSION |
| [src/components/TutorGuard.tsx](src/components/TutorGuard.tsx) | Tutor routes guard. Module-level cache + INITIAL_SESSION wait |
| [src/components/GoogleAuthButton.tsx](src/components/GoogleAuthButton.tsx) | Common Google OAuth init. `intendedRole` prop default `student` |
| [src/components/TutorTelegramLoginButton.tsx](src/components/TutorTelegramLoginButton.tsx) | Tutor Telegram flow + QR fallback |
| [src/components/TelegramLoginButton.tsx](src/components/TelegramLoginButton.tsx) | Student Telegram flow + QR fallback |
| [supabase/functions/email-verify/index.ts](supabase/functions/email-verify/index.ts) | RU-bypass email confirmation. Exact `TUTOR_SIGNUP_SOURCES` allow-list |
| [supabase/functions/oauth-google-init/index.ts](supabase/functions/oauth-google-init/index.ts) | Custom OAuth init. Path+query intent derivation |
| [supabase/functions/oauth-google-callback/index.ts](supabase/functions/oauth-google-callback/index.ts) | Custom OAuth callback. isNewUser guard, role finalization fatal-on-fail |
| [docs/delivery/engineering/runbooks/tutor-cant-signup-ru.md](docs/delivery/engineering/runbooks/tutor-cant-signup-ru.md) | Support runbook |

---

## Известные deferred follow-ups (Round 4 review)

После 3 раундов ChatGPT-5.5 code review остались **non-blocking** improvements:

1. **P1 — OAuth consent flush gap.** GoogleAuthButton stash'ит `consentSource` в sessionStorage, но после OAuth round-trip landing на `/tutor/home` или `/chat`, **где нет listener'а** для `applyPendingConsent` (старый page-level listener мёртв после редиректа на Google). Audit trail compliance gap, не блокирует функциональность. **Решение (deferred):** carry `consentSource` в signed OAuth state → flush server-side в `oauth-google-callback` (mirror email-flow pattern с `consent_intent`).

2. **P2 — Error UI invisible.** `email-verify` redirect'ит role failure на `/login?email_verify_error=role_finalization_failed`, OAuth callback — на `/login?oauth_error=...`. Login.tsx / TutorLogin.tsx **не читают** эти query params → юзер видит обычный login screen, не понимает что произошло. **Решение (deferred):** добавить `useEffect` с `useSearchParams` на Login + TutorLogin, mapping error codes на toast.error с user-friendly текстом.

При работе над любой из этих задач — соблюдай Rules 1-11 выше.

---

## История

| Дата | Event | Spec/PR |
|---|---|---|
| 2026-05-03 | Phase B migration: Lovable → Selectel Moscow VPS (api.sokratai.ru) | CLAUDE.md «Network & Infrastructure» |
| 2026-05-04 | Patch B+1: rewriteToProxy для signed URLs | dc39116 |
| 2026-05-16 | RU auth critical fix — Rounds 1-3 (initial fix + reviewer feedback) | `~/.claude/plans/compressed-sparking-spindle.md` |

При появлении новых regression'ов в auth flow в РФ — **сначала** проверь этот файл, потом runbook, потом plan-файл.
