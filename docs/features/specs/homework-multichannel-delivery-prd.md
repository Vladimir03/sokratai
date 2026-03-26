# PRD: Telegram-независимый онбординг и мультиканальная доставка ДЗ

**Статус:** Draft v2
**Дата:** 2026-03-26
**Автор:** Vladimir + Claude
**Jobs:** R4-2 (Отправить ДЗ всем ученикам группы через единый канал), S3-1 (Получить ДЗ в Telegram — там, где я и так живу)
**Источник:** `docs/product/research/ajtbd/job-graphs/elite-physics-finish-sprint-job-graph.md`

---

## Problem Statement

### Проблема №0: Ученики не могут попасть в систему

Прежде чем доставлять ДЗ — ученики должны **зарегистрироваться в Сократе** и **привязаться к репетитору**. Сегодня **вся цепочка онбординга зависит от Telegram**:

1. **Страница приглашения** (`/invite/:code` → `InviteToTelegram.tsx`) — показывает QR-код к Telegram-боту, кнопку «Открыть Telegram» и 3-шаговую инструкцию с Telegram. **Нет email-альтернативы.** Без Telegram ученик не может зарегистрироваться через приглашение.

2. **Добавление ученика репетитором** (`AddStudentDialog.tsx`) — ручное добавление требует `telegram_username` (обязательное поле). **Репетитор не может добавить ученика по email.** Если ученик зарегистрировался через email — он «невидим» для репетитора.

3. **Привязка ученик→репетитор** — работает только через Telegram-бота (`handleTutorInvite` в `telegram-bot/index.ts`). При переходе по invite-ссылке бот создаёт профиль и записывает `tutor_students` link. **Без бота привязка невозможна.**

4. **Превью ссылки** (`index.html` OG-теги) — статические, показывают «ИИ-репетитор по математике ЕГЭ» для всех страниц. При отправке invite-ссылки в Telegram превью **неактуальное** (не физика, не персонализированное).

5. **Страница входа** (`Login.tsx`) — Telegram показан как основной способ («Рекомендуем — не нужен пароль»), email как вторичный. При заблокированном Telegram — кнопка «Войти через Telegram» уводит в тупик (ожидание подтверждения, которое не придёт).

**Контекст блокировки:** С 10 февраля 2026 Роскомнадзор активно блокирует Telegram в России: блокировка достигает 80-90%, мессенджер практически недоступен без VPN с середины марта. Власти заявляют о планах блокировать VPN-трафик в течение 3-6 месяцев.

**Следствие:** Даже если мы построим идеальную систему доставки ДЗ (push, email) — она бесполезна, пока ученики не в системе. **Онбординг — блокер для всего остального.**

### Проблема №1: Доставка ДЗ зависит от Telegram

Репетитор создаёт ДЗ в Сократе и хочет одним действием отправить его всем ученикам группы. Единственный канал — Telegram-бот. При блокировке критическое звено цепочки R4-1 → R4-2 → S3-1 → решение → обратная связь **сломано**.

**Текущее состояние кодовой базы:**

| Компонент | Telegram-зависимость | Альтернатива |
|-----------|---------------------|-------------|
| Invite page (`InviteToTelegram.tsx`) | 100% — только QR к боту | ❌ Нет |
| Manual add student (`AddStudentDialog.tsx`) | `telegram_username` обязателен | ❌ Нет email-добавления |
| Tutor-student linking | Только через бот (`handleTutorInvite`) | ❌ Нет web-linking |
| Student login (`Login.tsx`) | Telegram = primary, email = secondary | ⚠️ Email работает, но UX плохой |
| HW delivery (`handleNotifyStudents`) | Только Telegram `sendMessage` | ❌ Нет push/email |
| HW reminders (`homework-reminder`) | Только Telegram | ❌ Нет push/email |
| OG meta tags (`index.html`) | Статические, неактуальные | ❌ Нет динамических |

**Цена бездействия:** Репетитор не может завести учеников → нет кому отправлять ДЗ → пилот провален.

---

## Goals

1. **Ученики могут зарегистрироваться и привязаться к репетитору без Telegram** — через email-приглашение или веб-ссылку с email-регистрацией
2. **Репетитор может добавить ученика по email** — не только по Telegram username
3. **100% invite flow работает без Telegram** — страница приглашения предлагает email-регистрацию как основной путь
4. **Гарантированная доставка ДЗ ≥95% учеников** — через каскад каналов (web push → email → Telegram fallback)
5. **Одно действие для массовой отправки** группе — репетитор выбирает группу → нажимает «Отправить» → все получают через доступный канал
6. **Telegram сохраняется как опция** для VPN-пользователей — не удаляем, а делаем secondary

---

## Non-Goals

1. **Полное удаление Telegram-интеграции** — бот остаётся для тех, у кого работает. Новые каналы — дополнение, не замена
2. **Дифференцированные варианты ДЗ для группы** — v1 отправляет одно ДЗ всей группе. Подмножества задач — отдельная фича
3. **Двусторонний чат через email/push** — уведомление содержит только ссылку, решение ДЗ в веб-кабинете (guided chat)
4. **Мобильное приложение (PWA/native)** — web push работает из браузера без установки
5. **SMS как канал доставки** — дорого (~2-4₽/SMS), низкая ценность для регулярных ДЗ
6. **SSR для динамических OG-тегов** — слишком дорого для MVP. Исправим статические теги на актуальные

---

## User Stories

### Онбординг: Репетитор приглашает учеников

**US-O1.** Как репетитор, я хочу отправить ученику ссылку-приглашение (в WhatsApp, SMS, или лично), и ученик должен зарегистрироваться **без Telegram**, чтобы блокировка мессенджера не мешала набору.

**US-O2.** Как репетитор, я хочу добавить ученика по email-адресу в свой кабинет, чтобы не зависеть от Telegram-username, который ученик может не знать или не иметь.

**US-O3.** Как ученик, я хочу получить ссылку от репетитора, зарегистрироваться по email за 30 секунд, и сразу оказаться привязанным к этому репетитору — без установки Telegram.

**US-O4.** Как ученик, перейдя по invite-ссылке, я хочу видеть страницу с именем моего репетитора и понятным способом регистрации — не инструкцию про Telegram, который у меня заблокирован.

**US-O5.** Как репетитор, я хочу видеть в Telegram-превью ссылки актуальную информацию о Сократе (физика ЕГЭ/ОГЭ, а не математика), чтобы ученики не путались.

### Доставка ДЗ: Репетитор (R4-2)

**US-R1.** Как репетитор, я хочу отправить созданное ДЗ всем ученикам выбранной группы одной кнопкой, чтобы не отправлять каждому по отдельности.

**US-R2.** Как репетитор, я хочу видеть статус доставки по каждому ученику (✅ доставлено / ⏳ ожидание / ❌ не доставлено) и через какой канал, чтобы знать, кто не получил ДЗ.

**US-R3.** Как репетитор, я хочу переотправить уведомление конкретному ученику (retry), если первая попытка не удалась.

**US-R4.** Как репетитор, я хочу видеть предупреждение, если у ученика не настроен ни один канал доставки, чтобы попросить его подключить email или push.

### Доставка ДЗ: Ученик (S3-1)

**US-S1.** Как ученик, я хочу получить push-уведомление на телефон, когда репетитор назначил мне новое ДЗ, чтобы не проверять сайт вручную.

**US-S2.** Как ученик, я хочу получить email со ссылкой на ДЗ, если push недоступен, чтобы не пропустить задание.

**US-S3.** Как ученик, я хочу открыть ДЗ в один тап из уведомления и сразу начать решать.

**US-S4.** Как ученик, я хочу подключить push-уведомления за 1 клик при первом входе в кабинет.

### Edge cases

**US-E1.** Если ученик заблокировал push и не указал email — репетитор видит «❌ Нет каналов доставки».

**US-E2.** Если ученик ранее регистрировался через Telegram (есть `telegram_${id}@temp.sokratai.ru`), а теперь хочет войти по email — нужен merge/link accounts.

**US-E3.** Если invite-ссылку открыл уже залогиненный ученик — автоматически привязать к репетитору без повторной регистрации.

---

## Requirements

### PHASE 0 — Telegram-независимый онбординг (БЛОКЕР для всего остального)

> **Без Phase 0 невозможно ни набрать учеников, ни отправить им ДЗ. Это первый приоритет.**

**P0-ONBOARD-1. Новая invite-страница с email-регистрацией**

Полная переработка `/invite/:code` — вместо Telegram-инструкций показываем email-регистрацию как основной путь, Telegram как опцию.

Acceptance criteria:
- [ ] Страница показывает: «Вас пригласил репетитор {Имя}» (из `tutors` по `invite_code`)
- [ ] **Основной CTA**: форма email + пароль + кнопка «Зарегистрироваться» (или «Войти», если аккаунт уже есть)
- [ ] При регистрации: `supabase.auth.signUp()` с `email_confirm: true` (без email-верификации — zero-friction) → автоматическая привязка к репетитору через `invite_code` (новый web-linking flow, см. P0-ONBOARD-3)
- [ ] При входе существующего аккаунта: `supabase.auth.signInWithPassword()` → автоматическая привязка (если не привязан)
- [ ] **Опциональный блок внизу**: «Или подключитесь через Telegram» со свёрнутой секцией (QR + кнопка). НЕ основной путь
- [ ] Убрать 3-шаговую инструкцию про Telegram
- [ ] Валидация пароля: min 8 chars, 1 uppercase, 1 digit (как на `/signup`)
- [ ] Mobile-first layout: работает на iPhone Safari без зума (`font-size ≥ 16px` на input)
- [ ] После успешной регистрации/входа → redirect на `/homework` (студенческий кабинет)

**P0-ONBOARD-2. Добавление ученика по email (репетитор)**

Расширить `AddStudentDialog.tsx`: репетитор может добавить ученика по email, не только по Telegram username.

Acceptance criteria:
- [ ] Вкладка «Добавить вручную»: поле `telegram_username` становится **опциональным** (не обязательным)
- [ ] Новое поле: `email` (опциональное). Хотя бы одно из `email` / `telegram_username` должно быть заполнено
- [ ] При добавлении по email: создаётся placeholder profile с `registration_source: 'manual'` и `email`
- [ ] Если ученик с таким email уже есть в `profiles` — привязать (`tutor_students`) без создания дубликата
- [ ] Edge function `tutor-manual-add-student` принимает `email` как альтернативу `telegram_username`
- [ ] Если у ученика есть email — репетитор может отправить ему invite-email со ссылкой на `/invite/:code`

**P0-ONBOARD-3. Web-based tutor-student linking**

Новый механизм привязки ученик→репетитор без Telegram-бота. Работает через invite-ссылку + веб-регистрацию.

Acceptance criteria:
- [ ] Новая Edge function `claim-invite` (или расширение существующей): принимает `{invite_code, user_id}`, создаёт `tutor_students` link
- [ ] Вызывается автоматически после регистрации/входа через invite-страницу
- [ ] Проверки: invite_code валиден, tutor существует, link не дублируется
- [ ] Если link уже есть → молча пропускаем (идемпотентность)
- [ ] `invite_code` передаётся через URL param и сохраняется в `localStorage('pending_invite_code')` (не sessionStorage — очищается на iOS Safari). После claim — чистим
- [ ] Работает для обоих случаев: новая регистрация и вход существующего ученика

**P0-ONBOARD-4. Email как primary auth на странице входа**

Обновить `Login.tsx`: email = основной способ, Telegram = опция.

Acceptance criteria:
- [ ] Email-форма показана **первой** (сверху), без пометки «вторичный»
- [ ] Telegram-кнопка **под email-формой**, с пометкой «Или войдите через Telegram (нужен VPN)»
- [ ] Если Telegram-кнопка нажата и polling не получает ответ 30+ сек → показать hint: «Telegram может быть недоступен. Попробуйте войти по email»
- [ ] Убрать текст «Рекомендуем — не нужен пароль» у Telegram-кнопки

**P0-ONBOARD-5. Актуальные OG-теги**

Обновить статические OG-теги в `index.html` на актуальную информацию.

Acceptance criteria:
- [ ] `og:title`: «Сократ — AI-помощник для подготовки к ЕГЭ и ОГЭ» (не «по математике»)
- [ ] `og:description`: «Готовься к ЕГЭ и ОГЭ по физике и математике с AI-помощником 24/7» (добавить физику)
- [ ] `og:image`: актуальное изображение (если текущее Lovable-дефолтное — заменить на брендированное)
- [ ] `og:url`: `https://sokratai.ru`
- [ ] `og:site_name`: «Сократ»

### PHASE 1 — Web Push + каскадная доставка ДЗ

> **Зависит от Phase 0** — ученики должны быть в системе с email.

**P0-PUSH-1. Web Push уведомления (основной канал доставки)**

Ученик подписывается на push-уведомления в веб-кабинете. При назначении ДЗ — получает push с заголовком, предметом и ссылкой.

Acceptance criteria:
- [ ] При первом входе в студенческий кабинет — баннер «Включите уведомления, чтобы не пропустить ДЗ» с кнопкой «Включить»
- [ ] Клик на «Включить» → браузерный запрос разрешения → подписка сохраняется в `push_subscriptions` (endpoint, keys, user_id)
- [ ] При `POST /assignments/:id/notify` — для каждого ученика с push-подпиской отправляется web push через Web Push API (VAPID)
- [ ] Push содержит: заголовок ДЗ, предмет, deeplink `sokratai.lovable.app/homework/{id}`
- [ ] Клик на push → открывает ДЗ в браузере, ученик видит задачи
- [ ] `delivery_status = 'delivered_push'` при успешной отправке
- [ ] Работает на Chrome (Android/desktop), Safari 16+ (iOS/macOS), Firefox
- [ ] Service Worker обрабатывает push-события (`push`, `notificationclick`)
- [ ] Повторная подписка при истечении/отзыве (обработка `pushsubscriptionchange`)

**P0-PUSH-2. Email-уведомления (fallback-канал)**

Если у ученика нет push-подписки — отправляем email со ссылкой на ДЗ.

Acceptance criteria:
- [ ] Email отправляется через **Lovable Custom Emails** (`supabase/functions/send-transactional-email/`) — встроенная инфраструктура, SPF/DKIM/DMARC из коробки, 100 emails/час, 50k/месяц
- [ ] Шаблон: «{Имя репетитора} назначил вам ДЗ: {Тема}» + CTA-кнопка «Открыть задание»
- [ ] Email берётся из `profiles.email` (уже есть в системе через Auth)
- [ ] `delivery_status = 'delivered_email'` при успешной отправке
- [ ] Unsubscribe-ссылка в footer (CAN-SPAM / ФЗ-152 compliance)
- [ ] Rate limiting: не более 1 email на assignment per student (идемпотентность)

**P0-PUSH-3. Каскадная логика доставки**

Backend выбирает лучший доступный канал для каждого ученика автоматически.

Acceptance criteria:
- [ ] Приоритет каналов: **web push** → **Telegram** (если подключён и не заблокирован) → **email**
- [ ] Каскад: если push failed (expired subscription) → попробовать Telegram → попробовать email
- [ ] `delivery_channel` поле в `homework_tutor_student_assignments`: 'push' | 'telegram' | 'email' | null
- [ ] Если все каналы failed → `delivery_status = 'failed_no_channel'`
- [ ] Репетитор видит иконку канала рядом со статусом: 🔔 push, ✈️ telegram, 📧 email

### PHASE 2 — Массовая отправка группе + статус

**P1-GROUP-1. Массовая отправка группе**

Репетитор отправляет ДЗ всей группе одной кнопкой.

Acceptance criteria:
- [ ] На странице `TutorHomeworkDetail` — если ДЗ привязано к группе, кнопка «Отправить группе»
- [ ] Один API-вызов `POST /assignments/:id/notify` → backend итерирует по всем `student_assignments`, выбирает канал, отправляет
- [ ] Progress feedback: «Отправлено 8/10, 1 ошибка, 1 нет каналов»
- [ ] Повторная отправка (retry): кнопка «Переотправить» для failed учеников
- [ ] Не отправлять повторно ученикам со статусом `delivered_*` (идемпотентность)

**P1-GROUP-2. Статус доставки в UI репетитора**

Acceptance criteria:
- [ ] На `TutorHomeworkDetail` — таблица/список учеников с колонками: Имя, Канал, Статус, Время доставки
- [ ] Статусы с цветовым кодированием: зелёный (доставлено), жёлтый (ожидание), красный (ошибка), серый (нет каналов)
- [ ] Предупреждение вверху: «У {N} учеников не настроен ни один канал доставки — попросите их подключить уведомления»
- [ ] Фильтр: показать только проблемных (не доставлено / нет каналов)

### PHASE 3 — Onboarding + напоминания (P1)

**P1-1. Onboarding push-подписки для ученика**

- [ ] При первом входе — полноэкранный onboarding-шаг: «Репетитор будет отправлять вам задания. Включите уведомления, чтобы не пропустить»
- [ ] Если ученик отклонил push — fallback-баннер через 3 дня: «Вы пропустили 2 задания. Включите уведомления?»
- [ ] Настройки профиля: toggle push on/off, привязка email

**P1-2. Авто-напоминания через push/email**

- [ ] Расширить `homework-reminder` cron: отправлять напоминания о дедлайне через push → email (не только Telegram)
- [ ] Та же каскадная логика, что и в P0-PUSH-3
- [ ] Идемпотентность через `homework_tutor_reminder_log` (уже есть)

**P1-3. Telegram как опциональный канал (graceful degradation)**

- [ ] Если Telegram Bot API вернул ошибку (timeout, 403 blocked) → автоматически cascade к email
- [ ] Логировать % Telegram-доставок vs push vs email для аналитики
- [ ] Не показывать «Подключите Telegram» как основной CTA — заменить на «Включите уведомления»

### PHASE 4 — Future Considerations (P2)

**P2-1. Дифференцированные варианты ДЗ**

Репетитор может выбрать подмножество задач для слабых/сильных учеников в группе.

**P2-2. WhatsApp Business API**

Текстовые сообщения WhatsApp пока работают в России. Интеграция через WhatsApp Business API (~$0.05/msg).

**P2-3. SMS для критических уведомлений**

SMS как last-resort канал для уведомлений о дедлайне. Требует SMS-провайдера (SMS.ru, Twilio) и бюджета ~2-4₽/SMS.

**P2-4. Account merge (Telegram → Email)**

Ученик, ранее зарегистрированный через Telegram (`telegram_${id}@temp.sokratai.ru`), хочет привязать настоящий email. Требует merge-логики для двух auth-аккаунтов.

**P2-5. Динамические OG-теги для invite**

Server-side rendering или edge function для персонализированных OG-тегов: «Репетитор Егор приглашает вас на Сократ». Требует SSR или Cloudflare Worker.

---

## Success Metrics

### Phase 0 — Онбординг (Leading, 1-2 недели)

| Метрика | Target | Stretch | Как измеряем |
|---------|--------|---------|-------------|
| Email-регистрация через invite | ≥70% новых учеников | ≥90% | `profiles WHERE registration_source = 'email' AND created via invite` |
| Invite → registration conversion | ≥50% | ≥70% | Клик по invite-ссылке → регистрация завершена (в течение 24ч) |
| Tutor-student link success rate | ≥95% | 100% | `tutor_students` created / invite page visits |
| Время регистрации (invite → linked) | <2 мин (median) | <1 мин | `tutor_students.created_at - profiles.created_at` |

### Phase 1-2 — Доставка ДЗ (Leading, 1-2 недели)

| Метрика | Target | Stretch | Как измеряем |
|---------|--------|---------|-------------|
| Delivery rate | ≥90% | ≥95% | `delivery_status IN ('delivered_push','delivered_telegram','delivered_email')` / total assigned |
| Push subscription rate | ≥60% | ≥80% | `push_subscriptions WHERE active = true` / total students |
| Time to open ДЗ | <2 часа (median) | <30 мин | `first_opened_at - notified_at` |
| Retry rate | <10% | <5% | Повторные вызовы `/notify` per student |

### Lagging (1-2 месяца)

| Метрика | Target | Stretch | Как измеряем |
|---------|--------|---------|-------------|
| Homework completion rate | +15% vs текущий | +25% | submitted / assigned |
| Telegram dependency | <30% | <15% | `delivery_channel = 'telegram'` / total |
| «Не получил ДЗ» жалобы | 0 | 0 | Обратная связь от репетиторов |

---

## Resolved Decisions

| # | Вопрос | Решение | Обоснование |
|---|--------|---------|-------------|
| 1 | Как хранить `invite_code` между auth-redirect'ами? | **URL param + `localStorage` fallback**. Invite-страница сохраняет код в `localStorage('pending_invite_code')`. После signUp/signIn — читаем, вызываем `claim-invite`, чистим. Manual fallback: поле «Введите код» если link потерялся | `sessionStorage` очищается на iOS Safari при переходе в Telegram. `localStorage` переживает. Supabase signUp redirect теряет URL params — `localStorage` страхует |
| 2 | Email-верификация при регистрации? | **Нет** — ни для invite, ни для обычной регистрации. `signUp` с `email_confirm: true` (пропуск verification). Welcome-email отправляем, но не блокируем доступ | Каждый redirect (открой почту → найди письмо → нажми) = 30-50% drop-off. Invite-код = proof of intent. Школьник 9-11 класса решает «попробовать или забить» за 60 сек |
| 3 | Account merge (Telegram → Email)? | **Phase 0: не мержить**. Ищем по email в profiles — нашли → привязываем. Telegram placeholder (`telegram_xxx@temp`) = отдельный профиль. Merge — P2 | Большинство учеников пилота — новые (Telegram заблокирован, через бот не регались). Merge задержит Phase 0 на 1-2 недели ради edge case |
| 4 | Email-транспорт? | **Lovable Custom Emails** — встроенная инфраструктура. `supabase/functions/send-transactional-email/`, React Email шаблоны, SPF/DKIM/DMARC из коробки, 100 emails/час, 50k/месяц | Zero-config, уже в экосистеме Lovable. Не нужен Resend/SendGrid аккаунт. Лимиты достаточны для пилота (5-10 репетиторов × 10 учеников). Docs: https://docs.lovable.dev/features/custom-emails |
| 5 | Web Push — своё или сервис? | **Своя реализация с VAPID на Supabase Edge Function**. `web-push` npm-пакет (3KB), VAPID key pair в env vars, `push_subscriptions` таблица | OneSignal/FCM = vendor lock-in + лишний SDK (~30KB). Для 50-100 учеников overkill. Своя реализация = полный контроль, минимум зависимостей |
| 6 | Safari iOS push — % на старых версиях? | **Не блокирует**. iOS 16.4+ покрывает ~90% устройств (вышла март 2023). Для остальных — email fallback | Целевая аудитория — школьники с обновляемыми телефонами. Каскад push → email покрывает 100% |
| 7 | Согласие на email по ФЗ-152? | **Не нужно отдельное согласие** для сервисных уведомлений. Нужен unsubscribe-link в каждом email → ведёт на «Управление уведомлениями» в профиле | «Репетитор назначил ДЗ» = сервисное, не реклама. Стандартная практика (Яндекс, СберКласс, Учи.ру). Регистрация = implicit consent на сервисные сообщения |

## Open Questions (осталось)

Все blocking-вопросы закрыты. Оставшиеся non-blocking вопросы будут решаться по ходу реализации.

---

## Timeline & Phasing

### Hard constraints

- **Telegram блокируется СЕЙЧАС** — каждый день без email-онбординга = потерянные ученики
- **Пилот с репетиторами** — репетиторы уже пытаются отправлять invite-ссылки, ученики не могут зарегистрироваться
- **ЕГЭ/ОГЭ приближаются** — каждая неделя без подготовки критична для учеников

### Рекомендуемый phasing

**Phase 0 (Sprint 1, ~1 неделя): UNBLOCK — Telegram-независимый онбординг**
- P0-ONBOARD-1: Новая invite-страница с email-регистрацией
- P0-ONBOARD-2: Добавление ученика по email
- P0-ONBOARD-3: Web-based tutor-student linking
- P0-ONBOARD-4: Email = primary auth
- P0-ONBOARD-5: Актуальные OG-теги

**Phase 1 (Sprint 2, ~1 неделя): Web Push + Email доставка**
- P0-PUSH-1: Web Push инфраструктура (VAPID, SW, `push_subscriptions`)
- P0-PUSH-2: Email-уведомления
- P0-PUSH-3: Каскадная логика доставки

**Phase 2 (Sprint 3, ~3-5 дней): Массовая отправка + статус**
- P1-GROUP-1: Массовая отправка группе
- P1-GROUP-2: Статус доставки в UI

**Phase 3 (Sprint 4, ~3-5 дней): Onboarding + напоминания**
- P1-1, P1-2, P1-3: Push onboarding, авто-напоминания, Telegram graceful degradation

### Dependencies

| Phase | Зависит от | Почему |
|-------|-----------|--------|
| Phase 1 | Phase 0 | Доставка бесполезна без учеников в системе |
| Phase 2 | Phase 1 | Массовая отправка нужна каскадная логика |
| Phase 3 | Phase 1 | Напоминания используют ту же каскадную логику |

---

## Техническая архитектура

### Phase 0: Web-based invite flow

```
Репетитор → копирует ссылку sokratai.ru/invite/ABC123
                                    │
                                    ▼
                          Invite Page (НОВАЯ)
                    ┌─────────────────────────────┐
                    │  «Вас пригласил Егор»        │
                    │                              │
                    │  [Email: _________ ]         │
                    │  [Пароль: ________ ]         │
                    │  [  Зарегистрироваться  ]    │
                    │                              │
                    │  Уже есть аккаунт? Войти     │
                    │                              │
                    │  ─── или через Telegram ───  │
                    │  [Открыть Telegram (VPN)]    │
                    └─────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
              Новый ученик    Существующий      Telegram
              (signUp)        (signIn)          (legacy)
                    │               │               │
                    ▼               ▼               ▼
              claim-invite    claim-invite    handleTutorInvite
              (edge fn)       (edge fn)       (bot handler)
                    │               │               │
                    ▼               ▼               ▼
              INSERT tutor_students {tutor_id, student_id}
                    │
                    ▼
              Redirect → /homework
              Ученик привязан к репетитору ✅
```

### Phase 1: Каскад доставки

```
handleNotifyStudents(assignment_id)
  │
  ├─ для каждого student_assignment:
  │   │
  │   ├─ 1. Есть push_subscription? ──→ Web Push API (VAPID)
  │   │      ├─ 201 OK → delivery_status = 'delivered_push'
  │   │      └─ 410 Gone (expired) → шаг 2
  │   │
  │   ├─ 2. Есть telegram_user_id? ──→ Telegram Bot API sendMessage
  │   │      ├─ OK → delivery_status = 'delivered_telegram'
  │   │      └─ 403/timeout → шаг 3
  │   │
  │   ├─ 3. Есть email? ──→ Email API (Resend/SendGrid)
  │   │      ├─ OK → delivery_status = 'delivered_email'
  │   │      └─ bounce → 'failed_email_bounce'
  │   │
  │   └─ 4. Ничего нет → 'failed_no_channel'
  │
  └─ return { delivered, failed, no_channel } counts
```

### Новые таблицы / изменения схемы

```sql
-- Новая таблица: push-подписки (Phase 1)
CREATE TABLE push_subscriptions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth_key text NOT NULL,
  user_agent text,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  active boolean DEFAULT true,
  UNIQUE(user_id, endpoint)
);

-- Расширение delivery_status enum (Phase 1)
-- Текущие: pending, delivered, failed_not_connected, failed_blocked_or_other
-- Добавить: delivered_push, delivered_email, failed_no_channel, failed_email_bounce

-- Новое поле (Phase 1)
ALTER TABLE homework_tutor_student_assignments
  ADD COLUMN delivery_channel text; -- 'push' | 'telegram' | 'email' | null
```

### Файлы для изменения

#### Phase 0 (онбординг)

| Файл | Изменения |
|------|-----------|
| `src/pages/InviteToTelegram.tsx` | **Полная переработка** → email-регистрация + web-linking. Переименовать в `InvitePage.tsx` |
| `src/components/tutor/AddStudentDialog.tsx` | `telegram_username` → опциональный. Добавить `email` поле |
| `supabase/functions/tutor-manual-add-student/index.ts` | Принимать `email` как альтернативу `telegram_username` |
| `src/pages/Login.tsx` | Email = primary, Telegram = secondary с hint про VPN |
| `index.html` | Обновить OG-теги (title, description, image) |
| `supabase/functions/claim-invite/index.ts` | **Новый** — web-based tutor-student linking |
| `src/utils/telegramLinks.ts` | Добавить `getInviteWebLink(inviteCode)` для web-ссылки |

#### Phase 1 (доставка)

| Файл | Изменения |
|------|-----------|
| `supabase/functions/homework-api/index.ts` | Расширить `handleNotifyStudents` → каскадная логика |
| `src/registerServiceWorker.ts` | Push event handlers (`push`, `notificationclick`) |
| `src/pages/tutor/TutorHomeworkDetail.tsx` | Статус доставки с каналами, retry |
| `src/components/homework/PushOptInBanner.tsx` | **Новый** — баннер подписки на push |
| `supabase/functions/send-push/index.ts` | **Новый** — Edge function для Web Push |
| `supabase/functions/send-transactional-email/index.ts` | Расширить существующую Lovable email функцию — добавить шаблон «Новое ДЗ» |
| Миграция | `push_subscriptions` таблица, delivery_status enum |

#### Phase 2-3 (группы + напоминания)

| Файл | Изменения |
|------|-----------|
| `src/pages/tutor/TutorHomeworkDetail.tsx` | Массовая отправка группе, retry-кнопка |
| `supabase/functions/homework-reminder/index.ts` | Расширить каскадом push → email |
