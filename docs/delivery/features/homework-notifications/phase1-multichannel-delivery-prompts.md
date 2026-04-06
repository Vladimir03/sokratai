# Промпты для реализации: Phase 1 — Web Push + каскадная доставка ДЗ

**Spec:** `docs/features/specs/phase1-multichannel-delivery-spec.md`
**PRD:** `docs/features/specs/homework-multichannel-delivery-prd.md`
**Паттерн:** Тип A — новая фича (doc 20, Паттерн 1)
**Дата:** 2026-03-27

---

## Оглавление

1. [Phase 1.1 — Claude Code: Push-инфраструктура](#phase-1-1)
2. [Phase 1.1 — Codex Review](#phase-1-1-review)
3. [Phase 1.2 — Claude Code: Email-инфраструктура](#phase-1-2)
4. [Phase 1.2 — Codex Review](#phase-1-2-review)
5. [Phase 1.3 — Claude Code: Каскадная логика доставки](#phase-1-3)
6. [Phase 1.3 — Codex Review](#phase-1-3-review)
7. [Phase 1.4 — Codex: Финальный e2e review](#phase-1-4-review)
8. [Мини-чеклист перед запуском](#checklist)

---

<a id="phase-1-1"></a>
## Phase 1.1 — Claude Code: Push-инфраструктура

```text
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Нужно реализовать Phase 1.1: push-подписки (Web Push API) + PushOptInBanner для ученика.

Контекст проблемы:
- Telegram заблокирован в России с февраля 2026 (~80-90% недоступен без VPN).
- Единственный канал доставки ДЗ — Telegram-бот. Ученик без VPN не получает уведомлений.
- Phase 0 (DONE) решила регистрацию (email-first). Phase 1 решает доставку уведомлений.
- Phase 1.1 = инфраструктура push: таблица, edge function, service worker, frontend API, opt-in баннер.

Контекст продукта:
- Сегмент: репетиторы по физике ЕГЭ/ОГЭ
- Wedge: быстро собрать ДЗ и новую практику по теме урока
- Пользователи: школьники 14-18 лет, iPhone + Safari, Android + Chrome
- Job усиливаемый: J3 «Назначить → проверить → вернуть результат» — push обеспечивает delivery
- AI = draft + action, а не chat-only output

Сначала обязательно прочитай:
1. docs/features/specs/phase1-multichannel-delivery-spec.md (P0-1: Push-подписка, P0-2: Push opt-in баннер)
2. docs/features/specs/homework-multichannel-delivery-prd.md (Phase 1 requirements)
3. CLAUDE.md (секции: кросс-браузерная совместимость, preview parity, performance, service worker)
4. public/service-worker.js (текущая реализация — только кеширование, нет push handlers)
5. src/registerServiceWorker.ts (SW регистрируется ТОЛЬКО на prod domain)
6. src/pages/StudentHomework.tsx (точка монтирования PushOptInBanner)

Задачи Phase 1.1:

Задача 1.1.1: Миграция push_subscriptions
- Создать файл supabase/migrations/XXXXXXXX_push_subscriptions.sql
- Таблица push_subscriptions: id (UUID PK), user_id (FK auth.users), endpoint (TEXT NOT NULL), p256dh (TEXT NOT NULL), auth (TEXT NOT NULL), user_agent (TEXT), created_at, expires_at
- UNIQUE(user_id, endpoint) — идемпотентность
- RLS: SELECT/INSERT/DELETE WHERE user_id = auth.uid()
- Index на user_id для быстрого lookup при каскаде

Задача 1.1.2: Edge function push-subscribe
- Создать supabase/functions/push-subscribe/index.ts
- POST: сохранить subscription (JWT auth). Body: { endpoint, keys: { p256dh, auth }, user_agent?, expires_at? }
- ON CONFLICT (user_id, endpoint) DO UPDATE — перезаписать keys если обновились
- DELETE: удалить subscription по endpoint (JWT auth). Body: { endpoint }
- CORS headers как в других edge functions

Задача 1.1.3: Service Worker push handlers
- В public/service-worker.js добавить:
  - self.addEventListener('push', ...) — показать notification
  - self.addEventListener('notificationclick', ...) — открыть deep link из data.url
- Push payload (JSON): { title, body, url, icon, badge }
- notificationclick: clients.openWindow(data.url) или focus existing tab
- НЕ ломать существующие handlers (install, activate, fetch, message)

Задача 1.1.4: Frontend API — pushApi.ts
- Создать src/lib/pushApi.ts
- isPushSupported(): boolean — 'PushManager' in window && 'serviceWorker' in navigator
- getPushPermissionState(): 'granted' | 'denied' | 'default' — Notification.permission
- subscribeToPush(): requestPermission → PushManager.subscribe({ applicationServerKey: VAPID_PUBLIC_KEY }) → POST push-subscribe
- unsubscribeFromPush(): PushSubscription.unsubscribe() → DELETE push-subscribe
- VAPID_PUBLIC_KEY из import.meta.env.VITE_VAPID_PUBLIC_KEY
- applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) — стандартная конвертация

Задача 1.1.5: PushOptInBanner.tsx
- Создать src/components/PushOptInBanner.tsx
- Показывать, если: isPushSupported() && Notification.permission === 'default' && !dismissed < 7 дней
- НЕ показывать, если: permission === 'granted' ИЛИ 'denied' ИЛИ dismissed < 7 дней ИЛИ !isPushSupported()
- Layout: sticky top banner, amber accent (#E8913A), текст «Включите уведомления, чтобы не пропустить ДЗ» + кнопка «Включить» + кнопка «✕»
- При клике «Включить» → subscribeToPush() → баннер скрывается
- При клике «✕» → localStorage.setItem('push_banner_dismissed', Date.now().toString()) → скрыть
- Re-show: dismissed > 7 дней && permission === 'default'
- Монтировать в StudentHomework.tsx — вверху, перед списком ДЗ

Задача 1.1.6: push-sender.ts (shared util для edge functions)
- Создать supabase/functions/_shared/push-sender.ts
- Raw VAPID signing через crypto.subtle (НЕ npm web-push — не совместим с Deno)
- JWT: { aud: push endpoint origin, exp: now+12h, sub: VAPID_SUBJECT } → ECDSA P-256 sign
- Payload encryption: ECDH key agreement (P-256) + HKDF + AES-128-GCM (RFC 8291)
- sendPushNotification(subscription, payload): fetch POST to endpoint с headers
- Возвращает: { success: boolean, status: number, gone: boolean } — gone=true при 410
- Env vars: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
- Reference patterns: webpush-webcrypto, Cloudflare Workers web push examples

КРИТИЧНО (из CLAUDE.md):
- font-size ≥ 16px на ВСЕХ input в баннере (iOS Safari zoom prevention)
- touch-action: manipulation на кнопках баннера
- НЕ использовать framer-motion — CSS transitions для appearance/disappearance
- НЕ использовать crypto.randomUUID() (Safari < 15.4)
- Structural breakpoints: md: для layout, НЕ sm:
- Service Worker push handlers: только на prod domain (registerServiceWorker.ts контролирует)
- НЕ добавлять npm-зависимости (raw crypto.subtle)
- React Query key convention: ['student', 'push', ...] для student-side queries

Что НЕ делать:
- Не менять handleNotifyStudents (Phase 1.3)
- Не менять homework-reminder cron (Phase 1.3)
- Не создавать email templates (Phase 1.2)
- Не менять DeliveryBadge (Phase 1.3)
- Не менять AuthGuard/TutorGuard
- Не менять telegram-bot/index.ts
- Не добавлять push для репетиторов (P2)

После реализации:
1. npm run lint
2. npm run build
3. npm run smoke-check

В конце обязательно:
1. Перечисли changed files
2. Дай краткий summary реализации
3. Покажи validation results
4. Напиши, какие документы нужно обновить после этой реализации

Проверь минимум:
- нужно ли обновить docs/features/specs/phase1-multichannel-delivery-spec.md
- нужно ли обновить CLAUDE.md (секция service worker, новые файлы)
- нужно ли обновить docs/features/specs/homework-multichannel-delivery-prd.md

Self-check:
- push_subscriptions таблица с RLS?
- push-subscribe edge function (POST + DELETE)?
- service-worker.js: push + notificationclick handlers?
- pushApi.ts: subscribe/unsubscribe/isPushSupported?
- PushOptInBanner: показывается при permission='default', не при 'granted'/'denied'?
- push-sender.ts: raw crypto.subtle, не npm web-push?
- font-size ≥ 16px на input? touch-action: manipulation?
- Нет framer-motion?
```

---

<a id="phase-1-1-review"></a>
## Phase 1.1 — Codex Review

```text
Сделай code review реализации Phase 1.1: Push-инфраструктура.

Контекст:
- Telegram заблокирован в России, ученики не получают уведомления о ДЗ.
- Phase 1.1 = push_subscriptions таблица, push-subscribe edge function, service worker push handlers, pushApi.ts, PushOptInBanner, push-sender.ts.

Сначала прочитай:
1. docs/features/specs/phase1-multichannel-delivery-spec.md (P0-1, P0-2)
2. docs/features/specs/homework-multichannel-delivery-prd.md (Phase 1)
3. CLAUDE.md (кросс-браузерная совместимость, service worker, performance)
4. docs/product/specs/tutor_ai_agents/16-ux-principles-for-tutor-product-sokrat.md
5. docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules-sokrat.md

Проверь новые файлы:
- supabase/migrations/*_push_subscriptions.sql
- supabase/functions/push-subscribe/index.ts
- supabase/functions/_shared/push-sender.ts
- src/lib/pushApi.ts
- src/components/PushOptInBanner.tsx

Проверь изменённые файлы:
- public/service-worker.js (push + notificationclick handlers)
- src/pages/StudentHomework.tsx (монтирование PushOptInBanner)

Проверь:

1. БД и миграция:
   - push_subscriptions: UNIQUE(user_id, endpoint)?
   - RLS: user видит/удаляет только свои подписки?
   - FK к auth.users с ON DELETE CASCADE?
   - Index на user_id?

2. Edge function push-subscribe:
   - POST: JWT auth → сохранить subscription → ON CONFLICT DO UPDATE?
   - DELETE: JWT auth → удалить по endpoint?
   - CORS headers?
   - Валидация: endpoint обязателен, p256dh обязателен, auth обязателен?
   - Нет SQL injection (параметризованные запросы)?

3. push-sender.ts:
   - Raw crypto.subtle (НЕ npm web-push)?
   - JWT signing: ECDSA P-256?
   - Payload encryption: ECDH + HKDF + AES-128-GCM (RFC 8291)?
   - Обработка 410 Gone → { gone: true }?
   - Обработка 5xx → { success: false }?
   - VAPID_SUBJECT = mailto:support@sokratai.ru?
   - Нет node:http / node:https (не работает в Deno)?

4. Service Worker:
   - push event: парсит JSON payload, показывает notification?
   - notificationclick: открывает data.url через clients.openWindow?
   - Не сломаны существующие handlers (install, activate, fetch)?
   - Нет push на preview/localhost (контролируется registerServiceWorker.ts)?

5. pushApi.ts:
   - isPushSupported(): проверяет PushManager + serviceWorker?
   - subscribeToPush(): requestPermission → PushManager.subscribe → POST backend?
   - applicationServerKey: urlBase64ToUint8Array корректная?
   - VAPID_PUBLIC_KEY из import.meta.env?
   - Нет crypto.randomUUID()?

6. PushOptInBanner:
   - Логика показа: isPushSupported() && permission === 'default' && !dismissed?
   - Re-show через 7 дней?
   - Нет framer-motion?
   - font-size ≥ 16px на interactive elements?
   - touch-action: manipulation?
   - Structural breakpoint: md: не sm:?
   - CSS transition для appearance (не framer-motion)?
   - localStorage (не sessionStorage)?

7. Не сломано:
   - handleNotifyStudents не тронут?
   - homework-reminder не тронут?
   - AuthGuard/TutorGuard не тронуты?
   - telegram-bot не тронут?
   - Существующий SW кеширование работает?

8. Безопасность:
   - VAPID_PRIVATE_KEY не на фронтенде?
   - Push subscription привязана к user_id через JWT?
   - Нет XSS в notification payload?

Формат ответа:
- Executive summary
- Must fix
- Should fix
- Nice to have
- Architecture/security risks
- Docs that may need update
```

---

<a id="phase-1-2"></a>
## Phase 1.2 — Claude Code: Email-инфраструктура

```text
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Нужно реализовать Phase 1.2: Email-шаблоны для уведомлений о ДЗ через Lovable Custom Emails.

Контекст проблемы:
- Каскад доставки ДЗ: Push → Telegram → Email. Phase 1.1 (DONE) реализовала push.
- Phase 1.2 = email как fallback канал: шаблоны + интеграция с send-transactional-email.
- Домен sokratai.ru настроен и верифицирован в Lovable Custom Emails (зелёная точка ✅).
- send-transactional-email edge function создаётся Lovable автоматически при настройке домена.
- Шаблоны = React Email компоненты в _shared/transactional-email-templates/.

Контекст продукта:
- Сегмент: репетиторы по физике ЕГЭ/ОГЭ
- Wedge: быстро собрать ДЗ и новую практику по теме урока
- Job: J3 «Назначить → проверить → вернуть результат» — email гарантирует delivery на 100% устройств
- AI = draft + action, а не chat-only output

Сначала обязательно прочитай:
1. docs/features/specs/phase1-multichannel-delivery-spec.md (P0-3: Lovable Custom Emails)
2. CLAUDE.md (секции: YooKassa — пример другой edge function)
3. supabase/functions/_shared/ — посмотри структуру, есть ли уже transactional-email-templates/
4. supabase/functions/homework-api/index.ts — строки 1222-1451 (handleNotifyStudents — формат данных для шаблона)

Задачи Phase 1.2:

Задача 1.2.1: Email-шаблон уведомления о ДЗ
- Создать supabase/functions/_shared/transactional-email-templates/homework-notification.tsx
- React Email компонент (inline styles — требование Lovable)
- Данные шаблона (props):
  - tutorName: string — имя репетитора
  - assignmentTitle: string — название ДЗ (topic или title)
  - subject: string — предмет (физика, математика)
  - deadline: string | null — дедлайн (форматированная дата)
  - homeworkUrl: string — deep link на ДЗ
- Layout:
  - Header: «Новое домашнее задание»
  - Body: «{tutorName} назначил вам задание по {subject}: {assignmentTitle}»
  - Если deadline: «Срок сдачи: {deadline}»
  - CTA-кнопка: «Открыть задание» → homeworkUrl
  - Footer: «Сократ — AI-помощник для подготовки к ЕГЭ и ОГЭ»
  - Unsubscribe ссылка (обязательна по CAN-SPAM / Lovable)
- Plain text fallback (React Email генерирует автоматически)

Задача 1.2.2: Email-шаблон напоминания о дедлайне
- Создать supabase/functions/_shared/transactional-email-templates/homework-reminder.tsx
- Props:
  - studentName: string
  - assignmentTitle: string
  - subject: string
  - deadline: string
  - timeLeft: '24h' | '1h' — сколько осталось
  - homeworkUrl: string
- Layout:
  - Header: «Напоминание о домашнем задании»
  - Body (24h): «До дедлайна осталось 24 часа. Задание: {assignmentTitle} по {subject}»
  - Body (1h): «До дедлайна остался 1 час! Задание: {assignmentTitle} по {subject}»
  - CTA-кнопка: «Сдать задание» → homeworkUrl
  - Footer + Unsubscribe

Задача 1.2.3: Shared email sender utility
- Создать supabase/functions/_shared/email-sender.ts
- sendHomeworkNotificationEmail(to, data): вызвать send-transactional-email с шаблоном homework-notification
- sendHomeworkReminderEmail(to, data): вызвать send-transactional-email с шаблоном homework-reminder
- Обработка ошибок: 429 rate limit, 400 bad request, 500 server error
- Возвращает: { success: boolean, error?: string }
- Sender: noreply@notify.sokratai.ru (или как настроен домен)

КРИТИЧНО:
- Следуй Lovable Custom Emails паттерну (React Email + inline styles)
- Не трогай send-transactional-email — это Lovable auto-generated function
- Email в @temp.sokratai.ru — исключать (это placeholder для telegram-only учеников)
- Не запускай send-transactional-email без Lovable — функция генерируется при deploy

Что НЕ делать:
- Не менять handleNotifyStudents (Phase 1.3)
- Не менять homework-reminder cron (Phase 1.3)
- Не менять push-subscribe или push-sender (Phase 1.1 done)
- Не менять DeliveryBadge (Phase 1.3)
- Не добавлять email preferences / unsubscribe logic в БД (P2)
- Не менять auth email templates (это другая система)

После реализации:
1. npm run lint
2. npm run build
3. npm run smoke-check

В конце обязательно:
1. Перечисли changed files
2. Дай краткий summary реализации
3. Покажи validation results
4. Напиши, какие документы нужно обновить

Self-check:
- homework-notification.tsx: рендерится с tutorName, assignmentTitle, subject, deadline, homeworkUrl?
- homework-reminder.tsx: рендерится с timeLeft='24h' и '1h'?
- email-sender.ts: обёртка над send-transactional-email?
- Unsubscribe footer есть в обоих шаблонах?
- temp.sokratai.ru emails исключены из отправки?
```

---

<a id="phase-1-2-review"></a>
## Phase 1.2 — Codex Review

```text
Сделай code review реализации Phase 1.2: Email-инфраструктура.

Контекст:
- Email = fallback в каскаде Push → Telegram → Email.
- Phase 1.2 = email шаблоны (React Email) + email-sender.ts utility.
- Домен sokratai.ru верифицирован, send-transactional-email = Lovable auto-generated.

Сначала прочитай:
1. docs/features/specs/phase1-multichannel-delivery-spec.md (P0-3)
2. CLAUDE.md
3. docs/product/specs/tutor_ai_agents/16-ux-principles-for-tutor-product-sokrat.md

Проверь новые файлы:
- supabase/functions/_shared/transactional-email-templates/homework-notification.tsx
- supabase/functions/_shared/transactional-email-templates/homework-reminder.tsx
- supabase/functions/_shared/email-sender.ts

Проверь:

1. Шаблон homework-notification:
   - React Email компонент с inline styles?
   - Props: tutorName, assignmentTitle, subject, deadline?, homeworkUrl?
   - CTA-кнопка «Открыть задание» → homeworkUrl?
   - Unsubscribe footer?
   - Русский текст без ошибок?
   - Responsive (mobile email clients)?

2. Шаблон homework-reminder:
   - Props: timeLeft ('24h' | '1h'), assignmentTitle, subject, deadline, homeworkUrl?
   - Разные тексты для 24h и 1h?
   - CTA-кнопка «Сдать задание»?
   - Unsubscribe footer?

3. email-sender.ts:
   - Вызывает send-transactional-email корректно?
   - Обрабатывает ошибки (429, 400, 500)?
   - Не отправляет на @temp.sokratai.ru?
   - Возвращает { success, error? }?

4. Не сломано:
   - send-transactional-email не модифицирован?
   - handleNotifyStudents не тронут?
   - homework-reminder не тронут?

Формат ответа:
- Executive summary
- Must fix
- Should fix
- Nice to have
- Docs that may need update
```

---

<a id="phase-1-3"></a>
## Phase 1.3 — Claude Code: Каскадная логика доставки

```text
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Нужно реализовать Phase 1.3: каскадная логика доставки ДЗ (push → Telegram → email) + обновление cron-напоминаний + DeliveryBadge UI.

Контекст проблемы:
- Phase 1.1 (DONE) = push-инфраструктура, Phase 1.2 (DONE) = email-шаблоны.
- Сейчас handleNotifyStudents отправляет ТОЛЬКО через Telegram. homework-reminder — тоже.
- Phase 1.3 = собрать всё вместе: для каждого ученика выбрать лучший доступный канал.
- Приоритет: Push → Telegram → Email → failed_no_channel.

Контекст продукта:
- Сегмент: репетиторы по физике ЕГЭ/ОГЭ
- Wedge: быстро собрать ДЗ и новую практику по теме урока
- Job: J3 «Назначить → проверить → вернуть результат»
- AI = draft + action, а не chat-only output

Сначала обязательно прочитай:
1. docs/features/specs/phase1-multichannel-delivery-spec.md (P0-4, P0-5, P0-6: каскад, cron, UI)
2. CLAUDE.md (секции: система домашних заданий, delivery_status, homework-reminder)
3. supabase/functions/homework-api/index.ts — строки 1222-1451 (handleNotifyStudents — текущая Telegram-only логика)
4. supabase/functions/homework-reminder/index.ts (текущий cron)
5. src/lib/tutorHomeworkApi.ts (типы DeliveryStatus, NotifyStudentsResponse)
6. src/pages/tutor/TutorHomeworkDetail.tsx (DeliveryBadge компонент)
7. supabase/functions/_shared/push-sender.ts (из Phase 1.1)
8. supabase/functions/_shared/email-sender.ts (из Phase 1.2)

Задачи Phase 1.3:

Задача 1.3.1: Миграция — расширение delivery_status + delivery_channel
- Создать supabase/migrations/XXXXXXXX_delivery_multichannel.sql
- Расширить CHECK constraint на homework_tutor_student_assignments.delivery_status:
  - Сохранить legacy: 'pending', 'delivered', 'failed_not_connected', 'failed_blocked_or_other'
  - Добавить: 'delivered_push', 'delivered_telegram', 'delivered_email', 'failed_all_channels', 'failed_no_channel'
- Добавить колонку delivery_channel TEXT (nullable): 'push' | 'telegram' | 'email'
- Добавить колонку channel в homework_tutor_reminder_log (TEXT, nullable)

Задача 1.3.2: Рефакторинг handleNotifyStudents — каскадная логика
- В supabase/functions/homework-api/index.ts — рефакторинг handleNotifyStudents:
- Для каждого ученика из student_assignments WHERE notified = false:
  ① Проверить push_subscriptions → если есть → sendPushNotification (из push-sender.ts)
     - 201 OK → delivery_status='delivered_push', delivery_channel='push', DONE
     - 410 Gone → DELETE subscription → goto ②
     - 5xx → retry 1 раз → если failed → goto ②
  ② Проверить telegram_user_id (profiles + telegram_sessions, как сейчас)
     - Найден → sendTelegramMessage (существующая логика)
     - OK → delivery_status='delivered_telegram', delivery_channel='telegram', DONE
     - Failed → goto ③
  ③ Проверить profiles.email (NOT LIKE '%@temp.sokratai.ru')
     - Найден → sendHomeworkNotificationEmail (из email-sender.ts)
     - OK → delivery_status='delivered_email', delivery_channel='email', DONE
     - Failed → delivery_status='failed_all_channels'
  ④ Нет каналов → delivery_status='failed_no_channel'
- Обновить response: добавить sent_by_channel: { push, telegram, email }
- Идемпотентность: skip уже delivered студентов
- Backward compat: старые статусы 'delivered' продолжают работать

Задача 1.3.3: Обновить homework-reminder cron
- В supabase/functions/homework-reminder/index.ts:
- Тот же каскад: push → Telegram → email
- Для push: lookup push_subscriptions, send через push-sender.ts
- Для email: send через email-sender.ts (шаблон homework-reminder, timeLeft='24h'|'1h')
- Записывать channel в homework_tutor_reminder_log
- Идемпотентность через reminder_log (как сейчас)

Задача 1.3.4: Обновить типы в tutorHomeworkApi.ts
- Расширить DeliveryStatus type:
  'pending' | 'delivered' | 'delivered_push' | 'delivered_telegram' | 'delivered_email' | 'failed_not_connected' | 'failed_blocked_or_other' | 'failed_all_channels' | 'failed_no_channel'
- Обновить NotifyStudentsResponse: добавить sent_by_channel
- Добавить NotifyFailureReason: 'push_expired' | 'push_send_failed' | 'email_send_failed' | 'no_channels_available' | 'all_channels_failed' + legacy reasons

Задача 1.3.5: Обновить DeliveryBadge в TutorHomeworkDetail.tsx
- Новые бейджи:
  - delivered_push → 🔔 «Push» (green)
  - delivered_telegram → ✈️ «Telegram» (green)
  - delivered_email → 📧 «Email» (green)
  - failed_all_channels → ✗ «Все каналы failed» (red)
  - failed_no_channel → ❌ «Нет каналов» (red) + tooltip
  - delivered (legacy) → ✓ «Доставлено» (green) — backward compat
  - failed_not_connected (legacy) → сохранить как есть
  - failed_blocked_or_other (legacy) → сохранить как есть
- Компактные бейджи (inline badge, не ломает таблицу)
- Нет framer-motion

КРИТИЧНО:
- Не сломать существующий Telegram flow — каскад добавляет каналы, не убирает
- Telegram retry логика (2 retries, 500ms delay) — сохранить как есть
- Push retry: 1 retry при 5xx
- Email @temp.sokratai.ru — ВСЕГДА исключать из email канала
- Логирование каждого шага каскада (console.log с channel + student_id + result)
- homework-api index.ts — это 1450+ строк. Минимальные изменения, добавлять каскадную обёртку ВОКРУГ существующей Telegram-логики

Что НЕ делать:
- Не менять push-subscribe / push-sender / email templates (Phase 1.1-1.2 done)
- Не менять PushOptInBanner (Phase 1.1 done)
- Не менять AuthGuard/TutorGuard
- Не менять telegram-bot/index.ts
- Не добавлять notification preferences (P2)
- Не добавлять массовую отправку группе (Phase 2)
- Не расширять scope beyond wedge
- Не делать generic chat UX

После реализации:
1. npm run lint
2. npm run build
3. npm run smoke-check

В конце обязательно:
1. Перечисли changed files
2. Дай краткий summary реализации
3. Покажи validation results
4. Напиши, какие документы нужно обновить

Проверь минимум:
- нужно ли обновить docs/features/specs/phase1-multichannel-delivery-spec.md
- нужно ли обновить CLAUDE.md (delivery_status enum, новые файлы)
- нужно ли обновить docs/features/specs/homework-multichannel-delivery-prd.md
- нужно ли обновить docs/product/specs/tutor_ai_agents/15-backlog-of-jtbd-scenarios-sokrat.md

Self-check:
- Каскад: push → Telegram → email → failed_no_channel — корректный порядок?
- Push 410 Gone → удаляет subscription → cascade?
- Telegram retry 2x сохранён?
- Email @temp.sokratai.ru исключён?
- delivery_channel записывается?
- sent_by_channel в response?
- DeliveryBadge: все новые + legacy статусы?
- homework-reminder: тот же каскад?
- Идемпотентность: повторный notify → skip delivered?
```

---

<a id="phase-1-3-review"></a>
## Phase 1.3 — Codex Review

```text
Сделай code review реализации Phase 1.3: Каскадная логика доставки ДЗ.

Контекст:
- Push (Phase 1.1) + Email (Phase 1.2) готовы. Phase 1.3 собирает каскад.
- handleNotifyStudents: push → Telegram → email → failed_no_channel.
- homework-reminder: тот же каскад для 24h/1h напоминаний.
- DeliveryBadge: мультиканальные статусы.

Сначала прочитай:
1. docs/features/specs/phase1-multichannel-delivery-spec.md (P0-4, P0-5, P0-6)
2. docs/features/specs/homework-multichannel-delivery-prd.md
3. CLAUDE.md (homework system, delivery_status, кросс-браузерная совместимость)
4. docs/product/specs/tutor_ai_agents/16-ux-principles-for-tutor-product-sokrat.md
5. docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules-sokrat.md
6. docs/product/specs/tutor_ai_agents/19-agent-workflow-and-review-system-sokrat.md

Проверь файлы:
- supabase/migrations/*_delivery_multichannel.sql
- supabase/functions/homework-api/index.ts (handleNotifyStudents рефакторинг)
- supabase/functions/homework-reminder/index.ts (каскад в cron)
- src/lib/tutorHomeworkApi.ts (типы)
- src/pages/tutor/TutorHomeworkDetail.tsx (DeliveryBadge)

Проверь:

1. Миграция:
   - delivery_status CHECK constraint содержит ВСЕ значения (legacy + new)?
   - delivery_channel колонка nullable?
   - channel в reminder_log?
   - Backward compat: старые записи не сломаны?

2. Каскадная логика handleNotifyStudents:
   - Порядок: push → Telegram → email → failed?
   - Push: lookup push_subscriptions → sendPushNotification?
   - Push 410 → DELETE subscription → cascade?
   - Push 5xx → retry 1 → cascade?
   - Telegram: существующая логика сохранена (2 retries, 500ms)?
   - Email: через email-sender.ts → sendHomeworkNotificationEmail?
   - Email: фильтр @temp.sokratai.ru?
   - No channels → 'failed_no_channel'?
   - All failed → 'failed_all_channels'?
   - delivery_channel записывается корректно?
   - sent_by_channel в response?
   - Идемпотентность: skip delivered?
   - Нет дублирования: push sent → НЕ отправлять Telegram и email?

3. homework-reminder cron:
   - Тот же каскад что в handleNotifyStudents?
   - channel записывается в reminder_log?
   - Идемпотентность через reminder_log UNIQUE?
   - 30-мин окна для 24h и 1h сохранены?
   - Email template = homework-reminder (не notification)?

4. Типы:
   - DeliveryStatus содержит все значения?
   - NotifyStudentsResponse содержит sent_by_channel?
   - NotifyFailureReason содержит push/email reasons?
   - Backward compat: старые типы не удалены?

5. DeliveryBadge:
   - Все новые статусы имеют бейджи?
   - Legacy статусы сохранены?
   - Компактные (inline)?
   - Нет framer-motion?
   - Tooltip на failed_no_channel?
   - Иконки каналов: 🔔 push, ✈️ telegram, 📧 email?

6. Product drift:
   - Какой Job усиливает? J3 «Назначить → проверить → вернуть результат»
   - Усиливает ли wedge? Да — ученик получает ДЗ → решает → репетитор видит прогресс
   - Нет generic chat UX?
   - Нет scope creep?
   - Каскад работает автоматически — репетитору не нужно думать о каналах?

7. Не сломано:
   - Существующий Telegram flow работает как раньше?
   - telegram-bot/index.ts не тронут?
   - AuthGuard/TutorGuard не тронуты?
   - PushOptInBanner не тронут?
   - push-subscribe не тронут?

8. Архитектура:
   - homework-api index.ts: изменения минимальны (обёртка каскада)?
   - Student и Tutor модули изолированы?
   - React Query keys: ['tutor', ...] конвенция соблюдена?

Формат ответа:
- Executive summary
- Must fix
- Should fix
- Nice to have
- Product drift risks
- UX risks
- Architecture/state risks
- Docs that may need update
```

---

<a id="phase-1-4-review"></a>
## Phase 1.4 — Codex: Финальный e2e review

```text
Сделай финальный end-to-end code review всей Phase 1: Web Push + каскадная доставка ДЗ.

Контекст:
- Phase 1.1: push_subscriptions, push-subscribe, service worker, pushApi.ts, PushOptInBanner, push-sender.ts
- Phase 1.2: homework-notification.tsx, homework-reminder.tsx email templates, email-sender.ts
- Phase 1.3: каскад в handleNotifyStudents, каскад в homework-reminder, delivery_multichannel migration, DeliveryBadge обновление
- Goal: ≥95% учеников получают уведомление о ДЗ через хотя бы один канал

Сначала прочитай:
1. docs/features/specs/phase1-multichannel-delivery-spec.md (все requirements)
2. docs/features/specs/homework-multichannel-delivery-prd.md (Phase 1)
3. docs/product/research/ajtbd/08-wedge-decision-memo-sokrat.md
4. docs/product/specs/tutor_ai_agents/14-ajtbd-product-prd-sokrat.md
5. docs/product/specs/tutor_ai_agents/16-ux-principles-for-tutor-product-sokrat.md
6. docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules-sokrat.md
7. docs/product/specs/tutor_ai_agents/19-agent-workflow-and-review-system-sokrat.md
8. CLAUDE.md

Проверь ВСЕ новые и изменённые файлы Phase 1.

E2E проверка:

1. Happy path — ученик с push:
   - Ученик заходит → видит PushOptInBanner → клик «Включить» → subscribeToPush() → subscription в БД
   - Репетитор нажимает «Уведомить» → handleNotifyStudents → найдена push subscription → sendPushNotification
   - SW получает push event → показывает notification → клик → openWindow(/homework/:id)
   - delivery_status = 'delivered_push', delivery_channel = 'push'

2. Happy path — ученик без push, с Telegram:
   - Push subscription нет → cascade к Telegram → sendTelegramMessage → OK
   - delivery_status = 'delivered_telegram', delivery_channel = 'telegram'

3. Happy path — ученик без push, без Telegram, с email:
   - Push нет → Telegram нет → cascade к email → sendHomeworkNotificationEmail → OK
   - delivery_status = 'delivered_email', delivery_channel = 'email'

4. Edge case — expired push:
   - Push subscription → sendPush → 410 Gone → DELETE subscription → cascade к Telegram/email

5. Edge case — все каналы failed:
   - Push 5xx + retry failed → Telegram failed → email failed
   - delivery_status = 'failed_all_channels'

6. Edge case — нет каналов:
   - Нет push, нет telegram_user_id, email = @temp.sokratai.ru
   - delivery_status = 'failed_no_channel'

7. Reminder cron:
   - Тот же каскад для 24h/1h напоминаний
   - Идемпотентность через reminder_log

8. DeliveryBadge:
   - Все статусы рендерятся корректно
   - Legacy + new mixed (некоторые ученики delivered, некоторые delivered_push)

9. Кросс-браузерная совместимость:
   - Push: Chrome (Android/desktop), Firefox, Safari 16+ (macOS)
   - iOS Safari: push НЕ работает → email fallback
   - font-size ≥ 16px, touch-action: manipulation, нет framer-motion
   - Нет crypto.randomUUID, нет sessionStorage, нет RegExp lookbehind

10. Безопасность:
    - VAPID_PRIVATE_KEY только в edge function secrets?
    - Push subscription привязана к user_id через JWT?
    - RLS на push_subscriptions?
    - Email не уходит на @temp.sokratai.ru?
    - Нет XSS в push payload?

11. Performance:
    - PushOptInBanner: нет framer-motion, CSS transition?
    - pushApi.ts: нет тяжёлых зависимостей?
    - DeliveryBadge: нет framer-motion?
    - Lazy load где возможно?

12. Product alignment:
    - Усиливает Job J3?
    - Усиливает wedge?
    - Нет product drift?
    - Нет generic chat UX?
    - Каскад автоматический — репетитор не выбирает канал?
    - Clear primary CTA в баннере?
    - AI result переводится в действие?

Формат ответа:
- Executive summary
- Acceptance criteria status (per P0-1..P0-6)
- Must fix
- Should fix
- Nice to have
- Product drift risks
- UX risks
- Architecture/security risks
- Missing tests
- Docs that need update
- Ready for pilot? (yes/no + blockers)
```

---

<a id="checklist"></a>
## Мини-чеклист перед каждым запуском Phase 1

```text
□ Я понимаю тип задачи: Тип A — новая фича (каскадная доставка)
□ Job: J3 «Назначить → проверить → вернуть результат»
□ Wedge: быстро собрать ДЗ → ученик получает → решает → репетитор видит прогресс
□ Прочитаны canonical docs (spec + PRD + CLAUDE.md)?
□ Scope ограничен текущей Phase (1.1 / 1.2 / 1.3)?
□ Не расширяю scope beyond wedge?
□ Не делаю generic chat UX?
□ Не добавляю новые product decisions?
□ В конце запрошу: changed files + validation + docs-to-update?
```

### Acceptance criteria — сводный чеклист

#### Phase 1.1: Push-инфраструктура
- [ ] VAPID keys сгенерированы → Supabase secrets
- [ ] push_subscriptions таблица + RLS
- [ ] push-subscribe edge function (POST/DELETE)
- [ ] service-worker.js: push + notificationclick handlers
- [ ] pushApi.ts: subscribe/unsubscribe/isPushSupported
- [ ] PushOptInBanner: показ при permission='default', dismiss 7 дней
- [ ] push-sender.ts: raw crypto.subtle VAPID signing
- [ ] Работает: Chrome, Firefox, Safari 16+ (desktop)
- [ ] Нет push на preview/localhost

#### Phase 1.2: Email-инфраструктура
- [ ] homework-notification.tsx: React Email шаблон уведомления
- [ ] homework-reminder.tsx: React Email шаблон напоминания (24h + 1h)
- [ ] email-sender.ts: обёртка send-transactional-email
- [ ] Unsubscribe footer в обоих шаблонах
- [ ] Email приходит на Gmail/Mail.ru
- [ ] @temp.sokratai.ru исключён

#### Phase 1.3: Каскадная логика
- [ ] Миграция: delivery_status расширен + delivery_channel
- [ ] handleNotifyStudents: push → Telegram → email → failed
- [ ] Push 410 → удалить subscription → cascade
- [ ] Push 5xx → retry 1 → cascade
- [ ] Telegram retry 2x сохранён
- [ ] Email через send-transactional-email
- [ ] sent_by_channel в response
- [ ] homework-reminder: тот же каскад
- [ ] channel в reminder_log
- [ ] DeliveryBadge: 🔔 push, ✈️ telegram, 📧 email, ❌ no channel
- [ ] Legacy статусы backward compat
- [ ] Идемпотентность

#### Phase 1.4: QA
- [ ] Chrome Android: push → notification → click → open homework
- [ ] Chrome desktop: push → notification → click
- [ ] Safari macOS 16+: push работает
- [ ] iOS Safari: push НЕ работает → email fallback
- [ ] Firefox: push работает
- [ ] Email: приходит, CTA-ссылка открывает homework
- [ ] Telegram: существующий flow не сломан
- [ ] Expired push → cascade к следующему каналу
- [ ] Все каналы failed → 'failed_all_channels'
- [ ] Нет каналов → 'failed_no_channel'
- [ ] font-size ≥ 16px, touch-action: manipulation, нет framer-motion

#### Документы для обновления после Phase 1
- [ ] CLAUDE.md — push_subscriptions, delivery_status enum, новые файлы, push-sender.ts
- [ ] docs/features/specs/phase1-multichannel-delivery-spec.md — acceptance criteria [x]
- [ ] docs/features/specs/homework-multichannel-delivery-prd.md — Phase 1 status
- [ ] docs/product/specs/tutor_ai_agents/15-backlog-of-jtbd-scenarios-sokrat.md — если J3 flow изменился
