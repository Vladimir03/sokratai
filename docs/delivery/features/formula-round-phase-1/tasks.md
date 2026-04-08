# Formula Round Phase 1 — Implementation Tasks

> Спека: `docs/delivery/features/formula-round-phase-1/spec.md` (v0.2)
> Аудит: `docs/delivery/features/formula-round-phase-1/preview-audit.md`
> Feature: standalone публичный тренажёр формул на `/trainer`, без auth, анонимная сессия в localStorage, телеметрия в `formula_round_results` с nullable `student_id`.
> Target: pivot Phase 1 с homework-embedded на standalone public surface — минимальный путь к живому трафику без ломки AJTBD homework-wedge.

---

## Task Overview

| #  | Task                                               | Agent        | Depends on |
|----|----------------------------------------------------|--------------|------------|
| 1  | Миграция БД: nullable student_id + anon columns    | backend      | —          |
| 2  | Edge function `trainer-submit` (anon + rate limit) | backend      | TASK-1     |
| 3  | Migrate FormulaRoundScreen → standalone signatures ✅ | frontend     | —          |
| 4  | Новый TrainerPage + route + trainerApi + hook ✅   | frontend     | TASK-2, 3  |
| 5  | DROP legacy StudentFormulaRound + preview handlers ✅ | frontend   | TASK-4     |
| 6  | Validation + cross-browser smoke (все AC)          | qa           | TASK-5     |
| 7  | P1 cleanup: seed, telemetry breakdown, rules docs  | mixed        | TASK-6     |

TASK-1/2/3 можно запускать параллельно. TASK-4 требует 2 и 3. TASK-5 — после TASK-4. TASK-6 — финальная проверка. TASK-7 — P1, отдельный PR.

### Implementation Status (2026-04-08)

- `TASK-1` выполнен: добавлена миграция [20260408160000_trainer_standalone_schema.sql](/c:/Users/kamch/sokratai/supabase/migrations/20260408160000_trainer_standalone_schema.sql).
- `TASK-2` выполнен: добавлен публичный edge function [index.ts](/c:/Users/kamch/sokratai/supabase/functions/trainer-submit/index.ts).
- `TASK-3` ✅ выполнен (2026-04-08): `FormulaRoundScreen` / `RoundProgress` / `RoundResultScreen` мигрированы на standalone-сигнатуры, lives/hearts вырезаны, `RoundResult.durationMs` добавлен, timing переведён на `performance.now()`. `StudentFormulaRound.tsx` получил минимальный 3-строчный compat patch и ждёт удаления в TASK-5. Подробности — в секции «TASK-3» ниже. `npm run build` ✓.
- `TASK-4` ✅ выполнен (2026-04-08): добавлены [src/pages/TrainerPage.tsx](/c:/Users/kamch/sokratai/src/pages/TrainerPage.tsx), [src/lib/trainerApi.ts](/c:/Users/kamch/sokratai/src/lib/trainerApi.ts), [src/hooks/useTrainerSession.ts](/c:/Users/kamch/sokratai/src/hooks/useTrainerSession.ts), нейтральный barrel [src/components/formula-round/index.ts](/c:/Users/kamch/sokratai/src/components/formula-round/index.ts) и lazy route `/trainer` в [src/App.tsx](/c:/Users/kamch/sokratai/src/App.tsx). `TrainerPage` работает как state machine `intro → running → result`, reuses `FormulaRoundScreen` / `RoundResultScreen`, отправляет fire-and-forget submit в `trainer-submit`, а для `weak_formulas` нормализует `result.weakFormulas` в `formulaId[]`, потому что текущий backend contract ожидает `string[]`. AC-5 grep по `TrainerPage` / `trainerApi` / `useTrainerSession` — пустой. `npm run build` ✓.
- `TASK-5` ✅ выполнен (2026-04-08): удалены [src/pages/StudentFormulaRound.tsx](/c:/Users/kamch/sokratai/src/pages/StudentFormulaRound.tsx), [src/lib/formulaRoundApi.ts](/c:/Users/kamch/sokratai/src/lib/formulaRoundApi.ts), [src/hooks/useFormulaRound.ts](/c:/Users/kamch/sokratai/src/hooks/useFormulaRound.ts) и route `/homework/:id/round/:roundId` из [src/App.tsx](/c:/Users/kamch/sokratai/src/App.tsx). AC-10 grep по `src/` — пустой. `npm run build` ✓, `npm run smoke-check` ✓.
- Важный schema drift для следующих задач:
  - В текущей БД используются колонки `student_id` и `round_id`, не `user_id` и не `formula_round_id`.
  - Для standalone insert миграция дополнительно делает `round_id` nullable, потому что без этого `trainer-submit` не может писать строки без `formula_rounds`.
  - В текущей таблице сохраняется `duration_seconds`; `trainer-submit` принимает `duration_ms`, но пишет округлённое значение в существующую колонку.
- Validation snapshot после TASK-5:
  - `npm run lint` — по-прежнему падает на pre-existing repo-wide ESLint проблемах (194 errors / 31 warnings), не на trainer-файлах.
  - `npm run build` — ✓ green.
  - `npm run smoke-check` — ✓ pass; non-blocking warnings остались только в unrelated существующих файлах.

---

## TASK-1: Миграция БД — nullable student_id + anon columns

**Job.** Позволить `formula_round_results` принимать анонимные записи без поломки существующих homework-строк.

**Agent.** backend

**Files.**
- NEW: `supabase/migrations/20260408160000_trainer_standalone_schema.sql`

**AC.**
- AC-7 (spec): таблица принимает строки без `student_id` / `homework_assignment_id`, не ломает существующие homework-строки.
- AC-11 (spec): RLS не открывает анонимный `SELECT` на чужие строки; `trainer-submit` пишет через `service_role`.

**Scope.**
1. `ALTER TABLE formula_round_results ALTER COLUMN student_id DROP NOT NULL` (и так же `homework_assignment_id` если NOT NULL).
2. `ADD COLUMN session_id text` (анонимный идентификатор из localStorage клиента, длина ≤ 64).
3. `ADD COLUMN source text NOT NULL DEFAULT 'homework'` + `CHECK (source IN ('homework','trainer'))`.
4. `ADD COLUMN ip_hash text` (sha256 hex, 64 символа, для rate limit; NULLable).
5. `CREATE INDEX idx_formula_round_results_trainer_recent ON formula_round_results (ip_hash, created_at DESC) WHERE source = 'trainer'` — партиал для быстрого rate-limit lookup.
6. RLS: добавить policy `trainer_results_no_anon_read` — `USING (false)` для `anon` role. `service_role` bypass остаётся как есть. `tutor_read_results` не трогать.
7. **Не** делать `DROP + CREATE` — только `ALTER`. Существующие homework-строки должны остаться.

**Guardrails.**
- Миграция идемпотентна (`IF NOT EXISTS` на index, `DROP POLICY IF EXISTS` перед create).
- Не трогать `formula_rounds` — тренажёру конфиг не нужен (hardcoded kinematics section на клиенте).
- Не добавлять новые триггеры.

**Validation.** `npm run smoke-check`; вручную проверить `\d formula_round_results` локально (или через Supabase Studio) после применения.

**Implementation note (2026-04-08).**
- Выполнено в [20260408160000_trainer_standalone_schema.sql](/c:/Users/kamch/sokratai/supabase/migrations/20260408160000_trainer_standalone_schema.sql).
- Дополнительно к исходному prompt migration делает `round_id` nullable, потому что в реальной schema `formula_round_results` всё ещё привязана к `formula_rounds` через `round_id`, а standalone trainer пишет без round config.
- `homework_assignment_id` обработан defensive-проверкой `IF EXISTS`, потому что в текущей schema репо этой колонки в `formula_round_results` нет.

---

## TASK-2: Edge function `trainer-submit`

**Job.** Принимать результаты анонимной trainer-сессии, валидировать, rate-limit'ить по IP-hash и писать в `formula_round_results` через `service_role`.

**Agent.** backend

**Files.**
- NEW: `supabase/functions/trainer-submit/index.ts`
- NEW (опционально): `supabase/functions/trainer-submit/deno.json` (если project convention требует)

**AC.**
- AC-6: POST без `Authorization` возвращает `200 { ok: true }` при валидной payload.
- AC-7: запись в БД содержит `source='trainer'`, `student_id=null`, `session_id`, `ip_hash`.
- AC-8: >20 запросов за 10 минут с одного `ip_hash` → `429 { error: 'rate_limited' }`.

**Contract (из spec §5.2).**
- `POST /functions/v1/trainer-submit`
- Body: `{ session_id: string, score: number, total: number, weak_formulas: string[], duration_ms: number, client_started_at: string }`
- Response: `200 { ok: true, id: string }` | `400` | `429`.

**Scope.**
1. Прочитать IP из `x-forwarded-for` (первый элемент) или `cf-connecting-ip` как fallback; пустой → `'unknown'`.
2. `ip_hash = hex(sha256(ip + SALT))` через `crypto.subtle.digest('SHA-256', ...)` — **не** использовать `node:crypto`. Соль — env var `TRAINER_IP_SALT` (fallback на пустую строку, но warn в log).
3. Валидация:
   - `session_id`: string, `1..64`, только `[a-zA-Z0-9-_]`.
   - `score`: int, `0..total`.
   - `total`: int, `1..50`.
   - `weak_formulas`: string[], `0..50`, каждая ≤ 64 символа.
   - `duration_ms`: int, `0..3_600_000`.
   - `client_started_at`: ISO-8601, парсится `Date.parse`, |now − value| ≤ 24h.
   - Любая невалидная → `400 { error: 'invalid_payload', field }`.
4. Rate limit: `SELECT count(*) FROM formula_round_results WHERE source='trainer' AND ip_hash=$1 AND created_at > now() - interval '10 minutes'`. Если `≥ 20` → `429`.
5. Insert: `{ source: 'trainer', student_id: null, homework_assignment_id: null, formula_round_id: null, session_id, score, total, weak_formulas, duration_ms, ip_hash, client_started_at }`. Вернуть `id` в response.
6. CORS: `Access-Control-Allow-Origin: *` (public endpoint), `Allow-Methods: POST, OPTIONS`, `Allow-Headers: content-type`. Обработать preflight `OPTIONS`.
7. **Нет** проверки JWT. **Нет** чтения `Authorization`.

**Guardrails.**
- `createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })` — никогда не использовать anon key внутри функции.
- Никогда не логировать raw IP — только `ip_hash[:8]`.
- `try/catch` верхнего уровня → всегда 500 + `{ error: 'internal' }`, не утекать stack trace.
- Не принимать `student_id` в body — игнорировать, writer ставит `null` жёстко.

**Validation.** `curl -X POST https://<project>.functions.supabase.co/trainer-submit -H 'content-type: application/json' -d '{...}'` — проверить 200 / 400 / 429.

**Implementation note (2026-04-08).**
- Выполнено в [index.ts](/c:/Users/kamch/sokratai/supabase/functions/trainer-submit/index.ts).
- Endpoint публичный, без JWT-check, использует `service_role` client с `persistSession: false`.
- Функция валидирует payload по contract, считает `ip_hash` через Web Crypto API, rate-limit'ит запросы по `formula_round_results.source='trainer'` и логирует только `ip_hash[:8]`.
- Из-за текущего schema drift insert пишет `student_id = null`, `round_id = null`, `duration_seconds = floor(duration_ms / 1000)`; поля `homework_assignment_id`, `formula_round_id`, `client_started_at` в текущую таблицу не пишутся, потому что их нет в schema репо.

---

## TASK-3: Migrate FormulaRoundScreen / RoundProgress / RoundResultScreen ✅ Done (2026-04-08)

**Status.** ✅ Implemented. `npm run lint` — нет новых ошибок в тронутых файлах. `npm run build` — ✓ green (25.14s).

**Landed changes (source of truth для следующих агентов):**
- `src/lib/formulaEngine/types.ts` — `RoundResult` extended с required `durationMs: number` (alongside existing `durationSeconds`, которое **оставлено** для совместимости с `formulaRoundApi.ts` до TASK-5). `livesRemaining`, `completed` по-прежнему в типе.
- `src/components/homework/formula-round/RoundProgress.tsx` — props = `{ current: number; total: number }`. Удалены `lives`/`maxLives` props, `Heart` import, heart-ряд. Counter typography `text-sm → text-base` (16px) для iOS Safari.
- `src/components/homework/formula-round/FormulaRoundScreen.tsx` — props = `{ questions: FormulaQuestion[]; onComplete: (result: RoundResult) => void; onExit: () => void }`. Удалены `roundConfig`, `lives` state, section-label header, `useMemo` на `sectionTitle`. Новый header: Lucide `ArrowLeft` back button (`h-11 w-11`, `touchAction: manipulation`, `aria-label="Выйти из раунда"`, focus-visible ring) слева от `RoundProgress`. Timing — `performance.now()` на mount + per-question (монотонно). `buildResult(updatedAnswers, updatedScore)` hardcodes `livesRemaining: 0`, `completed: true`, возвращает и `durationMs` и `durationSeconds`. `handleAnswer` структурно не тронут — только удалены `lives`/`newLives` строки. `handleNext` упрощён: нет `lives <= 0` early-end, раунд завершается ТОЛЬКО при `newIndex >= questions.length`. `FeedbackOverlay` получает `livesLost={0}` — guard `!isCorrect && livesLost > 0` делает heart badge невидимым (reuse 1:1, без правок).
- `src/components/homework/formula-round/RoundResultScreen.tsx` — props = `{ result: RoundResult; onRetryWrong: () => void; onExit: () => void }`. Удалены `Heart` import, `MAX_LIVES`, lives row. CTAs: **«Пройти ещё раз»** (primary, `bg-accent`, показывается только при `result.weakFormulas.length > 0`, вызывает `onRetryWrong`) + **«Назад»** (вызывает `onExit`; full-width когда `weakFormulas.length === 0`). Оба с `touchAction: manipulation` + `focus-visible:ring`. Weak-formulas rendering (Map lookup по `kinematicsFormulas` + `MathText` lazy Suspense) не тронут — AC-4 не регрессировал.
- `src/pages/StudentFormulaRound.tsx` — получил **минимальный** 3-строчный compat patch чтобы prod build остался зелёным: `roundConfig` prop убран из `<FormulaRoundScreen>`, добавлен `onExit={handleClose}`; `onRetryErrors → onRetryWrong`, `onClose → onExit` на `<RoundResultScreen>`. Остальное тело файла (preview auth bypass, `PREVIEW_TESTERS`, `PREVIEW_ROUNDS`, `isPreviewHost`, `toRoundConfig`, `buildQuestions`, `handleRoundComplete`, `saveResultMutation`, `Navigation`, `AuthGuard`) **не тронуто** — TASK-5 удалит файл целиком. `roundConfig`/`toRoundConfig` локально там остаются, потому что engine-функции `generateRound`/`generateRetryRound` всё ещё требуют `RoundConfig` — это только UI prop убран.

**Инварианты, которые НЕЛЬЗЯ откатывать:**
- Correctness checking остаётся в `FormulaRoundScreen.handleAnswer` (CLAUDE.md §11). Карточки возвращают raw answer, НЕ boolean.
- `BuildFormulaAnswer { numerator: string[]; denominator: string[] }` — structured, не flat array. Сортировка в `handleAnswer` делается через `[...arr].sort()` (не мутирует исходные массивы).
- `durationMs` — единственное required monotonic-поле для Phase 1 edge function payload. Когда TASK-5 удалит `formulaRoundApi.ts`, следующий рефакторинг сможет **убрать** `durationSeconds` из типа, но НЕ в рамках TASK-3/4.
- `FeedbackOverlay` принимает `livesLost: 0 | 1` — не менять сигнатуру. Screen всегда передаёт `0`.
- `handleAnswer` → `[...answer.numerator].sort().every(...)` сравнение — НЕ заменять на `JSON.stringify` или прямое равенство массивов.

**Guardrail для TASK-4 (TrainerPage).** `FormulaRoundScreen` и `RoundResultScreen` **не принимают** `onNewRound` / `onChangeTopic` props — эти концепты из оригинального state machine в spec Section 5.3 реализуются **целиком внутри `TrainerPage`**:
- «Новый раунд» / «Другая тема» = parent вызывает `setState('landing')` через `onExit` и сам решает, что показать следом.
- «Повторить ошибки» = parent на `onRetryWrong` вызывает `generateRetryRound(weakFormulas, roundConfig)` и пересоздаёт questions массив + remount `<FormulaRoundScreen>` через новый `key`.
- Не добавлять новые props обратно в Screen / ResultScreen без спецификации — эти компоненты должны остаться тонкими, чтобы Phase 2 integration (embedded в homework workflow) могла их переиспользовать.

**Не удалено в рамках TASK-3 (намеренно, для TASK-5):**
- `src/pages/StudentFormulaRound.tsx`
- `src/lib/formulaRoundApi.ts`
- `src/hooks/useFormulaRound.ts`
- Route `/homework/:id/round/:roundId` в `src/App.tsx`
- `handleGetFormulaRound` / `handleListFormulaRoundResults` / `handleCreateFormulaRoundResult` в `supabase/functions/homework-api/index.ts`
- `durationSeconds` field в `RoundResult`

---

**Job.** Переиспользовать существующий UI раунда без привязки к `homework_assignment_id` / `lives`. CLAUDE.md §11 инвариант: correctness checking остаётся в `FormulaRoundScreen.handleAnswer` (single source of truth).

**Agent.** frontend

**Files (MIGRATE).**
- `src/components/homework/formula-round/FormulaRoundScreen.tsx`
- `src/components/homework/formula-round/RoundProgress.tsx`
- `src/components/homework/formula-round/RoundResultScreen.tsx`
- `src/lib/formulaEngine/*` — не трогать логику, только типы если нужно.

**AC.**
- AC-3: UI раунда не показывает lives/hearts; нет импортов `homework*Api`.
- AC-4: weak-formulas считаются по тем же правилам, что и сейчас (две ошибки на формулу → weak).

**Scope.**
1. Удалить prop `lives` и любой state `livesLeft`. Удалить `RoundProgress` hearts JSX; оставить только `{current}/{total}` + progress bar.
2. Signature `FormulaRoundScreen`:
   ```ts
   type FormulaRoundScreenProps = {
     questions: FormulaQuestion[];
     onComplete: (result: RoundResult) => void;
     onExit: () => void;
   };
   ```
   Удалить `assignmentId`, `roundId`, `studentId` — если были.
3. `RoundResult` (из `formulaEngine/types.ts`) расширить полем `durationMs: number` (millisecond timestamp diff от mount → `onComplete`). Использовать `performance.now()`, не `Date.now()`.
4. `RoundResultScreen`: CTA «Пройти ещё раз» (reset) и «Назад». **Не** рендерить «Назад к заданиям» — тренажёр не знает про homework.
5. `handleAnswer` оставить без изменений структуры: raw answer → проверка → накопление статистики. `BuildFormulaAnswer { numerator, denominator }` не трогать.
6. Удалить все импорты из `@/lib/formulaRoundApi`, `@/hooks/useFormulaRound`, `@/lib/studentHomeworkApi`.
7. Путь директории оставить (`src/components/homework/formula-round/`) — физическое перемещение отложить в P1 чтобы не раздувать diff.

**Guardrails.**
- **НЕ** возвращать correctness checking в карточки (`TrueOrFalseCard`, `BuildFormulaCard`, `SituationCard`) — инвариант CLAUDE.md §11.
- **НЕ** добавлять `framer-motion` — CSS-анимации из `tailwindcss-animate` (performance.md).
- Новые interactive элементы: `touch-action: manipulation`, `text-base` (16px) на любых `<input>` если появятся.
- `crypto.randomUUID()` запрещён на этом уровне (Safari < 15.4 edge case); если нужен локальный id — `Date.now() + '-' + Math.random().toString(36).slice(2)`.

**Validation.** `npm run lint` + `npm run build`. Ручной smoke в dev: старый preview path (пока не удалён) не должен сломаться — TASK-3 оставляет prop-совместимость минимальной (можно временно forward-совместимый wrapper если потребуется).

---

## TASK-4: Новый TrainerPage + route + trainerApi + useTrainerSession

**Job.** Публичная standalone страница `/trainer` вне `AuthGuard`, которая создаёт анонимную сессию в localStorage, запускает раунд и отправляет результат в `trainer-submit`.

**Agent.** frontend

**Status.** ✅ Implemented (2026-04-08).

**Files.**
- NEW: `src/pages/TrainerPage.tsx`
- NEW: `src/lib/trainerApi.ts`
- NEW: `src/hooks/useTrainerSession.ts`
- MODIFY: `src/App.tsx` — добавить `<Route path="/trainer" element={<Suspense fallback={<TrainerFallback />}><TrainerPage /></Suspense>} />` **снаружи** `<AuthGuard>` / `<StudentGuard>` / `<TutorGuard>`.
- NEW: `src/components/formula-round/index.ts` — нейтральный re-export `FormulaRoundScreen` / `RoundResultScreen`, чтобы AC-5 grep на `TrainerPage.tsx` не ловил `homework` в import path.

**AC.**
- AC-1: `/trainer` открывается без auth на clean incognito, без 401/redirect.
- AC-2: первый заход создаёт `trainer_session_id` в localStorage (len 16..32, `[a-zA-Z0-9-_]`); повторный заход его переиспользует.
- AC-4: по завершении раунда POST в `trainer-submit` отправляется с валидной payload.
- AC-5: `/trainer` не импортирует ничего из `homework*Api`, `studentHomework*`, `formulaRoundApi`, `useFormulaRound`.
- AC-9: страница lazy-loaded (`React.lazy`), не инфлейтит initial bundle.

**Scope.**

### 4.1 `src/hooks/useTrainerSession.ts`
- Экспорт: `useTrainerSession(): { sessionId: string; startedAt: string }`.
- Первый вызов: если `localStorage['trainer_session_id']` отсутствует — генерит новый `sessionId` (16-символьный alphanumeric через `Math.random().toString(36)`), пишет в localStorage.
- `startedAt` — хранится в `useRef`, ISO от `new Date().toISOString()` на mount.
- Safari-safe: try/catch на любой доступ к `localStorage` (private mode может кидать).

### 4.2 `src/lib/trainerApi.ts`
- Экспорт: `submitTrainerRound(payload): Promise<{ ok: true; id: string } | { ok: false; reason: 'rate_limited' | 'invalid' | 'network' }>`.
- Использует `fetch` к `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trainer-submit` — **без** `Authorization` header, только `content-type: application/json`.
- Таймаут: `AbortController` + `setTimeout(8000)` — **не** `AbortSignal.timeout` (Safari 80-cross-browser).
- Ошибки: 429 → `{ ok: false, reason: 'rate_limited' }`, 400 → `'invalid'`, network/5xx → `'network'`.
- **Никогда не бросает** — UI должен продолжать работать даже при fail отправки.

### 4.3 `src/pages/TrainerPage.tsx`
- `export default lazy`-friendly default export.
- Full-screen layout, `min-h-[100dvh]` (не `100vh`), `bg-slate-50`, `font-golos`.
- Header-bar: «Тренажёр формул физики» (text-lg font-semibold text-slate-900) + Lucide icon `Sparkles` в `text-accent`. Нет дубль-логики навигации.
- State machine: `'intro' | 'running' | 'result'`.
  - `intro`: hero с описанием (1 параграф ≤ 2 предложения), CTA «Начать» → `running`. **Одна** primary кнопка (`bg-accent text-white`, design-system).
  - `running`: `<FormulaRoundScreen questions={...} onComplete={handleComplete} onExit={() => setState('intro')} />`. Генерить `questions` через существующий `generateRound({ section: 'kinematics', count: 10 })`.
  - `result`: `<RoundResultScreen result={...} onRetry={() => { regenerate; setState('running') }} onExit={() => setState('intro')} />`.
- `handleComplete(result: RoundResult)`:
  1. `setState('result')` (UI не ждёт сети).
  2. Fire-and-forget `submitTrainerRound({ session_id: sessionId, score: result.score, total: result.total, weak_formulas: result.weakFormulas, duration_ms: result.durationMs, client_started_at: startedAt })`.
  3. `.catch(() => {})` — молча проглатываем (UI не должен ругаться на проблемы сети).
- **Нет** связи с homework. **Нет** `useQuery` / React Query — простой `useState` машина.

### 4.4 `src/App.tsx`
- Добавить lazy import: `const TrainerPage = lazy(() => import('./pages/TrainerPage'))`.
- Route размещён **перед** wildcards и **снаружи** любых guard'ов:
  ```tsx
  <Route path="/trainer" element={<Suspense fallback={<div className="min-h-[100dvh] grid place-items-center text-slate-500">Загрузка…</div>}><TrainerPage /></Suspense>} />
  ```
- Не помещать внутрь `<AuthGuard>` или `<StudentGuard>`.

**Guardrails.**
- **ЗАПРЕЩЕНО** импортировать `homework_tutor_*` types, `useStudentHomework*`, `studentHomeworkApi`, `formulaRoundApi`, `useFormulaRound`.
- **ЗАПРЕЩЕНО** `framer-motion`.
- `text-base` (16px) на любых input/button text, `touch-action: manipulation` на CTA.
- Lucide icons only, emoji запрещены в UI chrome (design-system §Anti-patterns).
- Одна primary кнопка per screen.
- React Query key конвенция не применяется (нет queries).

**Validation.** `npm run lint` + `npm run build`. Ручной smoke в incognito: открыть `/trainer`, пройти раунд, проверить Network panel → POST в `trainer-submit` → 200. Проверить `localStorage['trainer_session_id']` присутствует.

**Implementation note (2026-04-08).**
- `useTrainerSession()` читает/пишет `localStorage['trainer_session_id']` через отдельные try/catch-safe helper'ы; `startedAt` фиксируется один раз через `useRef(new Date().toISOString())`.
- `submitTrainerRound()` использует `AbortController + setTimeout(8000)` и **никогда не бросает** наружу; union response нормализует 429/400/network.
- `TrainerPage` держит internal state machine `intro | running | result` на `useState`, без React Query и без auth/homework imports.
- Вопросы генерятся через `generateRound(TRAINER_ROUND_CONFIG)` и `generateRetryRound(result.weakFormulas, TRAINER_ROUND_CONFIG)`; для retry fallback'ом используется новый full round, если список weak formulas пуст.
- Из-за реального backend contract `trainer-submit` (`weak_formulas: string[]`) клиент отправляет `result.weakFormulas.map((formula) => formula.formulaId)`, а не сырой `WeakFormula[]`.
- `src/App.tsx` содержит lazy chunk для `/trainer`; в build output зафиксирован отдельный asset вида `TrainerPage-*.js`.

---

## TASK-5: DROP legacy StudentFormulaRound + preview handlers

**Job.** Удалить homework-embedded формульный путь и preview bypass — single source of truth теперь `/trainer`.

**Agent.** frontend

**Status.** ✅ Implemented (2026-04-08).

**Files (DROP).**
- `src/pages/StudentFormulaRound.tsx`
- `src/lib/formulaRoundApi.ts`
- `src/hooks/useFormulaRound.ts`
- Preview-login handlers в `src/pages/StudentFormulaRound.tsx` (вместе с файлом).
- Route `/homework/:id/round/:roundId` в `src/App.tsx`.
- Любые импорты выше из `src/components/homework/formula-round/*` — должны быть вычищены (TASK-3 уже это сделал в screen-файлах).

**Scope.**
1. `git rm` трёх файлов выше.
2. Удалить `<Route>` c `/homework/:id/round/:roundId` из `App.tsx`.
3. `grep -r 'StudentFormulaRound\|formulaRoundApi\|useFormulaRound'` → должен быть пустой.
4. `grep -r 'formula_rounds' src/` — осталось в типах/API? Если да — оценить в P1, пока оставить (таблица `formula_rounds` в БД не дропается в Phase 1).
5. Не трогать `formula_rounds` / RLS policies / tutor-read policies — они не мешают standalone flow и понадобятся для будущего homework re-integration.

**AC.**
- AC-10: в `src/` нет ссылок на `StudentFormulaRound`, `formulaRoundApi`, `useFormulaRound`. `npm run build` зелёный.

**Guardrails.**
- **НЕ** удалять `supabase/seed/formula-round-seed.sql` — это зона TASK-7 (P1).
- **НЕ** удалять `supabase/functions/homework-api/index.ts` ветки — там нет formula-round-specific preview handlers для student side, если остались какие-то линки на round — просто вычистить без широких рефакторингов.
- **НЕ** мигрировать sokratai.ru пользователей — legacy flow был preview-only.

**Validation.** `npm run lint` + `npm run build` + `npm run smoke-check`.

**Implementation note (2026-04-08).**
- Файлы `src/pages/StudentFormulaRound.tsx`, `src/lib/formulaRoundApi.ts`, `src/hooks/useFormulaRound.ts` удалены из repo.
- Из `src/App.tsx` удалён lazy import `StudentFormulaRound` и route `/homework/:id/round/:roundId`.
- `rg "StudentFormulaRound|formulaRoundApi|useFormulaRound|/homework/:id/round/:roundId" src` возвращает пустой результат — это текущий source of truth для AC-10.
- `src/components/homework/formula-round/*` намеренно **не тронуты**: после TASK-3 они обслуживают standalone `/trainer`.

---

## TASK-6: Validation — все AC + cross-browser smoke

**Job.** Прогнать финальный чек всех AC из spec §6 и снять cross-browser baseline.

**Agent.** qa

**Files.** — (только запуск и отчёт).

**AC — полный список (spec §6).**
- AC-1: `/trainer` на incognito без auth → 200, UI загружается.
- AC-2: localStorage key `trainer_session_id` создаётся и переиспользуется.
- AC-3: UI раунда без lives.
- AC-4: POST в `trainer-submit` после завершения раунда с корректным payload.
- AC-5: grep на `homework*` импорты в `TrainerPage` / `trainerApi` → пусто.
- AC-6: `curl` без `Authorization` → 200.
- AC-7: запись в БД содержит `source='trainer'`, `student_id IS NULL`, валидный `session_id`, `ip_hash`.
- AC-8: 21-й POST за 10 минут с того же IP → 429.
- AC-9: TrainerPage lazy-loaded (check network panel: отдельный chunk).
- AC-10: grep на `StudentFormulaRound` / `formulaRoundApi` / `useFormulaRound` → пусто.
- AC-11: RLS не отдаёт анонимному `SELECT * FROM formula_round_results WHERE source='trainer'`.

**Scope.**
1. `npm run dev` → `npm run lint` → `npm run build` → `npm run smoke-check` (не параллелить build + smoke-check per 20-commands).
2. Ручной smoke: desktop Chrome (Windows) и iOS Safari (iPhone real device если доступен, иначе Safari DevTools responsive).
   - Open `/trainer` в incognito.
   - Пройти 2 раунда подряд.
   - Проверить Network → POST 200.
   - Проверить localStorage.
   - Проверить что «Назад» / «Пройти ещё раз» работают и не роняют страницу.
3. БД проверка (Supabase Studio):
   - `SELECT source, student_id, session_id, ip_hash IS NOT NULL FROM formula_round_results ORDER BY created_at DESC LIMIT 5` → видны trainer-строки.
   - `SELECT * FROM formula_round_results LIMIT 1` от anon role → ошибка RLS / пусто.
4. Rate-limit проверка: `for i in {1..25}; do curl -X POST ... ; done` → на 21-м запросе должен быть 429.
5. Отчёт: `docs/delivery/features/formula-round-phase-1/validation-report.md` — таблица AC → Pass/Fail + заметки по отклонениям.

**Guardrails.**
- Если AC-8 fail (rate limit не срабатывает) — **не** мёржить. Блокер.
- Если AC-11 fail — **не** мёржить. Блокер (data-leak).
- Остальные AC с отклонениями задокументировать в validation-report, решить go/no-go с Vladimir.

**Validation.** Сам процесс = validation gate для всего Phase 1.

---

## TASK-7 (P1): seed + telemetry breakdown + rules docs

**Job.** Подчистить документацию и добавить «nice to have» улучшения после того как P0 Phase 1 проехал в прод.

**Agent.** mixed (frontend + backend + docs)

**Files.**
- MODIFY: `supabase/seed/formula-round-seed.sql` — пометить `-- DEPRECATED: standalone trainer в Phase 1; этот seed нужен только для будущей homework re-integration` header'ом. **Не** удалять файл — зависит от future P1b spec.
- MODIFY: `.claude/rules/40-homework-system.md` — секция «Тренажёр формул — Formula Rounds (Phase 1a, 2026-04-05)» → переписать в «Phase 1 standalone (2026-04-08): `/trainer`, без homework-связи, анонимная сессия». Удалить старые preview/dev QA упоминания. Добавить линк на `spec.md` v0.2.
- MODIFY: `CLAUDE.md` §4 «Formula rounds — preview-only test access и Phase 1b границы» → заменить на «Phase 1 = standalone `/trainer`. Phase 1b (future) вернёт formula round в homework flow как optional block».
- MODIFY: `src/pages/TrainerPage.tsx` — добавить `console.info('[trainer] round_completed', { score, total, weakCount, durationMs })` в `handleComplete` для последующей интеграции в аналитику (amplitude/posthog когда появятся).
- NEW (опционально): `docs/delivery/features/formula-round-phase-1/followups.md` — список того что ушло в P1+: перемещение папки `src/components/homework/formula-round/` → `src/components/trainer/formula-round/`, добавление реальной аналитики, A/B тест intro screen copy, добавление других секций физики.

**AC.**
- `.claude/rules/40-homework-system.md` и `CLAUDE.md` не содержат устаревших упоминаний preview bypass / `?student=` query param в контексте Phase 1.
- `grep -n "StudentFormulaRound" CLAUDE.md .claude/rules/*.md` → пусто.

**Guardrails.**
- TASK-7 **не** блокирует мерж Phase 1 — запускать только после validation-report с AC-1..AC-11 Pass.
- Не делать широкий рефакторинг внутри single PR: rules-update и folder-move — разные PR.

**Validation.** `grep` проверки выше + ручное ревью CLAUDE.md.

---

## Notes on parallelism

- TASK-1 (миграция) и TASK-2 (edge function) логически связаны, но могут писаться параллельно разными агентами. TASK-2 требует миграцию только на этапе `npm run smoke-check` / ручного теста.
- TASK-3 (migrate screens) чисто frontend, полностью независима от backend → выполняется параллельно с TASK-1/2.
- TASK-4 — финальная сборка frontend части, требует TASK-3 (компоненты без lives) и TASK-2 (endpoint).
- TASK-5 делается после TASK-4 в том же PR или следом — чтобы не оставить висящий dead-code между коммитами.
- TASK-6 — gate, только после всех P0.
- TASK-7 — отдельный PR после merge P0.

---

# Copy-paste промпты для агентов

Ниже — готовые промпты по паттернам из `docs/discovery/product/20-canonical-prompt-patterns.md`. Каждый промпт — plain text, копируется в агента как есть.

## Промпт для TASK-1 (backend)

```
Role: senior backend engineer (Postgres + Supabase).

Context: Sokrat AI — образовательная платформа для репетиторов физики ЕГЭ. Мы пивотируем Formula Round Phase 1 с homework-embedded модуля на standalone публичный тренажёр `/trainer`. Таблица formula_round_results должна начать принимать анонимные записи без student_id / homework_assignment_id, не ломая существующие строки.

Mandatory reads BEFORE coding:
1. docs/delivery/features/formula-round-phase-1/spec.md (v0.2) — Sections 0, 5.1, 6 (AC-7, AC-11), 7.
2. docs/delivery/features/formula-round-phase-1/preview-audit.md — что DROP/MIGRATE/REUSE.
3. CLAUDE.md — секции «Security Rules», «Critical Architecture Rules», §4 formula rounds.
4. .claude/rules/10-safe-change-policy.md.
5. .claude/rules/40-homework-system.md — секция «Тренажёр формул».
6. Существующая миграция formula_rounds (`supabase/migrations/20260406_formula_rounds.sql`) — чтобы понимать текущую схему и RLS.

Task: написать одну новую миграцию `supabase/migrations/20260408160000_trainer_standalone_schema.sql`, которая:
1. Делает `student_id` и `homework_assignment_id` NULLABLE в `formula_round_results` (через ALTER, не через drop+create).
2. Добавляет колонки: `session_id text`, `source text NOT NULL DEFAULT 'homework' CHECK (source IN ('homework','trainer'))`, `ip_hash text`.
3. Создаёт партиальный индекс `idx_formula_round_results_trainer_recent (ip_hash, created_at DESC) WHERE source = 'trainer'` — для rate-limit lookup.
4. Добавляет RLS policy, запрещающую anon role читать строки. service_role bypass — без изменений. `tutor_read_results` policy НЕ трогать.
5. Идемпотентна: `IF NOT EXISTS`, `DROP POLICY IF EXISTS` перед create.

Guardrails:
- НЕ трогать `formula_rounds` — тренажёру конфиг не нужен.
- НЕ добавлять триггеры.
- НЕ делать drop+create таблицы.
- Существующие homework-строки должны остаться валидными.

AC (spec §6):
- AC-7: таблица принимает строки без student_id / homework_assignment_id.
- AC-11: анонимный SELECT по строкам `source='trainer'` возвращает пусто / ошибку RLS.

Final block: после того как миграция написана, запусти `npm run smoke-check`. Если он упадёт из-за отсутствия локальной БД — просто приложи SQL и заметку про ручной apply. Покажи мне финальный файл миграции целиком и краткий changelog.
```

## Промпт для TASK-2 (backend)

```
Role: senior backend engineer (Deno + Supabase Edge Functions).

Context: Sokrat AI standalone тренажёр формул `/trainer`. Нужен публичный edge function без JWT, который принимает результаты раунда, валидирует, rate-limit'ит по хешу IP и пишет в formula_round_results через service_role. Это первая анонимная точка записи в продукте — безопасность критична.

Mandatory reads BEFORE coding:
1. docs/delivery/features/formula-round-phase-1/spec.md — Sections 5.2 (contract), 5.5 (rate limit), 6 (AC-6, AC-7, AC-8), 8 (security).
2. TASK-1 миграция (`supabase/migrations/20260408160000_trainer_standalone_schema.sql`) — колонки `session_id`, `source`, `ip_hash`, индекс rate-limit.
3. CLAUDE.md — «Security Rules», «Передача изображений задач в AI» не релевантно, но прочитать «Critical Architecture Rules».
4. `supabase/functions/homework-api/index.ts` — как референс стиля (service_role client, CORS, error handling). НЕ копировать JWT-проверку, мы её не делаем.
5. .claude/rules/60-telegram-bot.md секция «Надёжность Telegram-бота» — паттерны retry/timeout если понадобятся (здесь не требуются).

Task: написать `supabase/functions/trainer-submit/index.ts`.

Contract:
- POST /functions/v1/trainer-submit
- Body JSON: { session_id: string, score: number, total: number, weak_formulas: string[], duration_ms: number, client_started_at: string }.
- Success: 200 { ok: true, id: string }
- Rate limited: 429 { error: 'rate_limited' }
- Invalid: 400 { error: 'invalid_payload', field: string }
- Other: 500 { error: 'internal' }
- CORS: `*`, methods `POST, OPTIONS`, headers `content-type`. Preflight handled.

Implementation requirements:
- createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } }).
- IP: читать `x-forwarded-for` (берём первый элемент split по ','), fallback `cf-connecting-ip`, fallback 'unknown'.
- ip_hash: `sha256(ip + TRAINER_IP_SALT)` через `crypto.subtle.digest('SHA-256', ...)` + hex encode. TRAINER_IP_SALT — env var, fallback пустая строка с warn в console.
- Validation: session_id 1..64 chars `[a-zA-Z0-9-_]`, score int 0..total, total int 1..50, weak_formulas string[] 0..50 (каждая ≤ 64), duration_ms int 0..3600000, client_started_at ISO-8601 с |now-value| ≤ 24h.
- Rate limit: SELECT count(*) FROM formula_round_results WHERE source='trainer' AND ip_hash=$1 AND created_at > now() - interval '10 minutes'. Если ≥ 20 → 429.
- Insert: { source: 'trainer', student_id: null, homework_assignment_id: null, formula_round_id: null, session_id, score, total, weak_formulas, duration_ms, ip_hash, client_started_at }. Вернуть вставленный id.

Guardrails:
- НЕ проверять JWT / Authorization header.
- НЕ принимать student_id из body — жёстко null.
- НЕ логировать raw IP — только первые 8 символов ip_hash.
- try/catch верхнего уровня — никогда не утекать stack trace наружу.
- НЕ использовать node:crypto — только Deno Web Crypto API.

AC:
- AC-6: POST без Authorization возвращает 200 при валидной payload.
- AC-7: строка в БД имеет source='trainer', student_id=null, session_id, ip_hash.
- AC-8: 21-й запрос за 10 минут с того же ip_hash → 429.

Final block: после написания функции дай мне (а) целиком код index.ts, (б) пример curl-команды для ручного smoke теста, (в) список env vars которые нужно прописать в Supabase secrets (`TRAINER_IP_SALT`).
```

## Промпт для TASK-3 (frontend)

```
Role: senior React/TypeScript engineer.

Context: Sokrat AI standalone тренажёр формул `/trainer`. Нужно мигрировать существующие компоненты раунда (FormulaRoundScreen, RoundProgress, RoundResultScreen) из homework-контекста в standalone-контекст: убрать lives, убрать homework API вызовы, упростить props. CLAUDE.md §11 инвариант: correctness checking остаётся в FormulaRoundScreen.handleAnswer — single source of truth. Карточки (TrueOrFalseCard, BuildFormulaCard, SituationCard) возвращают raw answer, correctness НЕ пересаживаем обратно в них.

Mandatory reads BEFORE coding:
1. docs/delivery/features/formula-round-phase-1/spec.md — Sections 4 (scope IN), 5.3 (frontend state machine), 6 (AC-3, AC-4).
2. docs/delivery/features/formula-round-phase-1/preview-audit.md — что MIGRATE vs REUSE.
3. CLAUDE.md — §4 formula rounds, §11 known fragile areas (FormulaRoundScreen).
4. .claude/rules/10-safe-change-policy.md.
5. .claude/rules/80-cross-browser.md — Safari/iOS constraints (no crypto.randomUUID, text-base 16px, 100dvh).
6. .claude/rules/90-design-system.md — palette, typography, anti-patterns.
7. .claude/rules/performance.md — framer-motion запрещён.
8. Существующие файлы: `src/components/homework/formula-round/FormulaRoundScreen.tsx`, `RoundProgress.tsx`, `RoundResultScreen.tsx`, `src/lib/formulaEngine/types.ts`.

Task:
1. FormulaRoundScreen props → { questions: FormulaQuestion[]; onComplete: (result: RoundResult) => void; onExit: () => void }. Удалить lives, assignmentId, roundId, studentId.
2. Удалить state livesLeft и всю логику вычитания жизней. Раунд завершается, когда пройдены все questions (не раньше).
3. RoundProgress: удалить hearts JSX. Оставить `{current}/{total}` + progress bar.
4. RoundResult (в formulaEngine/types.ts) расширить required-полем durationMs: number. В FormulaRoundScreen замерить через performance.now() на mount и на onComplete.
5. RoundResultScreen: CTA «Пройти ещё раз» + «Назад». Никаких ссылок на homework.
6. handleAnswer не менять по структуре — только убрать любые ссылки на lives.
7. Удалить импорты: @/lib/formulaRoundApi, @/hooks/useFormulaRound, @/lib/studentHomeworkApi, любые @/lib/homework*.
8. Файлы оставить в `src/components/homework/formula-round/` — физический move отложен в P1.

Guardrails:
- НЕ возвращать correctness checking в карточки.
- НЕ добавлять framer-motion — только tailwindcss-animate.
- text-base (16px) на всём интерактиве, touch-action: manipulation на кнопках.
- НЕ использовать crypto.randomUUID.
- Нет emoji в UI chrome — Lucide icons.

AC:
- AC-3: нет lives/hearts в DOM, нет импортов homework*Api.
- AC-4: weak-formulas logic не регрессировала.

Final block: прогони `npm run lint` и `npm run build`. Покажи финальный diff по трём изменённым файлам + новое поле durationMs в types.ts. Если что-то в старом StudentFormulaRound сейчас сломается из-за смены сигнатуры — укажи это в отчёте, TASK-5 потом удалит этот файл полностью.
```

## Промпт для TASK-4 (frontend)

```
Role: senior React/TypeScript engineer (product-minded).

Context: Sokrat AI standalone тренажёр формул. Нужна новая публичная страница `/trainer`, которая работает БЕЗ auth, создаёт анонимную сессию в localStorage, запускает раунд через уже мигрированные компоненты (TASK-3) и отправляет результат на edge function `trainer-submit` (TASK-2). Это вход в продукт для холодного трафика — качество критично для первого впечатления.

Mandatory reads BEFORE coding:
1. docs/delivery/features/formula-round-phase-1/spec.md — Sections 4 (scope IN), 5.3 (state machine), 5.4 (session), 6 (AC-1, AC-2, AC-4, AC-5, AC-9).
2. CLAUDE.md — §4 formula rounds, «Critical Architecture Rules» (Student/Tutor isolation — /trainer не трогает ни один из модулей).
3. .claude/rules/10-safe-change-policy.md — high-risk files: App.tsx route insertion нужен, но AuthGuard НЕ трогать.
4. .claude/rules/80-cross-browser.md — localStorage try/catch, AbortSignal.timeout запрещён, 100dvh, text-base, touch-action.
5. .claude/rules/90-design-system.md — palette (bg-accent, slate-*), typography (Golos Text), одна primary кнопка, Lucide icons, нет emoji в chrome.
6. .claude/rules/performance.md — React.lazy обязателен для новых страниц.
7. Результат TASK-3: FormulaRoundScreen новые props.
8. Результат TASK-2: trainer-submit contract.

Task:

4.1 src/hooks/useTrainerSession.ts
- Хук возвращает { sessionId: string; startedAt: string }.
- sessionId: читается из localStorage['trainer_session_id']; если нет — генерится 16-символьный alphanumeric через Math.random().toString(36).slice(2, 18) (НЕ crypto.randomUUID) и пишется обратно.
- startedAt: ISO от new Date().toISOString() на первый mount, хранится в useRef.
- try/catch вокруг каждого localStorage доступа (Safari private mode кидает).

4.2 src/lib/trainerApi.ts
- export async function submitTrainerRound(payload): Promise<{ ok: true; id: string } | { ok: false; reason: 'rate_limited' | 'invalid' | 'network' }>.
- fetch к `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trainer-submit` без Authorization, только content-type JSON.
- Timeout 8000ms через AbortController + setTimeout (НЕ AbortSignal.timeout — Safari).
- Маппинг ошибок: 429 → rate_limited, 400 → invalid, network/5xx → network.
- НИКОГДА не бросает наружу — всегда возвращает union.

4.3 src/pages/TrainerPage.tsx
- Default export. Full-screen layout: min-h-[100dvh], bg-slate-50, font-golos (через Tailwind Golos Text fallback).
- Header: «Тренажёр формул физики» + Lucide Sparkles в text-accent.
- State machine: 'intro' | 'running' | 'result'.
  - intro: 1 параграф описания (≤ 2 предложения) + одна primary кнопка «Начать» (bg-accent text-white, text-base, touch-action: manipulation) → переводит в 'running'.
  - running: <FormulaRoundScreen questions={generatedQuestions} onComplete={handleComplete} onExit={() => setState('intro')} />. Вопросы генерить через существующий `generateRound({ section: 'kinematics', count: 10 })` из formulaEngine.
  - result: <RoundResultScreen result={roundResult} onRetry={() => { regenerate questions; setState('running') }} onExit={() => setState('intro')} />.
- handleComplete(result):
  1. setState('result') — UI обновляется мгновенно.
  2. fire-and-forget submitTrainerRound({ session_id, score: result.score, total: result.total, weak_formulas: result.weakFormulas, duration_ms: result.durationMs, client_started_at: startedAt }).catch(() => {}).

4.4 src/App.tsx
- Добавить: `const TrainerPage = lazy(() => import('./pages/TrainerPage'));`
- Route: <Route path="/trainer" element={<Suspense fallback={<div className="min-h-[100dvh] grid place-items-center text-slate-500">Загрузка…</div>}><TrainerPage /></Suspense>} />
- Route должен быть СНАРУЖИ AuthGuard / StudentGuard / TutorGuard. Разместить до fallback 404.

Guardrails (КРИТИЧНО):
- ЗАПРЕЩЕНО импортировать homework*Api, useStudentHomework*, studentHomeworkApi, formulaRoundApi, useFormulaRound. grep перед сабмитом.
- ЗАПРЕЩЕНО framer-motion.
- ЗАПРЕЩЕН crypto.randomUUID.
- text-base (16px) минимум на тексте кнопок и любых input.
- touch-action: manipulation на CTA.
- Одна primary кнопка per screen.
- Lucide only, emoji — только в body тексте intro если очень нужно (лучше без).
- НЕ трогать AuthGuard, StudentGuard, TutorGuard — TrainerPage живёт вне их.

AC:
- AC-1: /trainer в incognito без auth → 200, UI рендерится.
- AC-2: localStorage['trainer_session_id'] создаётся и переиспользуется.
- AC-4: POST в trainer-submit после завершения раунда.
- AC-5: grep 'homework\|studentHomework\|formulaRoundApi\|useFormulaRound' в TrainerPage/trainerApi/useTrainerSession → пусто.
- AC-9: отдельный chunk в network panel (подтверждает lazy).

Final block: прогони `npm run lint` + `npm run build`. Покажи мне (а) TrainerPage.tsx целиком, (б) trainerApi.ts целиком, (в) useTrainerSession.ts целиком, (г) diff App.tsx. Дополнительно — grep output подтверждающий AC-5.
```

## Промпт для TASK-5 (frontend)

```
Role: senior frontend engineer (cleanup-focused).

Context: После TASK-4 у нас есть standalone /trainer. Старый homework-embedded путь (StudentFormulaRound + formulaRoundApi + useFormulaRound + preview login bypass) теперь мёртвый код. Нужно его полностью удалить, чтобы в codebase остался single source of truth.

Mandatory reads BEFORE coding:
1. docs/delivery/features/formula-round-phase-1/spec.md — Section 4 (scope OUT: legacy removal), AC-10.
2. docs/delivery/features/formula-round-phase-1/preview-audit.md — DROP list.
3. CLAUDE.md — §4 formula rounds (устаревший блок про preview bypass — удалить в TASK-7, не сейчас).
4. .claude/rules/10-safe-change-policy.md — safe change policy.

Task:
1. git rm src/pages/StudentFormulaRound.tsx.
2. git rm src/lib/formulaRoundApi.ts.
3. git rm src/hooks/useFormulaRound.ts.
4. Удалить из src/App.tsx <Route path="/homework/:id/round/:roundId" ... /> (если ещё есть).
5. `grep -rn 'StudentFormulaRound\|formulaRoundApi\|useFormulaRound' src/` — должен быть пустой. Любые оставшиеся ссылки — удалить.
6. НЕ удалять supabase/seed/formula-round-seed.sql (зона TASK-7).
7. НЕ удалять supabase/migrations/20260406_formula_rounds.sql и таблицу `formula_rounds` — понадобится для future Phase 1b homework re-integration.
8. НЕ удалять RLS policy `tutor_read_results` на formula_round_results.
9. НЕ трогать `src/components/homework/formula-round/*` — эти компоненты уже мигрированы в TASK-3 и используются TrainerPage.

Guardrails:
- `npm run build` должен пройти зелёным.
- Любые type errors → чинить точечно, не делать широкий рефакторинг.

AC:
- AC-10: grep пустой, build зелёный.

Final block: покажи список удалённых файлов, diff App.tsx, grep output подтверждающий AC-10, вывод `npm run lint` + `npm run build` + `npm run smoke-check`.
```

## Промпт для TASK-6 (qa)

```
Role: senior QA engineer (web + cross-browser).

Context: Phase 1 standalone тренажёр `/trainer` готов к релизу. Нужен gate-прогон всех AC-1..AC-11 из spec.md §6 на реальной среде + cross-browser baseline (Windows Chrome + iOS Safari). Отчёт — go/no-go signal для merge.

Mandatory reads BEFORE testing:
1. docs/delivery/features/formula-round-phase-1/spec.md — Section 6 (AC-1..AC-11) полностью.
2. docs/delivery/features/formula-round-phase-1/preview-audit.md.
3. .claude/rules/20-commands-and-validation.md — правильный порядок команд.
4. .claude/rules/80-cross-browser.md — что проверять в Safari.

Task:
1. Прогон dev-команд в последовательности (не параллелить build + smoke-check):
   - npm run lint
   - npm run build
   - npm run smoke-check
2. Ручной smoke в Chrome (Windows) на incognito:
   - Открыть /trainer. Проверить 200, UI рендерится, нет redirect на /login.
   - DevTools → Application → Local Storage → подтвердить trainer_session_id создан, значение 16 chars.
   - Пройти раунд до конца (10 вопросов).
   - DevTools → Network → подтвердить POST в trainer-submit → 200, payload содержит session_id, score, total, weak_formulas, duration_ms, client_started_at.
   - Нажать «Пройти ещё раз» — session_id в localStorage тот же, новый раунд стартует.
3. Ручной smoke в Safari (iOS device или DevTools responsive):
   - То же самое. Особое внимание: min-h-[100dvh] не обрезает контент, кнопки не зумятся (text-base), нет 300ms tap delay.
4. Backend validation (Supabase Studio или psql):
   - SELECT source, student_id, session_id, ip_hash IS NOT NULL, created_at FROM formula_round_results ORDER BY created_at DESC LIMIT 5 — видны trainer-строки, student_id NULL, ip_hash не NULL.
   - Попробовать SELECT из anon role: SELECT * FROM formula_round_results WHERE source='trainer' — должно вернуть пусто или RLS ошибку.
5. Rate-limit smoke: `for i in $(seq 1 25); do curl -sS -X POST 'https://<project>.functions.supabase.co/trainer-submit' -H 'content-type: application/json' -d '{"session_id":"qa-test-001","score":5,"total":10,"weak_formulas":["v=s/t"],"duration_ms":120000,"client_started_at":"2026-04-08T10:00:00Z"}'; echo; done` — на 21-м и далее запросах должен быть 429.
6. Grep проверки:
   - `grep -rn 'StudentFormulaRound\|formulaRoundApi\|useFormulaRound' src/` → пусто (AC-10).
   - `grep -rn 'homework\|studentHomework' src/pages/TrainerPage.tsx src/lib/trainerApi.ts src/hooks/useTrainerSession.ts` → пусто (AC-5).
7. Lazy bundle проверка: Network panel → при заходе на /trainer загружается отдельный chunk имени вроде `TrainerPage-*.js`, не входит в main bundle (AC-9).

Guardrails:
- AC-8 fail (rate limit) → BLOCKER, не мержить.
- AC-11 fail (anon может читать строки) → BLOCKER, не мержить.
- Любой другой fail — задокументировать и запросить go/no-go у Vladimir.

Deliverable: docs/delivery/features/formula-round-phase-1/validation-report.md с таблицей:

| AC   | Description                         | Status       | Notes |
|------|-------------------------------------|--------------|-------|
| AC-1 | /trainer без auth                    | Pass/Fail    | ...   |
| ...  | ...                                  | ...          | ...   |

Final block: покажи мне validation-report.md целиком + список всех найденных отклонений (если есть) с предложениями фиксов.
```

## Промпт для TASK-7 (mixed, P1 — запускать только после merge P0)

```
Role: senior engineer + technical writer.

Context: Phase 1 standalone /trainer уже в проде. Нужно подчистить документацию (CLAUDE.md, .claude/rules/40-homework-system.md), пометить legacy seed как deprecated, добавить минимальную console-телеметрию и завести followups.md со списком P1+.

Mandatory reads BEFORE editing:
1. docs/delivery/features/formula-round-phase-1/spec.md — свежая версия (v0.2).
2. CLAUDE.md — полностью.
3. .claude/rules/40-homework-system.md — полностью, особенно секцию «Тренажёр формул — Formula Rounds (Phase 1a, 2026-04-05)».
4. supabase/seed/formula-round-seed.sql.
5. src/pages/TrainerPage.tsx (из TASK-4).

Task:
1. supabase/seed/formula-round-seed.sql — добавить комментарий-шапку `-- DEPRECATED 2026-04-08: Phase 1 переехал на standalone /trainer, seed сохраняется для будущей Phase 1b homework re-integration. Не использовать для QA тренажёра.`. Файл НЕ удалять.
2. .claude/rules/40-homework-system.md — переписать секцию «Тренажёр формул — Formula Rounds» так:
   - Заменить «Phase 1a (текущая)» на «Phase 1 (done, 2026-04-08): standalone публичный тренажёр на /trainer, без связи с homework, анонимная сессия в localStorage, запись в formula_round_results через trainer-submit edge function».
   - Удалить все упоминания preview/dev auto-login by `?student=<seed_uuid>` в контексте текущего Phase.
   - Добавить ссылку на docs/delivery/features/formula-round-phase-1/spec.md.
   - Секцию «Phase 1b tutor UI guardrails» оставить, но пометить «future work — после Phase 1 standalone validation».
3. CLAUDE.md — §4 «Formula rounds — preview-only test access и Phase 1b границы»:
   - Заменить содержимое на: «Phase 1 = standalone /trainer. Компоненты раунда живут в src/components/homework/formula-round/ (физическое перемещение в P1). Нет preview bypass, нет `?student=` query param. Phase 1b (future) вернёт formula round в homework flow как optional block внутри tutor homework workflow».
4. src/pages/TrainerPage.tsx — в handleComplete добавить ДО fire-and-forget вызова submitTrainerRound: `console.info('[trainer] round_completed', { score: result.score, total: result.total, weakCount: result.weakFormulas.length, durationMs: result.durationMs });`. Это единственное изменение, без рефакторинга.
5. NEW docs/delivery/features/formula-round-phase-1/followups.md — короткий список (4-6 пунктов) P1+ работ: физический move компонентов в src/components/trainer/formula-round/, реальная аналитика (posthog/amplitude), A/B тест intro copy, добавление других секций физики (динамика, статика), intro onboarding tour, Phase 1b homework re-integration.

Guardrails:
- TASK-7 НЕ блокирует Phase 1 merge. Запускать ТОЛЬКО после validation-report AC-1..AC-11 Pass.
- Не делать широких рефакторингов — только текст и один console.info.
- grep: `grep -n "StudentFormulaRound" CLAUDE.md .claude/rules/*.md` → должен быть пустой после правки.

AC:
- CLAUDE.md и .claude/rules/40-homework-system.md не содержат устаревших упоминаний preview bypass / `?student=`.
- Seed-файл помечен deprecated header'ом.
- TrainerPage.tsx шлёт console.info на completion.
- followups.md создан.

Final block: покажи diff по всем изменённым файлам + содержимое followups.md + grep output подтверждающий AC.
```

---

## Final notes

- Спека (v0.2) — source of truth по scope и AC.
- Tasks выше покрывают ровно то, что в spec §5 «Implementation tasks» и §6 «Acceptance criteria». Ничего лишнего.
- Если агент во время работы обнаружит расхождение между spec и tasks — правило: spec побеждает, сообщить Vladimir, обновить tasks отдельным коммитом.
