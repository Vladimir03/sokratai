# SokratAI — Гайд для AI-агентов (Claude Code, Cursor, Lovable)

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
- Маршруты: `/tutor/dashboard`, `/tutor/students`, `/tutor/students/:id`, `/tutor/schedule`, `/tutor/payments`
- Guard: `TutorGuard` (проверка `is_tutor()` RPC с **module-level кешем** авторизации, TTL 10 мин)
- **ВАЖНО**: Каждая tutor-страница монтирует собственный `<TutorGuard>`. Кеш на уровне модуля делает переключение между вкладками мгновенным (без повторного RPC)
- Ключевые компоненты: `src/pages/tutor/*`, `src/components/tutor/*`
- Ключевые хуки: `useTutor`, `useTutorStudents`, `useTutorPayments` (из `src/hooks/useTutor.ts`)
- Тяжёлые зависимости: нет (лёгкие страницы)

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

## Структура файлов

```
src/
├── pages/                 # Страницы (все lazy-loaded)
│   ├── Chat.tsx           # Чат с ИИ (student)
│   ├── Practice.tsx       # Практика (student)
│   ├── Diagnostic.tsx     # Диагностика (student)
│   ├── tutor/             # ← ВСЕ tutor-страницы тут
│   │   ├── TutorDashboard.tsx
│   │   ├── TutorStudents.tsx
│   │   ├── TutorStudentProfile.tsx
│   │   ├── TutorSchedule.tsx
│   │   └── TutorPayments.tsx
│   └── ...
├── components/
│   ├── ui/                # shadcn/ui (ЛЁГКИЕ, без тяжёлых deps!)
│   ├── tutor/             # Tutor-specific компоненты
│   ├── practice/          # Practice-specific компоненты
│   ├── diagnostic/        # Diagnostic-specific компоненты
│   ├── admin/             # Admin-specific компоненты
│   ├── AuthGuard.tsx      # Guard для студентов
│   ├── TutorGuard.tsx     # Guard для репетиторов
│   └── ...общие компоненты
├── hooks/
│   ├── useTutor.ts        # ВСЕ tutor-хуки
│   ├── useSubscription.ts # Подписки (student)
│   ├── usePractice.ts     # Практика (student)
│   └── ...
├── lib/
│   ├── supabaseClient.ts  # Supabase клиент
│   ├── tutors.ts          # Tutor бизнес-логика
│   └── ...
└── utils/
    ├── pyodide.ts         # Python в браузере (student only!)
    ├── chatCache.ts       # Кеш чата (student only!)
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
- [ ] Для `/tutor/schedule`: перенос через модалку доступен только в `Редактировать` (кнопки `Перенести` нет)
- [ ] Для `/tutor/schedule`: drag-and-drop показывает preview (линия + подсветка диапазона) и не открывает `AddLessonDialog` ложным кликом после drop
- [ ] Для `/tutor/schedule`: optimistic move работает (карточка двигается сразу), при ошибке есть rollback и toast

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

## TutorSchedule: текущая логика (обновлено)

- Файл: `src/pages/tutor/TutorSchedule.tsx`
- Детали занятия: перенос даты/времени встроен в режим `Редактировать` (`LessonDetailsDialog`), отдельного `RescheduleDialog` нет
- Drag-and-drop перенос в weekly grid:
  - шаг снапа: 15 минут
  - учитывает границы рабочего дня и `duration_min`
  - drop в нерабочий день игнорируется
  - после drop есть suppress ложного click, чтобы не открывать `AddLessonDialog`
- UX перетаскивания:
  - во время drag есть drop-preview (горизонтальная линия + мягкая подсветка диапазона занятия)
  - перенос использует optimistic update (карточка перемещается сразу)
  - при неуспешном `updateLesson` выполняется rollback optimistic состояния + error toast

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
- После работы в Lovable: проверь, что Lovable не добавил тяжёлые зависимости в `src/components/ui/`

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
2. **Для дат** — всегда используй `date-fns` вместо нативного `Date` парсинга
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
