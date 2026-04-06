# Notifications & Delivery

## Preview parity (КРИТИЧНО)

### Service Worker
- SW регистрируется **ТОЛЬКО** на продакшен-домене (`sokratai.lovable.app`)
- На preview/dev/localhost — принудительный `unregister()` + очистка `CacheStorage`
- Не менять логику allow-list в `src/registerServiceWorker.ts` без веской причины
- **Push handlers**: `push`, `notificationclick`, `pushsubscriptionchange` — в `public/service-worker.js`
- `notificationclick`: same-origin URL validation + exact-URL tab reuse
- `pushsubscriptionchange`: re-subscribe + `postMessage` → `listenForSubscriptionChanges()` → authenticated API call

## Web Push инфраструктура (Phase 1.1)
- **Таблица**: `push_subscriptions` (user_id, endpoint, p256dh, auth, user_agent, expires_at) — UNIQUE(user_id, endpoint), RLS, FK CASCADE
- **Edge function**: `supabase/functions/push-subscribe/index.ts` — POST (upsert) + DELETE (unsubscribe), JWT auth
- **Frontend API**: `src/lib/pushApi.ts` — `isPushSupported()` (prod-only!), `subscribeToPush()`, `unsubscribeFromPush()`
- **Opt-in баннер**: `src/components/PushOptInBanner.tsx` — flow-block в `StudentHomework.tsx`, 7-day re-show
- **Push sender**: `supabase/functions/_shared/push-sender.ts` — raw `crypto.subtle` (RFC 8291 + RFC 8292), zero npm deps
- **Env vars**: `VITE_VAPID_PUBLIC_KEY` (frontend), `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` (edge function secrets)
- **КРИТИЧНО**: `isPushSupported()` возвращает `false` на non-prod hosts

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

**homework-reminder**: проверяет и classic submissions и guided_chat completion (`homework_tutor_threads.status = 'completed'`)

**Known tech debt:**
- `/unsubscribe` route не реализован — email templates генерируют ссылку, но страницы нет
- Push opt-in: если browser subscribe OK но backend save fail — recovery path не реализован

## Profiles table — нет колонки email (КРИТИЧНО)

Таблица `profiles` **НЕ содержит** колонку `email`. Email пользователей хранится **только** в `auth.users`.

**Правило**: при необходимости получить email — использовать `dbService.auth.admin.getUserById(userId)`, **НЕ** добавлять `email` в `.select()` из `profiles`. PostgREST вернёт ошибку и сломает весь flow.
