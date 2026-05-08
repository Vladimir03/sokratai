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

## КРИТИЧЕСКИЕ ПРАВИЛА

### 0. Новая колонка/поле в БД — ОБЯЗАТЕЛЬНО сгрепать ВСЕ write-sites (2026-04-18)

Когда добавляешь новую колонку в таблицу (или новое поле в payload/type, видимое для AI или критичное для UX), перед заявлением «готово» **ОБЯЗАТЕЛЬНО** найди все места, где в эту таблицу пишут. В репо есть несколько таблиц с **множественными независимыми write-path** — и легко пропустить второй:

- **`homework_tutor_tasks`** (критично для этого урока):
  - Path A: `supabase/functions/homework-api/index.ts` → `handleCreateAssignment` + `handleUpdateAssignment` (3 insert/update блока)
  - Path B: `src/components/kb/HWDrawer.tsx` — **напрямую** `supabase.from('homework_tutor_tasks').insert(...)` из клиента, минуя edge function. Источник данных — `HWDraftTask` из `hwDraftStore` (Zustand + localStorage), заполняемый кнопкой «В ДЗ» на KB-карточке задачи
  - Path C (если появится — добавь в список): любой новый client-side insert
- **`homework_tutor_thread_messages`** — guided chat messages. Проверяй все message-insert-сайты при изменении схемы (task_id invariant, см. rule 40)
- **`kb_tasks`** — modifications через триггеры (Source→Copy, kb moderation v2), см. rule 50
- **`profiles`** — синхронизация ролей, display_name

**Алгоритм проверки** (выполнять перед commit):
1. `grep -rn "from('TABLE_NAME')\.insert\|from('TABLE_NAME')\.update\|into TABLE_NAME" src/ supabase/`
2. Для каждого match убедиться, что новое поле пишется/читается
3. Для type-driven payloads: grep имя типа (например `CreateAssignmentTask`, `HWDraftTask`) — найти все construct-sites

**Симптом пропуска:** «feature работает через один flow, но не через другой» (как было с HWDrawer + solution_text — коммит `f454f6e`). Отсюда же правило: fix → ВСЕГДА проверь вторичные пути.

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

### 7. Subject CHECK constraint — синхронизация с SUBJECTS (2026-04-14)
- При добавлении нового предмета в `SUBJECTS` (`src/types/homework.ts`) или `VALID_SUBJECTS_CREATE` (`supabase/functions/homework-api/index.ts`) **ОБЯЗАТЕЛЬНО** добавить миграцию, обновляющую constraint `homework_tutor_assignments_subject_check`
- Паттерн нарушения: commit `e57cada` добавил `'maths'`, `'informatics'` и др. в фронт/edge function, но не добавил миграцию → prod выдавал «Failed to create assignment» на любом ДЗ с новыми subject id
- Канонический список (19 значений): `maths, physics, informatics, russian, literature, history, social, english, french, spanish, chemistry, biology, geography, other` + legacy `math, cs, rus, algebra, geometry`
- Фикс: `supabase/migrations/20260414150000_unify_homework_subject_check.sql`

### 8. Имя ученика в AI-промпте — все три пути (2026-04-14/15)

Все три пути общения ученика с AI получают имя и используют правильный грамматический род.

**Источники имени (приоритет):**
- `tutor_students.display_name` — tutor-owned поле, primary source (ДЗ-пути)
- `profiles.username` — fallback, если не автогенеренный
- Автогенеренные username-ы отфильтровываются regex `/^(telegram_|user_)\d+$/i` → AI работает в нейтральной форме

**Путь 1 — «Ответ к задаче» (ДЗ, edge function `homework-api`):**
- `resolveStudentDisplayName(db, studentAssignmentId)` в `supabase/functions/homework-api/index.ts` резолвит: `tutor_students.display_name → profiles.username (non-auto) → null`
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

**Anti-leak — column whitelist на SELECT (КРИТИЧНО):**
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

**`created_by` placeholder в seed:** строка `(SELECT id FROM auth.users ORDER BY created_at LIMIT 1)` — заменить на UUID Егора перед merge ИЛИ оставить и обновить миграцией позже. RLS policy на `mock_exam_variants` не имеет write rule для authenticated, так что variant создаётся только через service_role (seed apply под service_role, ОК).

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

**Anti-leak invariants (КРИТИЧНО, защищают product invariant):**
1. **`ai_draft_json` НИКОГДА не возвращается** ученику — endpoint вообще не SELECT'ит это поле. Tutor-only artifact (мог отличаться от final approved score). Это инвариант параллелен TASK-5 grader (CLAUDE.md §12) — там endpoint response никогда не содержит `ai_draft_json`/`suggested_score`/draft contents; здесь он не возвращается клиенту даже когда tutor approve состоялся.
2. **`correct_answer`** revealed только post-submit (`status !== 'in_progress'`). Pre-submit endpoint вообще не отвечает (см. §3 ниже).
3. **`tutor_score` / `tutor_comment` / `solution_text` / `task_text` (Часть 2)** revealed только при `status === 'approved'`. Conditional SELECT на стороне backend: `isApproved ? "...tutor_score, tutor_comment..." : "kim_number, photo_url, status"`. Не «всегда select + отфильтровать на сериализации» — поля отсутствуют в памяти процесса до approval.
4. **Tutor card whitelist** — только `name, avatar_url`. **Никогда** `telegram_id` / `telegram_username` / `booking_link` / `email`. Mirror `mock-exam-public::loadTutorCard` whitelist но более узкий (`bio` / `subjects` опущены — student уже знает своего репетитора).

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

**Спека:** `docs/delivery/features/mock-exams-v1/spec.md` AC-5 + tasks.md TASK-13 (mockup Screen 6).

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
