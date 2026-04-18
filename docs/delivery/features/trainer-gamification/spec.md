# Spec: Trainer Gamification — Phase 1 (MVP)

**Pipeline step:** 4 (SPEC)
**Phase:** 1 of 2 (Phase 2 — backend миграция, отдельная spec после feedback)
**Effort:** M (≈1 день фокусной работы)
**Related:** `prd.md`

---

## Section 0: Job Context

- **Core Job:** P1 — Top-of-funnel / привлечение учеников через `/trainer`.
- **Sub-jobs:** дать reason-to-return школьнику ЕГЭ/ОГЭ; дать репетитору демо-артефакт для sharing.
- **Segment:** B2C, школьники 9–11 класс, mobile-first (iPhone/Android Safari/Chrome).
- **Wedge alignment:** Питает wedge через funnel, не меняет его.
- **Pilot impact:** Не блокирует пилот. При future login мигрируем state в БД (Phase 2).

---

## 1. Summary

Добавить Duolingo-style геймификацию в standalone `/trainer`: streak, XP, in-round combo, best score by section, daily goal 2 раунда. Всё на клиенте через Zustand + localStorage. Никаких backend-изменений, никаких новых таблиц в Phase 1.

---

## 2. Problem

См. `prd.md` §2. TL;DR: нулевое удержание между сессиями, нет emotional feedback loop.

---

## 3. Solution — in/out scope

### IN (Phase 1)
- Gamification state в localStorage (`sokrat-trainer-gamification-v1`)
- Landing widget (3 карточки) в `TrainerPage`
- In-round combo indicator в `FormulaRoundScreen`
- XP расчёт + celebrate animations на `RoundResultScreen`
- Two CTAs: «Пройти ещё раз» (same questions set) + «Повторить ошибки» (existing)
- `console.info` telemetry events

### OUT
- Backend persistence, auth, leaderboard, achievements, sounds, haptics, push, streak freeze.
- Изменения в `trainer-submit` edge function и таблицах `formula_round_results` / `formula_rounds`.

---

## 4. User Stories

См. `prd.md` §5 (US-1..US-6).

---

## 5. Technical Design

### 5.1 Структура файлов

```
src/
  stores/
    trainerGamificationStore.ts          # NEW — Zustand + persist middleware
  lib/
    trainerGamification/
      xpCalculator.ts                     # NEW — pure functions
      dateKey.ts                          # NEW — local-time YYYY-MM-DD
      telemetry.ts                        # NEW — console.info wrappers
  components/
    homework/
      formula-round/
        FormulaRoundScreen.tsx            # MODIFY — ComboIndicator, combo tracking
        RoundResultScreen.tsx             # MODIFY — XP breakdown, celebrate, CTAs
        ComboIndicator.tsx                # NEW — live in-round combo pill
        XpBreakdown.tsx                   # NEW — result-screen XP lines
        Celebrate.tsx                     # NEW — lottie-like SVG overlay (3 variants)
        gamification/
          StreakCard.tsx                  # NEW — landing card
          XpCard.tsx                      # NEW — landing card
          BestScoreCard.tsx               # NEW — landing card (per-section)
          icons/
            FlameIcon.tsx                 # NEW — custom SVG
            ZapIcon.tsx                   # NEW — custom SVG
            TrophyIcon.tsx                # NEW — custom SVG
  pages/
    TrainerPage.tsx                       # MODIFY — render 3 gamification cards, pass result
```

### 5.2 Gamification Store (Zustand + persist)

```ts
// src/stores/trainerGamificationStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SectionKey =
  | 'all'
  | 'kinematics'
  | 'dynamics'
  | 'conservation'
  | 'statics'
  | 'hydrostatics';

export interface TrainerGamificationState {
  totalXp: number;
  currentStreak: number;
  longestStreak: number;
  lastPlayedDate: string | null;            // 'YYYY-MM-DD' local time
  dailyRoundsCount: number;                 // resets on day change
  dailyDate: string | null;                 // 'YYYY-MM-DD' attached to dailyRoundsCount
  bestScoreBySection: Partial<Record<SectionKey, number>>;  // XP
  bestCombo: number;
  version: 1;
}

export interface RoundOutcome {
  section: SectionKey;
  correctCount: number;
  totalCount: number;
  bestComboInRound: number;
  isRetryMode: boolean;                     // «Повторить ошибки» = true
}

export interface AppliedOutcome {
  xpEarned: number;                         // уже с multiplier
  xpBreakdown: {
    base: number;
    accuracy: number;
    combo: number;
    perfect: number;
    newBest: number;
    retryMultiplier: number;                // 1.0 или 0.5
  };
  isNewBest: boolean;
  isPerfectRound: boolean;
  isDailyGoalReached: boolean;              // сразу после этого раунда
  dailyRoundsCount: number;
  streakAfter: number;
  streakGained: boolean;                    // +1 к streak сегодня?
}

interface Actions {
  applyRoundResult: (outcome: RoundOutcome) => AppliedOutcome;
  reset: () => void;                        // dev-only
}
```

**persist config:**
- `name: 'sokrat-trainer-gamification-v1'`
- `partialize`: сохраняем всё кроме `_hydrated` флагов
- `version: 1`, `migrate` — заготовка под будущие версии

### 5.3 XP Calculator (pure)

```ts
// src/lib/trainerGamification/xpCalculator.ts
export const XP_BASE = 10;
export const XP_ACCURACY_MAX = 20;
export const XP_COMBO_MULTIPLIER = 2;
export const XP_COMBO_CAP = 20;
export const XP_PERFECT_ROUND = 30;
export const XP_NEW_BEST = 20;
export const RETRY_MULTIPLIER = 0.5;
export const DAILY_GOAL_ROUNDS = 2;

export function computeRoundXp(params: {
  correctCount: number;
  totalCount: number;
  bestComboInRound: number;
  isNewBest: boolean;
  isRetry: boolean;
}): { total: number; breakdown: {...} } { ... }
```

**Formula (подтверждённая в PRD):**
```
base        = 10
accuracy    = round((correctCount / totalCount) * 20)
combo       = min(bestComboInRound * 2, 20)
perfect     = (correctCount === totalCount) ? 30 : 0
newBest     = isNewBest ? 20 : 0

subtotal    = base + accuracy + combo + perfect + newBest
multiplier  = isRetry ? 0.5 : 1.0
total       = floor(subtotal * multiplier)
```

**Retry rule:** в retry-mode `isNewBest` принудительно `false` (не обновляем best_score_by_section, даже если набрали больше).

### 5.4 Date key (local time)

```ts
// src/lib/trainerGamification/dateKey.ts
export function todayLocalKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function daysBetween(a: string, b: string): number {
  // разница в календарных днях, использует Date.UTC(y,m,d)
}
```

**Rules:**
- Streak +1 если `lastPlayedDate === yesterday` И `dailyRoundsCount transitioned from 0 → 1` сегодня.
- Streak = 1 (reset to 1) если `lastPlayedDate < yesterday`.
- Streak не меняется если играют ещё раунды в тот же день.
- `dailyRoundsCount` сбрасывается в 0 + `dailyDate = today` при первом раунде нового дня.

### 5.5 Telemetry

```ts
// src/lib/trainerGamification/telemetry.ts
export function trackTrainerEvent(event: string, payload: Record<string, unknown>): void {
  try {
    console.info(`[trainer-telemetry] ${JSON.stringify({ event, ...payload, ts: Date.now() })}`);
  } catch { /* noop */ }
}
```

**Events to fire:**
- `trainer_round_completed` — `{ section, accuracy, bestCombo, xpEarned, isNewBest, isRetry }`
- `trainer_streak_incremented` — `{ streakBefore, streakAfter, dailyRounds }`
- `trainer_streak_broken` — `{ streakLost, daysSinceLastPlay }` — fires when streak resets to 1
- `trainer_daily_goal_reached` — `{ streak, totalXp }`
- `trainer_new_best` — `{ section, oldBest, newBest }`

### 5.6 UI: Landing widget (TrainerPage)

**Место:** сверху landing, **над** текущим выбором раздела. 3 горизонтальные карточки в grid на desktop, горизонтальный scroll-row на mobile (`overflow-x-auto touch-pan-x`).

**StreakCard:**
- `FlameIcon` (orange `#E8913A`) 32×32
- Число `currentStreak` крупно (`text-3xl font-bold`)
- Label «день подряд» / «дня подряд» / «дней подряд» (правильная форма)
- Если `currentStreak === 0` и `lastPlayedDate !== null` → приглушённый цвет + hint «сыграй раунд, чтобы начать»
- `bg-white border border-slate-200 rounded-lg p-4`, **не** `animate-*`

**XpCard:**
- `ZapIcon` (`text-accent`) 32×32
- `totalXp` крупно, `tabular-nums`
- Label «XP»
- Мелкий подтекст: `Цель дня: {dailyRoundsCount}/{DAILY_GOAL_ROUNDS}` + progress bar (`bg-accent/20` track, `bg-accent` fill)

**BestScoreCard:**
- `TrophyIcon` (`text-accent`) 32×32
- Selector (select native, `text-base` 16px для iOS): «Кинематика» / «Динамика» / …
- Число XP рекорда + подпись «лучший раунд»
- Пусто (`—`) если нет записи по разделу

### 5.7 UI: ComboIndicator (in-round)

Рендерится в `FormulaRoundScreen` справа вверху рядом с `RoundProgress`.

- Показывается только при `currentCombo >= 2` (до этого скрыт).
- Лейбл `combo × N` в pill `bg-accent text-white rounded-full px-3 py-1`.
- При increment — CSS keyframe `animate-in zoom-in-110 duration-200`, потом settles на `scale-100`.
- Break (неправильный ответ) — 300ms shake `animate-in shake` + исчезает.
- **React.memo**, чтобы не ре-рендерилось на каждый тик вопроса.

### 5.8 UI: XpBreakdown + Celebrate (RoundResultScreen)

**XpBreakdown** (под существующим summary блоком):
```
Базовый XP             +10
Точность 75%           +15
Combo × 4              +8
Идеальный раунд        +30  [если применимо]
Новый рекорд!          +20  [если применимо]
──────────────────────────
Итого                  +83
```
Если `isRetry` — внизу serif-light строка «Повтор ошибок: ×0.5 → 41 XP».

**Celebrate SVG overlay:**
- Компонент `<Celebrate variant={'new-best' | 'perfect' | 'goal'} />`.
- Фиксированный overlay, 1200ms total, auto-dismiss через `setTimeout` + ref cleanup (как в `TaskStepper` celebration).
- Приоритет переменных: `new-best` > `perfect` > `goal`. Показываем ОДИН overlay (самый «ценный»).
- Variant визуал:
  - `new-best`: золотой confetti-burst SVG, текст «Новый рекорд!» (`text-accent`)
  - `perfect`: зелёная звезда pulse, «Идеальный раунд!» (`text-accent`)
  - `goal`: orange flame bounce, «Цель дня выполнена!» (`text-socrat-accent`)
- **CSS-only** keyframes (`@keyframes` в компоненте или через `tailwindcss-animate` `animate-in`). No framer-motion (forbidden per `performance.md`).

**CTAs на RoundResultScreen:**
- **«Пройти ещё раз»** — primary `bg-accent text-white`. Генерирует **тот же набор `FormulaQuestion[]`** (сохранён в `TrainerPage` ref перед стартом) → `isRetryMode = false` (это rematch, не retry ошибок).
- **«Повторить ошибки»** — secondary `bg-white border-slate-200`. Показывается только если `weakFormulas.length > 0`. `isRetryMode = true` → XP ×0.5.
- **«Назад»** — ghost `text-slate-500`.

### 5.9 Интеграция в существующий код

**TrainerPage.tsx:**
- Хранить `lastQuestions: FormulaQuestion[] | null` в ref для «Пройти ещё раз».
- При переходе `landing → round` → snapshot questions.
- `onExit` из `FormulaRoundScreen` → возврат на landing (ничего нового).
- `onComplete(result)` → `gamificationStore.applyRoundResult({ section, correctCount, totalCount, bestComboInRound: result.maxCombo, isRetryMode })` → сохраняем `appliedOutcome` в state → рендерим `RoundResultScreen` с этим outcome.

**FormulaRoundScreen.tsx:**
- Добавить `currentCombo: number` и `maxComboInRound: number` в локальный state.
- В `handleAnswer`:
  - Correct → `currentCombo += 1`; `maxComboInRound = max(maxComboInRound, currentCombo)`.
  - Incorrect → `currentCombo = 0`.
- Добавить в `RoundResult` тип поле `maxCombo: number` (additive).
- `buildResult` включает `maxCombo`.

**RoundResult type extension** (в `src/lib/formulaEngine/types.ts`):
```ts
export interface RoundResult {
  // existing
  durationMs: number;
  durationSeconds: number;
  // NEW (additive)
  maxCombo: number;
}
```

### 5.10 Сложные форматы строк

Русская форма «день/дня/дней»:
```ts
// src/lib/trainerGamification/pluralize.ts
export function pluralDays(n: number): string {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if ([2,3,4].includes(mod10) && ![12,13,14].includes(mod100)) return 'дня';
  return 'дней';
}
```

---

## 6. UX & UI Patterns (docs 16, 17, 90-design-system)

- Emoji ❌ в UI chrome — custom SVG only.
- Цвета:
  - `bg-accent` (socrat green) — primary CTA, XP card, combo pill
  - `text-socrat-accent` (orange `#E8913A`) — streak flame only
  - `bg-slate-50` page bg, `border-slate-200`, `rounded-lg`
- Mobile-first: tap targets ≥ 44×44px, `touch-action: manipulation` на CTA.
- iOS Safari: все `<select>` / `<input>` → `text-base` (16px), anti-autozoom.
- Animations: tailwindcss-animate only (`animate-in fade-in zoom-in-*`, `duration-*`). **framer-motion forbidden** (`.claude/rules/performance.md`).
- List cards (`StreakCard`, `XpCard`, `BestScoreCard`) — `React.memo`, `animate={false}` if they land inside `Card` grid (rule 10).
- `overflow-x-auto touch-pan-x` на mobile-scroll карточек (`.claude/rules/80-cross-browser.md`).

---

## 7. Requirements — P0 / P1

### P0 (Must-Have — ship day 1)
- **P0-1** `trainerGamificationStore` с persist + версионированием (`version: 1`).
- **P0-2** XP calculation согласно формуле в `xpCalculator.ts`, pure unit-testable.
- **P0-3** Landing widget с 3 карточками на `TrainerPage`.
- **P0-4** In-round `ComboIndicator` + `maxCombo` tracking в `FormulaRoundScreen`.
- **P0-5** `XpBreakdown` + CTAs `Пройти ещё раз` / `Повторить ошибки` / `Назад` на `RoundResultScreen`.
- **P0-6** Streak update логика (daily goal, day rollover, break/reset).
- **P0-7** `new_best` detection + update `bestScoreBySection` (только если `!isRetry`).
- **P0-8** Telemetry events (5 штук) через `console.info`.

### P1 (Nice-to-Have — day 2)
- **P1-1** `Celebrate` SVG overlay (3 variants) с CSS-only анимацией.
- **P1-2** Plural correctness «день/дня/дней».
- **P1-3** Daily goal progress bar на `XpCard`.
- **P1-4** Footer disclaimer «Прогресс сохраняется в браузере».

---

## 8. Acceptance Criteria (testable)

### P0

- **AC-1** После игры 1 раунда в `all` разделе с 8/10 правильных и max combo 5, не-retry: `totalXp += 10 + 16 + 10 + 0 + (newBest?20:0)` = 36 (или 56 если new best). Проверяется через `console.info` event `trainer_round_completed` + DevTools Application → Local Storage → ключ `sokrat-trainer-gamification-v1`.
- **AC-2** Вернувшись на landing после раунда, видны 3 карточки: Streak (1), XP (>0), BestScore с правильным числом по сыгранному разделу.
- **AC-3** Второй раунд в тот же день → `dailyRoundsCount = 2`, `Celebrate variant='goal'` показан, `trainer_daily_goal_reached` fired. `currentStreak` НЕ увеличился относительно первого раунда (streak даёт только первый раунд дня).
- **AC-4** Смена даты устройства на +2 дня вперёд → новый раунд → `currentStreak = 1` (reset), event `trainer_streak_broken` fired с `daysSinceLastPlay = 2`.
- **AC-5** Во время раунда при 2+ правильных подряд сверху справа появляется pill «combo × N» с zoom-in анимацией. Ошибка → pill исчезает с shake. `FormulaRoundScreen` не теряет корректности проверки ответов (invariant из rule 40).
- **AC-6** Retry-mode («Повторить ошибки»): XP итог `= floor(subtotal * 0.5)`, `bestScoreBySection[section]` НЕ обновляется даже при XP > previous best. Событие `trainer_round_completed` имеет `isRetry: true`.
- **AC-7** `Пройти ещё раз` CTA запускает новый `FormulaRoundScreen` с тем же `FormulaQuestion[]` (сравнить `id` токенов/формул). `isRetryMode = false`, XP без ×0.5 multiplier.
- **AC-8** localStorage корректно читается между перезагрузками: закрыть вкладку, открыть → все 3 карточки показывают сохранённое состояние.

### P1

- **AC-9** `Celebrate` overlay рендерится ровно на 1200ms, не ломает следующий раунд, не утекает (проверить через React DevTools Profiler / отсутствие warnings о state update after unmount).
- **AC-10** Plural: 1 → «день», 2 → «дня», 5 → «дней», 21 → «день», 25 → «дней».
- **AC-11** iOS Safari (Simulator или реальное устройство): combo pill не вызывает auto-zoom, landing scroll на mobile работает с touch-pan-x, нет 300ms tap delay на CTA.

---

## 9. Validation

```bash
npm run lint
npm run build
npm run smoke-check
```

**Ручная QA chain (обязательна перед мержем):**
1. Chrome desktop: 1-й раунд → видишь combo → result screen → XP breakdown корректен → «Пройти ещё раз» запускает тот же набор → после 2-го раунда видишь `Celebrate goal`.
2. Safari iOS (реальный iPhone): landing scroll работает, карточки не ломают layout, `<select>` в BestScoreCard не зумится.
3. DevTools → Application → Local Storage: проверить структуру `sokrat-trainer-gamification-v1`, version: 1.
4. Смена даты устройства на +1 день вперёд → сыграть раунд → `currentStreak = 2` (был 1).
5. Console filter `[trainer-telemetry]` → все 5 событий fire корректно.

---

## 10. Risks

См. `prd.md` §8. Ключевые для Spec:
- **R-4 (performance):** Celebrate overlay на слабых Android. Митигация: CSS-only keyframes, `will-change: transform`, `React.memo`, `setTimeout` cleanup.
- **R-3 (design drift):** Любое новое UI reviewer прогоняет через `90-design-system.md` anti-patterns checklist.

---

## 11. Implementation Tasks (краткий план)

Детали — в `tasks.md` (следующий шаг pipeline).

- **TASK-1:** Stores + pure libs (`trainerGamificationStore`, `xpCalculator`, `dateKey`, `telemetry`, `pluralize`). Unit-testable, без UI. Blocking для остального.
- **TASK-2:** `RoundResult.maxCombo` + combo tracking в `FormulaRoundScreen` + `ComboIndicator`.
- **TASK-3:** Landing widget: `StreakCard` / `XpCard` / `BestScoreCard` + custom SVG иконки + интеграция в `TrainerPage`.
- **TASK-4:** `RoundResultScreen` — `XpBreakdown`, два CTAs, snapshot-questions для «Пройти ещё раз».
- **TASK-5:** `applyRoundResult` wire-up в `TrainerPage.onComplete` + все telemetry events.
- **TASK-6 (P1):** `Celebrate` компонент + 3 variants + priority logic (`new-best > perfect > goal`).
- **TASK-7 (P1):** Plural + daily goal progress bar + footer disclaimer.
- **TASK-8:** QA chain + smoke fixes + Safari iOS проверка.

---

## Parking Lot

- Streak freeze (2 free/week) — revisit если `streak_day_3_retention < 10%`.
- Weekly XP leaderboard (среди учеников одного репетитора) — Phase 3 (после auth).
- Daily challenge («сегодня: динамика 10 вопросов») — revisit если `daily_goal_completion_rate < 30%`.
- Tutor-facing dashboard «мои ученики: Алина streak 7» — Phase 3.
- Share-картинка «Я набрал 450 XP» для TG/ВК — revisit с auth + профилем.
- Анти-фарм: cooldown на `new_best` (раз в час по разделу) — revisit если увидим абуз.
- Haptics (`navigator.vibrate`) на combo break / new best — Phase 2.
- Sound toggle + 3 звука (combo, perfect, goal) — Phase 2.
- Push-напоминания «не потеряй streak» через существующую VAPID-инфру — Phase 2 (после auth).
- Streak recovery flow («последний раз играл 2 дня назад — начни заново!») — Phase 2.
