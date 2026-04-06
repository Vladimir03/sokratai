# Промпты для реализации: Phase 0 — Telegram-независимый онбординг

**Tasks:** `docs/features/specs/phase0-onboarding-tasks.md`
**PRD:** `docs/features/specs/homework-multichannel-delivery-prd.md`
**Прототип:** `docs/features/specs/phase0-prototype.html`
**Дата:** 2026-03-26

---

## Оглавление

1. [Phase 1 — Claude Code: OG-теги + invite page](#phase-1)
2. [Phase 1 — Codex Review](#phase-1-review)
3. [Phase 2 — Claude Code: Edge function claim-invite](#phase-2)
4. [Phase 2 — Codex Review](#phase-2-review)
5. [Phase 3 — Claude Code: Интеграция invite + claim](#phase-3)
6. [Phase 3 — Codex Review](#phase-3-review)
7. [Phase 4 — Claude Code: Login/SignUp email primary](#phase-4)
8. [Phase 4 — Codex Review](#phase-4-review)
9. [Phase 5 — Claude Code: AddStudentDialog + edge function](#phase-5)
10. [Phase 5 — Codex Review](#phase-5-review)
11. [Phase 6 — Codex: Финальный e2e review](#phase-6-review)

---

<a id="phase-1"></a>
## Phase 1 — Claude Code: OG-теги + новая invite-страница

```text
Твоя роль: senior product-minded frontend engineer в проекте SokratAI.

Нужно реализовать Phase 1: обновить OG-теги и переписать invite-страницу с Telegram-first на email-first.

Контекст проблемы:
- Telegram заблокирован в России с февраля 2026 (~80-90% недоступен без VPN).
- Текущая invite-страница (InviteToTelegram.tsx) показывает ТОЛЬКО QR к Telegram-боту — ученик без Telegram не может зарегистрироваться.
- Текущие OG-теги показывают «математика ЕГЭ» — устарело (целевой сегмент: физика ЕГЭ/ОГЭ).
- Без починки онбординга — пилот невозможен (репетитор не может завести учеников).

Контекст продукта:
- Сегмент: репетиторы по физике ЕГЭ/ОГЭ
- Wedge: быстро собрать ДЗ и новую практику по теме урока
- Пользователи: школьники 14-18 лет, iPhone + Safari, Android + Chrome

Сначала обязательно прочитай:
1. docs/features/specs/phase0-onboarding-tasks.md (Phase 1: задачи 1.1, 1.2, 1.3)
2. docs/features/specs/homework-multichannel-delivery-prd.md (Phase 0 requirements)
3. CLAUDE.md (секции: кросс-браузерная совместимость, preview parity, performance)
4. src/pages/InviteToTelegram.tsx (текущая реализация — понять структуру)
5. src/pages/SignUp.tsx (переиспользовать паттерн валидации пароля)
6. src/utils/telegramLinks.ts (getTutorInviteTelegramLink)

Задачи Phase 1:

Задача 1.1: Обновить OG-теги в index.html
- Заменить og:title на «Сократ — AI-помощник для подготовки к ЕГЭ и ОГЭ»
- Заменить og:description — добавить физику
- Добавить og:url и og:site_name
- Обновить <title> и <meta name="description"> аналогично
- Обновить Twitter card теги
- НЕ трогать: Yandex Metrika, preconnect, modulepreload, inline CSS

Задача 1.2: Переписать InviteToTelegram.tsx → InvitePage.tsx
- Переименовать файл: InviteToTelegram.tsx → InvitePage.tsx
- Новый layout:
  - Заголовок: «Вас пригласил репетитор {Имя}» (fetch tutor по invite_code — как сейчас)
  - Основной CTA: форма email-регистрации (имя + email + пароль) + кнопка «Зарегистрироваться»
  - Переключатель: «Уже есть аккаунт? Войти» → форма входа (email + пароль)
  - Collapsed секция внизу: «Или подключитесь через Telegram» с QR + пометкой «нужен VPN»
- Auth:
  - Регистрация: supabase.auth.signUp({ email, password, options: { data: { full_name } } }) — без email-верификации
  - Вход: supabase.auth.signInWithPassword({ email, password })
- После успешной auth: localStorage.setItem('pending_invite_code', inviteCode) — фактический claim будет в Phase 3
- Success state: «✅ Вы привязаны к репетитору {Имя}» (визуально, claim ещё не реализован)
- Валидация: email формат, пароль min 8 chars + 1 uppercase + 1 digit, имя min 2 chars
- Error states: невалидный code, email занят, неверный пароль

Задача 1.3: Обновить router
- Заменить import InviteToTelegram → InvitePage в App.tsx (или route config)
- Route /invite/:code → <InvitePage />
- Lazy loading с Suspense
- Удалить старый файл InviteToTelegram.tsx

КРИТИЧНО (из CLAUDE.md):
- font-size ≥ 16px на ВСЕХ input и textarea (iOS Safari zoom prevention)
- touch-action: manipulation на всех кнопках
- НЕ использовать sessionStorage — очищается на iOS при переключении табов. ТОЛЬКО localStorage
- НЕ использовать crypto.randomUUID() (Safari < 15.4)
- НЕ использовать framer-motion (performance.md)
- Structural breakpoints: md: для layout, НЕ sm:
- НЕ добавлять npm-зависимости (zod уже есть)

Что НЕ делать:
- Не менять TelegramLoginButton.tsx
- Не менять telegram-bot/index.ts
- Не создавать claim-invite edge function (Phase 2)
- Не менять Login.tsx / SignUp.tsx (Phase 4)
- Не менять AddStudentDialog.tsx (Phase 5)
- Не добавлять email-верификацию
- Не менять AuthGuard/TutorGuard

После реализации:
1. npm run lint
2. npm run build
3. npm run smoke-check

В конце дай:
1. changed files (index.html, InvitePage.tsx, App.tsx routes, удалён InviteToTelegram.tsx)
2. что сделано
3. что осталось (Phase 2-6)
4. validation results
5. self-check: OG теги обновлены? Email primary? Telegram collapsed? localStorage? font-size 16px?
```

---

<a id="phase-1-review"></a>
## Phase 1 — Codex Review

```text
Сделай code review реализации Phase 1: OG-теги + новая invite-страница.

Контекст:
- Telegram заблокирован в России, ученики не могут зарегистрироваться через текущую invite-страницу.
- Phase 1 = OG-теги + переписать InviteToTelegram → InvitePage с email-first.

Сначала прочитай:
1. docs/features/specs/phase0-onboarding-tasks.md (Phase 1)
2. docs/features/specs/homework-multichannel-delivery-prd.md (P0-ONBOARD-1, P0-ONBOARD-5)
3. CLAUDE.md (кросс-браузерная совместимость)

Проверь изменённые файлы:
- index.html
- src/pages/InvitePage.tsx (новый, заменяет InviteToTelegram.tsx)
- App.tsx (routes)

Проверь:

1. OG-теги:
   - og:title содержит «Сократ» и «ЕГЭ и ОГЭ»?
   - og:description упоминает физику?
   - og:url = https://sokratai.ru?
   - og:site_name = Сократ?
   - <title> и <meta name="description"> синхронизированы?
   - Twitter card обновлён?

2. InvitePage:
   - Fetch tutor по invite_code (как было в InviteToTelegram)?
   - Email-регистрация = primary CTA (сверху)?
   - Telegram = collapsed секция внизу с «нужен VPN»?
   - Два режима: регистрация (имя + email + пароль) и вход (email + пароль)?
   - Переключатель между режимами?
   - signUp() без email-верификации?
   - signInWithPassword() для входа?
   - Валидация: email, пароль (8 chars, 1 upper, 1 digit), имя (2 chars)?
   - localStorage('pending_invite_code') после auth?
   - Success state видимый?
   - Error states: невалидный code, email занят, неверный пароль?

3. Safari/iOS:
   - font-size ≥ 16px на всех input?
   - touch-action: manipulation на кнопках?
   - Нет crypto.randomUUID?
   - Нет sessionStorage?
   - Нет framer-motion?

4. Router:
   - Route /invite/:code → InvitePage?
   - Lazy load + Suspense?
   - Старый InviteToTelegram удалён?
   - Нет broken imports?

5. Не сломано:
   - Login.tsx не тронут?
   - TelegramLoginButton не тронут?
   - AuthGuard не тронут?

Формат ответа:
- Executive summary
- Must fix (blocking)
- Should fix
- Nice to have
- Safari compatibility: PASS / FAIL
- Mobile UX: PASS / FAIL
```

---

<a id="phase-2"></a>
## Phase 2 — Claude Code: Edge function claim-invite

```text
Твоя роль: senior backend engineer в проекте SokratAI (Supabase Edge Functions, Deno).

Нужно реализовать Phase 2: новую Edge function claim-invite для web-based tutor-student linking.

Контекст:
- Сейчас привязка ученик→репетитор работает ТОЛЬКО через Telegram-бот (handleTutorInvite).
- Нужен веб-аналог: ученик регистрируется через invite-ссылку → вызывается claim-invite → создаётся tutor_students link.
- Telegram заблокирован в России — web-linking критичен.

Сначала прочитай:
1. docs/features/specs/phase0-onboarding-tasks.md (Phase 2: задачи 2.1, 2.2)
2. supabase/functions/telegram-bot/index.ts — функцию handleTutorInvite (lines ~1476-1564) — повторить логику linking
3. supabase/functions/tutor-manual-add-student/index.ts — паттерн CORS, JWT, error handling
4. CLAUDE.md

Задачи Phase 2:

Задача 2.1: Создать supabase/functions/claim-invite/index.ts
- POST endpoint, verify_jwt: true
- Body: { invite_code: string }
- Логика:
  1. Получить user_id из JWT (getUser)
  2. Найти tutor по invite_code
  3. Проверить: tutor_students link уже есть? → return 200 'already_linked' (идемпотентность)
  4. Создать tutor_students link (status: 'active')
  5. Обновить profiles.registration_source = 'invite_web' (если null)
  6. Return 200 { status: 'linked', tutor_name }
- Errors: 400 (no code), 404 (invalid code), 401 (no JWT), 500 (DB error)
- CORS headers как в tutor-manual-add-student

Задача 2.2: Создать src/lib/inviteApi.ts (client helper)
- claimInvite(inviteCode) → supabase.functions.invoke('claim-invite')
- claimPendingInvite() → проверить localStorage, вызвать claim, очистить при успехе
- При ошибке claim — НЕ чистить localStorage (retry)
- TypeScript, без any

Паттерны из существующего кода:
- CORS: используй тот же паттерн что в tutor-manual-add-student (corsHeaders, OPTIONS handler)
- JWT: supabaseClient.auth.getUser() — как в других функциях
- Service role: для insert в tutor_students используй service_role client
- Response format: JSON с status code

Что НЕ делать:
- Не менять telegram-bot (handleTutorInvite остаётся как есть)
- Не менять RLS на tutor_students
- Не добавлять email-рассылку
- Не менять generate_invite_code()
- Не менять фронтенд (Phase 3)

После реализации:
1. npm run lint
2. npm run build
3. npm run smoke-check

В конце дай:
1. changed/created files
2. что сделано
3. validation results
4. self-check: JWT работает? Идемпотентность? CORS? Error codes?
```

---

<a id="phase-2-review"></a>
## Phase 2 — Codex Review

```text
Сделай code review реализации Phase 2: Edge function claim-invite + client helper.

Сначала прочитай:
1. docs/features/specs/phase0-onboarding-tasks.md (Phase 2)
2. supabase/functions/telegram-bot/index.ts — handleTutorInvite (эталонная логика linking)
3. supabase/functions/tutor-manual-add-student/index.ts (паттерн edge function)

Проверь файлы:
- supabase/functions/claim-invite/index.ts (новый)
- src/lib/inviteApi.ts (новый)

Проверь:

1. Edge function:
   - POST only + OPTIONS (CORS)?
   - verify_jwt: true?
   - getUser() для получения user_id?
   - Поиск tutor по invite_code (eq, single)?
   - Идемпотентность: existing link → 200 already_linked?
   - Insert tutor_students: tutor_id, student_id, status 'active'?
   - Update profiles.registration_source (только если null)?
   - Error handling: 400, 404, 401, 500?
   - Service role client для DB операций?
   - CORS headers на всех responses?

2. Client helper:
   - claimInvite() — invoke('claim-invite', { body })?
   - claimPendingInvite() — localStorage read, claim, cleanup?
   - При ошибке НЕ чистит localStorage?
   - TypeScript, без any?

3. Security:
   - Нельзя привязать себя к чужому аккаунту? (user_id из JWT, не из body)
   - Rate limiting? (Supabase default OK для MVP)
   - Invite code не раскрывает информацию о репетиторе до auth?

4. Совместимость с handleTutorInvite:
   - Та же логика linking (tutor_students insert)?
   - Не конфликтует (один ученик может быть привязан и через бот, и через web)?

Формат ответа:
- Executive summary
- Must fix
- Should fix
- Security check
```

---

<a id="phase-3"></a>
## Phase 3 — Claude Code: Интеграция invite + claim

```text
Твоя роль: senior product-minded frontend engineer в проекте SokratAI.

Нужно реализовать Phase 3: интеграция invite-страницы с claim-invite edge function.

Phase 1 (InvitePage) и Phase 2 (claim-invite) уже реализованы. Теперь нужно:
1. На invite-странице — после auth сразу вызывать claimInvite()
2. На Login/SignUp — после auth проверять pending_invite_code и вызывать claimPendingInvite()

Сначала прочитай:
1. docs/features/specs/phase0-onboarding-tasks.md (Phase 3: задачи 3.1, 3.2)
2. src/pages/InvitePage.tsx (Phase 1)
3. src/lib/inviteApi.ts (Phase 2)
4. src/pages/Login.tsx (текущая auth-логика)
5. src/pages/SignUp.tsx (текущая auth-логика)

Задачи Phase 3:

Задача 3.1: InvitePage — вызов claimInvite после auth
- Файл: src/pages/InvitePage.tsx
- После signUp() или signInWithPassword() → вызвать claimInvite(inviteCode)
- При успехе → показать «✅ Вы привязаны к репетитору {tutor_name}» + кнопка «Перейти к ДЗ»
- При ошибке → localStorage fallback + redirect на /homework
- Убрать визуальный «success» из Phase 1 если он был фейковый (без реального claim)

Задача 3.2: Login.tsx + SignUp.tsx — claimPendingInvite
- Файлы: src/pages/Login.tsx, src/pages/SignUp.tsx
- После успешной auth (email или Telegram) → await claimPendingInvite()
- Non-blocking: ошибка claim не блокирует вход
- Если нет pending_invite — no-op
- НЕ менять UI Login.tsx (это Phase 4) — только добавить вызов claim

КРИТИЧНО:
- claimPendingInvite() — non-blocking (try/catch, не блокирует redirect)
- localStorage, НЕ sessionStorage
- Нет race condition: claim вызывается ПОСЛЕ session установлена

Что НЕ делать:
- Не менять UI Login.tsx / SignUp.tsx (Phase 4)
- Не менять AuthGuard
- Не менять redirect-логику (tutor vs student)

После реализации:
1. npm run lint
2. npm run build
3. npm run smoke-check

В конце дай:
1. changed files
2. что сделано
3. validation results
4. self-check: claim вызывается после auth? localStorage cleanup? Non-blocking?
```

---

<a id="phase-3-review"></a>
## Phase 3 — Codex Review

```text
Сделай code review реализации Phase 3: интеграция invite + claim-invite.

Сначала прочитай:
1. docs/features/specs/phase0-onboarding-tasks.md (Phase 3)

Проверь файлы:
- src/pages/InvitePage.tsx
- src/pages/Login.tsx
- src/pages/SignUp.tsx
- src/lib/inviteApi.ts

Проверь:

1. InvitePage:
   - После signUp → claimInvite(inviteCode)?
   - После signIn → claimInvite(inviteCode)?
   - Success state с tutor_name от backend?
   - Error → localStorage fallback?

2. Login.tsx / SignUp.tsx:
   - claimPendingInvite() вызывается после auth?
   - Non-blocking (try/catch)?
   - Работает и для email, и для Telegram auth?
   - UI НЕ изменён?

3. Race conditions:
   - Claim вызывается ПОСЛЕ session установлена?
   - Нет параллельных вызовов claim?
   - localStorage cleanup при успехе?

4. Edge cases:
   - Уже привязан → already_linked → не ломается?
   - Невалидный invite_code в localStorage → ошибка не блокирует?
   - Redirect после claim корректен?

Формат ответа:
- Executive summary
- Must fix
- Should fix
```

---

<a id="phase-4"></a>
## Phase 4 — Claude Code: Login/SignUp email primary

```text
Твоя роль: senior product-minded frontend engineer в проекте SokratAI.

Нужно реализовать Phase 4: сделать email основным способом входа на Login.tsx и SignUp.tsx.

Контекст:
- Telegram заблокирован в России — кнопка «Войти через Telegram» уводит в тупик (polling без ответа).
- Сейчас Telegram primary («Рекомендуем»), email secondary.
- Нужно: email сверху (primary), Telegram снизу (secondary) с пометкой «нужен VPN».

Сначала прочитай:
1. docs/features/specs/phase0-onboarding-tasks.md (Phase 4: задачи 4.1, 4.2)
2. src/pages/Login.tsx
3. src/pages/SignUp.tsx
4. CLAUDE.md (кросс-браузерная совместимость)

Задачи Phase 4:

Задача 4.1: Login.tsx — email primary
- Переместить email-форму ВЫШЕ separator «или»
- Переместить TelegramLoginButton НИЖЕ separator
- Убрать текст «Рекомендуем — не нужен пароль» у Telegram
- Добавить мелкий текст под Telegram: «Или войдите через Telegram (нужен VPN)»
- Telegram timeout hint: 30 секунд polling → показать «Telegram может быть недоступен. Попробуйте войти по email ↑»
  - useState showTelegramHint: false
  - setTimeout 30000 после клика на Telegram → setShowTelegramHint(true)
  - Очистить timeout при unmount

Задача 4.2: SignUp.tsx — email primary
- Аналогично: email сверху, Telegram снизу
- Пометка «нужен VPN» на Telegram
- Убрать акцент на Telegram если есть

КРИТИЧНО:
- НЕ менять TelegramLoginButton.tsx (компонент, не layout)
- НЕ менять redirect-логику (tutor routing)
- НЕ менять auth calls (signIn, signUp)
- font-size ≥ 16px на input

Что НЕ делать:
- Не менять AddStudentDialog (Phase 5)
- Не менять invite page (Phase 1-3)
- Не менять backend

После реализации:
1. npm run lint
2. npm run build
3. npm run smoke-check

В конце дай:
1. changed files (Login.tsx, SignUp.tsx)
2. что сделано
3. validation results
4. self-check: Email сверху? Telegram снизу? «нужен VPN»? Timeout hint?
```

---

<a id="phase-4-review"></a>
## Phase 4 — Codex Review

```text
Сделай code review реализации Phase 4: Login/SignUp email primary.

Сначала прочитай:
1. docs/features/specs/phase0-onboarding-tasks.md (Phase 4)
2. CLAUDE.md

Проверь файлы:
- src/pages/Login.tsx
- src/pages/SignUp.tsx

Проверь:

1. Login.tsx:
   - Email-форма СВЕРХУ (перед separator)?
   - Telegram СНИЗУ (после separator)?
   - «Рекомендуем» убран?
   - «нужен VPN» добавлен?
   - 30с timeout → hint «Telegram может быть недоступен»?
   - Timeout cleanup при unmount?
   - Redirect логика не сломана?
   - TelegramLoginButton props не изменены?

2. SignUp.tsx:
   - Email primary (сверху)?
   - Telegram secondary с «нужен VPN»?

3. claimPendingInvite из Phase 3:
   - Всё ещё вызывается после auth?
   - Не сломан переносом UI?

4. Safari/iOS:
   - font-size ≥ 16px на input?
   - touch-action: manipulation?

Формат ответа:
- Executive summary
- Must fix
- Should fix
```

---

<a id="phase-5"></a>
## Phase 5 — Claude Code: AddStudentDialog + edge function

```text
Твоя роль: senior full-stack engineer в проекте SokratAI.

Нужно реализовать Phase 5: добавить email-поле в AddStudentDialog и обновить edge function tutor-manual-add-student.

Контекст:
- Сейчас репетитор может добавить ученика ТОЛЬКО по telegram_username (обязательное поле).
- Если ученик зарегистрировался по email — он «невидим» для репетитора.
- Нужно: email как альтернатива telegram_username (хотя бы одно из двух).

Сначала прочитай:
1. docs/features/specs/phase0-onboarding-tasks.md (Phase 5: задачи 5.1, 5.2, 5.3)
2. src/components/tutor/AddStudentDialog.tsx (текущая реализация)
3. supabase/functions/tutor-manual-add-student/index.ts (текущая edge function)
4. src/types/tutor.ts (ManualAddTutorStudentInput)
5. src/lib/tutors.ts (manualAddTutorStudent function)
6. CLAUDE.md

Задачи Phase 5:

Задача 5.1: AddStudentDialog — email поле
- Файл: src/components/tutor/AddStudentDialog.tsx
- Вкладка «Добавить вручную»:
  - Новое поле: email (type="email", опциональное)
  - telegram_username: стало опциональным (было обязательное)
  - Валидация: хотя бы одно из email / telegram_username заполнено
  - Подсказка: «Рекомендуем указать email — Telegram может быть недоступен»
  - Email validation (формат)
- font-size ≥ 16px на input (iOS)

Задача 5.2: Обновить tutor-manual-add-student
- Файл: supabase/functions/tutor-manual-add-student/index.ts
- Принять email в body (optional string)
- Валидация: email || telegram_username обязателен
- Логика по email:
  - Поиск существующего профиля по email в profiles
  - Если найден → использовать его id
  - Если не найден → создать через admin.createUser({ email, email_confirm: true, password: randomPassword })
  - Создать tutor_students link
- Backward compatible: вызовы без email продолжают работать

Задача 5.3: Типы и API-клиент
- src/types/tutor.ts: telegram_username → optional, добавить email?: string
- src/lib/tutors.ts: manualAddTutorStudent() — передать email в edge function

КРИТИЧНО:
- НЕ менять вкладку «Пригласить по ссылке» (уже переделана в Phase 1)
- НЕ менять вкладку «Поделиться» (если есть)
- Backward compatible: telegram_username продолжает работать
- Student/Tutor isolation: изменения только в tutor компонентах + edge function

Что НЕ делать:
- Не менять invite-страницу (Phase 1-3)
- Не менять Login/SignUp (Phase 4)
- Не добавлять email-рассылку при добавлении ученика (future phase)
- Не менять TelegramLoginButton

После реализации:
1. npm run lint
2. npm run build
3. npm run smoke-check

В конце дай:
1. changed files
2. что сделано
3. validation results
4. self-check: Email поле работает? Telegram optional? Backend принимает email? Types обновлены?
```

---

<a id="phase-5-review"></a>
## Phase 5 — Codex Review

```text
Сделай code review реализации Phase 5: AddStudentDialog + tutor-manual-add-student.

Сначала прочитай:
1. docs/features/specs/phase0-onboarding-tasks.md (Phase 5)
2. CLAUDE.md

Проверь файлы:
- src/components/tutor/AddStudentDialog.tsx
- supabase/functions/tutor-manual-add-student/index.ts
- src/types/tutor.ts
- src/lib/tutors.ts

Проверь:

1. AddStudentDialog:
   - Email поле добавлено?
   - telegram_username опциональное?
   - Валидация: хотя бы одно заполнено?
   - Email format валидация?
   - Подсказка «Рекомендуем email»?
   - font-size ≥ 16px?

2. Edge function:
   - Принимает email?
   - Ищет существующий профиль по email?
   - Создаёт placeholder при необходимости?
   - Backward compatible?
   - Error handling?

3. Types:
   - telegram_username optional?
   - email optional?
   - manualAddTutorStudent передаёт email?

4. Security:
   - Нет email injection?
   - admin.createUser() — только service_role?
   - Дубликаты обрабатываются?

Формат ответа:
- Executive summary
- Must fix
- Should fix
- Backward compatibility: PASS / FAIL
```

---

<a id="phase-6-review"></a>
## Phase 6 — Codex: Финальный e2e review всей Phase 0

```text
Сделай финальный end-to-end code review всей Phase 0: Telegram-независимый онбординг.

Контекст:
- Telegram заблокирован в России с февраля 2026.
- Phase 0 делает онбординг Telegram-независимым: email-регистрация, web-linking, email primary.
- 5 requirements реализованы в 5 фазах.

Сначала прочитай:
1. docs/features/specs/phase0-onboarding-tasks.md (полностью)
2. docs/features/specs/homework-multichannel-delivery-prd.md (Phase 0 requirements)
3. CLAUDE.md

Проверь ВСЕ изменённые файлы:
- index.html (OG-теги)
- src/pages/InvitePage.tsx (переписанная invite-страница)
- supabase/functions/claim-invite/index.ts (новая edge function)
- src/lib/inviteApi.ts (новый client helper)
- src/pages/Login.tsx (email primary)
- src/pages/SignUp.tsx (email primary)
- src/components/tutor/AddStudentDialog.tsx (email поле)
- supabase/functions/tutor-manual-add-student/index.ts (email support)
- src/types/tutor.ts (updated types)
- src/lib/tutors.ts (email в API call)
- App.tsx (routes)

Комплексная проверка:

1. E2E Flow — новый ученик через invite:
   - Репетитор копирует ссылку → ученик открывает → видит «Вас пригласил {Имя}»?
   - Регистрация email + пароль → signUp без верификации?
   - claimInvite() → tutor_students link создан?
   - Redirect на /homework?
   - В кабинете репетитора ученик появился?

2. E2E Flow — существующий ученик:
   - Открывает invite → входит по email → claimInvite() → привязан?

3. E2E Flow — Login/SignUp:
   - claimPendingInvite() после auth?
   - Email primary, Telegram secondary?
   - 30с timeout hint?

4. E2E Flow — добавление вручную:
   - Email поле работает? Telegram optional?
   - Backend создаёт placeholder?
   - Backward compatible (только telegram)?

5. Safari/iOS:
   - ВСЕ input: font-size ≥ 16px?
   - ВСЕ кнопки: touch-action: manipulation?
   - localStorage (не sessionStorage)?
   - Нет crypto.randomUUID, Array.at, RegExp lookbehind?
   - Нет framer-motion?

6. Architecture:
   - Student/Tutor isolation соблюдена?
   - Telegram-бот НЕ изменён?
   - AuthGuard/TutorGuard НЕ изменены?
   - Нет новых npm-зависимостей?
   - Performance: lazy load на InvitePage?

7. Security:
   - claim-invite: user_id из JWT (не из body)?
   - Идемпотентность: повторный claim → 200?
   - Email validation на frontend И backend?
   - Нет email injection?
   - CORS headers?

8. PRD compliance:
   - P0-ONBOARD-1: ✓ Новая invite page?
   - P0-ONBOARD-2: ✓ Email в AddStudent?
   - P0-ONBOARD-3: ✓ claim-invite edge function?
   - P0-ONBOARD-4: ✓ Email primary login?
   - P0-ONBOARD-5: ✓ OG-теги обновлены?

Формат ответа:
- Executive summary: все 5 requirements реализованы?
- Must fix (blocking)
- Should fix
- Nice to have
- Safari compatibility: PASS / FAIL
- Mobile UX: PASS / FAIL
- Security: PASS / FAIL
- Backward compatibility: PASS / FAIL
- Рекомендация: ready to deploy / needs fixes
```
