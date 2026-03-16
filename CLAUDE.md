# CLAUDE.md

Project context for Claude Code.

---

# Project

SokratAI — AI platform for tutoring and homework automation.

Main domains:
- Student platform
- Tutor platform
- AI homework checking
- Telegram bot integration

Stack:

Frontend
- React
- TypeScript
- Vite
- React Query

Backend
- Supabase
- Edge Functions

AI
- Gemini
- Lovable AI Gateway

---

# Claude Role

Claude acts as Software Engineer.

Responsibilities:

- implement features
- debug issues
- write tests
- run validation commands

Claude does NOT:

- change architecture
- introduce new dependencies
- modify security logic

---

# Development Workflow

Always follow:

Spec → Plan → Code → Test

Step 1
Read spec files.

Step 2
Propose implementation plan.

Step 3
Implement tasks.md.

Step 4
Run validation commands.


# Tutor AI Agents — Canonical Docs

For tutor product features, Claude must read product and UX source-of-truth docs before proposing implementation.

## Canonical read order for tutor tasks

1. `docs/product/research/ajtbd/08-wedge-decision-memo-sokrat.md`
2. `docs/product/specs/tutor_ai_agents/14-ajtbd-product-prd-sokrat.md`
3. `docs/product/specs/tutor_ai_agents/15-backlog-of-jtbd-scenarios-sokrat.md`
4. `docs/product/specs/tutor_ai_agents/16-ux-principles-for-tutor-product-sokrat.md`
5. `docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules-sokrat.md`
6. `docs/product/specs/tutor_ai_agents/18-pilot-execution-playbook-sokrat.md`
7. relevant file in `docs/features/specs/`

## Tutor product rules

- Do not expand scope beyond the current wedge.
- Prioritize tutor workflows around homework and practice generation.
- AI = draft + action, not chat-only output.
- Prefer additive iterations over refactors unless explicitly asked.
- If a feature does not strengthen the paid pilot, it is not a priority.

## Tutor implementation workflow

For any tutor feature:
1. Read canonical tutor docs.
2. Identify which Job / JTBD scenario the task strengthens.
3. Propose minimal implementation inside current scope.
4. Implement.
5. Run validation.
6. Make sure output can be reviewed against docs 16 and 17.

## Tutor anti-drift guardrails

Claude must avoid:
- turning `Помощник` into a generic chat-first screen
- adding new top-level tutor flows without Job-based justification
- adding AI output that has no action layer
- inventing new segment / pricing / wedge decisions in code tasks


---

# Security Rules

Never:

- expose API keys
- modify environment variables
- execute shell commands outside validation

---

# Critical Architecture Rules

- Student and Tutor modules must remain isolated.
- Never import tutor modules inside student components.
- Never import student modules inside tutor components.
- Shared UI components must stay lightweight.

---

# High-Risk Files

Modify only if task explicitly requires:
- `src/components/AuthGuard.tsx`
- `src/components/TutorGuard.tsx`
- `src/pages/Chat.tsx`
- `src/pages/tutor/TutorSchedule.tsx`
- `supabase/functions/telegram-bot/index.ts`

---

# Documentation

Detailed rules are stored in: .claude/rules/

For architecture overview see: docs/engineering/architecture/README.md

## КРИТИЧЕСКИЕ ПРАВИЛА

### 1. Форматирование дат и валюты
- Канонический источник: **`src/lib/formatters.ts`** — функции форматирования дат, валюты, прогресса
- Всегда используй `parseISO` из `date-fns` для разбора строк дат (не `new Date(string)` — ломается в Safari)
- `hourly_rate_cents` / суммы платежей хранятся в копейках (integer). Деление на 100 только при отображении — используй `formatPaymentAmount` из `formatters.ts`

## Система домашних заданий

В проекте **ОДНА** система домашних заданий — tutor-connected (`homework_tutor_*` таблицы).

Legacy student-only система (`homework_sets`, `homework_tasks`, `homework_chat_messages`) **полностью удалена** (миграция `20260310110000_drop_legacy_homework.sql`).

### Два режима работы
- **Classic** (`workflow_mode: 'classic'`): ученик отправляет фото решений через Telegram-бот или веб-кабинет, AI проверяет
- **Guided Chat** (`workflow_mode: 'guided_chat'`): пошаговый AI-чат, ведёт ученика через каждую задачу с подсказками и проверкой

### Ключевые файлы
- `src/lib/studentHomeworkApi.ts` — API-клиент для студентов (задания, submissions, guided chat)
- `src/hooks/useStudentHomework.ts` — React hooks для студенческого ДЗ
- `src/components/homework/` — Guided homework UI (GuidedHomeworkWorkspace, GuidedChatInput, GuidedChatMessage, TaskStepper)
- `src/components/tutor/GuidedThreadViewer.tsx` — просмотр guided-чата со стороны репетитора
- `src/lib/tutorHomeworkApi.ts` — API-клиент для репетиторов
- `supabase/functions/homework-api/` — Edge function CRUD (8 маршрутов)
- `supabase/functions/homework-reminder/` — напоминания о ДЗ (cron)

### Таблицы БД
- `homework_tutor_assignments` — задания (draft/active/archived, workflow_mode)
- `homework_tutor_tasks` — задачи внутри заданий
- `homework_tutor_submissions` — submissions учеников
- `homework_tutor_submission_items` — ответы по задачам (text, photos, AI score)
- `homework_tutor_threads` — guided chat threads
- `homework_tutor_thread_messages` — сообщения в guided chat
- `homework_tutor_task_states` — прогресс по задачам в guided mode
- `homework_tutor_templates` — шаблоны заданий
- `homework_tutor_materials` — материалы к заданиям (PDF, images, links)

### Важно
- Система попыток (attempts) **удалена** — ученик может пересдавать без ограничений
- `src/types/homework.ts` содержит legacy-типы `HomeworkSet`/`HomeworkTask` (пока используются SUBJECTS конфиг) — не путать с активной системой

### Передача изображений задач в AI (КРИТИЧНО)

`task_image_url` в БД хранится как `storage://homework-task-images/...` — это **внутренняя** ссылка Supabase, **не HTTP URL**. AI API не может её открыть.

**Правило**: перед передачей изображения в AI (Lovable/Gemini) **ОБЯЗАТЕЛЬНО**:
1. Преобразовать `storage://` → подписанный HTTP URL через `db.storage.createSignedUrl()` (service_role) или через бэкенд-эндпоинт `GET /assignments/:id/tasks/:taskId/image-url`
2. Передать как multimodal `{ type: "image_url", image_url: { url: "https://..." } }` в массиве `content` user-сообщения
3. **НИКОГДА** не вставлять `storage://` или raw URL как текст в промпт — AI его не увидит

**Четыре пути к AI в guided chat** (все должны передавать изображение корректно):
- `answer` → `handleCheckAnswer` → `evaluateStudentAnswer` в `guided_ai.ts` (resolved в `index.ts`)
- `hint` → `handleRequestHint` → `generateHint` в `guided_ai.ts` (resolved в `index.ts`)
- `question` → `streamChat()` → `/functions/v1/chat` (resolved на фронтенде, передаётся как `taskImageUrl`)
- `bootstrap` → `streamChat()` → `/functions/v1/chat` (resolved на фронтенде, передаётся как `taskImageUrl`)

При добавлении нового пути к AI с изображениями — проверить ВСЕ вызывающие точки, не только основную.

## Известные хрупкие области

1. **Chat.tsx** (2000+ строк) — очень сложный компонент. Любые изменения в ChatMessage, ChatInput, ChatSidebar могут сломать чат
2. **Pyodide/GraphRenderer** — Python-графики. Зависит от CDN, может ломаться при изменениях в ChatMessage
3. **AuthGuard / TutorGuard** — guard-компоненты. Изменение может заблокировать доступ для всех пользователей. **TutorGuard** имеет module-level кеш (`tutorAuthCache`) — НЕ УДАЛЯТЬ, иначе переключение вкладок станет медленным (is_tutor RPC с retry до 6 секунд на каждый переход)
4. **Navigation.tsx** — общая навигация. Показывает разное меню для student/tutor
5. **UI-компоненты** (`button.tsx`, `card.tsx`, `badge.tsx`) — используются ВЕЗДЕ, изменения влияют на ВСЁ приложение
6. **Telegram Auth Flow** — цепочка: `TelegramLoginButton` → `telegram-login-token` → `telegram-bot/handleWebLogin` → `getOrCreateProfile`. Несогласованность email-адресов между функциями создаёт дубликаты пользователей
7. **Tutor Role Assignment** — роль назначается через `assign-tutor-role` (email) или `telegram-bot` (Telegram). Обе ветки должны работать с ОДНИМ и тем же user_id

## Среда разработки и деплоя

- **Деплой и продакшен**: Lovable Cloud + AI
- **Разработка кода**: Cursor, Claude Code, Codex
- **Тестирование (разработчик)**: Windows + Google Chrome, Android + Google Chrome
- **Пользователи в продакшене**: macOS + Safari, iPhone + Safari, iPhone/Android + Google Chrome

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

## Мобильная отметка оплат через Telegram (Sprint «Mobile Pay»)

- Репетитор может отметить оплату прямо из Telegram-бота, не открывая кабинет
- Команда `/pay` в боте → список должников с кнопками по ученикам
- Нажатие на ученика → кнопки по каждому занятию с реальной датой урока (`tutor_lessons.start_at`)
- Нажатие на дату → оплата отмечена, кабинет обновляется при следующем открытии (React Query `refetchOnWindowFocus`)

### Ключевые правила

#### Дата занятия — единый источник
- **Кабинет** (`TutorPayments.tsx`): primary `tutor_lessons.start_at`, fallback `tutor_payments.due_date`
- **Бот** (`/pay` flow): то же самое — RPC возвращает `lesson_start_at` (из JOIN `tutor_lessons`), бот показывает его через `formatLessonDate()`
- `tutor_payments.due_date` = `CURRENT_DATE` при создании платежа (≠ дата занятия!). **Никогда не показывай `due_date` как "дату занятия"** без проверки `lesson_start_at`

#### Callback-формат (Telegram, ≤64 байт)
- `paym_list` — показать/обновить список должников
- `paym_s:{tutor_student_id}` — детали ученика (44 байта ✓)
- `paym_ok:{payment_id}` — отметить одну оплату (45 байт ✓)
- `paym_oks:{tutor_student_id}` — отметить все оплаты ученика (46 байт ✓)
- Не пересекаются с существующими `payment:` и `payment_remind:` callback-ами

#### Вспомогательные функции в боте
- `formatLessonDate(row: PendingPaymentRow)` — русский короткий формат «21 февраля», primary `lesson_start_at`, fallback `due_date`, fallback `period`
- `formatRub(amount)` — форматирование суммы в рублях
- `getPendingPaymentsByTelegram(telegramUserId)` — обёртка над RPC
- Все `paym_*` handlers зарегистрированы в `handleCallbackQuery` **до** блока `payment_remind:` / `payment:`

## База знаний (KB) — новый модуль

Модуль живёт в Tutor-домене:
- `src/pages/tutor/knowledge/` — страницы
- `src/components/kb/` — компоненты
- `src/hooks/useKnowledgeBase.ts`, `src/hooks/useFolders.ts` — хуки
- `src/types/kb.ts` — типы
- `src/stores/hwDraftStore.ts` — Zustand store для корзины ДЗ

### Архитектура двух пространств
- **Каталог Сократа** (kb_topics + kb_tasks where owner_id IS NULL) — read-only витрина
- **Моя база** (kb_folders + kb_tasks where owner_id = user) — личные папки

### Дизайн-токены KB
- Primary: #1B6B4A (socrat green)
- Folder: #5B5FC7 (purple)
- Accent: #E8913A (orange, "Моя" badge)

### Snapshot-механика
При добавлении задачи в ДЗ — текст фиксируется в homework_kb_tasks.task_text_snapshot.
Ученик видит snapshot, не оригинал. Репетитор может редактировать snapshot в drawer.

### Интеграция KB → конструктор ДЗ (KBPickerSheet)

Точка интеграции KB → черновик ДЗ в визарде:
- `src/components/tutor/KBPickerSheet.tsx` — Sheet-drawer с двумя вкладками (Каталог Сократа / Моя база), drill-down по темам/папкам, batch-select. Монтируется в `TutorHomeworkCreate.tsx`.
- `kbTaskToDraftTask(task: KBTask): DraftTask` в `src/components/tutor/homework-create/HWTasksSection.tsx` — канонический конвертер KB-задачи в черновик. Заполняет поля провенанса: `kb_task_id`, `kb_source`, `kb_snapshot_text`, `kb_snapshot_answer`, `kb_snapshot_solution`, `kb_attachment_url`.

#### Поля провенанса в DraftTask (обязательны при добавлении задачи из KB)
- `kb_task_id` — id задачи в KB
- `kb_source: 'socrat' | 'my'` — источник (каталог vs личная база)
- `kb_snapshot_text` — снапшот текста на момент добавления
- `kb_snapshot_answer` — снапшот ответа
- `kb_snapshot_solution` — снапшот решения
- `kb_attachment_url` — URL вложения (может быть `storage://...`). **Требует разрешения в signed URL перед передачей в AI** — применяются те же правила, что и для `task_image_url`.

После submit ДЗ — провенанс записывается в `homework_kb_tasks` (snapshot-механика). `snapshot_edited` отслеживает изменения и текста, и ответа.

**Важно:** KBPickerSheet работает через локальный React state визарда (`onAddTasks` callback → `DraftTask[]`), а **НЕ** через глобальный `hwDraftStore` (Zustand). Это отдельный flow от KB-страниц → HWDrawer.

### Спецификация
- Tech spec: docs/kb/kb-tech-spec.md
- Design ref: docs/kb/kb-design-ref.jsx
- Tasks: docs/kb/kb-tasks.md

## Preview parity (КРИТИЧНО)

### Service Worker
- SW регистрируется **ТОЛЬКО** на продакшен-домене (`sokratai.lovable.app`)
- На preview/dev/localhost — принудительный `unregister()` + очистка `CacheStorage`
- Не менять логику allow-list в `src/registerServiceWorker.ts` без веской причины

### Structural breakpoints (tutor/KB)
- Для переключения колонок/рядов в grid/flex: использовать `md:` (768px+), **НЕ** `sm:` (640px)
- `sm:` допускается только для типографики, spacing, padding
- Причина: Lovable preview panel имеет ширину ~640-700px, `sm:` срабатывает нестабильно

### Card-анимации в сетках
- В `ui/Card` внутри grid/list: всегда `animate={false}`
- Входные анимации (`animate-in`) конфликтуют с CSS Grid и ломают layout в preview

### Checklist после UI-правок
1. Убедиться что SW не кэширует stale bundle (консоль preview: «Non-prod host, cleaning up»)
2. Проверить layout в preview на desktop и mobile
3. Structural breakpoints = `md:` для колонок