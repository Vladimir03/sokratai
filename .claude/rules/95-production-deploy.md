# Production Deploy Procedure (Selectel VPS, post-2026-05-03)

## Контекст

После миграции 2026-05-03 (Phase B), `sokratai.ru` обслуживается с собственного **Selectel VPS Москва** (IP `185.161.65.182`). Lovable Cloud **больше не обновляет прод-домен автоматически** — Lovable теперь только для preview (`sokratai.lovable.app`).

Это значит: **любое изменение frontend кода в GitHub НЕ доходит до пользователей `sokratai.ru` без явного ручного deploy**.

## КРИТИЧЕСКОЕ ПРАВИЛО ДЛЯ AI АГЕНТОВ

После завершения любой задачи, затрагивающей frontend bundle, AI агент **ОБЯЗАН** в финальном сообщении пользователю добавить блок-напоминание о deploy. Без этого пользователь может забыть, и изменения никогда не попадут в прод.

### Шаблон напоминания

```markdown
### 🚀 Deploy needed

Изменения коснулись frontend кода: <список затронутых директорий/файлов>

Чтобы пользователи `sokratai.ru` увидели обновление:

1. SSH на VPS:
   ```
   ssh -i "$HOME\.ssh\sokratai_proxy" root@185.161.65.182
   ```
2. Запустить деплой:
   ```
   deploy-sokratai
   ```
3. Дождаться `✅ Deploy complete` (~2-5 минут)
4. Проверить `https://sokratai.ru/` — изменения видны

Lovable preview (`sokratai.lovable.app`) обновится автоматически после push в GitHub.
Прод (`sokratai.ru`) — только после `deploy-sokratai`.
```

## Триггеры — когда показывать напоминание

### ✅ ОБЯЗАТЕЛЬНО показывать после изменений в:

- `src/**/*.{ts,tsx,js,jsx,css,scss,html}` — компоненты, страницы, хуки, lib, утилиты
- `index.html`
- `package.json`, `package-lock.json` (новые / обновлённые npm-deps)
- `vite.config.ts`, `tailwind.config.ts`, `tsconfig*.json`, `postcss.config.*`
- `public/**` — статические ассеты, иконки, manifest.json
- `src/integrations/supabase/types.ts` — auto-generated, но влияет на сборку
- Любые правки, требующие `npm run build` для применения

### ❌ НЕ показывать напоминание при изменениях только в:

- `supabase/migrations/**` — миграции БД (Lovable Cloud применяет автоматически)
- `supabase/functions/**` — edge functions (Lovable Cloud деплоит в Supabase)
- `supabase/config.toml`
- `docs/**`, `.claude/**`, `AGENTS.md`, `CLAUDE.md`, `README.md` — документация
- `scripts/**` — dev-only скрипты, не входят в production bundle
- `.github/**` — CI/CD конфиги

### ⚠️ Mixed случаи (обычная разработка)

Если PR содержит **и** frontend, **и** backend изменения (типичный сценарий — новый feature, который требует и UI, и SQL миграцию + edge function):

- **Сначала** Lovable Cloud сам применит миграции и edge functions при push.
- **Потом** нужен `deploy-sokratai` для frontend.

В этом случае напоминание показывается с уточнением:

```markdown
### 🚀 Deploy needed

Изменения коснулись frontend и backend:
- Backend (миграции/edge functions) — Lovable Cloud применит автоматически после push
- Frontend (`src/...`) — нужен ручной deploy на VPS

Запустите:
   ```
   ssh -i "$HOME\.ssh\sokratai_proxy" root@185.161.65.182
   deploy-sokratai
   ```
```

## Проверка состояния прод-версии

Если AI агент хочет узнать, какая версия сейчас на проде, использовать:

```bash
ssh root@185.161.65.182 'cd /opt/sokratai && git log -1 --oneline'
```

Сравнить с локальным `git log -1 --oneline` или GitHub HEAD. Если хеши **разные** — прод отстаёт от main, нужен `deploy-sokratai`.

## Скрипт `/usr/local/bin/deploy-sokratai`

Скрипт на VPS делает:

1. `git pull --ff-only` в `/opt/sokratai`
2. `npm ci --prefer-offline --no-audit --no-fund`
3. `npm run build` (с `NODE_OPTIONS="--max-old-space-size=2048"` — у VPS 1 GB RAM + 2 GB swap)
4. `rm -rf /var/www/sokratai/* && cp -r dist/* /var/www/sokratai/`
5. `nginx -t && systemctl reload nginx`
6. `curl https://sokratai.ru/` — healthcheck

Полный исходник скрипта: при необходимости `cat /usr/local/bin/deploy-sokratai` через SSH.

## OG-варианты `/invite/` и `/c/` — студенческое превью ссылок (№47, 2026-07-20)

Пригласительные ссылки (`sokratai.ru/invite/{code}`, `sokratai.ru/c/{код}`) — SPA-пути; без спец-обработки боты соцсетей скрейпят глобальный OG из `index.html` («инструмент репетитора… 200 ₽») — пугает ученика (репорт Елены, №47).

**Решение — статический файл + nginx (НЕ edge-URL):** postbuild-скрипт `scripts/generate-og-variants.mjs` (хук `postbuild` в `package.json`, работает и на VPS внутри `deploy-sokratai`) копирует `dist/index.html` → `dist/invite-og.html`, меняя title/description/og:*/twitter:* на студенческие («Тебя пригласили в Сократ AI», зеркало `invite-preview`) + `robots noindex`. **Fail-loud:** переделали OG-блок `index.html` так, что маркер не матчится → скрипт валит build (правь регэкспы скрипта синхронно с OG-блоком). Edge-URL в шаринге отвергнут осознанно (rule 96 #11a: агентский деплой Lovable флипает `verify_jwt=true` → 401 на browser-navigation = ученики вообще не могут зайти).

**nginx на VPS (разовый ops-шаг, конфиг НЕ в репо):** в server-блок `sokratai.ru` НАД SPA-fallback `location /`:

```nginx
# Student-friendly OG для приглашений (№47). Fallback на index.html —
# безопасен при откате на билд без postbuild-скрипта.
location ^~ /invite/ { try_files /invite-og.html /index.html; }
location ^~ /c/      { try_files /invite-og.html /index.html; }
```

`nginx -t && systemctl reload nginx`. Браузер и бот получают ОДИН файл: боты читают метатеги, браузер грузит тот же SPA (asset-пути абсолютные `/assets/*`), редиректов нет. При пересборке VPS — восстановить эти 2 location из этого файла. Известное ограничение: Telegram кэширует OG per-URL — ранее расшаренные ссылки обновятся при пере-скрейпе (форс — @WebpageBot), новые — сразу.

## Откат сломанного деплоя

Если после `deploy-sokratai` прод упал:

```bash
ssh root@185.161.65.182
cd /opt/sokratai
git log --oneline | head -5
git checkout <hash-предыдущего-рабочего-коммита>
NODE_OPTIONS="--max-old-space-size=2048" npm ci
NODE_OPTIONS="--max-old-space-size=2048" npm run build
cp -r dist/* /var/www/sokratai/
systemctl reload nginx
```

## Tutor data-fetch errors — tiered status, без ложного «VPN»-алярма

Прямое следствие RU-сети: фронт ходит на `api.sokratai.ru` (прокси на VPS → Supabase через границу), и RU DPI вероятностно рвёт ~1 из N параллельных TLS-соединений. Поэтому **запросы tutor-кабинета падают точечно даже при рабочем интернете**. Раньше это давало ложный красный баннер «Не получается подключиться / включите VPN» поверх загруженного кабинета (репорт Elena, 2026-06-02).

**Единый компонент — `src/components/tutor/TutorDataStatus.tsx` (tiered-only). Инварианты:**
- **Никакого OR-of-N.** Не агрегируй ошибки нескольких запросов в один баннер. `criticalError` ставится **только** когда у surface нет полезного контента (не загрузились несущие данные: профиль/ученики на `/tutor/home`, слоты/занятия на расписании). Любой упавший **блок** при отрисованной странице — `degraded` (тихая строка), не баннер. Иначе воспроизводишь баг «баннер поверх данных».
- **«Тихо → громко».** Критичный сбой сначала = тихий «Обновляем данные…» + молчаливый авто-ретрай; нейтральный янтарный баннер — только после `escalateAfterMs` (дефолт 25с; для пустых/sole-element экранов передавай ~8с). Баннер сам исчезает при первом успехе.
- **Самоизлечение.** `onAutoRetry` (быстрый, только критичные запросы) vs `onRetry` (ручная кнопка + медленный degraded self-heal). Тутор не должен перезагружать страницу руками.
- **Нейтральный текст, без обвинения сети.** `toTutorErrorMessage` (`src/hooks/tutorQueryOptions.ts`) для сетевых ошибок возвращает page-specific дефолт, **не** «включите VPN / виновата ваша сеть» — узкое место наш кросс-граничный хоп, а не сеть тутора.

**При новом tutor-surface / новом запросе:** используй `TutorDataStatus` (не свой баннер); реши явно critical vs degraded (по умолчанию degraded — баннер только когда «кабинет реально пуст»); на многозапросной странице — split, не OR. История/spec: memory `project_tutor_connectivity_banner.md`.

## Service Worker — битая загрузка модулей (octet-stream) под РФ-DPI (2026-06-29)

**Класс бага, который легко уводит диагностику на часы.** Симптом: фича/таблица/блок **не рендерится у пользователя**, ХОТЯ данные корректны (подтверждены в БД И в сыром ответе сети) И код корректен (подтверждён в **задеплоенном** бандле). На guided-homework это всплыло как «таблица „Разбор по критериям“ (`ai_criteria_json`) не появляется ни у ученика, ни у репетитора», но причина — общая для всего приложения.

**Сигнатура в консоли (ищи ИМЕННО это):**
- `Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "application/octet-stream".`
- `Uncaught (in promise) TypeError: Failed to convert value to 'Response'.` ← источник `service-worker.js`
- `The FetchEvent for "…" resulted in a network error response: the promise was rejected.`
- рядом — `Service Worker: Registered successfully https://sokratai.ru/`.

**Быстрая диагностика (2 шага, без деплоя):**
1. **Сервер чист?** `curl -I https://sokratai.ru/assets/<chunk>-<hash>.js | grep -i content-type`. Если `application/javascript` → nginx ни при чём, `octet-stream` целиком от SW. (Если вдруг `application/octet-stream` от nginx — тогда серверный MIME, чини nginx, не SW.)
2. **Воспроизводится в инкогнито?** Если в **свежем** инкогнито баг есть → это **логика** SW, а не устаревший кеш (SW регистрируется заново и сразу `claim()`-ит страницу). Если в инкогнито всё ок → застрявший кеш у юзера (разовый сброс ниже).

**Корень (что именно ломается):** под РФ-DPI обрывается `fetch` чанка → в `fetch`-обработчике `public/service-worker.js` `catch(() => caches.match(req))` при пустом кеше возвращает **`undefined`** → `event.respondWith(undefined)` → модуль-скрипт «приходит» пустым → браузер трактует как `application/octet-stream` → strict-MIME-проверка ES-модулей не проходит → чанк не исполняется → фича, которую он рисует, молча исчезает. (Фикс — commit `18094d9`.)

**Инварианты SW fetch-handler (НЕ нарушать):**
- **НИКОГДА `respondWith(undefined)`.** Любая ветка `respondWith` обязана вернуть валидный `Response`: кешированный, сетевой, либо `Response.error()` (настоящая сетевая ошибка — восстановима reload'ом, в отличие от пустышки→octet-stream).
- **`isHashedAsset()` обязан матчить хеши Vite** — `name-<hash>.js|css`, base62 **смешанного регистра** (`4cjyIRNK`, `CqLFP3xM`). Старый `/[a-f0-9]{8,}/` (только нижний hex) не матчил НИ ОДИН реальный чанк → все шли по хрупкому network-first. Регэксп: `/-[A-Za-z0-9_-]{8,}\.(?:js|css)(?:\?.*)?$/`.
- **Хешированные чанки → cache-first** (контент-адресуемы, иммунны к обрывам на повторных загрузках).
- **+1 ретрай сетевого fetch** для GET-чанков (гасит «1 из N» DPI-обрывов; rule про tiered tutor-errors — про тот же DPI).
- **Менял логику кеширования SW → бампни `CACHE_NAME`** (`v3→v4…`) — `activate`-хендлер чистит старый (возможно отравленный) кеш.

**Помни:** `sokratai.ru` ∈ `PROD_HOSTS` → SW тут работает (rule 70 поправлена). На **локальном dev SW принудительно unregister'ится** → этот баг локально НЕ воспроизвести, только на prod/preview-хосте. Эмердженси для юзера: `?sw=off` (kill-switch, `src/lib/swKillSwitch.ts`) на один чистый заход, либо DevTools → Application → Service Workers → Unregister + Clear site data.

**Forward-guard (рекомендация):** добавить smoke-check, который грепает `public/service-worker.js` на `respondWith(undefined)`-паттерны и проверяет, что `isHashedAsset` матчит образец Vite-хеша — чтобы регрессия не уехала тихо. Файлы: `public/service-worker.js`, `src/registerServiceWorker.ts`, `src/lib/swKillSwitch.ts`. Build-лог: memory `project_sw_octet_stream_fix_2026_06_29.md`.

## Anti-patterns для AI агентов

❌ **НЕ делать:**

1. Не предполагать что Lovable автоматически обновит прод после push в GitHub. Lovable обновит только `sokratai.lovable.app`, не `sokratai.ru`.
2. Не предлагать «redeploy через Lovable» как способ обновить прод — это больше не работает.
3. Не модифицировать DNS-записи `sokratai.ru` или `api.sokratai.ru` без полного понимания последствий — они указывают на `185.161.65.182` (наш VPS), смена ломает прод для всех RU-пользователей.
4. Не пытаться «исправить» хардкод `https://api.sokratai.ru` в `src/lib/supabaseClient.ts` — это намеренно (см. CLAUDE.md «Network & Infrastructure»).
5. Не упрощать deploy-сообщение — пользователь должен явно увидеть команду, инфра не self-evident для тех, кто не помнит детали миграции.

## Будущие улучшения

В планах (tech debt):

- **GitHub Actions auto-deploy** — после push на main, GitHub runner билдит и rsync-ит на VPS, deploy-sokratai становится не нужен. Когда это случится — это правило перепишется на «push в main = автодеплой».
- **Version manifest для emergency force-update** — `dist/version.json` + client-side `versionCheck.ts` + force-reload banner при mismatch с `minSupportedVersion`. Spec: `docs/delivery/features/service-worker-prod/spec.md` §5 + TASK-6/7 (P1, deferred). Пока что emergency recovery через `?sw=off` kill-switch (P0, live с 2026-05-04, см. `src/lib/swKillSwitch.ts`).
- ~~**Tutor-side push opt-in UI**~~ — **ЗАКРЫТО 2026-07-12**: `PushOptInBanner` удалён, заменён `NotificationsNudge` (push + установка PWA) у ОБЕИХ ролей + постоянный вход в профилях. `isPushSupported` починен на `PROD_HOSTS` (был мёртв на проде `sokratai.ru`). Детали — rule 100. Осталось (P1): iOS-онбординг «Установи на экран Домой» (без установки iOS 16.4+ push не работает — telegram-fallback покрывает).

## Массовая потеря edge-функций (инцидент 2026-07-14) + probe-скрипт

**Симптом у пользователей:** toast «Failed to send a request to the Edge Function» (supabase-js `FunctionsFetchError` — браузер вообще не получил CORS-валидный ответ). **Не путать** с «Edge Function returned a non-2xx status code» (`FunctionsHttpError` — функция жива, вернула ошибку).

**Что случилось:** Lovable молча потерял деплой **45 из 57** функций — gateway отдавал `404 NOT_FOUND_FUNCTION_BLOB` (заголовок `sb-error-code`). Упали: все auth-письма (`auth-email-hook` + `process-email-queue` + cron очередей), `telegram-bot`, `yookassa-webhook`, инвайты, ручное добавление учеников, пробники. Выжили только недавно тронутые функции.

**Диагностика (первый шаг при «Failed to send a request»):**
```
node scripts/check-edge-deploy.mjs
```
Пробит OPTIONS каждой функции репо через `api.sokratai.ru`: `404` = не задеплоена, `503` = boot-crash, остальное = ок. Точечная проверка: `curl -i -X OPTIONS https://api.sokratai.ru/functions/v1/<fn>` — тело 404 от gateway содержит `NOT_FOUND_FUNCTION_BLOB` (nginx-прокси ни при чём).

**Восстановление:** через Lovable MCP — `send_message` агенту проекта sokratai со списком пропавших функций и явным запретом менять код (`supabase--deploy_edge_functions` умеет батч). Проект: `5fbe4a32-1baf-47b0-8f47-83e3060cf929` (workspace `20Ig6HFTcoC1Z2kC6hG9`).

**Lovable-MCP: чего ждать (подтверждено 2026-07-15, миграция+функция `client-error-report`).** Тот же `send_message` работает и для «примени миграцию из репо + задеплой новую функцию» — но агент **применяет миграцию СВОИМ тулом `supabase--migration`**, а не файлом из репо → **создаёт ДУБЛЬ-миграцию** (`<ts>_<uuid>.sql` с тем же SQL) и **коммитит её в main** (+ регенерит `src/integrations/supabase/types.ts` — это полезно). Дубль **не удалять**: обе идемпотентны (`drop constraint if exists` + `create or replace function`), порядок по timestamp даёт то же конечное состояние; удаление применённой миграции запрещено (AGENTS.md → Database rules). После MCP-вызова **обязательно `git pull`** — иначе следующий push уедет в конфликт. Мой файл-миграция всё равно нужен (source of truth для чистой пересборки БД). Гейт `verify_jwt=false` агент в этом прогоне **уважил** (проверил keyless POST → 400, не 401) — но инвариант rule 96 §11a («агентский deploy-тул может включить JWT-гейт») остаётся: публичный клиент всё равно шлёт anon-ключ. Fallback: touch-коммит (тривиальный комментарий в `index.ts` каждой функции) → push → Lovable sync. После восстановления писем — попросить агента прогнать `email_domain--setup_email_infra` (идемпотентно: cron + wake-trigger `process-email-queue` + Vault-секрет) и проверить регистрацию `auth-email-hook` как send-email hook. **Готча:** верифицированный sender-домен = `notify.sokratai.ru` — `SENDER_DOMAIN` в `_shared/email-sender.ts` обязан совпадать (иначе `no_matching_sender`).

## pg_cron + SCHEDULER_SECRET: секрет ОБЯЗАН лежать в Vault (инцидент 2026-07-15)

Все cron-джобы аутентифицируются `'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SCHEDULER_SECRET')`. **Обнаружено: секрета `SCHEDULER_SECRET` в Vault НЕ БЫЛО вообще** → `'Bearer ' || NULL = NULL` → guard функций отбивал каждый тик 401 → **все SCHEDULER_SECRET-кроны (`tutor-plan-expiry-reminder-daily`, `activation-reminder-21-msk`, ceo-digest-*) молча не работали** — возможно, с момента создания. Симптомов ноль: cron.job active=true, функции живые, просто ничего не происходит.

**Инварианты:**
- Значение в Vault ОБЯЗАНО совпадать с edge-секретом `SCHEDULER_SECRET` (guard сравнивает точно). Ротация → синхронно оба места.
- **Новый cron-джоб → чеклист верификации:** (1) `SELECT name FROM vault.secrets` — секрет существует; (2) прогнать команду джоба вручную (`SELECT net.http_post(...)` тем же SQL) и проверить ответ функции 200, а не 401; (3) функция задеплоена sync-путём (`verify_jwt=false` уважен — см. rule 96 §11a: агентский деплой Lovable включает JWT-гейт, и gateway отбивает Bearer-секрет как «не JWT» ДО входа в функцию).
- Диагностика «cron молчит»: `SELECT status, (response).status_code FROM net._http_response ORDER BY id DESC LIMIT 10` (если журнал включён) либо ручной прогон команды джоба.

## Edge-функции деплоит Lovable, GitHub-CI deploy СЛОМАН (2026-06-08)

Edge-функции (`supabase/functions/**`) деплоит **Lovable на синк main**, НЕ GitHub Actions. Workflow `.github/workflows/deploy-supabase-functions.yml` **падает на каждом push** (секрет `SUPABASE_ACCESS_TOKEN` пуст, регрессия минимум с 2026-06-05) → это dead weight, на него полагаться нельзя.

**Симптом:** запушил фикс edge-функции, а прод отдаёт старое поведение / boot-crash. Это **Lovable lag / не синканулся**, а НЕ код. Проверка: `curl` функцию — `503` = boot-crash (не задеплоилось/упало при старте), `401` = задеплоено и живо (JWT-гейт), `404` = функции нет.

**Чтобы edge-изменение доехало в прод/preview:** открой/синкни Lovable-проект (он подтянет main и передеплоит функции). Чинить CI «по-настоящему»: задать секрет `SUPABASE_ACCESS_TOKEN` (GitHub → repo Settings → Secrets → Actions) ИЛИ выключить workflow, чтобы убрать ложный red. **Frontend — отдельно**, по-прежнему `deploy-sokratai` (VPS); Lovable edge-deploy его НЕ обновляет.
