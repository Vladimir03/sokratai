# Runbook: репетитор не может зарегистрироваться в РФ

**Last updated:** 2026-05-16
**Owner:** Vladimir
**Severity:** P0 — блокирует growth (новые tutor signups)

## Симптомы

Пользователь в РФ без VPN (типично Windows / Chrome / Honor laptop) сообщает что не может зарегистрироваться через `/register-tutor`. Возможные жалобы:

1. **Google OAuth «петля»:** клик «Продолжить с Google» → Google → возврат на ту же страницу регистрации
2. **Telegram «зависло»:** клик «Войти через Telegram» → 5 минут ничего не происходит → timeout
3. **Email «не работает»:** заполняет форму, кликает «Зарегистрироваться» → нет видимой реакции, или сразу после клика «email уже занят»

## Карта блокировок РФ (май 2026)

| Домен/сервис | Статус | Почему |
|---|---|---|
| `*.supabase.co` (прямой) | **SNI-блокировка** | Roskomnadzor, активно с 2023 |
| `accounts.google.com` | Доступен | — |
| `oauth2.googleapis.com` | Доступен | — |
| `gstatic.com`/`recaptcha.net` | **CF 16-KB throttling** | Cloudflare middlebox, активно с июня 2025 |
| `t.me` / `telegram.org` | **SNI-throttling** + nationwide | С 10 фев 2026 |
| `oauth.telegram.org` (виджет) | Не загружается | SNI + CSP блокировки |
| `api.sokratai.ru` (Selectel Moscow) | **Работает 100%** | Наш bypass — direct VPS |

## Архитектура bypass

Наша инфра спроектирована, чтобы обойти блокировки:

```
sokratai.ru          → 185.161.65.182 (Selectel Moscow, nginx + dist/)
api.sokratai.ru      → 185.161.65.182 (тот же VPS, reverse proxy на Supabase)
oauth-google-init    → api.sokratai.ru/functions/v1/... (RU-bypass для Google)
oauth-google-callback→ api.sokratai.ru/functions/v1/... (RU-bypass)
email-verify         → api.sokratai.ru/functions/v1/... (RU-bypass для email confirm)
```

**`api.sokratai.ru` — Selectel direct, НЕ Cloudflare.** Это значит CF 16-KB throttling **не задевает** наш трафик.

## Диагностические шаги

### Шаг 1: попросить юзера открыть DevTools (Chrome F12) → вкладка Network

Что должно появиться при успешной регистрации (Email path):

| Запрос | Host | Статус | Время |
|---|---|---|---|
| `POST /auth/v1/signup` | `api.sokratai.ru` | 200 | < 2 сек |
| Если email confirm нужен | — | — | toast.info видим |
| Email в inbox со ссылкой на `api.sokratai.ru/functions/v1/email-verify?...&redirect_to={{ .RedirectTo }}` | — | — | ~30 сек |
| Клик в письме | `api.sokratai.ru` | 302 | — |
| Landing на `/tutor/home#access_token=...` (для tutor) или `/chat#access_token=...` (для student) | `sokratai.ru` | 200 | — |

Что **НЕ должно** появиться:

- ❌ `vrsseotrfmsxpbciyqzc.supabase.co` (любой URL) — означает что где-то осталась прямая ссылка, blocked в РФ
- ❌ `*.supabase.co` (любой subdomain)
- ❌ `(failed) net::ERR_CONNECTION_RESET` / `ERR_CONNECTION_CLOSED` / `ERR_SSL_PROTOCOL_ERROR` на `api.sokratai.ru`

### Шаг 2: проверить console logs

Должны быть structured events (после Fix G):

```
{"event":"tutor_signup_started","flow":"tutor_register","timestamp":"..."}
{"event":"tutor_signup_email_pending","flow":"tutor_register","timestamp":"..."}  // если email confirm
{"event":"tutor_signup_succeeded","flow":"tutor_register","timestamp":"..."}      // если успех
{"event":"oauth_google_init_clicked","flow":"google-oauth-tutor","timestamp":"..."}
{"event":"telegram_polling_timeout","flow":"tutor_telegram_login","attempts":150} // если TG timeout
```

Если событий **нет** — фронт-bundle устарел (не выполнен `deploy-sokratai`).

### Шаг 3: для Google OAuth loop

Открыть DevTools Network перед кликом «Продолжить с Google». Кликнуть.

Должна быть последовательность:

1. `GET https://api.sokratai.ru/functions/v1/oauth-google-init?redirectTo=https://sokratai.ru/tutor/home` → 302
2. `GET https://accounts.google.com/o/oauth2/v2/auth?...` → 200
3. (юзер кликает Continue в Google)
4. `GET https://accounts.google.com/...callback...` → 302 на `api.sokratai.ru/functions/v1/oauth-google-callback?code=...`
5. `GET https://api.sokratai.ru/functions/v1/oauth-google-callback?...` → 302 на `https://sokratai.ru/tutor/home#access_token=...`
6. Landing на `/tutor/home` — браузер парсит hash → supabase-js emit `INITIAL_SESSION` → AuthGuard пропускает

**Loop признак:** Если на шаге 5 пользователь снова попадает на `/register-tutor` — race condition в AuthGuard (Fix C должен это решать).

**Server-side проверка:** в Supabase Functions logs смотреть события `oauth_google_callback_failed` — там reason.

### Шаг 4: для Telegram «зависло»

Если на десктопе **без Telegram Desktop**:
- Клик «Войти через Telegram» → window.open(`t.me/sokratai_ru_bot?start=...`)
- На Windows без TG Desktop открывается web страница t.me, `?start=` НЕ передаётся боту
- → polling 5 мин → timeout

**Решение (Fix D):** теперь под кнопкой «Открыть Telegram снова» рендерится QR-код. Юзер сосканит с iPhone → откроется native TG → success.

Если QR не появляется — фронт-bundle устарел.

### Шаг 5: для email — проверить что письмо приходит и ссылка ведёт куда надо

1. Hover на ссылку «Подтвердить email» в письме (НЕ клик — посмотреть href)
2. Host должен быть `api.sokratai.ru/functions/v1/email-verify?token_hash=...&type=signup&redirect_to=https://sokratai.ru/tutor/home`
3. Если host = `vrsseotrfmsxpbciyqzc.supabase.co` → **Supabase Email Template не обновлён** (manual ops action, см. ниже)

## Manual unblock через SQL (emergency)

Если фикс не работает, и репетитор критичный — создать аккаунт вручную:

```sql
-- В Supabase SQL Editor, ровно эти три блока в одной транзакции:

-- 1. Create auth user (email_confirm: true ставит email_confirmed_at=now)
-- ВАЖНО: используй Supabase admin API, не direct INSERT в auth.users.
-- В Dashboard → Authentication → Users → "Add user" → Email + Password,
-- галочка "Auto Confirm User" = ON.

-- 2. После создания юзера через Dashboard, найди его user_id и выполни:
INSERT INTO public.user_roles (user_id, role)
VALUES ('<USER_ID_FROM_DASHBOARD>', 'tutor')
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.tutors (user_id, name, created_at)
VALUES ('<USER_ID_FROM_DASHBOARD>', '<TUTOR_NAME>', NOW())
ON CONFLICT (user_id) DO NOTHING;

-- 3. Trial activation (опционально):
UPDATE public.profiles
SET trial_started_at = NOW()
WHERE id = '<USER_ID_FROM_DASHBOARD>';
```

Отправь репетитору email + password в безопасном канале (Telegram прямое сообщение). Он войдёт через `https://sokratai.ru/tutor/login` → email-форма.

## Эскалация

1. **Если несколько репетиторов жалуются** → проверить Supabase Dashboard → Authentication → URL Configuration:
   - **Site URL** = `https://sokratai.ru` (НЕ `https://vrsseotrfmsxpbciyqzc.supabase.co`!)
   - **Additional Redirect URLs** включает `https://sokratai.ru/**`, `https://api.sokratai.ru/**`

2. **Если Email Template регрессировал** → Authentication → Email Templates → Confirm signup:
   - Body должен содержать `https://api.sokratai.ru/functions/v1/email-verify?token_hash={{ .TokenHash }}&type=signup&redirect_to={{ .RedirectTo }}`
   - **`{{ .RedirectTo }}` — per-call variable** из `signUp({ options: { emailRedirectTo: '...' } })`. RegisterTutor передаёт `/tutor/home`, SignUp — `/chat`, etc. ОДИН template обслуживает все типы юзеров; per-call значение выбирает правильную landing page.
   - НЕ `{{ .ConfirmationURL }}` (default — ведёт на блокированный домен)
   - НЕ хардкодить `redirect_to=https://sokratai.ru/tutor/home` — это сбросит student'ов на TutorGuard, который их выкинет обратно на /register-tutor.

3. **Если OAuth callback редиректит на supabase.co** → Google Cloud Console → OAuth Client → Authorized redirect URIs:
   - Должно быть `https://api.sokratai.ru/functions/v1/oauth-google-callback`

4. **Если api.sokratai.ru недоступен** → SSH на VPS:
   ```bash
   ssh -i "$HOME\.ssh\sokratai_proxy" root@185.161.65.182
   systemctl status nginx
   tail -50 /var/log/nginx/error.log
   ```

## Источники

- CLAUDE.md → секция «Network & Infrastructure»
- `.claude/rules/95-production-deploy.md` — deploy procedure
- Plan file: `~/.claude/plans/compressed-sparking-spindle.md` — initial root cause analysis
- [Mediazona — Russia's internet censorship in 2026](https://en.zona.media/article/2026/04/07/russian_internet_censorship_2026)
- [Cloudflare 16-KB throttling, июнь 2025](https://blog.cloudflare.com/russian-internet-users-are-unable-to-access-the-open-internet/)
