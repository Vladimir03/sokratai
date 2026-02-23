# SokratAI — Гайд для AI-агентов (Claude Code, Cursor, Lovable)

## Быстрый старт для Claude Code

Этот файл остаётся основным контекстом проекта. Для коротких и стабильных правил используй:

- `.claude/rules/00-read-first.md`
- `.claude/rules/10-safe-change-policy.md`
- `.claude/rules/20-commands-and-validation.md`
- `docs/engineering/architecture/README.md` и `docs/engineering/architecture/modules.json`

Минимальный порядок работы:

1. Прочитай `AGENTS.md`, `CLAUDE.md`, `docs/engineering/overview/codebase.md`, `docs/engineering/architecture/README.md`.
2. Делай минимальные и целевые изменения без затрагивания несвязанных областей.
3. Не меняй бизнес-логику, auth-flow и публичные API без явного требования задачи.
4. Перед завершением прогоняй команды последовательно:

```bash
npm run dev
npm run lint
npm run build
npm run test
npm run smoke-test
npm run smoke-check
```

Примечание: `test` запускает `smoke-check` (Node-based проверка), `smoke-test` оставлен как bash-вариант.

## Архитектура проекта

- **Стек**: Vite + React 18 + TypeScript + Tailwind CSS + shadcn/ui
- **Backend**: Supabase (Auth, Database, RPC, Storage)
- **State**: React Query (TanStack) + custom hooks, без Redux/Zustand
- **Роутинг**: React Router v6, все страницы — lazy-loaded

## Две роли в продукте

Проект обслуживает **две изолированные группы пользователей**:

### Ученик (Student)
- Маршруты: `/chat`, `/practice`, `/diagnostic`, `/homework/*`, `/progress`, `/profile`
- Guard: `AuthGuard` (проверка сессии + онбординг)
- Ключевые компоненты: `src/pages/Chat.tsx`, `src/components/ChatMessage.tsx`, `src/components/GraphRenderer.tsx`
- Ключевые хуки: `useSubscription`, `usePractice`, `useDiagnostic`
- Тяжёлые зависимости: Pyodide (Python в браузере), KaTeX, react-markdown, framer-motion

### Репетитор (Tutor)
- Guard: `TutorGuard` (проверка `is_tutor()` RPC с **module-level кешем** авторизации, TTL 10 мин)
- **ВАЖНО**: Каждая tutor-страница монтирует собственный `<TutorGuard>`. Кеш на уровне модуля делает переключение между вкладками мгновенным (без повторного RPC)
- **ОБЯЗАТЕЛЬНО**: каждая tutor-страница оборачивается в `<TutorLayout>` — это даёт боковую навигацию кабинета. Страница без `TutorLayout` сломает UI
- Ключевые компоненты: `src/pages/tutor/*`, `src/components/tutor/*`
- Ключевые хуки: `useTutor`, `useTutorStudents`, `useTutorPayments` (из `src/hooks/useTutor.ts`)
- Тяжёлые зависимости: нет (лёгкие страницы)
- **Google Calendar интеграция отключена**: в `TutorSchedule` нет кнопок/импорта Google Calendar, edge functions `google-calendar-oauth` и `google-calendar-import` удалены из кода и `supabase/config.toml`

#### Полная таблица tutor-маршрутов

| Маршрут | Файл | Описание |
|---------|------|----------|
| `/tutor/dashboard` | `TutorDashboard.tsx` | Главная кабинета |
| `/tutor/students` | `TutorStudents.tsx` | Список учеников |
| `/tutor/students/:id` | `TutorStudentProfile.tsx` | Профиль ученика |
| `/tutor/schedule` | `TutorSchedule.tsx` | Расписание + настройки |
| `/tutor/payments` | `TutorPayments.tsx` | Платежи |
| `/tutor/homework` | `TutorHomework.tsx` | Список ДЗ |
| `/tutor/homework/create` | `TutorHomeworkCreate.tsx` | Создание ДЗ |
| `/tutor/homework/:id` | `TutorHomeworkDetail.tsx` | Детали ДЗ |
| `/tutor/homework/:id/results` | `TutorHomeworkResults.tsx` | Результаты ДЗ, `?submission=` авто-раскрывает строку |

## КРИТИЧЕСКИЕ ПРАВИЛА

### 1. Изоляция Student ↔ Tutor
- **НИКОГДА** не добавляй импорты tutor-модулей в student-компоненты и наоборот
- **НИКОГДА** не модифицируй `AuthGuard.tsx` при работе над tutor-функционалом
- **НИКОГДА** не модифицируй `TutorGuard.tsx` при работе над student-функционалом
- Общие компоненты (`src/components/ui/*`) должны оставаться **лёгкими** — без тяжёлых зависимостей
- Если нужен общий компонент — он должен быть в `src/components/` (не в `tutor/` и не в `practice/`)

### 2. Производительность (< 2 секунды загрузка)
- **ЗАПРЕЩЕНО** добавлять `framer-motion` в компоненты `src/components/ui/*` (Button, Card, Badge и т.д.)
  - Причина: эти компоненты используются ВЕЗДЕ, `framer-motion` (~50KB) попадает в каждый чанк
  - Используй CSS transitions/animations (`transition-all`, `animate-*`) вместо framer-motion
  - framer-motion допустим ТОЛЬКО в страничных компонентах (`src/pages/*`) и feature-компонентах
- **ЗАПРЕЩЕНО** добавлять тяжёлые библиотеки (recharts, framer-motion, pyodide) в shared-компоненты
- Все новые страницы ОБЯЗАНЫ использовать `React.lazy()` + `Suspense`
- Тяжёлые компоненты ОБЯЗАНЫ грузиться лениво (`React.lazy`, dynamic import)

### 2a. Supabase API — быстрые вызовы
- **`getSession()`** — читает из локального кеша (мгновенно, без сетевого запроса). Используй для получения `user.id` в hot-path
- **`getUser()`** — делает сетевой запрос к Supabase Auth (медленно). Используй ТОЛЬКО когда нужна свежая серверная верификация
- **ПРАВИЛО**: в `src/lib/tutors.ts` и `src/lib/tutorSchedule.ts` для получения user.id использовать ТОЛЬКО `getSession()`
- **Guard-компоненты** (`TutorGuard`, `AuthGuard`) должны кешировать результат проверки ролей, чтобы переход между вкладками был мгновенным
- **`visibilitychange` обработчик** — обязателен в guard-компонентах для восстановления сессии после бездействия пользователя (2+ минуты)
- **Исключение**: `src/hooks/useTutorAccess.ts` вызывает `getUser()` — это намеренно (условный рендер навигации, не guard-логика). **Не копировать этот паттерн** в новый код.

### 2b. tutors.ts vs tutorSchedule.ts — правило разделения
- **Вся логика уроков / слотов / бронирования** живёт **ТОЛЬКО** в `src/lib/tutorSchedule.ts`
- `src/lib/tutors.ts` содержит лишь ре-экспорт функций из `tutorSchedule.ts` (последний блок файла) — не дублируй туда новую логику
- Добавляя новую функцию расписания/уроков: пиши в `tutorSchedule.ts`, при необходимости добавляй ре-экспорт в `tutors.ts`

### 2c. React Query key-конвенция (tutor)
- **Обязательный префикс** для всех tutor-запросов: `['tutor', entity, ...params]`
- Примеры: `['tutor','students']`, `['tutor','student', id]`, `['tutor','payments']`, `['tutor','lessons']`, `['tutor','homework','assignments', filter]`
- Отклонение от конвенции **ломает** `tutorStudentCacheSync.ts` (`applyTutorStudentPatchToCache`, `invalidateTutorStudentDependentQueries`)
- Перед добавлением нового tutor-query сверяйся с `src/lib/tutorStudentCacheSync.ts` — там перечислены все ключи для инвалидации

### 3. Bundle Splitting
Vite конфигурация разделяет бандл на чанки:
- `react-vendor` — React, ReactDOM, React Router
- `ui-components` — Radix UI примитивы
- `supabase` — Supabase клиент
- `math-rendering` — KaTeX, react-markdown
- `animations` — framer-motion (отдельный чанк!)
- Tutor-страницы автоматически попадают в отдельные чанки благодаря lazy loading

### 4. Работа с общими UI-компонентами (`src/components/ui/`)
- Это базовые shadcn/ui компоненты
- Они должны зависеть ТОЛЬКО от: React, Radix UI, class-variance-authority, tailwind-merge, clsx
- НИКАКИХ тяжёлых зависимостей (framer-motion, recharts, katex, etc.)
- Если нужна анимация — используй Tailwind CSS (`animate-bounce`, `transition-all duration-200`, etc.)

### 5. Типы — канонический источник
- Все разделяемые TypeScript-типы живут в **`src/types/`**: `tutor.ts`, `homework.ts`, `practice.ts`, `diagnostic.ts`, `solution.ts`
- **Не объявляй** локальные интерфейсы в компонентах для данных, которые используются в нескольких местах — расширяй типы в `src/types/`

### 6. Форматирование дат и валюты
- Канонический источник: **`src/lib/formatters.ts`** — функции форматирования дат, валюты, прогресса
- Всегда используй `parseISO` из `date-fns` для разбора строк дат (не `new Date(string)` — ломается в Safari)
- `hourly_rate_cents` / суммы платежей хранятся в копейках (integer). Деление на 100 только при отображении — используй `formatPaymentAmount` из `formatters.ts`

## Структура файлов

```
src/
├── pages/                       # Страницы (все lazy-loaded)
│   ├── Chat.tsx                 # Чат с ИИ (student)
│   ├── Practice.tsx             # Практика (student)
│   ├── Diagnostic.tsx           # Диагностика (student)
│   ├── BookLesson.tsx           # Публичное бронирование /book/:bookingLink
│   ├── RegisterTutor.tsx        # Регистрация репетитора /register-tutor
│   ├── TutorLogin.tsx           # Вход репетитора /tutor/login
│   ├── Admin.tsx                # Панель администратора /admin
│   ├── MiniApp.tsx              # Telegram WebApp
│   ├── tutor/                   # ← ВСЕ tutor-страницы тут
│   │   ├── TutorDashboard.tsx
│   │   ├── TutorStudents.tsx
│   │   ├── TutorStudentProfile.tsx
│   │   ├── TutorSchedule.tsx
│   │   ├── TutorPayments.tsx
│   │   ├── TutorHomework.tsx
│   │   ├── TutorHomeworkCreate.tsx
│   │   ├── TutorHomeworkDetail.tsx
│   │   └── TutorHomeworkResults.tsx
│   └── ...
├── components/
│   ├── ui/                      # shadcn/ui (ЛЁГКИЕ, без тяжёлых deps!)
│   ├── tutor/                   # Tutor-specific компоненты
│   │   └── TutorDataStatus.tsx  # Мягкий error-recovery UI (использовать в новых tutor-страницах)
│   ├── practice/                # Practice-specific компоненты
│   ├── diagnostic/              # Diagnostic-specific компоненты
│   ├── admin/                   # Admin-specific компоненты
│   ├── AuthGuard.tsx            # Guard для студентов
│   ├── TutorGuard.tsx           # Guard для репетиторов
│   └── ...общие компоненты
├── hooks/
│   ├── useTutor.ts              # ВСЕ tutor-хуки
│   ├── tutorQueryOptions.ts     # Общие настройки React Query для tutor-запросов
│   ├── useTutorHomework.ts      # Tutor homework хуки
│   ├── useTutorAccess.ts        # ИСКЛЮЧЕНИЕ: использует getUser() — только для Navigation
│   ├── useSubscription.ts       # Подписки (student)
│   ├── usePractice.ts           # Практика (student)
│   └── ...
├── lib/
│   ├── supabaseClient.ts        # Supabase клиент
│   ├── tutors.ts                # Tutor бизнес-логика + ре-экспорт из tutorSchedule
│   ├── tutorSchedule.ts         # ИСТОЧНИК ИСТИНЫ: уроки, слоты, серии, бронирование
│   ├── tutorHomeworkApi.ts      # Homework API клиент + storage helpers (parseStorageRef, toStorageRef)
│   ├── tutorStudentCacheSync.ts # React Query cache sync для tutor-студентов
│   ├── paymentAmount.ts         # calculateLessonPaymentAmount() — единый расчёт суммы
│   ├── formatters.ts            # Форматирование дат/валюты/прогресса — канонический источник
│   └── utils.ts                 # Общие утилиты
├── types/                       # Канонические TypeScript-типы
│   ├── tutor.ts
│   ├── homework.ts
│   ├── practice.ts
│   ├── diagnostic.ts
│   └── solution.ts
└── utils/
    ├── pyodide.ts               # Python в браузере (student only!)
    ├── chatCache.ts             # Кеш чата (student only!)
    └── ...
```

## Чеклист перед коммитом

При работе над **student**-функционалом:
- [ ] Tutor-страницы (`/tutor/*`) открываются без ошибок
- [ ] `TutorGuard` не затронут изменениями
- [ ] Shared UI-компоненты не получили тяжёлых зависимостей

При работе над **tutor**-функционалом:
- [ ] Чат (`/chat`) открывается и загружается быстро
- [ ] Python-графики отображаются в чате
- [ ] `AuthGuard` не затронут изменениями
- [ ] Shared UI-компоненты не получили тяжёлых зависимостей
- [ ] Переход между вкладками кабинета репетитора — мгновенный (кеш `tutorAuthCache` не сломан)
- [ ] После 2-3 минут бездействия переход на другую вкладку работает без зависания
- [ ] В `TutorSchedule` не появляется UI Google Calendar (интеграция отключена)
- [ ] Новая tutor-страница оборачивается в `<TutorLayout>` и добавлена в таблицу маршрутов выше
- [ ] Новый tutor React Query key начинается с `['tutor', ...]`

При работе над **любым** функционалом:
- [ ] `bun run build` завершается без ошибок
- [ ] `bun run smoke-test` проходит без ошибок
- [ ] Нет новых тяжёлых зависимостей в `src/components/ui/`
- [ ] Все новые страницы используют `React.lazy()` в `App.tsx`
- [ ] Нет случайных изменений в файлах, не связанных с задачей
- [ ] Нет запрещённых паттернов Safari/iOS (см. раздел «Кросс-браузерная совместимость»)
- [ ] Input/textarea/select имеют `font-size >= 16px` (иначе Safari iOS зумит)
- [ ] Не используются `100vh` (используй `100dvh` или `-webkit-fill-available`)
- [ ] Даты парсятся через `date-fns` или ISO-формат с разделителем `T`

## Известные хрупкие области

1. **Chat.tsx** (2000+ строк) — очень сложный компонент. Любые изменения в ChatMessage, ChatInput, ChatSidebar могут сломать чат
2. **Pyodide/GraphRenderer** — Python-графики. Зависит от CDN, может ломаться при изменениях в ChatMessage
3. **AuthGuard / TutorGuard** — guard-компоненты. Изменение может заблокировать доступ для всех пользователей. **TutorGuard** имеет module-level кеш (`tutorAuthCache`) — НЕ УДАЛЯТЬ, иначе переключение вкладок станет медленным (is_tutor RPC с retry до 6 секунд на каждый переход)
4. **Navigation.tsx** — общая навигация. Показывает разное меню для student/tutor
5. **UI-компоненты** (`button.tsx`, `card.tsx`, `badge.tsx`) — используются ВЕЗДЕ, изменения влияют на ВСЁ приложение
6. **Telegram Auth Flow** — цепочка: `TelegramLoginButton` → `telegram-login-token` → `telegram-bot/handleWebLogin` → `getOrCreateProfile`. Несогласованность email-адресов между функциями создаёт дубликаты пользователей
7. **Tutor Role Assignment** — роль назначается через `assign-tutor-role` (email) или `telegram-bot` (Telegram). Обе ветки должны работать с ОДНИМ и тем же user_id

## Auth-flow: критические правила

### Telegram Login
- `getOrCreateProfile()` создаёт пользователя с email `telegram_XXX@temp.sokratai.ru`
- Для создания сессии используется `generateLink` + `verifyOtp` (admin API)
- **НИКОГДА** не создавай второго auth-пользователя для того же telegram_user_id — используй `profile.id` из `getOrCreateProfile`
- `intended_role` передаётся через `telegram_login_tokens.intended_role`

### Tutor Registration
- Email-регистрация: `signUp` → `assign-tutor-role` edge function
- Если email уже зарегистрирован: `signIn` → `assign-tutor-role` с `upgrade_existing: true`
- Telegram-регистрация: `TutorTelegramLoginButton` → token с `intended_role: "tutor"` → `telegram-bot` назначает роль
- `TutorGuard` имеет retry-логику (до 4 попыток) для ожидания пропагации роли

### Чеклист при изменении auth-flow
- [ ] Новый пользователь через email → попадает в правильный кабинет (student/tutor)
- [ ] Новый пользователь через Telegram → попадает в правильный кабинет
- [ ] Существующий student переходит в tutor → роль добавляется, редирект работает
- [ ] `is_tutor()` RPC вызывается для ТОГО ЖЕ user_id, что в сессии
- [ ] Нет создания дублирующих auth-пользователей в `telegram-bot`
- [ ] Пройден расширенный чеклист: `docs/engineering/auth/auth-regression-checklist.md`

## Среда разработки и деплоя

- **Деплой и продакшен**: Lovable Cloud + AI
- **Разработка кода**: Cursor, Claude Code
- **Тестирование (разработчик)**: Windows + Google Chrome, Android + Google Chrome
- **Пользователи в продакшене**: macOS + Safari, iPhone + Safari, iPhone/Android + Google Chrome

### Workflow: AI-инструменты
- **Lovable** — для деплоя и быстрых UI-правок. Не трогает конфиги (vite, eslint, tsconfig)
- **Cursor / Claude Code** — для серьёзной разработки, рефакторинга, багфиксов
- После работы в Cursor/Claude Code: **всегда** делай `bun run build` и `bun run smoke-test` перед деплоем
- Для локальных проверок запускай команды **строго последовательно**, не параллельно:
  - `bun run build`
  - после завершения: `bun run smoke-test`
  - причина: параллельный запуск может ломаться по `EBUSY` (конкурентная запись в `dist/`)
- После работы в Lovable: проверь, что Lovable не добавил тяжёлые зависимости в `src/components/ui/`
- Не возвращай Google Calendar интеграцию (UI/edge functions) без отдельного согласованного требования и отдельной миграционной задачи для БД

### CI/CD и деплой edge functions
- `.github/workflows/deploy-supabase-functions.yml` деплоит **только 7 функций**: `telegram-bot`, `chat`, `setup-telegram-webhook`, `telegram-auth`, `telegram-login-token`, `telegram-broadcast`, `telegram-scheduled-reminder`
- **Остальные функции деплоятся вручную** через Supabase CLI или Lovable. При добавлении новой функции — уточняй, нужно ли добавить её в CI
- **Неотслеживаемый файл**: `supabase/migrations/20260220130000_wow_payment_magic.sql` — намеренно не закоммичен, заменён `20260220143000_wow_payment_hardening.sql`. Не добавлять в git

## Реестр edge functions

| Функция | `verify_jwt` | CI авто-деплой | Назначение |
|---------|-------------|----------------|-----------|
| `telegram-bot` | false | ✅ | Главный Telegram-бот (homework, payments, practice) |
| `chat` | true | ✅ | AI-чат для студентов |
| `telegram-auth` | false | ✅ | Telegram OAuth callback |
| `telegram-login-token` | false | ✅ | Создание одноразового login-токена |
| `telegram-broadcast` | true | ✅ | Массовая рассылка |
| `telegram-scheduled-reminder` | false | ✅ | Плановые напоминания |
| `setup-telegram-webhook` | false | ✅ | Регистрация webhook |
| `homework-api` | true | ❌ ручной | CRUD домашних заданий (tutor REST API) |
| `payment-reminder` | false | ❌ ручной | Напоминания об оплате после урока |
| `assign-tutor-role` | true | ❌ ручной | Назначение роли tutor по email |
| `tutor-manual-add-student` | true | ❌ ручной | Ручное добавление ученика |
| `tutor-update-student` | true | ❌ ручной | Обновление профиля ученика |
| `notify-booking` | false | ❌ ручной | Уведомление репетитора о бронировании |
| `analyze-homework-task` | true | ❌ ручной | Анализ задачи ДЗ (AI) |
| `yookassa-create-payment` | true | ❌ ручной | Создание платежа YooKassa (подписки студентов) |
| `yookassa-webhook` | false | ❌ ручной | Webhook подтверждения оплаты YooKassa |
| `admin-analytics` | true | ❌ ручной | Аналитика для администратора |
| `check-solutions` | true | ❌ ручной | Проверка решений (student) |
| `get-solution` | true | ❌ ручной | Получение решений (student) |
| `telegram-webapp-recent-solutions` | false | ❌ ручной | Последние решения для Telegram WebApp |
| `telegram-scheduled-broadcast` | false | ❌ ручной | Плановая рассылка |

## Self-booking система (публичное бронирование)

- Публичный маршрут: `/book/:bookingLink` → `src/pages/BookLesson.tsx`
- Репетитор получает уникальную ссылку бронирования через `generateBookingLink()` / `getBookingLink()` в `tutors.ts`
- Настройки доступности: `tutor_weekly_slots`, `tutor_availability_exceptions`
- Ключевые функции в `tutorSchedule.ts`:
  - `getTutorPublicInfo(bookingLink)` — публичная инфо репетитора
  - `getAvailableBookingSlots(tutorId, startDate, endDate)` — свободные слоты
  - `bookLessonSlot(tutorId, slotData)` — создание брони
- После успешного бронирования вызывается edge function `notify-booking` (уведомление репетитору)
- **Не требует авторизации** — это публичный flow

## YooKassa (платежи студентов за подписку)

- Используется для оплаты подписки студентов (не уроков — уроки оплачиваются через `tutor_payments`)
- Edge functions: `yookassa-create-payment` (`verify_jwt: true`) + `yookassa-webhook` (`verify_jwt: false`)
- `yookassa-webhook` принимает уведомления от YooKassa о статусе платежа — **нельзя добавлять JWT**
- Не путать с `tutor_payments` (оплата урока репетитору от ученика) — это разные сущности

## Кросс-браузерная совместимость (КРИТИЧНО)

Продукт используется на Safari (macOS/iOS) — это главный источник багов. **Все правила ниже обязательны.**

### Build targets
- В `vite.config.ts` установлен `build.target: ['es2020', 'safari15', 'chrome90']`
- В `package.json` есть `browserslist` — используется autoprefixer для CSS
- **НЕ МЕНЯТЬ** эти настройки без веской причины

### Запрещённые паттерны (ломают Safari/iOS)

#### JavaScript / TypeScript
- **`RegExp` lookbehind** (`(?<=...)`) — Safari < 16.4 НЕ поддерживает. Используй альтернативу через capturing groups
- **`structuredClone()`** — Safari < 15.4. Используй `JSON.parse(JSON.stringify(obj))` или lodash `cloneDeep`
- **`Array.at()`** — Safari < 15.4. Используй `arr[arr.length - 1]` вместо `arr.at(-1)`
- **`Object.hasOwn()`** — Safari < 15.4. Используй `Object.prototype.hasOwnProperty.call()`
- **`crypto.randomUUID()`** — только HTTPS + Safari 15.4+. В dev-окружении может не работать
- **`Date` парсинг** — Safari **строг** к формату. `new Date("2024-01-15 10:30:00")` **СЛОМАЕТСЯ**. Всегда используй ISO: `new Date("2024-01-15T10:30:00")` или `date-fns`
- **`AbortSignal.timeout()`** — Safari < 16. Создавай `AbortController` с `setTimeout` вручную

#### CSS
- **`100vh`** на iOS — НЕ учитывает адресную строку Safari. Используй `100dvh` или `min-height: -webkit-fill-available`
- **`overflow: clip`** — Safari < 16. Используй `overflow: hidden` где возможно
- **`scrollbar-gutter`** — Safari НЕ поддерживает. Не используй
- **`:has()` селектор** — Safari 15.4+, но может работать нестабильно. В Tailwind лучше использовать `group/peer` утилиты
- **`backdrop-filter`** — нужен `-webkit-backdrop-filter` (autoprefixer добавит, но проверяй)
- **`gap` в flexbox** — работает в Safari 14.1+, ОК для наших targets
- **CSS `@layer`** — Safari 15.4+. Осторожно с использованием

#### iOS-специфичные проблемы
- **`position: fixed`** + клавиатура iOS — элемент "прыгает" при открытии клавиатуры. Используй `position: sticky` или JavaScript для корректировки
- **Safe Area Insets** — для iPhone с нотчем/Dynamic Island используй `env(safe-area-inset-*)` в padding
- **Rubber-band scrolling** — `overscroll-behavior: contain` помогает, но не всегда на iOS
- **Touch events** — iOS Safari может иметь 300ms delay на tap. `touch-action: manipulation` решает это
- **Auto-zoom на input** — Safari iOS зумит страницу если `font-size < 16px` на input. **ВСЕГДА** ставь `font-size: 16px` или больше на `<input>`, `<textarea>`, `<select>`

### Правила при написании кода
1. **Перед использованием нового Web API** — проверь поддержку на caniuse.com для Safari 15+
2. **Для дат** — всегда используй `date-fns` (`parseISO`) вместо нативного `Date` парсинга. Используй `src/lib/formatters.ts`
3. **CSS анимации** — предпочитай `transform` и `opacity` (GPU-ускорены на всех браузерах)
4. **Тестируй в Safari** — если меняешь CSS layout, scroll-поведение или формы

## Tutor data-loading (macOS Chrome hardening)

- Все tutor-хуки в `src/hooks/useTutor.ts` работают через React Query и обязаны сохранять совместимый контракт:
  - базовый: `{ dataField, loading, error, refetch }`
  - диагностический: `isFetching`, `isRecovering`, `failureCount`
- Общие настройки tutor-запросов централизованы в `src/hooks/tutorQueryOptions.ts`:
  - `timeout = 10000ms`
  - bounded retry: до 5 повторов (6 попыток суммарно)
  - `staleTime = 60000`, `gcTime = 600000`
  - `refetchOnWindowFocus = true`, `refetchOnReconnect = true`
  - `refetchInterval = 15000` только при отсутствии данных + ошибке
- Для списков/чатов нельзя возвращать глобальный "вечный skeleton" после ошибок:
  - skeleton только на первичной загрузке при отсутствии данных
  - после ошибок — мягкий recovery-статус через `src/components/tutor/TutorDataStatus.tsx` и доступная навигация
  - при появлении данных — рендер из cache + фоновый refresh
- Логи наблюдаемости для tutor-запросов обязательны:
  - `tutor_query_retry`
  - `tutor_query_timeout`
  - `tutor_query_recovered`

## Telegram Homework state machine (Sprint 1.1/1.2)

- Новая подсистема домашки изолирована от legacy-таблиц и использует только префикс `homework_tutor_*`
- Runtime state Telegram-бота хранится в `public.homework_tutor_user_bot_state` (без fallback на `user_bot_state`)
- Основные homework-состояния: `IDLE`, `HW_SELECTING`, `HW_SUBMITTING`, `HW_CONFIRMING`, `HW_REVIEW`
- Файл логики состояния: `supabase/functions/telegram-bot/homework/state_machine.ts`
  - API: `getState`, `setState`, `resetState`
  - Реализован stale-reset (по умолчанию 12 часов) для не-idle состояний
- В `supabase/functions/telegram-bot/index.ts` homework-роутинг должен быть минимально инвазивным:
  - Команды: `/homework`, `/cancel`
  - Callbacks: `hw_start:{assignment_id}`, `hw_next`, `hw_submit`
  - Homework text/photo обрабатываются ранним ответвлением до AI/practice/diagnostic логики
- При входе в homework-режим обязательно сбрасывать `practice_state` и `diagnostic_state`
- Исторический контекст Sprint 1.2: промежуточные ответы хранились только в `context` state machine.

## Telegram Homework Vision checker (Sprint 1.3)

- Для AI-распознавания и проверки домашки добавлен модуль:
  - `supabase/functions/telegram-bot/homework/vision_checker.ts`
- Публичные функции модуля:
  - `recognizeHomeworkPhoto(imageBase64, subject, options?)`
  - `checkHomeworkAnswer(recognizedText, taskText, correctAnswer, solutionSteps, subject, options?)`
- Поддержан `strict`-режим:
  - `options.strict = true` => ошибки не маскируются fallback-объектами, пробрасываются наружу
  - по умолчанию (`strict = false`) сохраняется безопасный fallback-путь
- Модель и провайдер для Sprint 1.3:
  - только Lovable AI Gateway (`LOVABLE_API_KEY`)
  - модель `google/gemini-3-flash-preview`
  - без fallback на прямой `GEMINI_API_KEY`
- Контракт `error_type` в проверке должен строго совпадать с enum из БД (`homework_tutor_submission_items.ai_error_type`)
- Safety/robustness требования:
  - timeout 35 сек и 1 retry только для сетевых/5xx ошибок
  - строгий JSON-парсинг с fallback (raw JSON, code fence, извлечение по `{...}`)
  - sanitize текста и безопасные fallback-результаты вместо падения
  - запрет выдачи готового правильного ответа в `feedback`
- Scope Sprint 1.3:
  - НЕ менять `supabase/functions/telegram-bot/index.ts`
  - НЕ менять `supabase/functions/analyze-homework-task/index.ts`
  - интеграция end-to-end (storage + submission_items + runAICheck) остаётся на Sprint 1.4

## Telegram Homework full flow (Sprint 1.4)

- Реализован end-to-end flow: Telegram -> Storage -> Vision -> AI -> результат.
- Добавлен модуль `supabase/functions/telegram-bot/homework/homework_handler.ts`:
  - `ensureSubmissionItemsForTasks`
  - `saveHomeworkTextAnswer`
  - `saveHomeworkPhotoAnswer`
  - `runHomeworkAiCheck`
  - `formatHomeworkResultsMessage`
  - `buildHomeworkStoragePath`
- В `HW_SUBMITTING` ответы теперь персистятся в БД:
  - текст -> `homework_tutor_submission_items.student_text`
  - фото -> bucket `homework-images`, в `student_image_urls` сохраняются object paths по конвенции `homework/{assignment_id}/{submission_id}/{task_id}/{uuid}.jpg`
- Ограничение на фото: максимум 4 изображения на задачу (на уровне приложения и с учётом текущих значений в БД).
- `hw_submit` поведение:
  - перевод `in_progress -> submitted`
  - синхронный запуск AI-check
  - при успехе: `homework_tutor_submissions.status = ai_checked`, заполнение `total_score/total_max_score`, отправка итогового сообщения + кнопки `🧠 Разобрать ошибки`
  - при техническом сбое AI/storage: статус остаётся `submitted`, пользователь получает дружелюбное сообщение о неуспешной проверке
  - state всегда сбрасывается в `IDLE`
- Добавлены homework callbacks:
  - `hw_photo_help`
  - `hw_cancel`
  - `hw_review:{submission_id}` (информационная заглушка до Sprint 3)

## Homework API — tutor CRUD (Sprint 2.1)

- Edge function: `supabase/functions/homework-api/index.ts`
- Зарегистрирована в `supabase/config.toml` с `verify_jwt = true`
- Документация контракта: `supabase/functions/homework-api/README.md`
- 8 маршрутов:
  - `POST /assignments` — создание ДЗ + tasks
  - `GET /assignments?status=...` — список ДЗ с агрегатами (assigned_count, submitted_count, avg_score)
  - `GET /assignments/:id` — детали ДЗ + tasks + assigned_students + submissions_summary
  - `PUT /assignments/:id` — patch assignment + replace list для tasks (с блокировкой destructive-изменений при наличии submissions)
  - `POST /assignments/:id/assign` — назначение учеников (upsert, авто-активация draft → active)
  - `POST /assignments/:id/notify` — отправка Telegram уведомлений (idempotent, только notified=false)
  - `GET /assignments/:id/results` — аналитика: summary, per_student, per_task с distribution/error histograms
  - `POST /submissions/:id/review` — tutor review: override/comment/score → пересчёт totals → статус tutor_reviewed
- Авторизация: JWT + user client → `auth.getUser()`, затем service client для БД
- CORS: allowlist из `HOMEWORK_API_ALLOWED_ORIGINS` env (CSV) + fallback origins
- Формат ошибок: `{ error: { code, message, details? } }` с HTTP 400/401/403/404/500
- Наблюдаемость: структурные логи `homework_api_request_start/success/error`
- `tutor_score` хранится в `homework_tutor_submission_items.ai_score` (без новой миграции)
- Для уведомлений используется прямой вызов Telegram Bot API (`TELEGRAM_BOT_TOKEN`)
- НЕ МЕНЯТЬ `AuthGuard`, `TutorGuard`, student-компоненты, `telegram-bot/index.ts`

## CJM fixes — tutor homework (Upload + Visibility + UX)

- Добавлена миграция операционного фикса:
  - `supabase/migrations/20260217123000_homework_cjm_bugfixes.sql`
  - idempotent ensure bucket `homework-task-images`
  - idempotent recreate storage policies для `homework-task-images`
  - backfill: `homework_tutor_assignments.status = 'draft'` -> `active`, если уже есть назначения в `homework_tutor_student_assignments`
- Обновлён `homework-api` контракт:
  - `POST /assignments/:id/assign` возвращает `{ added, assignment_status }`
  - `POST /assignments/:id/notify` возвращает `{ sent, failed, failed_student_ids }`
  - в `assign` авто-активация `draft -> active` теперь строгая, с проверкой `update` ошибки
  - дополнительно: `assign` блокирует учеников без `profiles.telegram_user_id` (`STUDENTS_TELEGRAM_NOT_CONNECTED`)
  - дополнительно: `notify` поддерживает fallback chat-id через `profiles.telegram_user_id` + `telegram_sessions`, и возвращает `failed_by_reason`
- В `telegram-bot` добавлена диагностика видимости ДЗ:
  - лог `homework_visibility_diagnostics` с полями `student_id`, `assigned_links_count`, `active_assignments_count`, `draft_assignments_count`
  - runtime self-heal: перед homework-роутингом бот синхронизирует `telegram_sessions.user_id` с canonical `profiles.id` по `telegram_user_id`
  - если есть назначенные `draft` и нет `active`, бот отправляет явный текст, что ДЗ назначены, но ещё не активированы
- Во фронте (`src/lib/tutorHomeworkApi.ts`) стандартизирован storage reference:
  - формат хранения: `storage://{bucket}/{objectPath}`
  - helper-ы: `parseStorageRef`, `toStorageRef`
  - upload task image: primary bucket `homework-task-images`, fallback bucket `chat-images` при `Bucket not found/404`
  - delete/sign-url теперь работают через parsed `bucket/path` (с backward compatibility для legacy plain path)
  - **ПРАВИЛО**: никогда не хранить raw Supabase path — всегда использовать `toStorageRef(bucket, path)`
- UX quick wins в `src/pages/tutor/TutorHomeworkCreate.tsx`:
  - превью изображения задачи + имя файла + подсказка по ограничениям файла
  - warning toast при fallback upload
  - в поле `Текст задачи` поддержан paste-скриншота через `Ctrl+V` (с confirm при замене существующего фото)
  - поиск учеников по имени/`@username`
  - бейджи `Telegram подключен / Telegram не подключен`
  - summary перед submit: выбрано учеников + сколько без Telegram
  - phase progress submit (`creating -> assigning -> notifying`)
  - защита от потери данных (confirm при выходе + `beforeunload`)
  - финальный toast учитывает `failed_student_ids`

## Prod fixes — Telegram homework images (student+tutor)

- Исправлен показ фото задачи ученику в Telegram homework flow:
  - в runtime-тип `HomeworkTask` добавлено поле `task_image_url`
  - в выборках задач (`getHomeworkTasksForAssignment`, `getHomeworkTaskById`) обязательно запрашивается `task_image_url`
  - добавлен helper `sendHomeworkTaskStep(...)` с гибридной отправкой:
    - если текст шага короткий -> `sendPhoto` с caption + inline keyboard
    - если текст длинный -> фото отдельным сообщением, затем полный текст с keyboard
    - при ошибке `sendPhoto` бот отправляет fallback-текст и не прерывает сценарий
- Добавлен резолвер ссылок фото задачи `resolveHomeworkTaskImageUrl(...)` в `supabase/functions/telegram-bot/index.ts`:
  - поддержка `storage://{bucket}/{path}`
  - поддержка legacy plain path с fallback bucket-ами (`homework-task-images`, `chat-images`, `homework-images`)
  - поддержка `http(s)` и `/relative/path`
- Исправлен сбой при загрузке фото ответа ученика:
  - в `supabase/functions/telegram-bot/homework/homework_handler.ts` добавлены типизированные коды ошибок:
    - `TELEGRAM_GET_FILE_FAILED`
    - `TELEGRAM_DOWNLOAD_FAILED`
    - `HOMEWORK_IMAGE_UPLOAD_FAILED`
    - `SUBMISSION_ITEM_UPDATE_FAILED`
    - `MAX_IMAGES_REACHED`
    - `HOMEWORK_BUCKET_NOT_FOUND`
  - owner update в `storage.objects` переведён в best-effort (warning, но без падения flow)
  - в `index.ts` добавлен маппинг error code -> понятное сообщение пользователю
- Усилена наблюдаемость по фото homework:
  - структурные логи `homework_photo_save_start/success/error`
  - обязательные поля: `user_id`, `assignment_id`, `submission_id`, `task_id`, `error_code`
- В кабинете репетитора добавлен preview фото задачи в деталях ДЗ:
  - `src/pages/tutor/TutorHomeworkDetail.tsx` рендерит thumbnail (через `getHomeworkImageSignedUrl`)
  - клик по preview открывает полноразмерное изображение в новой вкладке
  - поддержаны `storage://...` и legacy plain path

## Tutor notification on submission + deep link (Sprint 2.2)

- После успешного AI-check (`ai_checked`) бот уведомляет репетитора в Telegram:
  - функция `notifyTutorOnSubmission(submissionId)` в `supabase/functions/telegram-bot/index.ts`
  - вызывается из `runHomeworkAiCheckAndSendResult` после обновления статуса submission
  - обёрнута в отдельный `try/catch`, ошибка уведомления не ломает flow ученика
- Источник chat_id репетитора: `tutors.telegram_id` (primary), `telegram_sessions.telegram_user_id` (fallback); при отсутствии — skip с логом
- Сообщение: `📬 {student_name} сдал «{title}»: {score}/{max} ({percent}%)`, счётчики `✅/❌`, top ошибки
  - при наличии задач с `ai_error_type=incomplete` добавляется строка `⚠️ AI: недостаточно контекста`
- Кнопка deep link: `📝 Открыть submission` → `/tutor/homework/{assignment_id}/results?submission={submission_id}`
- На фронте (`src/pages/tutor/TutorHomeworkResults.tsx`) query `?submission=` авто-раскрывает и подсвечивает нужную строку ученика (scroll + ring highlight с fade)
- AI context fallback в `homework_handler.ts` → `runHomeworkAiCheck`:
  - если `task_text` пустой или нет ни `student_text`, ни фото → `ai_score=0`, `error_type=incomplete`, `confidence=0.2`
  - LLM не вызывается, fallback сохраняется в БД как обычный `ai_*` результат
  - структурный лог `homework_ai_context_insufficient`
- Наблюдаемость: `homework_tutor_notify_start/success/skipped/skipped_no_chat_id/error`
- НЕ МЕНЯТЬ: схему БД, `AuthGuard`, `TutorGuard`, student practice/diagnostic, маршруты (кроме поддержки query на results-экране)

## Tutor cache sync fix — profile updates without reload

- Исправлен UX баг в кабинете репетитора: изменения ученика теперь сразу видны на всех вкладках без ручного `F5`.
- Добавлен централизованный helper кэша:
  - `src/lib/tutorStudentCacheSync.ts`
  - `applyTutorStudentPatchToCache(queryClient, patch)` — мгновенный optimistic patch для:
    - `['tutor','student', tutorStudentId]`
    - `['tutor','students']`
  - `removeTutorStudentFromCache(queryClient, tutorStudentId)` — удаление ученика из list/detail cache
  - `invalidateTutorStudentDependentQueries(queryClient, tutorStudentId)` — точечная инвалидация:
    - `['tutor','students']`
    - `['tutor','student', tutorStudentId]`
    - `['tutor','payments']`
    - `['tutor','lessons']`
    - `['tutor','homework']`
- Интеграция в `src/pages/tutor/TutorStudentProfile.tsx`:
  - `handleUpdateStudent`: после успешного API применяется patch + invalidate зависимых query
  - `handleSave` (notes/parent_contact/last_lesson_at): patch + invalidate
  - `handleDeleteStudent`: remove from cache + invalidate перед навигацией
- Контракты API/БД не изменялись, фикс полностью фронтовый (React Query cache sync).

## WOW-фичи оплаты (2026-02-20)

- Добавлена idempotent-цепочка завершения урока и создания платежа:
  - миграция `supabase/migrations/20260220143000_wow_payment_hardening.sql`
  - `tutor_payments.lesson_id` + partial unique index (один lesson -> один платеж)
  - `complete_lesson_and_create_payment` переведена на UPSERT по `lesson_id`
- `hourly_rate_cents` на ученике — **обязательное поле** при создании (хранится в копейках, показывается делённым на 100)
- Добавлен источник реквизитов репетитора:
  - `tutor_calendar_settings.payment_details_text`
  - UI в `src/pages/tutor/TutorSchedule.tsx` (настройки календаря)
- Усилен Telegram payment-flow:
  - новый callback-формат: `payment:<status>:<lessonId>`
  - backward compatibility со старым форматом в `supabase/functions/telegram-bot/index.ts`
  - Double WOW шаг: `payment_remind:yes/no:<lessonId>` с шаблоном напоминания и реквизитами
  - structured logs: `payment_callback_parsed`, `payment_upsert_done`, `payment_remind_yes/no`
- Унифицирован расчет суммы оплаты:
  - helper `src/lib/paymentAmount.ts`
  - используется в `supabase/functions/payment-reminder/index.ts`, `supabase/functions/telegram-bot/index.ts`, `src/pages/tutor/TutorSchedule.tsx`
  - источник истины при записи остается backend RPC
- Долги учеников переведены на DB-агрегацию:
  - RPC `get_tutor_students_debt()` (pending + overdue + debt_amount)
  - `src/lib/tutors.ts` мержит debt-поля в `getTutorStudents()` и `getTutorStudent()`
  - UI-consumers (`TutorStudents`, `TutorStudentProfile`, `StudentCard`) читают долг из student API
  - `useTutorPayments` не используется для расчета долга в списке/профиле, но сохранен для страницы платежей

## Команды

```bash
bun run dev          # Запуск dev сервера (порт 8080)
bun run build        # Production билд
bun run build:dev    # Development билд
bun run lint         # ESLint
bun run preview      # Preview production билда
bun run analyze      # Анализ размера бандла
bun run smoke-test   # Smoke-тест (билд + чанки + типы + compat)
```
