# AI Usage Logging — сквозной учёт токенов по типам вызовов

**Статус:** реализовано 2026-07-06. Observability-only (не задеплоено до Lovable-синка).
**Тип:** внутренний инструмент юнит-экономики (не пользовательская фича, UI нет).

---

## Section 0: Job Context

Это **внутренний observability-инструмент**, а не пользовательская работа из AJTBD Job Graph. Он не относится ни к одной Core Job ученика/репетитора и не появляется в UI.

- **Кому служит:** владельцу продукта (Vladimir) — считать себестоимость AI по типам вызовов, чтобы понимать юнит-экономику пилота и решения по тарифам.
- **Job (внутренний):** «Когда я анализирую расходы на AI, я хочу видеть, сколько токенов уходит на каждый тип вызова (проверка ДЗ / подсказки / пробники / OCR / kb-extract / чат / голос) и уметь резать по репетиторам, чтобы принимать решения по цене и лимитам без гадания.»
- **Guardrail (rule 40 / rule 10):** это чистое логирование. Оно **не трогает** промпты, грейдинг, verdict'ы, анти-спойлер и AI-квоту (`daily_message_limits`). Любой сбой логирования не должен ломать AI-ответ (fire-and-forget).

---

## Проблема

До этой задачи в `token_usage_logs` писал **только** `chat/index.ts` (веб-чат + telegram-чат через `/chat`), без разметки типа вызова. Стоимость проверки ДЗ, подсказок, грейдинга пробников, OCR Части 1, извлечения задач в базу и голосовой транскрипции была **не видна** — нельзя было ни разложить расходы по типам, ни срезать по репетитору.

## Решение

Аддитивная разметка `token_usage_logs` колонкой `source` (тип вызова) + `assignment_id` (для рулапа по репетитору через ДЗ/пробник) + `audio_seconds` (для голоса, где токенов нет). Единый fire-and-forget хелпер логирует usage во **всех** путях к AI-гейтвею.

### Миграция — `20260706130000_token_usage_logs_source.sql`

Аддитивно, ничего не дропается:
```sql
ALTER TABLE public.token_usage_logs
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS audio_seconds numeric,
  ADD COLUMN IF NOT EXISTS assignment_id uuid;
UPDATE public.token_usage_logs SET source = 'chat_discussion' WHERE source IS NULL;  -- бэкфилл: всё историческое = чат
CREATE INDEX IF NOT EXISTS idx_token_usage_logs_source_created ON public.token_usage_logs (source, created_at);
```
- `assignment_id` — **plain uuid без FK**: может ссылаться и на `homework_tutor_assignments`, и на `mock_exam_assignments` — это rollup-тег, не связь.
- RLS/GRANT не меняются: edge-функции пишут под `service_role` (обходят RLS); новые колонки покрыты table-level grant'ами. `user_id`-скоуп SELECT для authenticated остаётся (свои строки), новые поля не PII.

### Хелпер — `supabase/functions/_shared/token-usage.ts`

- `logTokenUsage(admin, { userId, source, usage?, model?, chatId?, assignmentId?, audioSeconds? })` — один INSERT. Fire-and-forget: **никогда не throw'ит**, свой try/catch, **no-op при пустом `userId`** (колонка `user_id` NOT NULL; покрывает анонимные попытки пробников). PII-free: только id/counts/model/source.
- `makeUsageLogger(admin, ctx)` — фабрика `onUsage`-колбэка; возвращает `undefined` при отсутствии клиента/`userId`, чтобы caller мог пробросить его насквозь.

### Точки съёма usage

`callLovableJson` (в 3 местах — `_shared/ai-lovable.ts`, `homework-api/ai_shared.ts`, локальный в `mock-exam-grade`) получил опциональный `onUsage`-колбэк, который вызывается с `payload.usage` сразу после успешного `response.json()` (токены списываются на любом 200). `chat/index.ts` уже парсил `usage` из SSE — там дополнен существующий INSERT.

### Карта источников (`source`)

| source | Где | Модель |
|---|---|---|
| `chat_discussion` | `chat/index.ts` (веб /chat) | gemini-3-flash |
| `telegram_chat` | `chat/index.ts` при `responseProfile='telegram_compact'` (бот зовёт /chat, rule 60 — **отдельного гейтвей-вызова в боте нет**) | gemini-3-flash |
| `homework_check` | `guided_ai.ts` `evaluateStudentAnswer` + `evaluatePhysicsPart2` + leak-retry (единый вызов для **обоих** write-path ДЗ, rule 40) | gemini-3-flash |
| `homework_hint` | `guided_ai.ts` `generateHint` (main + retry) | gemini-3-flash |
| `mock_grade` | `mock-exam-grade` Часть 2 (per-kim + bulk) + Pass-1 photo-assign | gemini-3-flash |
| `mock_ocr` | `mock-exam-grade` OCR Части 1 | gemini-2.5-pro |
| `reference_gen` | `homework-generate-reference` (физ-эталон, фон) | gemini-3-flash |
| `kb_extract` | `kb-ai-extract` (извлечение задач) | gemini-3-flash |
| `voice` | `_shared/voice-transcribe.ts` (Groq Whisper) — токены 0, `audio_seconds` | whisper-large-v3-turbo |

**Атрибуция `user_id`:** ДЗ/чат/kb/голос → ученик/репетитор-инициатор; `reference_gen` → `tutor_id` ДЗ (фон-джоба); `mock_grade`/`mock_ocr` → `student_id`, иначе `tutor_id` (анонимная попытка). `assignment_id` заполнен для ДЗ (проверка/подсказка/эталон/голос), чата-в-ДЗ и пробников — по нему рулап на репетитора.

**`bootstrap`** (AI-вступление к задаче) отдельно **не** различается: бот/фронт зовут `/chat` без серверного признака bootstrap → пишется как `chat_discussion`. Зарезервировано; при необходимости — client-флаг в body (потребует деплоя фронта).

**Голос — `audio_seconds`:** Groq возвращает только `text` (без длительности), а формат запроса намеренно не меняется → длительность **оценивается из размера буфера** (`ESTIMATED_AUDIO_BYTES_PER_SEC = 12000`, ±3× погрешность; хватает для трекинга объёма). Caller может передать точное `audioSeconds`. Токены = 0. Голосовые inline-вызовы бота/чата (ru-only, не через shared-хелпер) в scope не входят.

## Верификация (после деплоя)

```sql
select source, count(*), sum(prompt_tokens) in_tok, sum(completion_tokens) out_tok
from token_usage_logs
where created_at >= date_trunc('month', now())
group by 1 order by 2 desc;
```
Срез по репетитору — join `assignment_id` на `homework_tutor_assignments.tutor_id` / `mock_exam_assignments.tutor_id`.

## Изменённые файлы

- Миграция: `supabase/migrations/20260706130000_token_usage_logs_source.sql`
- Новый хелпер: `supabase/functions/_shared/token-usage.ts`
- Гейтвей-хуки: `_shared/ai-lovable.ts`, `homework-api/ai_shared.ts`, `mock-exam-grade/index.ts` (локальный `callLovableJson`)
- Инструментация: `homework-api/guided_ai.ts` (+ `homework-api/index.ts` callers), `chat/index.ts`, `mock-exam-grade/index.ts`, `homework-generate-reference/index.ts`, `kb-ai-extract/index.ts`, `_shared/voice-transcribe.ts` (+ `homework-api/index.ts` speaking caller)
- Типы: `src/integrations/supabase/types.ts` (`token_usage_logs` Row/Insert/Update)

## Не изменялось (намеренно)

- Промпты, грейдинг, verdict'ы, анти-спойлер, AI-квота.
- `telegram-bot/index.ts` — нет прямого гейтвей-вызова (чат через `/chat`); inline Groq-голос бота не инструментирован (отдельная задача).
- `rag-competitor-bot` — использует OpenAI напрямую (не Сократ-costs), вне scope.

## При расширении

- Новый путь к AI-гейтвею → пробрось `onUsage` (через `makeUsageLogger`) в его `callLovableJson`; новый `source` добавь в `TokenUsageSource`.
- Новый source-строкой в БД не требует миграции (`source` — plain `text` без CHECK).
- Голос по новому пути → `logContext` в `transcribeAudio` (не inline-Groq).

## Деплой

Миграция + edge-функции — через **Lovable** (миграция применяется первой). Тронут `src/integrations/supabase/types.ts` → фронту нужен `deploy-sokratai` на VPS.
