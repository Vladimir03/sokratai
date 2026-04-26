# Cloudflare Worker Reverse Proxy для Supabase

Last updated: 2026-04-26

## Зачем

Российские провайдеры (Ростелеком, МТС, Билайн, etc.) блокируют все поддомены `*.supabase.co` на DNS/IP уровне. Без обхода блокировки приложение SokratAI не работает у пользователей в РФ — login зависает, ДЗ не загружаются, в DevTools видно `ERR_CONNECTION_RESET` на запросах к `vrsseotrfmsxpbciyqzc.supabase.co`.

## Решение (архитектура)

```
Browser (RU)
   │
   ▼
sokratai.ru                          (Lovable Cloud frontend, через Cloudflare DNS only)
   │  static HTML/JS/CSS — не блокируется RU ISP
   ▼
api.sokratai.ru                      (Cloudflare Worker reverse proxy)
   │  Cloudflare anycast IP — не блокируется RU ISP
   ▼
vrsseotrfmsxpbciyqzc.supabase.co     (Supabase backend: Auth, REST, Storage, Realtime, Edge Functions)
```

Worker прозрачно проксирует все Supabase API endpoints:

- `/auth/v1/*` — GoTrue auth
- `/rest/v1/*` — PostgREST API
- `/storage/v1/*` — Storage (включая signed URLs)
- `/realtime/v1/websocket` — WebSocket для realtime подписок
- `/functions/v1/*` — Edge Functions (homework-api, telegram-bot, chat, etc.)

## Инфраструктура

### Cloudflare DNS

- Домен `sokratai.ru` управляется через Cloudflare DNS (NS: `chelsea.ns.cloudflare.com`, `coleman.ns.cloudflare.com`).
- Регистратор остаётся reg.ru, NS делегированы на Cloudflare.
- A `sokratai.ru` → `185.158.133.1` (Lovable origin), **DNS only** (серое облако) — не проксируется через CF, идёт напрямую на Lovable.
- CNAME `www` → `sokratai.ru`, **DNS only**.
- A `api.sokratai.ru` → автоматически настроено через Cloudflare Worker Custom Domain, **proxied** (оранжевое облако).
- Lovable-инфра живёт под NS-делегацией `notify.sokratai.ru` → `ns3.lovable.cloud` / `ns4.lovable.cloud`.

### Cloudflare Worker

- **Имя:** `sokratai-supabase-proxy`
- **Custom domain:** `api.sokratai.ru`
- **Health endpoint:** `https://api.sokratai.ru/__health` → JSON `{"status":"ok","upstream":"vrsseotrfmsxpbciyqzc.supabase.co"}`
- **План:** Cloudflare Free + Workers Free tier (100k req/day) — для пилота с большим запасом.

### Worker code

Канонический исходник Worker'а: см. `docs/delivery/engineering/architecture/cloudflare-proxy-worker.js` (если присутствует) или текущий код Worker'а в Cloudflare Dashboard.

Ключевые свойства:

- Отбрасывает CF-internal заголовки (`cf-connecting-ip`, `cf-ipcountry`, etc.) перед передачей в апстрим.
- Прозрачный пробрасс всех остальных заголовков (Authorization, apikey, Content-Type).
- Поддержка WebSocket upgrade для Supabase Realtime (нативно поддерживается Cloudflare runtime).
- На сетевой сбой — `502` с маркером `error: "upstream_unreachable"`.

## Контракт для клиентского кода (КРИТИЧНО)

**Любой код, обращающийся к Supabase, ДОЛЖЕН использовать `import.meta.env.VITE_SUPABASE_URL` как источник истины.**

Запрещено:

- ❌ Хардкодить `https://vrsseotrfmsxpbciyqzc.supabase.co` в строке.
- ❌ Конструировать URL через `https://${PROJECT_ID}.supabase.co/...`.
- ❌ Использовать `https://${PROJECT_ID}.functions.supabase.co/...` (это другой домен Supabase для функций — он тоже блокируется).

Разрешено:

- ✅ `import.meta.env.VITE_SUPABASE_URL` напрямую.
- ✅ Fallback `import.meta.env.VITE_SUPABASE_URL || 'https://api.sokratai.ru'` для preview-сборок.
- ✅ Использование Supabase JS клиента (`@/integrations/supabase/client` и `@/lib/supabaseClient`) — он сам читает env.

## Инвариант для PR-ревью

При добавлении нового файла, который делает HTTP-запросы к Supabase, грепнуть до коммита:

```bash
git diff --staged | grep -E "supabase\.co|supabase\.in"
```

Любое совпадение, кроме комментариев или fallback-строк с `api.sokratai.ru`, — блокер для merge.

## Env vars

| Переменная | Lovable Production | Назначение |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://api.sokratai.ru` | Канонический Supabase endpoint для клиента |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `eyJhbGci...` (анонимный JWT) | API-ключ Supabase (anon role), безопасен для frontend |

Сами edge functions (Supabase) **не используют** `api.sokratai.ru` — они работают внутри Supabase инфраструктуры, прокси им не нужен.

## Storage signed URLs

Когда `VITE_SUPABASE_URL = https://api.sokratai.ru`, signed URLs от Supabase Storage возвращаются в формате `https://api.sokratai.ru/storage/v1/object/sign/<bucket>/<path>?token=<jwt>`. JWT токен валидируется по project signing key, не по hostname — поэтому работает через прокси без проблем.

Bucket whitelist для AI-multimodal путей (`HOMEWORK_AI_BUCKETS` в `supabase/functions/_shared/image-domains.ts`) **не зависит** от хостинга — он валидирует только `storage://<bucket>/<path>` префикс.

## Миграция (исторический контекст)

Phase 1 — Cloudflare DNS setup (2026-04-26): NS reg.ru → Cloudflare, импорт всех 7 DNS-записей, переключение A/CNAME на DNS only (Lovable не должен идти через CF proxy).

Phase 2 — Worker deployment (2026-04-26): создан `sokratai-supabase-proxy`, привязан к `api.sokratai.ru` через Custom Domain, протестирован healthcheck.

Phase 2A — Code patch (2026-04-26): обновлены 10 файлов клиента + index.html. Все хардкоды Supabase URL заменены на `VITE_SUPABASE_URL` или fallback на `api.sokratai.ru`. См. commit history.

Phase 2B — Lovable env update + production deploy (2026-04-26).

## Откат (rollback)

Если прокси-инфраструктура отказала и нужно срочно вернуть прямой доступ:

1. В Lovable env: `VITE_SUPABASE_URL` обратно на `https://vrsseotrfmsxpbciyqzc.supabase.co` → Redeploy.
2. Прод вернётся к старому состоянию за 1-3 минуты (RU пользователи снова не смогут зайти, не-RU работают как раньше).
3. Worker и Cloudflare-зону трогать не надо — они продолжают существовать как fallback инфраструктура для повторной активации.

Worker и Cloudflare DNS — независимая infra, может пережить миграции SokratAI кода.

## Мониторинг

- **Cloudflare Worker Metrics:** Cloudflare Dashboard → Workers & Pages → sokratai-supabase-proxy → Metrics. Видны req/sec, errors, CPU time.
- **Healthcheck endpoint:** `curl https://api.sokratai.ru/__health` — для внешнего uptime monitoring (UptimeRobot, etc.).
- **Лимит Free tier:** 100,000 запросов в сутки. При приближении — апгрейд на Workers Paid ($5/мес = 10M req/мес).

## High-risk zones

Изменение Worker'а или DNS-зоны Cloudflare = высокорискованная операция, потенциально ломающая прод для всех RU пользователей одновременно. Перед изменением:

1. Тестируйте на `*.workers.dev` URL (preview Worker), не сразу в proxy на `api.sokratai.ru`.
2. Healthcheck `api.sokratai.ru/__health` + `api.sokratai.ru/auth/v1/health` после любого изменения Worker code.
3. При изменении DNS — `whatsmydns.net` проверка пропагации.
4. Откат — в Worker'е есть кнопка **Rollback to previous deployment** в Deployments tab. 1 клик, ~10 секунд.
