
## Диагноз

Обе проблемы — следствие того, что фронтенд раздаётся с **собственного VPS** (`sokratai.ru` → Selectel Moscow), а не с Lovable Cloud. OAuth-инфраструктура и сессии Supabase ведут себя иначе, чем в preview.

### Проблема 1 — Google → 404

URL `https://sokratai.ru/~oauth/initiate?...` ловит 404 страницу React Router.

Причина: путь `/~oauth/*` обслуживается **прокси-воркером Lovable** на их CDN. У нас на VPS такого роута нет — nginx отдаёт запрос Vite-бандлу как обычную SPA-навигацию, а в React Router нет маршрута `/~oauth/initiate`, поэтому показывается NotFound.

Проще говоря: `lovable.auth.signInWithOAuth("google", ...)` рассчитан на хостинг внутри `*.lovable.app` или Lovable-managed custom domain, где воркер перехватывает `/~oauth/initiate` и `/~oauth/callback`. На своём VPS перехватывать некому.

### Проблема 2 — Telegram → бот подтвердил, но сайт не пускает

В Telegram пишет «Авторизация подтверждена», а на странице остаётся «Ожидание подтверждения». Скорее всего одна из двух причин (или обе):

1. **Polling упирается в CORS/прокси-таймаут.** Кнопка дёргает `https://api.sokratai.ru/functions/v1/telegram-login-token?token=...` каждые 2 сек напрямую через `fetch` (минуя `supabase.functions.invoke`). Если воркер/nginx режут `OPTIONS` preflight или GET без `apikey`, запрос фейлится.
2. **Edge function `telegram-login-token` помечает токен как `verified` только после того как `telegram-bot` получил `/start login_<token>` через webhook.** Webhook идёт на `https://vrsseotrfmsxpbciyqzc.supabase.co/functions/v1/telegram-bot` напрямую (Telegram → Supabase, минуя VPS). Это должно работать. Но если в логах функции `telegram-login-token` GET-запрос возвращает `pending` несмотря на бот-подтверждение — значит токен в БД не апдейтится из бота.

Нужно проверить логи обеих функций на проде.

---

## План действий

### Шаг 1 — Проверить логи на Supabase, чтобы подтвердить причину Telegram-бага

* `supabase--edge_function_logs(function_name: "telegram-login-token")` — посмотреть свежие GET-запросы и их ответы.
* `supabase--edge_function_logs(function_name: "telegram-bot")` — найти обработку `/start login_<token>` и убедиться, что апдейт токена в БД проходит успешно.
* Параллельно проверить через `browser--navigate_to_url` страницу `/signup?ref=tutor-landing&trial=7`, нажать «Войти через Telegram», и в `browser--list_network_requests` увидеть, что реально возвращает `telegram-login-token?token=...`.

### Шаг 2 — Починить Telegram-кнопку (минимально-рискованный фикс)

В зависимости от того, что покажут логи:

* Если GET-запрос к `telegram-login-token` фейлится с CORS — добавить `apikey`-заголовок к polling fetch (как делает Supabase SDK), либо переключить кнопку на `supabase.functions.invoke('telegram-login-token', ...)`.
* Если функция возвращает `pending`, хотя бот подтвердил — починить запись в БД на стороне `telegram-bot/handleWebLogin` (проверить, что `intended_role: "tutor"` корректно проставляет роль и не ломает upsert статуса токена).
* Дополнительно: уменьшить `delays` после установки сессии — сейчас 5 ретраев `is_tutor` с задержками до 3с, а свежесозданная роль через триггер уже доступна через ~500мс.

### Шаг 3 — Починить Google OAuth для VPS-хостинга

Тут два пути, нужно выбрать с вами:

**Вариант A (рекомендую) — Native Supabase Google OAuth, без Lovable broker**

Заменить `lovable.auth.signInWithOAuth("google", ...)` на `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: 'https://sokratai.ru/tutor/home' } })`. Это:

* Работает с любого хоста, OAuth-callback идёт на `https://api.sokratai.ru/auth/v1/callback` (наш прокси на Supabase Auth) — никакого `/~oauth/*` не нужно.
* Требует один раз настроить Google Cloud Console: добавить `https://api.sokratai.ru/auth/v1/callback` в Authorized Redirect URIs существующего OAuth Client.
* Требует включить Google provider в Supabase Auth (Lovable Cloud → Users → Auth Settings → Google) с теми же Client ID / Secret.

Файлы под правки:
* `src/components/GoogleAuthButton.tsx` — заменить `lovable.auth.signInWithOAuth` на `supabase.auth.signInWithOAuth`.
* Удалить импорт `@/integrations/lovable` из этого компонента.
* Сохранить логику стэшинга consent перед редиректом.

**Вариант B — оставить Lovable broker**

Поднять отдельный nginx reverse-proxy для путей `/~oauth/initiate` и `/~oauth/callback` на VPS, форвардить их на `https://oauth.lovable.app/...`. Это сложнее, привязывает прод к доступности Lovable proxy и не даёт никаких плюсов для конечного пользователя. Не рекомендую.

### Шаг 4 — Деплой

После правок кода:

```powershell
ssh -i "$HOME\.ssh\sokratai_proxy" root@185.161.65.182 "deploy-sokratai"
```

И проверить в браузере на `sokratai.ru/signup?ref=tutor-landing&trial=7`:
1. Кнопка «Продолжить с Google» → редирект на Google → callback → `/tutor/home`.
2. Кнопка «Войти через Telegram» → бот → возврат на сайт → автоматический заход в `/tutor/home`.

---

## Что я НЕ буду трогать

* `src/integrations/supabase/client.ts`, `src/integrations/supabase/types.ts`, `src/integrations/lovable/index.ts` — auto-generated.
* `src/components/AuthGuard.tsx`, `src/components/TutorGuard.tsx` — high-risk.
* Backend OAuth-настройки Supabase Auth (Google provider) — это Вы делаете в дашборде, либо я подскажу точный шаг.

---

## Решение, которое нужно от Вас

Подтвердите **Вариант A** для Google OAuth (нативный Supabase, требует один раз добавить redirect URI в Google Cloud Console и Client ID/Secret в Supabase Auth Settings). Если у Вас уже настроен свой Google OAuth Client в Lovable Cloud (BYOK) — те же креды просто переиспользуются. Если используется managed Lovable — нужно будет создать собственный OAuth Client в Google Cloud (5 минут, я дам пошаговую инструкцию после подтверждения).

После подтверждения я сразу приступаю к шагам 1→2→3→4.
