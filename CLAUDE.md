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

**Дефолты конструктора ДЗ** (`TutorHomeworkCreate.tsx`):
- `subject: 'physics'` — предмет по умолчанию (целевой сегмент: репетиторы физики ЕГЭ/ОГЭ)
- `workflow_mode: 'guided_chat'` — guided mode по умолчанию
- Если репетитор меняет эти значения — открыть L1 («Расширенные параметры»)

### Ключевые файлы
- `src/lib/studentHomeworkApi.ts` — API-клиент для студентов (задания, submissions, guided chat)
- `src/hooks/useStudentHomework.ts` — React hooks для студенческого ДЗ
- `src/components/homework/` — Guided homework UI (GuidedHomeworkWorkspace, GuidedChatInput, GuidedChatMessage, TaskStepper)
- `src/components/tutor/GuidedThreadViewer.tsx` — просмотр guided-чата со стороны репетитора
- `src/lib/tutorHomeworkApi.ts` — API-клиент для репетиторов
- `supabase/functions/homework-api/` — Edge function CRUD (8 маршрутов)
- `supabase/functions/homework-reminder/` — напоминания о ДЗ (cron)

### LaTeX в деталях и результатах ДЗ (Sprint 1, 2026-03-17)
- `TutorHomeworkDetail.tsx` — task_text, correct_answer, student_text, ai_feedback рендерятся через `MathText`
- `TutorHomeworkResults.tsx` — student_text, ai_feedback через `MathText`; task header в review-карточке — `stripLatex` (compact plain-text preview)
- `TutorHomework.tsx` — сортировка (created_desc / deadline_asc) + deadline urgency badges (overdue/today/soon/normal)
- **Правило**: dense surfaces (collapsed card headers, lists) → `stripLatex` + truncation; expanded/detail views → полный `MathText`

### GuidedThreadViewer — UX improvements (Sprint 2, 2026-03-17)
- Убран лишний клик «Показать переписку» — тред загружается автоматически при раскрытии ученика
- `enabled` prop контролирует lazy-loading запроса (на Results-странице — по expand ученика)
- Сообщения рендерятся через `MathText` (LaTeX формулы в AI/tutor сообщениях)
- `ThreadAttachments` резолвит `storage://` refs через signed URLs и отображает как изображения или file cards
- Репетитор может прикрепить изображение к сообщению (upload через `uploadTutorHomeworkTaskImage`, ref сохраняется в `image_url`)
- Student-side `GuidedChatMessage` тоже отображает `image_url` через `ThreadAttachments` (резолвит через `getStudentTaskImageSignedUrl`)
- Backend `handleTutorPostMessage` принимает optional `image_url` в body

### Guided chat media upload — Phase 1 (2026-03-20)
- Student backend `handlePostThreadMessage` принимает optional `image_url`, принимает только `storage://...` refs и сохраняет `image_url` в `homework_tutor_thread_messages`
- `saveThreadMessage()` в `src/lib/studentHomeworkApi.ts` принимает optional `imageUrl` и отправляет его как `image_url` в `POST /threads/:id/messages`
- Phase 1 покрывает только transport/persist layer; student upload UI, Storage upload и передача student image в AI остаются в следующих фазах

### Guided chat media upload — Phase 2 (2026-03-20)
- **GuidedChatInput.tsx** — кнопка 📎 (Paperclip) слева от textarea, hidden `<input type="file" accept="image/*,.pdf" multiple>`, `AttachmentPreview` компонент (thumbnail/file card 48px, имя, размер, ✕/spinner)
- Валидация: JPG/PNG/HEIC/WebP/PDF, ≤ 10 МБ, max 3 файла
- `URL.revokeObjectURL` cleanup при unmount и remove файла
- **GuidedHomeworkWorkspace.tsx** — `attachedFiles` / `isUploading` state, file handlers, `sendUserMessage(text, mode, files?)` с multi-upload flow
- `isUploading` добавлен в race guard (`controlsDisabled`, `handleTaskClick`)
- `content` для file-only сообщений строится через placeholder (`(фото)`, `(PDF)`, `(вложения xN)`)
- **studentHomeworkApi.ts** — `uploadStudentThreadImage(file, assignmentId, threadId, taskOrder)` → upload в `homework-submissions` bucket, path `{studentId}/{assignmentId}/threads/{taskOrder}/{fileId}.{ext}`, возвращает `storage://` ref
- ID файла: `Date.now()-Math.random()` (не `crypto.randomUUID` — Safari < 15.4)
- **answer+image end-to-end**: `checkAnswer()` принимает attachment refs, backend `handleCheckAnswer` валидирует student path ownership и сохраняет serialized attachments в `homework_tutor_thread_messages`
- **retry+image**: retry failed user message передаёт serialized `image_url` из сохранённого сообщения, не теряет вложения
- AI path использует latest student images для `answer`, `hint` и `question`; PDF сохраняется и отображается, но в AI пока не передаётся

### Guided chat media upload — Phase 5 (2026-03-20)
- **5.1 Clipboard paste**: `onPaste` handler на container div в `GuidedChatInput.tsx`. Перехватывает image paste через `clipboardData.files` с fallback на `clipboardData.items` + `getAsFile()` (Safari/Firefox). Text paste не перехватывается. `preventDefault()` вызывается только после успешной валидации (type/size/max files)
- **5.2 Mobile camera**: `<input type="file" accept="image/*,.pdf" multiple>` — native file picker на iOS/Android предлагает камеру/галерею/документ picker. Bottom sheet (Variant B) отложен в P1
- **touch-action: manipulation** добавлен на все interactive элементы: 📎, Шаг, Ответ, ✕ (remove attachment) — предотвращает 300ms tap delay на iOS Safari
- **НЕ реализовано (P1)**: bottom sheet, drag-and-drop, HEIC конвертация, image compression

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
2. Если путь идёт через Lovable gateway, который не скачивает remote image сам, подписанный URL нужно дополнительно заинлайнить в `data:image/...;base64,...` перед вызовом модели
3. Передать как multimodal `{ type: "image_url", image_url: { url: "https://..." } }` или `data:` URL в массиве `content` user-сообщения
4. **НИКОГДА** не вставлять `storage://` или raw URL как текст в промпт — AI его не увидит

**Четыре пути к AI в guided chat** (все должны передавать изображение корректно):
- `answer` → `handleCheckAnswer` → `evaluateStudentAnswer` в `guided_ai.ts` (task image resolved в `index.ts`, latest student image resolved в signed URL и inline-ится в `guided_ai.ts`)
- `hint` → `handleRequestHint` → `generateHint` в `guided_ai.ts` (task image resolved в `index.ts`, latest student image resolved в signed URL и inline-ится в `guided_ai.ts`)
- `question` → `streamChat()` → `/functions/v1/chat` (resolved на фронтенде, передаются `taskImageUrl` и optional `studentImageUrls`, затем backend inline-ит их в base64/data URL)
- `bootstrap` → `streamChat()` → `/functions/v1/chat` (resolved на фронтенде, передаётся только `taskImageUrl`; student image на intro не передаётся по дизайну)

При добавлении нового пути к AI с изображениями — проверить ВСЕ вызывающие точки, не только основную.

### Student Guided Homework UX (Sprint S1, 2026-03-19)

Реализованы 5 quick wins для guided mode прорешивания:

- **S1-1: MathText в условии задачи** — `GuidedHomeworkWorkspace.tsx` рендерит `task_text` через lazy `MathText` (с `Suspense` fallback). `whitespace-pre-wrap` сохранён для plain-text задач
- **S1-2: Bootstrap для всех задач** — убрано ограничение `order_num !== 1`. AI intro генерируется при первом открытии любой задачи без сообщений. Backend system messages (`role: 'system'`) исключаются из проверки `hasAnyTaskMessages`. Backend integrity check (`INVALID_ORDER`) обходится для `message_kind: 'system'` — bootstrap сохраняется в БД и виден репетитору
- **S1-3: Enter = Обсудить** — `Enter` → `handleSendStep` (question mode, безопасный). `Ctrl/Cmd+Enter` → `handleSendAnswer` (answer mode, проверка). Платформо-зависимый label (`Cmd` на Mac, `Ctrl` на Windows)
- **S1-4: Label «Введение»** — `formatMessageKind('system')` → `'Введение'` в student view. В tutor `GuidedThreadViewer` — badge «Введение» только для `role: 'assistant'` + `message_kind: 'system'` (не для transition messages с `role: 'system'`)
- **S1-5: Shared preprocessLatex** — удалён inline дубликат из `GuidedChatMessage.tsx`, импорт из `@/components/kb/ui/preprocessLatex.ts`. Inline версия имела баг: `'$$'` — спецсимвол в `String.replace`

**Race guard**: `handleTaskClick` блокирует навигацию при `isStreaming || isCheckingAnswer || isRequestingHint`

**Spec**: `docs/features/specs/student-homework-sprint-s1-spec.md`

### Свободный порядок задач в guided mode (2026-03-19)

Ученик может решать задачи в **любом порядке** (как на ЕГЭ/ОГЭ), а не строго последовательно.

**Backend:**
- `provisionGuidedThread` создаёт **все** `task_states` как `"active"` (было: только первая, остальные `"locked"`)
- `/threads/:id/check` и `/threads/:id/hint` принимают optional `task_order` в body — backend работает с задачей, указанной клиентом
- `loadAdvanceContext` принимает `overrideTaskOrder` — используется вместо `thread.current_task_order` когда клиент указал task_order
- `handleRequestHint` теперь получает body и ищет task_state по `task_order`, а не берёт первый `status = 'active'`

**Frontend:**
- `activeTaskOrder` = `currentTaskOrder` (следует за выбором ученика)
- `isViewingActiveTask` проверяет `currentActiveTaskState?.status === 'active'` (разрешает ввод для любой незавершённой задачи)
- `checkAnswer(threadId, answer, taskOrder)` и `requestHint(threadId, taskOrder)` передают `task_order` на backend
- `TaskStepper`: `isActive` = `order_num === currentTaskOrder` (кольцо только на текущей задаче, не на всех active)
- `activeRef` привязан только к текущей задаче для корректного auto-scroll

**Важно:**
- `thread.current_task_order` остаётся в БД, но используется как fallback — primary source of truth для check/hint теперь приходит от клиента
- `performTaskAdvance` по-прежнему обновляет `current_task_order` при завершении задачи, но это не блокирует навигацию
- Ученик НЕ МОЖЕТ отправлять ответы/подсказки для `completed` задач — проверка `status === 'active'` на обоих сторонах

### Два поля ввода «Ответ» и «Обсуждение» (Sprint S2, 2026-03-22)

Заменено одно текстовое поле на два раздельных в `GuidedChatInput.tsx`:

- **AnswerField** (зелёная рамка `border-2 border-green-600`, сверху): Enter = `onSendAnswer` → AI проверяет ответ
- **DiscussionField** (серая рамка `border border-slate-200`, снизу): Enter = `onSendStep` → AI обсуждает шаг

**Причина:** ученик путал Enter (обсуждение) и Ctrl+Enter (проверка) → AI начинал обсуждать вместо проверки → churn

**Ключевые решения:**
- Два независимых state: `answerText` + `discussionText`. Каждое поле очищается только при своей отправке
- Ctrl+Enter / Cmd+Enter **полностью убран** — больше не нужен
- `attachedFiles` — shared (один `<input type="file">`), `AttachmentPreview` фиксированно над answer-полем
- `placeholder` prop deprecated (игнорируется) — каждое поле имеет hardcoded placeholder с `taskNumber`
- Props `onSendAnswer(text)` и `onSendStep(text)` — без изменений сигнатуры

**Фазы:**
- Phase 1 (done): рефакторинг GuidedChatInput → два поля
- Phase 2 (done): мобильный аккордеон — discussion свёрнуто по умолчанию на `<768px`
  - `isDiscussionExpanded` state, toggle-кнопка `md:hidden`, CSS `transition-all duration-200`
  - Discussion wrapper: `max-h-0` (collapsed) / `max-h-96` (expanded) / `md:max-h-none` (desktop override)
  - Compact answer: `answerCompact` derived var → label `hidden md:flex`, hint `hidden md:block`, padding `p-2 md:p-3`
  - `aria-expanded` + `aria-controls` на toggle, `touch-action: manipulation`
- Phase 3 (pending): обновление GuidedHomeworkWorkspace — убрать `placeholder`, добавить `taskNumber`, удалить `modKey`
- Phase 4 (pending): QA кросс-браузерная проверка

**Spec:** `docs/features/specs/guided-chat-two-fields-tasks.md`

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
- `src/components/kb/ui/` — UI-утилиты KB (MathText, CopyTaskButton, stripLatex, preprocessLatex, SourceBadge, ContextMenu)
- `src/hooks/useKnowledgeBase.ts`, `src/hooks/useFolders.ts` — хуки
- `src/types/kb.ts` — типы
- `src/stores/hwDraftStore.ts` — Zustand store для корзины ДЗ

### LaTeX-рендеринг в KB (Sprint 1, 2026-03-17)
- `MathText` (`src/components/kb/ui/MathText.tsx`) — lazy-loaded KaTeX рендеринг формул в карточках задач
- `preprocessLatex` (`src/components/kb/ui/preprocessLatex.ts`) — нормализация LaTeX-делимитеров (`\[..\]` → `$$`, `\(..\)` → `$`)
- `stripLatex` (`src/components/kb/ui/stripLatex.ts`) — plain-text fallback (убирает LaTeX, используется в CopyToFolderModal и как Suspense fallback)
- `CopyTaskButton` (`src/components/kb/ui/CopyTaskButton.tsx`) — копирование текста задачи в буфер обмена
- MathText используется в: `TaskCard.tsx`, `KBPickerSheet.tsx`, `HWDrawer.tsx`
- **Правило**: hasMath = false → plain text (нулевой overhead KaTeX); hasMath = true → lazy ReactMarkdown + remarkMath + rehypeKatex
- **Не импортировать** MathText/KaTeX в `src/components/ui/*` (performance.md)

### Архитектура двух пространств + Source→Copy Model (Moderation V2)
- **Каталог Сократа** — read-only витрина. Читает **ТОЛЬКО** `kb_tasks WHERE owner_id IS NULL AND moderation_status = 'active'`
- **Моя база** (kb_folders + kb_tasks where owner_id = user) — личные папки
- **Запрос каталога**: `fetch_catalog_tasks_v2(topic_id)` — фильтрует owner_id=NULL + moderation_status='active'
- **Модераторы**: роль через `has_role(uid, 'moderator')` (таблица `user_roles`), не хардкод email
- **Source→Copy**: задача-источник в папке «сократ» модератора → каноническая публичная копия (owner_id=NULL) в каталоге
  - `published_task_id` на источнике → указывает на публичную копию
  - `source_task_id` на копии → указывает на источник
- **Auto-publish**: перенос в «сократ» → триггер автоматически создаёт публичную копию
- **Auto-resync**: правка источника в «сократ» → триггер обновляет публичную копию
- **Fingerprint dedup**: `kb_normalize_fingerprint(text, answer)` + `pg_advisory_xact_lock`
  - Первый опубликовавший fingerprint побеждает; дубли → `hidden_duplicate`
  - Правка, создающая дубль → `RAISE EXCEPTION` (save blocked)
  - После unpublish скрытые дубли НЕ восстанавливаются
- **RPCs**: `kb_mod_unpublish(p_published_task_id)`, `kb_mod_reassign(p_published_task_id, p_new_source_task_id)`
- **RPC wrappers**: `kbModUnpublish(publishedTaskId)`, `kbModReassign(publishedTaskId, newSourceTaskId)` в `src/lib/kbApi.ts`
- **Fallback**: `promote_folder_to_catalog()` — переводит задачи в owner_id=NULL напрямую (если модератор уходит)
- **Audit**: `kb_moderation_log` — все действия логируются
- **Security**: `kb_publish_task()` / `kb_resync_task()` — REVOKE FROM PUBLIC, authenticated (только триггеры)
- **RLS**: non-moderators видят только `moderation_status = 'active'` каталожные задачи
- **UNIQUE indexes**: `idx_kb_tasks_unique_source`, `idx_kb_tasks_unique_published` — one-to-one source↔copy

### Модерационный пайплайн (KB)
- Миграции: `20260318130000_kb_moderation_pipeline.sql`, `20260318140000_kb_catalog_live_sync.sql`, `20260318150000_kb_moderation_v2.sql`
- У каждого модератора: папка «Черновики для сократа» (скрыта) + «сократ» (auto-publish в каталог)
- Поток: SQL-сид → Черновики → ревью → перенос в «сократ» (+ topic_id) → триггер создаёт публичную копию → каталог
- Подпапки в «сократ» разрешены — `kb_is_in_socrat_tree()` рекурсивно проверяет
- Diagram: `kb_pipeline_diagram.html`

### Moderator UI (Sprint 3, 2026-03-18)
- `src/hooks/useIsModerator.ts` — React Query хук, вызывает `has_role(uid, 'moderator')` RPC. Query key: `['tutor', 'kb', 'isModerator', userId]` — скопирован по user.id для корректной инвалидации при смене аккаунта
- `src/lib/kbApi.ts` — `kbModUnpublish(publishedTaskId)`, `kbModReassign(publishedTaskId, newSourceTaskId)` — RPC wrappers
- `src/components/kb/TaskCard.tsx` — props: `isModerator`, `onUnpublish`, `onReassign`. Бейджи: «дубль скрыт» (red), «снято» (amber). ContextMenu: «Снять публикацию», «Перепривязать источник»
- **ПОДКЛЮЧЕНО** (Sprint 3, 2026-03-18):
  - `CatalogTopicPage.tsx` — `useIsModerator()` + `handleUnpublish` / `handleReassign` → props в `<TaskCard>`
  - `FolderPage.tsx` — `useIsModerator()` → `isModerator` prop в `<TaskCard>` (handlers не нужны — задачи `isOwn`, `isModeratable=false`)

### Триггеры модерации (точные имена)
- `trg_kb_before_update_block_dup` — BEFORE UPDATE, блокирует дубли fingerprint
- `trg_kb_after_update_moderation` — AFTER UPDATE, auto-publish при перемещении в «сократ» + auto-resync при правке
- `trg_kb_after_insert_moderation` — AFTER INSERT, auto-publish если задача вставлена в «сократ»

### SVG-графики для задач
- `kb-graphs/z1_01.svg` ... `z1_27.svg` — SVG-графики для Задания 1 (кинематика, Демидова 2025)
- Seed-миграция ссылается на `storage://kb-attachments/demidova2025/z1_XX.svg`
- Upload script: `scripts/upload-kb-graphs.sh` — загрузка в Supabase Storage
- `generate_kb_graphs.py` — генератор (matplotlib), запускать из корня проекта

### Дизайн-токены KB
- Primary: #1B6B4A (socrat green)
- Folder: #5B5FC7 (purple)
- Accent: #E8913A (orange, "Моя" badge)

### Snapshot-механика
При добавлении задачи в ДЗ — текст фиксируется в homework_kb_tasks.task_text_snapshot.
Ученик видит snapshot, не оригинал. Репетитор может редактировать snapshot в drawer.

### Reorder задач в конструкторе ДЗ (2026-03-19)

Репетитор может менять порядок задач кнопками ↑/↓ в header каждой карточки задачи.

- `HWTaskCard.tsx` — props: `onMoveUp`, `onMoveDown`, `isFirst`, `isLast`. Кнопки `ChevronUp`/`ChevronDown` слева от "Задача N"
- `HWTasksSection.tsx` — `handleMove(fromIdx, toIdx)` — splice-based reorder, передаёт в `onChange`
- Порядок определяется позицией в массиве `tasks[]`. На submit: `order_num: i + 1`
- **Backend**: `hw_reorder_tasks(assignment_id, task_order_jsonb)` — PL/pgSQL, `SECURITY DEFINER`, атомарная транзакция. Двухфазный update (negative temporaries → final values) обходит `UNIQUE(assignment_id, order_num)`
- **Миграция**: `20260319100000_hw_reorder_tasks_atomic.sql`
- **Валидация**: дубли `order_num` ловятся на двух уровнях — edge function (400 VALIDATION) + PL/pgSQL (RAISE EXCEPTION)
- **Порядок операций в PUT /assignments/:id** (ветка без submissions): reorder RPC → field updates → insert → delete (delete последним = no data loss on partial failure)
- **Known limitation**: весь task diff (reorder + fields + insert + delete) не одна DB транзакция end-to-end. Reorder сам по себе атомарный
- **DnD не реализован** — только кнопки ↑/↓. Drag-and-drop отложен как L2/power-user feature

### Конструктор ДЗ — L0/L1 архитектура (Phase 3, 2026-03-17)

`TutorHomeworkCreate.tsx` — single-page конструктор с progressive disclosure:

**L0 (всегда видно):** Тема → Кому (`HWAssignSection`) → Задачи (`HWTasksSection`) → `HWActionBar`
**L1 (collapsible, «Расширенные параметры»):** `HWExpandedParams` (название, предмет, дедлайн, режим) + `HWMaterialsSection`

Правила:
- Dot indicator на L1-кнопке: показывается если `title`, `subject !== 'physics'`, `deadline`, `workflow_mode !== 'guided_chat'` или `materials.length > 0`
- L1 auto-expand при ошибке валидации `subject`
- `_topicHint` — soft warning (non-blocking): ключи с суффиксом `Hint` не считаются blocking errors
- Поле «Тема» в L0 (контейнере), НЕ в `HWExpandedParams`
- `HWTasksSection` не содержит `materials` props — материалы в L1 контейнера

### Интеграция KB → конструктор ДЗ (KBPickerSheet)

Точка интеграции KB → черновик ДЗ в конструкторе:
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
