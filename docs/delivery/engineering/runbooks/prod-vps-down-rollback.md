# Prod down / VPS rollback — incident runbook

Когда `sokratai.ru` недоступен или деградировал. Прод обслуживается с **Selectel VPS Москва** (`185.161.65.182`) — он раздаёт фронтенд и проксирует API на Supabase. Network-контракт: `AGENTS.md → CRITICAL — Network & RU bypass`. Deploy-процедура: `.claude/rules/95-production-deploy.md`.

## Симптом

- `https://sokratai.ru/` не открывается / 5xx / белый экран для всех RU-пользователей.
- `https://api.sokratai.ru/__health` не отвечает (прокси лёг) → отваливаются Auth / REST / Storage / Realtime.
- Свежий `deploy-sokratai` сломал прод (build прошёл, но сайт битый).

Сначала определи **уровень сбоя**: деплой сломал сайт, но VPS жив и nginx отвечает → **Уровень 1**; сам VPS не отвечает по SSH/HTTP → **Уровень 2**.

## Архитектура (контекст)

```
sokratai.ru      → Cloudflare DNS-only → A 185.161.65.182 (Selectel VPS, nginx) → статика /var/www/sokratai/
api.sokratai.ru  → Cloudflare DNS-only → A 185.161.65.182 (тот же nginx, reverse proxy) → vrsseotrfmsxpbciyqzc.supabase.co
```
Lovable Cloud деплоит DB / Auth / Edge Functions в Supabase при push в GitHub; прод-домен **не** обслуживает (только preview `sokratai.lovable.app`).

| Параметр | Значение |
|---|---|
| Prod VPS IPv4 | `185.161.65.182` (Selectel, Москва ru-7a, Ubuntu 24.04, nginx 1.24, swap 2 GB) |
| SSH | `ssh -i "$HOME\.ssh\sokratai_proxy" root@185.161.65.182` (publickey only, fail2ban, UFW 22/80/443) |
| Deploy | `/usr/local/bin/deploy-sokratai` (git pull → npm ci → build → copy `dist/` → nginx reload → healthcheck) |
| Lovable fallback IP | `185.158.133.1` (для Уровня 2 DNS-отката) |
| CF Worker fallback | `sokratai-supabase-proxy` (deactivated, для Уровня 2) |

## Уровень 1 — откат frontend deploy (VPS жив, build сломал прод)

Полная процедура — `.claude/rules/95-production-deploy.md` («Откат сломанного деплоя»). Кратко:

```bash
ssh -i "$HOME\.ssh\sokratai_proxy" root@185.161.65.182
cd /opt/sokratai
git log --oneline | head -5          # выбрать предыдущий рабочий коммит
git checkout <hash>
NODE_OPTIONS="--max-old-space-size=2048" npm ci
NODE_OPTIONS="--max-old-space-size=2048" npm run build
cp -r dist/* /var/www/sokratai/
systemctl reload nginx
```
Прод откатывается к указанному коммиту за ~3 минуты.

## Уровень 2 — откат всей инфраструктуры (VPS лежит)

Worst case: Selectel VPS не отвечает или сильно деградировал. Возврат на старую инфру Phase A (Lovable Cloud для frontend, Cloudflare Worker для backend):

1. **DNS в Cloudflare:**
   - `A sokratai.ru` → обратно на `185.158.133.1` (Lovable IP), proxy = **DNS only** (серое облако).
   - `A api.sokratai.ru` → удалить.
2. **Worker `sokratai-supabase-proxy`** в Cloudflare → добавить обратно Custom Domain `api.sokratai.ru` (Workers & Pages → Settings → Domains & Routes → Add).
3. Распространение DNS — 1–5 минут.
4. Прод вернётся в Phase A: `sokratai.ru` на Lovable, `api.sokratai.ru` через CF Worker. RU-пользователи получат обратно интермиттентные обрывы, но не-RU работают.

⚠️ **Код не трогать** — хардкод `https://api.sokratai.ru` в `src/lib/supabaseClient.ts` совместим с обоими вариантами проксирования.

VPS Selectel остаётся жив параллельно — после восстановления вернись обратно сменой DNS (A-записи → `185.161.65.182`, убрать CF Worker custom domain).

## После восстановления

- Проверь `https://sokratai.ru/` + `https://api.sokratai.ru/__health`.
- Проверь auth-flow в РФ (`.claude/rules/96-auth-ru-bypass.md`) — Site URL / redirect URLs должны указывать на `sokratai.ru`, не на `*.supabase.co`.
- Если откатывал deploy (Уровень 1) — найди причину битого build'а до следующего `deploy-sokratai`.

## История миграции (справочно)

- **Phase A (2026-04-26):** Cloudflare Worker `api.sokratai.ru` как reverse proxy. Интермиттентные обрывы для RU (CF edge Stockholm).
- **Phase B (2026-05-03):** миграция на Selectel VPS Москва. Стабильность 100% для RU. Lovable → preview-only.
- **Patch B+1 / B+2:** signed-URL rewrite (`rewriteToProxy` / `rewriteToDirect`) + dual-host validators в edge functions (`_shared/proxy-url.ts`). См. rule 40 «Patch B+2 dual-host validator invariant».

> Источник: извлечено из git-истории `CLAUDE.md` (секция «Network & Infrastructure», до diet-рефактора 2026-05-29).
