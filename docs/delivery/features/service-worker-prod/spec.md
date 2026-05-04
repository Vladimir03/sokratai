# Feature Spec: Service Worker для prod-домена sokratai.ru

**Версия:** v0.1
**Дата:** 2026-05-03
**Автор:** Vladimir Kamchatkin × Claude (Cowork)
**Статус:** approved (все Decisions закрыты 2026-05-03) → готов к implementation
**Целевая аудитория этой спеки:** Claude Code (implementer), ChatGPT-5.5 (independent reviewer)
**Estimated effort:** 1-2 hours (P0) + 1-2 hours (P1, опционально)

---

## 0. Job Context

### Какую работу закрывает эта фича?

| Участник | Core Job | Sub-job | Ссылка на Граф |
|---|---|---|---|
| Репетитор (B2B) | R1: Сократить время проверки ДЗ | R1-1 (быстро увидеть что есть проверка), R1-3 (получать уведомления) | job-graph.md#R1 |
| Школьник (B2C) | S2: Решать ДЗ удобно с мобильного | S2-1 (быстрая загрузка), S2-3 (работать на медленном интернете) | job-graph.md#S2 |
| Родитель (B2C) | — | — | (не релевантно) |

### Wedge-связка

- **B2B-сегмент:** B2B-1 (репетиторы физики ЕГЭ/ОГЭ, hourly rate 3000-4000₽)
- **B2C-сегмент:** B2C-1 (школьники 16-18, mobile-first)
- **Score матрицы:** усиление, не новая позиция (фича инфраструктурная, влияет на retention обоих сегментов)

### Pilot impact

После Phase B миграции (2026-05-03) все RU-пользователи открывают `sokratai.ru` через наш Selectel VPS. Без Service Worker: каждое открытие = 5-15 секунд белого экрана на медленном мобильном LTE/3G + push-уведомления невозможны (требуют SW). С SW: повторные визиты < 500ms + push активируется (push-инфраструктура готова, ждёт SW). **Снимает два из трёх известных трений пилота**: «долго открывается» и «не вижу когда ученик сдал».

---

## 1. Summary

После Phase B миграции на Selectel VPS production-домен сменился с `sokratai.lovable.app` на `sokratai.ru`. В коде `src/registerServiceWorker.ts` whitelist на регистрацию SW указывает только на `sokratai.lovable.app` → на проде SW отключён, push не работает, повторные визиты медленные.

Эта фича включает Service Worker для `sokratai.ru` с правильной cache-стратегией (immutable assets, network-first для index.html, **bypass для API**), seamless update flow без modal banner'ов, и kill-switch `?sw=off` для дебага.

---

## 2. Problem

### Текущее поведение (без SW на проде)

- Каждое открытие `sokratai.ru` = полная загрузка JS/CSS bundle с сервера. На быстром Wi-Fi 1-2 сек, на 3G/LTE 5-15 сек белого экрана.
- Push-уведомления не работают (нет subscription endpoint в браузере без SW).
- DevTools Console показывает `Service Worker: Non-prod host, cleaning up stale SWs...` (намеренно по текущему whitelist'у).
- Старая регистрация SW от пользователей, которые когда-либо открывали `sokratai.lovable.app`, форсированно отписывается на `sokratai.ru` — выгрузка кеша.

### Боль

- **Репетитор** (R1-3): не получает push когда ученик сдал ДЗ → узнаёт из Telegram-сообщения от ученика или сам зайдя на сайт. Откладывает проверку, ученик ждёт фидбек.
- **Ученик** (S2-1, S2-3): на мобильном интернете в селе/электричке открытие `sokratai.ru` = долгая загрузка, белый экран. Frustration → бросает попытку.
- **Все**: после `deploy-sokratai` Lovable не пушит обновление — пока пользователь не закроет вкладку и не откроет снова, видит старую версию (но это не SW-проблема, отдельный issue update flow).

### Текущие «нанятые» решения

- Репетитор: проверяет ДЗ batch'ем раз в день вместо real-time.
- Ученик: использует Telegram-бот вместо веб-сайта (там работает push).
- Все: терпят медленную загрузку.

---

## 3. Solution

### Описание

Включить Service Worker на новом prod-домене `sokratai.ru` (одна строка в whitelist'е), верифицировать cache-стратегии существующего SW под наш кейс (особенно: API endpoints на `api.sokratai.ru` **должны быть в bypass-list**), реализовать kill-switch `?sw=off` для дебага, добавить опциональный version manifest для emergency force-update.

### Ключевые решения

1. **Whitelist `sokratai.ru` рядом с `sokratai.lovable.app`** — обе остаются prod (lovable.app для preview/QA, .ru для пользователей). Никакой регрессии для preview-окружения.

2. **API НЕ кешируется** — критичный security-инвариант. Endpoints на `api.sokratai.ru` обязаны быть в bypass-list. Иначе риск утечки данных одного пользователя другому через cache.

3. **Update flow seamless без modal banner** — при deploy новой версии SW автоматически активируется на следующей SPA-навигации (`skipWaiting()` + `clients.claim()`). НЕТ всплывающих окон «Обновите страницу» при обычных deploy. Vite hash-based imports делают это безопасным: новая версия = новые имена chunks, ничего не путается.

4. **Kill-switch `?sw=off`** — query параметр для отладки. Unregister SW + clear caches + reload без параметра. Полезно когда что-то застряло в кеше у пользователя или в новом deploy баг.

5. **Version manifest как опциональный force-update** — `/version.json` с `minSupportedVersion`. Пишется при build (Vite plugin), читается клиентом на старте. Если client.version < min — force reload. Используется редко (emergency).

6. **Push notifications активируется автоматически** — после регистрации SW существующая push-инфраструктура (`PushOptInBanner`, `pushApi.ts`, edge function) начинает работать без дополнительных правок.

### Scope

**In scope (P0 — Must-Have):**

- P0-1: Whitelist `sokratai.ru` в `src/registerServiceWorker.ts`
- P0-2: Аудит cache strategies в существующем SW (`public/service-worker.js` или `src/sw.ts`) — особенно bypass-list должен включать `api.sokratai.ru` (новый host, его раньше не было в bypass)
- P0-3: Smoke test push notifications работают на проде (subscribe → trigger → notification appears)
- P0-4: `?sw=off` kill-switch реализован

**In scope (P1 — Nice-to-Have, fast follow-up):**

- P1-1: Version manifest (`/version.json` + client check) для emergency force-update
- P1-2: Console-логи на SW lifecycle events с версией для debug

**Out of scope (отдельные фичи / отложено):**

- Полный offline-режим (write/sync, conflict resolution)
- Background Sync API для отложенной отправки ответов AI
- Кеширование API-ответов (security risk)
- Custom PWA install prompt («Add to Home Screen» UI с кастомным branding)
- Workbox или другая SW-библиотека (используем существующий vanilla SW)
- Sentry / расширенная telemetry SW-ошибок (отдельная задача)

---

## 4. User Stories

### Репетитор

> Когда ученик сдаёт ДЗ в 22:00, а я в это время вне SokratAI (закрыл вкладку, ужинаю), я хочу получить push-уведомление на iPhone, чтобы решить — проверить сейчас или утром.

### Школьник

> Когда я открываю sokratai.ru с мобильного на LTE из электрички, я хочу чтобы страница ДЗ открылась за 1-2 секунды (а не 10), чтобы успеть посмотреть условие до выхода из метро.

> Когда я уже открыл задачу и метро потеряло сеть, я хочу чтобы условие задачи и UI остались видны (даже если ответы не отправляются), чтобы я мог продумать решение.

### Devops / Vladimir

> Когда я делаю `deploy-sokratai` с критическим багфиксом, я хочу чтобы все онлайн-пользователи получили новую версию на следующей навигации без модального баннера, чтобы они не отвлекались на «Обновите страницу».

> Когда я случайно задеплоил сломанную версию, я хочу команду которая force-reload'ит всех клиентов на исправленную версию, чтобы не ждать пока каждый пользователь сам перезайдёт.

---

## 5. Technical Design

### Затрагиваемые файлы

| File | Изменение | Приоритет |
|---|---|---|
| `src/registerServiceWorker.ts` | Whitelist `sokratai.ru` рядом с `sokratai.lovable.app` | P0 |
| `public/service-worker.js` (или `src/sw.ts`) | Аудит bypass-list: добавить `api.sokratai.ru` если нет; верификация cache strategies | P0 |
| `src/lib/swKillSwitch.ts` (новый) | Логика `?sw=off`: unregister SW, clear caches, reload без параметра | P0 |
| `src/main.tsx` (или entry point) | Вызов `swKillSwitch.check()` ПЕРЕД регистрацией SW | P0 |
| `vite.config.ts` | Plugin генерирующий `dist/version.json` при build | P1 |
| `src/lib/versionCheck.ts` (новый) | Проверка local vs remote version, force-reload при mismatch | P1 |
| `CLAUDE.md` | Обновить упоминание SW (сейчас в `# Network & Infrastructure` пишется что push не работает на sokratai.ru — после фичи это устаревает) | P0 |

### Data Model

Без изменений. Push subscriptions схема (`push_subscriptions` table) уже существует и не модифицируется.

### API

Без изменений. Push subscription endpoint (`push-subscribe`) уже существует.

### Миграции

Не требуются.

### Cache strategies (детальная таблица — для Task 2 audit)

| Pattern | Стратегия | TTL | Comment |
|---|---|---|---|
| `index.html` | Network-first → cache fallback | 0 (no-store) | Содержит refs на актуальные chunks |
| `/assets/*.{js,css}` | Cache-first, immutable | 1 year | Vite hash в имени → уникально |
| `/assets/*.{png,jpg,webp,svg,ico,woff,woff2,ttf}` | Cache-first | 1 year | То же |
| `/icons/*`, `/favicon.ico`, `/manifest.json` | Cache-first | 30 days | Меняются редко |
| `/service-worker.js`, `/version.json` | Network-only, no-store | 0 | Должны быть свежими |
| **`https://api.sokratai.ru/*`** | **Bypass SW** | — | Критичный security инвариант |
| `https://*.supabase.co/*` | Bypass SW | — | Защитный bypass на случай прямых ссылок (не должно быть, но безопасно) |
| `mc.yandex.ru/*`, `*.yandex.ru/*` | Bypass SW | — | Сторонняя аналитика |

### Update flow

```
T0: пользователь открывает sokratai.ru
    └ старый SW (v_old) перехватывает navigation
    └ возвращает cached index.html
    └ браузер парсит, грузит chunks (cached)
    └ страница отрисовывается за ~200-500ms

T1: SW в фоне:
    └ fetch /service-worker.js (network-only)
    └ если получен файл с другим хешем — есть update
    └ install handler нового SW (v_new)
    └ caches.open(v_new), prefetch критичных ресурсов

T2: navigation event (клик внутри SPA, react-router push)
    └ если v_new в waiting state → self.skipWaiting()
    └ activate handler нового SW
    └ self.clients.claim() — взять управление существующими вкладками
    └ старые caches удаляются (всё кроме v_new)
    └ пользователь продолжает работу — никаких UI banner'ов
```

### Kill-switch flow

```
URL: https://sokratai.ru/?sw=off
    │
    ▼
checkSwKillSwitch() — вызвается ПЕРЕД register
    │
    ├─ navigator.serviceWorker.getRegistrations() → unregister all
    ├─ caches.keys() → caches.delete(...) for each
    └─ window.location.replace(url без ?sw=off параметра)
       └ перезагрузка уже без SW (свежий cold-start)
```

### Version manifest flow (P1)

```
build time (vite.config.ts plugin):
    ├─ git rev-parse --short HEAD → buildVersion
    ├─ new Date().toISOString() → buildTime
    └─ write dist/version.json:
       {
         "version": buildVersion,
         "minSupportedVersion": buildVersion,  // bump manually для force
         "buildTime": buildTime
       }

client side (src/lib/versionCheck.ts):
    on app mount + every 30 min:
    ├─ fetch /version.json (no-store) → remote
    ├─ local = window.__BUILD_VERSION__  // baked by Vite define
    └─ if compareVersions(local, remote.minSupportedVersion) < 0:
        ├─ show banner "Версия устарела, обновляем..."
        ├─ unregisterAllSW()
        └─ reload()
```

---

## 6. UX / UI

### Wireframe / Mockup

Визуальных изменений в UI **нет**. Service Worker работает в фоне, для пользователя невидим (за исключением P1 force-reload banner'а — текст уровня "Версия устарела, страница перезагрузится через 3 секунды").

### UX-принципы (из doc 16)

- **Мгновенный отклик** (UX P1): SW делает повторные визиты < 500ms — соответствует принципу.
- **Не ломать работу пользователя** (UX P3): seamless update без modal banner — пользователь продолжает работу не отвлекаясь.
- **Прозрачные состояния** (UX P5): force-reload банер (P1) явно говорит что происходит и сколько ждать.

### UI-паттерны (из doc 17)

- **Никаких новых компонентов** для P0 (всё в фоне).
- Force-reload banner (P1) использует существующий `<Toast>` или `<Alert>` компонент из `@/components/ui` — без новой UI-сущности.

### Push opt-in flow (без изменений)

Существующий `<PushOptInBanner>` (`src/components/PushOptInBanner.tsx`) показывается при первом визите. После одобрения — subscription создаётся через существующий `subscribeToPush()` (`src/lib/pushApi.ts`). После этой фичи он начнёт работать на `sokratai.ru` (раньше работал только на `sokratai.lovable.app`).

---

## 7. Validation

### Acceptance Criteria (testable)

- **AC-1**: SW регистрируется на `sokratai.ru` после deploy. Verify: DevTools → Application → Service Workers shows registered SW with correct script URL `/service-worker.js`. Console **НЕТ** лога `Service Worker: Non-prod host, cleaning up stale SWs`.

- **AC-2**: Никакой регрессии на `sokratai.lovable.app`. Verify: после deploy открыть preview-домен → SW регистрируется как до изменений.

- **AC-3**: TTI повторного визита на `sokratai.ru` ≤ 500ms. Verify: Lighthouse audit `--preset=desktop` shows TTI < 500ms на second-load. Сейчас (без SW) 2-5 секунд на slow 3G.

- **AC-4**: Update flow seamless. Verify: build v1, deploy, открыть в браузере. Build v2 (изменить hardcoded string видный в UI), deploy. Сделать SPA-navigation (клик по ссылке внутри сайта). Новая версия активна без modal banner. Console: `[SW] activated v=<v2-hash>`.

- **AC-5**: API **НЕ** кешируется SW. Verify: DevTools → Network вкладка после клика по странице. Все запросы к `https://api.sokratai.ru/*` показывают `(network)` в столбце Initiator/Source, **никогда** `(ServiceWorker)`.

- **AC-6**: Bypass list содержит `api.sokratai.ru`. Verify: grep в коде SW на `api.sokratai.ru` находит явное упоминание в bypass-условии.

- **AC-7**: Push notifications работают: tutor получает push на mobile при сдаче ДЗ ученика. Verify: manual test: subscribe как tutor → trigger push from psql / second device → notification appears на iPhone/Android.

- **AC-8**: Kill-switch `?sw=off` работает. Verify: открыть `sokratai.ru?sw=off` → DevTools → Application → Service Workers пуст, Caches пуст, URL после reload = `sokratai.ru` (без query параметра). Открыть `sokratai.ru` снова — SW регистрируется (не sticky).

- **AC-9**: Offline degradation. Verify: открыть `sokratai.ru`, dev tools → Application → Offline. Перезагрузить — cached index.html отображается, JS/CSS из cache, UI работает на existing data, API endpoints показывают graceful error (не белый экран).

- **AC-10**: Build не увеличился значительно. Verify: `npm run build` до и после — bundle size diff < 5%. (Логика SW большей частью уже в репо, добавляется только whitelist + kill-switch.)

### Связь с pilot KPI (из doc 18)

- **Adoption** (week 1): pilot tutors открывают sokratai.ru ≥ 5 раз за неделю — текущая метрика. Не должна снизиться (no regression).
- **Speed satisfaction** (qualitative, week 2): прямой вопрос Egor'у на еженедельном созвоне — «как быстро открывается приложение?». Цель: «быстро / не замечаю».
- **Push engagement** (week 3-4): процент push-уведомлений → клик в течение 30 минут. Цель: > 30%.

### Smoke check

```bash
npm run lint && npm run build && npm run smoke-check
```

Дополнительно:

```bash
# Lighthouse audit в CI
npx lighthouse https://sokratai.ru --only-categories=performance,pwa --output=json --output-path=./lighthouse-report.json
# Парсим: performance.score >= 0.9, pwa.score >= 0.8
```

### Rollback plan

См. секцию «10. Rollback plan» (стандарт нашего pipeline).

---

## 8. Risks & Open Questions

### Risks

| Риск | Вероятность | Митигация |
|---|---|---|
| SW случайно закеширует API ответ → утечка данных одного пользователя другому | Низкая (если bypass-list корректный) | AC-5 + AC-6 явно проверяют. Code review проверяет grep на API URL в cache logic. Smoke check включает manual проверку Network tab |
| Update flow `skipWaiting()` ломает активную сессию (например, форма заполняется → reload теряет данные) | Средняя | По дефолту НЕ делаем `clients.claim()` immediate, только на следующей navigation. Активная вкладка завершает текущую задачу на старой версии, обновится на следующем navigate |
| Stale SW залипает в кеше у пользователя, новые deploy не доходят | Средняя | Kill-switch `?sw=off` (P0) для ручного фикса. Version manifest с force-update (P1) для массового фикса |
| Регрессия на preview `sokratai.lovable.app` из-за изменения whitelist | Низкая | AC-2 явно проверяет. Whitelist становится `[lovable.app, ru]` — добавляет, не убирает |
| Push permission UX agressive, ученик закрывает запрос permission и не возвращается | Средняя | Используем существующий `<PushOptInBanner>` который показывается только в нужных местах (после первой задачи), не сразу на главной. Без изменений в этой фиче |
| Lighthouse PWA score не достигает 80 из-за недостающих PWA полей (manifest.json, иконки разных размеров) | Низкая | Это уже было в Lovable build (sokratai.lovable.app проходит). Не делаем регрессию |

### Decisions (закрыто 2026-05-03 Vladimir × Claude Cowork)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Push в P0** (Variant A): SW активирует push сразу, существующий `<PushOptInBanner>` начинает работать на проде без изменений | Инфраструктура push (VAPID, edge function, table) уже готова. Грех не активировать. Если UX opt-in не понравится — переделаем отдельной задачей |
| D2 | **Update flow: hybrid** — seamless auto-activate для рутинных deploy + force-reload banner ТОЛЬКО при `minSupportedVersion` mismatch (P1 task) | Лучшее из двух: 99% deploy без UX disruption, но есть emergency mechanism для критичных багов |
| D3 | **SW code location**: обнаружится в TASK-2 (Claude Code прочитает код). Используем escape команды `ls public/`, `grep -l 'addEventListener.*install'` для локализации файла | Экономит время на этапе планирования, не блокирует старт |
| D4 | **Lighthouse как soft target** для P0 (метрика отслеживается, не блокирует merge). Hard-gate отдельной performance-audit задачей | Не зависаем на performance-tuning не связанном с SW. Целевые: P>=90, PWA>=80, но если 85/75 — мерджим, исправляем follow-up |
| D5 | **Console-логи в production** на SW lifecycle (install/activate/cache-miss/fetch-fail) | Полезно для дебага без deploy, шум минимальный (~5-10 строк за визит). Можно отключить в P1 если будут жалобы |
| D6 | **Push opt-in banner** оставляем как есть в текущем коде, не трогаем UX в этой задаче | Push-ux — отдельная фича, не путаем |
| D7 | **`www.sokratai.ru`** — TASK-1 проверит наличие редиректа на apex, если редирект есть — добавить только `sokratai.ru` в whitelist; если нет — оба | Обнаружится при чтении nginx config / DNS |

### Branching strategy (D8 — закрыто 2026-05-03)

- Сначала: cherry-pick `dc39116` (signed URL fix) на `main` + merge docs commit
- Затем: создать `feat/service-worker-prod` от обновлённого main
- Implementation → PR → ChatGPT-5.5 review → merge → `deploy-sokratai`

См. секцию «Branch sync prep» в `tasks.md`.

---

## 9. Implementation Tasks

> Переносятся в `service-worker-prod-tasks.md` после approve спека.

### P0 (Must-Have)

- [ ] **TASK-1**: Whitelist `sokratai.ru` в `src/registerServiceWorker.ts` (5-10 min)
- [ ] **TASK-2**: Аудит cache strategies в SW коде, добавить `api.sokratai.ru` в bypass-list (30-60 min)
- [ ] **TASK-3**: Реализовать `?sw=off` kill-switch (30-45 min) — новый файл `src/lib/swKillSwitch.ts`, integration в entry point
- [ ] **TASK-4**: Verify push notifications работают end-to-end (15 min smoke test)
- [ ] **TASK-5**: Update CLAUDE.md `# Network & Infrastructure` — убрать упоминание что push не работает на sokratai.ru (5 min)

### P1 (Fast Follow-Up)

- [ ] **TASK-6**: Vite plugin для `dist/version.json` + build version constant (1 hour)
- [ ] **TASK-7**: `src/lib/versionCheck.ts` + force-reload banner UI (1 hour)

### Validation

- [ ] **TASK-8**: Manual test cases TC1-TC10 в Chrome desktop + Safari iOS + Chrome Android (30-60 min)
- [ ] **TASK-9**: Lighthouse audit + screenshots в Spec history (15 min)
- [ ] **TASK-10**: ChatGPT-5.5 review + iteration if needed (30 min)

---

## 10. Rollback plan

### Если SW сломал прод после `deploy-sokratai`

**Step 1 — Запросить пользователей через `?sw=off`** (если только некоторые пользователи столкнулись):

> В Telegram-чате репетиторов: «Откройте `https://sokratai.ru/?sw=off` — это сбросит кеш».

**Step 2 — Отключить SW глобально**:

```bash
ssh -i "$HOME\.ssh\sokratai_proxy" root@185.161.65.182
cd /opt/sokratai
git revert <bad-commit>
deploy-sokratai
```

После revert'а `registerServiceWorker.ts` вернётся к whitelist'у только `sokratai.lovable.app`. Все клиенты на следующем визите увидят новую версию (без SW логики), и существующие SW сами unregister'ятся (per existing logic).

**Step 3 — Force-update через kill-switch (P1)**:

Если P1 реализован: bump `minSupportedVersion` в `vite.config.ts` plugin до текущей версии. Все старые клиенты получат принудительный reload.

---

## 11. Parking Lot

Идеи, всплывшие при написании спеки, но не входящие в scope v1:

- **PWA install prompt** — кастомный banner «Установите SokratAI на главный экран» с brand styling. Revisit: после того как push заработает и репетиторы привыкнут к веб-приложению как «отдельному инструменту».
- **Offline read-only для homework** — кешировать просмотренные ДЗ + сохранять draft ответы локально, синхронизировать при возврате online. Revisit: если signal от учеников «хочу решать в самолёте/метро».
- **Workbox миграция** — переехать с vanilla SW на Workbox для сложных стратегий (queue + retry, expiration). Revisit: если кастомная логика SW станет слишком сложной для поддержки (порог: > 200 LOC).
- **Sentry / error reporting для SW** — отслеживание SW-ошибок в production. Revisit: после первого incident'а где SW упал и мы об этом узнали поздно.
- **Background Sync для отправки ответов AI** — если ученик отправляет ответ при flaky connection, SW пытается доставить позже. Revisit: если signal от учеников «не отправляется ответ».
- **Network-aware loading** — на slow 3G грузить меньшие чанки (less code splitting), на fast Wi-Fi — больше параллельных prefetch'ей. Revisit: после P1 monitoring покажет распределение connection types.

---

## Checklist перед approve

- [ ] Job Context заполнен (секция 0) — R1, R1-3 для tutor; S2, S2-1, S2-3 для student
- [ ] Привязка к Core Job из Графа работ — R1 (проверка ДЗ) + S2 (мобильная работа)
- [ ] Scope чётко определён (in/out/parking) — P0/P1 split явный
- [ ] UX-принципы из doc 16 учтены — P1 (мгновенный отклик), P3 (не ломать работу), P5 (прозрачные состояния)
- [ ] UI-паттерны из doc 17 учтены — без новых компонентов для P0
- [ ] Pilot impact описан — снимает 2 трения пилота (скорость + push)
- [ ] Метрики успеха определены — TTI, Lighthouse, push engagement
- [ ] High-risk файлы не затрагиваются без необходимости — `AuthGuard.tsx`, `TutorGuard.tsx`, `Chat.tsx` НЕ модифицируются
- [ ] Student/Tutor изоляция не нарушена — SW общий для всех routes, изоляция на уровне routing/auth
- [ ] Phase split: фича укладывается в одну фазу (P0 + P1 fast follow-up). Не нужно разбивать на multi-phase
- [ ] AC всех 10 — testable, с конкретными командами/действиями
- [ ] Open Questions — ни один не blocking, можно начинать implementation

---

## Reviewer checklist (для ChatGPT-5.5)

> Для **независимого ревью** после реализации Claude Code.

Reviewer (ChatGPT-5.5) должен пройти весь контекст ЧИСТО, без знаний из этой spec:

1. Прочитать `docs/discovery/product/tutor-ai-agents/14-ajtbd-product-prd-sokrat.md` — понять Job Graph
2. Прочитать `docs/discovery/product/tutor-ai-agents/16-ux-principles-for-tutor-product-sokrat.md`
3. Прочитать `docs/discovery/product/tutor-ai-agents/17-ui-patterns-and-component-rules-sokrat.md`
4. Прочитать `CLAUDE.md` `# Network & Infrastructure` (Phase B context)
5. Прочитать `.claude/rules/70-notifications.md` (push infra)
6. Прочитать эту спеку
7. Посмотреть `git diff main..feature/service-worker-prod`

**Вопросы reviewer'а должны проверить**:

- [ ] Изменение в `registerServiceWorker.ts` минимальное (добавлена строка в whitelist), не задевает другие условия?
- [ ] Cache strategies в SW соответствуют §5 (особенно: API не кешируется)?
- [ ] Bypass list содержит `api.sokratai.ru` — это **новое** требование, его раньше не было?
- [ ] Kill-switch `?sw=off` корректно unregister'ит SW + чистит caches + reload без параметра?
- [ ] Update flow в коде — НЕТ modal banner для рутинных обновлений (только через `minSupportedVersion` mismatch если P1 реализован)?
- [ ] Высокорисковые файлы (`AuthGuard.tsx`, `TutorGuard.tsx`, `Chat.tsx`) **не** модифицированы?
- [ ] Comment в коде объясняет почему whitelist добавлен (с ссылкой на CLAUDE.md `# Network & Infrastructure`)?
- [ ] Все async операции в kill-switch имеют try/catch fallback (если unregister упадёт, всё равно reload)?
- [ ] Push permission request flow не изменился (uses existing `pushApi.ts`)?
- [ ] Build size не увеличился значительно (KB diff < 5%)?
- [ ] No new dependencies в `package.json` (используем vanilla SW API)?

**Формат ответа reviewer'а** (из playbook):

- **PASS** — готово к merge
- **CONDITIONAL PASS** — merge можно после исправления N конкретных пунктов (перечислены)
- **FAIL** — требуется существенная доработка (перечислены принципиальные проблемы)

---

## 12. Ссылки и зависимости

### Документы

- CLAUDE.md → `# Network & Infrastructure` (Phase B migration)
- `.claude/rules/70-notifications.md` (push инфраструктура — Phase 1.1, 1.2, 1.3)
- `.claude/rules/95-production-deploy.md` (deploy procedure для P0 changes)
- `docs/discovery/product/tutor-ai-agents/16-...` (UX principles)
- `docs/discovery/product/tutor-ai-agents/17-...` (UI patterns)
- `docs/discovery/product/tutor-ai-agents/19-...` (Agent Workflow — структура промптов)

### Код — read first

1. `src/registerServiceWorker.ts` — текущая логика (whitelist, unregister-flow)
2. `public/service-worker.js` или `src/sw.ts` — собственно SW (надо найти где живёт)
3. `vite.config.ts` — для P1 task (version manifest plugin)
4. `src/components/PushOptInBanner.tsx` — UI для push opt-in (контекст)
5. `src/lib/pushApi.ts` — push subscription API (`isPushSupported()`, `subscribeToPush()`, etc.)

### Не трогать

- High-risk файлы из `.claude/rules/10-safe-change-policy.md`: `AuthGuard.tsx`, `TutorGuard.tsx`, `Chat.tsx` — **под любыми предлогами**
- `supabase/functions/_shared/proxy-url.ts` — был добавлен в commit dc39116 для signed URL fix, не связан с SW
- Push delivery cascade в `homework-api/handleNotifyStudents` — не модифицировать, только верификация

### Что новое создаётся

- `src/lib/swKillSwitch.ts` — Task 3 (P0)
- `src/lib/versionCheck.ts` — Task 7 (P1, опционально)
- `vite.config.ts` обновляется — Task 6 (P1, опционально)
- `docs/delivery/features/service-worker-prod/tasks.md` — после approve спеки (Step 5 pipeline)

---

## Appendix A: Полезные команды

```bash
# Локальный preview build (для тестирования SW локально без deploy)
npm run build
npm install -g serve
serve -s dist -l 3000

# Lighthouse audit
npm install -g lighthouse
lighthouse https://sokratai.ru --view --preset=desktop

# Проверить registered SW из Console
navigator.serviceWorker.getRegistrations().then(r => console.log(r))

# Проверить версию текущего SW
navigator.serviceWorker.controller?.scriptURL

# Force unregister SW в Chrome для отладки
# DevTools → Application → Service Workers → Unregister

# Build version (после P1 task)
fetch('/version.json').then(r => r.json()).then(console.log)
```

---

*История изменений:*

- v0.1 (2026-05-03): начальная версия spec, авторизована Vladimir × Claude (Cowork)
