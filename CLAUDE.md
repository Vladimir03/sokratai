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

### 3. Система домашних заданий — ОДНА
Tutor-connected (`homework_tutor_*` таблицы). Legacy система удалена. Подробности: `.claude/rules/40-homework-system.md`

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