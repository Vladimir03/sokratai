# CLAUDE.md

Project context for Claude Code.

---

# Project

SokratAI — AI platform for tutoring and homework automation.

Main domains:
- Student platform
- Tutor platform
- AI homework checking
- Telegram bot integration

Stack:

Frontend
- React
- TypeScript
- Vite
- React Query

Backend
- Supabase
- Edge Functions

AI
- Gemini
- Lovable AI Gateway

---

# Network & Infrastructure (КРИТИЧНО — RU bypass, 2026-05-03 Phase B)

Российские провайдеры блокируют как поддомены `*.supabase.co`, так и интермиттентно — Cloudflare/Lovable CDN edge'ы. Поэтому **весь production-трафик SokratAI обслуживается с собственного российского VPS в Москве** (Selectel, IP `185.161.65.182`). Один сервер раздаёт фронтенд и проксирует API на Supabase.

```
sokratai.ru (Selectel VPS Moscow, nginx)
    │ frontend — раздаётся как статика из /var/www/sokratai/
    │ обновляется командой `deploy-sokratai` (см. ниже)
    │
    │ Cloudflare DNS only (серое облако) → A 185.161.65.182
    │ Lovable Cloud НЕ обслуживает прод-домен sokratai.ru
    │ Lovable preview остаётся на sokratai.lovable.app (для dev/QA)
api.sokratai.ru (Selectel VPS Moscow, тот же nginx, reverse proxy)
    │ /__health → локальный JSON
    │ /* → vrsseotrfmsxpbciyqzc.supabase.co (Auth, REST, Storage, Realtime, Edge Functions)
    │
    │ Cloudflare DNS only → A 185.161.65.182
vrsseotrfmsxpbciyqzc.supabase.co (Supabase, без изменений)
    │ DB, Auth, Edge Functions — деплоятся через Lovable Cloud при push в GitHub
    │ Прокси-сервер только пересылает HTTP, ничего не меняет в backend
```

**История миграции:**
- **Phase A (2026-04-26):** Cloudflare Worker `api.sokratai.ru` как reverse proxy на Supabase. Помогло частично, но Worker через CF edge ARN/Stockholm имел интермиттентные обрывы для RU-провайдеров (Ростелеком/Краснодар).
- **Phase B (2026-05-03):** мигрировали на собственный Selectel VPS Москва. Стабильность 100% для RU-пользователей. Cloudflare Worker оставлен в задеактивированном виде как fallback. Lovable Cloud переведён в режим preview-only (`sokratai.lovable.app`).
- **Patch B+1 (2026-05-03, commit dc39116):** signed URLs от Supabase Storage теперь rewrite'ятся в edge functions на `api.sokratai.ru` host (см. `_shared/proxy-url.ts`). Без этого фото задач не грузились у RU-юзеров (signed URL вёл прямо на supabase.co host'ом).
- **Patch B+2 (2026-05-04, PR #107 + #108):** edge function image validators расширены чтобы принимать **оба** хоста (`api.sokratai.ru` + direct `*.supabase.co`). Без этого student photos из `homework_tutor_thread_messages.image_url` (хранятся с proxy host после B+1) отвергались как `external_https_url` → AI отвечал «ты прислал только условие задачи, решения нет». Также добавлен mirror helper `rewriteToDirect()` в `_shared/proxy-url.ts` — server-to-server fetches в edge functions идут direct, экономя 200-400ms US→RU→US roundtrip. Single source of truth для proxy host: `SUPABASE_PROXY_URL` const из `_shared/proxy-url.ts`.

## VPS — критичные параметры

| Параметр | Значение |
|---|---|
| Hostname | `sokratai` |
| IPv4 | `185.161.65.182` |
| Регион | Москва (ru-7a) |
| Provider | Selectel Cloud |
| Tariff | Shared Line, 1 vCPU 50% / 1 GB RAM / 10 GB SSD |
| Cost | ~922 ₽/мес (server + Floating IP) |
| OS | Ubuntu 24.04 LTS |
| nginx | 1.24 |
| SSL | Let's Encrypt via certbot DNS-01 (Cloudflare API), auto-renewal `certbot.timer` |
| SSH | port 22, **только publickey** (password disabled), fail2ban active |
| Firewall | UFW: только 22/80/443 inbound |
| Swap | 2 GB (для npm run build) |

## Production Deploy Procedure

⚠️ **КРИТИЧЕСКОЕ ПРАВИЛО ДЛЯ AI АГЕНТОВ:** Lovable Cloud **больше не обновляет прод-домен** `sokratai.ru` автоматически. После любого изменения, затрагивающего frontend bundle, прод-пользователи **не увидят** изменения, пока не выполнен ручной deploy.

Подробное правило-триггер для AI: `.claude/rules/95-production-deploy.md`. Любой агент, делающий frontend-изменения, **обязан** добавить в финальное сообщение блок «🚀 Deploy needed».

**Команда для деплоя** (на VPS):

```bash
ssh -i "$HOME\.ssh\sokratai_proxy" root@185.161.65.182
deploy-sokratai
```

Скрипт `/usr/local/bin/deploy-sokratai` выполняет: `git pull` → `npm ci` → `npm run build` → копирование `dist/` в `/var/www/sokratai/` → `nginx reload` → healthcheck. Занимает 2-5 минут.

**Когда deploy НЕ нужен:**
- Изменения только в `supabase/migrations/**` или `supabase/functions/**` — Lovable Cloud сам деплоит на Supabase, прокси транзитом передаёт запросы.
- Изменения только в `docs/**`, `.claude/**`, `CLAUDE.md`, `README.md`, `scripts/**` (dev-only).

**Когда deploy НУЖЕН:**
- Любые изменения в `src/**`, `index.html`, `package.json`, `vite.config.ts`, `tailwind.config.ts`, `public/**`.
- Обновление env-переменных, влияющих на VITE_* (на VPS нужен .env с актуальным значением).

## Hard rules для нового кода

- **Single source of truth** для Supabase URL = жёсткая строка `'https://api.sokratai.ru'` в коде клиента (см. `src/lib/supabaseClient.ts`).
- **НЕ полагаться** на `import.meta.env.VITE_SUPABASE_URL` — Lovable Cloud автоматически выставляет её в `https://vrsseotrfmsxpbciyqzc.supabase.co` (прямой домен, заблокирован в РФ) и **не даёт** механизма переопределения.
- Для нового кода, делающего HTTP-запрос к Supabase: либо использовать `supabase` клиент из `@/lib/supabaseClient` (рекомендуется), либо хардкодить строку:
  ```ts
  // HARDCODED — see src/lib/supabaseClient.ts for rationale (RU bypass, ignore Lovable auto-env).
  const SUPABASE_URL = 'https://api.sokratai.ru';
  ```
- В **edge functions**, генерирующих signed URLs для browser clients (через `client.storage.from(...).createSignedUrl(...)`), **обязательно** оборачивать возвращаемые URL helper'ом `rewriteToProxy()` из `supabase/functions/_shared/proxy-url.ts`. Без этого signed URL вернётся с host'ом `vrsseotrfmsxpbciyqzc.supabase.co` → браузер RU-юзера упрётся в блокировку.
- В **edge functions, валидирующих signed URLs прочитанные из БД** (Patch B+2 invariant), validator **обязан** принимать **оба** host: direct (`Deno.env.get("SUPABASE_URL")`) И proxy (`SUPABASE_PROXY_URL` из `_shared/proxy-url.ts`). Без этого URL'ы сохранённые с proxy host (e.g. `homework_tutor_thread_messages.image_url` после `rewriteToProxy()`) будут отвергнуты как `external_https_url`. Канонический паттерн: `(supabaseUrl && url.startsWith(${supabaseUrl}/storage/v1/object/sign/)) || url.startsWith(${SUPABASE_PROXY_URL}/storage/v1/object/sign/)`.
- В **edge functions, делающих server-side `fetch()` на signed URL** (e.g. `inlinePromptImageUrl` в `guided_ai.ts`), оборачивать URL в `rewriteToDirect()` из `_shared/proxy-url.ts` перед fetch'ем. Server-to-server fetches идут US→US, конвертация в direct host экономит 200-400ms US→RU→US roundtrip.
- **НЕ хардкодить** `"https://api.sokratai.ru"` в новом коде edge functions. Импортировать `SUPABASE_PROXY_URL` (full URL) или `SUPABASE_PROXY_HOST` (hostname only) из `_shared/proxy-url.ts`.
- **ЗАПРЕЩЕНО** в любом виде:
  - хардкод `https://vrsseotrfmsxpbciyqzc.supabase.co` в строке клиентского кода;
  - конструкция `https://${PROJECT_ID}.supabase.co/...` или `https://${PROJECT_ID}.functions.supabase.co/...`;
  - использование `VITE_SUPABASE_PROJECT_ID` для построения URL;
  - паттерн `import.meta.env.VITE_SUPABASE_URL || '...'` — fallback никогда не сработает в проде, env всегда определена;
  - прямой импорт `@/integrations/supabase/client` (auto-generated, читает env, ведёт на прямой домен). Только `@/lib/supabaseClient`.

## Pre-merge check

Перед любым PR, добавляющим HTTP-запрос к Supabase, грепнуть staged changes:

```bash
git diff --staged | grep -E "supabase\.co|supabase\.in"
```

Любое совпадение, кроме комментариев или fallback-строк с `api.sokratai.ru`, — блокер для merge. Для edge functions, возвращающих signed URLs клиенту — убедиться что они обёрнуты в `rewriteToProxy()`.

## Env vars (Lovable Cloud)

| Переменная | Значение в production | Назначение |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://vrsseotrfmsxpbciyqzc.supabase.co` (auto-managed Lovable, **игнорируется** клиентским кодом) | Lovable Cloud API integration metadata |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `eyJhbGci...` (anon JWT) | API-ключ Supabase (anon role) — **используется**, валиден для proxy |

⚠️ **`VITE_SUPABASE_URL` остаётся равной прямому домену** — это Lovable-авто-managed переменная, у нас нет инструмента её переопределить. Клиентский код намеренно её игнорирует и хардкодит `https://api.sokratai.ru`.

`VITE_SUPABASE_PROJECT_ID` больше **не используется** клиентским кодом (был удалён в Phase 2A, 2026-04-26).

## Storage signed URLs (Patch B+1 / B+2)

Signed URLs от Supabase Storage генерируются edge functions через server-side SDK. SDK использует internal env `SUPABASE_URL = vrsseotrfmsxpbciyqzc.supabase.co` (Supabase auto-injects, мы не можем переопределить на стороне edge function без потери производительности — server-to-server queries должны идти localhost'ом).

**Outbound (browser-facing) — `rewriteToProxy` (B+1, commit dc39116):** в edge functions, возвращающих signed URLs клиенту, оборачиваем URL helper'ом `rewriteToProxy()` из `supabase/functions/_shared/proxy-url.ts`. Helper заменяет хост на `api.sokratai.ru`. JWT-токен подписан project signing key, не привязан к хосту — через прокси работает.

**Inbound (validator, B+2, PR #107):** signed URLs, попавшие в БД с proxy host'ом (`homework_tutor_thread_messages.image_url`, например), затем читаются обратно в edge functions для AI. Validators обязаны принимать **оба** host'а через OR: `(supabaseUrl && url.startsWith(${supabaseUrl}/storage/v1/object/sign/)) || url.startsWith(${SUPABASE_PROXY_URL}/storage/v1/object/sign/)`. Direct path не удалять — legacy DB rows и server-side SDK URLs продолжают использовать direct host.

**Server-side fetch — `rewriteToDirect` (B+2, PR #107):** перед `fetch()` в edge function на signed URL, оборачиваем helper'ом `rewriteToDirect()` из того же `_shared/proxy-url.ts`. Конвертирует `api.sokratai.ru` обратно в direct host для US→US fetch без Moscow roundtrip (-200..400ms). Безопасно: server fetches не упираются в RU ISP блокировки.

**Single source of truth для proxy host (B+2 hardening, PR #108):** `SUPABASE_PROXY_HOST` (hostname only) и `SUPABASE_PROXY_URL` (full URL with `https://`) экспортируются из `_shared/proxy-url.ts`. Не хардкодить `"https://api.sokratai.ru"` в новом коде — импортировать константу.

**Места применения `rewriteToProxy` (browser-facing):**
- `supabase/functions/homework-api/index.ts` — 3 callsite (materials/signed-url, createSignedStorageUrl helper, tasks/image-url)
- `supabase/functions/public-homework-share/index.ts` — 1 callsite (createSignedStorageUrls)

**Места применения dual-host validators (B+2):**
- `supabase/functions/chat/index.ts:isValidImageUrl` — через `ALLOWED_IMAGE_DOMAINS` массив с обоими хостами
- `supabase/functions/homework-api/guided_ai.ts:isAllowedSignedStorageUrl` — OR обоих host префиксов
- `supabase/functions/homework-api/index.ts:getLatestStudentImageUrls` — inline OR обоих хостов
- `supabase/functions/_shared/image-domains.ts:buildAllowedSignedUrlPrefixes` — принимает `string | string[]`

**НЕ оборачиваем в `rewriteToProxy` в edge functions, где signed URL используется server-to-server:**
- `supabase/functions/chat/index.ts` — fetches signed URL server-side для конвертации в base64 (для AI). Browser не задействован, RU блокировки не применяются.
- `supabase/functions/telegram-bot/index.ts` — фото отдаются через Telegram CDN (Telegram сам кеширует), не напрямую с supabase.co.

## Откат

Два уровня отката, в зависимости от типа сбоя.

### Откат frontend deploy (если новый build сломал прод)

На VPS:

```bash
ssh -i "$HOME\.ssh\sokratai_proxy" root@185.161.65.182
cd /opt/sokratai
git log --oneline | head -5  # выбрать предыдущий рабочий коммит
git checkout <hash>
NODE_OPTIONS="--max-old-space-size=2048" npm ci
NODE_OPTIONS="--max-old-space-size=2048" npm run build
cp -r dist/* /var/www/sokratai/
systemctl reload nginx
```

Прод откатывается к указанному коммиту за ~3 минуты.

### Откат всей инфраструктуры (если VPS лежит)

Worst case: Selectel VPS не отвечает или сильно деградировал. Возврат на старую инфру (Lovable Cloud для frontend, Cloudflare Worker для backend):

1. **DNS в Cloudflare:**
   - `A sokratai.ru` обратно на `185.158.133.1` (Lovable IP) — DNS only
   - `A api.sokratai.ru` удалить
2. **Worker `sokratai-supabase-proxy`** в Cloudflare — добавить обратно Custom Domain `api.sokratai.ru` (Workers & Pages → Settings → Domains & Routes → Add).
3. Распространение DNS — 1-5 минут.
4. Прод вернётся в Phase A состояние (sokratai.ru на Lovable, api.sokratai.ru через CF Worker). RU пользователи получат обратно интермиттентные обрывы, но не-RU работают.

⚠️ Code (хардкод `https://api.sokratai.ru` в `src/lib/supabaseClient.ts` и 9 других файлах) **трогать не надо** — он совместим с обоими вариантами проксирования.

VPS Selectel остаётся жив параллельно — после восстановления можно вернуться обратно сменой DNS.

---

# Design System (Canonical)

Подробные правила дизайн-системы (внутрипроектные): `.claude/rules/90-design-system.md`

## Design System Handoff (Phase 1 landed 2026-04-20, commit d2d2834)

Canonical cross-kit design system от Claude Design теперь живёт в репо:
- `SKILL.md` (repo root) — system purpose, mode contract (`data-sokrat-mode`), token hierarchy, anti-drift rules (ten laws), extension checklist, pre-flight checks. Читать **до** любой UI-работы.
- `docs/design-system/README.md` — folder map + completion status handoff.
- `src/styles/colors_and_type.css` — **single source of truth** для tokens (`--sokrat-*`), self-hosted `@font-face` (Golos Text 6 weights), mode rules, exam-stream rules, parent overlay rules. Импортится первой строкой в `src/index.css`.
- `src/fonts/GolosText-*.ttf` — Golos Text 400/500/600/700/800/900 локально.
- `src/assets/sokrat-logo.png`, `sokrat-chat-icon.png`, `sokrat-hw-banner.png` — canonical brand assets (PNG by design, не SVG).

**Статус фаз:**
- Phase 1 ✅ additive: файлы + @import + Google Fonts → local (commit `d2d2834`).
- Phase 2 ⏳ pending: shadcn slot mapping (`--primary` indigo → green, hero gradient indigo → green). Preview patch сгенерирован, не применён. Accent mapping использует compatibility-bridge: `--accent` остаётся зелёным до отдельного semantic cleanup, ochre доступен через `bg-socrat-accent` (tailwind) или `var(--sokrat-ochre-500)`.
- Phase 3+ ⏳ deferred: mode wrapper (`data-sokrat-mode`), kit port.

**Hard rules (из SKILL.md):**
- Не дублировать и не шейдовать токены из `colors_and_type.css` — всегда `var(--sokrat-*)`.
- Новый цвет/шрифт/тень — сначала extend `colors_and_type.css`, потом использовать.
- Math — только через KaTeX + `FormulaBlock` / `SFormulaBlock` (см. `.claude/rules/90-design-system.md`).
- Golos Text — единственный sans family. Inter / Roboto / Nyghtserif запрещены.

Внутрипроектный rule-файл `.claude/rules/90-design-system.md` описывает как design-system применяется в конкретных компонентах SokratAI (bg-accent / socrat tokens / anti-patterns). При конфликте (e.g. handoff предписывает `--accent = ochre`, а rule-файл — `bg-accent = green`) — см. SKILL.md §10 Implementation handoff + compatibility bridge в Phase 2 preview.

---

# Claude Role

Claude acts as Software Engineer.

Responsibilities:

- implement features
- debug issues
- write tests
- run validation commands

Claude does NOT:

- change architecture
- introduce new dependencies
- modify security logic

---

# Development Workflow

Always follow:

Spec → Plan → Code → Test

Step 1
Read spec files.

Step 2
Propose implementation plan.

Step 3
Implement tasks.md.

Step 4
Run validation commands.


# Tutor AI Agents — Canonical Docs

For tutor product features, Claude must read product and UX source-of-truth docs before proposing implementation.

## Canonical read order for tutor tasks

1. `docs/discovery/research/08-wedge-decision-memo-sokrat.md`
2. `docs/discovery/product/tutor-ai-agents/14-ajtbd-product-prd-sokrat.md`
3. `docs/discovery/product/tutor-ai-agents/15-backlog-of-jtbd-scenarios-sokrat.md`
4. `docs/discovery/product/tutor-ai-agents/16-ux-principles-for-tutor-product-sokrat.md`
5. `docs/discovery/product/tutor-ai-agents/17-ui-patterns-and-component-rules-sokrat.md`
6. `docs/discovery/product/tutor-ai-agents/18-pilot-execution-playbook-sokrat.md`
7. relevant file in `docs/delivery/features/`

## Tutor product rules

- Do not expand scope beyond the current wedge.
- Prioritize tutor workflows around homework and practice generation.
- AI = draft + action, not chat-only output.
- Prefer additive iterations over refactors unless explicitly asked.
- If a feature does not strengthen the paid pilot, it is not a priority.

## Tutor implementation workflow

For any tutor feature:
1. Read canonical tutor docs.
2. Identify which Job / JTBD scenario the task strengthens.
3. Propose minimal implementation inside current scope.
4. Implement.
5. Run validation.
6. Make sure output can be reviewed against docs 16 and 17.

## Tutor anti-drift guardrails

Claude must avoid:
- turning `Помощник` into a generic chat-first screen
- adding new top-level tutor flows without Job-based justification
- adding AI output that has no action layer
- inventing new segment / pricing / wedge decisions in code tasks

---

# Security Rules

Never:

- expose API keys
- modify environment variables
- execute shell commands outside validation

---

# Critical Architecture Rules

- Student and Tutor modules must remain isolated.
- Never import tutor modules inside student components.
- Never import student modules inside tutor components.
- Shared UI components must stay lightweight.

---

# High-Risk Files

Modify only if task explicitly requires:
- `src/components/AuthGuard.tsx`
- `src/components/TutorGuard.tsx`
- `src/pages/Chat.tsx`
- `src/pages/tutor/TutorSchedule.tsx`
- `supabase/functions/telegram-bot/index.ts`

---

# Documentation

Detailed rules are stored in: .claude/rules/

For architecture overview see: docs/delivery/engineering/architecture/README.md

## Domain-specific rules (loaded from .claude/rules/)

| Rule file | Domain |
|---|---|
| `40-homework-system.md` | Homework system, guided chat, workflow modes, DB tables |
| `50-kb-module.md` | Knowledge base, moderation, Source→Copy, fingerprint dedup |
| `60-telegram-bot.md` | Telegram bot, /pay flow, invite flow, AddStudentDialog |
| `70-notifications.md` | Push, email, cascade delivery, VAPID, profiles.email |
| `80-cross-browser.md` | Safari/iOS rules, forbidden patterns, build targets |
| `90-design-system.md` | Цветовая палитра, типографика, spacing, компоненты, anti-patterns |
| `95-production-deploy.md` | **КРИТИЧНО**: когда требуется `deploy-sokratai` после frontend-изменений (Selectel VPS, Phase B 2026-05-03) |
| `96-auth-ru-bypass.md` | **КРИТИЧНО**: 11 hard rules для auth flows в РФ (RegisterTutor / TutorLogin / SignUp / OAuth / Telegram). Читать ОБЯЗАТЕЛЬНО перед любым изменением auth flow |

## КРИТИЧЕСКИЕ ПРАВИЛА

### 0. Новая колонка/поле в БД — ОБЯЗАТЕЛЬНО сгрепать ВСЕ write-sites (2026-04-18)

Когда добавляешь новую колонку в таблицу (или новое поле в payload/type, видимое для AI или критичное для UX), перед заявлением «готово» **ОБЯЗАТЕЛЬНО** найди все места, где в эту таблицу пишут. В репо есть несколько таблиц с **множественными независимыми write-path** — и легко пропустить второй:

- **`homework_tutor_tasks`** (критично для этого урока):
  - Path A: `supabase/functions/homework-api/index.ts` → `handleCreateAssignment` + `handleUpdateAssignment` (**4 insert/update блока** — count подтверждён Phase 3.1 hotfix 2026-05-13: line ~604 create, ~1430 update-with-submissions, ~1490 new-insert-no-submissions, ~1577 update-no-submissions)
  - Path B: `src/components/kb/HWDrawer.tsx` — **напрямую** `supabase.from('homework_tutor_tasks').insert(...)` из клиента, минуя edge function. Источник данных — `HWDraftTask` из `hwDraftStore` (Zustand + localStorage), заполняемый кнопкой «В ДЗ» на KB-карточке задачи
  - Path C (если появится — добавь в список): любой новый client-side insert
  - **Двойной derive-инвариант** (Phase 3.1 hotfix 2026-05-13): `check_format` и `task_kind` должны писаться **вместе** через `deriveTaskKind(check_format)` (backend) / `deriveTaskKindFromCheckFormat` (frontend, `src/lib/checkFormatHelpers.ts`). Эта связка повторила pattern §0 на новой колонке `task_kind` (миграция `20260509120000`): backend backfill был one-shot `WHERE task_kind IS NULL`, но 4 backend + 1 client write-paths не были обновлены → DB default `'extended'` маскировал tutor выбор «Краткий ответ». Любой будущий write к `check_format` ДОЛЖЕН писать `task_kind` тоже
- **`homework_tutor_thread_messages`** — guided chat messages. Проверяй все message-insert-сайты при изменении схемы (task_id invariant, см. rule 40)
- **`kb_tasks`** — modifications через триггеры (Source→Copy, kb moderation v2), см. rule 50
- **`profiles`** — синхронизация ролей, display_name

**Алгоритм проверки** (выполнять перед commit):
1. `grep -rn "from('TABLE_NAME')\.insert\|from('TABLE_NAME')\.update\|into TABLE_NAME" src/ supabase/`
2. Для каждого match убедиться, что новое поле пишется/читается
3. Для type-driven payloads: grep имя типа (например `CreateAssignmentTask`, `HWDraftTask`) — найти все construct-sites

**Симптом пропуска:** «feature работает через один flow, но не через другой» (как было с HWDrawer + solution_text — коммит `f454f6e`; и с `task_kind` desync — Phase 3.1 hotfix `ca1ed1c` 2026-05-13). Отсюда же правило: fix → ВСЕГДА проверь вторичные пути.

### 1. Форматирование дат и валюты
- Канонический источник: **`src/lib/formatters.ts`** — функции форматирования дат, валюты, прогресса
- Всегда используй `parseISO` из `date-fns` для разбора строк дат (не `new Date(string)` — ломается в Safari)
- `hourly_rate_cents` / суммы платежей хранятся в копейках (integer). Деление на 100 только при отображении — используй `formatPaymentAmount` из `formatters.ts`

### 2. Profiles table — нет колонки email
Таблица `profiles` **НЕ содержит** колонку `email`. Email хранится **только** в `auth.users`.
Используй `dbService.auth.admin.getUserById(userId)`, **НЕ** `profiles.select("email")`.

### 3. Система домашних заданий — guided chat
Единая система ДЗ (`homework_tutor_*` таблицы), работает через guided chat (пошаговый AI-чат). Classic режим (photo upload + OCR) и legacy student-only система удалены. Подробности: `.claude/rules/40-homework-system.md`

### 4. Formula rounds — standalone pivot status и Phase 1b границы
- Seed для formula rounds: `supabase/seed/formula-round-seed.sql`
- Seed создаёт `test-tutor` и 5 фиксированных `test_student_*` аккаунтов с воспроизводимыми UUID
- Formula Round Phase 1 сейчас пивотится в standalone `/trainer`; backend groundwork уже есть в `supabase/migrations/20260408160000_trainer_standalone_schema.sql` и `supabase/functions/trainer-submit/index.ts`
- `trainer-submit` — публичный endpoint без JWT-check, пишет в `formula_round_results` через `service_role`
- В текущей schema repo ориентируйся на `formula_round_results.student_id`, `formula_round_results.round_id`, `formula_round_results.duration_seconds`; не предполагай колонки `user_id`, `formula_round_id`, `duration_ms`, `client_started_at`, пока они не добавлены отдельной миграцией
- Legacy preview-flow через `StudentFormulaRound.tsx` / `?student=<seed_uuid>` считать устаревающим; не расширять его для standalone trainer
- Для Formula Rounds Phase 1b tutor UI НЕ создавать новый top-level route или отдельный standalone dashboard. Интегрировать только в существующие tutor flows:
  - `src/pages/tutor/TutorHomeworkCreate.tsx`
  - `src/pages/tutor/TutorHomeworkDetail.tsx` (единая каноническая страница для ДЗ — детальная инфа + результаты v2, см. ниже)
- Phase 1b должен оставаться jobs-first: formula round = optional block внутри homework workflow, а не отдельный продукт/игра

### 5. Единая страница детальной инфы + результатов ДЗ (2026-04-07)
- `TutorHomeworkResults.tsx` **удалён**. Каноническая страница ДЗ для репетитора — `TutorHomeworkDetail.tsx` на URL `/tutor/homework/:id`. Она содержит v2-шапку (`ResultsHeader` с метриками Сдали/Средний балл/В процессе/Не приступали/Требует внимания + actions Редактировать/Удалить), `ResultsActionBlock` (секции «не приступал» и «в процессе» с tabs Telegram/Email в диалоге), `HeatmapGrid` (students × tasks), collapsible секцию задач, материалы и отдельную секцию «Разбор ученика» с `GuidedThreadViewer`
- Route `/tutor/homework/:id/results` остался как redirect на `/tutor/homework/:id` — для backward compat с Telegram-ссылками из `homework-reminder`
- Semantic invariant метрики «Требует внимания» в шапке = `notStarted + per_student.filter(s => s.needs_attention).length`. Backend считает `needs_attention` только для сдавших — frontend обязан прибавлять `notStarted`. In-progress студенты выделены в отдельную метрику «В процессе» и отдельную секцию в `ResultsActionBlock`. Подробности: `.claude/rules/40-homework-system.md` → секция «Merged Detail + Results страница»

### 6. HeatmapGrid (Results v2 TASK-5, 2026-04-07)
- `src/components/tutor/results/HeatmapGrid.tsx` — единая таблица students × tasks. **Заменил** локальный `StudentsList` в `TutorHomeworkDetail.tsx`. Локальный `DeliveryBadge` тоже переехал внутрь HeatmapGrid (других потребителей нет)
- Цвета клеток (AC-2): `null → bg-slate-100 text-slate-400 («—»)`, `< 0.3 → bg-red-100`, `0.3..0.8 → bg-amber-100`, `≥ 0.8 → bg-emerald-100`. Helper `getCellStyle` — single source of truth, не дублировать
- Backend `handleGetResults` теперь fetches ALL threads (не только completed), возвращает `per_student[*].task_scores: { task_id; final_score; hint_count }[]` для всех студентов (включая in-progress с individually-completed задачами) — одна точка для матрицы. Не делать N запросов на student-thread. `computeFinalScore` приоритет: `tutor_score_override → earned_score → ai_score → status fallback`
- Клик по строке → `expandedStudentId` в `TutorHomeworkDetailContent` → отдельная Card «Разбор ученика» с `GuidedThreadViewer` рендерится **под** Materials. Только один ученик раскрыт за раз (AC-3 совместимо). `expandedStudentId` сбрасывается при смене assignment id
- **КРИТИЧНО для iOS Safari**: таблица использует `border-separate border-spacing-0` + `<colgroup>` с фиксированными ширинами + `table-layout: fixed` + `width: max-content`. **НЕ менять** на `border-collapse` — `position: sticky` на `<td>` ломается в WebKit при `border-collapse`. **НЕ возвращать** `w-full` на table — съест горизонтальный скролл, потому что table-layout сжимает столбцы под container
- Wrapping `<div>` имеет `overflow-x-auto touch-pan-x` — `touch-pan-x` обязателен, иначе row onClick может съесть touchstart на iOS и блокировать swipe
- `React.memo` на `HeatmapRow` и `HeatmapCell` — обязательно, при 26×10 = 260 ячеек без memo ловится лаг при expand/collapse
- Cell click (TASK-6 ✅): `handleCellClick(studentId, taskId)` → expand student + set `drillDownTaskId`. `e.stopPropagation()` обязателен. `StudentDrillDown` заменяет прямой `GuidedThreadViewer` в Card «Разбор ученика»
- `getCellStyle` + `formatScore` — вынесены в `src/components/tutor/results/heatmapStyles.ts` (избегает react-refresh warning). **НЕ дублировать** эти helpers — импортировать из heatmapStyles.ts
- `GuidedThreadViewer` props (additive): `initialTaskFilter?: number | 'all'`, `hideTaskFilter?: boolean`. `hideTaskFilter=true` в `StudentDrillDown` скрывает дублирующий pill-ряд
- TASK-3 (header), TASK-4 (action block), TASK-5 (heatmap), TASK-6 (drill-down), TASK-7 (edit-score modal) ✅ done. TASK-8..9 (telemetry audit + QA) — отдельные итерации
- **TASK-7 post-pilot fix (2026-05-08):** «Сохранить» больше не залипает когда тутор вводит балл, равный AI (`isUnchanged` сравнивает только с `currentOverride`, префилл идёт от `finalScore`, не от `aiScore`). Primary entry point — кнопка `[Pencil] Изменить балл` в `GuidedThreadViewer` под условием задачи. Ученик видит обе оценки (`Балл репетитора` + `AI`) + публичный комментарий тутора при override. Спека: `docs/delivery/features/homework-results-v2/spec.md` AC-5a/b/c. Контракты: `.claude/rules/40-homework-system.md` → секция «Manual score override — post-pilot fix + entry points»
- **TASK-7 post-pilot fix #2 (2026-05-09):** override на незавершённой задаче (status='active') теперь виден в основной HeatmapGrid и TaskMiniCard — guard в `handleGetResults` расширен на override+ai_score scoring-сигналы (не только `status='completed'`). Шаг балла унифицирован на **0.1** для tutor И AI (frontend validator, backend validator, AI prompt). DB `numeric(5,2)` уже поддерживает 0.1, миграции не нужны. Backward compat сохранён (0.5 ∈ multiples of 0.1). Спека: AC-5d/AC-5e. Контракты: «Heatmap cell inclusion invariant» + «Score step invariant» в `.claude/rules/40-homework-system.md`

### 7. Subject CHECK constraint — синхронизация с SUBJECTS (2026-04-14)
- При добавлении нового предмета в `SUBJECTS` (`src/types/homework.ts`) или `VALID_SUBJECTS_CREATE` (`supabase/functions/homework-api/index.ts`) **ОБЯЗАТЕЛЬНО** добавить миграцию, обновляющую constraint `homework_tutor_assignments_subject_check`
- Паттерн нарушения: commit `e57cada` добавил `'maths'`, `'informatics'` и др. в фронт/edge function, но не добавил миграцию → prod выдавал «Failed to create assignment» на любом ДЗ с новыми subject id
- Канонический список (19 значений): `maths, physics, informatics, russian, literature, history, social, english, french, spanish, chemistry, biology, geography, other` + legacy `math, cs, rus, algebra, geometry`
- Фикс: `supabase/migrations/20260414150000_unify_homework_subject_check.sql`

### 8. Имя ученика в AI-промпте — все три пути (2026-04-14/15)

Все три пути общения ученика с AI получают имя и используют правильный грамматический род.

**Источники имени (приоритет, 2026-05-09 расширено):**
- `tutor_students.display_name` — tutor-owned поле, primary source (ДЗ-пути)
- `profiles.full_name` — real-name fallback (может быть set'нут пользователем при signup)
- `profiles.username` — fallback, если не автогенеренный
- Автогенеренные username-ы отфильтровываются regex `/^(telegram_|user_)\d+$/i` → AI работает в нейтральной форме (`full_name` фильтр НЕ применяется — там реальное имя)

**Путь 1 — «Ответ к задаче» (ДЗ, edge function `homework-api`):**
- `resolveStudentDisplayName(db, studentAssignmentId)` в `supabase/functions/homework-api/index.ts` резолвит: `tutor_students.display_name → profiles.full_name → profiles.username (non-auto) → null`. Эта же функция используется в `handleGetTutorStudentThread` для tutor-side chat-bubble identity (см. правило `40-homework-system.md` → «GuidedChatMessage perspective contract»)
- Подключено в `handleCheckAnswer` и `handleRequestHint` → `evaluateStudentAnswer` / `generateHint`
- `buildStudentNameGuidance(studentName)` в `guided_ai.ts` добавляет секцию в системный промпт

**Путь 2 — «Обсудить шаг с AI» и bootstrap (ДЗ, edge function `chat`):**
- Системный промпт строится на фронтенде (`buildGuidedSystemPrompt` в `GuidedHomeworkWorkspace.tsx`)
- `getStudentAssignment` в `studentHomeworkApi.ts` резолвит `studentDisplayName` (те же два источника параллельно)
- Передаётся в `buildGuidedSystemPrompt(..., { studentName })` → в оба `streamChat` вызова

**Путь 3 — обычный чат `/chat` (edge function `chat`):**
- `Chat.tsx` при загрузке делает `useQuery ['user-profile-name']` → `profiles.username` (без tutor context)
- Передаётся как `studentName` в тело запроса к `/functions/v1/chat`
- `chat/index.ts` **добавляет** суффикс к `effectiveSystemPrompt` (не заменяет `SYSTEM_PROMPT`)

**Frontend tutor UI:**
- `TutorStudentProfile.tsx` — поле «Как обращаться в AI-чате» (Input, placeholder «Например, Юля»)
- Миграция: `supabase/migrations/20260414160000_add_tutor_students_display_name.sql`

### 8a. Tutor Profile — identity, аватары, storage (2026-05-05, v0.3 post-review)

Фича `docs/delivery/features/tutor-profile/spec.md` (v0.3) добавляет профиль репетитора и Telegram-style identity в guided homework chat. Важный schema nuance: `homework_tutor_assignments.tutor_id` хранит `auth.users.id` репетитора, а не `public.tutors.id`; профиль читается через `tutors.user_id`.

**Storage / RLS / data:**
- Storage bucket `avatars` public-read; write path convention `avatars/<user_id>/<uuid>.<ext>`, owner write restricted by first folder = `auth.uid()` (migration `20260506150000_tutor_profile_infrastructure.sql`).
- Колонки `profiles.avatar_url`, `profiles.gender`, `tutors.gender` (`'male'|'female'|null`) добавлены в той же миграции.
- **`tutors` RLS:** только узкая SELECT policy `auth.uid() = user_id` (self-read). **Cross-user reads ЗАПРЕЩЕНЫ через PostgREST** — только через service_role в edge function с column-whitelist. Broad `USING (true)` policy была откачена миграцией `20260506180000_revert_tutors_broad_select.sql` после ChatGPT-5.5 review (cross-tenant leak: `telegram_id`, `booking_link`, `invite_code`, `bio` утекали всем authenticated).

**Client API + hooks:**
- `tutorProfileApi` в `src/lib/tutorProfileApi.ts` — единственный путь для tutor self-read/write. Hot-path user id через `getSession()`, никогда `getUser()`.
- React Query key — строго `['tutor','profile']` (см. `.claude/rules/performance.md` §2c).
- `useTutorProfile()` / `useUpsertTutorProfile()` / `useUploadAvatar()` / `useRemoveAvatar()` в `src/hooks/useTutorProfile.ts`.
- `tutorProfileApi.uploadAvatar` делает client-side compress (≤ 2 МБ 512×512 JPEG) + UPDATE `tutors.avatar_url` + best-effort cleanup старого blob через regex-парсинг public URL.

**UserAvatar fallback (`src/components/common/UserAvatar.tsx`):**
- Каскад: `avatarUrl` → gender SVG (`/avatar-placeholder-male.svg` или `/avatar-placeholder-female.svg`) → инициалы из `displayName` (с фолбэком «Пользователь» → «П», гарантированно непустое).
- **Использует Radix Avatar primitive** из `src/components/ui/avatar.tsx`; не вставлять прямой `<img>` в новых callsite, иначе broken URL не провалится в fallback.
- Placeholder SVG: 512×512, фон `#F7F6F3`, силуэт `#E2E8F0`/`#64748B`, без лиц/emoji.
- `loading="lazy"` встроен в `AvatarImage`.

**Avatar entry point — ТОЛЬКО в AppFrame chrome (v0.3 fix):**
- **Desktop:** `src/components/tutor/chrome/SideNav.tsx::ProfileNavItem` в `t-nav__footer` над «Выйти». Avatar 16×16 (slot-sized под Lucide).
- **Mobile:** `src/components/tutor/chrome/MobileTopBar.tsx` — Link 44×44 между brand и logout.
- **НЕ добавлять в `src/components/Navigation.tsx`** — это student chrome (за AuthGuard на `/chat`/`/homework`/`/progress`/`/profile`), tutor его не видит. Изначальная спека ошибочно указывала Navigation.tsx; v0.3 исправлено.
- `useTutorProfile()` mounted внутри AppFrame (уже TutorGuard'ed) → query не fire'ит для не-tutor.

**Guided chat tutor identity (TASK-7..10):**
- `resolveTutorProfileForAssignment(db, assignmentId)` (`homework-api/index.ts`) резолвит `assignment.tutor_id` → `tutors.user_id` → `name + avatar_url + gender`. Если `tutors.name` пустой или строки нет, fallback на `profiles.username`. Email не возвращается, не логируется.
- `fetchStudentThread(db, threadId)` enriched с `tutor_profile` — все 4 callsite (handleGetThread / handleAdvanceTask / handleCheckAnswer / handleRequestHint) автоматически получают identity. **Не привязывать tutor_profile к response per-handler** — это привело к BLOCKER 1 при code-review (check/hint потеряли identity, ученик видел legacy «Репетитор» после answer).
- Студенческий thread fetch — через **edge function endpoint** `GET /functions/v1/homework-api/assignments/:id/thread` (lazy-provisions thread + attaches tutor_profile). Прямой PostgREST SELECT не может computed `tutor_profile` (см. ChatGPT-5.5 BLOCKER 1).
- Клиентский тип — `HomeworkThread.tutor_profile?: HomeworkTutorProfile | null` в `src/types/homework.ts`. Это thread-level поле, **per-message contract не менять**.
- `GuidedChatMessage` (TASK-9) рендерит avatar+name только когда parent передаёт `tutorDisplayName !== undefined || tutorAvatarUrl !== undefined`; иначе legacy «Репетитор» pill (backward compat для unmigrated callsite, например GuidedThreadViewer на tutor стороне).
- `GuidedHomeworkWorkspace` (TASK-10) обёртывает `tutor_profile` в `useMemo` по 3 примитивам (display_name/avatar_url/gender) с явным `eslint-disable react-hooks/exhaustive-deps` block-comment — прибавление wrapping ref'а в deps сломало бы AC-10 (avatar flicker'ил бы на каждом refetch'е после check/hint).

**AvatarUpload guard'ы (`src/components/tutor/profile/AvatarUpload.tsx`):**
- Pixel cap `MAX_INPUT_MEGAPIXELS = 64` (≈ 8000×8000) **до** `drawImage` — защита от decompression bomb (10 МБ JPEG может декодироваться в сотни МБ pixel buffer и подвесить iOS Safari).
- Quality ladder `[0.9, 0.7, 0.5]` walking до ≤ 2 МБ; иначе toast «Не удалось сжать».
- Канвас оборачивается в try/catch (Safari может throw SecurityError на EXIF-rotated edge cases).
- `URL.createObjectURL` парится с `revokeObjectURL` в effect cleanup и при rollback'е upload'а.

### 9. Эталонное решение репетитора для AI — solution_* + anti-leak (2026-04-18)

Репетитор может прикрепить эталонное решение к задаче (текст + до 5 фото). AI видит его на всех 3 путях (check / hint / chat) как референс, **НИКОГДА не цитирует дословно** ученику.

**DB (homework_tutor_tasks):**
- `solution_text TEXT NULL` — текст эталона
- `solution_image_urls TEXT NULL` — dual-format refs, лимит `MAX_SOLUTION_IMAGES = 5`
- Миграция: `supabase/migrations/20260418120000_add_homework_task_solution.sql`

**Student leak protection (КРИТИЧНО):**
- `handleGetStudentAssignment` в `homework-api/index.ts` НИКОГДА не селектит `solution_text` / `solution_image_urls` / `rubric_text` / `rubric_image_urls`
- `StudentHomeworkTask` тип и `studentHomeworkApi.ts` НЕ содержат этих полей — приложи compile-time гарантию
- Все новые student-endpoints должны аналогично исключать эти поля из SELECT

**AI-инжекция (3 пути):**
- `handleCheckAnswer` → `evaluateStudentAnswer` → `buildCheckPrompt` (guided_ai.ts)
- `handleRequestHint` → `generateHint` → `buildHintPrompt` (guided_ai.ts)
- `/chat` (edge function `chat/index.ts`) — фетчит solution server-side через `service_role` после верификации `homework_tutor_student_assignments`. Клиент (`streamChat` в `GuidedHomeworkWorkspace.tsx`) шлёт только `guidedHomeworkAssignmentId + guidedHomeworkTaskId`; текст/фото решения клиентом не передаются

**Anti-spoiler контракт:**
- В system prompt всех 3 путей — блок «эталон только для сверки, НЕ цитируй, работай Сократовским методом»
- `getGeneratedHintCheck(hint, solutionText, taskText)` — leak-детектор в `guided_ai.ts`: извлекает значимые токены из эталона минус токены задачи (task givens не спойлер), отклоняет вывод при совпадении → retry-once → fallback
- `evaluateStudentAnswer` применяет тот же leak-check к `feedback` и `ai_score_comment`. **Важно: retry — cosmetic rewrite**: сохраняет `verdict`/`confidence`/`error_type`/`ai_score` от первого result, свапает только `feedback` + `ai_score_comment` от retry. Grading detreministic
- `/chat` с guided context — buffered path: полный ответ собирается server-side, leak-детектор, fallback-сообщение при утечке. Обычные /chat запросы (не guided) стримятся как раньше

**Image-only anti-leak gate (v3, критично):**
- Константа `SOLUTION_TEXT_ANCHOR_MIN_CHARS = 20` во всех 3 путях (`chat/index.ts`, `guided_ai.ts::evaluateStudentAnswer`, `guided_ai.ts::generateHint`)
- Если `solution_text.trim().length < 20` — `solution_image_urls` **ДРОПАЮТСЯ** и не прикладываются к промпту. Причина: leak-детектор работает только по тексту; тривиальный anchor («см. фото», 8 символов) не даёт токенов для матчинга, и фото-эталон может быть экстрактирован через «transcribe the attached image» jailbreak
- Telemetry события: `guided_check_solution_images_dropped_no_text`, `guided_hint_solution_images_dropped_no_text`, `guided_chat_solution_images_dropped_no_text`
- Продуктовый контракт: репетитор хочет, чтобы AI видел фото решения → должен написать хотя бы короткий (но ≥ 20 символов) текстовый summary решения

**KB-мост:**
- `kbTaskToDraftTask` в `HWTasksSection.tsx` копирует `kb.solution → solution_text`, `kb.solution_attachment_url → solution_image_paths` (с truncation до `MAX_SOLUTION_IMAGES`)
- Raise separate toast при truncation для условия и для решения

**Templates:**
- `HomeworkTemplateTask` в `tutorHomeworkApi.ts` содержит `solution_text`, `solution_image_urls`, `rubric_image_urls`
- Save (`templateTasksJson` в `homework-api/index.ts::handleCreateAssignment`) и load (оба path'а в `TutorHomeworkCreate.tsx`) переносят все 3 поля. **Не обрывать** эти цепочки — иначе template round-trip будет терять данные AI-контекста

**Плановый документ:** `C:\Users\kamch\.claude\plans\wild-swinging-nova.md`

### 10. Mock Exams v1 — public anonymous endpoint (2026-05-07, TASK-6)

`supabase/functions/mock-exam-public/index.ts` — единственный публичный endpoint mock-exams-v1 (3 route'а: `GET /share/mock-invite/:slug`, `POST /share/mock-invite/:slug/start`, `GET /share/mock-result/:slug`). Без JWT, под `service_role` (обходит RLS намеренно — RLS защищает только authenticated PostgREST). При расширении / правке этого файла соблюдать инварианты ниже.

**Anti-leak — state-aware reveal (НЕ путать с homework tutor-only invariant):**

Mock-exams anti-leak — это **state-aware** контракт, не «никогда не отдавать ученику»:
- **Pre-submit (`in_progress`)** → endpoint вообще не отвечает (409 / 410)
- **Post-submit, до approval** (`submitted` / `ai_checking` / `awaiting_review`) → reveal только Часть 1 (`correct_answer`, `kim_number`); Часть 2 — totals only
- **Post-approval** (`approved`) → reveal Часть 2 разбор: `solution_text`, `tutor_score`, `tutor_comment`, `task_text` Часть 2 — это **сам value-proposition** «AI draft + tutor approval → ученик видит финальный разбор»
- **`ai_draft_json`** — **никогда** не отдаётся ученику (tutor-only artifact, мог отличаться от final approved score)

Это **принципиально отличается** от homework anti-leak invariant (`.claude/rules/40-homework-system.md` → «Эталонное решение для AI и anti-leak»), где `homework_tutor_tasks.solution_text` / `rubric_*` — **tutor-only forever**, ученик никогда не видит ни до, ни после сдачи. Причина разницы: homework — Сократовский guided chat (показать решение = убить ценность); mock-exam — экзаменационный формат с финальным разбором post-approval (показать решение = и есть ценность).

При расширении эндпоинтов / surfaces:
- Новый mock-exam endpoint → state-aware whitelist (default = paranoid: tutor-only); reveal Часть 2 поля только при явной проверке `attempt.status === 'approved'`
- Новое поле в `mock_exam_variant_tasks` или `mock_exam_attempt_part2_solutions`, видимое ученику — явное решение: pre-submit (нельзя — anti-leak) / post-submit (Часть 1 only) / post-approval (Часть 2 only). Default = post-approval (paranoid)
- НЕ переносить homework anti-leak паттерны 1:1 — semantic'и разные
- См. §15 (StudentMockExamResult endpoint) для каноничного state-aware contract'а

**Column whitelist на SELECT (КРИТИЧНО):**
- **`tutors` (tutor card)** — единственный source через `loadTutorCard()`: `name, avatar_url, bio, subjects`. **Никогда** не добавлять в публичный payload: `telegram_id`, `telegram_username`, `booking_link`, `id`, `user_id`, `email`. Email живёт только в `auth.users` и не должен query'иться вовсе. Если CTA «связаться с репетитором» потребует контакт — server-side notification flow (push/telegram tutor'у), не client-side raw поле.
- **`mock_exam_assignments`** — `id, title, mode, status, variant_id` (+ `variant_title` для parent_result). `tutor_id` уже резолвлен из `mock_exam_public_links`, не re-emit'ить в payload.
- **`mock_exam_variant_tasks` для invite read** — `id, kim_number, part, order_num, task_text, task_image_url, check_mode, max_score`. **Никогда** `correct_answer` или `solution_text` (anonymous student не должен видеть ответы до прохождения).
- **`mock_exam_variant_tasks` для parent result read** — `correct_answer` + `solution_text` доступны только когда `attempt.status === 'approved'` (post-tutor-approval). Для `manually_entered` — нет per-task разбора, только totals.

**Status gates (AC-7):**
- Parent result: `attempt.status` ∈ {`approved`, `manually_entered`} → 200 с разбором / totals. Иначе → **403** `{error: 'not_ready', status}`.
- Invite read/start: `assignment.status === 'active'` И `mode !== 'manual_entry'` И `variant_id !== null`. Иначе → **410** `{error: 'not_available'}`.
- Slug regex `/^[a-z0-9]{8}$/i` — **до DB query** (защита от enumeration). Mismatch → 400 `invalid_slug`.
- `expires_at < now()` → **410** `{expired: true, error: 'expired'}`.

**Anonymous attempt + lead atomicity (AC-6):**
- Generate `anonymous_id = crypto.randomUUID()` server-side. Insert attempt → если успешно, insert lead. **При ошибке lead insert — manual rollback** attempt'а через `.delete()` (PostgREST не поддерживает транзакции; rollback best-effort для избежания сирот).
- `consent_at = new Date().toISOString()` server-controlled. Client-supplied timestamps **не доверяем** (audit trail integrity). Body shape: `{ consent: true }` или `{ consent_at: true | ISO }` — оба формы суть «дал согласие сейчас», server всегда пишет `now()`.

**Bulk Часть 2 photo CAS retry (post-TASK-15, 2026-05-14):** `handleUploadPhoto` для `kind='part2_bulk'` использует CAS retry pattern (max 3 attempts) — `UPDATE WHERE part2_bulk_photo_urls IS [original raw value]`. Если 0 rows affected — race detected, re-read и retry. На final failure — rollback uploaded storage object через `.remove([path])` чтобы избежать orphan'ов. **Симптом нарушения инварианта**: ученик загрузил 5 фото быстро подряд, но в `part2_bulk_photo_urls` только 3-4 — два upload'а overwrote друг друга. Перед любой подобной concurrency-sensitive операцией (multi-photo / multi-task) использовать тот же CAS pattern, не raw read-modify-write.

**Storage / signed URLs:**
- 4 bucket-а созданы миграцией `20260508120100_mock_exams_storage_buckets.sql` (TASK-2): `mock-exam-variant-tasks` (private, default fallback в `parseStorageRef`, картинки задач варианта), `mock-exam-blanks` (private, фото заполненного бланка ученика — TASK-12 path `{studentId}/{attemptId}/blank-{uuid}.ext`), `mock-exam-part2-photos` (private, фото решений Части 2 — TASK-12 path `{studentId}/{attemptId}/{kim}/{uuid}.ext`), `mock-exam-blank-templates` (public, PDF templates ФИПИ). `parseStorageRef` извлекает bucket из `storage://bucket/path` ref'а; bare paths падают на default.
- Path-traversal guard `hasUnsafeObjectPath` rejects `..`, `\`, `\0` сегменты до `createSignedUrl` (defense-in-depth).
- Все client-facing signed URLs обёрнуты в `rewriteToProxy()` из `_shared/proxy-url.ts` — RU bypass.

**Telemetry — server-side only, PII-free:**
- События: `mock_exam_invite_visited`, `mock_exam_invite_visited_expired`, `mock_exam_invite_started` (с `contact_type` only), `mock_exam_invite_start_expired`, `mock_exam_result_visited` (с `status`), `mock_exam_result_visited_not_ready` (с `status`), `mock_exam_result_visited_expired`.
- Slug — единственный correlation key. **Никогда** не логировать `lead_name`, `lead_contact`, IP, user_id, телеметрия чистая для compliance/audit.

**Wire-level routing:** Endpoint URL = `https://api.sokratai.ru/functions/v1/mock-exam-public/share/...`. Frontend route `/p/mock-invite/:slug` (TASK-14 `PublicMockInvite.tsx`) — это **страница приложения**, не API path. Не путать.

**Producer для parent_result links — пока не существует.** TASK-3 `mock-exam-tutor-api` создаёт только `scope='invite'` ссылки. Когда понадобится parent share после approval — добавить отдельный handler (e.g. `POST /attempts/:id/parent-share-link`) в `mock-exam-tutor-api` с тем же 8-char slug + retry-on-collision паттерном. Endpoint `mock-exam-public` уже умеет читать `scope='parent_result'` — ждёт producer'а.

**Спека:** `docs/delivery/features/mock-exams-v1/spec.md` (Section 3 + AC-6/AC-7).

### 11. Mock Exams v1 — seed Тренировочного варианта 1 (2026-05-07, TASK-2)

`supabase/seed/mock_exams_variant_1.sql` — каноничный seed для Phase 1 пилота. 1 variant + 26 tasks (KIM 1-20 Часть 1 с auto-check, 21-26 Часть 2 с manual approval). Сгенерирован из `Тр_вариант 1.docx` Егора через 3-step pipeline в `scripts/`.

**Pipeline (один источник правды для содержания варианта):**

```
Тр_вариант 1.docx (IP Егора, не в репо)
   │ scripts/parse-mock-exam-docx.py     — bootstrapping only: docx → paragraphs+tables+rels
   ▼
parsed.json (raw, не в репо)
   │ scripts/structure-mock-exam.py      — bootstrapping only: anomaly fix, answer-key, Part 2
   ▼
docs/.../source/variant1-tasks.json    ← MANUALLY REVIEWED против docx (2026-05-07)
docs/.../source/variant1-review.md     ← synced с tasks.json
   │ scripts/build-mock-exam-seed.py    — канонический генератор: uuid5 + dual-format refs + idempotent
   ▼
supabase/seed/mock_exams_variant_1.sql ← committed, applies via Lovable Cloud
```

`scripts/enhance-mock-exam-with-latex.py` — **deprecated stub** (помечен 2026-05-07). Использовался как initial LaTeX-каркас, но содержал wrong assumptions для KIM 17 (β-распад вместо α-распад) и KIM 23 (R=12 вместо R=8). **Не запускать** — перепишет проверенные значения. При правках содержания варианта править `variant1-tasks.json` напрямую и регенерировать seed.

**При правках содержания варианта** (Егор находит баг в условии задачи, ответ не совпадает, нужно дописать LaTeX): править `variant1-tasks.json`, **НЕ** seed.sql напрямую. Затем регенерировать seed: `python scripts/build-mock-exam-seed.py docs/.../variant1-tasks.json supabase/seed/mock_exams_variant_1.sql`. UUIDs детерминированы (uuid5 от namespace `00000000-0000-0000-0000-000000005ec0`) — re-running генератора с теми же входами даёт идентичный SQL.

**Hard invariants seed.sql:**
- Variant UUID: `36cebc45-e2e8-5603-a753-01c818bba131` (фиксированный, не менять)
- 27 INSERTs (1 variant + 26 tasks), все `ON CONFLICT (id) DO NOTHING` — idempotent
- `task_image_url` использует **dual-format** convention из rule 40 (single ref vs JSON-array string), как `homework_tutor_tasks` — не отступать от паттерна
- Storage refs всегда полные `storage://mock-exam-variant-tasks/variant1/imageN.png` — `parseStorageRef` правильно извлечёт bucket
- `check_mode` distribution: 10 strict, 4 multi_choice, 4 ordered, 1 pair, 1 task20, 6 manual (см. `_CHECK_MODE_BY_KIM` в `scripts/build-mock-exam-seed.py`)
- `correct_answer` для Части 1 строкой, как ввёл бы ученик (e.g. `'225'`, `'2,70,1'`, `'34'`)
- `solution_text` для Части 2 — multi-step «Возможное решение» от Егора, для tutor view (НЕ для student до approval)

**Известные limitations парсинга** (закрыто 2026-05-07 ручной сверкой Vladimir с docx):
- OMML/WMF math: всего 6 m:oMath блоков в docx, остальные формулы — embedded EMF/WMF picture-objects. После manual review LaTeX дописан напрямую в `variant1-tasks.json`. Inline-formula images (image5/12/13/14/23/24, warning icon image25) **исключены** из task images; только 13 файлов идут в Storage.
- Layout anomaly tasks 4/7 (маркер kim ПОСЛЕ тела) — подтверждён, исправлен в tasks.json
- KIM 6 содержал утечку KIM 7 — очищен
- KIM 14 — восстановлена таблица (parser потерял табличные данные)
- KIM 16: правильное `^{234}_{90}\mathrm{Th}` + `\beta^-`-распад
- KIM 17: правильное `\alpha`-распад `^{212}_{83}\mathrm{Bi}` (не β!)
- KIM 23: R=8 Ом, ответ 2 Ом (verified против docx)
- KIM 19 checker: обновлён под `pair`-формат с погрешностью
- Score totals: **45 = 28 (Часть 1) + 17 (Часть 2)** — verified против docx criteria
- WMF/EMF не рендерятся в браузере → **11 из 13** upload-файлов требуют PNG-конвертации (см. `docs/delivery/features/mock-exams-v1/source/storage-upload-checklist.md`)

**`created_by` (post-2026-05-14, TASK-6 pilot-polish):** `build-mock-exam-seed.py` теперь hardcode'ит `EGOR_UUID = "a7212758-8cdd-4d7c-8608-4fedcb34d74c"` (Egor Blinov, `egor.o.blinov@gmail.com`) и эмитит этот UUID в `created_by`. Регенерация seed deterministic — не нужно manual fix после каждого `python scripts/build-mock-exam-seed.py …`. Если Егор's account будет rotated — заменить константу в скрипте и перерегенерировать. RLS policy на `mock_exam_variants` не имеет write rule для authenticated, поэтому variant создаётся только через service_role.

**`updated_at` отсутствует в `mock_exam_variant_tasks`:** при создании resync-миграций (UPDATE existing rows) **НЕ** добавлять `SET updated_at = now()` — такой колонки в схеме `20260508120000_mock_exams_v1_schema.sql` нет. Иначе миграция упадёт `column "updated_at" of relation "mock_exam_variant_tasks" does not exist`.

**Markdown table rendering для KIM на соответствие (TASK-6, 2026-05-14):** `StudentMockExam.tsx::MathBlock` детектит GFM-таблицу через regex `/\n\s*\|.+\|\s*\n\s*\|\s*[:\-| ]+\|\s*\n/` и lazy-loadит `src/components/student/mock-exam/MarkdownTaskText.tsx` (react-markdown + remark-gfm + remark-math + rehype-katex). Для задач без таблицы fast-path остаётся через `MathText` (KaTeX-only, нет markdown overhead). При расширении на other mock-exam surfaces — переиспользовать `MarkdownTaskText`, не дублировать ReactMarkdown stack. `MathText` (kb/ui) **не модифицирован** — markdown логика изолирована в новом компоненте, не затрагивает KB / homework chat / другие consumer-ы. **Mobile invariant (post-TASK-15):** `<table>` обёрнута в `<div overflow-x-auto touch-pan-x>` + `min-w-max` + `whitespace-nowrap` на ячейках. Без wrapper'а wide tables (KIM 14 2×11 t/q) сжимаются на iPhone X. `touch-pan-x` критичен per `.claude/rules/80-cross-browser.md`.

**Resync content миграции — single-column UPDATE pattern:** `supabase/migrations/20260514120000_resync_mock_exam_variant_1_content.sql` (TASK-6) — каноничный шаблон. Per-KIM `UPDATE public.mock_exam_variant_tasks SET task_text = '...' WHERE id = '<uuid>'::uuid;` обёрнут в BEGIN/COMMIT, idempotent. **Не менять** `correct_answer` / `max_score` / `check_mode` / `topic` / `kim_number` в resync-миграциях — только `task_text`. Если правка содержания меняет ответ — это **другая** миграция с отдельной spec (ученики могли уже сдавать с прежним ответом, `mock_exam_attempt_part1_answers` содержит historical grading).

**Variant PDF safety (post-TASK-12/14, 2026-05-14):** `mock-exam-variant-pdfs/variant1/variant1.pdf` хранится в bucket public-read и линкуется через `mock_exam_variants.variant_pdf_url` (TASK-10). Содержит **только страницы 1-13** оригинального docx (Инструкция + Справочные данные + Часть 1 задачи + Часть 2 задачи). **Страницы 14+ содержат «Систему оценивания» с answer table'ами и solution_text'ы Часть 2** — leak'ать ученику ЗАПРЕЩЕНО. Канонический slice script — `scripts/slice-variant-pdf.py` (`pypdf`, `DEFAULT_PAGES=13`). **При добавлении новых вариантов** (variant 2..N) ОБЯЗАТЕЛЬНО запустить slice script с правильным значением страниц **до** upload'а в bucket — структура docx может отличаться. История: TASK-12 ошибочно сделал 24 pages, TASK-14 hotfix перенарезал до 13 (page 14 уже содержит answer table'ы). Visual review каждой страницы перед upload обязателен.

**Per-tutor feature flag rollout:** после seed apply Vladimir выполняет `UPDATE public.tutors SET feature_mock_exams_enabled = true WHERE user_id = '<egor_uuid>'`. Через 3-4 часа QA — повторить для оставшихся 3 пилотных tutors (см. spec §3.5).

**Validation после apply:**
```sql
SELECT COUNT(*) FROM public.mock_exam_variant_tasks WHERE variant_id = '36cebc45-e2e8-5603-a753-01c818bba131';  -- = 26 (AC-3)
SELECT COUNT(*) FROM public.mock_exam_variant_tasks WHERE variant_id = '36cebc45-e2e8-5603-a753-01c818bba131' AND part = 1 AND correct_answer IS NOT NULL;  -- = 20
SELECT COUNT(*) FROM public.mock_exam_variant_tasks WHERE variant_id = '36cebc45-e2e8-5603-a753-01c818bba131' AND part = 2 AND solution_text IS NOT NULL;  -- = 6
```

**При расширении на Тренировочные 2-4** (Phase 2): пайплайн переиспользуем — три скрипта parametric, всё что нужно — placeholder в `VARIANT_KEY` + новый `task_uuid` namespace + новый seed файл `mock_exams_variant_N.sql`. Не переписывать парсер.

**Спека:** `docs/delivery/features/mock-exams-v1/spec.md` §5 (Data Model) + tasks.md TASK-2.

### 12. Mock Exams v1 — AI Part 2 grader (2026-05-07, TASK-5)

`supabase/functions/mock-exam-grade/index.ts` — background job, который вызывается fire-and-forget из student submit handler (`mock-exam-student-api`) после `status='submitted'`. Делает черновики оценок для всех Часть 2 задач (KIM 21-26 для ЕГЭ физики) по упрощённому ФИПИ-промпту Phase 1. **AI никогда не публикует ученику** — это product invariant; tutor approval через `mock-exam-tutor-api` остаётся mandatory.

**Files:**
- `supabase/functions/mock-exam-grade/index.ts` — handler + Lovable Gateway client (mirrors `homework-api/ai_shared.ts::callLovableJson` inline, чтобы не было cross-function imports между sibling edge functions)
- `supabase/functions/_shared/mock-exam-prompts.ts` — pure prompt builder + sanitizer + fallback factory. Re-declares `LovableMessage`/`LovableTextPart`/`LovableImagePart` локально (mirror `homework-api/ai_shared.ts`) чтобы `_shared/` остался свободен от cross-function dependencies.

**Phase 1 promprt simplification** (см. spec.md §5 + product-strategy.md §5):
- 4 элемента ФИПИ I-IV для №22-26: I (закон), II (обозначения), III (расчёт + подстановка), IV (ответ + единицы). `suggested_score` = число выполненных элементов 0..max_score.
- Спец-правило для №21: 3-балльная качественная задача с собственной 0..3 рубрикой; sanitizer всегда форсит `elements_check = all-false` + добавляет flag `kim21_qualitative`. Tutor UI должен скрывать I-IV чекбоксы и рендерить qualitative rubric.
- **Полный 208-стр методический разбор — Phase 2.** В Phase 1 prompt намеренно простой; ловим базовые ошибки + флагуем неоднозначные кейсы для tutor.

**Frozen JSON output shape** (см. `MockExamPart2Draft` type):
```ts
{
  suggested_score: number | null,
  confidence: 'low' | 'medium' | 'high',
  elements_check: { I: bool, II: bool, III: bool, IV: bool },
  comment_for_tutor: string,    // ≤ 600 chars
  flags: string[]               // ≤ 6 entries, snake_case, ≤ 32 chars each
}
```
`MockExamPart2Draft` тип также экспортируется из `src/types/mockExam.ts` (frontend wire-compatible). При расширении полей — синхронно править оба файла.

**Anti-leak invariants (КРИТИЧНО, защищают product invariant «AI никогда не публикует ученику»):**
1. **Endpoint response NEVER содержит `ai_draft_json` / `suggested_score` / draft contents** — только counters (`drafts_persisted`, `fallback_count`, `total_latency_ms`, `tutor_notified`). Caller (`mock-exam-student-api/handleSubmit` fire-and-forget) не должен relay payload к ученику.
2. **`solution_text` из `mock_exam_variant_tasks`** идёт **только** в system prompt server-side. Никогда не возвращается в response handler этого endpoint.
3. **Student RLS на `mock_exam_attempt_part2_solutions`** разрешает SELECT — это TASK-13 (`StudentMockExamResult`) обязан фильтровать `ai_draft_json` из response. mock-exam-grade пишет только в БД.
4. **`isAllowedSignedStorageUrl`** (mirror `homework-api/guided_ai.ts`) принимает оба host'а: direct (`vrsseotrfmsxpbciyqzc.supabase.co`) и proxy (`api.sokratai.ru`). Дублирующий paranoid SSRF guard.

**Auth контракт (два пути):**
- `Authorization: Bearer <SERVICE_ROLE>` — internal fire-and-forget из student submit handler. Service-role bypass'ит ownership check.
- `Authorization: Bearer <user JWT>` — fallback для manual re-trigger; ownership через `attempt.student_id === user OR assignment.tutor_id === user`.

**State machine guards (CAS-protected):**
- `submitted` → CAS-update в `ai_checking` (CAS guard `WHERE status='submitted'` защищает от concurrent runners)
- `ai_checking` → process → CAS-update в `awaiting_review` (только из `ai_checking`/`submitted` чтобы не клобберить concurrent tutor approve flow)
- `approved` / `manually_entered` → 409 ALREADY_APPROVED / MANUAL_ENTRY
- `in_progress` → 400 NOT_SUBMITTED
- Re-run на `awaiting_review` идемпотентен; tutor-approved строки (`tutor_approved`/`tutor_modified` в `mock_exam_attempt_part2_solutions`) **не перезаписываются** — обновляется только `ai_draft_json` field.

**Latency budget (AC-4 < 90s для 6 задач):**
- 6 Часть 2 задач параллельно через `Promise.all`. Lovable timeout 35s + 1 retry на 5xx → bound ≈ 35s typical, 70s worst-case.
- Server-to-server fetch на signed URLs обёрнут в `rewriteToDirect()` из `_shared/proxy-url.ts` (US→US, экономит 200-400ms vs Selectel proxy roundtrip).
- Image inline в base64 обязателен — Lovable Gateway не скачивает remote images сам (см. CLAUDE.md «Network & Infrastructure»).

**Photo handling:**
- `photo_url` парсится через `parsePhotoUrls` (dual-format: single ref OR JSON array, как `homework_tutor_tasks.task_image_url`). Локальный helper, не дёргать `parseAttachmentUrls` из `_shared/attachment-refs.ts` — там семантика гомерки, а здесь mock_exam.
- Если `photo_url IS NULL` → fallback `no_photo`, `flags: ['photo_missing']`, score=null.
- Если refs есть, но inline всех failed → fallback `image_inline_failed`, `flags: ['photo_unreadable']`. **Fail closed**, не зовём AI с пустым телом.
- Sanitizer: если AI возвращает любой `photo_*` flag → forced `suggested_score=null`, `confidence='low'` (даже если AI поставил score).

**Fallback drafts (when AI fails):** `buildFallbackDraft(reason, params)` — типизированные fallbacks для `timeout` / `invalid_json` / `gateway_error` / `no_photo` / `image_inline_failed`. Tutor видит `confidence='low'` + объяснительный flag + comment «оцени вручную». Score=null всегда.

**Tutor notify:** best-effort Web Push на `assignment.tutor_id` с deep-link `/tutor/mock-exams/attempts/:id/review`. VAPID env missing → silent skip; не блокирует response. Telegram/email leg отложены (нет mock-exam-specific email template).

**Wire-level URL:** `https://api.sokratai.ru/functions/v1/mock-exam-grade` (POST). Body: `{ "attempt_id": "<uuid>" }`.

**При расширении grader'а** (Phase 2 — полный 208-стр промпт):
1. Расширь `buildCriteriaBlock()` в `_shared/mock-exam-prompts.ts` — там single source of truth для prompt logic.
2. **Не меняй JSON output shape** без синхронной правки `src/types/mockExam.ts::MockExamPart2Draft` + `mock-exam-tutor-api/handleGetAttempt` (читает `ai_draft_json` из БД для review surface).
3. Если добавляешь новые fallback reasons — расширь `MockExamFallbackReason` union в обоих файлах + `flagsByReason`/`commentByReason` mappings.
4. Lovable model swap (e.g. `google/gemini-3-flash-preview` → новый): синхронно обнови константу в `homework-api/ai_shared.ts` для консистентности AI-домена.

**Validation после deploy:** см. spec.md §7 «Validation» + tasks.md TASK-5. Smoke: `curl -X POST $SUPABASE_URL/functions/v1/mock-exam-grade -H "Authorization: Bearer $SERVICE_ROLE" -d '{"attempt_id":"<uuid>"}'` → response `{ part2_task_count: 6, drafts_persisted: 6, total_latency_ms: <90000 }`.

**Спека:** `docs/delivery/features/mock-exams-v1/spec.md` §5 + AC-4 + product-strategy.md §5.

### 13. Mock Exams v1 — tutor heatmap detail (2026-05-07, TASK-10)

`src/pages/tutor/mock-exams/TutorMockExamDetail.tsx` — overview-страница пробника на route `/tutor/mock-exams/:id`. Header (breadcrumb + title + status badge) + 5 KPI cards (Сдали / В процессе / Не приступали / Средний первичный / Требует AI-проверки) + heatmap students × tasks 1–26 + amber AI-черновик банер. Click row → `/tutor/mock-exams/:id/review/:studentId` (TASK-11).

**Files:**
- `src/pages/tutor/mock-exams/TutorMockExamDetail.tsx` — page (overview + KPI + heatmap mount)
- `src/components/tutor/mock-exams/MockExamHeatmap.tsx` — таблица 5×26 + Часть 1/2 разделитель + 3 итоговые колонки (Часть 1 / Часть 2 / Итого)
- `src/components/tutor/mock-exams/mockHeatmapStyles.ts` — single source of truth для cell colors (cell-correct / cell-partial / cell-wrong / cell-empty / cell-draft / cell-low-conf), exports `getMockCellStyle`, `getMockTotalsStyle`, `MOCK_CELL_LEGEND`. **Не дублировать** color helper — импортировать отсюда (как `heatmapStyles.ts` для homework results)
- `src/hooks/useMockExamAssignment.ts` — React Query hook, key `['tutor','mock-exams','assignment', id]`

**КРИТИЧНО для iOS Safari** (.claude/rules/80-cross-browser.md, mirror `HeatmapGrid.tsx`):
- `border-separate border-spacing-0` + `<colgroup>` фиксированных ширин: `border-collapse` ломает `position: sticky` на `<td>`/`<th>` в WebKit.
- `width: max-content` + `tableLayout: 'fixed'`: иначе table-layout сжимает столбцы под container и `overflow-x-auto` никогда не активируется.
- `touch-pan-x` на wrapping `<div>`: row onClick может съесть touchstart на iOS и заблокировать horizontal swipe.
- `React.memo` на `HeatmapRow` + `HeatmapCell`: 5×27 ≈ 135 ячеек, без memo expand/collapse лагает.

**Layout (`<colgroup>`):** 220px sticky name + 20×34px (Часть 1) + 12px spacer + 6×46px (Часть 2) + 80px×3 (totals). Total table width = `220 + 20·34 + 12 + 6·46 + 3·80 = 1428px`.

**Phase 1 ограничение per-task hydration:** `mock-exam-tutor-api::handleGetAssignment` возвращает только attempt-level totals (`total_part1_score`, `total_part2_score`, `total_score`, `status`). Per-task scores (cell-by-cell colored values) **не hydrate'ятся** — все 26 task-клеток рендерятся как `cell-empty`. Часть 2 для `awaiting_review`/`submitted` форсится в `cell-draft` для визуального сигнала. Полная per-task hydration — Phase 2 (потребует extension `handleGetAssignment` или отдельный batch-endpoint, mirror `getResults` для homework). Структура heatmap'а готова к hydration без рефакторинга.

**part1_max / part2_max heuristic:** detail payload не содержит explicit `part1_max` / `part2_max` (только `total_max_score`). Код hardcode'ит ЕГЭ физика = 28 (Часть 1) + 17 (Часть 2) = 45. Когда backend начнёт возвращать explicit поля — заменить на `detail.part1_max` / `detail.part2_max`.

**Sort priority в `MockExamHeatmap`:** `awaiting_review (0) → submitted (1) → in_progress (2) → approved (3) → manually_entered (4) → not_started (5)`. Внутри одного приоритета — alphabetical по `student_display_name` (RU locale).

**Anonymous attempts (lead):** для attempt без `student_id` row clickable и navigate'ит на `:studentId = anonymous_id`. TutorMockExamReview (TASK-11) разрулит через тот же match.

**Спека:** `docs/delivery/features/mock-exams-v1/spec.md` AC-5 + tasks.md TASK-10 + product-nuances.md (mockup Screen 3).

### 14. Mock Exams v1 — tutor review surface (2026-05-07, TASK-11)

`src/pages/tutor/mock-exams/TutorMockExamReview.tsx` — главная value-proposition surface продукта: tutor approves/корректирует AI Часть 2 черновик. Route `/tutor/mock-exams/:id/review/:studentId`. Контракт «AI never publishes to student» — формальный product invariant: пока tutor не нажмёт «Подтвердить и отправить», ученик и родители ничего не видят.

**Files:**
- `src/pages/tutor/mock-exams/TutorMockExamReview.tsx` — page
- `src/hooks/useMockExamAttempt.ts` — React Query hook, key `['tutor','mock-exams','attempt', id]`

**Resolution `:studentId` → attemptId:**
- URL convention `:studentId` — это `student_id` (auth.users.id) для авторизованных учеников ИЛИ `anonymous_id` для лидов
- Page сначала загружает assignment через `useMockExamAssignment(:id)`, затем match'ит attempt по `student_id === param || anonymous_id === param` и берёт `attempt.id` для `useMockExamAttempt(attemptId)`
- Mismatch → empty-state «Попытка не найдена»

**Per-task approve flow:**
- Каждая Часть 2 карточка имеет два action'а: «Подтвердить: {ai_suggested}/{max}» (quick-approve preselect AI suggestion) и «Изменить балл» (Pencil → modal с input 0..max + comment textarea)
- POST `/attempts/:id/approve-task` с `{ kim_number, score, comment? }`. Backend ставит `status = 'tutor_modified'` если `tutor_score !== ai_draft.suggested_score` ИЛИ непустой comment, иначе `'tutor_approved'`
- На success: invalidate `['tutor','mock-exams','attempt', id]` + toast «Задача №N подтверждена»

**Global approve flow (nuance #9):**
- Sticky-feel footer counter «Подтверждено: N/6 заданий» + button «Подтвердить и отправить»
- Button **disabled пока N !== 6** — нельзя пропустить ни одну задачу. AlertDialog подтверждение перед POST `/attempts/:id/approve-all`
- AlertDialog message: «После этого ученик и родители получат результат: первичный балл X из Y. Перепроверка возможна — ты сможешь скорректировать любую задачу позже.»
- На success: invalidate attempt + assignment + assignments list, toast с delivery channel (push/telegram/email), navigate back на `/tutor/mock-exams/:id` через 800ms

**Anonymous lead bar (nuance #2 — КРИТИЧНО):**
- `isAnonymous(attempt) === true` (нет `student_id`, есть `anonymous_id`) → footer показывает amber «Анонимный лид» chip + текст «Bulk-approve недоступен. Проверь каждый пункт вручную.»
- Per-task approve работает как обычно. Global approve тот же путь, но контракт «делать медленно» — UI не предоставляет shortcut'ов
- Telemetry override rate должна быть отдельная для anonymous vs existing (Phase 2)

**Reasoning visibility (nuance #1):**
- Каждая Часть 2 карточка рендерит `ai_draft.elements_check` как 4 чипса I/II/III/IV (I — Закон / II — Обозначения / III — Расчёт + подстановка / IV — Ответ + единицы) с Lucide Check (passed) / X (failed) — **никогда emoji**
- AI `comment_for_tutor` рендерится через lazy `MathText` (LaTeX-aware) с amber border-l-2
- Confidence chip: high → emerald `CheckCircle2 + AI уверен`, medium → amber `AlertCircle + AI колеблется`, low → rose `AlertCircle + AI не уверен`

**Low-confidence + photo unreadable (nuance #5):**
- `confidence === 'low'` ИЛИ `ai_draft === null` → карточка рендерится с `border-2 border-rose-300` + rose header + явный rose alert «**AI не смог распознать.** Открой фото и поставь оценку самостоятельно»
- `photo_url === null` → отдельный alert «Фото решения не загружено или нечитаемо. Запроси переснимку у ученика в Telegram или поставь оценку вручную»

**№21 (kim21_qualitative flag):**
- Sanitizer в `mock-exam-grade` форсит `elements_check = all-false` + flag `kim21_qualitative` для №21
- UI **скрывает** I/II/III/IV чипсы для таких карточек, рендерит amber hint «№21 — качественная задача с собственной 0..3 рубрикой (см. блок-схему ФИПИ)»
- Score override modal остаётся доступен (0..3)

**Read-only states:**
- `attempt.status === 'approved'` или `'manually_entered'` → footer заменяется на emerald «Работа подтверждена и отправлена. Ученик и родители уже видят результат». Per-task action row (Изменить / Подтвердить) скрыт во всех карточках
- Это intentional terminal state. Phase 2 может разрешить «re-grade» — отдельная фича

**Score override read-only (nuance #3):**
- `tutor_score` отображается только в header карточки («Подтверждено: 2/3») и в фокусной dialog. Inline editing **запрещён** — всегда через explicit «Изменить балл» modal. Это защищает от accidental edit при scroll/focus
- Modal содержит `<input type="number" min={0} max={maxScore}>` (`text-base` 16px для iOS) + `<textarea>` для comment + конфирм «Подтвердить: N / M»

**LaTeX rendering:**
- `MathText` импортируется через `React.lazy()` (KaTeX весит ~400KB). `<Suspense>` fallback = plain text
- Применяется к: `solution.task_text` (условие задачи), `ai_draft.comment_for_tutor` (AI обоснование), `solution.tutor_comment` (tutor комментарий, если был)

**Cross-cutting:**
- Все Inputs `text-base` (16px) — iOS Safari auto-zoom prevention
- `loading="lazy"` на `<img>` фото решения; click → открывается в новой вкладке (target="_blank")
- Lucide-иконки везде, **без emoji** в card chrome / actions / status (rule 90-design-system.md)
- shadcn Card / Button / Badge / Dialog / AlertDialog (rule 90)

**Спека:** `docs/delivery/features/mock-exams-v1/spec.md` AC-5 + tasks.md TASK-11 + product-nuances.md #1, #2, #3, #5, #9 (mockup Screen 4).

### 15. Mock Exams v1 — student result surface (2026-05-07, TASK-13)

`src/pages/student/StudentMockExamResult.tsx` — student-side result page на route `/student/mock-exams/:id/result`. Реализует contract «Часть 1 immediate, Часть 2 only after tutor approval» — формальный product invariant из spec §3 (p.107). Backend endpoint `GET /student/:assignmentId/result` (`mock-exam-student-api/index.ts::handleGetResult`) построен как **state-aware reveal** с column-whitelisted SELECT.

**Files:**
- `supabase/functions/mock-exam-student-api/index.ts` — `handleGetResult` + новый route `GET /student/:assignmentId/result`
- `src/lib/studentMockExamApi.ts` — `getStudentMockExamResult()` + types `StudentMockExamResultView`, `StudentMockExamResultPart1Answer`, `StudentMockExamResultPart2Solution`, `StudentMockExamResultTutor`
- `src/hooks/useStudentMockExamResult.ts` — React Query hook
- `src/pages/student/StudentMockExamResult.tsx` — page

**Anti-leak invariants (КРИТИЧНО, state-aware reveal — НЕ tutor-only forever):**

⚠️ **Прежде чем читать список** — для понимания контракта: mock-exams anti-leak фундаментально **отличается** от homework anti-leak (`.claude/rules/40-homework-system.md` → «Эталонное решение для AI и anti-leak»). Homework: `solution_text` / `rubric_*` — tutor-only **forever**, ученик не видит никогда. Mock-exams: **state-aware** — после `approved` ученик видит Часть 2 разбор, **это и есть value-proposition**. Если будущий code-review reviewer пишет «`solution_text` leak на result page» — он перепутал homework- и mock-exams-семантику. Подтвердить через `attempt.status` gate: pre-approval → нет; post-approval → yes by design. См. §10 для каноничного описания state-aware vs tutor-only различия.

1. **`ai_draft_json` НИКОГДА не возвращается** ученику — endpoint вообще не SELECT'ит это поле. Tutor-only artifact (мог отличаться от final approved score). Это инвариант параллелен TASK-5 grader (CLAUDE.md §12) — там endpoint response никогда не содержит `ai_draft_json`/`suggested_score`/draft contents; здесь он не возвращается клиенту даже когда tutor approve состоялся.
2. **`correct_answer`** revealed только post-submit (`status !== 'in_progress'`). Pre-submit endpoint вообще не отвечает (см. §3 ниже).
3. **`tutor_score` / `tutor_comment` / `solution_text` / `task_text` (Часть 2)** revealed только при `status === 'approved'`. Conditional SELECT на стороне backend: `isApproved ? "...tutor_score, tutor_comment..." : "kim_number, photo_url, status"`. Не «всегда select + отфильтровать на сериализации» — поля отсутствуют в памяти процесса до approval. **Это НАМЕРЕННЫЙ reveal post-approval, не leak** — после tutor approval ученик видит разбор Части 2 (включая `solution_text` от учителя) как финальный value-deliverable.
4. **`topic` revealed на result page по дизайну** — `Part1AnswerRow` / `Part2SolutionView` рендерят `solution.topic` намеренно (помогает ученику ориентироваться в feedback'е после сдачи). AC-P5 (mock-exams-v1-pilot-polish spec) ограничен **только taking page** (`/student/mock-exams/:id`), result page (`/student/mock-exams/:id/result`) — explicit whitelist. См. tasks.md TASK-5 done-блок: «Видимый leak `solution.topic` в `StudentMockExamResult:293` намеренно оставлен (review surface после submit, не taking page, вне AC-P5)».
5. **Tutor card whitelist** — только `name, avatar_url`. **Никогда** `telegram_id` / `telegram_username` / `booking_link` / `email`. Mirror `mock-exam-public::loadTutorCard` whitelist но более узкий (`bio` / `subjects` опущены — student уже знает своего репетитора).

**Status gate (409 NOT_SUBMITTED):**
- `status === 'in_progress'` → 409 `{error: {code: 'NOT_SUBMITTED'}}`. Frontend hook (`useStudentMockExamResult.isStillInProgress`) детектит код и в `useEffect` redirect'ит на `/student/mock-exams/:id` (taking surface). Это защита: result page не должен mounted'ся на активном экзамене (даже если ученик manually вбил URL).
- `status === 'manually_entered'` → render отдельной `ManualEntryView` с totals + `manual_comment`, БЕЗ per-task разбора. По дизайну: manual entry = backfill прошлого пробника без AI/tasks.

**State machine UI** (page renders by `attempt.status`):
- `submitted | ai_checking | awaiting_review` → Часть 1 reveal (big score + collapsible 20-row table) + amber Часть 2 pending card («Репетитор Х сейчас проверяет — результат придёт в Telegram в течение 24ч») + grey placeholder для финального summary.
- `approved` → Часть 1 reveal + Часть 2 reveal (per-task cards с условием + photo ученика + tutor comment + collapsible эталон) + final summary с большим первичным баллом + бенчмарк-полоса (anchors 40% порог / 66% хорошо).
- `manually_entered` → `ManualEntryView` (totals + manual_comment).
- `in_progress` → 409 → redirect.

**React Query invalidation на push trigger:**
- Query key `['student','mock-exam','result', assignmentId]`, stale time 30s, gc 5m.
- `refetchOnWindowFocus: true` + `refetchOnReconnect: true` — при approval tutor пушит на `assignment.tutor_id` push notification со deep-link на result page. Ученик кликает push → window regains focus → query refetches → новый `approved` status surface'ится без race conditions и без realtime подписок.
- `retry` дискриминирует deterministic state errors (404 / 409 / 401) от network errors — не ретраит первые.

**Manual entry vs approved (UX deviation):**
- Manual entry — отдельный render path (`ManualEntryView`), не reuse approved code path. Причина: для manual entry per-task records нет (`part1_answers` / `part2_solutions` пусты по дизайну backend), totals — единственный источник. Approved path требует non-empty arrays для valuable rendering.

**При расширении endpoint:**
1. Никогда не SELECT *. Whitelist колонок остаётся жёстким.
2. Любое новое поле в `mock_exam_variant_tasks` или `mock_exam_attempt_part2_solutions`, видимое student'у, требует явного решения: pre-submit (нельзя — anti-leak), post-submit (Часть 1 only), post-approval (Часть 2 only). Default = post-approval (paranoid).
3. `ai_draft_json` — никогда. Если когда-то понадобится показать AI-rationale ученику — это отдельная product decision + spec, не silent extension.
4. При добавлении нового storage bucket для `task_image_url` или `solution_image_urls` — `resolveSignedUrl` использует `parseStorageRef` (bucket из ref'а), новые bucket'ы работают автоматически. Path-traversal guard уже есть.

**State-aware task SELECT (post-TASK-15, 2026-05-14):** `handleGetResult` теперь делает **conditional SELECT** на `mock_exam_variant_tasks` по `isApproved`:
- Pre-approval (`submitted` / `ai_checking` / `awaiting_review`): SELECT `kim_number, part, correct_answer, check_mode, max_score` only. `task_text` / `solution_text` / `topic` **не загружаются в process memory**.
- Post-approval: SELECT full set (включая `task_text` / `task_image_url` / `solution_text` / `topic`).
Defense-in-depth: даже если кто-то добавит новое sensitive поле — pre-approval сериализация невозможна (нечего сериализовать). Если будущий endpoint расширяется на новый status — recompute `isApproved` гейт ДО SELECT'а.

**Bulk Часть 2 photos на result (post-TASK-15, 2026-05-14):** `attempt.part2_bulk_photo_urls` (single ref OR JSON-array string, dual-format mirror `task_image_url`) теперь резолвится в signed URLs array и возвращается клиенту. Frontend `StudentMockExamResult::Part2BulkPhotosGallery` рендерит collapsible grid для pending (collapsed по умолчанию) и approved (expanded). Click thumbnail → signed URL in new tab. Phase 5 ARCH invariant: photos живут в `attempts.part2_bulk_photo_urls`, не в `mock_exam_attempt_part2_solutions.photo_url` — last is legacy per-KIM, NULL для bulk attempts.

**Спека:** `docs/delivery/features/mock-exams-v1/spec.md` AC-5 + tasks.md TASK-13 (mockup Screen 6) + `mock-exams-v1-pilot-polish/review-fixes-spec.md` (TASK-15 anti-leak hardening + bulk photos).

### 15a. Mock Exams v1 — Part 1 deterministic checker + F3 rounding tolerance (2026-05-14)

`src/lib/mockExamPart1Checker.ts` — **canonical** TS-реализация авточекера Часть 1 (`checkPart1Answer` + per-mode `checkStrict` / `checkOrdered` / `checkUnordered` / `checkMultiChoice` / `checkTask20` / `checkPair`). Pure, без React/DOM/Supabase imports. Используется и на student device (preview before submit в `MockExamTaking.tsx`), и в edge function `mock-exam-student-api::handleSubmitAttempt`. Unit tests — `scripts/test-mockexam-checker.mjs` (node:test + esbuild trick, **canonical** test infrastructure для модуля).

**Deno-mirror invariant:** `supabase/functions/mock-exam-student-api/index.ts` содержит ровно ту же логику (Supabase Edge Functions запрещают cross-file relative imports выше `_shared/`). Любое изменение `mockExamPart1Checker.ts` **ОБЯЗАНО** синхронно отражаться в Deno-mirror'е, иначе client preview и server-side submit разойдутся → ученик увидит «правильно» в превью, но получит 0 на финале (или наоборот). Симптом: bug-report «авточекер не согласован». Перед merge: `grep -n "checkStrict\|checkOrdered\|numericRoundingMatch" src/lib/mockExamPart1Checker.ts supabase/functions/mock-exam-student-api/index.ts` — обе реализации должны иметь одинаковый набор функций и одинаковую логику.

**F3 numeric rounding tolerance (mock-exams-v1-pilot-polish TASK-3, 2026-05-14):**
- `numericRoundingMatch(student, correct): boolean | null` — fallback в `check_mode='strict'` ветке когда обычное строковое сравнение FAIL. Парсит оба значения через существующий `normalizeNumber` (поддерживает RU локаль `,` → `.`). Scale округления = decimals в `correct`. Возвращает `true` если `round(student, scale) ≈ correct` (tolerance `1e-9`), `false` если оба numeric но не совпадают после округления, `null` если хотя бы один не numeric (caller остаётся на строковом FAIL).
- **Strict-only invariant (КРИТИЧНО):** rounding tolerance применяется **ТОЛЬКО** в `case 'strict'` диспатча `checkPart1Answer`/`checkPart1`. НЕ трогать `multi_choice` / `ordered` / `unordered` / `pair` / `task20` / `manual` — там другая семантика (multiset / sequence / pair с unit). Регрессивный тест `AC-P3 guardrail: rounding tolerance does NOT bleed into other modes` в `scripts/test-mockexam-checker.mjs` защищает от утечки.
- **Scale-of-correct invariant:** НЕ округляем student шире чем scale of correct. Кейс `5.5 vs 5` → round(5.5, scale=0) = 6 ≠ 5 → FAIL (не подгоняем 5.5 → 5). Это сохраняет защиту репетитора от ученика-сачка.
- **Telemetry:** `console.info('[mock-exam-checker] numeric_rounding_match', { kim, student, correct, scale })` при срабатывании. PII-free. `kim` берётся из optional `kimNumber` поля в `CheckPart1Input` (TS) / 5-го arg в `checkPart1` (Deno mirror). Caller (`handleSubmitAttempt`) пробрасывает `task.kim_number`.
- **Существующий `numbersEqual` оставлен** для `checkStrict` primary path и `checkPair` value comparison — он покрывает кейсы типа `5.6 vs 5.60` / `9.81 vs 9.8` (relative 1% или absolute 0.01). F3 rounding — отдельный layer для случая «student точнее correct», где `numbersEqual` слишком жёсткий (0.216 vs 0.2 → diff 0.016 > tolerance 0.01).

**Спека:** `docs/delivery/features/mock-exams-v1-pilot-polish/spec.md` AC-P3 + `docs/delivery/features/mock-exams-v1-pilot-polish/tasks.md` TASK-3.

### 16. Student Homework Problem Screen — single-task surface + submission contract (Phase 1, 2026-05-09; Phase 3 landed 2026-05-12; Phase 3.1 hotfixes 2026-05-13)

Phase 1 mobile-first student-side homework problem screen. Mobile (`viewport ≤768px`) на route `/student/homework/:hwId/problem/:taskId`. **Phase 3 (2026-05-12, ✅ landed)** расширил screen на tablet (769–1279) + desktop (≥1280) split layout — `StudentHomeworkDetail` стал redirect-only для **всех** viewport'ов (`useIsMobile()` gate удалён), legacy `GuidedHomeworkWorkspace` рендеринг отключён со student-side (физическое удаление файла отложено на Phase 4 cleanup spec). **Без feature flag** — раскатка сразу всем юзерам. Полный контракт (handlers / migrations / anti-leak / shared helper / viewport routing / Phase 3 split layouts) в `.claude/rules/40-homework-system.md` → секции «Student Homework Problem Screen — single-task surface + submission contract» + «Student Homework Problem Screen — Phase 3 split layouts (2026-05-12)».

**Migrations (2):**
- `20260509120000_add_task_kind_to_homework_tasks.sql` — `homework_tutor_tasks.task_kind text NOT NULL DEFAULT 'extended' CHECK IN ('numeric','extended','proof')` + backfill из `check_format`.
- `20260509120100_add_submission_payload_to_thread_messages.sql` — `homework_tutor_thread_messages.submission_payload jsonb NULL` + расширенный CHECK на `message_kind` (NULL OR IN 11 значений включая `'submission'`).

**Endpoints (2):**
- `GET /student/problem/:hwId/:taskId` (`handleGetStudentProblem`) — single-task surface. Whitelist на assignment + tasks SELECT'ах (НЕ `solution_*` / `rubric_*`). Lazy thread provisioning. `task_score` через existing `computeFinalScore`.
- `POST /student/problem/:hwId/:taskId/submission` (`handleStudentSubmission`) — single-shot submit. Body `{numeric, photos[], text}`. task_kind requirements server-side. Photo refs validated через canonical `extractStudentThreadAttachmentRefs` (Patch B+2 / SSRF / bucket whitelist). Insert submission message (kind='submission' + submission_payload JSONB) + reuse `runStudentAnswerGrading` shared helper (feedbackKind='check_result').

**Single source of truth для AI grading (КРИТИЧНО):**

`runStudentAnswerGrading` извлечён 2026-05-09 из `handleCheckAnswer`. Owns: image/OCR/student-name resolution → `evaluateStudentAnswer` → confidence guard → effective ai_score → AI feedback message insert (caller-controlled `feedbackKind`) → verdict branching + state update + `performTaskAdvance`. **Both** `handleCheckAnswer` (chat: `feedbackKind='ai_reply'`) **и** `handleStudentSubmission` (submission: `feedbackKind='check_result'`) используют его. Не дублировать grading logic — при изменении правь helper, не callers.

**Anti-leak invariants (mirror правил §9):**
1. `submission_payload` echoed back через `THREAD_SELECT` — raw client input (`storage://` refs, не resolved signed URLs).
2. Tasks SELECT в новом endpoint'е НЕ включает `solution_text` / `solution_image_urls` / `rubric_text` / `rubric_image_urls` (compile-time гарантия в response shape).
3. `submission_payload` JSONB — **только** structured object `{numeric: string, photos: string[], text: string, voice_ref?: string|null}`. Никаких raw user-input полей которые render'ятся как HTML.
4. `evaluateStudentAnswer` без submission-specific prompt hints в Phase 1 — Phase 2 owns OCR + 4-verdict pipeline (отдельная спека).

**THREAD_SELECT extended (2026-05-09):** добавлен `submission_payload` в nested message select. При добавлении нового nullable поля в messages, видимого ученику — расширять `THREAD_SELECT` явно, не `select("*")`.

**Старая `/homework/:id` сurface стала redirect-only после Phase 3** (2026-05-12) — для **всех** viewport'ов редирект на `/student/homework/:hwId/problem/:taskId` со smart fallback (current_task_id → first not-completed → tasks[0]). Inline `GuidedHomeworkWorkspace` рендеринг удалён со student-side. Phase 4 cleanup spec физически удалит `GuidedHomeworkWorkspace.tsx` + `GuidedChatInput.tsx` + `TaskStepper.tsx` после Phase 3 stable ≥7 дней.

**Hybrid first-completed-wins (TASK-8, 2026-05-09):** чат incremental (`handleCheckAnswer` через каждое user-сообщение) И SubmitSheet single-shot (`POST /student/problem/.../submission`) пишут в одно `task_state`. Whichever path первым выставит `status='completed'` — фиксирует score; второй после completion = 409-style ignore + SubmitSheet CTA меняется на «Следующая задача →».

**Hint cap = none (намеренно):** существующая `available_score` %-degradation в `handleRequestHint` сохраняется. Дизайн-handoff'ный mock «Подсказка 1/3» **не реализуется** в Phase 1 — UI показывает counter «Подсказок: N» без cap'а.

**Viewport routing hook:** Phase 1 routing использует **новый** `@/hooks/useIsMobile.ts` (inclusive `(max-width: 768px)`, SSR-safe initial state). Legacy `@/hooks/use-mobile.tsx::useIsMobile` (exclusive `<768`, undefined initial) **не подходит** для problem-screen routing — оставлен только для chrome callsite'ов (`MobileTopBar`, etc.). Канонический gate для нового screen — только новый hook.

**Phase split + rollout summary:**
- **Phase 1 (mobile)** — ✅ landed 2026-05-09.
- **Phase 2 (grading pipeline)** — deferred. Gemini OCR + 4 verdicts (`no-work` / `step-error` / `unclear`) + voice recorder в SubmitSheet + autosave drafts + tutor task_kind selector в `TutorHomeworkCreate`. Spec: TBD `student-homework-problem-grading-pipeline.md`.
- **Phase 3 (tablet + desktop split layouts)** — ✅ landed 2026-05-12. Plan-only spec `~/.claude/plans/toasty-weaving-meerkat.md`. Universal redirect (часть Phase 4 scope landed раньше), `AuthGuard fullBleed='below-xl'`, новые компоненты `ChatChipRow` / `SubmitCtaBar` / `MathQuickPicker`, additive props `ProblemContext.hideToggle` / `NumericAnswerComposer.hideDiscussion`.
- **Phase 4 (cutover cleanup)** — partial. Universal redirect уже в Phase 3. Осталось: физически удалить `GuidedHomeworkWorkspace.tsx` + `GuidedChatInput.tsx` + `TaskStepper.tsx`. Spec: TBD `student-homework-problem-cutover.md`.

Полный rollout-summary + Phase split table + hook canonicalization → `.claude/rules/40-homework-system.md` → секции «Student Homework Problem Screen — viewport routing + submission contract (2026-05-09)» + «Student Homework Problem Screen — Phase 3 split layouts (2026-05-12)».

**Спека:** `docs/delivery/features/student-homework-problem-screen/spec.md` (Phase 1, AC-1..AC-11).

### 17. AI quota model — context-aware daily limit (2026-05-12)

Дневной лимит AI-сообщений теперь **context-aware**. Free-ученик с хотя бы одним платящим/trial репетитором получает `daily_limit = 50` в homework-контексте; во всех остальных случаях `10`. Premium/trial самого ученика — unlimited (`-1`). Plan: `~/.claude/plans/mutable-dancing-alpaca.md`.

**Single source of truth — RPC `get_subscription_status(p_user_id uuid, p_context text default 'chat')`:**
- Миграция `20260512120000_ai_quota_for_paid_tutor_students.sql` DROP'ает 1-arg signature и создаёт 2-arg с default `p_context := 'chat'` (backward compat для legacy callers).
- В `homework` контексте RPC проверяет `tutor_students JOIN tutors JOIN profiles` и возвращает `daily_limit=50` если хотя бы один tutor с `subscription_tier='premium' AND subscription_expires_at > now()` ИЛИ `trial_ends_at > now()`.
- Возвращает дополнительное поле `tutor_can_upgrade boolean` — `true` когда у студента **есть** тутор, но **ни один не платит**. Marketing nudge для 429 toast.
- Counter `daily_message_limits` **один на user** — context влияет только на порог, не на bucket. Семантика: free-юзер за день может потратить ≤50 AI-вызовов, из них chat-вне-ДЗ режется на 10, остальные 40 — только в ДЗ.

**Shared helper `supabase/functions/_shared/subscription-limits.ts`:**
- `checkAiQuota(userId, db, { context, incrementUsage })` — канонический gate. Возвращает `{ allowed, limit, messagesUsed, tutorCanUpgrade, ... }`.
- `buildLimitReachedResponse(result, corsHeaders)` — 429 response с `tutor_can_upgrade` в payload.
- Fallback path при RPC failure: читает `profiles` напрямую (без tutor-lookup), возвращает `allowed=true, limit=10` — не блокируем юзеров на RPC outage.

**Где применён guard (все 4 AI-пути в ДЗ):**
- `chat/index.ts` — 3 call sites (voice line ~798, service-role ~933, authenticated ~991) пробрасывают `context: 'homework'` когда `body.guidedHomeworkAssignmentId` присутствует. Покрывает chat-discuss + bootstrap intro.
- `homework-api/index.ts::handleCheckAnswer` (line ~6585) — `context: 'homework'`, telemetry `homework_ai_quota_reached`.
- `homework-api/index.ts::handleRequestHint` (line ~7077) — то же.
- `homework-api/index.ts::handleStudentSubmission` (line ~6829, Phase 1 mobile) — то же.

**Инвариант для новых AI-путей в `homework-api`:**
- Любой новый handler, делающий AI-вызов в контексте ДЗ (через `evaluateStudentAnswer` / `generateHint` / прямой `streamChat`), **ОБЯЗАН** вызвать `checkAiQuota(userId, db, { context: 'homework', incrementUsage: true })` **до** AI-call и вернуть `buildLimitReachedResponse(result, cors)` при `!allowed`. Иначе AI-операция обходит лимит (наблюдаемый случай: до 2026-05-12 hint/check работали бесконечно бесплатно).
- Lovable Gateway requests стоят денег — gate должен резать запрос **до** AI call, не после.
- Не дублируй RPC-логику в новом коде — импортируй `checkAiQuota` из `_shared/subscription-limits.ts`.

**Frontend — `src/hooks/useSubscription.ts`:**
- Опциональный параметр `useSubscription(userId, context: 'chat' | 'homework' = 'chat')`. По умолчанию `'chat'` (backward compat). Передавать `'homework'` на homework-screen для корректного отображения 50/день в UI (P1 follow-up, пока не мигрировано).
- Читает `tutor_can_upgrade` из RPC payload.

**Маркетинг:**
- В `src/components/sections/tutor/Pricing.tsx` тариф AI-старт содержит буллет «50 AI-сообщений в день для каждого ученика в ДЗ».
- На 429 в homework контексте для не-платящего тутора фронт может показать nudge «Ваш репетитор может поднять лимит до 50/день в тарифе AI-старт» (использовать `tutor_can_upgrade` из response).

**Ручная активация premium для конкретных тьюторов:**
- Готовой админ-функции/RPC нет. UPDATE `public.profiles SET subscription_tier='premium', subscription_expires_at='<ISO>'` через Supabase SQL editor.
- Audit trail (опционально) — INSERT в `public.payments` с `id='manual-<date>-<identifier>'`, `amount` в **DECIMAL рублях** (не копейках), причина в `webhook_data JSONB`. Колонки: `id, user_id, amount, currency, status, subscription_days, subscription_activated_at, subscription_expires_at, webhook_data` (см. миграция `20251222120000_create_payments_table.sql`).
- Активировано 2026-05-12: Егор Блинов (до 2026-12-31, партнёрский комп), Елена `lenan@inbox.ru` (до 2026-06-06, 3000₽ 50% скидка), Вадим `petrenkovlad576@gmail.com` (до 2026-06-09, 1000₽ 50% скидка).

**Истечение / downgrade:**
- Cron'а **нет**. После `subscription_expires_at < now()` RPC возвращает `is_premium=false`, но `subscription_tier='premium'` в БД остаётся — это normal state. Юзер фактически free, лимиты применяются. При новой оплате webhook видит «просрочена» и ставит срок от now.

### 18. Subject-aware AI prompts — все 3 пути в guided chat (2026-05-15)

Все три пути AI в guided homework chat обязаны учитывать `homework_tutor_assignments.subject`. До этого фикса `buildHintPrompt` начинался словами «Ты — физик-наставник», `buildFallbackHint` отдавал «Какая физическая величина это описывает и какой закон с ней связан?», а `chat/index.ts SYSTEM_PROMPT` вообще не получал subject. Симптом — репетитор по французскому языку задал ДЗ на письмо DELF B1, ученик на любую попытку получал ответ AI про физические величины.

**Три пути и где живёт subject:**
- **Check (`handleCheckAnswer` → `evaluateStudentAnswer` → `buildCheckPrompt`)** — уже корректно использовал `params.subject` (`Предмет: ${params.subject}` в system prompt, `guided_ai.ts:1043`). Эталон.
- **Hint (`handleRequestHint` → `generateHint` → `buildHintPrompt`)** — теперь использует `buildHintRoleLine(subject)` + `buildHintExamplesLine(subject)`. Hardcoded «Ты — физик-наставник» и «Ньютон, Ом, Кирхгоф» удалены.
- **Hint fallback (`buildFallbackHint` → срабатывает при leak-detector reject / exception)** — принимает `subject`, branch'ит по физика / математика / гуманитарные / etc. `buildValidatedFallbackHint` пробрасывает; оба callsite (`guided_ai.ts:1707, 1720`) передают `params.subject`.
- **Chat (`/chat` endpoint → discussion + bootstrap)** — `ChatRequestBody.subject` принимается, **server-side подтверждается** через SELECT `homework_tutor_assignments.subject` (Promise.all с taskRow fetch для нулевого latency overhead). DB value **выигрывает** над client-supplied (anti-tamper). Subject-aware блок инжектируется в `effectiveSystemPrompt` сразу после base `SYSTEM_PROMPT`.

**Frontend цепочка (3 callsite пробрасывают `assignment.subject`):**
- `src/lib/streamChat.ts` — `StreamChatOptions.subject` + body field.
- `src/components/homework/GuidedHomeworkWorkspace.tsx` — legacy desktop callsite (main + bootstrap).
- `src/pages/student/HomeworkProblem.tsx` — mobile/Phase 3 callsite.

**Subject helpers — два каноничных места** (НЕ дублировать в новом коде):
- **Frontend (TS):** `getSubjectLabel(id)` в `src/types/homework.ts:52`. Используй для UI-рендеринга.
- **Edge function (Deno):** `SUBJECT_LABELS_DENO: Record<string, string>` + `getSubjectLabelDeno()` дублируется inline в **двух** edge function'ах: `guided_ai.ts` и `chat/index.ts`. Deno не может импортировать `src/types/homework.ts`, поэтому каждый edge function держит свою копию. При добавлении нового subject в `SUBJECTS` (`src/types/homework.ts`) **обязательно** синхронно обновить обе Deno-копии — иначе AI получит raw `subject id` («french») вместо человеческого («Французский язык») в system prompt.

**`isHumanitiesWritingSubject` — UX-маркер для письма** (`src/lib/subjectHelpers.ts`):
- Один helper, frontend-only. Возвращает `true` для `russian / literature / english / french / spanish` (+ legacy `rus`).
- Используется в **3 точках UX-адаптации**:
  - `ProblemContext.tsx`: amber banner для `task_kind='extended'` переключается на «Это письменная задача — напиши развёрнутый ответ с ходом рассуждений» (вместо физико-математической формулировки).
  - `SubmitSheet.tsx`: numeric input row **скрывается** для humanities-extended (нет смысла в «числовом ответе» для письма). Backend `handleStudentSubmission` уже разрешает `photos.length >= 1 OR text.trim().length > 0` для extended (см. §16 preview-QA #9 relax) — никаких миграций / backend изменений.
  - `SubmitCtaBar.tsx` + mobile inline big-CTA в `HomeworkProblem.tsx`: subtitle меняется с «Ответ + фото решения от руки» на «Текст или фото готового решения».
- НЕ помечать как humanities: `maths` / `informatics` / `history` / `social` / `chemistry` / `biology` / `geography` — у них есть числовой ответ либо краткий ответ-факт.
- При расширении subject в `SUBJECTS` — решить осознанно: humanities-writing (письмо как value) или нет. Default = НЕ humanities-writing (безопасно для физико-математической UX).

**При добавлении нового AI-пути в guided chat:**
- Если делаешь новый prompt-builder в `guided_ai.ts` — **обязательно** принимай `subject: string` в `Params` interface (mirror `EvaluateStudentAnswerParams.subject` / `GenerateHintParams.subject`). Hardcode хотя бы одну subject-aware строку в systemContent через `getSubjectLabelDeno(params.subject)`. НЕ копируй pattern «Ты — физик-наставник».
- Если делаешь новый endpoint, использующий `/chat`, и хочешь чтобы AI знал предмет — добавь `subject` в body (со страницы где есть `assignment.subject`); server-side `processAIRequest` сам подтвердит через DB если есть `guidedHomeworkAssignmentId`.
- При добавлении нового UX-маркера типа «эссе vs задача» — расширь `subjectHelpers.ts`, не делай ad-hoc switch'и в компонентах.

**Симптом нарушения инварианта (наблюдаемый кейс 2026-05-15):** ученик на ДЗ с `subject != 'physics'` получает от AI ответы вида «назови физическую величину» / «какой закон с ней связан» / «как из формулы Ньютона выразить...». Грепнуть hint/chat path на отсутствующий subject parameter:
```bash
grep -nE "buildFallbackHint|buildHintPrompt|streamChat\(" src/ supabase/functions/
# Каждый call site должен передавать subject либо явно, либо через params.
```

**Спека:** `~/.claude/plans/1-functional-meteor.md`.

### 19. Subject-rubric layer — методология ЕГЭ 2026 для всех 3 AI-путей (2026-05-15, Phase 2)

Phase 2 расширения Phase 1 (§18): subject-aware AI prompts получили **полную методологию ФИПИ / DELF / IELTS** вместо одной hint-examples строки. AI теперь думает в категориях, которыми реально оценивают репетиторы и эксперты ФИПИ.

**Архитектура — отдельный модуль `_shared/subject-rubrics/`:**

```
supabase/functions/_shared/subject-rubrics/
├── index.ts         — resolveSubjectRubric() entry point + getSubjectLabel
├── types.ts         — SubjectRubricInput / SubjectRubric / CefrLevel
├── cefr-detector.ts — auto-detect B1/B2/C1 из task_text (DELF / IELTS / TOEFL / ЕГЭ / ОГЭ)
├── physics-ege.ts   — ФИПИ I-IV для № 21-26, № 21 качественная (0-3)
├── math-ege.ts      — ЕГЭ 2026 № 13-19 (Уравнения, Стерео, Неравенства, Эконом, Планиметрия, Параметр, Числа)
├── chemistry-ege.ts — ЕГЭ 2026 № 29-34 (ОВР, Ионный обмен, Неорг./Орг. цепочка, Расчётные)
└── languages-ege.ts — ЕГЭ EN № 38/39 (К1-К3/К1-К5) + DELF B1/B2 (8 критериев) + IELTS Task 1/2 (band 1-9)
```

`resolveSubjectRubric({ subject, exam_type, kim_number, task_kind, task_text, tutor_rubric })` возвращает `SubjectRubric { role, methodology, hint_examples, fallback_hint, subject_label, cefr_level, tutor_rubric_active }`. Один call per prompt build — используется на всех трёх AI-путях.

**Источники критериев (фиксация для будущих обновлений 2027+):**
- **Физика / Математика / Химия:** ФИПИ «Изменения в КИМ ЕГЭ 2026 года» (`doc.fipi.ru/.../Izmeneniya_KIM_EGE_2026.pdf`) явно говорит: «Изменений нет» по этим предметам в 2026. Структура 2025 = 2026. Если в 2027 ФИПИ изменит критерии — обновить соответствующий `*-ege.ts` файл, никаких миграций / БД-патчей.
- **Математика ЕГЭ 2026** — № 13-19 (НЕ № 12-17, это устаревший формат до 2024 реформы). Часть 1 № 1-12 (краткий), Часть 2 № 13-19 (развёрнутый).
- **Химия ЕГЭ 2026** — № 29-34 (НЕ № 30-34). Часть 1 № 1-28, Часть 2 № 29-34.
- **Физика ЕГЭ 2026** — № 21-26 с **полными ФИПИ 2026 критериями** (получены от Vladimir 2026-05-15 в виде 5 официальных PDF: Проверка 21ой / 22-23 / 24-25 / 26ой / Общие моменты по проверке 2 части). См. `physics-ege.ts`:
  - **№ 21** — качественная задача (3 балла), 3 элемента: формулировка ответа + объяснение + прямое указание явлений и законов. Шкала 0/1/2/3.
  - **№ 22-23** — расчётные (2 балла), 4 элемента: I) законы, II) обозначения, III) преобразования и расчёты, IV) ответ с единицами.
  - **№ 24-25** — расчётные (3 балла), те же 4 элемента + детальная 0/1/2/3 шкала (1 балл за «отсутствует одна формула, но логически верные преобразования»).
  - **№ 26** — расчётная с обоснованием (4 балла) = Критерий 1 (обоснование, 0-1 балл) + Критерий 2 (расчёт, 0-3 балла, как у № 24-25).
  - **Часть 1 (№ 1-20)**: 1-4/7/8/11-13/16/19/20 по 1 баллу; 6/10/15/17 по 2 балла (символ-в-символ, 1 балл за один неверный); 5/9/14/18 множественный выбор 2 балла (1 балл за один лишний/один пропущенный).
  - **Общие правила** ФИПИ (альтернативная логика, формулы кодификатора, округление, подмена условия) включены в каждый блок методологии.
  - **Варианты с рисунком**: рисунок с силами / схема цепи / ход лучей в оптике / построение изображения в линзе — все имеют свои under-rubrics. Для № 24-25 правильный рисунок в оптике засчитывается на 1 балл (в отличие от № 22-23).

**P0 scope (Phase 2 2026-05-15):**
- ✅ Физика, математика, химия, языки — все 4 предмета с full ЕГЭ methodology.
- ❌ ОГЭ — отложено (структура 2026 ОГЭ ещё не уточнена для всех предметов; для физики ОГЭ 2026 = 22 задачи, не 25). Resolver использует ЕГЭ rubric даже когда `exam_type='oge'` — generic methodology покрывает ОГЭ adequately.
- ✅ Tutor `rubric_text` override — если непуст, prepended ПЕРЕД default methodology с маркером «ПРИОРИТЕТНЫЕ КРИТЕРИИ ОТ РЕПЕТИТОРА (при конфликте они выигрывают)»; AI инструктирован следовать tutor first.
- ✅ Auto-inject — даже когда `tutor_rubric` пуст, всегда инжектируется default ФИПИ / DELF / IELTS rubric. Никаких UI toggle'ов, минимум friction для тутора.
- ✅ CEFR auto-detect для языков — regex parsing task_text (`DELF B1` / `B2.2` / `IELTS 6.5` / `ЕГЭ` ≈ B2 / `ОГЭ` ≈ B1 / default B1). Поле `cefr_level` отображается в system prompt.

**Где интегрировано:**
- `homework-api/guided_ai.ts::buildCheckPrompt` — methodology block после «ПРАВИЛА ОЦЕНКИ», role заменяет hardcoded «Ты проверяешь ответ…».
- `homework-api/guided_ai.ts::buildHintPrompt` — role + hint_examples + методология после «ОБЯЗАТЕЛЬНО».
- `homework-api/guided_ai.ts::buildFallbackHint` — subject-aware fallback (Phase 1 fix остаётся актуален).
- `chat/index.ts::processAIRequest` — subject-block инжектирует полный methodology + tutor priority marker. SELECT расширен на `homework_tutor_assignments.exam_type` + `homework_tutor_tasks.kim_number/task_kind/rubric_text` (параллельно с существующим solution fetch, latency overhead = 0).
- `homework-api/index.ts::handleCheckAnswer` + `handleRequestHint` — SELECT расширены на те же поля, прокинуты в `evaluateStudentAnswer` / `generateHint` через новые параметры `examType / kimNumber / taskKind` в `EvaluateStudentAnswerParams` / `GenerateHintParams`.

**Per-subject coverage details:**

**Физика ЕГЭ 2026:**
- № 21 качественная (0-3): правильный ответ + полное объяснение / + один недочёт / без объяснения / неверный.
- № 22-26 (2-4 балла): ФИПИ I-IV — записан закон (I) + обозначения «дано» (II) + преобразования с подстановкой (III) + правильный численный ответ с единицами (IV).

**Математика профильная ЕГЭ 2026:** № 13-19 с разной балльностью (2-4 балла); каждая задача имеет полные критерии (например, № 13 «решение И отбор корней», № 18 «найти все значения параметра», № 19 «оценка + пример с обоснованием»).

**Химия ЕГЭ 2026:** № 29-34 с поэлементной разбивкой (по 1 баллу за каждое уравнение в цепочке, по 1 баллу за элемент в расчётной).

**Языки:**
- ЕГЭ EN № 38 (письмо, 180-200 слов, К1-К3, 6 баллов).
- ЕГЭ EN № 39 (эссе, 200-250 слов, К1-К5, 14 баллов).
- DELF B1 production écrite (160-180 mots, 8 критериев, 25 баллов).
- DELF B2 production écrite (250 mots, те же 8 критериев строже).
- IELTS Writing Task 1 (граф/диаграмма, 150+ слов, band 1-9, 4 критерия — Task Achievement / Coherence / Lexical / Grammar).
- IELTS Writing Task 2 (эссе, 250+ слов, band 1-9, 4 критерия — Task Response / Coherence / Lexical / Grammar).
- Format auto-detect по `task_text`: «DELF B1» / «Task 1» / «личное письмо» / «эссе». Fallback на generic language rubric с CEFR-aware размером.

**Прочие предметы (informatics / russian / literature / history / social / biology / geography):** generic Phase-2 methodology в `index.ts::buildGenericRubric` — короче чем dedicated ЕГЭ rubric, но subject-aware с упоминанием специфических методов проверки.

**Server-side подтверждение (chat path):**
- `processAIRequest` теперь fetch'ит `homework_tutor_assignments.subject + exam_type` + `homework_tutor_tasks.kim_number / task_kind / check_format / rubric_text` параллельно с solution fetch (Promise.all). DB values WINS over client-supplied (anti-tamper).
- Client всё ещё передаёт `subject` в body (Phase 1 contract сохранён) — но это hint, не source of truth.

**Telemetry для review:**
- `SubjectRubric.tutor_rubric_active: boolean` — exposed в return, но пока не логируется (можно добавить console.warn для tutor adoption tracking).
- `SubjectRubric.cefr_level` — null для не-language subjects, B1/B2/C1 для языков.

**При расширении на новый предмет (например, информатика с полным методологическим блоком вместо generic):**
1. Создать `_shared/subject-rubrics/informatics-ege.ts` mirror `chemistry-ege.ts`: `ROLE` + `HINT_EXAMPLES` + `FALLBACK_HINT` + `GENERIC_METHODOLOGY` + `KIM_METHODOLOGIES` + `buildInformaticsEgeRubric()`.
2. В `index.ts::resolveSubjectRubric` добавить ветку `subjectId === 'informatics'` перед generic fallback.
3. Опционально расширить тип `MATH_LIKE_SUBJECTS` / `LANGUAGE_SUBJECTS` если новый предмет имеет per-task семантику.
4. Никаких изменений в `guided_ai.ts` / `chat/index.ts` / `index.ts (homework-api)` — resolver сам подхватит.

**При расширении на ОГЭ:**
1. Создать `_shared/subject-rubrics/physics-oge.ts` (и аналогично для других предметов) с актуальной ОГЭ 2026 структурой (Vladimir подтвердит критерии).
2. В `resolveSubjectRubric` добавить branch на `exam_type === 'oge'` для каждого предмета.
3. Обновить doc в `.claude/rules/40-homework-system.md` — secstion «Subject-rubric layer — ОГЭ 2026».

**При обновлении ФИПИ 2027:**
- Прочитать «Изменения в КИМ ЕГЭ 2027 года» PDF на `doc.fipi.ru`.
- Если есть изменения по subject — обновить соответствующий `*-ege.ts` файл (типы баллов / критериев). Никаких миграций / БД-патчей, всё в коде.
- Обновить эту секцию CLAUDE.md с датой обновления.

**Hotfix 2026-05-16 — task_kind='numeric' compact methodology (critical regression fix):**

Phase 2 коммит `ea41a39` (2026-05-15) шил full ФИПИ methodology в `buildCheckPrompt` system content для ВСЕХ задач, включая `check_format='short_answer'` (task_kind='numeric'). `getPhysicsEgeMethodology(null)` для типичной homework task (без `kim_number`) возвращал `GENERIC_METHODOLOGY` с блоком *«должны быть записаны (I) положения теории, (II) обозначения, (III) преобразования, (IV) ответ с единицами»*. AI получал противоречивый промпт (`checkFormatGuidance` говорил «принимай краткий ответ», но methodology требовала развёрнутое решение) и отвечал `INCORRECT` даже на правильные короткие ответы вроде «5 м/с».

Симптом наблюдаемый репетитором: «бот на сайте перестал принимать ответы в задачах ДЗ с кратким ответом, только шаги решения».

**Fix:** `resolveSubjectRubric` в `_shared/subject-rubrics/index.ts` теперь имеет early branch — для `task_kind === 'numeric'` (НЕ для языков, у которых нет numeric tasks) **swap'ит** full ФИПИ methodology на compact `buildNumericMethodology(subjectId, kimNumber)` block:

- Один абзац «тип задачи: краткий ответ (число / слово / формула)».
- Правила для числового / символьного / sequence ответа.
- Опциональный KIM-specific balling nudge (для physics № 1-20 — short note про балльность группы без full methodology).
- Anti-spoiler one-liner.

**Инвариант:** при добавлении нового subject в `_shared/subject-rubrics/` или нового task_kind — обновить `buildNumericMethodology` и проверить что `resolveSubjectRubric` правильно branch'ит. Symptom regression — AI отвечает «нужно решение» на short_answer задачи: grep `getPhysicsEgeMethodology(null)` и убедиться что для `task_kind='numeric'` это **не** вызывается.

**Hard rule для AI prompt:** subject methodology применима только к развёрнутым решениям (`task_kind='extended'/'proof'`). Numeric tasks → short answer equality check + subject-aware role + hint_examples (но НЕ full ФИПИ I-IV).

**Спека:** `~/.claude/plans/1-functional-meteor.md` Phase 2 раздел.

### 20. Mock-exams subject-rubric integration + Шапка ЕГЭ 2026 (2026-05-15, Phase 4)

Phase 4 расширения subject-rubric Phase 2 (§19) на mock-exams pipeline. До Phase 4 `supabase/functions/_shared/mock-exam-prompts.ts::buildMockExamPart2Prompt` использовал hardcoded `«Ты — эксперт ЕГЭ по физике…»` + inline `buildCriteriaBlock` с упрощённым ФИПИ I-IV summary, не интегрировано с реальной ФИПИ 2026 методологией из `physics-ege.ts` (которая содержит детальные критерии для № 21 качественной, № 22-23 / 24-25 расчётных + № 26 двух-критериальной).

**Что сделано в Phase 4:**

1. **`_shared/mock-exam-prompts.ts` стал третьим consumer'ом `resolveSubjectRubric`** (после `homework-api::guided_ai.ts` и `chat/index.ts`):
   - `BuildPart2PromptInput` расширен `subject?: string` + `exam_type?: 'ege' | 'oge'` (default `'physics' + 'ege'` для backward-compat с pilot attempts Egor 2026-05-15).
   - Импортирован `resolveSubjectRubric` из `./subject-rubrics/index.ts`. Хелпер вызывается с `task_kind: 'extended'` и `tutor_rubric: null` (mock-exams не имеют tutor rubric override — это контракт ФИПИ-варианта).
   - Hardcoded `«Ты — эксперт ЕГЭ по физике…»` заменён на `rubric.role` (из `physics-ege.ts::ROLE`).
   - `rubric.methodology` инжектируется в systemContent **перед** legacy `buildCriteriaBlock` (compact ФИПИ I-IV summary оставлен как backward-compat slot — frozen JSON output contract `elements_check: {I, II, III, IV}` остаётся неизменным).

2. **`mock-exam-grade/index.ts` передаёт `subject: 'physics' + exam_type: 'ege'`** в `buildMockExamPart2Prompt`. Hardcoded для mock-exams-v1 variant-1 (физика). Когда добавится non-physics вариант — extend `mock_exam_variants.subject` колонкой (см. tech debt ниже).

3. **`StudentMockExam.tsx::ReferencesPanel()` расширен с 3 констант до полной Шапки ЕГЭ 2026** из официального PDF (Vladimir прислал 2026-05-15):
   - Инструкция (3ч 55мин, 26 заданий, 3 образца записи ответов для разных типов задач)
   - 9 справочных таблиц: десятичные приставки (10 единиц), константы (11 шт включая π / g / G / R / k_Больцмана / N_A / c / k_Кулона / ε₀ / e / h), соотношения единиц (T/а.е.м./эВ), масса частиц (электрон/протон/нейтрон), плотность (7 веществ), удельная теплоёмкость (7 веществ), удельная теплота (3 процесса), нормальные условия, молярная масса (10 газов)
   - `React.memo` обёртка (статические справочные данные)
   - Один collapsible top-level `<details>` (text-base 15px, iOS-safe)

4. **`BLANK_PDF_URL` обновлён** с `ege-physics-2025.pdf` → `ege-physics-2026.pdf` (4 страницы: бланк № 1 + бланк № 2 лист 1 + бланк № 2 лист 2 + дополнительный). Старый PDF не удаляется (backward compat если кто-то закешировал ссылку).

5. **`StudentMockExamResult.tsx::Part1Card` default expanded = true.** Таблица разбалловки (№ / Твой ответ / Правильный / Балл + иконки ✓/✗) показывается сразу при открытии result page, ученик не должен кликать «Показать таблицу». Toggle сохранён для возможности скрыть длинную таблицу.

**Manual asset upload (НЕ автоматизировано в коде):**
- `Бланки ЕГЭ 2026.pdf` загружен в Supabase Storage bucket `mock-exam-blank-templates` (public) как `ege-physics-2026.pdf`. Сделано через Supabase Studio.
- Старый `ege-physics-2025.pdf` оставлен в bucket для backward compat (может быть закеширован браузерами / Telegram-ссылками).

**Frozen invariants (КРИТИЧНО, не нарушать):**
- `mock-exam-grade` JSON output shape — `suggested_score`, `confidence: 'low'|'medium'|'high'`, `elements_check: {I, II, III, IV}`, `flags`, `comment_for_tutor` — **frozen contract** для `TutorMockExamReview`. Phase 4 не меняет — `rubric.methodology` добавлен в system prompt ПЕРЕД legacy `buildCriteriaBlock`, чтобы модель видела одновременно компактную summary (I-IV) и детальную методологию.
- `ai_draft_json` никогда не показывается ученику до tutor approval (CLAUDE.md §12). Не затронуто.
- `mock_exam_attempt_part1_answers` / `mock_exam_attempt_part2_solutions` schema не меняются. Pilot attempts (Egor 2026-05-15) остаются валидными.
- ОГЭ scope: mock-exams-v1 покрывает только ЕГЭ. Phase 4 наследует это ограничение.

**При расширении на новый предмет в mock-exams (e.g. математический вариант):**
1. Добавить миграцию `mock_exam_variants.subject` колонкой (например, default `'physics'` для backward compat).
2. `mock-exam-grade/index.ts::handleGrade` SELECT'ит `variant.subject` и передаёт в `buildMockExamPart2Prompt` вместо hardcoded `'physics'`.
3. Никаких изменений в `_shared/mock-exam-prompts.ts` или `resolveSubjectRubric` — модули уже subject-agnostic. Математический вариант автоматически подхватит `math-ege.ts` rubric с № 13-19 (хотя в mock-exams формат КИМ Часть 2 ≠ № 13-19 математического КИМ — потребует адаптации в `math-ege.ts::KIM_METHODOLOGIES` или новый rubric file `math-mock-ege.ts`).

**Tech debt (не делаем сейчас, YAGNI до второго варианта):**
- `mock_exam_variants.subject` колонка
- Часть 2 разбивка с pakeта на per-kim через AI auto-detect (Vladimir решил «AI + tutor override гибрид» в UX опрос — отложено в следующий PR)
- Upload UX упрощение с 9 слотов до 2 полей — следующий PR

**Спека:** `~/.claude/plans/1-functional-meteor.md` Phase 4 раздел.

### 21. Mock-exams upload UX simplification — с 9 слотов до 2 полей (2026-05-15, Phase 5)

Phase 5 упрощает UX загрузки фото в пробниках. **До Phase 5**: 9 слотов фото (1 бланк + 1 fallback Часть 1 + 6 per-kim Часть 2 + 1 bulk). Студенты путались, тутору приходилось разбираться где какое фото. **После Phase 5**: ровно 2 поля.

**Новая UX (по `MockExamAnswerMethod`):**

- **`form` mode (цифровой ввод)** — Часть 1: цифровые поля № 1-20 + auto-check; Часть 2: ОДНО поле «Фото решений Часть 2 (пакет до 7 фото)».
- **`blank` mode (ФИПИ бланк)** — Часть 1: ОДНО поле «Фото бланка ФИПИ» (`BlankModeBanner` сверху); цифровые поля скрыты; tutor вручную выставляет баллы Часть 1 через `/part1-manual-score`. Часть 2: то же поле bulk до 7 фото.

Это даёт **«не больше 2 действий с фото»** для любого режима, что Vladimir и требовал.

**Удалённое (frontend):**
- Collapsible block «Загрузить фото Часть 1 отдельно» (fallback фото при `blank` mode) — был дубликат `BlankModeBanner`.
- `part2Tasks.map → Part2TaskCard` (6 per-kim слотов) — заменены ОДНИМ bulk Card.
- Старый amber styling «Или загрузи все решения Часть 2 одним пакетом» — теперь это primary path, не «или».
- `uploadPart2 / retryPart2 / uploadPart1Fallback / retryPart1Fallback` callbacks (удалены — больше не вызываются с UI).
- `uploadedPart2Count` / `fallbackOpen` — derived state удалён.

**Backward compat (КРИТИЧНО):**
- `mock_exam_attempt_part2_solutions[*].photo_url` — НЕ удаляется из БД. Pilot attempts (Egor 2026-05-15) и старые форматы остаются с per-kim фото. Frontend `part2Photos` state остаётся как **read-only seed** из `data.part2_solutions[*].photo_url` (без UI слотов для new upload).
- `uploadMockExamPart2Photo` + `uploadMockExamPart1FallbackPhoto` backend endpoints — **намеренно сохранены working**. Frontend больше не вызывает, но любой legacy client/test всё ещё может (deprecated path).
- `TutorMockExamReview::Part2TaskCard` отображает `solution.photo_url` если есть (legacy pilot attempts). Для bulk attempts `photo_url` = null, отдельная bulk-секция показывает все фото в виде ленты сверху.

**Tutor UX (`TutorMockExamReview`):**
- Новая секция «Часть 2 — фото от ученика (N)» рендерится если `attempt.part2_bulk_photo_urls.length > 0`. Простая galleryна grid 2-4 cols с zoom-in-new-tab по клику. Лента индексирована 1..7.
- Под лентой — старая «Часть 2 — оценка по задачам» секция с per-kim карточками (Part2TaskCard). Tutor смотрит на ленту, потом ставит баллы вручную в карточках через существующий `/approve-task` endpoint.

**AI grader Часть 2 для bulk — НЕ интегрирован в Phase 5 (отложен):**
- Текущий `mock-exam-grade` использует per-kim path: для каждой задачи № 21-26 ищет `photo_url` в `part2_solutions[*]`. Для bulk attempts эти `photo_url` обычно `null` → AI grader возвращает fallback `photo_missing` для каждой задачи.
- **Следствие**: для bulk attempts AI grading Часть 2 пока **не работает автоматически**. Tutor оценивает Часть 2 вручную через bulk gallery + per-kim карточки.
- **Следующий PR**: добавить **bulk AI assign-pass** (single AI call: «вот 7 фото + 6 задач, сопоставь») → per-kim grading с assigned photo (parallel 6 calls). + drag-drop tutor override в `TutorMockExamReview` (если AI assigns не угадал).

**Frozen invariants:**
- DB schema не меняется. `mock_exam_attempts.part2_bulk_photo_urls` JSONB колонка существует с миграции `20260514130000_attempt_answer_method.sql`. Никаких новых миграций в Phase 5.
- `mock-exam-grade` JSON output shape для tutor review — не тронут (frozen contract `elements_check: {I, II, III, IV}` etc.).
- Mock-exams anti-leak invariants (CLAUDE.md §10, §12, §15) не затронуты. Bulk photos — фото student'а, видны tutor'у post-submit как раньше (через existing signed-URL pipeline).
- ОГЭ scope: не покрыто.

**При добавлении AI bulk grader в следующем PR:**
1. `_shared/mock-exam-prompts.ts` — добавить `buildBulkAssignmentPrompt(tasksMeta, bulkPhotoDataUrls)` для AI assign-pass. Output JSON: `{ "21": [0, 1], "22": [2], ..., "26": [6] }` — kim → photo indices.
2. `mock-exam-grade/index.ts::handleGrade` — detect bulk attempts (`attempt.part2_bulk_photo_urls.length > 0`), сначала assign-pass, потом parallel 6 per-kim grading с assigned photos. Сохранить assignment в `ai_draft_json.assigned_photo_indices` для tutor visibility.
3. `TutorMockExamReview` — отобразить «AI: задача 22» chip над каждым фото в bulk-ленте + drag-drop override. Tutor может перенести фото между задачами; re-trigger grading per affected kim.
4. AI bulk grader цена: +1 assign-pass call (~$0.001) на attempt. Per-kim grading остаётся 6 parallel calls. Latency: +2-3s.
5. Edge cases: фото нерелевантно ни одной задаче (`flags: ['photo_unassigned']`), 2 задачи на 1 фото (assigned to both kim), не-номер задачи на фото (низкий confidence). Все требуют thorough testing — почему AI grader отложен в отдельный PR.

**Спека:** `~/.claude/plans/1-functional-meteor.md` Phase 4 «Out of scope» секция (Phase 5 это и был «Upload UX упрощение с 9 слотов до 2 полей» из той секции).

### 22. Mock-exams Phase 6 — AI bulk grader Часть 2 + AI Часть 1 OCR + one-button approval (2026-05-15)

Phase 6 закрывает основной gap, оставшийся после Phase 5: AI grader Часть 2 теперь работает для bulk attempts (через two-pass архитектуру), Часть 1 в blank mode распознаётся AI автоматически (Gemini OCR), tutor видит и подтверждает работу одной кнопкой вместо 26.

**Файлы (3 NEW + 6 modified, ~800 lines diff):**

| File | Change | Lines |
|---|---|---|
| `supabase/migrations/20260515120000_attempt_ai_part1_ocr.sql` | NEW — `ai_part1_ocr_json JSONB NULL` column | ~15 |
| `supabase/functions/_shared/mock-exam-prompts.ts` | extended (bulk assignment prompt + sanitizer + types) | ~80 |
| `supabase/functions/_shared/mock-exam-part1-ocr.ts` | NEW — Gemini blank OCR prompt + sanitizer + types | ~120 |
| `supabase/functions/_shared/mock-exam-part1-checker.ts` | NEW — extracted Deno mirror from student-api | ~160 |
| `supabase/functions/mock-exam-grade/index.ts` | extended — bulk path + Part1 OCR pipeline | ~230 |
| `supabase/functions/mock-exam-tutor-api/index.ts` | extended — relaxed `/approve-all` + 2 new endpoints | ~110 |
| `supabase/functions/mock-exam-student-api/index.ts` | refactor — import shared checker | -160 |
| `src/types/mockExam.ts` | extended — Part1OCR types + `ai_part1_ocr_json` | ~20 |
| `src/lib/mockExamApi.ts` | extended — 2 new API client functions | ~40 |
| `src/pages/tutor/mock-exams/TutorMockExamReview.tsx` | extended — bulk gallery + dropdowns + regrade + OCR pre-fill + single CTA | ~185 |

**Backend — AI bulk grader Часть 2 (two-pass):**

- `buildBulkAssignmentPrompt(tasksMeta, bulkPhotoDataUrls)` в `_shared/mock-exam-prompts.ts` — Pass 1: единственный AI call который видит 6 задач + N фото в пакете и возвращает JSON `{ "21": [0,1], "22": [2], ..., "unassigned": [3] }`.
- `sanitizeBulkAssignmentResult` — validation: keys ∈ {21..26, unassigned}, indices в range, dedupe. Fallback: пустые arrays для не-распознанных kim → срабатывает per-kim `photo_missing` flag в Pass 2.
- `mock-exam-grade::handleGrade` — detect `attempt.part2_bulk_photo_urls` (parsed dual-format → length > 0):
  1. Resolve all bulk photos в data URLs через existing `inlineImageRefs()`.
  2. Pass 1 (assign) — `buildBulkAssignmentPrompt` → 1 AI call (~5-10s).
  3. Pass 2 (grade) — parallel `Promise.all` per kim 21-26 через existing `gradePart2Task` с pre-resolved filtered photos (~30s).
  4. Save `ai_draft_json` per kim + **additive поле** `ai_draft_json.assigned_photo_indices: number[]` (frozen JSON contract extended, legacy consumers игнорируют).
- Backward compat: pilot attempts (Egor 2026-05-15) с per-kim `photo_url` → bulk path skipped (`part2_bulk_photo_urls IS NULL`), legacy works as before.
- **Tutor status preservation invariant** (CLAUDE.md §12): bulk path не перезаписывает rows со `status='tutor_approved'|'tutor_modified'` — только `ai_draft_json` field.
- Latency budget (AC-4 < 90s сохранён): Pass 1 + Pass 2 = ~40s typical, ~90s worst-case.
- Cost: +1 assign-call (~$0.002) на attempt. Per-kim grading cost не меняется (обычно 1-2 photo per kim).

**Backend — AI Часть 1 OCR (blank mode):**

- Миграция `20260515120000_attempt_ai_part1_ocr.sql` добавила `mock_exam_attempts.ai_part1_ocr_json JSONB NULL`. Format: `{ "1": {value: string | null, confidence: 'high' | 'medium' | 'low'}, ..., "20": {...} }`.
- `buildPart1BlankOCRPrompt(tasksMeta, blankPhotoDataUrl)` в `_shared/mock-exam-part1-ocr.ts` — single Gemini call для распознавания 20 ответов на бланке ФИПИ. Tasks meta содержит kim + `check_mode` hint (strict/multi_choice/ordered/pair/task20) для подсказки модели об ожидаемом формате.
- `mock-exam-grade::runPart1OCR` (NEW) — full pipeline:
  1. Detect `attempt.answer_method === 'blank'` AND `attempt.part1_blank_photo_url IS NOT NULL`.
  2. Inline blank photo в data URL через `inlineImageToDataUrl`.
  3. Call `buildPart1BlankOCRPrompt` → 1 AI call (~10-15s).
  4. For each kim 1-20: call canonical `checkPart1Answer` (из shared checker) с OCR'нутым value → compute `earned_score`.
  5. Upsert `mock_exam_attempt_part1_answers` — **только rows где tutor не выставил `earned_score`** (tutor preservation invariant).
  6. UPDATE `mock_exam_attempts.ai_part1_ocr_json = ocrResult`.
- Form-mode attempts: pipeline skipped — auto-check уже сделан при submit (existing logic).
- Если AI assignment-pass returns invalid JSON → fallback: assign all photos to `unassigned` → Pass 2 видит `photo_missing` для всех, tutor вручную через dropdown.

**Backend — `_shared/mock-exam-part1-checker.ts` (NEW, refactor):**

- Extracted inline Deno mirror из `mock-exam-student-api/index.ts` в shared module (~160 lines).
- Single source of truth для Part 1 deterministic checker (Deno side). Mirror'ит `src/lib/mockExamPart1Checker.ts` (TS side).
- Exports: `checkPart1`, `checkStrict`, `checkOrdered`, `checkUnordered`, `checkMultiChoice`, `checkTask20`, `checkPair`, `numericRoundingMatch`, `normalizeNumber`, type `CheckMode`.
- `mock-exam-student-api/index.ts` импортирует вместо inline дубликата — соблюдается инвариант CLAUDE.md §15a о single source of truth для Deno mirror.
- Любое изменение логики проверки **ОБЯЗАНО** править обе версии: TS (browser preview) и Deno (server submit). Symptom drift = «AI checker не согласован» bug.

**Backend — Simplified `/approve-all` + новые endpoints:**

- Modified `/approve-all`:
  - SELECT extended с `ai_draft_json` для каждой Часть 2 solution row.
  - Pre-flight для каждой kim: compute `finalScore = tutor_score ?? ai_draft.suggested_score`.
  - Если есть kim где оба null → return **400 `INCOMPLETE_PART2`** с `details.missing_kim_numbers: number[]`. Frontend display.
  - Auto-finalize rows где tutor не выставил manual — uses AI `suggested_score` + `status='tutor_approved'` (или `tutor_modified` если comment непустой).
  - Compute totals + state transition → existing logic.
- New `POST /attempts/:id/assign-part2-photos`:
  - Body `{ assignments: Record<number, number[]> }` — kim → photo indices.
  - Validation: kim ∈ 21-26, indices ∈ range bulk photos, dedupe.
  - Upsert `ai_draft_json.assigned_photo_indices` per kim. Nulls `suggested_score` если assignment changed — forced regrade на next AI call.
  - **НЕ** запускает AI автоматически — Vladimir explicit «manual button» UX choice (cost control).
- New `POST /attempts/:id/regrade-part2`:
  - POST, ownership = tutor.
  - Status check: not `approved`/`manually_entered`.
  - Action: internal service-role fetch на `mock-exam-grade::handleGrade` с full bulk path.
  - Returns `{ attempt_id, regraded: true, latency_ms, grade_response }`.
  - Tutor status preservation invariant — `tutor_approved`/`tutor_modified` строки не перезаписываются.

**Frontend — TutorMockExamReview UX simplification:**

- `Part2TaskCard` cleanup:
  - **Removed** «Подтвердить: X/Y» quick-approve button (`handleQuickApprove`) — single action button «Изменить балл» (EditScoreDialog).
  - Под header — chip «Фото №1, 2 из пакета» если `ai_draft.assigned_photo_indices.length > 0` (read-only indicator).
  - Если no assignment + bulk attempt → warning «AI не привязал фото к этой задаче. Найди фото в пакете выше и привяжи через select.»
- New `BulkPhotosAssignmentGallery` component (~150 lines):
  - Compute initial assignments из `ai_draft.assigned_photo_indices` per kim (`useMemo` от `data.part2_solutions`).
  - Local state `assignments: Record<number, number[]>` — debounced save (500ms) через `assignMockExamPart2Photos`.
  - Grid: each bulk photo с Radix `<Select>` underneath. Options: «№21», «№22», ..., «№26», «— не подошла».
  - «Перепроверить AI» button (Lucide `RefreshCw`) → `regradeMockExamPart2` mutation → spinner pending → invalidate `useMockExamAttempt` query. Disabled если no bulk photos OR attempt.status='approved'/'manually_entered'.
  - Toast «Привязка сохранена. Нажмите Перепроверить AI чтобы обновить баллы».
- `ApproveFooter` simplification:
  - **Removed** counter «Подтверждено: N/M заданий» — больше не per-task confirmation tracking.
  - Single CTA «Подтвердить и показать ученику» — disabled if `blockedKims.length > 0`.
  - `blockedKims` computation (frontend-side, sanity): kims где `solution.tutor_score === null && (!solution.ai_draft_json || solution.ai_draft_json.suggested_score === null)`.
  - Disabled tooltip lists missing kims: «AI не оценил задачи №X, Y. Выстави балл через Изменить балл.»
  - При click → existing `/approve-all` endpoint (теперь с relaxed validation). AlertDialog confirm сохраняется.
- `Part1BlankReviewPanel` AI OCR pre-fill:
  - Info banner «AI распознал бланк и автоматически выставил баллы» когда `attempt.ai_part1_ocr_json` present.
  - Per-cell: confidence chip («⚠ AI?» amber for low) + recognized value preview под label «AI: {value}».
  - Amber border для low-confidence cells (`isLowConf = ocrCell.confidence === 'low'`).
  - Existing inline blur-save через `setMockExamPart1ManualScore` works as-is — tutor может править после AI OCR.
- Note: OCR запускается в `handleGrade` при submit (не при open панели) — tutor видит результаты сразу.

**UX decisions baked in (AskUserQuestion 2026-05-15):**

| Question | Vladimir's answer | Implementation |
|---|---|---|
| Photo→task UI | Select dropdown | Radix `<Select>` under each photo, no dnd-kit dependency |
| Часть 1 OCR confidence | Always auto-check + flag low | Amber border + chip «AI?» for low; tutor edit inline |
| AI re-grade trigger | Manual button | «Перепроверить AI» в `BulkPhotosAssignmentGallery`, не live |
| Approve when missing scores | **Block** approve | `blockedKims` tooltip + disabled button (force review) |

**Anti-leak invariants (mirror CLAUDE.md §12 + §15):**

- `ai_draft_json` (including `assigned_photo_indices`) — никогда не возвращается ученику. Tutor-only artifact.
- `ai_part1_ocr_json` — tutor-only. После approval ученик видит только `mock_exam_attempt_part1_answers.earned_score` (existing contract из §15).
- Photo paths student-owned: `mock-exam-grade` не пишет в `photo_url` / `part2_bulk_photo_urls`.
- `solution_text` Часть 2 — tutor-only reference, никогда не цитируется (existing anti-spoiler).

**Hard invariants:**

- DB schema: ОДНА новая колонка (`ai_part1_ocr_json`); photo assignment хранится в `ai_draft_json.assigned_photo_indices` (additive поле frozen JSON contract).
- `ai_draft_json` shape остаётся frozen (`suggested_score`, `confidence`, `elements_check: {I,II,III,IV}`, `comment_for_tutor`, `flags`) + новое additive поле `assigned_photo_indices: number[]` (legacy consumers игнорируют).
- Pilot attempts (Egor) — bulk path skipped; legacy per-kim grading работает. OCR Часть 1: triggered только при `answer_method='blank'`.
- Tutor status preservation (CLAUDE.md §12): bulk path не перезаписывает `status='tutor_approved'|'tutor_modified'`, только `ai_draft_json`. Часть 1 OCR не перезаписывает rows где `earned_score IS NOT NULL`.
- ОГЭ scope: Phase 6 — только ЕГЭ (variant-1 physics).
- **Deno mirror invariant (CLAUDE.md §15a)**: при изменении `_shared/mock-exam-part1-checker.ts` (Deno) синхронно править `src/lib/mockExamPart1Checker.ts` (TS) — обе используются для деt-checker логики. Грепни `grep -n "checkStrict\|numericRoundingMatch" src/lib/mockExamPart1Checker.ts supabase/functions/_shared/mock-exam-part1-checker.ts` — обе реализации должны иметь одинаковый набор функций.

**Edge cases:**

- Bulk assignment: фото с 2 задачами → AI assigns to multiple kims (acceptable; per-kim Pass 2 видит то же фото). Фото-условие → assigned to `unassigned`. Размытое фото → low confidence. AI returns invalid JSON → fallback all to `unassigned`, tutor вручную через dropdown.
- Часть 1 OCR: пустая клетка → `value: null, confidence: 'high'`, checker возвращает 0. Перечёркнутый ответ + другой → AI выбирает последний написанное, confidence='medium'. Запятая vs точка → нормализация через existing `normalizeNumber`. Полная неудача AI (вся фото не читается) → `ai_part1_ocr_json` сохранён с все confidence='low', tutor вручную правит.

**Round 2 fixes (ChatGPT-5.5 review, 2026-05-15):**

После initial Phase 6 коммита `141a5d0` второй проход review поднял критичные contract/state-machine findings + P2 UX/perf findings. Все исправлены в follow-up commit `33e5490` (7 файлов, +581 / -73 lines):

1. **`/regrade-part2` теряет ручные dropdown assignments** (главный bug): `handleGrade` теперь использует helper `buildAssignmentFromPersisted(solutionsByKim, allKimNumbers, totalPhotos)` — если хоть одна row имеет non-null `assigned_photo_indices`, **Pass 1 skipped**, используется persisted assignment. Tutor's manual photo→task переmapping no longer overwritten. Fresh attempt (no tutor edits yet) → AI Pass 1 runs as before.
2. **Stale snapshot tutor preservation race**: upsert заменён на **write-time conditional UPDATE** — `UPDATE ... WHERE NOT IN ('tutor_approved','tutor_modified')`. Если 0 rows affected → SELECT current status и либо INSERT (row missing), либо narrow UPDATE только `ai_draft_json` (tutor approved во время AI call). Telemetry `mock_exam_grade_preserved_tutor_status` при detection.
3. **`/assign-part2-photos` не инвалидирует `suggested_score`**: при detect actual assignment change (`arraysEqualAsSets(prev, next)`) И row не tutor-locked → null'им `suggested_score`, `confidence='low'`, добавляем flag `awaiting_regrade`. Это блокирует `/approve-all` от silent отправки stale AI score.
4. **`handleGetAttempt` теперь возвращает `ai_part1_ocr_json`**: одна строка в response. Без неё `Part1BlankReviewPanel` никогда не показывал OCR результат — feature was не визуально живой.
5. **Blank mode silent 0**: добавлен `INCOMPLETE_PART1` guard в `/approve-all`. Для `answer_method='blank'` проверяем что все Часть 1 KIM имеют `earned_score` (null = OCR не сработал ИЛИ tutor не открыл панель). Mirror frontend `blockedKims` UX.
6. **CAS guard на `ai_checking`**: atomic claim теперь работает для **обоих** статусов. `submitted` → CAS на equality. `ai_checking` → check `updated_at` age vs `STALE_LOCK_AGE_MS = 120_000` (typical grade run 30-90s). Свежий lock + non-service-role → 202 `ALREADY_GRADING`. Stale lock OR service-role bypass → claim refresh и proceed.

**P2 (производительность + UX):**

7. **Client photo compression** (`src/lib/mockExamPhotoCompress.ts`): новый helper. Перед upload — resize до max long-side 2048px + JPEG quality ladder 0.9→0.5 → ≤ 4 MB. Mirror `AvatarUpload::compressToAvatar` pattern. Реальные phone photos (3-8 MB) теперь не попадают в server inline-cap rejection.
8. **`await save` перед regrade**: `regradeMutation` теперь делает `await saveMutation.mutateAsync(assignments)` если `dirty`. Защита от 500ms debounce race — tutor может нажать «Перепроверить AI» сразу после dropdown change, и AI не пересчитает по stale persisted state.
9. **Radix Select iOS sizing**: `h-9 text-xs` → `min-h-[44px] text-base touch-manipulation`. CLAUDE.md `.claude/rules/80-cross-browser.md` Safari auto-zoom + touch target invariants.
10. **`MockExamPart2Draft.suggested_score` type drift**: `number` → `number | null`. Backend frozen contract уже допускал null (awaiting_regrade / photo_missing). Wire-level alignment.

**Round 2 validation:** `npm run build` green (24.73s), `npm run smoke-check` OK, `npm run lint` clean.

**P3 deferred с явным rationale** (rolled into pre-existing risk gates):
- RLS table-level на `ai_part1_ocr_json` — mirror existing `ai_draft_json` pattern (CLAUDE.md §10 #5 deferred до post-pilot scale: >50 attempts ИЛИ 5-й tutor).
- `parseInt("21abc")` → 21 в sanitizer — low risk (Gemini не возвращает trailing chars), nice-to-have fix.

**P2 #3 multi-kim assignment UX** — отложен (требует UX decision Vladimir'а: multi-select vs per-photo checklist). Backend уже поддерживает same index в multiple kims.

**Spec link:** `~/.claude/plans/1-functional-meteor.md` Phase 6 section. Round 2 review (ChatGPT-5.5): commit `141a5d0` (initial) + follow-up commit `33e5490` (round 2 fixes).

**Round 3 fixes (ChatGPT-5.5 review of 33e5490, 2026-05-15):**

Round 2 коммит поднял 1 **catastrophic P0** + 2 P1 + 2 P2 + 1 P3. Все исправлены.

1. **P0 — `updated_at` колонки не существовало в `mock_exam_attempts`**: Round 2 CAS guard использовал `.update({ updated_at: ... })` + `.select("updated_at")`, но base schema `20260508120000_mock_exams_v1_schema.sql:146` имеет только `created_at`. Production-breaking: DB error на первом call. **Fix:** новая additive миграция `20260515130000_attempt_updated_at.sql` добавляет колонку + `BEFORE UPDATE` trigger чтобы значение обновлялось автоматически на любой UPDATE row (не только в CAS path).

2. **P1 #1 — OCR на wrong column**: Round 2 запускал `runPart1OCR` на `part1_blank_photo_url`, но canonical ФИПИ-бланк хранится в `blank_photo_url` (`mock-exam-student-api/index.ts:856` `kind='blank'` пишет туда). `part1_blank_photo_url` — fallback path «решал не на ФИПИ бланке». Main user flow (blank mode) был полностью broken: OCR не запускался, `INCOMPLETE_PART1` гард блокировал approve. **Fix:** SELECT + `runPart1OCR` теперь идут по `blank_photo_url`. `part1_blank_photo_url` оставлен в схеме как legacy fallback.

3. **P1 #3 — service_role bypass race**: Round 2 разрешил service_role callers пройти fresh `ai_checking` lock. Но `/regrade-part2` дёргает grader как service_role → race с initial fire-and-forget grading от `handleSubmitAttempt`. Tutor нажимает «Перепроверить AI» во время первичного run → два grader'а параллельно. **Fix:**
   - `/regrade-part2` теперь принимает **только** `awaiting_review` (явная state-machine; submitted/ai_checking → **409 GRADING_IN_PROGRESS**).
   - В grader убран service_role bypass — все callers идут через единый `STALE_LOCK_AGE_MS=120s` check.
   - Stale recovery (UPDATE если `updated_at < cutoff`) с atomic CAS через `.select("id")` → конкурент-claim race-safe.

4. **P2 #1 — `anyPersisted` edge case**: Round 2 `buildAssignmentFromPersisted` считал persisted=true только когда есть non-empty `assigned_photo_indices`. Если tutor очищал все привязки в `unassigned` → next regrade видел `anyPersisted=false` → AI Pass 1 запускался заново → tutor's явная очистка перезаписывалась. **Fix:** `anyPersisted=true` когда **ключ `assigned_photo_indices` присутствует** (даже если array `[]`) — signal «tutor touched this row через /assign-part2-photos».

5. **P2 #2 — HEIC compressor breakage**: Round 2 `mockExamPhotoCompress.ts` использовал `<img>` decode, который НЕ работает в desktop Chrome/Firefox/Edge для HEIC → клиентский error «JPG, PNG и WebP» до отправки. iPhone Safari OK (native HEIC). **Fix:** try/catch + `isHeicLike` flag + `return file` pass-through при любом decode/draw failure для HEIC/HEIF MIME. Сервер примет (MIME whitelist'нут); если файл > inline cap — AI помечает `photo_unreadable` для tutor manual review.

6. **P3 — stale comment в `StudentMockExam.tsx:1156`**: было «Auto-check Часть 1 в blank-mode не запускается; tutor вручную выставляет баллы» (pre-Phase-6 контракт). Обновлено на новую Phase 6 семантику (OCR на `blank_photo_url` + pre-fill через `Part1BlankReviewPanel`).

**Migration apply impact:**
- `20260515130000_attempt_updated_at.sql` — additive, BEFORE UPDATE trigger. Existing rows получают `updated_at = now()` (migration apply time). Stale detection корректно: на момент apply ни один grader не работает (deploy gap), pre-existing `ai_checking` attempts будут treated как stale через 120s — правильно.

**Spec link Round 3:** Migrations `20260515120000_attempt_ai_part1_ocr.sql` + `20260515130000_attempt_updated_at.sql`. Reviewer should confirm APPROVED on round 4 или вернуть оставшиеся findings.

### 23. Tutor force-complete для guided homework (2026-05-16, lexical-brewing-gadget)

Репетитор может вручную закрыть задачу ученика без AI verdict через два path'а:
- **Single-task**: EditScoreDialog → checkbox «Закрыть задачу после сохранения» (default ON для active) + single primary CTA «Сохранить и закрыть задачу». Reopen — ghost CTA + AlertDialog (только для tutor force-completed, не AI-CORRECT).
- **Bulk**: StudentDrillDown → «Закрыть оставшиеся (N)» AlertDialog → массовое закрытие. Балл не выставляется автоматически — тутор может править через Pencil → EditScoreDialog отдельно.

**Use-case:** не-физические предметы (французский / литература / русский) — AI verdict path не всегда работает корректно (см. §19 subject-rubric leak в check prompt для extended), репетитор хочет explicit-control «считать задачу выполненной» после прочтения переписки.

**Schema (миграция `20260516120000`):**
- `homework_tutor_task_states.tutor_force_completed_at TIMESTAMPTZ NULL` — видна ученику (бейдж «Закрыто репетитором»). NULL = AI-CORRECT verdict ИЛИ статус не completed.
- `homework_tutor_task_states.tutor_force_completed_by UUID NULL` — audit, tutor_id. Tutor-only.

**P0 column GRANT whitelist (миграция `20260516120100`, КРИТИЧНО):**
- REVOKE SELECT FROM anon, authenticated на `homework_tutor_task_states` целиком + GRANT SELECT (whitelist 20 колонок).
- **Tutor-only поля НЕ грантятся** на authenticated: `ai_score_comment`, `tutor_score_override_by`, `tutor_force_completed_by`. PostgREST с user JWT получит permission error на `.select('*')` для них. Доступ только через service_role (edge functions).
- При добавлении новой клиентской колонки на `homework_tutor_task_states` — **ОБЯЗАТЕЛЬНО** расширить GRANT в новой миграции. Иначе client `.select(new_column)` упадёт с permission error.
- Existing tutor direct PostgREST read (`useTutorStudentActivity.ts`) уже whitelisted column-by-column — не сломался.

**Atomic RPCs (миграции `20260516120200` + `20260516120300`):**
- `hw_tutor_force_complete_task(assignment, student, task, tutor, score?, comment?)` — single atomic transaction: override + status='completed' + marker + next active task search + thread cursor update + system message insert. SECURITY DEFINER, service_role only.
- `hw_tutor_force_complete_all_tasks(assignment, student, tutor)` — bulk + idempotent thread cursor reconcile.
- **Race guard `TASK_NOT_ACTIVE`**: SELECT FOR UPDATE + проверка `status = 'active'` ВНУТРИ lock. Двойной клик «Сохранить и закрыть» — оба запроса проходят edge pre-check, второй RPC ждёт lock release, видит already-completed, RAISE EXCEPTION вместо silent double-write/duplicate system message. Edge function маппит в **409 Conflict**.

**Reopen path:**
- Только для force-completed репетитором задач. AI-CORRECT не reopen'абельны — backend возвращает 409 `AI_COMPLETED_NOT_REOPENABLE`.
- Edge function (НЕ RPC) — single UPDATE на task_state + thread status flip. Atomicity не критична на одной строке.

**UX контракт EditScoreDialog (P1 fix from code review):**
- Derived `willCloseAfterSave = showCloseCheckbox && closeAfterSave` — single source of truth для primary label / className / disabled / forceComplete param.
- `showCloseCheckbox = status === 'active'` — для completed (AI-CORRECT ИЛИ force-completed) checkbox скрыт; на completed задаче primary CTA = «Сохранить балл» (override only).
- Reopen path сохраняет `currentOverride` (НЕ `numericValue`) — без этого fix bulk-closed задача без override получала бы phantom override при reopen.
- Telemetry `manual_score_override_saved` emit'ится **ТОЛЬКО** для `mode === 'save'` или `'reset'`. Reopen path preserves current override → нет override change → нет event.

**Bulk counter contract (P2 fix):**
- `StudentDrillDown.activeTasksCount = taskMeta.filter(t => t.status === 'active').length` — строго совпадает с RPC `WHERE status = 'active'`. Не использовать `!== 'completed'` — locked/skipped не закроются, UI и backend разойдутся.

**Student-side бейдж:**
- `TaskStepper` circle: `UserCheck` icon вместо `Check` при `tutor_force_completed_at !== null` — mobile-friendly visible differentiator (tooltip может быть недоступен на tap-and-release).
- `HomeworkProblem` mobile big-CTA subtitle: `'Закрыто репетитором'` vs `'Задача сдана'`.
- `SubmitCtaBar` tablet/desktop: prop `isTutorClosed` меняет лейбл.
- `GuidedHomeworkWorkspace` completed view: секция «Закрыто репетитором» для задач без override.

**Telemetry (PII-free):**
- `homework_task_force_completed { assignmentId, studentId, taskId, source: 'dialog' | 'bulk', hadScore }`
- `homework_task_reopened { assignmentId, studentId, taskId }`
- `homework_bulk_force_completed { assignmentId, studentId, closedCount }`

**При расширении на новые transactional actions:** не возвращаться к multi-query flow в edge function — partial-failure consistency problem. Добавлять как новую SECURITY DEFINER RPC, REVOKE FROM PUBLIC + GRANT TO service_role.

**Полный контракт:** `.claude/rules/40-homework-system.md` → секция «Tutor force-complete + reopen + bulk».
**Спека:** `~/.claude/plans/lexical-brewing-gadget.md` + два раунда code review (ChatGPT-5.5).

### 24. RU auth critical fix — RegisterTutor + OAuth + Email confirmation (2026-05-16, compressed-sparking-spindle)

Production-блокер мая 2026: новые репетиторы в РФ без VPN не могли зарегистрироваться **ни одним** из трёх auth-каналов (Google OAuth / Telegram / email/password). После 3 раундов ChatGPT-5.5 code review закрыто 21 issue (4 BLOCKER + 9 P1 + 3 P2 + 5 первичных fix'ов).

**Канонические правила:** `.claude/rules/96-auth-ru-bypass.md` — **11 hard rules** для frontend / backend / ops. Читать ОБЯЗАТЕЛЬНО перед любым изменением auth flow.

**Краткое summary fix'ов:**

1. **`RegisterTutor.tsx` silent fail при email confirm:** добавлен guard `if (!authData.session)` → `toast.info` с инструкцией про письмо + early return (не вызывать `assign-tutor-role` без сессии).
2. **Custom `email-verify` edge function** (`api.sokratai.ru/functions/v1/email-verify`) обходит SNI-блокировку `vrsseotrfmsxpbciyqzc.supabase.co/auth/v1/verify`. Mirror архитектуры `oauth-google-callback`.
3. **Server-side role finalization в `email-verify`:** обходит 5-минутный age check в `assign-tutor-role`. Читает `user.user_metadata.signup_source`, exact allow-list `TUTOR_SIGNUP_SOURCES` (НЕ regex), INSERT в `user_roles` + `tutors` через admin client. Role failure FATAL → redirect на `/login?email_verify_error=role_finalization_failed`.
4. **`AuthGuard` + `TutorGuard` race fix:** sync `getSession()` заменён на async ожидание `INITIAL_SESSION` event (с 3-second safety net timeout). Без этого hash tokens `#access_token=...` от edge function callback'ов парсятся слишком поздно — guard уже редиректнул на /login → infinite loop.
5. **Carry `intendedRole` через signed OAuth state:** `GoogleAuthButton` имеет prop `intendedRole`, передаётся в `oauth-google-init?intendedRole=...`. Init signs в HMAC state. Callback assigns tutor role только если `isNewUser=true AND intendedRole=tutor AND redirectTo.pathname.startsWith('/tutor/')` (defense-in-depth). Existing accounts preserved — privilege escalation guard.
6. **TutorLogin БЕЗ `intendedRole="tutor"`:** login-страница не должна авто-promotить новый аккаунт в tutor без consent gate.
7. **Telegram QR-код** для desktop без Telegram Desktop (Windows / Linux): `t.me/...` deep link открывается в web где `?start=` НЕ передаётся боту. QR-код кодирует тот же URL → юзер сосканит phone'ом → native TG → /start.
8. **Consent через `user_metadata.consent_intent`** для email flow: stash в `signUp({ data: { consent_intent } })`, flush в `email-verify` через admin client (обходит RLS + timing race).
9. **PII telemetry cleanup:** убраны `email`, `user_id`, raw tokens из логов в `TutorTelegramLoginButton`, `TelegramLoginButton`, `oauth-google-callback`.
10. **Email template per-call:** `redirect_to={{ .RedirectTo }}` (не hardcoded `/tutor/home`) — один template обслуживает и tutor (`emailRedirectTo=/tutor/home`) и student (`/chat`).
11. **Email-first UX redesign:** email-форма primary, OAuth — fallback с явным hint про РФ-ограничения.

**Обязательные manual ops actions** перед production deploy (см. runbook):
- Supabase Dashboard → Authentication → URL Configuration → Site URL `https://sokratai.ru`
- Authentication → Email Templates → Confirm signup → `https://api.sokratai.ru/functions/v1/email-verify?token_hash={{ .TokenHash }}&type=signup&redirect_to={{ .RedirectTo }}`
- Google Cloud Console → OAuth Client → Authorized redirect URIs → `https://api.sokratai.ru/functions/v1/oauth-google-callback`
- VPS: `ssh root@185.161.65.182 && deploy-sokratai`

**Известные deferred follow-ups** (Round 4 review, non-blocking):
- P1: OAuth consent flush gap (GoogleAuthButton stash → server-side flush via signed state). Compliance gap, not functional.
- P2: Error UI invisible (Login + TutorLogin не читают `email_verify_error` / `oauth_error` query params).

**Спека / runbook:**
- `~/.claude/plans/compressed-sparking-spindle.md` — full plan
- `docs/delivery/engineering/runbooks/tutor-cant-signup-ru.md` — support diagnostic runbook
- `.claude/rules/96-auth-ru-bypass.md` — 11 hard rules (canonical)

### 25. Mock-exams TASK-16 — tutor polish + score_source provenance (2026-05-15 → 2026-05-17, wobbly-crafting-starlight)

TASK-16 закрыл 6 tutor-side issues после Phase 6 pilot QA. Получил 2 рунда ChatGPT-5.5 code review с 9 P0/P1/P2 findings — все исправлены в R2/R3.

**Initial scope (6 fixes, commit `957e994` + polish `fb75010`):**

1. **AI OCR model swap**: `gemini-3-flash-preview` → `gemini-2.5-pro` для blank Часть 1 OCR. Остальные grader calls (Часть 2 bulk + per-kim) остаются на `flash` для cost. New endpoint `POST /attempts/:id/retry-part1-ocr` + retry button в Part1BlankReviewPanel.

2. **Part 1 batch finalize confirm dialog**: AlertDialog показывает все 20 KIM перед save; пустые KIM получают chip «0 (не введено)» amber. Backend `/part1-finalize` INSERT-on-missing pattern через upsert ignoreDuplicates → пустые KIM получают `earned_score=0`, result page показывает «0/max» вместо «—».

3. **Part 2 photo multi-select chips**: state `Map<photoIdx, Set<kim>>` — одно фото может быть привязано к нескольким задачам (если ученик сфотографировал лист с 2-3 решениями). Replace `<Select>` (single) на chip grid (6 chips №21-26 + «— не подошла»). Backend `assign-part2-photos` уже поддерживал multi (Phase 6).

4. **Heatmap per-task data hydration**: `handleGetAssignment` теперь batch SELECT'ит `part1_answers` (kim_number, earned_score) + `part2_solutions` (kim_number, tutor_score, status) per attempt. `MockExamHeatmap` HeatmapRow derive's score per kim из lookup map. `KIM_MAX_SCORE` constant — single source of truth для ЕГЭ физика 2026 (28 + 17 = 45).

5. **Result page «без ответа» fix**: `student_answer === null && isCorrect && correct_answer` → показывает `{correct_answer} (по фото бланка)` (suffix серым). Partial/wrong scores сохраняют italic «без ответа» (нет leak partial correct_answer).

6. **ФИПИ 2025 шкала**: `src/lib/mockExamScaleEge2025.ts` — hardcoded mapping 0..45 → 0..100 (точные значения с 4ege.ru verified Vladimir 2026-05-16). Ключевые пороги: 8 primary → 36 secondary (минимум сдачи), 36 → 82 (хорошо), 45 → 100 (max). Constants `PASS_THRESHOLD_PRIMARY_EGE_PHYSICS_2025 = 8` + `PASS_THRESHOLD_SECONDARY_EGE_PHYSICS_2025 = 36` для будущих UI индикаторов.

**Polish (commit `fb75010`):** убраны docx artefacts из KIM 25/26 solution_text (`image55.emf`, `image56.emf`, `image70.emf` → instruction «сделай схематичный рисунок»). Migration `20260516120000_resync_variant_1_kim_25_26_solution_text.sql`. Также cleaned `[РИСУНОК: imageN.emf]` markers из source `variant1-tasks.json` task_text (7 KIM) — seed generator уже стрипал их через `PICTURE_MARKER_RE`, эта чистка для future regens / debug clarity.

**R2 fixes (commit `8fa907a`, 5 P1 findings):**

R2 #1 — **score_source provenance enum** (миграция `20260516130000`). Раньше `runPart1OCR` использовал `earned_score IS NOT NULL` как signal "tutor preserved row" — после первого OCR run все 20 rows имели non-null earned_score → retry пропускал ВСЕ KIM → OCR scores оставались stale. Fix: новая колонка `score_source TEXT NOT NULL CHECK IN ('ocr','tutor','finalize_default','student_form')`. 4 write-path обновлены:
- `runPart1OCR` (mock-exam-grade) → `'ocr'`
- `handlePart1ManualScore` (mock-exam-tutor-api) → `'tutor'`
- `handlePart1Finalize` INSERT-on-missing → `'finalize_default'`
- Student auto-check submit + autosave (mock-exam-student-api) → `'student_form'`

Read-path в `tutorScoredKims` filter ТОЛЬКО `score_source === 'tutor'`. Backfill всех pre-existing rows → `'tutor'` (safest — preserves uncertain manual edits).

R2 #2 — **`/retry-part1-ocr` rejects `ai_checking`**: mirror `/regrade-part2` Round 3 contract — 409 `GRADING_IN_PROGRESS`. Раньше retry допускал `ai_checking`, clear'ил ocr_json, fire-and-forget'ил grader → CAS guard возвращал 202 ALREADY_GRADING, но retry endpoint всё равно отвечал `"queued"` — false success для tutor.

R2 #3 — **Confirm dialog race fix**: typed value → blur → save start → fast click «Часть 1 проверена» → confirm → handleFinalize SUM'ит stale DB (без typed value). В `Part1BlankReviewPanel`:
- `savingKim: number | null` → `savingKims: Set<number>` (parallel saves possible)
- New `dirtyKims` useMemo — derives kims с draft ≠ saved value
- `handleFinalize`: перед `finalizeMockExamPart1` flush'ит все `dirtyKims` через `Promise.all setMockExamPart1ManualScore`. На flush failure — toast.error и НЕ идём в finalize.
- Confirm button + AlertDialog action disabled пока `savingKims.size > 0` + visual indicator «сохраняем N…»

R2 #4 — **Canonical `{cells, __meta}` shape для `ai_part1_ocr_json`**. Раньше failure писал top-level `{cells:{}, error, raw_response, gemini_model, failed_at}`. Frontend truthy check показывал emerald «AI распознал» ДАЖЕ на failure. Canonical:
```
success: { cells: Record<number, Cell>, __meta: { status: 'success', gemini_model, recognized_cells, raw_length, generated_at } }
failed:  { cells: {},                    __meta: { status: 'failed',  gemini_model, error, raw_response, failed_at, generated_at } }
```
Frontend type `MockExamPart1OCRResult` — nested interface. Cell access: `ai_part1_ocr_json.cells[kim]` (был top-level). UI 3 состояния: failed → rose; success+0 recognized → amber soft warning; success+N>0 → emerald «AI распознал N/20 клеток».

R2 #5 — **KPI mismatch fix**: раньше «Средний первичный» KPI смешивал `avg part1 (/28)` value с secondary footer `avg total (/45)`. UI показывал нонсенс «20/28 ≈ 80 тестовых». Rename label → «Средняя Часть 1» (без footer); новый 6-й KPI «Средний общий балл» рендерится только при `approvedFinal > 0` (когда secondary действительно meaningful). Grid: `lg:grid-cols-5` → `lg:grid-cols-6` conditionally.

**R3 fixes (commit `bbed3d1`, 1 P0 + 2 P1 + 1 P2 findings):**

R3 #1 (P0) — **RLS hardening блокирует `score_source` spoof**. Existing student INSERT/UPDATE policies на `mock_exam_attempt_part1_answers` не имели column-level guards → rogue student через authenticated PostgREST мог писать `earned_score=1, score_source='tutor'`. R2 filter в `runPart1OCR` принимал эти rows как tutor-preserved → fake баллы доходили до approve в blank-mode (только blank-mode — form-mode submit handler overwrites через `score_source='student_form'` upsert). Migration `20260516140000_part1_answers_rls_hardening.sql` — DROP+CREATE student policies с tight WITH CHECK: `earned_score IS NULL AND score_source = 'student_form'`. Server writes через `service_role` (все edge functions) НЕ затронуты.

R3 #2 (P1) — **Legacy OCR JSON normalizer**. Pre-R2 pilot attempts могли иметь legacy shapes (flat numeric keys + __meta sibling) или legacy failure (top-level error fields). После R2 deploy frontend ожидал только canonical → cells display broken на pilot attempts. Helper `normalizePart1OCRJson(raw)` в `mock-exam-tutor-api/index.ts`, применяется в `handleGetAttempt` response. 3 case: already-canonical no-op / legacy failure wrap / legacy success move. Идемпотентен.

R3 #3 (P1 forward-only mitigation) — **Migration `20260516130000` re-run safety note**. `UPDATE WHERE score_source = 'ocr'` затёр бы real OCR rows на 'tutor' при reapply. Mitigation: Supabase migration tracker не reapply'ет — production safe. Caveat задокументирован для dev `supabase db reset` edge case (обычно fresh DB → UPDATE no-op).

R3 #4 (P2) — **Supabase types.ts manual patch**. Lovable auto-regen может отставать. Manual added `score_source: string` в Row/Insert/Update с comment про возможное перезатирание при auto-regen. Writes идут через Deno edge functions (service_role), TS types только для browser-side reads.

**Hard invariants (НЕ нарушать в новом коде):**

- **score_source enum**: любой новый write-path к `mock_exam_attempt_part1_answers` ОБЯЗАН явно указывать `score_source` value. Default 'ocr' существует для safety, но опираться на default нельзя. CHECK constraint блокирует unknown values.
- **`runPart1OCR` skip filter**: `tutorScoredKims` ВСЕГДА filter'ит только `score_source === 'tutor'`. Никогда не возвращаться к `earned_score IS NOT NULL` heuristic — этот баг был P1 в R2.
- **Canonical `{cells, __meta}` shape**: backend ВСЕГДА пишет nested shape; frontend ВСЕГДА читает через `.cells[kim]` + `.__meta.status`. При добавлении нового accessor — branch на `__meta.status === 'failed'` для warning state.
- **Legacy normalizer scope**: `normalizePart1OCRJson` применяется только в `handleGetAttempt`. Если кто-то добавит новый endpoint, читающий `ai_part1_ocr_json` для tutor UI — обязательно прогнать через normalizer (pilot attempts могут жить в БД indefinitely).
- **RLS column-level guards**: при добавлении нового student-writable column в `mock_exam_attempt_part1_answers` (или similar tables) — пройтись по student INSERT/UPDATE policies и добавить WITH CHECK guard на новое поле, если оно security-sensitive. Default RLS на ownership не достаточен.
- **`/retry-part1-ocr` state machine**: только `submitted | awaiting_review` (НЕ `ai_checking`, НЕ `approved`/`manually_entered`, НЕ `in_progress`). Mirror `/regrade-part2` contract.
- **Confirm dialog flush pattern**: для любого batch operation, который SUM'ит DB rows записанные через async per-row save — обязательно flush'ить pending dirty changes перед SUM (Promise.all через manual API call'ы). Disable confirm пока in-flight saves.

**Validation после deploy** (Vladimir manual):
1. **Security**: через DevTools console authenticated student'ом попробовать direct `supabase.from('mock_exam_attempt_part1_answers').insert({attempt_id, kim_number: 1, earned_score: 1, score_source: 'tutor'})` → expected 42501 RLS rejection.
2. **OCR retry**: открыть pilot attempt с failed OCR → click «Перезапустить AI OCR» → новый OCR run пишет fresh scores (НЕ skipped). Tutor manual edits (если были до retry) preserved.
3. **Legacy compat**: открыть pilot attempt Egor (pre-R2) — Part1BlankReviewPanel рендерит cells correctly из normalized shape.
4. **KPI визуал**: detail page с approved attempts показывает 6 KPI cards including «Средний общий балл = X/45 ≈ N тестовых». Без approved — 5 cards.

**Files map (всё TASK-16 + R2 + R3 в одной таблице):**

| File | Change | Phase |
|---|---|---|
| `supabase/functions/mock-exam-grade/index.ts` | OCR model swap + score_source='ocr' + canonical shape | TASK-16 + R2 |
| `supabase/functions/mock-exam-tutor-api/index.ts` | retry-part1-ocr endpoint + 409 ai_checking + handlePart1ManualScore 'tutor' + handlePart1Finalize 'finalize_default' + normalizePart1OCRJson + batch hydration | TASK-16 + R2 + R3 |
| `supabase/functions/mock-exam-student-api/index.ts` | submit auto-check 'student_form' + autosave 'student_form' | R2 |
| `supabase/migrations/20260516120000_resync_variant_1_kim_25_26_solution_text.sql` | NEW — resync solution_text без docx artefacts | TASK-16 polish |
| `supabase/migrations/20260516130000_part1_answers_score_source.sql` | NEW — score_source column + backfill 'tutor' | R2 |
| `supabase/migrations/20260516140000_part1_answers_rls_hardening.sql` | NEW — RLS WITH CHECK guards | R3 |
| `src/lib/mockExamScaleEge2025.ts` | NEW — ФИПИ 2025 шкала | TASK-16 |
| `src/lib/mockExamApi.ts` | retryMockExamPart1OCR API | TASK-16 |
| `src/types/mockExam.ts` | part1_answers/part2_solutions optional + canonical OCR shape | TASK-16 + R2 |
| `src/components/tutor/mock-exams/MockExamHeatmap.tsx` | derive per-kim scores + KIM_MAX_SCORE | TASK-16 |
| `src/pages/tutor/mock-exams/TutorMockExamReview.tsx` | retry button + AlertDialog finalize + chips multi-select + savingKims Set + dirty flush + 3-state OCR banner | TASK-16 + R2 |
| `src/pages/tutor/mock-exams/TutorMockExamDetail.tsx` | conditional hint + secondary footer → rename + new 6-th KPI | TASK-16 + R2 |
| `src/pages/student/StudentMockExamResult.tsx` | (по фото бланка) suffix + secondary в FinalSummary | TASK-16 |
| `src/integrations/supabase/types.ts` | score_source field на mock_exam_attempt_part1_answers (manual patch) | R3 |

**Спека:** `docs/delivery/features/mock-exams-v1-pilot-polish/tutor-improvements-spec.md` §AC + §7 (R2) + §8 (R3). Plan: `~/.claude/plans/wobbly-crafting-starlight.md`.

## Известные хрупкие области

1. **Chat.tsx** (2000+ строк) — очень сложный компонент
2. **Pyodide/GraphRenderer** — Python-графики, зависит от CDN
3. **AuthGuard / TutorGuard** — guard-компоненты. TutorGuard имеет module-level кеш — НЕ УДАЛЯТЬ
4. **Navigation.tsx** — общая навигация. Одна строка: логотип + вкладки + logout
5. **UI-компоненты** (`button.tsx`, `card.tsx`, `badge.tsx`) — используются ВЕЗДЕ
6. **Telegram Auth Flow** — цепочка: `TelegramLoginButton` → `telegram-login-token` → `telegram-bot/handleWebLogin` → `getOrCreateProfile`
7. **Tutor Role Assignment** — через `assign-tutor-role` (email) или `telegram-bot` (Telegram)
8. **Voice messages in Telegram bot** — `telegram-bot/index.ts` обрабатывает `update.message.voice`, скачивает OGG через Telegram API и расшифровывает через Groq Whisper API (`whisper-large-v3-turbo`, OpenAI-compatible) перед передачей текста в `handleTextMessage`
10. **Telegram bot reliability** — все вызовы AI идут через `fetchChatWithTimeout` (retry + timeout). `sendTypingLoop` ловит ошибки внутри. Все message routing ветки отвечают пользователю. `mergeConsecutiveUserMessages` обрезает склеенные сообщения до 8000 символов (`MAX_MESSAGE_LENGTH` в chat = 10000). Подробности: `.claude/rules/60-telegram-bot.md`
9. **Voice messages in Student web chat** — `ChatInput.tsx` + `useVoiceRecorder.ts` + `chatVoice.ts` + `chat/index.ts` образуют один pipeline: запись через `MediaRecorder`, серверная расшифровка и только потом ручная отправка в чат
11. **FormulaRoundScreen** — correctness checking centralized в `handleAnswer`. Карточки (TrueOrFalseCard, BuildFormulaCard, SituationCard) возвращают raw answer, НЕ boolean correctness. `BuildFormulaAnswer` = `{ numerator, denominator }`, не flat array. Подробности: `.claude/rules/40-homework-system.md`
12. **Formula round standalone pivot** — backend groundwork уже использует `trainer-submit` + nullable `student_id`/`round_id` flow. Если меняется trainer schema или submit contract — синхронно обновить `supabase/functions/trainer-submit/index.ts`, `supabase/migrations/20260408160000_trainer_standalone_schema.sql` и `.claude/rules/40-homework-system.md`
13. **Тренажёр формул (2026-04-08)** — расширен с 12 кинематических формул на 28 формул по всей механике. Добавлены динамика (6 формул), законы сохранения (7 формул), статика (1 формула), гидростатика (4 формулы). `TrainerPage.tsx` имеет новый UI с выбором раздела (6 кнопок: Вся механика, Кинематика, Динамика, Законы сохранения, Статика, Гидростатика). Каталог формул в `src/lib/formulaEngine/formulas.ts` разбит на пять массивов (`kinematicsFormulas`, `dynamicsFormulas`, `conservationFormulas`, `staticsFormulas`, `hydrostaticsFormulas`) и унифицирован в `mechanicsFormulas`.
13a. **Trainer v1 — Базовый курс «Вращение» (2026-04-18)** — параллельная ветка тренажёра для нулевого уровня. 10 формул Егора по теме «Вращение по окружности», ID-шки с суффиксом `_e` (`kin.13_e`..`kin.22_e`), живут в **отдельном** файле `src/lib/formulaEngine/egorFormulas.ts` (Variant B: hand-craft, вне auto-generation pipeline — не пересекается со скриптом `scripts/import-formula-sheet.mjs`, генерирующим `formulas.generated.ts` / `recipes.generated.ts` / `mutations.generated.ts`). Файл экспортирует `egorFormulas: Formula[]` + `EGOR_BUILD_RECIPES` + `EGOR_SUPPORTED_BUILD_FORMULA_IDS` + `EGOR_MUTATION_LIBRARY`.
    - **v1 НЕ попадает в `mechanicsFormulas`** — иначе v2 раунды подхватят дубликаты (content v1 === v2 kin.13..kin.22). Но `formulasById` map в `formulas.ts` объединяет оба каталога, чтобы `getFormulaById` / `getRelatedFormulas` работали для `_e` ID-шек.
    - **`relatedFormulas` в v1 указывают ТОЛЬКО внутрь v1** (все с `_e` суффиксом). Cross-reference на v2 запрещён — это контракт parallel branch, не роняй его при добавлении новых v1-формул.
    - **Simple mode в `questionGenerator.ts`**: `RoundConfig.mode?: 'v1' | 'v2'` (default `'v2'`). В `v1` используется `selectV1Distribution(questionCount)` — только `TrueOrFalse` (Layer 3) и `BuildFormula` (Layer 2), **без SituationCard** (Layer 1). Детекция каталога для recipes/mutations lookup идёт через `isEgorFormulaId(id) → id.endsWith('_e')`.
    - **UI**: новая кнопка «Базовый курс · Вращение» в `TrainerPage.tsx`. `SectionType` расширен `'egor-v1'`, `SECTION_POOLS['egor-v1']` держит `{ formulas: egorFormulas, mode: 'v1' }`. Gamification: новый `SectionKey = 'egor-v1'` в `trainerGamificationStore.ts` — отдельный `bestScoreBySection` bucket, чтобы не смешивать с `'kinematics'` v2. Store версия **не** бампалась — `Partial<Record<SectionKey, number>>` forward-compatible. Кнопка «Базовый (Вращение)» добавлена в `BestScoreCard` selector.
    - **При расширении v1** (новые разделы / формулы Егора): добавляй всё в `egorFormulas.ts` (формула + recipe + мутации), ID с суффиксом `_e`, не трогай `formulas.generated.ts`. Если нужен новый v1-раздел — расширяй `SectionType` в `TrainerPage.tsx`, добавляй ещё один pool с `mode: 'v1'`.
    - **Блок «Запомни:» — поле `memoryHook?: string`** в `Formula` (2026-04-18). Короткий якорь (1-2 предложения) для FeedbackOverlay при правильном ответе, формулируется репетитором. Для v1 все 10 формул заполнены в `egorFormulas.ts`. Для v2 формулы могут заполняться из новой колонки гугл-таблицы «Механика» (`Запомни` / `memory_hook`) — когда `scripts/import-formula-sheet.mjs` будет расширен. Приоритет в `getLayer1MemoryCue`: `formula.memoryHook` → regex-эвристика по `whenToUse` → `physicalMeaning`. **НЕ дублируй** regex-эвристику в новом коде — если нужен триггер, заполняй `memoryHook`.
    - **Поле `buildable?: boolean`** (2026-04-19) — гейт на BuildFormulaCard. `false` → формула идёт только в TrueOrFalseCard **без мутации** (утверждение целиком верно/неверно). Источник — колонка «Для сборки/не для сборки» (dropdown `для сборки` / `не для сборки`) в гугл-таблице `Механика_v1`. Default `undefined` = `true` (backward-compat для v2).  Теоретические утверждения (например, «направление a_цс к центру окружности») включаются как Formula с LaTeX `formula` + `buildable: false`.
    - **Canonical token normalization** (2026-04-19) — `canonicalizeToken` в `questionGenerator.ts` приводит Unicode греческие (`ω`, `φ`, `π`, `Δ`...) к LaTeX escape (`\\omega`, `\\phi`). Это убирает баг с дубликатами одного визуального токена в BuildFormula pool (ранее `\\omega` из recipes и `ω` из variables.symbol существовали одновременно). При написании recipes пиши токены в LaTeX escape форме — canonicalization это подхватит, но соблюдать явно cleaner.
    - **Case-collision легенда в `FormulaQuestion.tokenLegend`** (2026-04-19) — при наличии в пуле BuildFormula пары типа `T/t`, `N/n` (одна буква разного регистра) `generateBuildFormula` строит плашку «T — период (с), t — время (с)» из `variables[].name + unit`. Рендерится в `BuildFormulaCard` как amber-плашка под пулом. Появляется только при реальной коллизии — не засоряет UI когда коллизий нет.
    - **Skill `sokratai-formula-loader`** (project-level, `.claude/skills/sokratai-formula-loader/SKILL.md`) — override анонсируемого anthropic-skills скилла с контрактами v1: default scenario = `Механика_v1`, `Механика` = read-only legacy для v2, новые разделы сразу в v1 формат с `buildable` помечанием.
14. **Trainer Gamification Phase 1 (2026-04-18)** — Duolingo-style слой поверх standalone `/trainer`, 100% client-side (без backend-изменений). Zustand store `sokrat-trainer-gamification-v1` (localStorage, `version: 1`) держит `totalXp`, `currentStreak`, `dailyRoundsCount`, `bestScoreBySection`. XP формула в `src/lib/trainerGamification/xpCalculator.ts` (pure): `floor((10 + accuracy + combo + perfect + newBest) * retryMultiplier)`; retry-режим принудительно обнуляет `isNewBest`. Priority celebrate overlays: `new-best > perfect > goal`, auto-dismiss 1200ms, CSS-only keyframes. 5 telemetry events через `console.info('[trainer-telemetry] ...')`: `trainer_round_completed`, `trainer_streak_incremented`, `trainer_streak_broken` (fires внутри store), `trainer_daily_goal_reached`, `trainer_new_best`. Инварианты: correctness checking в `FormulaRoundScreen.handleAnswer` НЕ тронут (см. «Известные хрупкие области» #11), `framer-motion` запрещён, hex в SVG/CSS → `currentColor` + Tailwind tokens (`text-accent`, `text-socrat-accent`). Спека: `docs/delivery/features/trainer-gamification/spec.md`.
15. **Tutor Chrome (AppFrame + SideNav) — canonical wrapper (Phase 2a, 2026-04-22)** — единая обёртка для всех tutor routes. `src/components/tutor/chrome/AppFrame.tsx` содержит `<TutorGuard>` + mode wrapper `<div className="sokrat t-app" data-sokrat-mode="tutor">` + `<SideNav>` + `<MobileTopBar>` + `<MobileDrawer>` + `<Suspense fallback=...><Outlet /></Suspense>` в `<main className="t-app__main">`. В `src/App.tsx` все tutor-страницы монтируются nested внутри `<Route path="/tutor" element={<AppFrame />}>`; порядок children — specific перед generic (напр. `homework/templates` и `homework/create` до `homework/:id`). `src/components/tutor/TutorLayout.tsx` **удалён** (grep `TutorLayout src/` = 0). Новые tutor-страницы **НЕ должны** оборачивать контент в `<TutorGuard>`, `<TutorLayout>` или `<div data-sokrat-mode="tutor">` — всё это делает AppFrame один раз. Паттерн: `export default function TutorFoo() { return <TutorFooContent />; }` + регистрация child-route в AppFrame группе. Redirect `/tutor/dashboard → /tutor/home` и `/tutor/homework/:id/results → /tutor/homework/:id` сохранены как nested routes внутри AppFrame. High-risk файлы (AuthGuard, Chat.tsx, TutorGuard core) не модифицированы — TutorGuard просто переехал из 13 страниц в AppFrame.
    - **A11y инварианты MobileDrawer (AC-11/12)** — закрытый drawer **обязан** нести HTML-атрибут `inert` (управляется useEffect через `setAttribute`/`removeAttribute` по `open`). `aria-hidden={!open}` один без `inert` **недостаточен**: браузер не убирает focusable-детей из Tab order по aria-hidden. `inert` — native Safari 15.4+/Chrome 102+/Firefox 112+, укладывается в build target. Не заменять на `tabindex="-1"` на всех детях — `inert` рекурсивно отключает focus на всё поддерево одним атрибутом.
    - **NavItem Space activation** (`SideNav.tsx`) — нав-ссылки это `<Link>` (нативный `<a>`). Нативно anchors реагируют только на Enter, Space по дефолту скроллит страницу. AC-11 требует Enter+Space — `onKeyDown` хендлер на NavItem перехватывает ` ` (space), делает `preventDefault()` и `currentTarget.click()` → Link-роутинг + middle-click/Ctrl+click продолжают работать нативно. Не конвертировать nav items в `<button>` + `navigate()` — ломает открытие в новой вкладке.
    - Спека: `docs/delivery/features/tutor-chrome-sidenav/spec.md`.

## Среда разработки и деплоя

- **Деплой и продакшен**: Lovable Cloud + AI
- **Разработка кода**: Cursor, Claude Code, Codex
- **Тестирование (разработчик)**: Windows + Google Chrome, Android + Google Chrome
- **Пользователи в продакшене**: macOS + Safari, iPhone + Safari, iPhone/Android + Google Chrome

## Голосовые сообщения в Telegram-боте

- Бот расшифровывает голосовые сообщения пользователей через Groq Whisper API (OpenAI-compatible). Миграция с Lemonfox → Groq выполнена 2026-04-30, причина: free tier (~7200 сек/день) и более низкая latency. Env var: `GROQ_API_KEY` (Supabase Edge Function secret), модель `whisper-large-v3-turbo`. Те же три edge function используют Groq (см. ниже).
- Flow: пользователь отправляет voice → бот показывает typing indicator → `handleVoiceMessage()` скачивает OGG через Telegram `getFile` API → OGG отправляется в Groq (`POST https://api.groq.com/openai/v1/audio/transcriptions`, `model: 'whisper-large-v3-turbo'`, `language: 'ru'`) → бот отправляет превью расшифровки → текст передаётся в `handleTextMessage()` как обычное сообщение.
- Нет `ffmpeg`: Supabase Edge Functions не имеют системных бинарников, поэтому OGG/Opus отправляется в Groq напрямую.
- Для multipart upload используется `FormData` с `new Blob([audioBuffer], { type: "audio/ogg" })` и filename `voice.ogg`.
- Во время расшифровки бот поддерживает typing loop через `sendChatAction('typing')` каждые ~4 секунды.
- Dispatch на голосовые сооб�
