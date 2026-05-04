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
- **Service Worker для sokratai.ru** — сейчас отключён (см. `src/registerServiceWorker.ts` — registers только на `sokratai.lovable.app`). Когда SW заработает на нашем хостинге, повторные визиты будут моментальными.
