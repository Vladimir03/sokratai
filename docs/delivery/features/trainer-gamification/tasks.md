# Tasks: Trainer Gamification — Phase 1

**Pipeline step:** 5 (TASKS)
**Related:** `prd.md`, `spec.md`
**Agent:** Claude Code (primary) + Codex (review)
**Total effort:** ≈ 1 день фокусной работы (8 задач)

---

## Порядок выполнения

```
TASK-1 (stores/libs)  ──┬──► TASK-2 (combo in round)
                        ├──► TASK-3 (landing widget)
                        └──► TASK-4 (result screen)
                                  │
                                  ▼
                             TASK-5 (wire-up + telemetry)
                                  │
                 ┌────────────────┼────────────────┐
                 ▼                ▼                ▼
            TASK-6 (P1       TASK-7 (P1        TASK-8 (QA)
            Celebrate)       polish)
```

TASK-1 блокирующая. TASK-2/3/4 можно делать параллельно (разные файлы). TASK-5 требует 2-4. TASK-6/7 — параллельны, P1. TASK-8 — финальный.

---

## TASK-1: Foundation — stores & pure libraries

**Job:** P1 (funnel) · **Agent:** Claude Code · **AC:** AC-1, AC-6, AC-7, AC-8 (базис)

**Files (NEW):**
- `src/stores/trainerGamificationStore.ts`
- `src/lib/trainerGamification/xpCalculator.ts`
- `src/lib/trainerGamification/dateKey.ts`
- `src/lib/trainerGamification/telemetry.ts`
- `src/lib/trainerGamification/pluralize.ts`

**Что делать:**
1. Создать Zustand store с `persist` middleware (`name: 'sokrat-trainer-gamification-v1'`, `version: 1`). Shape — см. spec §5.2.
2. Реализовать `applyRoundResult(outcome) → AppliedOutcome`:
   - Вычислить new `dailyRoundsCount` (rollover на новый день)
   - Обновить streak (см. spec §5.4)
   - Вызвать `computeRoundXp`
   - Определить `isNewBest` (только если `!isRetry`)
   - Обновить `totalXp`, `bestScoreBySection`, `longestStreak`, `bestCombo`, `lastPlayedDate`
   - Вернуть полный `AppliedOutcome`
3. Реализовать pure функции в `xpCalculator.ts` — формула из spec §5.3.
4. `dateKey.ts` — `todayLocalKey()` и `daysBetween(a, b)` через UTC-нормализацию.
5. `telemetry.ts` — `trackTrainerEvent(event, payload)` через `console.info('[trainer-telemetry] {...}')`.
6. `pluralize.ts` — `pluralDays(n)` с правилами «день/дня/дней».

**Guardrails:**
- Pure functions где возможно. Store — тонкая обёртка над lib-функциями.
- Никаких side-effects в `applyRoundResult` кроме update state + telemetry events.
- localStorage write внутри `persist` middleware, не вручную.

**Validation:**
- `npm run lint`
- `npm run build`
- Открыть DevTools → выполнить `useTrainerGamificationStore.getState().applyRoundResult({section:'kinematics',correctCount:8,totalCount:10,bestComboInRound:5,isRetryMode:false})` → проверить return shape и Local Storage.

---

## TASK-2: In-round combo tracking + ComboIndicator

**Job:** P1 · **Agent:** Claude Code · **AC:** AC-5, частично AC-1

**Files:**
- `src/lib/formulaEngine/types.ts` — MODIFY (добавить `maxCombo: number` в `RoundResult`)
- `src/components/homework/formula-round/FormulaRoundScreen.tsx` — MODIFY
- `src/components/homework/formula-round/ComboIndicator.tsx` — NEW

**Что делать:**
1. Расширить `RoundResult` additive полем `maxCombo: number`.
2. В `FormulaRoundScreen`:
   - Local state: `currentCombo: number`, `maxComboInRound: number`. Инициализация — `0`.
   - В `handleAnswer`: correct → `currentCombo += 1`, обновить max; incorrect → `currentCombo = 0`.
   - Сбрасывать при unmount / restart раунда.
   - `buildResult` включает `maxCombo: maxComboInRound`.
3. `ComboIndicator`:
   - Показывается ТОЛЬКО при `combo >= 2`.
   - Pill: `bg-accent text-white rounded-full px-3 py-1 text-sm font-semibold tabular-nums`.
   - `Zap`-like иконка (можно reuse из TASK-3 если сделан, иначе inline SVG).
   - CSS keyframe `zoom-in-110` на mount/increment (использовать `animate-in zoom-in-110 duration-200` из tailwindcss-animate, с `key={combo}` для re-trigger).
   - При break — optional shake (добавить `animate-shake` utility в `tailwind.config.ts` если нужно; иначе опустить, P1).
   - `React.memo`.
4. Размещение: справа вверху `FormulaRoundScreen` header, рядом с `RoundProgress` (не ломать существующий layout — см. rule 40, TASK-3 сигнатуры props сохранены).

**Guardrails:**
- **НЕ ТРОГАТЬ** correctness checking в `handleAnswer` — это single source of truth, см. rule 40 hrupkie area #11.
- Карточки (`TrueOrFalseCard`, `BuildFormulaCard`, `SituationCard`) НЕ меняются — они по-прежнему возвращают raw answer.
- `framer-motion` запрещён.
- `maxCombo` в `RoundResult` — required additive field, не ломает compat (spec инвариант).

**Validation:**
- `npm run lint && npm run build`
- Ручной прогон: начать раунд, ответить 3 правильно → видно «combo × 3»; ошибка → pill исчезает; продолжить — счётчик с 0.

---

## TASK-3: Landing widget — 3 gamification cards

**Job:** P1 · **Agent:** Claude Code · **AC:** AC-2, AC-8

**Files (NEW):**
- `src/components/homework/formula-round/gamification/StreakCard.tsx`
- `src/components/homework/formula-round/gamification/XpCard.tsx`
- `src/components/homework/formula-round/gamification/BestScoreCard.tsx`
- `src/components/homework/formula-round/gamification/icons/FlameIcon.tsx`
- `src/components/homework/formula-round/gamification/icons/ZapIcon.tsx`
- `src/components/homework/formula-round/gamification/icons/TrophyIcon.tsx`

**Files (MODIFY):**
- `src/pages/TrainerPage.tsx` — добавить рендер 3 карточек сверху landing view

**Что делать:**
1. Custom SVG-иконки — inline React components, 32×32 viewport, fill через `currentColor`. Стиль: geometric, без детализации (под «рабочее место репетитора», не Duolingo-cartoon).
2. `StreakCard`:
   - `FlameIcon className="text-socrat-accent"` 32×32
   - `currentStreak` крупно (`text-3xl font-bold text-slate-900 tabular-nums`)
   - Plural label через `pluralDays()`
   - Если `currentStreak === 0` → muted (`text-slate-400`) + hint «сыграй раунд»
3. `XpCard`:
   - `ZapIcon className="text-accent"`
   - `totalXp` крупно, `tabular-nums`
   - «XP» label
   - Daily goal progress bar: `bg-accent/20` track, `bg-accent` fill, width = `(dailyRoundsCount / DAILY_GOAL_ROUNDS) * 100%` capped at 100%. Текст `Цель дня: {dailyRoundsCount}/{DAILY_GOAL_ROUNDS}` (✨ при 2/2)
4. `BestScoreCard`:
   - `TrophyIcon className="text-accent"`
   - Native `<select>` с опциями: Вся механика, Кинематика, Динамика, Законы сохранения, Статика, Гидростатика (значения = `SectionKey`)
   - `text-base` (16px) на select — iOS anti-autozoom
   - Число XP рекорда или `—` если нет записи
5. Layout в `TrainerPage`:
   - Desktop: `grid grid-cols-3 gap-4`
   - Mobile: `flex gap-3 overflow-x-auto touch-pan-x` + `snap-x snap-mandatory` + каждая card `snap-start min-w-[240px]`
   - Расположение: СВЕРХУ, над существующим выбором раздела
6. Все 3 card обёрнуты в `React.memo`. `bg-white border border-slate-200 rounded-lg p-4`, `animate={false}` если внутри Card primitive (rule 10).

**Guardrails:**
- Emoji ❌ (`90-design-system.md`).
- `framer-motion` ❌.
- Hard-coded hex ❌ (`bg-accent`, `text-socrat-accent`, не `bg-[#...]`).
- `font-size >= 16px` на `<select>`.

**Validation:**
- `npm run lint && npm run build`
- Chrome desktop: grid из 3 карточек.
- iPhone Safari (или DevTools responsive): horizontal scroll с snap, select не зумит.

---

## TASK-4: RoundResultScreen — XP breakdown + 2 CTAs

**Job:** P1 · **Agent:** Claude Code · **AC:** AC-1, AC-6, AC-7

**Files:**
- `src/components/homework/formula-round/RoundResultScreen.tsx` — MODIFY
- `src/components/homework/formula-round/XpBreakdown.tsx` — NEW

**Что делать:**
1. `XpBreakdown` (pure presentational, принимает `AppliedOutcome`):
   - Список lines: Базовый / Точность {N%} / Combo × {N} / Идеальный раунд / Новый рекорд!
   - Только показываем non-zero lines (кроме base — всегда)
   - Separator + «Итого» bold
   - Если `retryMultiplier < 1` → serif-light строка «Повтор ошибок: ×0.5 → {final} XP»
   - `tabular-nums` на всех числах
2. `RoundResultScreen`:
   - Новые props: `appliedOutcome: AppliedOutcome`, `onReplaySame: () => void`, `onRetryWrong: () => void`, `onExit: () => void`
   - Рендер:
     - existing weak-formulas block (не трогать)
     - `<XpBreakdown outcome={appliedOutcome} />`
   - CTAs блок:
     - **«Пройти ещё раз»** — primary `bg-accent text-white`, всегда виден, `onReplaySame`
     - **«Повторить ошибки»** — secondary `bg-white border border-slate-200`, только если `weakFormulas.length > 0`, `onRetryWrong`
     - **«Назад»** — ghost `text-slate-500`, `onExit`
   - Все CTAs: `min-h-[44px]`, `touch-action: manipulation`, `text-base`

**Guardrails:**
- Убрать из spec-signature TASK-3 formula-round-phase-1: старый `onRetryWrong` был единственным CTA — теперь их три. Signature breaking change, но `TrainerPage` единственный caller (см. spec §5.9).
- Карточный layout внутри — **без вложенных Card**, `90-design-system.md` anti-pattern #2.

**Validation:**
- `npm run lint && npm run build`
- Ручной прогон через TASK-5 wire-up.

---

## TASK-5: Wire-up — TrainerPage integration + telemetry

**Job:** P1 · **Agent:** Claude Code · **AC:** AC-1, AC-3, AC-4, AC-7, AC-8
**Depends on:** TASK-1, TASK-2, TASK-3, TASK-4

**Files:**
- `src/pages/TrainerPage.tsx` — MODIFY

**Что делать:**
1. Хранить `lastQuestionsRef = useRef<FormulaQuestion[] | null>(null)`. На старте раунда (landing → round) — `lastQuestionsRef.current = generatedQuestions`.
2. State: `appliedOutcome: AppliedOutcome | null`, `isRetryMode: boolean`.
3. `handleRoundComplete(result: RoundResult)`:
   ```ts
   const outcome = useTrainerGamificationStore.getState().applyRoundResult({
     section: currentSection,
     correctCount: result.correct,
     totalCount: result.total,
     bestComboInRound: result.maxCombo,
     isRetryMode,
   });
   setAppliedOutcome(outcome);
   trackTrainerEvent('trainer_round_completed', { section, accuracy, bestCombo, xpEarned, isNewBest, isRetry });
   if (outcome.streakGained) trackTrainerEvent('trainer_streak_incremented', {...});
   if (outcome.isDailyGoalReached) trackTrainerEvent('trainer_daily_goal_reached', {...});
   if (outcome.isNewBest) trackTrainerEvent('trainer_new_best', {...});
   // streak_broken — внутри applyRoundResult (проще определить там)
   ```
4. `handleReplaySame()`:
   - `isRetryMode = false`
   - Передать `lastQuestionsRef.current` как questions в `FormulaRoundScreen` (тот же набор)
5. `handleRetryWrong()`:
   - `isRetryMode = true`
   - Сгенерировать questions из `appliedOutcome.weakFormulas` (existing behaviour)
6. `handleExit()` — возврат на landing, `appliedOutcome = null`, `isRetryMode = false`.

**Guardrails:**
- `applyRoundResult` fires `trainer_streak_broken` event внутри store (знает `daysSinceLastPlay`), не дублировать в page.
- Telemetry payloads — без PII, без task_text.

**Validation:**
- `npm run lint && npm run build && npm run smoke-check`
- Ручная проверка 5 events в console.

---

## TASK-6 (P1): Celebrate SVG overlay

**Job:** P1 · **Agent:** Claude Code · **AC:** AC-9

**Files (NEW):**
- `src/components/homework/formula-round/Celebrate.tsx`

**Files (MODIFY):**
- `src/components/homework/formula-round/RoundResultScreen.tsx` — рендер `<Celebrate />` при mount если applicable

**Что делать:**
1. `Celebrate` принимает `variant: 'new-best' | 'perfect' | 'goal'`.
2. Фиксированный overlay (`fixed inset-0 pointer-events-none z-50 flex items-center justify-center`).
3. Три варианта визуала (inline SVG + CSS keyframes):
   - `new-best`: gold confetti burst (12 лучей из центра), scale + fade, текст «Новый рекорд!» под — `text-accent`
   - `perfect`: green star с pulse + glow, «Идеальный раунд!» — `text-accent`
   - `goal`: orange flame с bounce, «Цель дня выполнена!» — `text-socrat-accent`
4. `setTimeout(() => setVisible(false), 1200)` + cleanup в `useEffect` return (паттерн `TaskStepper` celebration, см. rule 40 hrupkie area #11).
5. В `RoundResultScreen`: priority select `appliedOutcome.isNewBest ? 'new-best' : isPerfectRound ? 'perfect' : isDailyGoalReached ? 'goal' : null`. Один overlay max.

**Guardrails:**
- `framer-motion` ❌ → CSS `@keyframes` inline или tailwindcss-animate utilities.
- `will-change: transform` на анимируемых элементах, НЕ `will-change: all`.
- `React.memo` на Celebrate.
- Cleanup обязателен — иначе «state update after unmount» warning.

**Validation:**
- Сыграть раунд с new best → видно confetti → через 1200ms исчезает.
- React DevTools Profiler — нет утечек.

---

## TASK-7 (P1): Polish — plural / daily goal bar / disclaimer

**Job:** P1 · **Agent:** Claude Code · **AC:** AC-10

**Files:**
- `src/components/homework/formula-round/gamification/StreakCard.tsx` — MODIFY (plural)
- `src/components/homework/formula-round/gamification/XpCard.tsx` — MODIFY (progress bar)
- `src/pages/TrainerPage.tsx` — MODIFY (footer disclaimer)

**Что делать:**
1. Plural в `StreakCard` через `pluralDays()` (уже написан в TASK-1). Убедиться: 1→день, 2→дня, 5→дней, 21→день, 25→дней.
2. `XpCard` progress bar (если не сделан в TASK-3).
3. Footer disclaimer в `TrainerPage`: `text-xs text-slate-400 text-center mt-8` — «Прогресс сохраняется в браузере. При смене устройства серия может сброситься.»

**Validation:**
- Визуальная проверка 5 значений streak: 1/2/5/21/25.

---

## TASK-8: QA + smoke fixes + Safari iOS проверка

**Job:** P1 · **Agent:** Claude Code (self-QA) + Codex (review) · **AC:** AC-11 + все предыдущие

**Что делать:**
1. Пройти всю QA chain из spec §9.
2. Safari iOS реальное устройство:
   - Landing scroll с snap работает
   - Нет auto-zoom на `<select>` и CTAs
   - Нет 300ms tap delay
   - Combo pill не дёргает layout
3. Chrome DevTools Lighthouse: Performance ≥ 85 на `/trainer`.
4. Console filter `[trainer-telemetry]` — все 5 событий fire корректно.
5. Edge cases:
   - Первый раунд в жизни (пустой store)
   - Раунд на новом дне после пропуска 3 дней (streak reset to 1)
   - Retry-раунд с XP > best (best НЕ обновляется)
   - «Пройти ещё раз» → тот же набор (сравнить по `id` первого вопроса)
6. Подготовить review-промпт для Codex:
   - Прочитать PRD, Spec, diff
   - Проверить AC-1..AC-11
   - Проверить отсутствие framer-motion, emoji, hard-coded hex
   - Проверить Safari-совместимость (`100dvh`, `text-base` на select, `touch-pan-x`)

**Validation:**
- `npm run lint && npm run build && npm run smoke-check` — все зелёные.

---

## Copy-paste промпты для агентов

### Промпт для TASK-1 (Claude Code)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: SokratAI — AI-платформа для подготовки к ЕГЭ/ОГЭ по физике. Сегмент — школьники 9-11 класс (mobile primary) и репетиторы (B2B wedge). Фича trainer-gamification — top-of-funnel funnel-канал для привлечения учеников через standalone `/trainer`. AI = draft + action, не chat-only.

Обязательно прочитай перед работой:
- CLAUDE.md
- docs/delivery/features/trainer-gamification/prd.md
- docs/delivery/features/trainer-gamification/spec.md
- .claude/rules/80-cross-browser.md
- .claude/rules/90-design-system.md
- .claude/rules/performance.md

Задача: TASK-1 из tasks.md — создать foundation (stores + pure libraries) для trainer gamification.

Файлы создать:
- src/stores/trainerGamificationStore.ts (Zustand + persist, name 'sokrat-trainer-gamification-v1', version 1)
- src/lib/trainerGamification/xpCalculator.ts (pure)
- src/lib/trainerGamification/dateKey.ts (todayLocalKey, daysBetween)
- src/lib/trainerGamification/telemetry.ts (console.info wrapper)
- src/lib/trainerGamification/pluralize.ts (pluralDays)

XP формула (см. spec §5.3):
base=10, accuracy=round((correct/total)*20), combo=min(maxCombo*2, 20),
perfect=(correct===total?30:0), newBest=(isNewBest?20:0);
total = floor((base+accuracy+combo+perfect+newBest) * (isRetry?0.5:1.0))

В retry-mode isNewBest принудительно false.

applyRoundResult должен:
1. Rollover daily count на новый день
2. Streak update (spec §5.4): +1 если первый раунд дня и lastPlayed===yesterday; reset to 1 если <yesterday; без изменений если second+ round of same day
3. Fire trainer_streak_broken telemetry event если streak reset (не был 0 перед этим)
4. Обновить totalXp, bestScoreBySection[section] (только если !isRetry и newBest), longestStreak, bestCombo, lastPlayedDate
5. Return AppliedOutcome со всеми флагами

Guardrails:
- Pure functions где возможно. Store — тонкая обёртка.
- Никаких UI, только data layer.
- framer-motion ЗАПРЕЩЁН везде в проекте (performance.md).
- Emoji ЗАПРЕЩЕНЫ в UI chrome (90-design-system.md) — но это data layer, не UI, здесь неактуально.

Acceptance Criteria:
- AC-1 (partial): XP расчёт корректен, проверяется через console + Local Storage
- AC-6: retry-mode даёт *0.5 multiplier, best не обновляется
- AC-8: localStorage корректно читается между перезагрузками

Validation:
- npm run lint
- npm run build
- Ручной тест: useTrainerGamificationStore.getState().applyRoundResult({...})

В конце верни:
- changed files (list)
- summary (что сделано)
- validation results
- docs-to-update (если нужно)
- self-check vs spec.md §5.2, §5.3, §5.4, §5.5
```

### Промпт для TASK-2 (Claude Code)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Прочитай: CLAUDE.md, .claude/rules/40-homework-system.md (секция «Тренажёр формул» и hrupkie area #11), .claude/rules/performance.md, docs/delivery/features/trainer-gamification/spec.md.

Задача: TASK-2 — добавить combo tracking в FormulaRoundScreen + создать ComboIndicator.

Шаги:
1. src/lib/formulaEngine/types.ts — добавить `maxCombo: number` в RoundResult (additive required field).
2. src/components/homework/formula-round/FormulaRoundScreen.tsx — добавить state currentCombo/maxComboInRound, обновлять в handleAnswer (correct → +1, incorrect → 0), buildResult включает maxCombo.
3. src/components/homework/formula-round/ComboIndicator.tsx (NEW) — pill «combo × N» с zoom-in animation, показ только при combo>=2, React.memo.

КРИТИЧНО (rule 40 hrupkie #11):
- НЕ ТРОГАТЬ correctness checking в handleAnswer — это single source of truth.
- Карточки (TrueOrFalseCard, BuildFormulaCard, SituationCard) НЕ меняем — они возвращают raw answer.
- framer-motion ЗАПРЕЩЁН → tailwindcss-animate (animate-in zoom-in-110 duration-200 с key={combo}).

Acceptance Criteria:
- AC-5: combo pill появляется при 2+ правильных подряд, исчезает при ошибке.

Validation: npm run lint && npm run build + ручной прогон раунда.

В конце: changed files, summary, validation, self-check.
```

### Промпт для TASK-3 (Claude Code)

```
Твоя роль: senior product-minded full-stack engineer в SokratAI.

Прочитай: CLAUDE.md, .claude/rules/80-cross-browser.md, .claude/rules/90-design-system.md, .claude/rules/performance.md, docs/delivery/features/trainer-gamification/spec.md §5.6, §6.

Задача: TASK-3 — landing widget из 3 gamification-карточек на TrainerPage.

Создать:
- src/components/homework/formula-round/gamification/StreakCard.tsx
- src/components/homework/formula-round/gamification/XpCard.tsx
- src/components/homework/formula-round/gamification/BestScoreCard.tsx
- src/components/homework/formula-round/gamification/icons/{Flame,Zap,Trophy}Icon.tsx (custom inline SVG, 32×32, currentColor fill)

Модифицировать:
- src/pages/TrainerPage.tsx — рендер 3 карточек СВЕРХУ над разделами

StreakCard: FlameIcon orange (text-socrat-accent), currentStreak bold, plural через pluralDays().
XpCard: ZapIcon green (text-accent), totalXp, daily goal progress bar (bg-accent/20 + bg-accent fill).
BestScoreCard: TrophyIcon green, native select (text-base 16px!), XP или «—».

Layout:
- Desktop: grid-cols-3 gap-4
- Mobile: flex overflow-x-auto touch-pan-x snap-x snap-mandatory + card min-w-[240px] snap-start

ЗАПРЕЩЕНО:
- Emoji в UI (90-design-system)
- framer-motion (performance.md)
- Hard-coded hex (use bg-accent / text-socrat-accent tokens)
- font-size < 16px на <select> (iOS auto-zoom, 80-cross-browser)

Все 3 card → React.memo. Стиль карточек: bg-white border border-slate-200 rounded-lg p-4.

AC: AC-2, AC-8.

Validation: npm run lint && npm run build + Chrome + iOS Safari (snap scroll, no autozoom).

В конце: changed files, summary, validation, self-check vs spec §5.6 и 90-design-system anti-patterns.
```

### Промпт для TASK-4 (Claude Code)

```
Твоя роль: senior product-minded full-stack engineer в SokratAI.

Прочитай: CLAUDE.md, .claude/rules/40-homework-system.md (секция «Formula Rounds», TASK-3 screens migration), .claude/rules/90-design-system.md, docs/delivery/features/trainer-gamification/spec.md §5.8.

Задача: TASK-4 — переделать RoundResultScreen: XpBreakdown + 3 CTAs.

Создать:
- src/components/homework/formula-round/XpBreakdown.tsx — pure presentational, показывает lines XP (base, accuracy, combo, perfect, newBest, итого; retry-мультипликатор отдельной строкой)

Модифицировать:
- src/components/homework/formula-round/RoundResultScreen.tsx — новые props { appliedOutcome, onReplaySame, onRetryWrong, onExit }

CTAs:
- «Пройти ещё раз» — primary bg-accent text-white, всегда, onReplaySame
- «Повторить ошибки» — secondary bg-white border, только если weakFormulas.length>0, onRetryWrong
- «Назад» — ghost text-slate-500, onExit

Все CTAs: min-h-[44px], touch-action: manipulation, text-base.

Breaking signature: RoundResultScreen signature changes. Единственный caller — TrainerPage (wire-up в TASK-5). При необходимости стаббни caller в этой задаче временно типизированной ошибкой, чтобы билд был зелёным; TASK-5 закроет.

ЗАПРЕЩЕНО:
- Вложенные Card внутри Card (90-design-system anti-pattern #2)
- Emoji
- framer-motion

AC: AC-1, AC-6, AC-7 (вместе с TASK-5).

Validation: npm run lint && npm run build. Полный ручной прогон — после TASK-5.

В конце: changed files, summary, validation, self-check.
```

### Промпт для TASK-5 (Claude Code)

```
Твоя роль: senior product-minded full-stack engineer в SokratAI.

Прочитай: CLAUDE.md, docs/delivery/features/trainer-gamification/spec.md §5.5, §5.9, tasks.md TASK-5.

Задача: TASK-5 — wire-up в TrainerPage: сохранять snapshot вопросов, вызывать applyRoundResult, fire 5 telemetry events.

Модифицировать:
- src/pages/TrainerPage.tsx

Требования:
1. useRef<FormulaQuestion[] | null>(null) для last questions
2. State: appliedOutcome, isRetryMode
3. handleRoundComplete(result) → applyRoundResult(store) → setAppliedOutcome + fire events:
   - trainer_round_completed (всегда)
   - trainer_streak_incremented (если outcome.streakGained)
   - trainer_daily_goal_reached (если outcome.isDailyGoalReached)
   - trainer_new_best (если outcome.isNewBest)
   - trainer_streak_broken fires ВНУТРИ applyRoundResult (не дублировать)
4. handleReplaySame — isRetryMode=false, те же questions
5. handleRetryWrong — isRetryMode=true, questions из weakFormulas
6. handleExit — reset state, return to landing

Guardrails:
- Telemetry payloads БЕЗ PII, БЕЗ task_text
- Не дублировать fire событий (streak_broken уже в store)

AC: AC-1, AC-3, AC-4, AC-7, AC-8.

Validation: npm run lint && npm run build && npm run smoke-check + ручная проверка 5 events в console (filter `[trainer-telemetry]`).

В конце: changed files, summary, validation, self-check vs spec §5.5.
```

### Промпт для TASK-6 (Claude Code, P1)

```
Твоя роль: senior product-minded full-stack engineer в SokratAI.

Прочитай: CLAUDE.md, .claude/rules/40-homework-system.md (TaskStepper celebration pattern), .claude/rules/performance.md, docs/delivery/features/trainer-gamification/spec.md §5.8 (Celebrate SVG).

Задача: TASK-6 (P1) — Celebrate SVG overlay с 3 variants.

Создать:
- src/components/homework/formula-round/Celebrate.tsx

Модифицировать:
- src/components/homework/formula-round/RoundResultScreen.tsx — рендер <Celebrate variant=... /> при mount с priority logic

Variants:
- 'new-best': gold confetti burst (12 лучей), text-accent, «Новый рекорд!»
- 'perfect': green star pulse+glow, text-accent, «Идеальный раунд!»
- 'goal': orange flame bounce, text-socrat-accent, «Цель дня выполнена!»

Priority: new-best > perfect > goal. ОДИН overlay max.

Реализация:
- Fixed overlay (fixed inset-0 pointer-events-none z-50)
- setTimeout 1200ms auto-dismiss + cleanup в useEffect return
- CSS @keyframes inline или tailwindcss-animate utilities
- will-change: transform (не all)
- React.memo

ЗАПРЕЩЕНО:
- framer-motion
- State update after unmount (обязательный cleanup)

AC: AC-9.

Validation: npm run lint && npm run build + прогон: сыграть раунд с new best → confetti 1200ms → исчезло + React DevTools Profiler без warnings.

В конце: changed files, summary, validation, self-check vs TaskStepper celebration pattern.
```

### Промпт для TASK-7 (Claude Code, P1)

```
Твоя роль: senior product-minded full-stack engineer в SokratAI.

Задача: TASK-7 (P1) — polish.

1. StreakCard: применить pluralDays() из src/lib/trainerGamification/pluralize.ts (если не применён в TASK-3).
2. XpCard: daily goal progress bar (если не сделан в TASK-3).
3. TrainerPage footer: text-xs text-slate-400 text-center mt-8 «Прогресс сохраняется в браузере. При смене устройства серия может сброситься.»

AC: AC-10.

Validation: npm run lint && npm run build + визуал 1/2/5/21/25 streak.

В конце: changed files, summary, validation.
```

### Промпт для TASK-8 (Claude Code self-QA → Codex review)

**Self-QA (Claude Code):**
```
Прогнать QA chain из spec §9:
1. Chrome desktop — полный flow, 2 раунда, XP breakdown, CTAs, Celebrate
2. iOS Safari реальное устройство / Simulator — snap scroll, нет autozoom, нет 300ms tap delay
3. DevTools → Local Storage → key `sokrat-trainer-gamification-v1`, version: 1
4. Смена даты устройства +1 день → streak +1; +3 дня → streak reset to 1 + trainer_streak_broken fires
5. Retry-режим → XP *0.5, best не обновляется
6. «Пройти ещё раз» → тот же набор (сравнить ids первых вопросов)
7. Console filter `[trainer-telemetry]` — 5 events fire корректно
8. Lighthouse Performance >=85 на /trainer

Если баг — фикс + re-run. В конце отчёт в tasks.md как comment под TASK-8.
```

**Review (Codex, чистая сессия):**
```
Ты — независимый ревьюер SokratAI. Контекст первого агента тебе недоступен.

ПОРЯДОК (строго):
1. Прочитай docs/discovery/product/tutor-ai-agents/14-ajtbd-product-prd-sokrat.md
2. Прочитай docs/discovery/product/tutor-ai-agents/16-ux-principles-for-tutor-product-sokrat.md и 17
3. Прочитай docs/delivery/features/trainer-gamification/prd.md и spec.md
4. Прочитай .claude/rules/80-cross-browser.md, 90-design-system.md, performance.md, 40-homework-system.md
5. Посмотри git diff

ВОПРОСЫ:
- Job alignment? (P1 funnel, не ломает wedge)
- UX drift? (не превращается ли /trainer в игру а-ля Duolingo вопреки тону «серьёзный помощник»)
- Scope creep? (не добавлено ли hearts/leaderboard/achievements)
- AC-1..AC-11 выполнены?
- Нет framer-motion, emoji, hard-coded hex
- iOS Safari совместимость (text-base на select, touch-pan-x, no border-collapse на таблицах если есть)
- Корректность checking в FormulaRoundScreen.handleAnswer НЕ тронута (rule 40 #11)
- localStorage ключ ровно `sokrat-trainer-gamification-v1`, version 1

ФОРМАТ: PASS / CONDITIONAL PASS (с списком фиксов) / FAIL (с root cause).
```
