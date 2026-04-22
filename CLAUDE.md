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

# Design System (Canonical)

Подробные правила дизайн-системы (внутрипроектные): `.claude/rules/90-design-system.md`

## Design System Handoff (Phase 1 landed 2026-04-20, commit d2d2834)

Canonical cross-kit design system от Claude Design теперь живёт в репо:
- `SKILL.md` (repo root) — system purpose, mode contract (`data-sokrat-mode`), token hierarchy, anti-drift rules (ten laws), extension checklist, pre-flight checks. Читать **до** любой UI-работы.
- `docs/design-system/README.md` — folder map + completion status handoff.
- `src/styles/colors_and_type.css` — **single source of truth** для tokens (`--sokrat-*`), self-hosted `@font-face` (Golos Text 6 weights), mode rules, exam-stream rules, parent overlay rules. Импортится первой строкой в `src/index.css`.
- `src/fonts/GolosText-*.ttf` — Golos Text 400/500/600/700/800/900 локально.
- `src/assets/sokrat-logo.png`, `sokrat-chat-icon.png`, `sokrat-hw-banner.png` — canonical brand assets (PNG by design, не SVG).

**Статус фаз:**
- Phase 1 ✅ additive: файлы + @import + Google Fonts → local (commit `d2d2834`).
- Phase 2 ⏳ pending: shadcn slot mapping (`--primary` indigo → green, hero gradient indigo → green). Preview patch сгенерирован, не применён. Accent mapping использует compatibility-bridge: `--accent` остаётся зелёным до отдельного semantic cleanup, ochre доступен через `bg-socrat-accent` (tailwind) или `var(--sokrat-ochre-500)`.
- Phase 3+ ⏳ deferred: mode wrapper (`data-sokrat-mode`), kit port.

**Hard rules (из SKILL.md):**
- Не дублировать и не шейдовать токены из `colors_and_type.css` — всегда `var(--sokrat-*)`.
- Новый цвет/шрифт/тень — сначала extend `colors_and_type.css`, потом использовать.
- Math — только через KaTeX + `FormulaBlock` / `SFormulaBlock` (см. `.claude/rules/90-design-system.md`).
- Golos Text — единственный sans family. Inter / Roboto / Nyghtserif запрещены.

Внутрипроектный rule-файл `.claude/rules/90-design-system.md` описывает как design-system применяется в конкретных компонентах SokratAI (bg-accent / socrat tokens / anti-patterns). При конфликте (e.g. handoff предписывает `--accent = ochre`, а rule-файл — `bg-accent = green`) — см. SKILL.md §10 Implementation handoff + compatibility bridge в Phase 2 preview.

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

1. `docs/discovery/research/08-wedge-decision-memo-sokrat.md`
2. `docs/discovery/product/tutor-ai-agents/14-ajtbd-product-prd-sokrat.md`
3. `docs/discovery/product/tutor-ai-agents/15-backlog-of-jtbd-scenarios-sokrat.md`
4. `docs/discovery/product/tutor-ai-agents/16-ux-principles-for-tutor-product-sokrat.md`
5. `docs/discovery/product/tutor-ai-agents/17-ui-patterns-and-component-rules-sokrat.md`
6. `docs/discovery/product/tutor-ai-agents/18-pilot-execution-playbook-sokrat.md`
7. relevant file in `docs/delivery/features/`

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

For architecture overview see: docs/delivery/engineering/architecture/README.md

## Domain-specific rules (loaded from .claude/rules/)

| Rule file | Domain |
|---|---|
| `40-homework-system.md` | Homework system, guided chat, workflow modes, DB tables |
| `50-kb-module.md` | Knowledge base, moderation, Source→Copy, fingerprint dedup |
| `60-telegram-bot.md` | Telegram bot, /pay flow, invite flow, AddStudentDialog |
| `70-notifications.md` | Push, email, cascade delivery, VAPID, profiles.email |
| `80-cross-browser.md` | Safari/iOS rules, forbidden patterns, build targets |
| `90-design-system.md` | Цветовая палитра, типографика, spacing, компоненты, anti-patterns |

## КРИТИЧЕСКИЕ ПРАВИЛА

### 0. Новая колонка/поле в БД — ОБЯЗАТЕЛЬНО сгрепать ВСЕ write-sites (2026-04-18)

Когда добавляешь новую колонку в таблицу (или новое поле в payload/type, видимое для AI или критичное для UX), перед заявлением «готово» **ОБЯЗАТЕЛЬНО** найди все места, где в эту таблицу пишут. В репо есть несколько таблиц с **множественными независимыми write-path** — и легко пропустить второй:

- **`homework_tutor_tasks`** (критично для этого урока):
  - Path A: `supabase/functions/homework-api/index.ts` → `handleCreateAssignment` + `handleUpdateAssignment` (3 insert/update блока)
  - Path B: `src/components/kb/HWDrawer.tsx` — **напрямую** `supabase.from('homework_tutor_tasks').insert(...)` из клиента, минуя edge function. Источник данных — `HWDraftTask` из `hwDraftStore` (Zustand + localStorage), заполняемый кнопкой «В ДЗ» на KB-карточке задачи
  - Path C (если появится — добавь в список): любой новый client-side insert
- **`homework_tutor_thread_messages`** — guided chat messages. Проверяй все message-insert-сайты при изменении схемы (task_id invariant, см. rule 40)
- **`kb_tasks`** — modifications через триггеры (Source→Copy, kb moderation v2), см. rule 50
- **`profiles`** — синхронизация ролей, display_name

**Алгоритм проверки** (выполнять перед commit):
1. `grep -rn "from('TABLE_NAME')\.insert\|from('TABLE_NAME')\.update\|into TABLE_NAME" src/ supabase/`
2. Для каждого match убедиться, что новое поле пишется/читается
3. Для type-driven payloads: grep имя типа (например `CreateAssignmentTask`, `HWDraftTask`) — найти все construct-sites

**Симптом пропуска:** «feature работает через один flow, но не через другой» (как было с HWDrawer + solution_text — коммит `f454f6e`). Отсюда же правило: fix → ВСЕГДА проверь вторичные пути.

### 1. Форматирование дат и валюты
- Канонический источник: **`src/lib/formatters.ts`** — функции форматирования дат, валюты, прогресса
- Всегда используй `parseISO` из `date-fns` для разбора строк дат (не `new Date(string)` — ломается в Safari)
- `hourly_rate_cents` / суммы платежей хранятся в копейках (integer). Деление на 100 только при отображении — используй `formatPaymentAmount` из `formatters.ts`

### 2. Profiles table — нет колонки email
Таблица `profiles` **НЕ содержит** колонку `email`. Email хранится **только** в `auth.users`.
Используй `dbService.auth.admin.getUserById(userId)`, **НЕ** `profiles.select("email")`.

### 3. Система домашних заданий — guided chat
Единая система ДЗ (`homework_tutor_*` таблицы), работает через guided chat (пошаговый AI-чат). Classic режим (photo upload + OCR) и legacy student-only система удалены. Подробности: `.claude/rules/40-homework-system.md`

### 4. Formula rounds — standalone pivot status и Phase 1b границы
- Seed для formula rounds: `supabase/seed/formula-round-seed.sql`
- Seed создаёт `test-tutor` и 5 фиксированных `test_student_*` аккаунтов с воспроизводимыми UUID
- Formula Round Phase 1 сейчас пивотится в standalone `/trainer`; backend groundwork уже есть в `supabase/migrations/20260408160000_trainer_standalone_schema.sql` и `supabase/functions/trainer-submit/index.ts`
- `trainer-submit` — публичный endpoint без JWT-check, пишет в `formula_round_results` через `service_role`
- В текущей schema repo ориентируйся на `formula_round_results.student_id`, `formula_round_results.round_id`, `formula_round_results.duration_seconds`; не предполагай колонки `user_id`, `formula_round_id`, `duration_ms`, `client_started_at`, пока они не добавлены отдельной миграцией
- Legacy preview-flow через `StudentFormulaRound.tsx` / `?student=<seed_uuid>` считать устаревающим; не расширять его для standalone trainer
- Для Formula Rounds Phase 1b tutor UI НЕ создавать новый top-level route или отдельный standalone dashboard. Интегрировать только в существующие tutor flows:
  - `src/pages/tutor/TutorHomeworkCreate.tsx`
  - `src/pages/tutor/TutorHomeworkDetail.tsx` (единая каноническая страница для ДЗ — детальная инфа + результаты v2, см. ниже)
- Phase 1b должен оставаться jobs-first: formula round = optional block внутри homework workflow, а не отдельный продукт/игра

### 5. Единая страница детальной инфы + результатов ДЗ (2026-04-07)
- `TutorHomeworkResults.tsx` **удалён**. Каноническая страница ДЗ для репетитора — `TutorHomeworkDetail.tsx` на URL `/tutor/homework/:id`. Она содержит v2-шапку (`ResultsHeader` с метриками Сдали/Средний балл/В процессе/Не приступали/Требует внимания + actions Редактировать/Удалить), `ResultsActionBlock` (секции «не приступал» и «в процессе» с tabs Telegram/Email в диалоге), `HeatmapGrid` (students × tasks), collapsible секцию задач, материалы и отдельную секцию «Разбор ученика» с `GuidedThreadViewer`
- Route `/tutor/homework/:id/results` остался как redirect на `/tutor/homework/:id` — для backward compat с Telegram-ссылками из `homework-reminder`
- Semantic invariant метрики «Требует внимания» в шапке = `notStarted + per_student.filter(s => s.needs_attention).length`. Backend считает `needs_attention` только для сдавших — frontend обязан прибавлять `notStarted`. In-progress студенты выделены в отдельную метрику «В процессе» и отдельную секцию в `ResultsActionBlock`. Подробности: `.claude/rules/40-homework-system.md` → секция «Merged Detail + Results страница»

### 6. HeatmapGrid (Results v2 TASK-5, 2026-04-07)
- `src/components/tutor/results/HeatmapGrid.tsx` — единая таблица students × tasks. **Заменил** локальный `StudentsList` в `TutorHomeworkDetail.tsx`. Локальный `DeliveryBadge` тоже переехал внутрь HeatmapGrid (других потребителей нет)
- Цвета клеток (AC-2): `null → bg-slate-100 text-slate-400 («—»)`, `< 0.3 → bg-red-100`, `0.3..0.8 → bg-amber-100`, `≥ 0.8 → bg-emerald-100`. Helper `getCellStyle` — single source of truth, не дублировать
- Backend `handleGetResults` теперь fetches ALL threads (не только completed), возвращает `per_student[*].task_scores: { task_id; final_score; hint_count }[]` для всех студентов (включая in-progress с individually-completed задачами) — одна точка для матрицы. Не делать N запросов на student-thread. `computeFinalScore` приоритет: `tutor_score_override → earned_score → ai_score → status fallback`
- Клик по строке → `expandedStudentId` в `TutorHomeworkDetailContent` → отдельная Card «Разбор ученика» с `GuidedThreadViewer` рендерится **под** Materials. Только один ученик раскрыт за раз (AC-3 совместимо). `expandedStudentId` сбрасывается при смене assignment id
- **КРИТИЧНО для iOS Safari**: таблица использует `border-separate border-spacing-0` + `<colgroup>` с фиксированными ширинами + `table-layout: fixed` + `width: max-content`. **НЕ менять** на `border-collapse` — `position: sticky` на `<td>` ломается в WebKit при `border-collapse`. **НЕ возвращать** `w-full` на table — съест горизонтальный скролл, потому что table-layout сжимает столбцы под container
- Wrapping `<div>` имеет `overflow-x-auto touch-pan-x` — `touch-pan-x` обязателен, иначе row onClick может съесть touchstart на iOS и блокировать swipe
- `React.memo` на `HeatmapRow` и `HeatmapCell` — обязательно, при 26×10 = 260 ячеек без memo ловится лаг при expand/collapse
- Cell click (TASK-6 ✅): `handleCellClick(studentId, taskId)` → expand student + set `drillDownTaskId`. `e.stopPropagation()` обязателен. `StudentDrillDown` заменяет прямой `GuidedThreadViewer` в Card «Разбор ученика»
- `getCellStyle` + `formatScore` — вынесены в `src/components/tutor/results/heatmapStyles.ts` (избегает react-refresh warning). **НЕ дублировать** эти helpers — импортировать из heatmapStyles.ts
- `GuidedThreadViewer` props (additive): `initialTaskFilter?: number | 'all'`, `hideTaskFilter?: boolean`. `hideTaskFilter=true` в `StudentDrillDown` скрывает дублирующий pill-ряд
- TASK-3 (header), TASK-4 (action block), TASK-5 (heatmap), TASK-6 (drill-down), TASK-7 (edit-score modal) ✅ done. TASK-8..9 (telemetry audit + QA) — отдельные итерации

### 7. Subject CHECK constraint — синхронизация с SUBJECTS (2026-04-14)
- При добавлении нового предмета в `SUBJECTS` (`src/types/homework.ts`) или `VALID_SUBJECTS_CREATE` (`supabase/functions/homework-api/index.ts`) **ОБЯЗАТЕЛЬНО** добавить миграцию, обновляющую constraint `homework_tutor_assignments_subject_check`
- Паттерн нарушения: commit `e57cada` добавил `'maths'`, `'informatics'` и др. в фронт/edge function, но не добавил миграцию → prod выдавал «Failed to create assignment» на любом ДЗ с новыми subject id
- Канонический список (19 значений): `maths, physics, informatics, russian, literature, history, social, english, french, spanish, chemistry, biology, geography, other` + legacy `math, cs, rus, algebra, geometry`
- Фикс: `supabase/migrations/20260414150000_unify_homework_subject_check.sql`

### 8. Имя ученика в AI-промпте — все три пути (2026-04-14/15)

Все три пути общения ученика с AI получают имя и используют правильный грамматический род.

**Источники имени (приоритет):**
- `tutor_students.display_name` — tutor-owned поле, primary source (ДЗ-пути)
- `profiles.username` — fallback, если не автогенеренный
- Автогенеренные username-ы отфильтровываются regex `/^(telegram_|user_)\d+$/i` → AI работает в нейтральной форме

**Путь 1 — «Ответ к задаче» (ДЗ, edge function `homework-api`):**
- `resolveStudentDisplayName(db, studentAssignmentId)` в `supabase/functions/homework-api/index.ts` резолвит: `tutor_students.display_name → profiles.username (non-auto) → null`
- Подключено в `handleCheckAnswer` и `handleRequestHint` → `evaluateStudentAnswer` / `generateHint`
- `buildStudentNameGuidance(studentName)` в `guided_ai.ts` добавляет секцию в системный промпт

**Путь 2 — «Обсудить шаг с AI» и bootstrap (ДЗ, edge function `chat`):**
- Системный промпт строится на фронтенде (`buildGuidedSystemPrompt` в `GuidedHomeworkWorkspace.tsx`)
- `getStudentAssignment` в `studentHomeworkApi.ts` резолвит `studentDisplayName` (те же два источника параллельно)
- Передаётся в `buildGuidedSystemPrompt(..., { studentName })` → в оба `streamChat` вызова

**Путь 3 — обычный чат `/chat` (edge function `chat`):**
- `Chat.tsx` при загрузке делает `useQuery ['user-profile-name']` → `profiles.username` (без tutor context)
- Передаётся как `studentName` в тело запроса к `/functions/v1/chat`
- `chat/index.ts` **добавляет** суффикс к `effectiveSystemPrompt` (не заменяет `SYSTEM_PROMPT`)

**Frontend tutor UI:**
- `TutorStudentProfile.tsx` — поле «Как обращаться в AI-чате» (Input, placeholder «Например, Юля»)
- Миграция: `supabase/migrations/20260414160000_add_tutor_students_display_name.sql`

**Инварианты:**
- **Не** менять `profiles.username` из кабинета репетитора — это самоидентификация ученика
- Пути 1/2 используют `tutor_students.display_name` первым; путь 3 — только `profiles.username` (нет tutor context)
- Все пути возвращают `null` при автогенеренных именах → AI работает без имени, нейтрально

### 9. Эталонное решение репетитора для AI — solution_* + anti-leak (2026-04-18)

Репетитор может прикрепить эталонное решение к задаче (текст + до 5 фото). AI видит его на всех 3 путях (check / hint / chat) как референс, **НИКОГДА не цитирует дословно** ученику.

**DB (homework_tutor_tasks):**
- `solution_text TEXT NULL` — текст эталона
- `solution_image_urls TEXT NULL` — dual-format refs, лимит `MAX_SOLUTION_IMAGES = 5`
- Миграция: `supabase/migrations/20260418120000_add_homework_task_solution.sql`

**Student leak protection (КРИТИЧНО):**
- `handleGetStudentAssignment` в `homework-api/index.ts` НИКОГДА не селектит `solution_text` / `solution_image_urls` / `rubric_text` / `rubric_image_urls`
- `StudentHomeworkTask` тип и `studentHomeworkApi.ts` НЕ содержат этих полей — приложи compile-time гарантию
- Все новые student-endpoints должны аналогично исключать эти поля из SELECT

**AI-инжекция (3 пути):**
- `handleCheckAnswer` → `evaluateStudentAnswer` → `buildCheckPrompt` (guided_ai.ts)
- `handleRequestHint` → `generateHint` → `buildHintPrompt` (guided_ai.ts)
- `/chat` (edge function `chat/index.ts`) — фетчит solution server-side через `service_role` после верификации `homework_tutor_student_assignments`. Клиент (`streamChat` в `GuidedHomeworkWorkspace.tsx`) шлёт только `guidedHomeworkAssignmentId + guidedHomeworkTaskId`; текст/фото решения клиентом не передаются

**Anti-spoiler контракт:**
- В system prompt всех 3 путей — блок «эталон только для сверки, НЕ цитируй, работай Сократовским методом»
- `getGeneratedHintCheck(hint, solutionText, taskText)` — leak-детектор в `guided_ai.ts`: извлекает значимые токены из эталона минус токены задачи (task givens не спойлер), отклоняет вывод при совпадении → retry-once → fallback
- `evaluateStudentAnswer` применяет тот же leak-check к `feedback` и `ai_score_comment`. **Важно: retry — cosmetic rewrite**: сохраняет `verdict`/`confidence`/`error_type`/`ai_score` от первого result, свапает только `feedback` + `ai_score_comment` от retry. Grading detreministic
- `/chat` с guided context — buffered path: полный ответ собирается server-side, leak-детектор, fallback-сообщение при утечке. Обычные /chat запросы (не guided) стримятся как раньше

**Image-only anti-leak gate (v3, критично):**
- Константа `SOLUTION_TEXT_ANCHOR_MIN_CHARS = 20` во всех 3 путях (`chat/index.ts`, `guided_ai.ts::evaluateStudentAnswer`, `guided_ai.ts::generateHint`)
- Если `solution_text.trim().length < 20` — `solution_image_urls` **ДРОПАЮТСЯ** и не прикладываются к промпту. Причина: leak-детектор работает только по тексту; тривиальный anchor («см. фото», 8 символов) не даёт токенов для матчинга, и фото-эталон может быть экстрактирован через «transcribe the attached image» jailbreak
- Telemetry события: `guided_check_solution_images_dropped_no_text`, `guided_hint_solution_images_dropped_no_text`, `guided_chat_solution_images_dropped_no_text`
- Продуктовый контракт: репетитор хочет, чтобы AI видел фото решения → должен написать хотя бы короткий (но ≥ 20 символов) текстовый summary решения

**KB-мост:**
- `kbTaskToDraftTask` в `HWTasksSection.tsx` копирует `kb.solution → solution_text`, `kb.solution_attachment_url → solution_image_paths` (с truncation до `MAX_SOLUTION_IMAGES`)
- Raise separate toast при truncation для условия и для решения

**Templates:**
- `HomeworkTemplateTask` в `tutorHomeworkApi.ts` содержит `solution_text`, `solution_image_urls`, `rubric_image_urls`
- Save (`templateTasksJson` в `homework-api/index.ts::handleCreateAssignment`) и load (оба path'а в `TutorHomeworkCreate.tsx`) переносят все 3 поля. **Не обрывать** эти цепочки — иначе template round-trip будет терять данные AI-контекста

**Плановый документ:** `C:\Users\kamch\.claude\plans\wild-swinging-nova.md`

## Известные хрупкие области

1. **Chat.tsx** (2000+ строк) — очень сложный компонент
2. **Pyodide/GraphRenderer** — Python-графики, зависит от CDN
3. **AuthGuard / TutorGuard** — guard-компоненты. TutorGuard имеет module-level кеш — НЕ УДАЛЯТЬ
4. **Navigation.tsx** — общая навигация. Одна строка: логотип + вкладки + logout
5. **UI-компоненты** (`button.tsx`, `card.tsx`, `badge.tsx`) — используются ВЕЗДЕ
6. **Telegram Auth Flow** — цепочка: `TelegramLoginButton` → `telegram-login-token` → `telegram-bot/handleWebLogin` → `getOrCreateProfile`
7. **Tutor Role Assignment** — через `assign-tutor-role` (email) или `telegram-bot` (Telegram)
8. **Voice messages in Telegram bot** — `telegram-bot/index.ts` обрабатывает `update.message.voice`, скачивает OGG через Telegram API и расшифровывает через Lemonfox Whisper-compatible API перед передачей текста в `handleTextMessage`
10. **Telegram bot reliability** — все вызовы AI идут через `fetchChatWithTimeout` (retry + timeout). `sendTypingLoop` ловит ошибки внутри. Все message routing ветки отвечают пользователю. `mergeConsecutiveUserMessages` обрезает склеенные сообщения до 8000 символов (`MAX_MESSAGE_LENGTH` в chat = 10000). Подробности: `.claude/rules/60-telegram-bot.md`
9. **Voice messages in Student web chat** — `ChatInput.tsx` + `useVoiceRecorder.ts` + `chatVoice.ts` + `chat/index.ts` образуют один pipeline: запись через `MediaRecorder`, серверная расшифровка и только потом ручная отправка в чат
11. **FormulaRoundScreen** — correctness checking centralized в `handleAnswer`. Карточки (TrueOrFalseCard, BuildFormulaCard, SituationCard) возвращают raw answer, НЕ boolean correctness. `BuildFormulaAnswer` = `{ numerator, denominator }`, не flat array. Подробности: `.claude/rules/40-homework-system.md`
12. **Formula round standalone pivot** — backend groundwork уже использует `trainer-submit` + nullable `student_id`/`round_id` flow. Если меняется trainer schema или submit contract — синхронно обновить `supabase/functions/trainer-submit/index.ts`, `supabase/migrations/20260408160000_trainer_standalone_schema.sql` и `.claude/rules/40-homework-system.md`
13. **Тренажёр формул (2026-04-08)** — расширен с 12 кинематических формул на 28 формул по всей механике. Добавлены динамика (6 формул), законы сохранения (7 формул), статика (1 формула), гидростатика (4 формулы). `TrainerPage.tsx` имеет новый UI с выбором раздела (6 кнопок: Вся механика, Кинематика, Динамика, Законы сохранения, Статика, Гидростатика). Каталог формул в `src/lib/formulaEngine/formulas.ts` разбит на пять массивов (`kinematicsFormulas`, `dynamicsFormulas`, `conservationFormulas`, `staticsFormulas`, `hydrostaticsFormulas`) и унифицирован в `mechanicsFormulas`.
13a. **Trainer v1 — Базовый курс «Вращение» (2026-04-18)** — параллельная ветка тренажёра для нулевого уровня. 10 формул Егора по теме «Вращение по окружности», ID-шки с суффиксом `_e` (`kin.13_e`..`kin.22_e`), живут в **отдельном** файле `src/lib/formulaEngine/egorFormulas.ts` (Variant B: hand-craft, вне auto-generation pipeline — не пересекается со скриптом `scripts/import-formula-sheet.mjs`, генерирующим `formulas.generated.ts` / `recipes.generated.ts` / `mutations.generated.ts`). Файл экспортирует `egorFormulas: Formula[]` + `EGOR_BUILD_RECIPES` + `EGOR_SUPPORTED_BUILD_FORMULA_IDS` + `EGOR_MUTATION_LIBRARY`.
    - **v1 НЕ попадает в `mechanicsFormulas`** — иначе v2 раунды подхватят дубликаты (content v1 === v2 kin.13..kin.22). Но `formulasById` map в `formulas.ts` объединяет оба каталога, чтобы `getFormulaById` / `getRelatedFormulas` работали для `_e` ID-шек.
    - **`relatedFormulas` в v1 указывают ТОЛЬКО внутрь v1** (все с `_e` суффиксом). Cross-reference на v2 запрещён — это контракт parallel branch, не роняй его при добавлении новых v1-формул.
    - **Simple mode в `questionGenerator.ts`**: `RoundConfig.mode?: 'v1' | 'v2'` (default `'v2'`). В `v1` используется `selectV1Distribution(questionCount)` — только `TrueOrFalse` (Layer 3) и `BuildFormula` (Layer 2), **без SituationCard** (Layer 1). Детекция каталога для recipes/mutations lookup идёт через `isEgorFormulaId(id) → id.endsWith('_e')`.
    - **UI**: новая кнопка «Базовый курс · Вращение» в `TrainerPage.tsx`. `SectionType` расширен `'egor-v1'`, `SECTION_POOLS['egor-v1']` держит `{ formulas: egorFormulas, mode: 'v1' }`. Gamification: новый `SectionKey = 'egor-v1'` в `trainerGamificationStore.ts` — отдельный `bestScoreBySection` bucket, чтобы не смешивать с `'kinematics'` v2. Store версия **не** бампалась — `Partial<Record<SectionKey, number>>` forward-compatible. Кнопка «Базовый (Вращение)» добавлена в `BestScoreCard` selector.
    - **При расширении v1** (новые разделы / формулы Егора): добавляй всё в `egorFormulas.ts` (формула + recipe + мутации), ID с суффиксом `_e`, не трогай `formulas.generated.ts`. Если нужен новый v1-раздел — расширяй `SectionType` в `TrainerPage.tsx`, добавляй ещё один pool с `mode: 'v1'`.
    - **Блок «Запомни:» — поле `memoryHook?: string`** в `Formula` (2026-04-18). Короткий якорь (1-2 предложения) для FeedbackOverlay при правильном ответе, формулируется репетитором. Для v1 все 10 формул заполнены в `egorFormulas.ts`. Для v2 формулы могут заполняться из новой колонки гугл-таблицы «Механика» (`Запомни` / `memory_hook`) — когда `scripts/import-formula-sheet.mjs` будет расширен. Приоритет в `getLayer1MemoryCue`: `formula.memoryHook` → regex-эвристика по `whenToUse` → `physicalMeaning`. **НЕ дублируй** regex-эвристику в новом коде — если нужен триггер, заполняй `memoryHook`.
    - **Поле `buildable?: boolean`** (2026-04-19) — гейт на BuildFormulaCard. `false` → формула идёт только в TrueOrFalseCard **без мутации** (утверждение целиком верно/неверно). Источник — колонка «Для сборки/не для сборки» (dropdown `для сборки` / `не для сборки`) в гугл-таблице `Механика_v1`. Default `undefined` = `true` (backward-compat для v2).  Теоретические утверждения (например, «направление a_цс к центру окружности») включаются как Formula с LaTeX `formula` + `buildable: false`.
    - **Canonical token normalization** (2026-04-19) — `canonicalizeToken` в `questionGenerator.ts` приводит Unicode греческие (`ω`, `φ`, `π`, `Δ`...) к LaTeX escape (`\\omega`, `\\phi`). Это убирает баг с дубликатами одного визуального токена в BuildFormula pool (ранее `\\omega` из recipes и `ω` из variables.symbol существовали одновременно). При написании recipes пиши токены в LaTeX escape форме — canonicalization это подхватит, но соблюдать явно cleaner.
    - **Case-collision легенда в `FormulaQuestion.tokenLegend`** (2026-04-19) — при наличии в пуле BuildFormula пары типа `T/t`, `N/n` (одна буква разного регистра) `generateBuildFormula` строит плашку «T — период (с), t — время (с)» из `variables[].name + unit`. Рендерится в `BuildFormulaCard` как amber-плашка под пулом. Появляется только при реальной коллизии — не засоряет UI когда коллизий нет.
    - **Skill `sokratai-formula-loader`** (project-level, `.claude/skills/sokratai-formula-loader/SKILL.md`) — override анонсируемого anthropic-skills скилла с контрактами v1: default scenario = `Механика_v1`, `Механика` = read-only legacy для v2, новые разделы сразу в v1 формат с `buildable` помечанием.
14. **Trainer Gamification Phase 1 (2026-04-18)** — Duolingo-style слой поверх standalone `/trainer`, 100% client-side (без backend-изменений). Zustand store `sokrat-trainer-gamification-v1` (localStorage, `version: 1`) держит `totalXp`, `currentStreak`, `dailyRoundsCount`, `bestScoreBySection`. XP формула в `src/lib/trainerGamification/xpCalculator.ts` (pure): `floor((10 + accuracy + combo + perfect + newBest) * retryMultiplier)`; retry-режим принудительно обнуляет `isNewBest`. Priority celebrate overlays: `new-best > perfect > goal`, auto-dismiss 1200ms, CSS-only keyframes. 5 telemetry events через `console.info('[trainer-telemetry] ...')`: `trainer_round_completed`, `trainer_streak_incremented`, `trainer_streak_broken` (fires внутри store), `trainer_daily_goal_reached`, `trainer_new_best`. Инварианты: correctness checking в `FormulaRoundScreen.handleAnswer` НЕ тронут (см. «Известные хрупкие области» #11), `framer-motion` запрещён, hex в SVG/CSS → `currentColor` + Tailwind tokens (`text-accent`, `text-socrat-accent`). Спека: `docs/delivery/features/trainer-gamification/spec.md`.
15. **Tutor Chrome (AppFrame + SideNav) — canonical wrapper (Phase 2a, 2026-04-22)** — единая обёртка для всех tutor routes. `src/components/tutor/chrome/AppFrame.tsx` содержит `<TutorGuard>` + mode wrapper `<div className="sokrat t-app" data-sokrat-mode="tutor">` + `<SideNav>` + `<MobileTopBar>` + `<MobileDrawer>` + `<Suspense fallback=...><Outlet /></Suspense>` в `<main className="t-app__main">`. В `src/App.tsx` все tutor-страницы монтируются nested внутри `<Route path="/tutor" element={<AppFrame />}>`; порядок children — specific перед generic (напр. `homework/templates` и `homework/create` до `homework/:id`). `src/components/tutor/TutorLayout.tsx` **удалён** (grep `TutorLayout src/` = 0). Новые tutor-страницы **НЕ должны** оборачивать контент в `<TutorGuard>`, `<TutorLayout>` или `<div data-sokrat-mode="tutor">` — всё это делает AppFrame один раз. Паттерн: `export default function TutorFoo() { return <TutorFooContent />; }` + регистрация child-route в AppFrame группе. Redirect `/tutor/dashboard → /tutor/home` и `/tutor/homework/:id/results → /tutor/homework/:id` сохранены как nested routes внутри AppFrame. High-risk файлы (AuthGuard, Chat.tsx, TutorGuard core) не модифицированы — TutorGuard просто переехал из 13 страниц в AppFrame.
    - **A11y инварианты MobileDrawer (AC-11/12)** — закрытый drawer **обязан** нести HTML-атрибут `inert` (управляется useEffect через `setAttribute`/`removeAttribute` по `open`). `aria-hidden={!open}` один без `inert` **недостаточен**: браузер не убирает focusable-детей из Tab order по aria-hidden. `inert` — native Safari 15.4+/Chrome 102+/Firefox 112+, укладывается в build target. Не заменять на `tabindex="-1"` на всех детях — `inert` рекурсивно отключает focus на всё поддерево одним атрибутом.
    - **NavItem Space activation** (`SideNav.tsx`) — нав-ссылки это `<Link>` (нативный `<a>`). Нативно anchors реагируют только на Enter, Space по дефолту скроллит страницу. AC-11 требует Enter+Space — `onKeyDown` хендлер на NavItem перехватывает ` ` (space), делает `preventDefault()` и `currentTarget.click()` → Link-роутинг + middle-click/Ctrl+click продолжают работать нативно. Не конвертировать nav items в `<button>` + `navigate()` — ломает открытие в новой вкладке.
    - Спека: `docs/delivery/features/tutor-chrome-sidenav/spec.md`.

## Среда разработки и деплоя

- **Деплой и продакшен**: Lovable Cloud + AI
- **Разработка кода**: Cursor, Claude Code, Codex
- **Тестирование (разработчик)**: Windows + Google Chrome, Android + Google Chrome
- **Пользователи в продакшене**: macOS + Safari, iPhone + Safari, iPhone/Android + Google Chrome

## Голосовые сообщения в Telegram-боте

- Бот расшифровывает голосовые сообщения пользователей через Lemonfox API (OpenAI-compatible Whisper).
- Flow: пользователь отправляет voice → бот показывает typing indicator → `handleVoiceMessage()` скачивает OGG через Telegram `getFile` API → OGG отправляется в Lemonfox (`POST https://api.lemonfox.ai/v1/audio/transcriptions`, `model: 'whisper-large-v3'`, `language: 'ru'`) → бот отправляет превью расшифровки → текст передаётся в `handleTextMessage()` как обычное сообщение.
- Нет `ffmpeg`: Supabase Edge Functions не имеют системных бинарников, поэтому OGG/Opus отправляется в Lemonfox напрямую.
- Для multipart upload используется `FormData` с `new Blob([audioBuffer], { type: "audio/ogg" })` и filename `voice.ogg`.
- Во время расшифровки бот поддерживает typing loop через `sendChatAction('typing')` каждые ~4 секунды.
- Dispatch на голосовые сооб�