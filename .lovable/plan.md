# План: быстрая авторизация и фиксация согласия

## Часть 1. Способы быстрой регистрации для РФ

### Что уже есть
- Email + пароль
- Telegram Login (через `TutorTelegramLoginButton` / `TelegramLoginButton`) — уже основной «быстрый» способ для РФ, работает без VPN через бота `@sokrat_rep_bot`

### Что добавляем
**1) Google OAuth (через Lovable Cloud — managed)**
- Самый частый запрос. В РФ работает у большинства пользователей (Google Accounts не блокируется на уровне ISP, в отличие от части сервисов Google).
- Используем нативную интеграцию Lovable Cloud: вызов `lovable.auth.signInWithOAuth("google", { redirect_uri: ... })`. API ключи не нужны — Cloud управляет credentials.
- Кнопка появляется и на `/signup` (студент), и на `/signup?ref=tutor-landing&trial=7` (репетитор-trial), и на `/register-tutor`.

**2) VK ID (рекомендация для РФ как доп.)**
- В Lovable Cloud / Supabase **нативно НЕ поддерживается** (только Google, Apple, SAML SSO нативно). Чтобы добавить VK ID, нужно либо:
  - (a) подключить внешний Supabase и настроить через Custom OAuth provider — это серьёзная переделка инфраструктуры,
  - (b) реализовать VK ID Web SDK на фронте + кастомная edge-функция, которая обменивает VK access_token на сессию Supabase через `signInWithIdToken`. Это ~2-3 дня работы + регистрация приложения в VK ID Console.
- **Рекомендация:** в этой итерации **не делаем VK ID** (большой объём + риски), а ставим Google + усиливаем существующий Telegram login. Если конверсия Google окажется низкой — возвращаемся к VK отдельной задачей.

**Что НЕ добавляем и почему:**
- Apple Sign In — для РФ-аудитории низкий охват среди репетиторов, основной flow — desktop Chrome.
- Yandex ID — нативно не поддерживается, та же история что и VK.
- Сбер ID / Mail.ru — нативно не поддерживается.

### Где разместить кнопки
На обеих страницах (`SignUp.tsx` и `TutorSignupTrial.tsx`):
1. Google (новая кнопка, primary social)
2. Telegram (уже есть, остаётся)
3. Email + пароль (форма ниже под разделителем «или»)

Порядок: социальные сверху → разделитель → email-форма. Это стандарт и снижает трение.

### Технические детали (Google)
- Lovable Cloud сам управляет Google OAuth — никаких ключей у пользователя не запрашиваем.
- На странице используется `lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/tutor/home" })` (для tutor-trial) и `redirect_uri: ".../chat"` (для студента).
- После редиректа `onAuthStateChange` в `TutorSignupTrial` уже ловит `SIGNED_IN` и применяет `applyTrialMarker` + `assign-tutor-role` нужно вызвать после OAuth-возврата (для tutor flow) — добавим в обработчик `SIGNED_IN`, если у пользователя ещё нет tutor-роли.
- Для студенческого `SignUp.tsx` — после возврата делаем `claimPendingInvite()` и редирект на `/chat`.

## Часть 2. Чекбокс «Я согласен…» с фиксацией в БД

### Текущее состояние
В `TutorSignupTrial.tsx`:
- Поле `oferta` уже существует в state и схеме (`z.literal(true)`), но **в JSX чекбокса нет** — стоит дефолт `useState(true)`, т.е. согласие считается данным автоматически. Это юридически слабо.

### Что меняем
**Frontend (TutorSignupTrial.tsx):**
- Меняем дефолт `useState(false)`.
- Рендерим реальный `<input type="checkbox">` с лейблом «Я согласен с [публичной офертой] и [политикой конфиденциальности]» и ссылками на `/offer` и `/privacy-policy` (открываются в новой вкладке).
- Кнопка submit `disabled` пока `oferta !== true`.
- Текст ошибки рядом, если пользователь снял галку.

**Frontend (SignUp.tsx — студенческий):**
- Добавляем такое же поле `consent`, чекбокс и валидацию.

**База данных — миграция:**
Добавляем в `profiles`:
```
consent_accepted_at      timestamptz NULL
consent_version          text NULL          -- например 'v1-2026-05'
consent_source           text NULL          -- 'web-signup-tutor' | 'web-signup-student' | 'google-oauth' | 'telegram-oauth'
```
Индекса не нужно. NULL для существующих профилей (legacy — отдельная задача дать им принять при следующем входе, но сейчас вне scope).

**Запись согласия:**
- После успешного `auth.signUp` (email-flow) — делаем `update profiles set consent_accepted_at=now(), consent_version='v1-2026-05', consent_source=...`.
- Для Google/Telegram OAuth — пользователь должен поставить галочку **до** клика по социальной кнопке. Если галка снята — кнопки disabled. После возврата с OAuth в `onAuthStateChange(SIGNED_IN)` пишем согласие в БД (флаг хранится в `sessionStorage` между редиректами, ключ `pending_consent_v1` с timestamp+source, читается и удаляется после записи).

**Edge function НЕ нужна** — RLS «Users can update their own profile» уже разрешает пользователю писать в свою строку.

### Текстовка чекбокса
> ☐ Я согласен с [публичной офертой](/offer) и [политикой конфиденциальности](/privacy-policy)

Без галочки — кнопки регистрации (все три: Email, Google, Telegram) серые и неактивны.

## Файлы, которые изменим

**Создаём:**
- `supabase/migrations/<timestamp>_add_profile_consent_columns.sql`

**Редактируем:**
- `src/pages/TutorSignupTrial.tsx` — рендер чекбокса, дефолт `false`, gating всех CTA, запись в БД, новая Google-кнопка
- `src/pages/SignUp.tsx` — добавляем чекбокс согласия + Google-кнопка
- `src/pages/RegisterTutor.tsx` — добавляем Google-кнопку (там форма для существующих flow)

**Не трогаем:**
- `TelegramLoginButton`, `TutorTelegramLoginButton` — внутренности; только обернём вызов проверкой согласия на стороне страницы
- `src/integrations/supabase/client.ts`, `src/lib/supabaseClient.ts` — auto/hardcoded, не редактируем
- Edge functions

## Вопрос на согласование
1. Подтверди, что **VK ID** в этой итерации **не делаем** (только Google + текущий Telegram).
2. Подтверди, что согласие **обязательно** (CTA disabled без галки), а не «по умолчанию принято».

После подтверждения переключаюсь в режим имплементации.
