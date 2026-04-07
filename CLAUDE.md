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

Подробные правила дизайн-системы: `.claude/rules/90-design-system.md`

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

### 1. Форматирование дат и валюты
- Канонический источник: **`src/lib/formatters.ts`** — функции форматирования дат, валюты, прогресса
- Всегда используй `parseISO` из `date-fns` для разбора строк дат (не `new Date(string)` — ломается в Safari)
- `hourly_rate_cents` / суммы платежей хранятся в копейках (integer). Деление на 100 только при отображении — используй `formatPaymentAmount` из `formatters.ts`

### 2. Profiles table — нет колонки email
Таблица `profiles` **НЕ содержит** колонку `email`. Email хранится **только** в `auth.users`.
Используй `dbService.auth.admin.getUserById(userId)`, **НЕ** `profiles.select("email")`.

### 3. Система домашних заданий — guided chat
Единая система ДЗ (`homework_tutor_*` таблицы), работает через guided chat (пошаговый AI-чат). Classic режим (photo upload + OCR) и legacy student-only система удалены. Подробности: `.claude/rules/40-homework-system.md`

### 4. Formula rounds — preview-only test access и Phase 1b границы
- Seed для formula rounds: `supabase/seed/formula-round-seed.sql`
- Seed создаёт `test-tutor` и 5 фиксированных `test_student_*` аккаунтов с воспроизводимыми UUID
- Preview/dev QA path: `src/pages/StudentFormulaRound.tsx` поддерживает auto-login по `?student=<seed_uuid>` **только** на preview/dev host (`localhost`, `*.lovableproject.com`, non-prod `*.lovable.app`)
- На `https://sokratai.ru` и `https://sokratai.lovable.app` preview bypass **запрещён** — там остаётся обычный auth flow
- Для Formula Rounds Phase 1b tutor UI НЕ создавать новый top-level route или отдельный standalone dashboard. Интегрировать только в существующие tutor flows:
  - `src/pages/tutor/TutorHomeworkCreate.tsx`
  - `src/pages/tutor/TutorHomeworkDetail.tsx` (единая каноническая страница для ДЗ — детальная инфа + результаты v2, см. ниже)
- Phase 1b должен оставаться jobs-first: formula round = optional block внутри homework workflow, а не отдельный продукт/игра

### 5. Единая страница детальной инфы + результатов ДЗ (2026-04-07)
- `TutorHomeworkResults.tsx` **удалён**. Каноническая страница ДЗ для репетитора — `TutorHomeworkDetail.tsx` на URL `/tutor/homework/:id`. Она содержит v2-шапку (`ResultsHeader` с метриками Сдали/Средний балл/Не приступали/Требует внимания + actions Редактировать/Удалить), `ResultsActionBlock` (danger-пункты «не приступал» с tabs Telegram/Email в диалоге), `HeatmapGrid` (students × tasks), collapsible секцию задач, материалы и отдельную секцию «Разбор ученика» с `GuidedThreadViewer`
- Route `/tutor/homework/:id/results` остался как redirect на `/tutor/homework/:id` — для backward compat с Telegram-ссылками из `homework-reminder`
- Semantic invariant метрики «Требует внимания» в шапке = `notStarted + per_student.filter(s => s.needs_attention).length`. Backend считает `needs_attention` только для сдавших — frontend обязан прибавлять `notStarted` (не сдавших), иначе метрика рассогласована с action block. Подробности: `.claude/rules/40-homework-system.md` → секция «Merged Detail + Results страница»

### 6. HeatmapGrid (Results v2 TASK-5, 2026-04-07)
- `src/components/tutor/results/HeatmapGrid.tsx` — единая таблица students × tasks. **Заменил** локальный `StudentsList` в `TutorHomeworkDetail.tsx`. Локальный `DeliveryBadge` тоже переехал внутрь HeatmapGrid (других потребителей нет)
- Цвета клеток (AC-2): `null → bg-slate-100 text-slate-400 («—»)`, `< 0.3 → bg-red-100`, `0.3..0.8 → bg-amber-100`, `≥ 0.8 → bg-emerald-100`. Helper `getCellStyle` — single source of truth, не дублировать
- Backend `handleGetResults` теперь возвращает `per_student[*].task_scores: { task_id; final_score; hint_count }[]` — одна точка для матрицы. Не делать N запросов на student-thread
- Клик по строке → `expandedStudentId` в `TutorHomeworkDetailContent` → отдельная Card «Разбор ученика» с `GuidedThreadViewer` рендерится **под** Materials. Только один ученик раскрыт за раз (AC-3 совместимо). `expandedStudentId` сбрасывается при смене assignment id
- **КРИТИЧНО для iOS Safari**: таблица использует `border-separate border-spacing-0` + `<colgroup>` с фиксированными ширинами + `table-layout: fixed` + `width: max-content`. **НЕ менять** на `border-collapse` — `position: sticky` на `<td>` ломается в WebKit при `border-collapse`. **НЕ возвращать** `w-full` на table — съест горизонтальный скролл, потому что table-layout сжимает столбцы под container
- Wrapping `<div>` имеет `overflow-x-auto touch-pan-x` — `touch-pan-x` обязателен, иначе row onClick может съесть touchstart на iOS и блокировать swipe
- `React.memo` на `HeatmapRow` и `HeatmapCell` — обязательно, при 26×10 = 260 ячеек без memo ловится лаг при expand/collapse
- Cell click (TASK-6 ✅): `handleCellClick(studentId, taskId)` → expand student + set `drillDownTaskId`. `e.stopPropagation()` обязателен. `StudentDrillDown` заменяет прямой `GuidedThreadViewer` в Card «Разбор ученика»
- `getCellStyle` + `formatScore` — вынесены в `src/components/tutor/results/heatmapStyles.ts` (избегает react-refresh warning). **НЕ дублировать** эти helpers — импортировать из heatmapStyles.ts
- `GuidedThreadViewer` props (additive): `initialTaskFilter?: number | 'all'`, `hideTaskFilter?: boolean`. `hideTaskFilter=true` в `StudentDrillDown` скрывает дублирующий pill-ряд
- TASK-3 (header), TASK-4 (action block), TASK-5 (heatmap), TASK-6 (drill-down) ✅ done. TASK-7..9 (edit-score modal + telemetry + QA) — отдельные итерации

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
12. **StudentFormulaRound preview bootstrap** — preview/dev-host links с `?student=<seed_uuid>` могут автоматически логинить только 5 seed-студентов из `supabase/seed/formula-round-seed.sql`. Если меняется seed или preview-flow — обновить одновременно seed, `StudentFormulaRound.tsx` и `.claude/rules/40-homework-system.md`

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
- Dispatch на голосовые сообщения живёт в message loop и должен уважать текущие guardrails онбординга так же, как text flow.
- При ошибке расшифровки бот отвечает пользователю сообщением вида «Не удалось расшифровать…», а не молчит.
- Secret: `LEMONFOX_API_KEY`.
- Основной файл: `supabase/functions/telegram-bot/index.ts`.

## Голосовые сообщения в веб-чате у�
