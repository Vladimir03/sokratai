# Tasks: Service Worker для prod-домена sokratai.ru

**Версия:** v0.1
**Дата:** 2026-05-03
**Связанная спека:** `docs/delivery/features/service-worker-prod/spec.md`
**Estimated effort:** 1-2 hours (P0) + 1-2 hours (P1, опционально)

---

## Branch sync prep (выполнить ДО старта tasks)

Чтобы соблюсти D8 (см. spec): сначала main должен иметь signed URL fix (`dc39116`) + actual docs (CLAUDE.md + 95-production-deploy.md).

### Шаг A — закоммитить docs на текущей ветке

```bash
cd C:\Users\kamch\sokratai
git status

# Должно быть:
#   M  CLAUDE.md
#   ?? .claude/rules/95-production-deploy.md

git add CLAUDE.md .claude/rules/95-production-deploy.md
git status   # confirm clean staging

git commit -m "docs: Phase B Selectel migration (CLAUDE.md + 95-production-deploy rule)" -m "After Phase B migration to self-hosted Selectel VPS Moscow (185.161.65.182), production no longer auto-updates from Lovable. AI agents need explicit guidance about deploy procedure.

CLAUDE.md changes:
- rewrite Network & Infrastructure section (Phase A Cloudflare Worker -> Phase B Selectel VPS)
- new architecture diagram (Selectel hosts both frontend and api proxy)
- VPS critical parameters table
- Production Deploy Procedure section with deploy-sokratai command
- Hard rule for edge functions: wrap signed URLs in rewriteToProxy()
- Storage signed URLs section with Patch B+1 / dc39116 rationale
- rollback procedure: per-deploy + full-infrastructure levels
- rules table: add 95-production-deploy.md entry

New file:
- .claude/rules/95-production-deploy.md
  - explicit triggers when AI agents must remind user about deploy-sokratai
  - shape of '🚀 Deploy needed' message template
  - file-pattern based decision tree (frontend vs backend changes)
  - rollback procedure
  - anti-patterns for AI agents

Documentation only - does not affect runtime."

git push origin chore/voice-groq-migration
```

Запомните хеш этого коммита (output `git log -1 --format=%H`).

### Шаг B — синхронизировать main

```bash
git fetch origin
git checkout main
git pull origin main

# Cherry-pick signed URL fix
git cherry-pick dc39116

# Cherry-pick docs commit (используйте hash из шага A)
git cherry-pick <docs-commit-hash>

git push origin main
```

Если cherry-pick конфликтует — Claude Code разберётся, обычно конфликты есть только если main продвинулся параллельно.

### Шаг C — создать feature ветку

```bash
git checkout main
git pull
git checkout -b feat/service-worker-prod

git status   # должно быть clean
git log -3 --oneline   # должны видеть dc39116 + docs commit + предыдущий main
```

После этого готовы к TASK-1.

---

## P0 Tasks (Must-Have, deploy первым релизом)

### TASK-1: Whitelist `sokratai.ru` в registerServiceWorker.ts

**Job**: R1-3 (push notifications), S2-1 (fast loading)
**Agent**: Claude Code
**Files**: `src/registerServiceWorker.ts`
**AC**: AC-1, AC-2 (см. spec §7)
**Estimate**: 5-10 min

**Промпт для агента**: см. секцию «Copy-paste промпты для агентов» внизу файла, блок `[TASK-1]`.

**Шаги**:
1. Прочитать `src/registerServiceWorker.ts`
2. Найти whitelist по hostname (там сейчас только `sokratai.lovable.app`)
3. Превратить в массив `PROD_HOSTS = ['sokratai.ru', 'sokratai.lovable.app']`
4. Использовать `.includes(window.location.hostname)`
5. Проверить нужен ли `www.sokratai.ru` — посмотреть в репо есть ли nginx config с редиректом, или просто добавить для безопасности
6. Добавить comment ссылающийся на CLAUDE.md `# Network & Infrastructure`

**Validation**:
```bash
npm run lint && npm run build
```
TypeScript должен компилироваться без ошибок.

---

### TASK-2: Аудит cache strategies + добавить `api.sokratai.ru` в bypass-list

**Job**: Безопасность данных + работоспособность API
**Agent**: Claude Code
**Files**: `public/service-worker.js` или `src/sw.ts` (нужно найти)
**AC**: AC-5, AC-6
**Estimate**: 30-60 min

**Промпт для агента**: см. блок `[TASK-2]` внизу файла.

**Шаги**:
1. Локализовать SW файл:
   ```bash
   ls public/ | findstr /i "sw service"
   ls src/ | findstr /i "sw service"
   findstr /s /i "addEventListener.*install" public/* src/*
   ```
2. Прочитать SW целиком
3. Найти все места где принимается решение «кешировать или нет» (обычно в `fetch` event handler)
4. Проверить таблицу cache strategies из spec §5 — соответствует ли существующий код
5. **Критично**: убедиться что `api.sokratai.ru` есть в bypass-list. Если нет — добавить
6. Также добавить `*.supabase.co` (защитный bypass на случай прямых ссылок), `mc.yandex.ru`
7. Проверить cache eviction: на activate handler удаляются caches кроме текущей версии

**Validation**:
- Pre-deploy: code review — bypass-list содержит api.sokratai.ru
- Post-deploy: DevTools → Network вкладка после визита показывает api.sokratai.ru запросы как `(network)`, не `(ServiceWorker)`

---

### TASK-3: Реализовать `?sw=off` kill-switch

**Job**: Debugability / возможность recovery без deploy
**Agent**: Claude Code
**Files**: `src/lib/swKillSwitch.ts` (новый), `src/main.tsx` (или entry point — добавить вызов)
**AC**: AC-8
**Estimate**: 30-45 min

**Промпт для агента**: см. блок `[TASK-3]` внизу файла.

**Шаги**:
1. Создать `src/lib/swKillSwitch.ts` с экспортом `checkSwKillSwitch(): Promise<boolean>`
2. Логика:
   - Парсить `window.location.search` → если `sw=off`:
     - Unregister все SW: `navigator.serviceWorker.getRegistrations()` → `Promise.all(reg.map(r => r.unregister()))`
     - Очистить все caches: `caches.keys()` → `Promise.all(caches.delete(name))`
     - Установить `sessionStorage.setItem('sw-disabled', '1')` (на случай если что-то пытается re-register)
     - Reload без `sw=off` параметра в URL
   - Все async операции в try/catch с fallback на reload
   - Console.warn с пояснением что произошло
3. В entry point (там где `registerServiceWorker()` вызывается) добавить:
   ```typescript
   if (await checkSwKillSwitch()) return;
   // existing register logic
   ```
   Вызов **до** регистрации, чтобы успеть unregister до того как новая регистрация запустится

**Validation**:
- Manual test: открыть `sokratai.ru?sw=off` (после deploy)
- DevTools → Application → Service Workers пуст
- DevTools → Application → Cache Storage пуст
- URL после reload — `sokratai.ru` (без `sw=off`)
- Перезагрузить — SW снова регистрируется (не sticky)

---

### TASK-4: Smoke test push notifications

**Job**: R1-3 (push для tutor)
**Agent**: Claude Code (manual test) или Vladimir
**Files**: нет (только тест)
**AC**: AC-7
**Estimate**: 15 min

**Промпт для агента**: см. блок `[TASK-4]` внизу файла.

**Шаги** (после deploy P0):
1. Открыть `sokratai.ru` без VPN, hard-refresh
2. Залогиниться как tutor
3. Открыть `/tutor/home` (или где `<PushOptInBanner>`)
4. Кликнуть «Включить уведомления» → разрешить permission
5. DevTools → Application → Push Messaging — subscription появилась
6. БД: `SELECT user_id, endpoint, expires_at FROM push_subscriptions WHERE user_id = '<your-user-id>'` — есть строка
7. Trigger push: можно через psql вызвать `sendPushNotification(...)` или попросить ученика сдать ДЗ
8. Push notification приходит на browser/desktop/mobile

**Если что-то не работает** — debug:
- Browser console errors про SW или Push API?
- VAPID_PUBLIC_KEY в env совпадает с тем что в Supabase secrets?
- `push-subscribe` edge function отвечает 200 при попытке subscribe?

---

### TASK-5: Update CLAUDE.md (push сейчас работает)

**Job**: Документация для AI агентов
**Agent**: Claude Code
**Files**: `CLAUDE.md`
**AC**: следующая Claude/Cursor сессия видит актуальное состояние
**Estimate**: 5 min

**Промпт для агента**: см. блок `[TASK-5]` внизу файла.

**Шаги**:
1. В `CLAUDE.md` секции `# Network & Infrastructure` найти упоминания «push не работает на sokratai.ru» (если есть в текущей версии после Phase B docs commit)
2. Заменить на «Service Worker активен на sokratai.ru, push-уведомления работают (см. `docs/delivery/features/service-worker-prod/spec.md` Phase 1 / 2026-05-03)»
3. Возможно добавить ссылку на новый rule если будет создан (отдельная задача)

---

## P1 Tasks (Fast Follow-Up — deploy через 1-2 дня после P0 если нужно)

### TASK-6: Vite plugin для `dist/version.json`

**Job**: Emergency force-update mechanism
**Agent**: Claude Code
**Files**: `vite.config.ts`
**AC**: build генерирует `dist/version.json` с правильной структурой
**Estimate**: 1 hour

**Промпт для агента**: см. блок `[TASK-6]` внизу файла.

**Шаги**:
1. Добавить в `vite.config.ts`:
   - `import { execSync } from 'child_process'`
   - Получить `buildVersion = execSync('git rev-parse --short HEAD').toString().trim()`
   - Получить `buildTime = new Date().toISOString()`
   - В `define`: `__BUILD_VERSION__: JSON.stringify(buildVersion)`, `__BUILD_TIME__: JSON.stringify(buildTime)`
   - Custom plugin `name: 'version-manifest'` с `writeBundle()` хуком, пишет `dist/version.json`
2. Структура json:
   ```json
   {
     "version": "<git hash>",
     "minSupportedVersion": "<git hash>",
     "buildTime": "<ISO date>"
   }
   ```
3. По дефолту `minSupportedVersion = version` (не форсит обновление). Bump'ается вручную при emergency

**Validation**:
- `npm run build` — `dist/version.json` создан
- `cat dist/version.json` — формат корректный

---

### TASK-7: Client version check + force-reload banner

**Job**: Завершение mechanism из TASK-6
**Agent**: Claude Code
**Files**: `src/lib/versionCheck.ts` (новый), entry point (вызов checkVersion на mount), UI компонент для banner
**AC**: при `local < minSupportedVersion` показывается banner и через 3-5 сек reload
**Estimate**: 1-2 hours

**Промпт для агента**: см. блок `[TASK-7]` внизу файла.

**Шаги**:
1. Создать `src/lib/versionCheck.ts`:
   - `checkVersion(): Promise<void>` — fetch `/version.json` no-store, compare с `__BUILD_VERSION__`
   - Если `local < minSupportedVersion` (semver compare) → trigger force-reload UI + unregister SW + reload
2. Использовать существующий `<Toast>` или `<Alert>` для banner — без новой UI сущности
3. Вызов `checkVersion()` на app mount + setInterval каждые 30 минут (для long-running sessions)
4. Все ошибки в try/catch — version check best-effort, не блокирует app

**Validation**:
- Manual test: deploy с `minSupportedVersion = current` → клиент получает force-reload
- Default scenario: deploy без bump'а min — клиент НЕ получает reload (нет regression)

---

## Validation Tasks (после P0)

### TASK-8: Manual TC1-TC10

**Files**: нет
**AC**: все 10 AC пройдены
**Estimate**: 30-60 min
**Browsers**: Chrome desktop (Windows/Mac), Safari iOS, Chrome Android

См. spec §7 «Acceptance Criteria» для полного списка.

### TASK-9: Lighthouse audit

```bash
npm install -g lighthouse
lighthouse https://sokratai.ru --view --preset=desktop --only-categories=performance,pwa --output=html --output-path=./lighthouse-pre-sw.html
# После deploy SW:
lighthouse https://sokratai.ru --view --preset=desktop --only-categories=performance,pwa --output=html --output-path=./lighthouse-post-sw.html
```

Сравнить before/after отчёты. Зафиксировать изменения в spec history.

### TASK-10: ChatGPT-5.5 review

См. spec §11 «Reviewer checklist» — copy-paste промпт для ChatGPT-5.5 ниже.

---

## Copy-paste промпты для агентов

> Эти блоки внутри fenced code blocks (без `>` blockquote) — копируются в агента **as-is** для запуска работы.

### [TASK-1] Whitelist sokratai.ru в registerServiceWorker.ts

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: сегмент B2B (репетиторы физики ЕГЭ/ОГЭ) + B2C (школьники mobile-first). Wedge: AI-проверка ДЗ за 5-10 минут. После Phase B миграции (2026-05-03) production-домен sokratai.ru переехал с Lovable на собственный Selectel VPS Moscow. SW в коде whitelist'ит только sokratai.lovable.app — на проде sokratai.ru SW не регистрируется → push-уведомления не работают, повторные визиты медленные.

Canonical docs read (обязательно прочитай):
- docs/delivery/features/service-worker-prod/spec.md (вся спека, особенно §5 Technical Design и §7 AC)
- CLAUDE.md секция "# Network & Infrastructure" (контекст Phase B)
- .claude/rules/70-notifications.md (push инфраструктура)
- src/registerServiceWorker.ts (текущая логика whitelist)

Task: добавить sokratai.ru в whitelist для регистрации Service Worker.

Шаги:
1. Прочитай src/registerServiceWorker.ts полностью
2. Найди условие проверки hostname (там сейчас сравнение с 'sokratai.lovable.app')
3. Замени на массив:
   const PROD_HOSTS = ['sokratai.ru', 'sokratai.lovable.app'];
   const isProdHost = PROD_HOSTS.includes(window.location.hostname);
4. Проверь nginx config / редиректы — нужен ли www.sokratai.ru в whitelist? Если есть редирект www → apex, не нужен. Если нет — добавь.
5. Добавь comment над PROD_HOSTS:
   // Phase B (2026-05-03): sokratai.ru = production self-hosted on Selectel VPS Moscow.
   // sokratai.lovable.app = preview/dev. Both register SW; non-prod hosts unregister.
   // See CLAUDE.md "# Network & Infrastructure" for full architecture.

Acceptance Criteria (Given/When/Then):
- AC-1: Given user opens sokratai.ru, When page loads, Then SW registers (DevTools → Application → Service Workers shows registered SW with script URL '/service-worker.js'). Console does NOT log "Service Worker: Non-prod host, cleaning up stale SWs".
- AC-2: Given user opens sokratai.lovable.app, When page loads, Then SW registers as before (no regression).

Guardrails:
- НЕ модифицируй высокорисковые файлы из .claude/rules/10-safe-change-policy.md (AuthGuard.tsx, TutorGuard.tsx, Chat.tsx).
- НЕ удаляй существующую логику unregister для не-prod хостов — она нужна для localhost / dev preview окружений.
- НЕ добавляй новые dependencies в package.json.

Validation:
1. npm run lint
2. npm run build
3. npm run smoke-check
4. Локально: serve dist через `npx serve -s dist -l 3000`, открыть http://localhost:3000 → SW НЕ регистрируется (localhost не prod). Открыть как `127.0.0.1:3000` — то же самое.

Mandatory end block:
- Changed files: список с короткой аннотацией каждого
- Summary: 2-3 предложения что сделано
- Validation results: вывод lint/build/smoke-check
- Next task: TASK-2 (audit cache strategies)
- Self-check: соответствие docs/delivery/features/service-worker-prod/spec.md
```

### [TASK-2] Audit cache strategies + добавить api.sokratai.ru в bypass

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: SW регистрируется на sokratai.ru (после TASK-1). Нужно убедиться что cache strategies SW-кода защищают API данные пользователя — НИ ПРИ КАКИХ обстоятельствах не кешировать запросы к api.sokratai.ru (security-критично, иначе риск утечки данных одного пользователя другому через cache).

Canonical docs read:
- docs/delivery/features/service-worker-prod/spec.md (§3 Architecture, §5 Technical Design — таблица cache strategies, §7 AC-5, AC-6)
- CLAUDE.md секция "# Network & Infrastructure"

Task: аудит SW-кода, добавление api.sokratai.ru в bypass-list, верификация cache strategies.

Шаги:
1. Локализуй SW файл:
   ls public/ | findstr /i "sw service"
   ls src/ | findstr /i "sw service"
   findstr /s /i "addEventListener.*install" public src
   Возможные кандидаты: public/service-worker.js, src/sw.ts, generated by vite-plugin-pwa.

2. Прочитай SW целиком. Найди:
   - Где fetch event handler
   - Где принимается решение "кешировать / не кешировать" по URL pattern
   - Какие caches используются (`caches.open(...)`)
   - Cleanup logic в activate handler

3. Сверь с таблицей из spec §5:
   | Pattern | Strategy | TTL |
   |---|---|---|
   | index.html | Network-first | 0 |
   | /assets/*.{js,css,png,jpg,...} | Cache-first | 1 year |
   | /icons/*, /favicon.ico, /manifest.json | Cache-first | 30 days |
   | /service-worker.js, /version.json | Network-only | 0 |
   | https://api.sokratai.ru/* | BYPASS SW | — |
   | https://*.supabase.co/* | BYPASS SW | — |
   | https://*.yandex.ru/* | BYPASS SW | — |

4. КРИТИЧНО: добавь api.sokratai.ru в bypass-list если его нет.
   Скорее всего код выглядит примерно так:
   const BYPASS_HOSTS = ['mc.yandex.ru', 'analytics.tiktok.com', /* ... */];
   Добавить:
   - 'api.sokratai.ru' (НОВОЕ — раньше его не было, потому что был Cloudflare Worker)
   - 'vrsseotrfmsxpbciyqzc.supabase.co' (защитный, на случай прямых ссылок мимо proxy)

5. Если SW отсутствует cleanup logic для старых caches — добавь:
   На activate event:
   const currentCacheName = `sokratai-cache-v${CACHE_VERSION}`;
   const allCaches = await caches.keys();
   await Promise.all(allCaches.map(name => name === currentCacheName ? null : caches.delete(name)));

Acceptance Criteria:
- AC-5: При визите на sokratai.ru с открытым DevTools → Network, ВСЕ запросы к api.sokratai.ru показывают (network), НИКОГДА (ServiceWorker).
- AC-6: grep "api\.sokratai\.ru" в SW коде находит explicit bypass-условие.

Guardrails:
- НЕ кешируй API endpoints (security risk).
- НЕ изменяй существующие cache strategies для статики если они работают — мы только добавляем bypass для нового домена.
- НЕ модифицируй high-risk файлы (AuthGuard.tsx, TutorGuard.tsx, Chat.tsx).

Validation:
1. Code review: grep "api\.sokratai\.ru" supabase/* src/* public/* — должен найтись в SW коде в контексте bypass
2. После deploy: открыть sokratai.ru, DevTools → Network → отфильтровать api.sokratai.ru → все запросы Source = "network" (не "ServiceWorker")
3. npm run lint && npm run build && npm run smoke-check

Mandatory end block:
- Changed files
- Summary
- Validation results
- Where SW lives (we discovered: ...)
- Next task: TASK-3 (kill-switch)
- Self-check: соответствие spec §3 + §5
```

### [TASK-3] Kill-switch ?sw=off

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Task: реализовать query param `?sw=off` который unregister'ит SW + чистит caches + reload без параметра. Полезно для дебага у пользователей и для emergency recovery после сломанного deploy.

Canonical docs read:
- docs/delivery/features/service-worker-prod/spec.md (§3.4 Debug escape hatch, §5 Technical Design)

Шаги:
1. Создай новый файл src/lib/swKillSwitch.ts:

```typescript
/**
 * Kill-switch для Service Worker.
 *
 * Использование: пользователь добавляет `?sw=off` в URL → SW unregistered, caches очищены,
 * reload без query param. Полезно для:
 *   - дебага у пользователей ("у меня застрял старый кеш")
 *   - emergency recovery после deploy с broken SW
 *   - локальной разработки
 *
 * См. docs/delivery/features/service-worker-prod/spec.md §3.4
 */
export async function checkSwKillSwitch(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search);
  if (params.get('sw') !== 'off') {
    return false;
  }

  console.warn('[SW Kill-switch] activated via ?sw=off — unregistering and clearing caches...');

  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister().catch(err => {
        console.error('[SW Kill-switch] failed to unregister', r, err);
      })));
    }
  } catch (err) {
    console.error('[SW Kill-switch] error during SW unregister', err);
  }

  try {
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(name => caches.delete(name).catch(err => {
        console.error('[SW Kill-switch] failed to delete cache', name, err);
      })));
    }
  } catch (err) {
    console.error('[SW Kill-switch] error during caches clear', err);
  }

  sessionStorage.setItem('sw-disabled', '1');

  // Reload без ?sw=off
  const url = new URL(window.location.href);
  url.searchParams.delete('sw');
  console.warn('[SW Kill-switch] reloading without sw=off param');
  window.location.replace(url.toString());

  return true;
}
```

2. В точке регистрации SW (вероятнее всего src/registerServiceWorker.ts или src/main.tsx — там где `navigator.serviceWorker.register(...)` вызывается):

```typescript
import { checkSwKillSwitch } from '@/lib/swKillSwitch';

// ВАЖНО: вызывать ПЕРЕД регистрацией SW
async function setupServiceWorker() {
  if (await checkSwKillSwitch()) {
    // Page reloaded already, SW не регистрируется в этой сессии
    return;
  }
  // existing register logic
  // ...
}
```

3. Если в текущем коде `registerServiceWorker()` синхронный — превратить в async, обернув всё содержимое в async function. Это безопасно, потому что вызов идёт в обработчиках событий или на mount.

Acceptance Criteria:
- AC-8: Given открыт sokratai.ru?sw=off, When page loads, Then DevTools → Application → Service Workers пуст, Cache Storage пуст, URL после reload = sokratai.ru (без ?sw=off). Перезагрузить страницу — SW снова регистрируется (не sticky).

Guardrails:
- НЕ кешируй sessionStorage значение sw-disabled на длительный срок — оно живёт только в текущей session, что и нужно.
- НЕ забудь try/catch — kill-switch должен работать даже если что-то падает в unregister/cache.delete.
- НЕ модифицируй high-risk файлы.

Validation:
1. Local: `serve -s dist -l 3000` → http://localhost:3000?sw=off в браузере → DevTools проверка
2. Build: npm run build → проверить что чанк swKillSwitch не превышает 1KB (микроскопический файл)

Mandatory end block:
- Changed files
- Summary  
- Validation results (local test screenshots если возможно)
- Next task: TASK-4 (push smoke test)
```

### [TASK-4] Push notifications smoke test

```
Это manual test, не код. Цель: убедиться что после TASK-1+2 push работает на проде.

Шаги:
1. Дождись завершения TASK-1, TASK-2, TASK-3, deploy через `deploy-sokratai`.
2. Открой sokratai.ru без VPN, hard-refresh (Ctrl+Shift+R).
3. Залогинись как tutor.
4. Открой /tutor/home (там <PushOptInBanner>, см. src/components/PushOptInBanner.tsx).
5. Кликни "Включить уведомления" → разреши permission в браузере.
6. DevTools → Application → Push Messaging — должна появиться subscription.
7. БД проверка через Supabase SQL editor:
   SELECT user_id, endpoint, expires_at FROM push_subscriptions WHERE user_id = '<your-tutor-user-id>';
   Должна быть строка с твоим endpoint.
8. Trigger push (любой способ):
   - Попроси ученика сдать ДЗ → push приходит автоматически через cascade в homework-api
   - Или вручную через psql: вызвать sendPushNotification(payload, subscription) из edge function context
9. Push notification appears на browser desktop / mobile (если subscribed на mobile).

Если что-то не работает — debug:
- Browser console errors про SW или Push API?
- VAPID_PUBLIC_KEY env совпадает с тем что в Supabase Edge Function secrets?
- push-subscribe edge function отвечает 200 при попытке subscribe?
- Подробности в .claude/rules/70-notifications.md

Не пиши код. Зафиксируй результат:
- ✅ если работает: push приходит, screenshot в spec history
- ❌ если не работает: какая ошибка, где
```

### [TASK-5] Update CLAUDE.md (push сейчас работает)

```
Task: обновить CLAUDE.md чтобы убрать устаревшее упоминание "push не работает на sokratai.ru".

Шаги:
1. Прочитай CLAUDE.md секцию "# Network & Infrastructure"
2. Найди упоминания "push не работает" / "Service Worker disabled" / похожее в контексте sokratai.ru.
3. Если нашёл — замени на:
   "Service Worker активен на sokratai.ru с 2026-05-03 (см. docs/delivery/features/service-worker-prod/spec.md). Push-уведомления работают для подписавшихся пользователей."
4. Если не нашёл — ничего не делай (возможно уже актуально после Phase B docs commit).

Validation:
- grep -i "push" CLAUDE.md → должно быть актуально
- git diff CLAUDE.md → минимальный diff (1-3 строки)

Не модифицируй другие секции CLAUDE.md.
```

### [TASK-6] Vite plugin для version.json — P1

```
Task: добавить генерацию dist/version.json при `npm run build`. Используется для P1 force-update mechanism (TASK-7).

Шаги:
1. В vite.config.ts:
   ```typescript
   import { execSync } from 'child_process';
   import fs from 'fs';

   const buildVersion = (() => {
     try {
       return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
     } catch {
       return 'unknown';
     }
   })();
   const buildTime = new Date().toISOString();

   export default defineConfig({
     define: {
       __BUILD_VERSION__: JSON.stringify(buildVersion),
       __BUILD_TIME__: JSON.stringify(buildTime),
     },
     plugins: [
       // ... existing plugins
       {
         name: 'version-manifest',
         apply: 'build',
         writeBundle() {
           const manifestPath = `${__dirname}/dist/version.json`;
           fs.writeFileSync(manifestPath, JSON.stringify({
             version: buildVersion,
             minSupportedVersion: buildVersion,  // bump manually for force-update
             buildTime,
           }, null, 2));
         },
       },
     ],
   });
   ```

2. Добавить в src/vite-env.d.ts (или global.d.ts):
   ```typescript
   declare const __BUILD_VERSION__: string;
   declare const __BUILD_TIME__: string;
   ```

3. Тест:
   - npm run build
   - cat dist/version.json
   - Должно вывести валидный JSON с version, minSupportedVersion, buildTime

Acceptance Criteria:
- npm run build генерирует dist/version.json
- Format: { version: "<short-hash>", minSupportedVersion: "<short-hash>", buildTime: "<ISO>" }
- minSupportedVersion === version по дефолту (нет force update)

Validation:
- npm run build && cat dist/version.json — JSON parse'ится, имеет три поля
- npm run lint — без ошибок
```

### [TASK-7] Client version check + force-reload — P1

```
Task: реализовать клиентскую проверку версии и UI banner для force-reload при mismatch.

Зависит от TASK-6 (нужен dist/version.json).

Шаги:
1. Создай src/lib/versionCheck.ts:
```typescript
/**
 * Version check для emergency force-update.
 * Спека: docs/delivery/features/service-worker-prod/spec.md §3.3
 */
declare const __BUILD_VERSION__: string;

interface VersionManifest {
  version: string;
  minSupportedVersion: string;
  buildTime: string;
}

function compareVersions(a: string, b: string): number {
  // git short hashes — не semver, поэтому простое сравнение по equality
  // если разные — считаем "version differ", направление неважно для kill-switch logic
  return a === b ? 0 : 1;
}

async function fetchVersionManifest(): Promise<VersionManifest | null> {
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function unregisterAllSWAndReload(): Promise<void> {
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(r => r.unregister()));
  }
  if ('caches' in window) {
    const names = await caches.keys();
    await Promise.all(names.map(n => caches.delete(n)));
  }
  window.location.reload();
}

export async function checkVersion(): Promise<void> {
  const manifest = await fetchVersionManifest();
  if (!manifest) return;

  const local = __BUILD_VERSION__;
  const minSupported = manifest.minSupportedVersion;

  // Если локальная версия НЕ совпадает с minSupportedVersion (т.е. устарела) → force update
  // Direction matters: если local НЕ равен текущему remote.minSupportedVersion и НЕ равен remote.version,
  // значит локальный кеш отстал. Force reload.
  if (local !== manifest.version && local !== minSupported) {
    console.warn('[VersionCheck] local', local, '!= min', minSupported, '/ remote', manifest.version, '— forcing reload');
    showForceUpdateBanner();
    setTimeout(() => unregisterAllSWAndReload(), 3000);
  }
}

function showForceUpdateBanner(): void {
  // Использовать существующий <Toast> или <Alert> из @/components/ui
  // Пример: toast.warning('Версия устарела, страница перезагрузится через 3 секунды', { duration: 3000 });
  // ВАЖНО: реальный код зависит от того какая toast library в проекте (sonner, react-hot-toast, etc.)
  // Найди в src/ и используй существующий API
}
```

2. На app mount (например, в src/App.tsx или main.tsx):
```typescript
import { checkVersion } from '@/lib/versionCheck';

useEffect(() => {
  checkVersion();
  const interval = setInterval(checkVersion, 30 * 60 * 1000);  // re-check каждые 30 мин
  return () => clearInterval(interval);
}, []);
```

Acceptance Criteria:
- При local === remote.version → ничего не происходит (no-op)
- При local !== remote.version И local !== remote.minSupportedVersion → banner + reload
- Banner использует существующий UI компонент (Toast/Alert), без новой UI сущности

Validation:
- Manual test: build v1, deploy, открыть. Build v2 без bump'а min — клиент НЕ reload'ится. Build v3 с manual bump (set minSupportedVersion = v3 в vite.config) — клиент reload'ится с banner.
- Test scenario когда /version.json возвращает 404 — приложение продолжает работать (silent fail).
```

### [Reviewer для ChatGPT-5.5]

```
Ты — независимый ревьюер SokratAI. Контекст первого агента (Claude Code) тебе недоступен. У тебя только эта спека и git diff.

ПОРЯДОК (строго):
1. Прочитай docs/discovery/product/tutor-ai-agents/14-ajtbd-product-prd-sokrat.md (понять Job Graph)
2. Прочитай docs/discovery/product/tutor-ai-agents/16-ux-principles-for-tutor-product-sokrat.md
3. Прочитай docs/discovery/product/tutor-ai-agents/17-ui-patterns-and-component-rules-sokrat.md
4. Прочитай CLAUDE.md секцию "# Network & Infrastructure" (Phase B context)
5. Прочитай .claude/rules/70-notifications.md (push infra)
6. Прочитай docs/delivery/features/service-worker-prod/spec.md (вся спека)
7. Прочитай docs/delivery/features/service-worker-prod/tasks.md (этот файл)
8. Посмотри git diff main..feat/service-worker-prod

ВОПРОСЫ ДЛЯ ПРОВЕРКИ:

A. Job alignment:
- Затронуты ли заявленные Jobs (R1-3 для tutor, S2-1+S2-3 для student)?
- Pilot impact реализован: push для tutor + speed для student?

B. Scope:
- Все P0 tasks реализованы (TASK-1 to TASK-5)?
- Scope creep: добавлено что-то вне P0/P1?

C. Acceptance criteria:
- AC-1: SW регистрируется на sokratai.ru? (grep PROD_HOSTS)
- AC-2: sokratai.lovable.app не сломан? (whitelist содержит оба)
- AC-5: API endpoints НЕ кешируются? (grep "api.sokratai.ru" в SW коде в контексте bypass)
- AC-6: Bypass list explicit? (verify SW code)
- AC-8: ?sw=off реализован? (verify swKillSwitch.ts существует и используется)

D. Безопасность:
- Никакие cache strategies НЕ кешируют api.sokratai.ru или *.supabase.co?
- Нет утечек user data через cache?
- Auth tokens (cookies, localStorage) не попадают в SW cache?

E. UX drift:
- Routine update flow без modal banner? (skipWaiting + clients.claim, no popup)
- Force-reload banner ТОЛЬКО при minSupportedVersion mismatch (если P1 реализован)?
- Push opt-in flow не изменён (используется существующий PushOptInBanner)?

F. Code quality:
- Високорисковые файлы (AuthGuard.tsx, TutorGuard.tsx, Chat.tsx) НЕ модифицированы?
- Новые dependencies НЕ добавлены в package.json?
- TypeScript strict mode не нарушен?
- Build size diff < 5%?

G. Документация:
- spec.md соответствует реализованному коду (нет drift)?
- CLAUDE.md обновлён (push сейчас работает)?

ФОРМАТ ОТВЕТА:

PASS / CONDITIONAL PASS / FAIL

Если CONDITIONAL PASS — список конкретных пунктов которые надо исправить перед merge (с привязкой к AC или принципам).

Если FAIL — принципиальные проблемы, требуется существенная доработка.

Не предлагай "улучшения" вне scope spec'а. Только проверка соответствия.
```

---

*История изменений:*

- v0.1 (2026-05-03): начальная версия tasks, после approve спеки v0.1
