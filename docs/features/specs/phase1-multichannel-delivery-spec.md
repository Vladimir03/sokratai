# Spec: Phase 1 — Web Push + каскадная доставка ДЗ

**PRD:** `docs/features/specs/homework-multichannel-delivery-prd.md` (Phase 1: P0-PUSH-1, P0-PUSH-2, P0-PUSH-3)
**Зависимость:** Phase 0 ✅ DONE — ученики теперь в системе с email
**Дата:** 2026-03-26
**Автор:** Vladimir + Claude

---

## Problem Statement

Репетитор создаёт ДЗ и назначает его ученикам. Единственный канал доставки уведомления — Telegram-бот. С февраля 2026 Telegram заблокирован Роскомнадзором в России (~80-90% недоступен). Ученик, не использующий VPN, **не получает** уведомление о назначенном ДЗ. Автоматические напоминания о дедлайне (`homework-reminder` cron) тоже идут только через Telegram.

Phase 0 решила проблему регистрации — ученики теперь заходят по email. Но **доставка ДЗ всё ещё зависит от Telegram**: `handleNotifyStudents` отправляет `sendMessage` через Telegram Bot API, `homework-reminder` тоже.

**Текущее состояние `delivery_status`:**
- `'delivered'` — Telegram-сообщение отправлено
- `'failed_not_connected'` — у ученика нет telegram_user_id
- `'failed_blocked_or_other'` — Telegram API ошибка (бот заблокирован, rate limit)

**Цена бездействия:** ученики не узнают о ДЗ → не решают → репетитор не видит прогресса → churn. При 80-90% блокировке Telegram — доставка ~10-20% учеников.

---

## Goals

1. **≥95% учеников получают уведомление о ДЗ** через хотя бы один канал (push, email, или Telegram)
2. **Каскадная логика**: backend автоматически выбирает лучший доступный канал для каждого ученика — репетитору не нужно думать о каналах
3. **Push-уведомления как primary**: ученик подписывается на push в 1 клик при первом входе → получает уведомления прямо в браузере/телефоне
4. **Email как reliable fallback**: если push недоступен (отклонён, expired, unsupported browser) → email со ссылкой на ДЗ
5. **Telegram сохраняется**: для VPN-пользователей — попытка отправки через Telegram в каскаде, но не primary

---

## Non-Goals

1. **Массовая отправка группе одной кнопкой** — отдельная Phase 2 (P1-GROUP-1, P1-GROUP-2 в PRD). Phase 1 улучшает `handleNotifyStudents` для одного assignment, Phase 2 добавляет групповой UI
2. **SMS как канал** — дорого (~2-4₽/SMS), слабая ценность для регулярных ДЗ. Рассмотреть в P2
3. **Двусторонний чат через email/push** — уведомление содержит только ссылку. Решение ДЗ — в веб-кабинете (guided chat)
4. **Push для репетиторов** — фокус Phase 1 на ученическом кабинете. Push для уведомлений репетитора о сданных ДЗ — P2
5. **Полноэкранный onboarding** — используем баннер (менее агрессивный, лучше conversion rate)
6. **Настройки уведомлений (preferences)** — P2. В Phase 1 ученик может только включить/выключить push через баннер. Granular preferences (push/email per event type) — позже
7. **Настройка Lovable Custom Emails домена** — предусловие, но не часть этой спеки. Нужно настроить до начала реализации

---

## User Stories

### Ученик

**US-S1.** Как ученик, при первом входе в кабинет я хочу видеть баннер «Включите уведомления, чтобы не пропустить ДЗ» с кнопкой, чтобы подписаться на push за 1 клик.

**US-S2.** Как ученик, когда репетитор назначил мне ДЗ, я хочу получить push-уведомление на телефон/десктоп с названием задания, чтобы не проверять сайт вручную.

**US-S3.** Как ученик без push (отклонил или unsupported browser), я хочу получить email со ссылкой на ДЗ, чтобы не пропустить задание.

**US-S4.** Как ученик, при клике на push-уведомление я хочу сразу оказаться на странице ДЗ (`/homework/:id`), чтобы начать решать.

**US-S5.** Как ученик, за 24 часа и за 1 час до дедлайна я хочу получить напоминание (push или email), если ещё не сдал ДЗ.

### Репетитор

**US-T1.** Как репетитор, при нажатии «Уведомить» я хочу, чтобы каждый ученик получил уведомление через доступный ему канал автоматически, без моего участия в выборе канала.

**US-T2.** Как репетитор, я хочу видеть, через какой канал доставлено уведомление каждому ученику (🔔 push / 📧 email / ✈️ telegram), чтобы понимать охват.

**US-T3.** Как репетитор, если у ученика нет ни одного канала (нет push, нет email, нет Telegram), я хочу видеть предупреждение «❌ Нет каналов», чтобы попросить его подключить уведомления.

### Edge cases

**US-E1.** Если push-подписка expired (браузер очистил) → каскад переходит к Telegram/email.

**US-E2.** Если у ученика И push, И email, И Telegram — отправляем только через push (primary), не дублируем.

**US-E3.** Если push failed (5xx от push service) → retry 1 раз → если снова failed → cascade к Telegram → email.

---

## Requirements

### Must-Have (P0)

#### P0-1. Push-подписка (Web Push API) ✅ DONE

Ученик подписывается на push-уведомления в веб-кабинете.

**Инфраструктура:**
- Генерация VAPID keys (public + private), хранение в env vars Edge Function
- Service Worker: добавить `push` и `notificationclick` event handlers в `public/service-worker.js`
- Frontend: `Notification.requestPermission()` + `PushManager.subscribe()` + отправка subscription на backend

**БД: таблица `push_subscriptions`**
```sql
CREATE TABLE push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ,
  UNIQUE(user_id, endpoint)
);
```

**Edge Function: `push-subscribe`**
- `POST /functions/v1/push-subscribe` — сохранить subscription (JWT auth)
- `DELETE /functions/v1/push-subscribe` — удалить subscription (unsubscribe)
- Идемпотентность: `ON CONFLICT (user_id, endpoint) DO UPDATE`

**Frontend API: `src/lib/pushApi.ts`**
- `subscribeToPush()` → requestPermission → PushManager.subscribe → POST to backend
- `unsubscribeFromPush()` → PushSubscription.unsubscribe → DELETE on backend
- `isPushSupported()` → проверка `'PushManager' in window` и `'serviceWorker' in navigator`
- `getPushPermissionState()` → `Notification.permission` ('granted' | 'denied' | 'default')

Acceptance criteria:
- [ ] VAPID keys сгенерированы и сохранены в Supabase Edge Function secrets
- [ ] `push_subscriptions` таблица создана с RLS (user видит только свои)
- [ ] Service Worker обрабатывает `push` event → показывает notification
- [ ] Service Worker обрабатывает `notificationclick` → открывает deep link
- [ ] Subscription сохраняется в БД при подписке
- [ ] Subscription удаляется при unsubscribe
- [ ] Работает: Chrome (Android/desktop), Safari 16+ (iOS 16.4+/macOS), Firefox
- [ ] Expired subscription: при отправке push → 410 Gone → удаляем из БД
- [ ] Нет push на preview/dev/localhost (только prod domain `sokratai.lovable.app`)

---

#### P0-2. Push opt-in баннер (ученик) ✅ DONE

Баннер при первом входе в студенческий кабинет.

**Компонент: `src/components/PushOptInBanner.tsx`**
- Показывать, если: `isPushSupported() && Notification.permission === 'default'`
- НЕ показывать, если: `permission === 'granted'` (уже подписан) или `permission === 'denied'` (отклонил)
- НЕ показывать, если: `localStorage('push_banner_dismissed')` (закрыл баннер)
- Layout: top-of-page opt-in banner above homework list (flow-block, не sticky — sticky конфликтует с Navigation на mobile iPhone). Если баннер переедет в общий student layout или на StudentHomeworkDetail, вопрос sticky пересмотреть
- Accent: amber (`bg-amber-50 border-amber-200`), текст + кнопка «Включить» + кнопка «✕» (dismiss)
- При клике «Включить» → `subscribeToPush()` → баннер скрывается
- При клике «✕» → `localStorage.setItem('push_banner_dismissed', Date.now())` → баннер скрывается
- Re-show через 7 дней: если `dismissed > 7 days ago` И `permission === 'default'` → показать снова

**Точка монтирования:** `src/pages/StudentHomework.tsx` (или общий student layout) — вверху страницы, перед списком ДЗ.

Acceptance criteria:
- [ ] Баннер виден при первом входе ученика (permission = 'default')
- [ ] Клик «Включить» → браузерный запрос → подписка → баннер пропадает
- [ ] Клик «✕» → баннер пропадает, re-show через 7 дней
- [ ] Если permission = 'granted' → баннер не показывается
- [ ] Если permission = 'denied' → баннер не показывается
- [ ] Если push не поддерживается (старый браузер) → баннер не показывается
- [ ] Mobile-first: компактный, не перекрывает контент, `touch-action: manipulation`
- [ ] Нет framer-motion (CSS transition для appearance)

---

#### P0-3. Lovable Custom Emails: настройка домена + шаблон ДЗ-уведомления

**Предусловие (manual step):** Настроить Lovable Custom Emails через Cloud → Emails:
1. Добавить домен `sokratai.ru` (или имеющийся домен)
2. Пройти DNS-верификацию (Lovable автоматизирует через Entri)
3. Дождаться статуса «Verified (Active)»
4. Lovable автоматически создаст `send-transactional-email` edge function и `_shared/transactional-email-templates/`

**Шаблон email-уведомления о ДЗ:**
- Расположение: `supabase/functions/_shared/transactional-email-templates/homework-notification.tsx`
- React Email компонент (inline styles, как требует Lovable)
- Содержит: имя репетитора, название ДЗ, предмет, дедлайн (если есть), CTA-кнопка «Открыть задание» → deep link
- Unsubscribe footer (обязателен по Lovable/CAN-SPAM)
- Plain text fallback (автоматический)

**Шаблон email-напоминания о дедлайне:**
- Расположение: `supabase/functions/_shared/transactional-email-templates/homework-reminder.tsx`
- Содержит: «До дедлайна осталось {24 часа / 1 час}», название ДЗ, CTA-кнопка «Сдать задание»

Acceptance criteria:
- [ ] Домен настроен, SPF/DKIM/DMARC прошли верификацию
- [ ] `send-transactional-email` edge function создана Lovable
- [ ] Шаблон `homework-notification` рендерится с реальными данными
- [ ] Шаблон `homework-reminder` рендерится с реальными данными
- [ ] Email приходит на реальный ящик (проверить Gmail, Mail.ru)
- [ ] Unsubscribe ссылка работает
- [ ] Rate limit: ≤1 email per assignment per student (идемпотентность)
- [ ] Sender: `noreply@notify.sokratai.ru` (или аналог — зависит от настройки домена)

---

#### P0-4. Каскадная логика доставки в `handleNotifyStudents`

Расширить существующий `POST /assignments/:id/notify` — для каждого ученика выбирать лучший канал автоматически.

**Приоритет каскада:**
```
1. Web Push (если есть push_subscriptions для user_id)
   → отправить через web-push library
   → если 201/успех → delivery_status = 'delivered_push'
   → если 410 Gone → удалить subscription, перейти к шагу 2
   → если 5xx → retry 1 раз → если failed → перейти к шагу 2

2. Telegram (если есть telegram_user_id в profiles или telegram_sessions)
   → отправить через Telegram Bot API (как сейчас)
   → если успех → delivery_status = 'delivered_telegram'
   → если failed → перейти к шагу 3

3. Email (если есть profiles.email И email не @temp.sokratai.ru)
   → отправить через send-transactional-email (Lovable Custom Emails)
   → если успех → delivery_status = 'delivered_email'
   → если failed → delivery_status = 'failed_all_channels'

4. Нет каналов → delivery_status = 'failed_no_channel'
```

**Обновление `delivery_status` enum:**
```sql
-- Миграция: расширить CHECK constraint
ALTER TABLE homework_tutor_student_assignments
  DROP CONSTRAINT IF EXISTS ...,
  ADD CONSTRAINT homework_student_delivery_status_check
  CHECK (delivery_status IN (
    'pending',
    'delivered',                    -- legacy (Telegram-only)
    'delivered_push',               -- NEW
    'delivered_telegram',           -- NEW (explicit)
    'delivered_email',              -- NEW
    'failed_not_connected',         -- legacy
    'failed_blocked_or_other',      -- legacy
    'failed_all_channels',          -- NEW
    'failed_no_channel'             -- NEW
  ));

-- Новое поле
ALTER TABLE homework_tutor_student_assignments
  ADD COLUMN delivery_channel TEXT; -- 'push' | 'telegram' | 'email' | null
```

**Web Push sending (в Edge Function):**
- Использовать `web-push` npm-совместимый модуль для Deno (или raw fetch к push endpoint с VAPID signing)
- Payload: JSON `{ title, body, url, icon, badge }`
- `title`: «Новое ДЗ: {assignment.topic || assignment.title}»
- `body`: «{tutor_name} назначил вам задание по {subject}»
- `url`: `https://sokratai.lovable.app/homework/{assignment_id}`

**Response обновление:**
```typescript
interface NotifyStudentsResponse {
  sent: number;
  failed: number;
  sent_by_channel: { push: number; telegram: number; email: number };
  failed_student_ids: string[];
  failed_by_reason: Record<string, NotifyFailureReason>;
}

type NotifyFailureReason =
  | 'missing_telegram_link'     // legacy
  | 'telegram_send_failed'      // legacy
  | 'telegram_send_error'       // legacy
  | 'push_expired'              // NEW: subscription expired (410)
  | 'push_send_failed'          // NEW: push service error
  | 'email_send_failed'         // NEW: email delivery error
  | 'no_channels_available'     // NEW: no push, no telegram, no email
  | 'all_channels_failed';      // NEW: tried all, all failed
```

Acceptance criteria:
- [ ] Каскад: push → Telegram → email → failed_no_channel
- [ ] Если push доступен и отправлен — НЕ дублировать в Telegram и email
- [ ] Expired push subscription (410) → удалить из `push_subscriptions` → cascade к следующему каналу
- [ ] Push retry: 1 retry при 5xx → если failed → cascade
- [ ] Telegram retry: 2 retries (как сейчас) → если failed → cascade к email
- [ ] Email: через `send-transactional-email` с шаблоном `homework-notification`
- [ ] `delivery_status` обновляется per-student с указанием канала
- [ ] `delivery_channel` записывается ('push' / 'telegram' / 'email')
- [ ] `sent_by_channel` в response — breakdown по каналам
- [ ] Идемпотентность: повторный notify для уже delivered студента → skip
- [ ] Backward compatible: старые статусы 'delivered', 'failed_not_connected' продолжают работать
- [ ] Логирование: каждый шаг каскада логируется для диагностики

---

#### P0-5. Каскадные напоминания о дедлайне (`homework-reminder`)

Расширить cron-функцию `homework-reminder` — отправлять напоминания через push и email, не только Telegram.

**Тот же каскад** что и P0-4: push → Telegram → email.

Acceptance criteria:
- [ ] Напоминание 24h и 1h: отправляется через push (если есть subscription)
- [ ] Если push нет — через Telegram
- [ ] Если Telegram нет — через email (шаблон `homework-reminder`)
- [ ] Идемпотентность через `homework_tutor_reminder_log` (как сейчас)
- [ ] Новое поле в reminder_log: `channel TEXT` — через какой канал отправлено
- [ ] Cron-логика не изменена (30-минутные окна для 24h и 1h)

---

#### P0-6. Delivery status UI (обновление для мультиканальности)

Обновить `DeliveryBadge` в `TutorHomeworkDetail.tsx` для отображения канала.

**Текущие бейджи (legacy):**
- `delivered` → ✓ «Доставлено» (green)
- `failed_not_connected` → 📶 «Нет Telegram» (amber)
- `failed_blocked_or_other` → ✗ «Ошибка доставки» (red)

**Новые бейджи:**
- `delivered_push` → 🔔 «Push» (green)
- `delivered_telegram` → ✈️ «Telegram» (green)
- `delivered_email` → 📧 «Email» (green)
- `failed_all_channels` → ✗ «Все каналы failed» (red)
- `failed_no_channel` → ❌ «Нет каналов» (red) + tooltip «Попросите ученика включить уведомления»
- `delivered` (legacy) → ✓ «Доставлено» (green) — backward compat

Acceptance criteria:
- [ ] Каждый статус имеет иконку канала + цветовой код
- [ ] Legacy статусы ('delivered', 'failed_not_connected', 'failed_blocked_or_other') продолжают рендериться
- [ ] `failed_no_channel` показывает tooltip с рекомендацией
- [ ] Бейджи компактные (inline, не ломают таблицу)

---

### Nice-to-Have (P1)

#### P1-1. Push для повторной подписки (re-subscribe)

Если push-подписка expired и ученик заходит на сайт — предложить подписаться снова.

- `pushsubscriptionchange` event в Service Worker → auto-resubscribe
- Или: при каждом визите проверять `navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription())` → если null и permission = 'granted' → auto-resubscribe

#### P1-2. Fallback-баннер при отклонённом push

Если ученик отклонил push (`Notification.permission === 'denied'`) и пропустил ≥2 ДЗ:
- Показать баннер: «Вы пропустили 2 задания. Включите уведомления в настройках браузера»
- Ссылка на инструкцию по включению push в Settings (для Chrome, Safari)

#### P1-3. Email preview в уведомлении репетитора

При нажатии «Уведомить» — показать preview email-шаблона перед отправкой.

---

### Future Considerations (P2)

#### P2-1. Notification preferences (ученик)

Настройки: какие уведомления получать и через какой канал.
- Toggle: push on/off, email on/off
- Per-event: ДЗ назначено, напоминание о дедлайне, AI проверил

#### P2-2. Push для репетитора

Уведомления репетитору: «Ученик сдал ДЗ», «Все ученики сдали», «Дедлайн через час, 3 ученика не сдали».

#### P2-3. Retry queue (async)

Асинхронная очередь retry: если push/email/Telegram failed → автоматический retry через 5 мин, 30 мин, 2 часа. Через pg_cron или Supabase Scheduler.

#### P2-4. Массовая отправка группе + status UI

Это Phase 2 PRD (P1-GROUP-1, P1-GROUP-2): кнопка «Отправить группе», progress feedback, retry для failed.

---

## Success Metrics

### Leading (1-2 недели после запуска)

| Метрика | Target | Stretch | Как измеряем |
|---------|--------|---------|-------------|
| Push opt-in rate | ≥40% студентов с push | ≥60% | `push_subscriptions.count / active_students.count` |
| Delivery success rate | ≥95% | ≥99% | `delivery_status IN ('delivered_*') / total assignments` |
| Push delivery rate | ≥70% студентов через push | ≥85% | `delivery_channel = 'push' / total delivered` |
| Click-through rate (push) | ≥30% | ≥50% | `notificationclick` events / push delivered |
| Email delivery rate | <5% bounce | <2% | Lovable Analytics → bounced/delivered |

### Lagging (4-8 недель)

| Метрика | Target | Stretch | Как измеряем |
|---------|--------|---------|-------------|
| ДЗ submission rate | +20% vs baseline | +40% | `submissions.count / student_assignments.count` (7-day window) |
| Time to first open | <2 часа (median) | <30 мин | `first_homework_view.timestamp - notified_at` |
| Tutor NPS (delivery) | ≥7/10 | ≥8/10 | Опрос «Насколько легко ученики получают ДЗ?» |
| Telegram dependency | <30% доставок через Telegram | <15% | `delivery_channel = 'telegram' / total delivered` |

---

## Resolved Questions

| # | Вопрос | Решение | Дата |
|---|--------|---------|------|
| Q1 | Какой домен для email? | **`sokratai.ru`** — домен подключён в Lovable Custom Emails, верификация пройдена (зелёная точка). Auth-шаблоны ещё не созданы («No authentication emails yet»), но для transactional emails (ДЗ-уведомления) auth-шаблоны не нужны — создаём свои в `_shared/transactional-email-templates/` | 2026-03-27 |
| Q2 | VAPID keys: генерировать самим или другой подход? | **Генерировать самим** через `npx web-push generate-vapid-keys`. `VAPID_PUBLIC_KEY` → Supabase secrets + `.env` фронтенда (нужен для `PushManager.subscribe`). `VAPID_PRIVATE_KEY` → только Supabase secrets. `VAPID_SUBJECT` = `mailto:support@sokratai.ru`. FCM/OneSignal не нужны — лишняя зависимость для наших объёмов | 2026-03-27 |
| Q3 | iOS Safari push: нужен ли PWA manifest? | **Не блокировать Phase 1 на iOS push.** Apple требует `display: standalone` + «Добавить на Home Screen» — это friction для учеников. Email покрывает iOS на 100%. PWA push → P1-improvement позже, с отдельным «Установить приложение» баннером | 2026-03-27 |
| Q4 | Лимит 100 emails/час — хватит? | **Да, достаточно.** Phase 1 = per-assignment notify (1-5 учеников). Phase 2 (группы до 30) тоже укладывается. При росте — upgrade Lovable plan | 2026-03-27 |
| Q5 | `web-push` library vs raw `crypto.subtle`? | **Raw `crypto.subtle`** (без библиотеки). `web-push` npm использует `node:https.request()` — не работает в Deno Edge Functions. Реализуем `push-sender.ts` (~100-150 строк): JWT signing (ECDSA P-256) + payload encryption (ECDH + HKDF + AES-128-GCM) + `fetch()`. Нулевые зависимости, быстрый cold start. Reference: `webpush-webcrypto` patterns | 2026-03-27 |

## Open Questions

Все вопросы закрыты. ✅

---

## Timeline & Phasing

### Prerequisites (до начала разработки)
- [x] Настроить Lovable Custom Emails: домен `sokratai.ru` подключён и верифицирован ✅
- [ ] Сгенерировать VAPID keys (`npx web-push generate-vapid-keys`) + добавить в Supabase secrets (15 мин)

### Phase 1.1: Push-инфраструктура (3-4 дня)
- Миграция: `push_subscriptions` таблица + RLS
- Edge function: `push-subscribe` (POST/DELETE)
- Service Worker: `push` + `notificationclick` handlers
- Frontend: `pushApi.ts` + `PushOptInBanner.tsx`
- Тест: subscribe → manual push через curl → notification показывается

### Phase 1.2: Email-инфраструктура (2-3 дня)
- Lovable Custom Emails setup (if not done)
- Email templates: `homework-notification.tsx`, `homework-reminder.tsx`
- Интеграция `send-transactional-email` в homework-api
- Тест: отправка email → получение в Gmail/Mail.ru

### Phase 1.3: Каскадная логика (3-4 дня)
- Рефакторинг `handleNotifyStudents`: push → Telegram → email cascade
- Миграция: новые `delivery_status` значения + `delivery_channel`
- Обновление `homework-reminder` cron
- Обновление response types (`sent_by_channel`)
- DeliveryBadge UI обновление

### Phase 1.4: QA + polish (2 дня)
- Кросс-браузерное тестирование push (Chrome, Safari, Firefox)
- iOS Safari push (если поддержка Web App Manifest)
- Email deliverability: проверка SPF/DKIM, спам-фильтры
- Edge cases: expired subscriptions, race conditions, retry logic
- Regression: существующий Telegram flow не сломан

**Total estimated:** 10-13 дней (1 разработчик)

---

## Technical Architecture

### Новые файлы

| Файл | Тип | Описание |
|------|-----|----------|
| `supabase/functions/push-subscribe/index.ts` | Edge Function | CRUD push-подписок |
| `supabase/functions/_shared/push-sender.ts` | Shared util | Web Push send logic (VAPID signing) |
| `supabase/functions/_shared/transactional-email-templates/homework-notification.tsx` | Template | React Email шаблон ДЗ-уведомления |
| `supabase/functions/_shared/transactional-email-templates/homework-reminder.tsx` | Template | React Email шаблон напоминания |
| `src/lib/pushApi.ts` | Frontend API | subscribe/unsubscribe/check support |
| `src/components/PushOptInBanner.tsx` | Component | Баннер opt-in для ученика |
| `supabase/migrations/XXXXXXXX_push_subscriptions.sql` | Migration | Таблица push_subscriptions |
| `supabase/migrations/XXXXXXXX_delivery_multichannel.sql` | Migration | Расширение delivery_status + channel |

### Изменяемые файлы

| Файл | Что меняется |
|------|-------------|
| `public/service-worker.js` | Добавить `push` и `notificationclick` event handlers |
| `src/registerServiceWorker.ts` | Без изменений (SW уже регистрируется на prod) |
| `supabase/functions/homework-api/index.ts` | `handleNotifyStudents` → каскадная логика |
| `supabase/functions/homework-reminder/index.ts` | Добавить push + email каскад |
| `src/lib/tutorHomeworkApi.ts` | Обновить types (DeliveryStatus, NotifyResponse) |
| `src/pages/tutor/TutorHomeworkDetail.tsx` | Обновить DeliveryBadge для мультиканальности |
| `src/pages/StudentHomework.tsx` (или layout) | Монтировать PushOptInBanner |

### НЕ меняемые файлы

| Файл | Причина |
|------|---------|
| `supabase/functions/telegram-bot/index.ts` | Telegram-бот не трогаем — высокий риск |
| `src/components/AuthGuard.tsx` | Без изменений |
| `src/components/TutorGuard.tsx` | Без изменений |
| `src/pages/Chat.tsx` | Без изменений |

### Диаграмма каскада

```
handleNotifyStudents(assignmentId)
│
├─ for each student in student_assignments WHERE notified = false:
│
│   ① Check push_subscriptions for student.user_id
│   │  ├─ Found → sendPush(subscription, payload)
│   │  │  ├─ 201 OK → delivery_status = 'delivered_push', DONE
│   │  │  ├─ 410 Gone → DELETE subscription, goto ②
│   │  │  └─ 5xx → retry 1x → if still failed → goto ②
│   │  └─ Not found → goto ②
│   │
│   ② Check telegram_user_id for student
│   │  ├─ Found → sendTelegramMessage(chat_id, text)
│   │  │  ├─ OK → delivery_status = 'delivered_telegram', DONE
│   │  │  └─ Failed → goto ③
│   │  └─ Not found → goto ③
│   │
│   ③ Check profiles.email (NOT @temp.sokratai.ru)
│   │  ├─ Found → sendEmail(email, template, data)
│   │  │  ├─ OK → delivery_status = 'delivered_email', DONE
│   │  │  └─ Failed → delivery_status = 'failed_all_channels'
│   │  └─ Not found → delivery_status = 'failed_no_channel'
│
└─ Return { sent, failed, sent_by_channel, failed_by_reason }
```

---

## Compatibility & Constraints

### Web Push browser support
- ✅ Chrome 50+ (desktop + Android) — основной браузер учеников
- ✅ Firefox 44+ (desktop + Android)
- ✅ Edge 17+
- ⚠️ Safari 16.0+ (macOS) — push работает
- ⚠️ Safari 16.4+ (iOS) — push **только** через Home Screen Web App (PWA). Обычный Safari на iOS **не поддерживает** push без добавления на Home Screen
- ❌ Safari < 16 (iOS/macOS) — нет поддержки

### iOS Safari ограничения
- Push на iOS Safari 16.4+ требует: Web App Manifest с `"display": "standalone"` + пользователь добавил на Home Screen через «Поделиться → На экран Домой»
- Без этого `PushManager` недоступен на iOS Safari
- **Решение Phase 1:** push работает на Chrome/Firefox/desktop Safari. Для iOS Safari ученики получают email fallback. iOS push PWA — P1/P2

### Lovable Custom Emails
- Rate limit: 100 emails/hour per workspace
- Для Phase 1 (per-student notify): достаточно
- Для Phase 2 (массовая группе 30 учеников): 30 emails = OK, но при 3 группах по 30 = 90 → close to limit
- 50k emails/month included, $1/1000 after

### Safari/iOS CSS (из CLAUDE.md)
- `font-size ≥ 16px` на input в PushOptInBanner (если есть)
- `touch-action: manipulation` на кнопках баннера
- Structural breakpoints: `md:` (не `sm:`)
- Нет framer-motion в shared components

### Безопасность
- VAPID private key: только в Edge Function secrets, никогда на frontend
- Push subscription: привязана к user_id через JWT
- RLS на `push_subscriptions`: `SELECT/INSERT/DELETE WHERE user_id = auth.uid()`
- Email: через Lovable infrastructure (SPF/DKIM/DMARC автоматические)
- Temp emails (`@temp.sokratai.ru`): исключаются из email каскада
