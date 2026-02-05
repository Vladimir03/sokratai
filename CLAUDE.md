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
- Guard: `TutorGuard` (проверка `is_tutor()` RPC)
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

При работе над **любым** функционалом:
- [ ] `npm run build` или `bun run build` завершается без ошибок
- [ ] Нет новых тяжёлых зависимостей в `src/components/ui/`
- [ ] Все новые страницы используют `React.lazy()` в `App.tsx`
- [ ] Нет случайных изменений в файлах, не связанных с задачей

## Известные хрупкие области

1. **Chat.tsx** (2000+ строк) — очень сложный компонент. Любые изменения в ChatMessage, ChatInput, ChatSidebar могут сломать чат
2. **Pyodide/GraphRenderer** — Python-графики. Зависит от CDN, может ломаться при изменениях в ChatMessage
3. **AuthGuard / TutorGuard** — guard-компоненты. Изменение может заблокировать доступ для всех пользователей
4. **Navigation.tsx** — общая навигация. Показывает разное меню для student/tutor
5. **UI-компоненты** (`button.tsx`, `card.tsx`, `badge.tsx`) — используются ВЕЗДЕ, изменения влияют на ВСЁ приложение

## Команды

```bash
bun run dev          # Запуск dev сервера (порт 8080)
bun run build        # Production билд
bun run build:dev    # Development билд
bun run lint         # ESLint
bun run preview      # Preview production билда
bun run analyze      # Анализ размера бандла
```
