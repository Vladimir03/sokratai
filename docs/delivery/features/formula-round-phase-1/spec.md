# Feature Spec: Formula Round — Phase 1 (Standalone Public Trainer)

- Version: 0.2
- Status: Draft (scope pivot)
- Owner: Vladimir
- Date: 2026-04-08

> **Scope pivot (v0.1 → v0.2):** Phase 1 ранее описывала встроенный в ДЗ плеер раунда. После `preview-audit.md` и решения дать репетиторам публичную ссылку для пилота — Phase 1 переопределена как **standalone публичный тренажёр формул**. Интеграция с Каталогом Сократа и ДЗ ученика переезжает в Phase 2. Весь preview-код, ведущий через auth-wall ДЗ, выпиливается.

---

## Section 0: Job Context (AJTBD)

**Core Jobs (Job Graph, docs 14–15):**

- **R4-3 «Получить быстрый сигнал, что новый продукт стоит давать ученикам»** — primary job репетитора в пилоте. Тренажёр = лёгкий артефакт, который репетитор может открыть за 30 секунд без регистрации и решить сам, прежде чем рекомендовать ученику.
- **R0-1 «Оценить продукт для своей практики»** — функция витрины: если артефакт не работает standalone, его не будут оценивать.
- **S1-2 «Быстро закрепить формулы раздела перед контрольной»** — ученический job, который репетитор делегирует, отправляя ученику ту же публичную ссылку.

**Segment:** B2B первично — репетиторы физики ЕГЭ/ОГЭ (pilot audience). Ученик — вторично, через ссылку от репетитора.

**Wedge:** артефакт должен доказать, что формульный тренажёр стоит интегрировать в homework workflow. Не самостоятельный продукт, а validation run для Phase 2.

**Pilot impact:** без публичной ссылки Phase 1a бесполезна — preview-аудит показал, что существующий поток заблокирован auth-wall'ом ДЗ и seed-ом, который ссылается на дропнутые колонки. Без standalone trainer'а нет канала сбора сигнала от 3–10 репетиторов пилота до 2026-04-22.

---

## Summary

Публичная standalone-страница тренажёра формул по физике кинематики на URL `/trainer`, без авторизации, с возможностью выбора раздела/темы, прохождением раунда (10 заданий трёх типов из уже существующего `formulaEngine`), экраном результатов с retry-wrong и анонимной телеметрией через edge function. MVP — 1–2 дня интеграции за счёт REUSE существующих компонентов раунда и engine.

## Problem

1. `StudentFormulaRound.tsx` + `/homework/:id/round/:roundId` заперты внутри домашки, требуют auth и живого seed'а. Репетитор из пилота не может открыть ссылку.
2. `supabase/seed/formula-round-seed.sql` ссылается на `homework_tutor_assignments.workflow_mode` — колонку дропнула миграция `20260406120000_drop_classic_homework.sql`. Seed больше не применяется.
3. Phase 1a была спроектирована как «student-facing внутри ДЗ» — полная интеграция с каталогом, назначениями и results flow отняла бы 2+ недели. Пилот этого времени не имеет: цель — собрать сигнал на existing engine до расширения разделов.
4. Формульный engine (12 формул кинематики, `BUILD_RECIPES`, `MUTATION_LIBRARY`, три типа карточек, feedback pipeline) — уже реализован и проверен локально. Он не имеет зависимостей от auth, assignment, KB или tutor state. Его нужно просто открыть наружу.

## Solution

### Ключевые решения

1. **REUSE схему БД через ALTER** — не дропать `formula_rounds` / `formula_round_results`. Сделать `homework_assignment_id` nullable в `formula_rounds`, `user_id` nullable в `formula_round_results`, добавить `nickname`, `anonymous_session_id`, `client_ip_hash` колонки. Одна минимальная миграция.
2. **REUSE formula engine 1:1** — `src/lib/formulaEngine/{formulas,questionGenerator,types,index}.ts` не трогаем. Correctness checking остаётся централизованным в `FormulaRoundScreen.handleAnswer` (см. CLAUDE.md §11).
3. **REUSE карточки 1:1** — `TrueOrFalseCard`, `BuildFormulaCard`, `SituationCard`, `FeedbackOverlay` остаются как есть. `BuildFormulaAnswer { numerator, denominator }` — контракт сохраняется.
4. **MIGRATE round screens** — `FormulaRoundScreen.tsx`, `RoundProgress.tsx`, `RoundResultScreen.tsx` остаются на месте, из них вырезаются lives / hearts / game-over логика. Имена файлов не меняем — переиспользование в Phase 2.
5. **DROP legacy auth path** — удаляем `src/pages/StudentFormulaRound.tsx`, `src/lib/formulaRoundApi.ts`, `src/hooks/useFormulaRound.ts`. Удаляем preview-специфичные handlers в `supabase/functions/homework-api/index.ts` (`handleGetFormulaRound`, `handleListFormulaRoundResults`, `handleCreateFormulaRoundResult`). Удаляем route `/homework/:id/round/:roundId`.
6. **NEW публичная страница** — `src/pages/TrainerPage.tsx`, смонтированная на `/trainer` **вне** `AuthGuard` в `src/App.tsx`. Рендерит landing (section/topic picker) → round (FormulaRoundScreen) → result (RoundResultScreen). React.lazy + Suspense.
7. **NEW edge function `trainer-submit`** — single POST endpoint: принимает результат раунда + anonymous session id + nickname, service_role'ом пишет в `formula_round_results` с `user_id = NULL`. Rate limit по hash(IP) ≤ 20 submits / 10 min. Никаких auth headers.
8. **DROP preview auth bypass** в `StudentFormulaRound.tsx` — вместе с файлом. Host allow-list в `.claude/rules/40-homework-system.md` секцию «Seed + preview QA path» обновить отдельной задачей.
9. **FIX seed** — `supabase/seed/formula-round-seed.sql` почистить от `workflow_mode`. Seed остаётся для Phase 2 интеграции (homework_tutor_assignments), но трейнер на него больше не опирается.

### Scope IN (Phase 1)

1. Публичный URL `/trainer` без auth, без регистрации, без cookies (кроме localStorage на клиенте).
2. Landing-экран с выбором раздела и темы раунда (только kinematics — единственный доступный раздел в engine на 2026-04-08).
3. Кнопка «Начать раунд» → переход в round state, 10 заданий через `generateRound(section)`.
4. Три типа карточек в раунде (TrueOrFalse, BuildFormula, Situation) — как сейчас в `FormulaRoundScreen`.
5. Feedback overlay после каждого ответа — reuse `FeedbackOverlay`.
6. Прогресс-бар без hearts/lives — `RoundProgress` в режиме «прогресс N/10».
7. Result screen: score, breakdown по типам карточек, weak formulas, кнопка «Повторить ошибки» (retry-wrong), кнопка «Новый раунд», кнопка «Выбрать другую тему».
8. Anonymous session id в `localStorage.trainer_session_id` (generated via `Date.now() + Math.random()` — не `crypto.randomUUID`, Safari < 15.4).
9. Опциональный nickname (1 input field на landing, ≤ 32 символа, не обязателен для старта).
10. POST в `trainer-submit` edge function по завершению раунда (non-blocking — UI не ждёт ответ).
11. Server-side rate limit по IP hash с 429 response.

### Scope OUT (Phase 1)

1. ❌ Auth, login, OAuth, Telegram, email — ничего.
2. ❌ Интеграция с `homework_tutor_assignments` — раунд не создаётся ни под какое ДЗ.
3. ❌ Интеграция с Каталогом Сократа — тренажёр не появляется в KB.
4. ❌ Tutor dashboard / visibility / results screen для репетитора.
5. ❌ Public leaderboard или любая страница агрегации результатов.
6. ❌ Admin UI для формул, мутаций, recipes.
7. ❌ Custom round length — всегда 10 заданий.
8. ❌ Lives / hearts / game-over — раунд всегда доигрывается до 10 заданий.
9. ❌ Новые разделы (динамика, электричество) — только кинематика.
10. ❌ Push / email уведомления, Telegram bot integration.
11. ❌ Cross-device session sync.
12. ❌ Нормализация схемы `formula_rounds` для multi-tenant.
13. ❌ Audit log всех submit'ов — только результат в `formula_round_results`.
14. ❌ `/homework/:id/round/:roundId` route — дропается.
15. ❌ Seed-дрafted preview links — дропаются.

### User Stories

- **US1 (репетитор-оценщик):** Как репетитор пилота, я хочу открыть публичную ссылку `https://sokratai.ru/trainer` и за 30 секунд пройти раунд по кинематике, чтобы решить, давать ли его ученикам.
- **US2 (ученик через репетитора):** Как ученик, я получаю ссылку от репетитора, вбиваю никнейм (или нет), выбираю тему и прохожу раунд. Я вижу свой результат и слабые формулы, могу повторить ошибки.
- **US3 (PM / телеметрия):** Как владелец продукта, я хочу видеть в `formula_round_results` агрегированные анонимные прохождения за период пилота, чтобы оценить engagement и completion rate.
- **US4 (ученик-ретраер):** Как ученик с ошибками, я нажимаю «Повторить ошибки» и получаю новый раунд только из формул, на которых я ошибся в предыдущем прохождении.

## Technical Design

### File-level план

| Действие | Файл | Заметки |
|---|---|---|
| REUSE | `src/lib/formulaEngine/formulas.ts` | Без изменений |
| REUSE | `src/lib/formulaEngine/questionGenerator.ts` | Без изменений |
| REUSE | `src/lib/formulaEngine/types.ts` | Без изменений |
| REUSE | `src/lib/formulaEngine/index.ts` | Без изменений |
| REUSE | `src/components/homework/formula-round/TrueOrFalseCard.tsx` | Без изменений |
| REUSE | `src/components/homework/formula-round/BuildFormulaCard.tsx` | Без изменений |
| REUSE | `src/components/homework/formula-round/SituationCard.tsx` | Без изменений |
| REUSE | `src/components/homework/formula-round/FeedbackOverlay.tsx` | Без изменений |
| MIGRATE | `src/components/homework/formula-round/FormulaRoundScreen.tsx` | Вырезать lives/hearts/game-over. Props: `{ section, onComplete(result), onExit }`. Имя файла не менять. |
| MIGRATE | `src/components/homework/formula-round/RoundProgress.tsx` | Вырезать hearts. Только `currentQuestion / totalQuestions` bar. |
| MIGRATE | `src/components/homework/formula-round/RoundResultScreen.tsx` | Вырезать lives. Props: `{ result, onRetryWrong, onNewRound, onChangeTopic }`. |
| NEW | `src/pages/TrainerPage.tsx` | State machine landing→round→result. React.lazy из App.tsx. |
| NEW | `src/lib/trainerApi.ts` | `submitTrainerResult(payload)` — fetch в edge function, non-blocking, swallow errors. |
| NEW | `src/hooks/useTrainerSession.ts` | localStorage-backed anonymous session id + nickname. |
| MODIFY | `src/App.tsx` | Добавить lazy `/trainer` route **вне** AuthGuard. Удалить `/homework/:id/round/:roundId`. |
| DROP | `src/pages/StudentFormulaRound.tsx` | Вместе с preview auth bypass. |
| DROP | `src/lib/formulaRoundApi.ts` | Заменяется на `trainerApi.ts`. |
| DROP | `src/hooks/useFormulaRound.ts` | Не нужен без auth flow. |
| DROP | `supabase/functions/homework-api/index.ts` handlers | `handleGetFormulaRound`, `handleListFormulaRoundResults`, `handleCreateFormulaRoundResult`. |
| NEW | `supabase/functions/trainer-submit/index.ts` | Public POST endpoint, service_role insert, IP rate limit. |
| NEW | `supabase/migrations/20260408160000_trainer_standalone_schema.sql` | ALTER nullable + новые колонки + индекс. |
| MODIFY | `supabase/seed/formula-round-seed.sql` | Убрать `workflow_mode`. Seed сохраняется для Phase 2. |

### Миграция БД

```sql
-- 20260408160000_trainer_standalone_schema.sql
ALTER TABLE public.formula_rounds
  ALTER COLUMN homework_assignment_id DROP NOT NULL;

ALTER TABLE public.formula_round_results
  ALTER COLUMN user_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS nickname TEXT NULL,
  ADD COLUMN IF NOT EXISTS anonymous_session_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS client_ip_hash TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_formula_round_results_anon_recent
  ON public.formula_round_results (anonymous_session_id, created_at DESC)
  WHERE user_id IS NULL;

-- RLS: анонимная вставка разрешена ТОЛЬКО через service_role
-- (edge function). Прямой INSERT от authenticated / anon role — запрещён.
-- Существующие RLS policies на `formula_round_results` уже запрещают
-- не-owner SELECT; оставляем их.
```

### Edge function contract

```
POST /functions/v1/trainer-submit
Content-Type: application/json
(no Authorization header required)

Request:
{
  "sectionId": "kinematics",
  "topicId": "uniform_motion" | null,
  "nickname": "string | null",   // ≤ 32 chars
  "sessionId": "string",          // from localStorage.trainer_session_id
  "durationMs": 123456,
  "totalQuestions": 10,
  "correctCount": 7,
  "answers": [                    // опционально для телеметрии
    { "formulaId": "...", "type": "trueOrFalse" | "buildFormula" | "situation", "isCorrect": true }
  ],
  "weakFormulas": ["v=s/t", "a=(v-v0)/t"]
}

Response 200:
{ "ok": true, "resultId": "uuid" }

Response 400:
{ "ok": false, "error": "invalid_payload" }

Response 429:
{ "ok": false, "error": "rate_limited" }
```

- Rate limit: `sha256(client_ip + daily_salt)` → in-memory Map в edge function с TTL 10 минут, ≤ 20 submits / 10 min per hash.
- Service role пишет insert с `user_id = NULL`, `anonymous_session_id`, `nickname`, `client_ip_hash`.
- Edge function не читает результаты — только пишет.
- Validation: `sectionId` из allowlist, `totalQuestions === 10`, `correctCount` в [0, 10], `nickname` ≤ 32 chars, `sessionId` непустой.

### Frontend state machine (`TrainerPage.tsx`)

```
"landing"  → пользователь выбирает раздел/тему + опциональный nickname
           → клик «Начать» → generateRound(section) → state = "round"

"round"    → рендер FormulaRoundScreen с props { section, onComplete, onExit }
           → на onComplete(result):
               - сохранить result в state
               - вызвать submitTrainerResult(...) (non-blocking)
               - state = "result"

"result"   → рендер RoundResultScreen с props { result, onRetryWrong, onNewRound, onChangeTopic }
           → onRetryWrong → generateRound(section, { onlyFormulas: weakFormulas }) → state = "round"
           → onNewRound → generateRound(section) → state = "round"
           → onChangeTopic → state = "landing"
```

- Никаких роутов внутри тренажёра — одна страница, внутренний state.
- Session id живёт в localStorage, никнейм — тоже (prefill при повторном визите).

### Lazy loading / performance

- `TrainerPage` через `React.lazy(() => import('@/pages/TrainerPage'))` — отдельный chunk.
- `FormulaRoundScreen` и `RoundResultScreen` уже lazy в существующем коде — не трогаем.
- `MathText` — lazy как сейчас.
- `React.memo` на `TaskMiniCard`-подобных list items — reuse правил `performance.md`.
- Начальный bundle `/trainer` ≤ 180 KB gzipped (эвристика, проверяем в validation).

### Cross-browser

- Все правила `.claude/rules/80-cross-browser.md` применяются:
  - Никакого `crypto.randomUUID` — `Date.now() + '-' + Math.random().toString(36).slice(2)`.
  - `text-base` (16px) на `<input nickname>` и `<select section>`.
  - `touch-action: manipulation` на всех кнопках-ответах.
  - Никакого `structuredClone`, `Array.at`, lookbehind regex.
  - `100dvh` вместо `100vh` для fullscreen-секций раунда.
- Никакого `framer-motion` (см. `performance.md`).

### UX / UI

- Landing: один H1 «Тренажёр формул», subtitle «Кинематика. 10 заданий. Без регистрации.», select раздела, optional nickname input, single primary CTA «Начать» (`bg-accent text-white`).
- Round: существующий layout `FormulaRoundScreen`, минус hearts row.
- Result: score big number, «Повторить ошибки» primary (если weak formulas > 0), «Новый раунд» / «Другая тема» secondary. Ref: `.claude/rules/90-design-system.md` — одна primary per screen.
- Никаких emoji в chrome. Lucide иконки.

## Acceptance Criteria

- **AC-1** (публичный доступ) — PASS: открытие `https://sokratai.ru/trainer` в incognito без cookies рендерит landing внутри < 2 сек, без редиректов на login.
- **AC-2** (нет auth) — PASS: DevTools → Network → на landing/round/result нет запросов с `Authorization: Bearer`, кроме POST в `/functions/v1/trainer-submit` без Authorization header.
- **AC-3** (раунд проходится) — PASS: 10 заданий, все три типа карточек появляются, feedback overlay показывается после каждого ответа, раунд доигрывается до result screen без game-over даже при 10/10 ошибках.
- **AC-4** (result + retry-wrong) — PASS: на result screen кнопка «Повторить ошибки» генерирует раунд только из `weakFormulas`. При нуле ошибок кнопка либо скрыта, либо disabled.
- **AC-5** (anonymous session) — PASS: `localStorage.trainer_session_id` создаётся при первом визите, переиспользуется при повторе, не зависит от auth.
- **AC-6** (submit non-blocking) — PASS: выключение сети (DevTools offline) между round→result НЕ блокирует переход на result screen и не показывает ошибку в foreground UI.
- **AC-7** (submit успешный) — PASS: при онлайн-прохождении в `formula_round_results` появляется строка с `user_id IS NULL`, правильными `correct_count`, `anonymous_session_id`, опциональным `nickname`.
- **AC-8** (rate limit) — PASS: 21-й submit с одного IP за 10 минут возвращает 429 и не пишет строку в `formula_round_results`.
- **AC-9** (iOS Safari smoke) — PASS: на iPhone Safari (iOS 15+) раунд проходится до конца, нет auto-zoom на input, кнопки кликабельны без 300ms delay.
- **AC-10** (dead code) — PASS: grep по репо `StudentFormulaRound|formulaRoundApi|useFormulaRound|/homework/:id/round` — 0 результатов.
- **AC-11** (seed не ломается) — PASS: `psql -f supabase/seed/formula-round-seed.sql` выполняется без ошибок (фикс `workflow_mode`).

## Requirements

### P0 (без чего пилот не запустится)

- **P0-1** Миграция `20260408160000_trainer_standalone_schema.sql` применяется.
- **P0-2** Edge function `trainer-submit` задеплоена, rate limit работает.
- **P0-3** `TrainerPage` + route `/trainer` вне `AuthGuard`, доступен на `https://sokratai.ru/trainer`.
- **P0-4** `FormulaRoundScreen` / `RoundProgress` / `RoundResultScreen` мигрированы (lives вырезаны), все три типа карточек работают.
- **P0-5** Anonymous session id + optional nickname в localStorage + передача в submit.
- **P0-6** Retry-wrong на result screen.
- **P0-7** Cleanup: `StudentFormulaRound`, `formulaRoundApi`, `useFormulaRound`, старые handlers, старый route — удалены.

### P1 (желательно в рамках Phase 1, не блокирует запуск)

- **P1-1** Телеметрия breakdown по типам карточек в payload submit.
- **P1-2** Seed-fix `formula-round-seed.sql` (`workflow_mode` убран) — полезно для Phase 2, не нужен самому тренажёру.
- **P1-3** Prefill nickname из localStorage при повторном визите.
- **P1-4** Link share helper на result screen («Скопировать ссылку на тренажёр»).
- **P1-5** Обновление `.claude/rules/40-homework-system.md` — убрать упоминания preview QA path через `?student=<uuid>`.

## Validation

```bash
npm run lint
npm run build
npm run test
npm run smoke-check
```

Smoke-chek tutorial (ручной):
1. Open `https://sokratai.ru/trainer` в incognito.
2. Verify landing renders, нет редиректа на `/auth`.
3. Start round, answer 10 questions (mix wrong/right).
4. Verify result screen, click «Повторить ошибки» — новый раунд из weakFormulas.
5. Open Supabase SQL editor → `select user_id, nickname, anonymous_session_id, correct_count from formula_round_results order by created_at desc limit 5;` — видны анонимные строки.
6. Open iPhone Safari, повторить steps 1–4.

## Risks

| Риск | Impact | Mitigation |
|---|---|---|
| Rate limit обходится при смене IP | Low | В Phase 1 достаточно. Phase 2 → hCaptcha |
| `user_id NOT NULL` constraint в `formula_round_results` ломает anonymous insert | High | Миграция делает nullable P0-1 |
| Seed падает при apply из-за `workflow_mode` | Med | Seed-fix P1-2 (используется только в Phase 2) |
| Host allow-list в rules-доке устаревает | Low | P1-5 |
| Пилотные репетиторы не найдут CTA на landing | Med | Одна primary кнопка, большая, bg-accent |
| Submit падает под нагрузкой, UI зависает | High | Non-blocking submit + AC-6 |
| Dead code остаётся → regression в Phase 2 | Med | AC-10 grep check в validation |
| Edge function публичная → spam-запись в таблицу | Med | Rate limit + validation allowlist |

## Implementation Tasks

### Implementation Status (2026-04-08)

- `TASK-1` и `TASK-2` выполнены: standalone schema drift закрыт миграцией [20260408160000_trainer_standalone_schema.sql](/c:/Users/kamch/sokratai/supabase/migrations/20260408160000_trainer_standalone_schema.sql), публичный endpoint [trainer-submit/index.ts](/c:/Users/kamch/sokratai/supabase/functions/trainer-submit/index.ts) задеплоен в repo.
- `TASK-3` выполнен: `FormulaRoundScreen`, `RoundProgress`, `RoundResultScreen` работают без lives/hearts; `RoundResult.durationMs` стал required.
- `TASK-4` выполнен: добавлены [src/pages/TrainerPage.tsx](/c:/Users/kamch/sokratai/src/pages/TrainerPage.tsx), [src/lib/trainerApi.ts](/c:/Users/kamch/sokratai/src/lib/trainerApi.ts), [src/hooks/useTrainerSession.ts](/c:/Users/kamch/sokratai/src/hooks/useTrainerSession.ts), lazy route `/trainer` в [src/App.tsx](/c:/Users/kamch/sokratai/src/App.tsx) и отдельный neutral re-export [src/components/formula-round/index.ts](/c:/Users/kamch/sokratai/src/components/formula-round/index.ts) для AC-5 grep.
- `TASK-5` выполнен: legacy preview frontend path удалён — `StudentFormulaRound.tsx`, `formulaRoundApi.ts`, `useFormulaRound.ts` и route `/homework/:id/round/:roundId` больше не существуют в `src/`.
- Validation snapshot: `npm run build` ✓, `npm run smoke-check` ✓, `npm run lint` всё ещё красный из-за pre-existing repo-wide ESLint debt, не из-за trainer implementation.

1. **TASK-1**: миграция `20260408160000_trainer_standalone_schema.sql` (ALTER nullable + новые колонки + индекс).
2. **TASK-2**: edge function `supabase/functions/trainer-submit/index.ts` (POST, service_role insert, IP rate limit, payload validation).
3. **TASK-3** ✅ **Done (2026-04-08)**: MIGRATE screens — lives/hearts/game-over вырезаны из `FormulaRoundScreen`, `RoundProgress`, `RoundResultScreen`. Финальные сигнатуры:
   - `FormulaRoundScreen` props: `{ questions: FormulaQuestion[]; onComplete: (result: RoundResult) => void; onExit: () => void }`. Убраны `roundConfig`, `lives` state, `Кинематика — Формулы` header label. Добавлен `ArrowLeft` back button (44×44, `touchAction: manipulation`, `aria-label="Выйти из раунда"`) слева от `RoundProgress`. Timing переведён на `performance.now()` (mount + per-question). `buildResult` hardcodes `livesRemaining: 0`, `completed: true`. `handleAnswer` структурно не тронут — correctness checking остаётся single source of truth (CLAUDE.md §11).
   - `RoundProgress` props: `{ current: number; total: number }`. Убраны `lives`/`maxLives` props, `Heart` import, heart-ряд. Counter typography `text-sm → text-base` (iOS Safari readability).
   - `RoundResultScreen` props: `{ result: RoundResult; onRetryWrong: () => void; onExit: () => void }`. Убраны `Heart` import, `MAX_LIVES`, lives row. CTAs: «Пройти ещё раз» (primary, `bg-accent`, показывается только при `weakFormulas.length > 0`) + «Назад» (всегда, full-width fallback). `touchAction: manipulation` + `focus-visible:ring` на обоих. Weak-formulas rendering (Map lookup + `MathText` lazy) не тронут — AC-4 не регрессировал.
   - `RoundResult` в `src/lib/formulaEngine/types.ts` расширен required полем `durationMs: number` (рядом с существующим `durationSeconds`, который оставлен для совместимости с `formulaRoundApi.ts` до TASK-5).
   - `FeedbackOverlay` переиспользован 1:1 — `livesLost={0}` делает heart badge невидимым (`!isCorrect && livesLost > 0` guard).
   - `src/pages/StudentFormulaRound.tsx` получил минимальный compat-патч (3 строки) чтобы production build остался зелёным: убран `roundConfig` prop, переименованы `onRetryErrors → onRetryWrong` и `onClose → onExit`. Файл целиком удалит TASK-5. `roundConfig`/`toRoundConfig` локально там ещё остаются — нужны engine-функциям `generateRound`/`generateRetryRound`, не UI.
   - Validation: `npm run lint` (нет новых ошибок в тронутых файлах — ESLint-вывод чист на `src/components/homework/formula-round/*` и `src/lib/formulaEngine/types.ts`; 194 pre-existing ошибки в `supabase/functions/telegram-bot/index.ts` / `tailwind.config.ts` / прочих — не введены этой задачей), `npm run build` — ✓ зелёный (25.14s).
4. **TASK-4** ✅ **Done (2026-04-08)**: NEW `TrainerPage.tsx` + `trainerApi.ts` + `useTrainerSession.ts`. `/trainer` route добавлен в `App.tsx` вне `AuthGuard`; build собрал отдельный lazy chunk `TrainerPage-*.js`.
5. **TASK-5** ✅ **Done (2026-04-08)**: DROP `StudentFormulaRound.tsx`, `formulaRoundApi.ts`, `useFormulaRound.ts`, route `/homework/:id/round/:roundId`. Grep по `src/` на `StudentFormulaRound|formulaRoundApi|useFormulaRound|/homework/:id/round/:roundId` — пустой.
6. **TASK-6**: Validation — `npm run lint && npm run build && npm run smoke-check`; ручной smoke по AC-1..AC-11; проверка в iOS Safari.
7. **TASK-7** (P1): seed-fix + rules-docs update + telemetry breakdown в submit payload.

## Parking Lot

1. Tutor visibility: tutor dashboard видит результаты учеников по public ссылке.
2. Интеграция с `homework_tutor_assignments` — round как блок ДЗ.
3. Интеграция с KB: тренажёр-блок в Каталоге Сократа.
4. Custom round length (5 / 10 / 15 заданий).
5. Lives mode (опциональный challenge для ученика).
6. Новые разделы физики (динамика, электростатика, МКТ).
7. Public leaderboard по никнеймам.
8. hCaptcha / bot protection.
9. Admin UI для добавления формул, мутаций, recipes без деплоя.

## Definition of Done

1. Все P0 требования реализованы и задеплоены на prod (`sokratai.ru`).
2. Все AC-1..AC-11 проходят smoke-check (включая iOS Safari).
3. `npm run lint && npm run build && npm run smoke-check` — зелёные.
4. Dead code удалён (grep AC-10).
5. Миграция применена на prod БД.
6. Публичная ссылка `https://sokratai.ru/trainer` отправлена 3–10 репетиторам пилота.
7. Первые анонимные записи в `formula_round_results` появились от non-dev IP.
