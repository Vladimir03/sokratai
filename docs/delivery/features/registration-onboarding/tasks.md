# Tasks: Registration & Onboarding Redesign

**Спека:** `docs/delivery/features/registration-onboarding/spec.md`
**Дата:** 2026-04-13
**Статус:** Sprint 1 completed

---

## Sprint 1: «Ученик может войти» (P0)

Итог по Sprint 1:
- TASK-1..TASK-7 реализованы
- `npm run build` — PASS
- `npm run smoke-check` — PASS
- `npm run lint` — repo-wide baseline FAIL, не блокирует именно эту фичу

### TASK-1: Миграция `profiles.last_sign_in_at` + триггер

**Job**: R4-1 (быстро добавить ученика и дать доступ)
**Agent**: Claude Code
**Files**:
- `supabase/migrations/YYYYMMDDHHMMSS_add_last_sign_in_to_profiles.sql` (новый)
**AC**: AC-6
**Зависимости**: нет (может начинаться первой)

Создать миграцию:
1. `ALTER TABLE profiles ADD COLUMN last_sign_in_at timestamptz DEFAULT NULL`
2. Trigger function `sync_last_sign_in()` (`SECURITY DEFINER`) — при UPDATE `last_sign_in_at` на `auth.users` копирует значение в `profiles`
3. Backfill: `UPDATE profiles SET last_sign_in_at = au.last_sign_in_at FROM auth.users au WHERE profiles.id = au.id AND au.last_sign_in_at IS NOT NULL`

---

### TASK-2: Генерация 4-значного пароля в `tutor-manual-add-student`

**Job**: R4-1, S1-0
**Agent**: Claude Code
**Files**:
- `supabase/functions/tutor-manual-add-student/index.ts`
**AC**: AC-1
**Зависимости**: нет

Изменения:
1. Заменить `crypto.randomUUID()` на `Math.floor(1000 + Math.random() * 9000).toString()` (4 цифры, 1000-9999)
2. Добавить в response body: `{ plain_password: string, login_email: string }` — email аккаунта (реальный или сгенерированный temp)
3. `plain_password` НЕ логировать, НЕ сохранять в БД — только в одноразовом response
4. Если ученик уже существует (existing user path) — `plain_password` не возвращать, вернуть `{ existing: true }` + `login_email`

---

### TASK-3: Компонент `StudentCredentialsModal`

**Job**: R4-1
**Agent**: Claude Code
**Files**:
- `src/components/tutor/StudentCredentialsModal.tsx` (новый)
**AC**: AC-2, AC-3
**Зависимости**: TASK-2 (формат response)

Модалка «Данные для входа ученика» (Radix Dialog):
1. Props: `{ open, onOpenChange, studentName, loginEmail, plainPassword }`
2. Три строки: «Страница входа: sokratai.ru/login», «Почта: {email}», «Пароль: {password}»
3. Primary CTA: «Скопировать для отправки» (`bg-accent text-white`) — `navigator.clipboard.writeText(formattedText)` + toast «Скопировано»
4. Secondary: «Закрыть»
5. Formatted text для копирования:
```
Страница входа в платформу:
https://sokratai.ru/login

Почта от аккаунта:
{email}

Пароль для входа:
{password}
```

UI правила:
- `rounded-xl` на Dialog (модалки = 12px)
- `text-base` (16px) на все текстовые поля
- Lucide `Copy` icon на кнопке копирования
- Пароль — `font-mono text-2xl font-bold` (крупно, чтобы было видно при показе на уроке)
- Не использовать emoji, не использовать framer-motion

---

### TASK-4: Интеграция модалки в `AddStudentDialog`

**Job**: R4-1
**Agent**: Claude Code
**Files**:
- `src/components/tutor/AddStudentDialog.tsx`
**AC**: AC-2
**Зависимости**: TASK-2, TASK-3

Изменения:
1. После успешного `tutor-manual-add-student` response — НЕ закрывать диалог, показать `StudentCredentialsModal`
2. State: `credentialsData: { studentName, loginEmail, plainPassword } | null`
3. При `response.existing === true` — показать toast «Ученик уже зарегистрирован, привязан к вашему кабинету» и НЕ показывать модалку с паролем
4. При закрытии `StudentCredentialsModal` — закрыть и основной `AddStudentDialog`, вызвать `invalidateQueries(['tutor', 'students'])`
5. Вкладка «По ссылке» — не трогать

---

### TASK-5: Расширение API students — activation и channels

**Job**: R4-1
**Agent**: Claude Code
**Files**:
- `src/lib/tutors.ts` или API, возвращающий список студентов
- `src/types/` — расширение типов
**AC**: AC-4, AC-5
**Зависимости**: TASK-1 (колонка `last_sign_in_at`)

Расширить response `handleGetStudents` (или соответствующий endpoint):
1. `last_sign_in_at: string | null` — из `profiles.last_sign_in_at`
2. `has_real_email: boolean` — email существует и НЕ `@temp.sokratai.ru` (через `auth.admin.getUserById`)
3. `has_telegram_bot: boolean` — `profiles.telegram_user_id IS NOT NULL`
4. `has_telegram_username: boolean` — `profiles.telegram_username IS NOT NULL AND telegram_username != ''`

**КРИТИЧНО**: НЕ добавлять `email` в SELECT из `profiles` — колонки нет (правило из `.claude/rules/70-notifications.md`). Email получать только через `auth.admin.getUserById`.

Расширить TS-тип `TutorStudent` (или аналог) additive полями.

---

### TASK-6: UI статуса активации + каналов на карточке ученика

**Job**: R4-1
**Agent**: Claude Code
**Files**:
- Компонент карточки ученика в tutor students page
**AC**: AC-4, AC-5
**Зависимости**: TASK-5

Добавить на карточку ученика:

1. **Badge статуса активации** (правый верхний угол):
   - `last_sign_in_at IS NULL` → серый badge: Lucide `AlertCircle` 14px + «Не входил»
   - `last_sign_in_at IS NOT NULL` → зелёный badge: Lucide `CheckCircle` 14px + «Активирован»
   - Мелким текстом дата: `Последний вход: {formatDate(last_sign_in_at)}`

2. **Каналы связи** (под основной инфой):
   - Email: Lucide `Mail` + email text + status icon
     - `has_real_email` → `CheckCircle` зелёный
     - иначе → `XCircle` серый + текст «Email не указан»
   - Telegram: Lucide `MessageCircle` + username + status icon
     - `has_telegram_bot` → `CheckCircle` зелёный
     - `has_telegram_username && !has_telegram_bot` → `AlertTriangle` жёлтый (amber-500) + tooltip «Бот не привязан»
     - иначе → `XCircle` серый + текст «Telegram не указан»

UI правила из design system:
- Lucide icons, НЕ emoji (anti-pattern #1)
- `text-sm` (14px) для каналов
- `React.memo` на карточке (performance.md)
- `aria-label` на status icons для accessibility

---

### TASK-7: Кнопка «Данные для входа» на карточке → reset password

**Job**: R4-1
**Agent**: Claude Code
**Files**:
- Компонент карточки ученика
- `supabase/functions/tutor-manual-add-student/index.ts` (или новый endpoint)
**AC**: AC-2 (повторный доступ)
**Зависимости**: TASK-3, TASK-6

1. Кнопка «Данные для входа» на карточке ученика (secondary, Lucide `KeyRound`)
2. При клике — вызов backend endpoint «сбросить пароль»:
   - Генерирует новый 4-значный пароль
   - `auth.admin.updateUserById(userId, { password: newPassword })`
   - Возвращает `{ plain_password, login_email }`
3. Показать `StudentCredentialsModal` с новыми данными
4. Toast «Пароль сброшен» при успехе

---

### TASK-8: Smoke test + Safari QA

**Job**: все
**Agent**: Claude Code
**Files**: нет новых
**AC**: все AC-1..AC-6
**Зависимости**: TASK-1..TASK-7

1. `npm run lint && npm run build && npm run smoke-check`
2. Проверить: добавить ученика → модалка с паролем → скопировать → войти с паролем
3. Проверить: карточка ученика показывает «Не входил» → после входа → «Активирован»
4. Проверить: каналы связи корректно отображаются
5. Safari-специфичное: `text-base` на inputs в модалке, `touch-action: manipulation` на кнопках

Статус выполнения:
- `build` — PASS
- `smoke-check` — PASS
- `lint` — FAIL на существующих несвязанных ошибках репозитория; feature-level issue в `supabaseClient.ts` исправлен

---

## Sprint 2: «Без паролей» (P1)

### TASK-9: Google OAuth

**Job**: S1-0, R4-1
**Agent**: Claude Code
**Files**: `src/pages/Login.tsx`, `src/pages/TutorLogin.tsx`, Supabase Dashboard config
**AC**: (P1 — определяются в Phase 2 spec)

### TASK-10: Страница `/register-tutor`

**Job**: R4
**Agent**: Claude Code
**Files**: `src/pages/RegisterTutor.tsx` (новый), edge function
**AC**: (P1)

### TASK-11: AddStudentDialog не закрывается (для групп)

**Job**: R4-1
**Agent**: Claude Code
**Files**: `src/components/tutor/AddStudentDialog.tsx`
**AC**: (P1)

---

## Sprint 3: «Полировка» (P2)

### TASK-12: Welcome-экран при первом входе

### TASK-13: Авто-email с данными для входа

### TASK-14: Кнопка «Сбросить пароль» в профиле ученика (tutor-side)

---

## Copy-paste промпты для агентов

### TASK-1: Миграция

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ
- wedge: быстро собрать ДЗ и новую практику по теме урока
- продукт = workspace / bundle: AI + база + домашки + материалы
- AI = draft + action, а не generic chat

Сначала обязательно прочитай:
1. CLAUDE.md
2. .claude/rules/70-notifications.md (правило «profiles НЕ содержит email»)
3. docs/delivery/features/registration-onboarding/spec.md (Section 5: Data Model)

Задача: создать SQL-миграцию для `profiles.last_sign_in_at`.

Что сделать:
1. Создать файл `supabase/migrations/YYYYMMDDHHMMSS_add_last_sign_in_to_profiles.sql`
2. ALTER TABLE profiles ADD COLUMN last_sign_in_at timestamptz DEFAULT NULL
3. Создать trigger function `sync_last_sign_in()` (SECURITY DEFINER) — при UPDATE last_sign_in_at на auth.users копирует в profiles
4. CREATE TRIGGER trg_sync_last_sign_in AFTER UPDATE OF last_sign_in_at ON auth.users FOR EACH ROW EXECUTE FUNCTION sync_last_sign_in()
5. Backfill: UPDATE profiles SET last_sign_in_at = au.last_sign_in_at FROM auth.users au WHERE profiles.id = au.id AND au.last_sign_in_at IS NOT NULL

Acceptance Criteria:
- AC-6: При входе ученика через signInWithPassword() триггер копирует auth.users.last_sign_in_at в profiles.last_sign_in_at
- Backfill не ломает существующие данные
- Миграция идемпотентна (IF NOT EXISTS где возможно)

Guardrails:
- НЕ добавлять колонку email в profiles
- НЕ менять существующие триггеры на profiles
- НЕ менять RLS policies

В конце:
1. Список изменённых файлов
2. Краткое описание реализации
3. npm run lint && npm run build && npm run smoke-check
```

### TASK-2: 4-значный пароль

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ
- wedge: быстро собрать ДЗ и новую практику по теме урока
- продукт = workspace / bundle: AI + база + домашки + материалы

Сначала обязательно прочитай:
1. CLAUDE.md
2. supabase/functions/tutor-manual-add-student/index.ts (текущий код — пойми flow целиком)
3. docs/delivery/features/registration-onboarding/spec.md (Section 5: API)

Задача: заменить UUID-пароль на 4-значный при ручном добавлении ученика.

Что сделать в supabase/functions/tutor-manual-add-student/index.ts:
1. Найти место где генерируется пароль (crypto.randomUUID() или аналог)
2. Заменить на: Math.floor(1000 + Math.random() * 9000).toString() — ровно 4 цифры, 1000-9999
3. Добавить в response body два поля: plain_password (string) и login_email (string — email аккаунта)
4. Если ученик уже существует (existing user path) — НЕ возвращать plain_password, вернуть { existing: true, login_email }
5. plain_password НЕ логировать и НЕ сохранять в БД

Acceptance Criteria:
- AC-1: При ручном добавлении backend возвращает plain_password — строку из 4 цифр (1000-9999). Auth user создаётся с этим паролем. Ученик может войти с этим паролем на /login
- Response body содержит login_email (реальный или @temp.sokratai.ru email)
- Для existing user: response содержит { existing: true } без plain_password

Guardrails:
- НЕ менять logic добавления в tutor_students
- НЕ менять logic создания profile
- НЕ менять другие edge functions
- НЕ логировать пароль

В конце:
1. Список изменённых файлов
2. Краткое описание
3. npm run lint && npm run build && npm run smoke-check
```

### TASK-3 + TASK-4: Модалка + интеграция

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ
- wedge: быстро собрать ДЗ и новую практику по теме урока
- UX Principle 14: First Value in 3 Minutes — регистрация ≤30 сек

Сначала обязательно прочитай:
1. CLAUDE.md
2. .claude/rules/90-design-system.md (цвета, кнопки, модалки)
3. .claude/rules/80-cross-browser.md (Safari правила: text-base на inputs, touch-action)
4. .claude/rules/performance.md (запрет framer-motion)
5. docs/delivery/features/registration-onboarding/spec.md (Section 6: UX/UI)
6. src/components/tutor/AddStudentDialog.tsx (текущий код)

Задача: создать StudentCredentialsModal и интегрировать в AddStudentDialog.

Шаг 1 — создать src/components/tutor/StudentCredentialsModal.tsx:
- Radix Dialog (или shadcn Dialog)
- Props: { open: boolean, onOpenChange: (open: boolean) => void, studentName: string, loginEmail: string, plainPassword: string }
- Содержимое: «Данные для входа ученика» title, три строки (страница входа, почта, пароль)
- Пароль: font-mono text-2xl font-bold (крупно, видно при показе на уроке)
- Primary CTA: «Скопировать для отправки» (bg-accent text-white, Lucide Copy icon)
  - navigator.clipboard.writeText(formattedText) + toast «Скопировано»
- Secondary: «Закрыть»
- Форматированный текст:
  Страница входа в платформу:\nhttps://sokratai.ru/login\n\nПочта от аккаунта:\n{email}\n\nПароль для входа:\n{password}
- rounded-xl на Dialog, text-base на текстовые элементы
- НЕ emoji, НЕ framer-motion

Шаг 2 — интегрировать в AddStudentDialog.tsx:
- State: credentialsData: { studentName, loginEmail, plainPassword } | null
- После успешного response от tutor-manual-add-student:
  - Если response.existing === true → toast «Ученик уже зарегистрирован» + НЕ показывать модалку
  - Иначе → setCredentialsData({ name, response.login_email, response.plain_password })
- При закрытии StudentCredentialsModal → закрыть AddStudentDialog, invalidateQueries(['tutor', 'students'])
- Вкладку «По ссылке» НЕ трогать

Acceptance Criteria:
- AC-2: После успешного добавления показывается модалка с email + password. Диалог не закрывается автоматически
- AC-3: Кнопка «Скопировать» копирует formatted text в clipboard + toast
- Single primary CTA (design system: одна primary кнопка на экране)
- text-base (16px) на inputs/text (Safari iOS auto-zoom)
- touch-action: manipulation на кнопках

Guardrails:
- НЕ менять вкладку «По ссылке»
- НЕ менять backend (уже сделано в TASK-2)
- НЕ использовать emoji в UI
- НЕ использовать framer-motion

Self-check:
- Проверь .claude/rules/90-design-system.md — primary = bg-accent text-white, secondary = bg-white border-slate-200
- Проверь .claude/rules/80-cross-browser.md — text-base на текстовых полях
- Проверь docs 16 (UX principles) — One Screen = One Primary Job

В конце:
1. Список изменённых файлов
2. Краткое описание
3. npm run lint && npm run build && npm run smoke-check
4. Какие docs нужно обновить (если нужно)
```

### TASK-5 + TASK-6: API students + UI карточки

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ
- wedge: быстро собрать ДЗ и новую практику по теме урока
- Репетитор = primary buyer, ему нужно видеть кто из учеников активирован

Сначала обязательно прочитай:
1. CLAUDE.md
2. .claude/rules/70-notifications.md (КРИТИЧНО: profiles НЕ содержит email)
3. .claude/rules/90-design-system.md (карточки, badge, иконки)
4. .claude/rules/80-cross-browser.md (Safari)
5. .claude/rules/performance.md (React.memo на list items)
6. docs/delivery/features/registration-onboarding/spec.md (Section 5: API, Section 6: UI)
7. src/lib/tutors.ts или код загрузки списка учеников
8. Компонент карточки ученика (найди через grep «StudentCard» или аналог)

Задача: расширить API students данными о каналах + показать на карточке.

Шаг 1 — Backend (API расширение):
- В endpoint/функцию, возвращающую список students для tutor, добавить 4 поля:
  - last_sign_in_at: string | null — из profiles.last_sign_in_at (TASK-1 миграция)
  - has_real_email: boolean — email НЕ @temp.sokratai.ru (через auth.admin.getUserById)
  - has_telegram_bot: boolean — profiles.telegram_user_id IS NOT NULL
  - has_telegram_username: boolean — profiles.telegram_username IS NOT NULL AND != ''
- КРИТИЧНО: НЕ делать profiles.select("email") — колонки нет! Использовать auth.admin.getUserById
- Расширить TS-тип в src/types/ или src/lib/

Шаг 2 — Frontend (карточка ученика):
- Badge статуса активации (правый верхний угол карточки):
  - last_sign_in_at === null → серый: Lucide AlertCircle + «Не входил»
  - last_sign_in_at !== null → зелёный (text-accent): Lucide CheckCircle + «Активирован»
  - Мелким текстом (text-xs text-slate-400): дата последнего входа через formatDate из src/lib/formatters.ts

- Каналы связи (под основной инфой, text-sm):
  - Email row: Lucide Mail + email (если has_real_email) + CheckCircle зелёный. Если !has_real_email → XCircle серый + «Email не указан»
  - Telegram row: Lucide MessageCircle + username + status:
    - has_telegram_bot → CheckCircle зелёный
    - has_telegram_username && !has_telegram_bot → AlertTriangle amber-500 + title «Бот не привязан»
    - neither → XCircle серый + «Telegram не указан»

- aria-label на всех status icons (accessibility)
- React.memo на компоненте карточки
- НЕ emoji, НЕ framer-motion
- Lucide icons с aria-hidden="true" + aria-label на parent span

Acceptance Criteria:
- AC-4: Badge «Не входил» если last_sign_in_at IS NULL, «Активирован» если NOT NULL. Дата мелким текстом
- AC-5: Email и Telegram каналы с правильными состояниями. Lucide icons, не emoji
- API не ломает существующий flow загрузки студентов
- React.memo на карточке

Guardrails:
- НЕ добавлять email в profiles SELECT
- НЕ менять Student domain компоненты (Student/Tutor изоляция)
- НЕ использовать emoji в UI chrome
- НЕ использовать framer-motion
- Проверить React Query key convention: ['tutor', 'students'] — не ломать tutorStudentCacheSync

В конце:
1. Список изменённых файлов
2. Краткое описание
3. npm run lint && npm run build && npm run smoke-check
4. Self-check: icons = Lucide (не emoji), memo = обёрнут, text-base где нужно
```

### TASK-7: Кнопка «Данные для входа» + reset password

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ
- Задача: репетитор потерял данные ученика → нужно сбросить пароль и увидеть новые данные

Сначала обязательно прочитай:
1. CLAUDE.md
2. .claude/rules/90-design-system.md
3. docs/delivery/features/registration-onboarding/spec.md
4. src/components/tutor/StudentCredentialsModal.tsx (уже создан в TASK-3)
5. supabase/functions/tutor-manual-add-student/index.ts

Задача: кнопка «Данные для входа» на карточке ученика → сброс пароля → модалка.

Шаг 1 — Backend:
- Новый endpoint или расширение существующего: POST reset-student-password
- Принимает student_id, проверяет что текущий tutor = владелец (через tutor_students)
- Генерирует новый 4-значный пароль: Math.floor(1000 + Math.random() * 9000).toString()
- auth.admin.updateUserById(userId, { password: newPassword })
- Возвращает { plain_password, login_email }

Шаг 2 — Frontend:
- Кнопка «Данные для входа» на карточке ученика (secondary button, Lucide KeyRound)
- При клике: confirmation toast «Будет сгенерирован новый пароль» (или сразу без подтверждения, т.к. действие безвредно)
- Вызов API → при успехе → показать StudentCredentialsModal с новыми данными
- Toast «Пароль сброшен» при успехе

Acceptance Criteria:
- Кнопка «Данные для входа» видна на карточке каждого ученика
- Клик генерирует новый 4-значный пароль на backend
- Модалка показывает новый пароль + email
- Копирование работает (AC-3)

Guardrails:
- НЕ показывать старый пароль (его нет в БД)
- НЕ хранить plain-text пароль в БД
- Проверить что tutor = владелец ученика (security)
- secondary button, НЕ primary (primary = «Добавить ученика»)

В конце:
1. Список изменённых файлов
2. npm run lint && npm run build && npm run smoke-check
```

### TASK-8: Smoke test + Safari QA

```
Твоя роль: QA engineer в проекте SokratAI.

Прочитай:
1. CLAUDE.md
2. docs/delivery/features/registration-onboarding/spec.md

Задача: запустить validation и проверить end-to-end flow.

1. npm run lint
2. npm run build
3. npm run smoke-check

Если какой-то шаг fails — остановись, опиши ошибку, не чини самостоятельно.

Проверить вручную (если dev server доступен):
- Открыть /tutor/students → добавить ученика → увидеть модалку → скопировать → закрыть
- Карточка нового ученика: «Не входил» + каналы
- text-base (16px) на inputs модалки
- touch-action: manipulation на кнопках

В конце: report PASS / FAIL с деталями.
```
