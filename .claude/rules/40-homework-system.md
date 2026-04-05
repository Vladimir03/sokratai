# Homework System

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

### Формат проверки задач (`check_format`, Phase 1, 2026-04-01)

Колонка `check_format` в `homework_tutor_tasks` определяет как AI проверяет ответ ученика в guided chat.

**Значения:**
- `'short_answer'` (default) — краткий ответ (число, слово, формула). AI проверяет как обычно
- `'detailed_solution'` — развёрнутое решение. AI отклоняет голые ответы без хода решения (`verdict: INCORRECT`)

**Ключевые решения:**
- Enforcement **только в guided chat** (classic mode не поддерживает)
- Deterministic fast path (`tryDeterministicShortAnswerMatch`) **отключён** для `detailed_solution` — AI должен оценить наличие хода решения
- `buildCheckFormatGuidance()` в `guided_ai.ts` добавляет enforcement-промпт + hint при коротком ответе (`< 30 символов`)
- При добавлении задачи из KB: приоритет `task.check_format` → `mapAnswerFormatToCheckFormat(task.answer_format)` → `inferCheckFormat(kim_number)` (КИМ 21-26 → `detailed_solution`). Legacy `answer_format` значения (`detailed`, `number`, `text`, `choice`, `matching`) маппятся в `mapAnswerFormatToCheckFormat()` в `HWTasksSection.tsx`

**Student-facing UX (R8, 2026-04-02):**
- `StudentHomeworkTask` включает `check_format: 'short_answer' | 'detailed_solution'`
- `getStudentAssignment()` загружает `check_format` из БД
- **Notice banner** (amber) в `GuidedHomeworkWorkspace.tsx` под условием задачи: показывается только для `detailed_solution`
- **Dynamic placeholder** в `GuidedChatInput.tsx`: `answerPlaceholder` prop — `'Напиши решение с ходом рассуждений...'` для `detailed_solution`, `'Ответ...'` для `short_answer`
- **AI bootstrap**: `buildGuidedSystemPrompt('bootstrap', { checkFormat })` добавляет инструкцию упомянуть требование хода решения в intro

**Файлы:**
- `guided_ai.ts`: `buildCheckFormatGuidance()`, `EvaluateStudentAnswerParams.checkFormat`
- `index.ts`: `VALID_CHECK_FORMATS`, `handleCreateAssignment`, `handleUpdateAssignment`, `handleCheckAnswer` (SELECT + pass to AI)
- `GuidedHomeworkWorkspace.tsx`: banner, bootstrap checkFormat, answerPlaceholder pass-through
- `GuidedChatInput.tsx`: `answerPlaceholder` prop
- `src/types/homework.ts`: `StudentHomeworkTask.check_format`
- `src/lib/studentHomeworkApi.ts`: `check_format` в SELECT query
- Миграция: `20260401120000_add_check_format_to_homework_tutor_tasks.sql`
- Спека: `docs/delivery/features/check-format/spec.md`

**Tutor UI (Phase 2, 2026-04-02):**
- `HWTaskCard.tsx`: нативный `<select>` для `check_format` (Краткий ответ / Развёрнутое решение) + hint text под selector
- `HWTaskCard.tsx`: inline badge «из БЗ» (без flex на Label — flex ломает выравнивание grid) рядом с «Макс. баллов» когда `kb_task_id` и `max_score > 1`
- `HWTasksSection.tsx`: `mapAnswerFormatToCheckFormat()` — маппинг legacy `answer_format` → `check_format` enum
- `select` элемент: `font-size: 16px` + `touch-action: manipulation` (iOS Safari auto-zoom prevention)

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
- **S1-3: Enter = отправить** — `Enter` в AnswerField → проверка ответа, `Enter` в DiscussionField → обсуждение с AI. Два раздельных поля (см. Sprint S2)
- **S1-4: Label «Введение»** — `formatMessageKind('system')` → `'Введение'` в student view. В tutor `GuidedThreadViewer` — badge «Введение» только для `role: 'assistant'` + `message_kind: 'system'` (не для transition messages с `role: 'system'`)
- **S1-5: Shared preprocessLatex** — удалён inline дубликат из `GuidedChatMessage.tsx`, импорт из `@/components/kb/ui/preprocessLatex.ts`. Inline версия имела баг: `'$$'` — спецсимвол в `String.replace`

**Race guard**: `handleTaskClick` блокирует навигацию при `isStreaming || isCheckingAnswer || isRequestingHint`

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
- `placeholder` prop удалён — каждое поле имеет короткий hardcoded placeholder (`Ответ...` / `Обсуди с AI...`)
- Props `onSendAnswer(text)` и `onSendStep(text)` — без изменений сигнатуры

**Фазы:**
- Phase 1 (done): рефакторинг GuidedChatInput → два поля
- Phase 2 (done): аккордеон обсуждения — discussion свёрнуто по умолчанию на **всех** экранах
- Phase 3 (done): обновление GuidedHomeworkWorkspace + per-task drafts
- Phase 4 (pending): QA кросс-браузерная проверка

### Mobile UX polish (Sprint S3, 2026-03-23)

Оптимизация мобильного и десктоп-UX guided homework chat для максимизации пространства чата.

**Навигация (`Navigation.tsx`):**
- Логотип + вкладки + logout объединены в одну строку `h-14`
- Вкладка «Главная» удалена — логотип «Сократ» ведёт на `/`
- На мобиле текст «Сократ» скрыт (`hidden md:inline`), вкладки горизонтально скроллятся

**Layout workspace (`GuidedHomeworkWorkspace.tsx`):**
- Блок с названием ДЗ / предметом / статусом **удалён** (был desktop-only `hidden md:block`)
- Условие задачи: collapsible toggle работает и на mobile и на desktop
- Условие раскрыто по умолчанию (`useState(true)`) — ученик видит задачу при первом заходе
- Кнопки «Предыдущая» / «Следующая»: icon-only на мобиле (`hidden md:inline` для текста)

### Task-lock fix — фиксация задачи при check/hint (2026-04-01)

**Проблема:** при check/hint `syncThreadFromResponse()` перезаписывал `currentTaskOrder` из БД → ученик перебрасывался на другую задачу.

**Решение:**
- `syncThreadDataOnly()` — обновляет messages/task_states/status **без** изменения навигации
- `handleCheckAnswer` и `handleHint` используют `syncThreadDataOnly` вместо `syncThreadFromResponse`
- При `CORRECT` — 1200ms celebration анимация на TaskStepper (`celebratingTaskOrder` state + CSS ring/scale/bounce), затем auto-advance на следующую active задачу
- `celebrationTimerRef` (useRef) + cleanup useEffect предотвращают memory leak при unmount
- `switchToTask` очищает pending celebration timer при ручном переключении
- Race guard в `handleTaskClick`: блокирует навигацию при `celebratingTaskOrder !== null`
- Restore-on-load: `thread.current_task_order` используется только при mount; fallback на first active если target completed

**Ключевые файлы:**
- `GuidedHomeworkWorkspace.tsx` — `syncThreadDataOnly`, celebration logic, timer cleanup
- `TaskStepper.tsx` — `celebratingTaskOrder` prop, CSS animation (no framer-motion)

**Init-once навигация (2026-04-02):**
- `hasInitializedRef` — навигация (`setCurrentTaskOrder`) устанавливается только при первом получении `thread`, не при каждом refetch
- Причина: `queryClient.invalidateQueries` после check/hint вызывал refetch → init effect перезаписывал `currentTaskOrder` серверным `current_task_order` → ученик перебрасывался на другую задачу
- `assignment.id` change → ref сбрасывается (поддержка навигации между ДЗ без remount)
- После инициализации навигацию контролируют только `switchToTask()` (клик) и auto-advance (CORRECT + 1200ms)

**Completed view UX (2026-04-02):**
- Экран результатов **НЕ** показывается автоматически — ученик сначала видит чат с решениями
- Кнопка «Завершить и посмотреть результаты» рендерится inline в области сообщений после последнего сообщения (под «Все задачи выполнены!»)
- `GuidedChatInput` скрывается при `threadStatus === 'completed'` (нет ложного поля ввода)
- На экране результатов только «Назад к заданиям» (без «Посмотреть решения задач» — вызывало путаницу с заблокированным вводом)

**Спека:** `docs/delivery/features/guided-chat/task-lock-spec.md`

### Bootstrap hallucination fix + disable toggle (Sprint S4, 2026-03-27)

**TASK-0A: Fix Bootstrap Hallucination (CRITICAL)**
- `buildTaskContext()` в `GuidedHomeworkWorkspace.tsx` теперь поддерживает `sendMode: 'bootstrap'` — отдельный `modeHint` для стартового сообщения
- Bootstrap call передаёт `'bootstrap'` вместо `'question'` → AI больше не галлюцинирует «вижу твоё решение»
- `isMinimalText` порог расширен: `length <= 20` + regex `/^\[.*\]$/` для placeholder-ов вроде `[Задача на фото]`
- Bootstrap system prompt усилен: явный запрет упоминать «решение ученика», fallback для нечитаемых изображений

**TASK-0B: Disable AI Bootstrap Toggle**
- Колонка `disable_ai_bootstrap boolean NOT NULL DEFAULT false` в `homework_tutor_assignments`
- Toggle «AI-вступление к задачам» (позитивная формулировка) в L1 `HWExpandedParams.tsx`, видим только при `workflow_mode === 'guided_chat'`
- Backend: `homework-api/index.ts` — create + update handlers принимают `disable_ai_bootstrap`
- Student-side: guard в `GuidedHomeworkWorkspace.tsx` пропускает bootstrap если `assignment.disable_ai_bootstrap`

### Конструктор ДЗ — L0/L1 архитектура (Phase 3, 2026-03-17)

`TutorHomeworkCreate.tsx` — single-page конструктор с progressive disclosure:

**L0 (всегда видно):** Тема → Кому (`HWAssignSection`) → Задачи (`HWTasksSection`) → `HWActionBar`
**L1 (collapsible, «Расширенные параметры»):** `HWExpandedParams` (название, предмет, дедлайн, режим) + `HWMaterialsSection`

Правила:
- Dot indicator на L1-кнопке: показывается если `title`, `subject !== 'physics'`, `deadline`, `workflow_mode !== 'guided_chat'` или `materials.length > 0`
- L1 auto-expand при ошибке валидации `subject`
- `_topicHint` — soft warning (non-blocking): ключи с суффиксом `Hint` не считаются blocking errors
- Поле «Тема» в L0 (контейнере), НЕ в `HWExpandedParams`

### Тренажёр формул — Formula Rounds (Phase 1a, 2026-04-05)

Новый homework-артефакт: ученик проходит раунд из 10 заданий по формулам (3-5 минут, 3 жизни).

**Архитектура:**
- **Formula engine — client-side** (`src/lib/formulaEngine/`). Нет AI-вызовов, нет edge functions. Генерация заданий из статической базы 12 формул кинематики. При добавлении разделов (динамика, etc.) — формулы переедут в DB
- **Три типа заданий** по слоям знания (GDD §4.1, §4.5, §4.8):
  - Layer 3: `TrueOrFalseCard` — формула верна/неверна (мутации из `MUTATION_LIBRARY`)
  - Layer 2: `BuildFormulaCard` — собери формулу из токенов (числитель/знаменатель)
  - Layer 1: `SituationCard` — ситуация → выбери формулу

**Критичное: structured answer validation**
- `BuildFormulaAnswer { numerator: string[]; denominator: string[] }` — НЕ flat array
- `BUILD_RECIPES` в `questionGenerator.ts` хранит `numeratorTokens` / `denominatorTokens`
- **Все карточки возвращают raw answer**, correctness определяется ТОЛЬКО в `FormulaRoundScreen.handleAnswer` (single source of truth). НЕ ПЕРЕНОСИТЬ проверку обратно в карточки
- Дистракторы: `relatedFormulas` first → sameSection backfill (GDD §6.4). НЕ shuffle(merged)

**Фазы:**
- **Phase 1a** (текущая): student-facing round UI + DB + formula engine. Ученик заходит по `/homework/:id/round/:roundId`
- **Phase 1b** (отдельная spec): tutor assignment UI в TutorHomeworkCreate + tutor visibility в TutorHomeworkDetail/Results + homework completion integration

**DB таблицы:**
- `formula_rounds` — конфигурация раунда (привязана к assignment, section, lives, question count)
- `formula_round_results` — результаты прохождения (score, answers JSONB, weak_formulas JSONB)
- RLS: student видит свои rounds/results. `tutor_read_results` policy **существует** (для Phase 1b), но tutor UI пока не реализован

**Ключевые файлы:**
- `src/lib/formulaEngine/formulas.ts` — 12 формул кинематики (статическая база)
- `src/lib/formulaEngine/questionGenerator.ts` — генерация заданий, мутации, дистракторы, feedback
- `src/lib/formulaEngine/types.ts` — `FormulaQuestion`, `BuildFormulaAnswer`, `RoundResult`
- `src/components/homework/formula-round/FormulaRoundScreen.tsx` — основной экран раунда (fullscreen, correctness checking)
- `src/components/homework/formula-round/RoundResultScreen.tsx` — итоговый экран (score, weak formulas, retry)
- `src/pages/StudentFormulaRound.tsx` — page component, route `/homework/:id/round/:roundId`
- `src/hooks/useFormulaRound.ts` — React Query hooks
- `src/lib/formulaRoundApi.ts` — API для сохранения результатов
- `supabase/migrations/20260406_formula_rounds.sql` — миграция

**Спека:** `docs/delivery/features/formula-rounds/spec.md`
**GDD (source of truth для gameplay):** `docs/SokratAI_physics_game-design-document.md`

### Reorder задач в конструкторе ДЗ (2026-03-19)

- `HWTaskCard.tsx` — props: `onMoveUp`, `onMoveDown`, `isFirst`, `isLast`. Кнопки `ChevronUp`/`ChevronDown`
- **Backend**: `hw_reorder_tasks(assignment_id, task_order_jsonb)` — PL/pgSQL, `SECURITY DEFINER`, атомарная транзакция
- **Порядок операций в PUT /assignments/:id**: reorder RPC → field updates → insert → delete
