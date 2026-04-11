# Telegram Bot & Onboarding

## Мобильная отметка оплат через Telegram (Sprint «Mobile Pay»)

- Репетитор может отметить оплату прямо из Telegram-бота, не открывая кабинет
- Команда `/pay` в боте → список должников с кнопками по ученикам
- Нажатие на ученика → кнопки по каждому занятию с реальной датой урока (`tutor_lessons.start_at`)
- Нажатие на дату → оплата отмечена, кабинет обновляется при следующем открытии

### Дата занятия — единый источник
- **Кабинет** (`TutorPayments.tsx`): primary `tutor_lessons.start_at`, fallback `tutor_payments.due_date`
- **Бот** (`/pay` flow): то же самое — RPC возвращает `lesson_start_at`
- `tutor_payments.due_date` = `CURRENT_DATE` при создании платежа (≠ дата занятия!). **Никогда не показывай `due_date` как "дату занятия"** без проверки `lesson_start_at`

### Callback-формат (Telegram, ≤64 байт)
- `paym_list` — показать/обновить список должников
- `paym_s:{tutor_student_id}` — детали ученика (44 байта ✓)
- `paym_ok:{payment_id}` — отметить одну оплату (45 байт ✓)
- `paym_oks:{tutor_student_id}` — отметить все оплаты ученика (46 байт ✓)
- Не пересекаются с существующими `payment:` и `payment_remind:` callback-ами

### Вспомогательные функции в боте
- `formatLessonDate(row)` — русский короткий формат «21 февраля»
- `formatRub(amount)` — форматирование суммы в рублях
- `getPendingPaymentsByTelegram(telegramUserId)` — обёртка над RPC
- Все `paym_*` handlers зарегистрированы в `handleCallbackQuery` **до** блока `payment_remind:` / `payment:`

## Web invite flow (Phase 0 onboarding, 2026-03-26)

Telegram заблокирован в РФ → invite-ссылка ведёт на web-регистрацию, не на Telegram-бота.

### Ключевые файлы
- `src/pages/InvitePage.tsx` — invite-страница (`/invite/:code`)
- `src/lib/inviteApi.ts` — `claimInvite(code)` и `claimPendingInvite()`
- `supabase/functions/claim-invite/index.ts` — edge function: JWT → tutor_students link
- `src/pages/Login.tsx`, `src/pages/SignUp.tsx` — `claimPendingInvite()` после email auth
- `src/components/TelegramLoginButton.tsx` — `claimPendingInvite()` после `setSession()`

### Claim flow
- **InvitePage**: после auth → `claimInvite(inviteCode)` напрямую. При ошибке → fallback в `localStorage('pending_invite_code')`
- **Login/SignUp/Telegram**: после auth → `claimPendingInvite()` читает localStorage, вызывает claim, чистит при успехе
- **Non-blocking**: ошибка claim не блокирует вход
- **Terminal errors**: 400/404 → localStorage чистится. 5xx/network → остаётся для retry
- **Идемпотентность**: повторный claim → `already_linked` (200)

## AddStudentDialog — email поле (Phase 5, 2026-03-26)

Репетитор может добавить ученика по email (альтернатива telegram_username). Хотя бы одно из двух обязательно.

### Invite link parity (2026-04-11)
- Во вкладке `По ссылке` в `AddStudentDialog.tsx` QR-код должен кодировать **тот же web invite URL**, что и кнопка `Копировать ссылку`
- Не кодировать в QR Telegram deep link `t.me/.../start=tutor_<invite_code>` для tutor invite dialog
- Telegram deep link остаётся допустимым только как secondary / fallback path на `InvitePage.tsx`

### Логика edge function (email path)
1. Поиск auth user по email через `auth.admin.getUserByEmail()`
2. Если найден → использовать его id. Если profile отсутствует — создать
3. Если не найден → `admin.createUser({ email, email_confirm: true, password: random })`
4. Race-safe: unique constraint violation → fallback select

## Надёжность Telegram-бота (2026-04-04)

### Защита от silent failures
- Все message routing ветки (text/photo/voice) имеют `else` с `safeSendError` — бот **ВСЕГДА** отвечает пользователю, даже если нет сессии или онбординг не завершён
- Top-level `catch`: отправляет ошибку пользователю. Если доставка удалась → HTTP 200 (Telegram не ретраит). Если нет → HTTP 500 (Telegram ретраит)
- `safeSendError()` — обёртка `sendTelegramMessage` в try-catch, чтобы ошибка доставки error message не ломала flow

### fetchChatWithTimeout — единый вызов AI
- **ВСЕ** вызовы `/functions/v1/chat` проходят через `fetchChatWithTimeout` (private, group, button flows)
- Таймаут: `TELEGRAM_CHAT_TIMEOUT_MS` (55 сек) через `AbortController`
- Retry: 1 повтор через 2 сек — и на network errors, и на HTTP 5xx
- При исчерпании попыток — fallback сообщение пользователю, return null
- **НЕ ДОБАВЛЯТЬ** прямые `fetch` к `/functions/v1/chat` мимо этой функции

### mergeConsecutiveUserMessages — лимит длины (2026-04-04)
- Склеивает последовательные user-сообщения через `\n\n` для корректного turn-taking
- `MERGED_MESSAGE_MAX_CHARS = 8000` — при превышении обрезает начало, сохраняя последний контекст
- `chat/index.ts` валидирует `MAX_MESSAGE_LENGTH = 10000` — **НЕ СНИЖАТЬ** ниже `MERGED_MESSAGE_MAX_CHARS`
- **История бага**: при лимите 2000 бот возвращал «Произошла ошибка» на длинных диалогах — склеенные сообщения превышали лимит

### sendTypingLoop — безопасный typing indicator
- `sendTypingLoop()` ловит ошибки `fetch` внутри себя (try-catch в цикле)
- Typing indicator — non-critical; его сбой **НЕ ДОЛЖЕН** ломать основной flow
- **НЕ НУЖНО** добавлять `.catch(() => {})` на call site

### Формат ответов Telegram-бота (2026-04-04)
- `responseProfile: "telegram_compact"` — компактный формат для Telegram
- `buildTelegramCompactAppendix()` в `chat/index.ts` задаёт стиль: естественный сократический диалог
- **Жёсткий шаблон «Идея/Мини-шаг/Вопрос» УДАЛЁН** — бот отвечает в свободной форме, как веб-чат
- `parseTelegramBlocks()` разбирает структуру ответа, но **НЕ навязывает** 3-блочный формат
- `TELEGRAM_DIALOG_MAX_CHARS = 1000` (было 700) — лимит символов для dialog mode

## Telegram-бот — команда /homework удалена (2026-03-27, дочищено 2026-04-06)

Команда `/homework` и весь classic-режим ДЗ в боте **полностью удалены**.

- Команды `/homework` и `/cancel` удалены из меню бота (`setMyCommands`)
- State machine ДЗ (`HW_SELECTING`, `HW_SUBMITTING`, `HW_CONFIRMING`, `HW_REVIEW`) и вся поддиректория `supabase/functions/telegram-bot/homework/` **удалены полностью** вместе с удалением classic режима (миграция `20260406120000_drop_classic_homework.sql`)
- Фото от ученика вне guided-контекста обрабатывается обычным `handlePhotoMessage` (веб-чат)
- `homework-reminder` отправляет web-ссылку на `/student/homework` вместо `/homework`
- После деплоя бота необходимо вызвать `?action=set_commands` для обновления меню
