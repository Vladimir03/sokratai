# Notifications & Delivery

## Preview parity (КРИТИЧНО)

### Service Worker
- SW регистрируется на **всех** хостах из `PROD_HOSTS` (`src/registerServiceWorker.ts`): `sokratai.ru`, `www.sokratai.ru`, `sokratai.lovable.app`, `preview--sokratai.lovable.app`. ⚠️ **НЕ только `sokratai.lovable.app`** — после переезда прода на VPS (Phase B, rule 95) SW работает и на `sokratai.ru`. (Историческая заметка «только lovable» была устаревшей и однажды увела диагностику не туда.)
- На preview/dev/localhost (хост вне `PROD_HOSTS`) — принудительный `unregister()` + очистка `CacheStorage`. **Поэтому SW нельзя проверить на локальном dev-сервере** — только на prod/preview-хосте.
- Не менять логику allow-list в `src/registerServiceWorker.ts` без веской причины
- **fetch-handler багует под РФ-DPI** — если фича/чанк молча не грузится при корректных данных и коде, подозревай SW. Полный диагностический рецепт + инварианты: **rule 95 «Service Worker — битая загрузка модулей (octet-stream) под РФ-DPI»**.
- **Push handlers**: `push`, `notificationclick`, `pushsubscriptionchange` — в `public/service-worker.js`
- `notificationclick`: same-origin URL validation + exact-URL tab reuse
- `pushsubscriptionchange`: re-subscribe + `postMessage` → `listenForSubscriptionChanges()` → authenticated API call

## Web Push инфраструктура (Phase 1.1)
- **Таблица**: `push_subscriptions` (user_id, endpoint, p256dh, auth, user_agent, expires_at) — UNIQUE(user_id, endpoint), RLS, FK CASCADE
- **Edge function**: `supabase/functions/push-subscribe/index.ts` — POST (upsert) + DELETE (unsubscribe), JWT auth
- **Frontend API**: `src/lib/pushApi.ts` — `isPushSupported()` (prod-only!), `subscribeToPush()`, `unsubscribeFromPush()`
- **Opt-in надж**: `src/components/pwa/NotificationsNudge.tsx` (заменил удалённый `PushOptInBanner`) — умная кнопка push+установка PWA, смонтирована у ОБЕИХ ролей (чат/ДЗ/профиль/Главная тьютора), dismiss 14 дней. `isPushSupported` теперь на общем `PROD_HOSTS` (был мёртв на `sokratai.ru`). Детали — rule 100.
- **Push sender**: `supabase/functions/_shared/push-sender.ts` — raw `crypto.subtle` (RFC 8291 + RFC 8292), zero npm deps
- **Env vars**: `VITE_VAPID_PUBLIC_KEY` (frontend, НЕ задан → хардкод-fallback в `pushApi.ts`), `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` (edge secrets, пара 2026-07-13)
- **КРИТИЧНО**: `isPushSupported()` возвращает `false` на non-prod hosts

### Push заработал E2E только 2026-07-13 — пять слоёв багов + два крипто-бага (НЕ откатывать)

Web push НИКОГДА не работал end-to-end до 2026-07-13 (всё маскировалось telegram/email-fallback). Разбор — memory `project_tutor_student_chat_2026_07_12.md`. Что чинили и **что нельзя ломать**:
1. **`isPushSupported()` — на `PROD_HOSTS`** (был захардкожен `sokratai.lovable.app` → push мёртв на `sokratai.ru`).
2. **VAPID public — хардкод-fallback в `src/lib/pushApi.ts`** (`VITE_VAPID_PUBLIC_KEY` не задан нигде → undefined в бандле → «мёртвая кнопка»). Public key не секрет. **ОБЯЗАН совпадать с edge `VAPID_PUBLIC_KEY`** (пара с private). Смена ключа → синхронно фронт + оба edge-секрета.
3. **Таблица `push_subscriptions` НЕ существовала** (миграция `20260327120000` в репо, но не применена на проекте → `push-subscribe` падала 500 на upsert). Фикс — миграция `20260713100000` (идемпотентная). **Урок: миграция в репо ≠ применена; проверять `GET /rest/v1/<table>` → PGRST205 = нет таблицы.**
4. **`push-subscribe` не была задеплоена** (404) — задеплоена Lovable. Клиент шлёт её через `supabase.functions.invoke` (правильные заголовки); `ensurePushSubscriptionSaved()` в `main.tsx` self-heal'ит рассинхрон браузер↔сервер при старте.
5. **push-sender крипто — два латентных бага (никогда не исполнявшийся код):**
   - **`importVapidPrivateKey`/`createVapidJwt` требуют И приватный, И ПУБЛИЧНЫЙ VAPID-ключ** → импорт приватного через **JWK (d + x/y из публичного)**, НЕ через минимальный PKCS8. **Deno/ring принимает PKCS8 на `importKey`, но бросает `InvalidEncoding` на `sign`.** НЕ возвращать к PKCS8.
   - **ECDSA-`sign` отдаёт raw r||s (64 байта, P1363), НЕ DER.** `derToRaw` применять ТОЛЬКО при 0x30-маркере (защитный fallback); на raw-данных он ПОРТИТ подпись (был бы 403 FCM). Верификация фикса — Node sign+verify боевой парой.
- **Диагностика**: `POST /tutor-student-chat-api/push-test` (авторизованный, RO) — шлёт push себе, возвращает длины ключей + пошаговые статусы (`step_create_vapid_jwt`, `step_import_sub_pubkey`) + FCM-статус. Оставлен в проде для будущей отладки push.
- **Анти-спам (НЕ баг, спроектировано, rule 100)**: `/internal/notify` — 15-сек re-check (получатель прочитал вживую → молчим) + троттлинг 5 мин на получателя/беседу. Чистый тест push: получатель свёрнут + не открывать чат 15 сек + ≥5 мин от прошлого уведомления в этой беседе.

## Email-шаблоны для уведомлений о ДЗ (Phase 1.2)

Каскад доставки: Push → Telegram → Email. Phase 1.2 = шаблоны + утилита enqueue.

**Шаблоны** (plain TS, inline styles, zero npm deps):
- `supabase/functions/_shared/transactional-email-templates/homework-notification.ts`
- `supabase/functions/_shared/transactional-email-templates/homework-reminder.ts`

**Sender utility**: `supabase/functions/_shared/email-sender.ts`
- Flow: temp email guard → suppression check → unsubscribe token → render → enqueue
- Idempotency: `hw-notif-{assignmentId}-{to}` / `hw-remind-{assignmentId}-{to}-{timeLeft}`
- Sender: `Сократ <noreply@sokratai.ru>`, domain `sokratai.ru`
- **`@temp.sokratai.ru`** emails автоматически пропускаются

**Email queue** (уже работает):
- `process-email-queue` — читает из pgmq, отправляет через `@lovable.dev/email-js`
- `send-transactional-email` — Lovable auto-generated, **НЕ ТРОГАТЬ**

## Каскадная доставка уведомлений (Phase 1.3)

**Каскад для каждого ученика**: Push → Telegram → Email → `failed_no_channel`
- Push: retry 1x при 5xx, удаляет subscription при 410 Gone
- Telegram: retry 2x при 429/5xx с 500ms delay
- Email: через `sendHomeworkNotificationEmail` / `sendHomeworkReminderEmail`
- Нет каналов → `failed_no_channel`; все failed → granular reason

**delivery_status enum** (полный):
`'pending'` | `'delivered'` | `'delivered_push'` | `'delivered_telegram'` | `'delivered_email'` | `'failed_not_connected'` | `'failed_blocked_or_other'` | `'failed_all_channels'` | `'failed_no_channel'`

**delivery_channel**: `'push'` | `'telegram'` | `'email'` | `NULL` (legacy/pending)

**Ключевые файлы Phase 1.3:**
- `supabase/functions/homework-api/index.ts` — `handleNotifyStudents` с каскадом
- `supabase/functions/homework-reminder/index.ts` — cron с каскадом
- `src/pages/tutor/TutorHomeworkDetail.tsx` — `DeliveryBadge` (9 статусов)

**VAPID env vars** (Supabase Edge Function secrets):
- `VAPID_PUBLIC_KEY` — base64url
- `VAPID_PRIVATE_KEY` — base64url
- `VAPID_SUBJECT` — `mailto:support@sokratai.ru`

**Семантика**: `delivered_email` = "email enqueued", не "доставлен в inbox". `delivered_telegram` = "API 200", не "прочитал".

**`PUBLIC_APP_URL`**: обязателен для push deep links. Fallback: `https://sokratai.lovable.app`

**homework-reminder**: проверяет guided_chat completion (`homework_tutor_threads.status = 'completed'`)

**Known tech debt:**
- `/unsubscribe` route не реализован — email templates генерируют ссылку, но страницы нет
- Push opt-in: если browser subscribe OK но backend save fail — recovery path не реализован

## Profiles table — нет колонки email (КРИТИЧНО)

Таблица `profiles` **НЕ содержит** колонку `email`. Email пользователей хранится **только** в `auth.users`.

**Правило**: при необходимости получить email — использовать `dbService.auth.admin.getUserById(userId)`, **НЕ** добавлять `email` в `.select()` из `profiles`. PostgREST вернёт ошибку и сломает весь flow.
