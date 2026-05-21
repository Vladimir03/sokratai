# Code Review Request — RU auth critical fix (SokratAI)

Привет. Прошу второй взгляд на critical-path security/correctness fix. У нас был production-блокер: новые репетиторы в РФ без VPN не могли зарегистрироваться **никаким** из трёх каналов (Google OAuth / Telegram / email). Внутри один файл — high-risk (`AuthGuard.tsx`), один новый edge function для email confirmation. Нужно подтвердить что фикс не открывает новых дыр и корректно решает root causes.

## Контекст

**SokratAI** — AI-платформа для репетиторов в РФ. Целевой пользователь: репетиторы ЕГЭ/ОГЭ. Stack: React/Vite/TypeScript frontend на Selectel Moscow VPS (`sokratai.ru`), backend Supabase через свой reverse-proxy `api.sokratai.ru` (тот же VPS).

**Почему свой proxy:** прямой домен `*.supabase.co` (наш проект на `vrsseotrfmsxpbciyqzc.supabase.co`) **заблокирован SNI-фильтром РКН в РФ**. Cloudflare-edge тоже частично блокируется (16-KB throttling с июня 2025). Поэтому весь user-facing трафик идёт через свой VPS в Москве (`api.sokratai.ru`), сервер делает forward на supabase.co с US-VPS side (без блокировки).

**Архитектура RU-bypass для auth (уже была сделана до этого фикса, не меняем):**

```
Google OAuth:
  Frontend → api.sokratai.ru/functions/v1/oauth-google-init (custom edge function)
           → 302 на accounts.google.com (с redirect_uri = api.sokratai.ru/functions/v1/oauth-google-callback)
           → юзер дал consent
           → 302 на api.sokratai.ru/functions/v1/oauth-google-callback?code=...
           → edge function делает server-to-server token exchange на oauth2.googleapis.com
           → создаёт supabase user через admin.createUser, минтит session через generateLink + verifyOtp
           → 302 на redirectTo#access_token=...&refresh_token=... (hash, не query)
           → supabase-js на landing'е парсит hash, emit INITIAL_SESSION, AuthGuard пропускает

Telegram:
  Frontend → fetch api.sokratai.ru/functions/v1/telegram-login-token?action=create → token T
           → window.open(https://t.me/sokratai_ru_bot?start=login_T)
           → юзер нажимает /start в боте → telegram-bot edge function видит deep link
           → admin.createUser + admin.generateLink + verifyOtp → session stored в telegram_login_tokens row
           → frontend polling каждые 2s видит status='verified' → setSession({access, refresh}) → navigate

Email/password:
  Frontend → supabase.auth.signUp() через api.sokratai.ru/auth/v1/signup
           → если email confirm required, Supabase отправляет письмо со ссылкой
           → юзер кликает в письме → ...тут была дыра, см. Fix B ниже
```

**Симптом бага:** новый репетитор (Honor laptop / Windows / Chrome / no VPN, регион РФ) сообщил что **никакой** из трёх auth-каналов на странице `/register-tutor` не работает:
- Google: бесконечная петля Sokrat → Google → Sokrat (возврат на ту же signup-страницу после consent)
- Telegram: «всё зависло» (polling 5 мин timeout)
- Email/password: «не получается ввести» (форма зависает после submit, нет видимой обратной связи)

## Root causes (расследование)

Идентифицированы 5 корневых причин (по убыванию вероятности):

1. **RegisterTutor silent fail при email confirm.** В `src/pages/RegisterTutor.tsx` после `supabase.auth.signUp()` НЕ проверялся `!authData.session`. Если Supabase Auth Settings требует email confirm, signUp возвращает `user` без `session`. Код продолжал и вызывал `supabase.functions.invoke("assign-tutor-role", ...)` БЕЗ user JWT → 401 → toast «Не удалось назначить роль» → юзер думает что не зарегистрировался. На самом деле аккаунт уже в `auth.users` с `email_confirmed_at=NULL`. Повторная попытка → `isExistingEmailError → true` → toast «Email уже занят» → dead-end. Sibling форма `TutorSignupTrial.tsx` уже имела правильную проверку — паттерн известен.

2. **Email confirmation link ведёт на заблокированный домен.** Supabase default email template рендерит `{{ .ConfirmationURL }}` → `https://vrsseotrfmsxpbciyqzc.supabase.co/auth/v1/verify?token=...`. Этот хост SNI-блокирован в РФ. Юзер кликает в письме — TLS handshake резетится middleware'ом РКН — ничего не происходит.

3. **Telegram t.me deep link не работает на Windows без TG Desktop.** `window.open("https://t.me/sokratai_ru_bot?start=login_TOKEN", "_blank")` на ноутбуке без установленного Telegram Desktop открывается в web-версии Telegram, где `?start=` параметр **не передаётся боту**. Bot никогда не получает /start → polling 5 мин timeout. На iOS работает (`window.location.href = url` triggers native app handler). Также `t.me` сам по себе SNI-throttled в РФ с 10 фев 2026.

4. **Google OAuth race condition в AuthGuard.** Edge function `oauth-google-callback` возвращает `redirectTo#access_token=...&type=signup`. Landing страница `/tutor/home` обёрнута в `AuthGuard`, который синхронно (в `useEffect`) делал `supabase.auth.getSession()` → возвращал `null` (hash ещё не распарсен supabase-js асинхронным `detectSessionInUrl`) → `navigate("/login")`. Юзер видит signup форму → кликает Google снова → loop. Hash-parse завершается через миллисекунды и эмитит `INITIAL_SESSION`, но навигация уже произошла.

5. **(Возможно) Cloudflare 16-KB throttling** ловит часть assets для reCAPTCHA на Google sign-in. Не подтверждено, не фиксили в этом коммите.

**Уже работало правильно (не трогали):**
- Custom Google OAuth flow через `oauth-google-init`/`callback` — правильная архитектура RU-bypass
- `src/lib/supabaseClient.ts` hardcode'ит `SUPABASE_URL = 'https://api.sokratai.ru'` — RU-bypass
- `TutorSignupTrial.tsx` (alternative trial signup form) имеет правильную проверку `!data.session`

## Что сделано в этом коммите (9 fix'ов, ~310 lines diff)

### Fix A — RegisterTutor session check (`src/pages/RegisterTutor.tsx`)

После `supabase.auth.signUp()` добавил guard mirror TutorSignupTrial: если `!authData.session` → toast.info + early return. Не вызываем `assign-tutor-role` без user JWT.

```typescript
if (authError) throw authError;

if (!authData.user) {
  throw new Error("Не удалось создать пользователя");
}

// Email confirmation gate (Phase 1, fix RU silent-fail 2026-05-16):
// When Supabase requires email confirm, signUp() returns user but no
// session. Without this guard, the next line (functions.invoke without
// user JWT) returns 401 → user sees confused «Не удалось назначить
// роль» error and abandons. Mirror TutorSignupTrial.tsx behaviour.
if (!authData.session) {
  console.warn(
    JSON.stringify({
      event: "tutor_signup_email_pending",
      flow: "tutor_register",
      timestamp: new Date().toISOString(),
    }),
  );
  toast.info(
    "Мы отправили письмо для подтверждения email. Откройте его и нажмите ссылку, чтобы завершить регистрацию.",
    { duration: 10000 },
  );
  return;
}

// Step 2: Assign tutor role via edge function
const { error: roleError } = await supabase.functions.invoke("assign-tutor-role", {
  body: { user_id: authData.user.id },
});
```

Аналогичный fix применён в `src/pages/SignUp.tsx` для студентов.

### Fix B — Custom email-verify edge function (NEW: `supabase/functions/email-verify/index.ts`)

Новый edge function (полный код ниже) — обходит блокировку confirmation link через свой proxy `api.sokratai.ru`. Принимает `token_hash` + `type` + `redirect_to`, валидирует, вызывает `verifyOtp()` через anon client, минтит session, делает 302 на `redirect_to#access_token=...`. Mirror архитектуры существующего `oauth-google-callback`. После deploy — обновить email template в Supabase Dashboard (manual ops, в runbook'е есть инструкция).

```typescript
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Cache-Control": "no-store",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const FALLBACK_LOGIN_URL = "https://sokratai.ru/login";

const ALLOWED_REDIRECT_ORIGINS = [
  "https://sokratai.ru",
  "https://sokratai.lovable.app",
  "http://localhost:8080",
  "http://localhost:3000",
];

const ALLOWED_TYPES = new Set([
  "signup", "magiclink", "recovery", "email_change", "invite",
]);

function isAllowedRedirect(target: string): boolean {
  try {
    const u = new URL(target);
    return ALLOWED_REDIRECT_ORIGINS.includes(`${u.protocol}//${u.host}`);
  } catch {
    return false;
  }
}

function redirectToError(reason: string, redirectTo?: string): Response {
  const target = new URL(
    redirectTo && isAllowedRedirect(redirectTo) ? redirectTo : FALLBACK_LOGIN_URL,
  );
  target.searchParams.set("email_verify_error", reason);
  return Response.redirect(target.toString(), 302);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const redirectTo = url.searchParams.get("redirect_to") || "https://sokratai.ru/tutor/home";

  if (!tokenHash || !type) {
    console.warn(JSON.stringify({ event: "email_verify_failed", reason: "missing_params", hasTokenHash: !!tokenHash, hasType: !!type, timestamp: new Date().toISOString() }));
    return redirectToError("missing_params");
  }

  if (!ALLOWED_TYPES.has(type)) {
    console.warn(JSON.stringify({ event: "email_verify_failed", reason: "invalid_type", type, timestamp: new Date().toISOString() }));
    return redirectToError("invalid_type");
  }

  // Token-hash sanity check — Supabase emits hex-ish strings.
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(tokenHash)) {
    console.warn(JSON.stringify({ event: "email_verify_failed", reason: "malformed_token_hash", tokenLen: tokenHash.length, timestamp: new Date().toISOString() }));
    return redirectToError("malformed_token");
  }

  if (!isAllowedRedirect(redirectTo)) {
    console.warn(JSON.stringify({ event: "email_verify_failed", reason: "redirect_not_allowed", redirectTo, timestamp: new Date().toISOString() }));
    return redirectToError("redirect_not_allowed");
  }

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.auth.verifyOtp({
    token_hash: tokenHash,
    type: type as "signup" | "magiclink" | "recovery" | "email_change" | "invite",
  });

  if (error || !data?.session) {
    console.error(JSON.stringify({ event: "email_verify_failed", reason: error?.message ?? "no_session", type, timestamp: new Date().toISOString() }));
    const errorCode = error?.message?.toLowerCase().includes("expired")
      ? "token_expired"
      : error?.message?.toLowerCase().includes("invalid")
        ? "token_invalid"
        : "verify_failed";
    return redirectToError(errorCode, redirectTo);
  }

  console.warn(JSON.stringify({ event: "email_verify_succeeded", type, timestamp: new Date().toISOString() }));

  const target = new URL(redirectTo);
  target.hash = new URLSearchParams({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_in: String(data.session.expires_in ?? 3600),
    token_type: "bearer",
    type,
  }).toString();

  return Response.redirect(target.toString(), 302);
});
```

Также добавил запись в `supabase/config.toml`:
```toml
[functions.email-verify]
  verify_jwt = false
```

### Fix C — AuthGuard race condition fix (`src/components/AuthGuard.tsx`, **HIGH-RISK FILE**)

⚠️ Этот файл помечен в CLAUDE.md как «High-Risk Files. Modify only if task explicitly requires». Делал минимальный additive fix.

**До:**
```tsx
useEffect(() => {
  supabase.auth.getSession().then(async ({ data: { session } }) => {
    if (!session) {
      navigate("/login");
      return;
    }
    setUserId(session.user.id);
    // ...profile fetch + onboarding check
    setLoading(false);
  });

  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    if (!session) {
      navigate("/login");
    }
  });
  return () => subscription.unsubscribe();
}, [navigate]);
```

**После:**
```tsx
const sessionHandled = useRef(false);

useEffect(() => {
  // RU OAuth bypass: custom oauth-google-callback returns
  // `redirectTo#access_token=...`. supabase-js parses URL hash asynchronously
  // and emits `INITIAL_SESSION`. If we call `getSession()` synchronously on
  // mount BEFORE the hash parse, we get null → navigate("/login") → loop.
  // Fix: wait for INITIAL_SESSION (fires exactly once, with session=null
  // OR session=<parsed>). Process auth decision only there.

  const handleSession = async (session: Session | null) => {
    if (sessionHandled.current) return;
    sessionHandled.current = true;

    if (!session) {
      navigate("/login");
      return;
    }

    setUserId(session.user.id);

    if (!claimAttempted.current) {
      claimAttempted.current = true;
      claimPendingInvite().catch(() => {});
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("onboarding_completed")
      .eq("id", session.user.id)
      .single();

    if (profile && !profile.onboarding_completed) {
      setShowOnboarding(true);
    }

    setLoading(false);
  };

  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "INITIAL_SESSION" || event === "SIGNED_IN") {
      void handleSession(session);
    } else if (event === "SIGNED_OUT") {
      sessionHandled.current = false;
      navigate("/login");
    }
  });

  return () => subscription.unsubscribe();
}, [navigate]);
```

### Fix D — Telegram QR-код для desktop без TG Desktop

В обоих `TutorTelegramLoginButton.tsx` (tutor) и `TelegramLoginButton.tsx` (student) добавлен additive QR-блок в polling state. Рендерится только когда `!isIOS()` (на iOS native deep link уже работает). Использует существующий в `package.json` `react-qr-code`.

```tsx
{currentToken && !isIOS() && (
  <div className="mt-2 flex flex-col items-center gap-2 rounded-md border border-border bg-card p-3 max-w-xs">
    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <Smartphone className="w-3.5 h-3.5" />
      <span>Нет Telegram на компьютере?</span>
    </div>
    <div className="bg-white p-2 rounded">
      <QRCode
        value={`https://t.me/${botName}?start=login_${currentToken}`}
        size={140}
        level="M"
      />
    </div>
    <p className="text-xs text-muted-foreground text-center leading-snug">
      Отсканируйте телефоном — откроется в Telegram, нажмите «Старт»
    </p>
  </div>
)}
```

QR-код кодирует тот же URL что и `window.open`, токен валиден 5 мин (server-side TTL).

### Fix E + F — Email-first redesign + UX hints (`/register-tutor`, `/tutor/login`)

Переставил layout: email-форма **наверху** (primary path), OAuth кнопки **снизу** как fallback. Divider «или альтернативно» вместо «или по email». Под OAuth — hint «Telegram и Google могут не работать в РФ без VPN. Если кнопки зависают — регистрируйтесь по email наверху».

В `SignUp.tsx` и `Login.tsx` (которые имеют `tst-grid` marketing layout с правой колонкой value prop) — layout не менял (intentional design contract), только усилил hint про РФ.

### Fix G — Structured telemetry events

Добавил `console.warn(JSON.stringify({ event, flow?, timestamp }))` events на ключевых auth-точках (PII-free):
- `tutor_signup_started` / `_email_pending` / `_succeeded` / `_existing_email` / `_role_assign_failed`
- `student_signup_email_pending`
- `oauth_google_init_clicked` (client) / `oauth_google_callback_succeeded` / `_failed` (server)
- `email_verify_succeeded` / `_failed` (server)
- `telegram_polling_timeout` (client)

Все события без PII (только flow tag, timestamp, иногда reason).

### Fix I — Support runbook

`docs/delivery/engineering/runbooks/tutor-cant-signup-ru.md` — диагностические шаги, что должно/не должно появиться в DevTools Network, manual unblock через SQL editor, эскалация.

## Что прошу проверить

### 1. Security (priority HIGH)

**email-verify edge function:**
- Open redirect: проверь, что `redirect_to` allow-list нельзя обойти (наследует от `oauth-google-init` тот же список оригинов). Особенно — что URL `https://sokratai.ru.evil.com` или `https://sokratai.ru@evil.com` не пройдут (`URL.host` сравнение должно их отсекать).
- Token replay attack: `verifyOtp` Supabase идемпотентен только в случае ошибки — consumed token → error → 302 на error page. ОК?
- Token forge: токен sign'ится Supabase project key — нельзя forge без service_role. ОК?
- Regex `/^[A-Za-z0-9_-]{16,256}$/` — достаточно ли защищает от injection в DB? Это pre-DB sanity check, реальная валидация в Supabase verifyOtp. Достаточно как cheap guard?
- CSRF concern: GET endpoint без CSRF token. Стандартный pattern для email confirmation links (Google, GitHub так делают). Reviewer agree?
- Rate limiting: нет на edge function. Token имеет 256-char entropy → brute-force не работает. OK?
- Что если `SUPABASE_URL` env var undefined — `Deno.env.get("SUPABASE_URL")!` (non-null assertion) → если undefined, createClient падает с TypeError → 500. Должен ли быть explicit pre-check + clean error?

**AuthGuard:**
- Subscription guarantee: гарантирует ли Supabase v2.58 что `INITIAL_SESSION` event **обязательно** выстрелит? Что если из-за browser quirk не выстрелит — юзер залипает на loader навсегда. Стоит ли добавить timeout fallback (например 5s → reload или manual `getSession()`)?
- `sessionHandled.current = true` блокирует обработку follow-up SIGNED_IN events. Сценарий: юзер делает `SIGNED_OUT` → `sessionHandled = false`, потом `SIGNED_IN`. Будет ли это re-trigger handleSession корректно? Текущая логика только в SIGNED_OUT сбрасывает флаг — кажется правильным, но прошу подтвердить.
- `TOKEN_REFRESHED` event не обрабатывается. Раньше тоже не обрабатывался (тот же код, только если session=null → navigate). Сейчас TOKEN_REFRESHED игнорируется — потенциальная проблема, если refresh failed и нет нового session, юзер останется на authenticated UI. Но supabase-js при failed refresh обычно эмитит SIGNED_OUT через свою логику. OK?
- Race condition с child components (`TutorGuard` имеет module-level cache + retry logic) — могу ли я сломать TutorGuard этим refactor'ом? TutorGuard монтируется только когда AuthGuard пропустил children. К этому моменту session уже есть. Должно быть ОК.

### 2. Correctness

- **RegisterTutor session check:** правильный паттерн? Сравни с TutorSignupTrial.tsx (тот же fix, проверенный):
  - TutorSignupTrial: `if (!data.session || !data.user) { toast.info(...); return; }`
  - RegisterTutor: `if (!authData.user) throw; if (!authData.session) { toast.info(...); return; }`
  - Сначала проверяет user (throw error если null), потом session. Эквивалентно или есть нюанс?

- **email-verify**: верно ли что `verifyOtp` на anon client (НЕ admin) — стандартный путь для email confirmation? `oauth-google-callback` использует тот же pattern. Не пропустил ли я что-то?

- **Telegram QR**: QR-код имеет тот же URL что `window.open()`. Если юзер сначала кликает «Войти через Telegram», открывает t.me в браузере (не работает), потом сканит QR на iPhone — токен один и тот же. iPhone Telegram сделает /start → bot верифицирует → polling на ноуте видит verified. Cross-device flow. Правильно? Возможные edge case: токен expired (5 мин TTL) к моменту сканирования. Тогда сервер вернёт expired, polling видит и сбрасывает state. ОК.

### 3. Edge cases / robustness

- Что если юзер кликает «Зарегистрироваться» дважды быстро (double-click)? `setLoading(true)` блокирует второй submit, button `disabled={loading || !consent}`. ОК.
- Что если юзер закрывает email tab, ждёт 24+ часа, потом кликает confirmation link? Token expired → error page. ОК.
- Что если юзер кликает в письме на ноутбуке без VPN, но мы пока не обновили Supabase Email Template — link ведёт на старый домен → блокируется. Это manual ops action, документировано в Deploy section. ОК.
- Что если `OAUTH_INIT_URL` в `GoogleAuthButton` недоступен (network error) — `window.location.href = initUrl` тогда зависнет/выдаст «Сайт недоступен» в браузере. UX-плохо, но не security issue. Прокомментируй приоритет.

### 4. UX / consistency

- Email-first layout правильно расставлен? Email primary, OAuth fallback с явным hint про РФ?
- Hint текст «Telegram и Google могут не работать в РФ без VPN» — нормальный или нужно мягче?
- Toast.info на email pending — длительность 10 sec достаточно?
- В `SignUp.tsx` я не менял layout (marketing-style 2-col grid), только добавил session check + усилил hint. Это намеренное решение — design layout сохраняется. OK?

### 5. Telemetry purity

Все события через `console.warn(JSON.stringify({...}))`:
- Нет email/password/user_id в payload
- Только `flow` tag (`tutor_register` / `student_signup` / `google-oauth-tutor` etc.) + `timestamp` + `reason` (для failures)
- Server-side events в edge functions смотрятся в Supabase Functions logs
- Reviewer проверь нет ли утечек PII в каком-либо событии

## Что я уже проверил

- `npm run lint` — 7 errors на изменённых файлах, **6 — pre-existing** `any` в `catch (error: any)` (не трогал, baseline issue репо), **1 — мой новый regex с лишним escape**, починил. Чисто.
- `npm run build` — green (39.54s, dist/ size в пределах нормы).
- `npm run typecheck` — clean.
- `npm run smoke-check` — passed (только non-blocking compat warnings, не auth-related).
- Preview DOM verification: `/register-tutor` и `/tutor/login` рендерят email-first layout корректно, OAuth кнопки и hints видны, console errors отсутствуют.

## Не покрыто этим коммитом (отдельный backlog)

- VK ID / Yandex ID OAuth как RU-native альтернативы — отдельной спекой
- Auto-login без email confirmation — намеренно оставили confirm flow (защита от spam)
- Captcha перед email signup — полагаемся на Supabase rate-limit
- Production verification — попросим репетитора повторить с DevTools network capture после deploy

## Output format

Прошу:
1. **Severity rating** для каждой находки: `BLOCKER` (нельзя мержить) / `P1` (мерж OK, фикс в follow-up) / `P2` (улучшение) / `Nit` (cosmetic)
2. **Конкретные line references** где видишь проблему (например, "email-verify/index.ts:123 — XYZ")
3. **Recommended action**: что менять и почему
4. **Spotted positives** — что сделано хорошо (помогает калибровать пайплайн)

Длинный ответ ОК. Длина важна меньше, чем нахождение реальных дыр. Особенно интересует:
- **email-verify edge function security review** (новый код, security surface)
- **AuthGuard race condition fix correctness** (high-risk файл, race conditions хитрые)
- **Cross-flow consistency**: не сломал ли я что-то существующее (TutorGuard cache, OAuth callback chain, telemetry-purity)

Спасибо!
