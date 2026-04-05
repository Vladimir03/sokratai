# Tasks: Тренажёр формул — Phase 1a

**Spec:** `docs/delivery/features/formula-rounds/spec.md`
**PRD:** `docs/delivery/features/formula-rounds/prd.md`
**Дата:** 2026-04-05

---

## Порядок выполнения

```
TASK-1 (DB migration)
    │
    ├── TASK-2 (Formula engine — types + formulas data) ──┐
    │                                                      │
    │   TASK-3 (Formula engine — question generator) ◄─────┘
    │       │
    │       ├── TASK-4 (Student UI — round screen + progress) ◄── TASK-5 (TrueOrFalseCard)
    │       │                                                 ◄── TASK-6 (BuildFormulaCard)
    │       │                                                 ◄── TASK-7 (SituationCard)
    │       │                                                 ◄── TASK-8 (FeedbackOverlay)
    │       │
    │       └── TASK-9 (Result screen + retry)
    │
    └── TASK-10 (API endpoint + hooks + route wiring)

TASK-11 (Seed script)  — параллельно, после TASK-1

TASK-12 (Codex review)  — после всех задач
```

TASK-1 → TASK-2 → TASK-3 — строго последовательно.
TASK-5, 6, 7, 8 — параллельно друг другу (после TASK-4).
TASK-10 и TASK-11 — параллельно основному потоку (после TASK-1).

---

## TASK-1: DB migration — formula_rounds + formula_round_results

**Status**: completed (2026-04-05)

**Job**: S1-2, R4-1
**Agent**: Claude Code
**Files**: `supabase/migrations/20260406_formula_rounds.sql`
**AC**: AC-7 (результат сохраняется в formula_round_results)

**Что делать:**
- Создать migration с двумя таблицами: `formula_rounds`, `formula_round_results`
- RLS policies: student read rounds, student insert/read results, tutor read results
- Indexes на `(round_id, student_id)`
- Схема точно по SPEC секция "Data Model"

---

## TASK-2: Formula engine — types + formulas data

**Status**: completed (2026-04-05)

**Job**: S1-2
**Agent**: Claude Code
**Files**: `src/lib/formulaEngine/types.ts`, `src/lib/formulaEngine/formulas.ts`
**AC**: AC-2 (10 заданий из 12 формул кинематики)

**Что делать:**
- Создать `types.ts` с интерфейсами: `Formula`, `FormulaQuestion`, `QuestionType`, `Layer`, `RoundConfig`, `RoundResult`, `AnswerRecord`, `WeakFormula`
- Создать `formulas.ts` с 12 формулами кинематики из `docs/mechanics-formulas.json` (только секция "Кинематика")
- Export: `kinematicsFormulas`, `getFormulaById()`, `getRelatedFormulas()`

---

## TASK-3: Formula engine — question generator

**Status**: completed (2026-04-05)

**Job**: S1-2, S1-4
**Agent**: Claude Code
**Files**: `src/lib/formulaEngine/questionGenerator.ts`, `src/lib/formulaEngine/index.ts`
**AC**: AC-2, AC-3, AC-4

**Что делать:**
- `generateRound(config)` → 10 заданий: 3-4 true_or_false + 3-4 build_formula + 2-3 situation_to_formula
- Mutation engine для true_or_false: `swap_fraction`, `drop_coefficient`, `wrong_power`, `swap_variable` (GDD §4.1)
- Distractor picker для situation_to_formula: из `relatedFormulas` + `sameSection` (GDD §6.4)
- Build formula: правильные переменные + 2-3 лишних из relatedFormulas
- `generateFeedback(question, isCorrect)` — текст объяснения по layer (GDD §7)
- `generateRetryRound(weakFormulas)` — round только из формул с ошибками
- Export public API через `index.ts`

---

## TASK-4: Student UI — FormulaRoundScreen + RoundProgress

**Status**: completed (2026-04-05)

**Job**: S2-4
**Agent**: Claude Code
**Files**: `src/components/homework/formula-round/FormulaRoundScreen.tsx`, `src/components/homework/formula-round/RoundProgress.tsx`
**AC**: AC-1, AC-5, AC-6

**Что делать:**
- `FormulaRoundScreen` — fullscreen container: загружает round config, вызывает `generateRound()`, управляет state (currentQuestion, lives, score, answers[])
- `RoundProgress` — progress bar (N/10) + hearts (жизни)
- State machine: `playing` → `feedback` → `next` → `result`
- При потере 3 жизней → result screen (AC-5)
- При 10 ответах → result screen (AC-6)
- Стиль: следовать doc 17 UI patterns Сократа

**Design sources:**
- GDD §2.2 (анатомия раунда), §2.3 (экран после раунда)
- Doc 17 (UI patterns Сократа) — палитра, компоненты, layout rules

---

## TASK-5: TrueOrFalseCard — Layer 3

**Job**: S1-4
**Agent**: Claude Code
**Files**: `src/components/homework/formula-round/TrueOrFalseCard.tsx`
**AC**: AC-3, AC-4

**Что делать:**
- Показывает формулу (через `<MathText>` из `src/components/kb/ui/MathText.tsx`)
- Две кнопки: «Верно» / «Неверно»
- При ответе → callback `onAnswer(correct: boolean)`
- Формула может быть мутированной (из mutation engine)

**Design sources:** GDD §4.1

---

## TASK-6: BuildFormulaCard — Layer 2

**Job**: S1-2
**Agent**: Claude Code
**Files**: `src/components/homework/formula-round/BuildFormulaCard.tsx`
**AC**: AC-3, AC-4

**Что делать:**
- Показывает имя формулы + набор "кубиков" (переменных): правильные + лишние
- Tap-to-select: ученик выбирает элементы в числитель и знаменатель
- Кнопка «Проверить» → сравнение с правильной формулой
- Рендеринг собранной формулы через `<MathText>`

**Design sources:** GDD §4.5. Mobile: tap-to-select (не drag-and-drop).

---

## TASK-7: SituationCard — Layer 1

**Job**: S1-2
**Agent**: Claude Code
**Files**: `src/components/homework/formula-round/SituationCard.tsx`
**AC**: AC-3, AC-4

**Что делать:**
- Текст ситуации из `whenToUse` (без чисел — только навигация)
- 4 варианта ответа: правильная формула + 3 дистрактора (рендер через `<MathText>`)
- Tap на вариант → callback `onAnswer(selectedFormulaId)`

**Design sources:** GDD §4.8

---

## TASK-8: FeedbackOverlay — объяснение после ответа

**Job**: S1-4
**Agent**: Claude Code
**Files**: `src/components/homework/formula-round/FeedbackOverlay.tsx`
**AC**: AC-3 (зелёный feedback ≤2 строки), AC-4 (красный feedback 2-4 строки)

**Что делать:**
- Overlay поверх карточки после ответа
- Правильно: зелёный фон, короткое объяснение (physicalMeaning)
- Неправильно: красный фон, развёрнутое объяснение (по layer — GDD §7.2)
- Показ жизни -1 при ошибке
- Кнопка «Далее →» (secondary)

**Design sources:** GDD §7.1, §7.2

---

## TASK-9: RoundResultScreen + retry

**Job**: S2-4
**Agent**: Claude Code
**Files**: `src/components/homework/formula-round/RoundResultScreen.tsx`
**AC**: AC-5, AC-6, AC-8

**Что делать:**
- Score: N/10, % правильных
- Оставшиеся жизни
- Список проблемных формул с описанием слоя: «путает структуру» / «не собирает» / «не узнаёт в задаче»
- CTA «Повторить ошибки» → вызывает `generateRetryRound()` с weak formulas (AC-8, P1)
- CTA «Закрыть» (secondary)

**Design sources:** GDD §2.3

---

## TASK-10: API endpoint + hooks + route wiring

**Status**: completed (2026-04-05)

**Job**: S2-4
**Agent**: Claude Code
**Files**: `supabase/functions/homework-api/...`, `src/lib/formulaRoundApi.ts`, `src/hooks/useFormulaRound.ts`, `src/pages/StudentFormulaRound.tsx`, `src/App.tsx`
**AC**: AC-1, AC-7

**Что делать:**
- Edge Function endpoint: POST `/formula-rounds/:roundId/results` (save result)
- Edge Function endpoint: GET `/formula-rounds/:roundId` (get round config)
- Edge Function endpoint: GET `/formula-rounds/:roundId/results` (get student results)
- `formulaRoundApi.ts` — client functions calling Edge Functions
- `useFormulaRound.ts` — React Query hooks: `useFormulaRound(roundId)`, `useFormulaRoundResults(roundId)`, `useSaveFormulaRoundResult()`
- `StudentFormulaRound.tsx` — page component, loads round → FormulaRoundScreen
- Route: `/homework/:id/round/:roundId` в App.tsx (lazy loaded)

---

## TASK-11: Seed script

**Job**: —
**Agent**: Claude Code
**Files**: `supabase/seed/formula-round-seed.sql`
**AC**: —

**Что делать:**
- Создать test-assignment с test-tutor (отдельный от Егора)
- Создать formula_round для этого assignment (section=kinematics)
- Assign 2-3 test-students
- Вывести прямые ссылки для тестирования

---

## TASK-12: Codex review

**Job**: все
**Agent**: Codex (независимый reviewer)
**Files**: все изменённые файлы
**AC**: все AC

**Что делать:**
- Review по паттерну 4 из doc 20
- Проверить: Job alignment, UX drift, scope creep, AC выполнены
- Проверить: doc 16, doc 17 compliance
- Формат: PASS / CONDITIONAL PASS / FAIL

---

## AC → TASK mapping

| AC | Описание | Tasks |
|---|---|---|
| AC-1 | Student видит round screen с progress bar, жизнями, первым заданием | TASK-4, TASK-10 |
| AC-2 | 10 заданий: 3-4 T/F + 3-4 build + 2-3 situation, из 12 формул | TASK-2, TASK-3 |
| AC-3 | Правильный ответ: прогресс +1, зелёный feedback ≤2 строки | TASK-3, TASK-5/6/7, TASK-8 |
| AC-4 | Неправильный ответ: жизнь -1, красный feedback 2-4 строки | TASK-3, TASK-5/6/7, TASK-8 |
| AC-5 | 0 жизней → result screen с score и weak formulas | TASK-4, TASK-9 |
| AC-6 | 10 заданий → result screen | TASK-4, TASK-9 |
| AC-7 | Результат сохраняется в DB через API | TASK-1, TASK-10 |
| AC-8 (P1) | «Повторить ошибки» генерирует round из weak formulas | TASK-3, TASK-9 |
| AC-9 (P1) | KaTeX рендерит все 12 формул | TASK-5, TASK-6, TASK-7 |
| AC-10 (P1) | Median duration ≤ 5 мин | TASK-4 (UI perf) |

---

## Copy-paste промпты для агентов

### TASK-1: DB migration

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Задача: создать DB migration для тренажёра формул (formula rounds).

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ + их ученики
- wedge: быстро собрать ДЗ и новую практику по теме урока
- formula round = новый тип practice-артефакта внутри homework flow
- Phase 1a: только DB + student-facing, без tutor UI

Сначала прочитай:
1. docs/delivery/features/formula-rounds/spec.md — секция "Data Model" (точная схема таблиц)
2. supabase/migrations/20260215100000_homework_tutor_system.sql — паттерн существующих таблиц
3. supabase/migrations/20260306100000_guided_homework_threads.sql — паттерн RLS policies
4. CLAUDE.md

Создай файл: supabase/migrations/20260406_formula_rounds.sql

Содержание:
1. CREATE TABLE formula_rounds (id, assignment_id FK, section, formula_count, questions_per_round, lives, created_at, UNIQUE assignment_id)
2. CREATE TABLE formula_round_results (id, round_id FK, student_id FK auth.users, score, total, lives_remaining, completed, duration_seconds, answers JSONB, weak_formulas JSONB, played_at, UNIQUE round_id+student_id+played_at)
3. RLS policies: student_read_rounds, student_insert_results, student_read_results, tutor_read_results (через homework_tutor_assignments.tutor_id)
4. Indexes на (round_id, student_id)

Acceptance Criteria:
- AC-7: Given student completes round, When POST result, Then row appears in formula_round_results with correct score/answers/weak_formulas

Guardrails:
- НЕ трогать существующие таблицы homework_tutor_*
- НЕ создавать Edge Functions в этой задаче
- Следовать паттерну RLS из guided_homework_threads migration

В конце обязательно:
1. перечисли changed files
2. дай краткий summary
3. покажи validation: supabase db diff или migration preview
4. напиши, какие документы нужно обновить
```

### TASK-2: Formula engine — types + data

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Задача: создать типы и формульную базу для тренажёра.

Контекст:
- сегмент: ученики, готовящиеся к ЕГЭ по физике
- Job: S1-2 — выбрать правильный подход к решению (какую формулу применить)
- Phase 1a scope: только кинематика (12 формул)

Сначала прочитай:
1. docs/delivery/features/formula-rounds/spec.md — секция "Formula Engine", типы
2. docs/mechanics-formulas.json — исходные данные (12 формул кинематики)
3. docs/SokratAI_physics_game-design-document.md — §6.1 (состояние ученика), §4.1-§4.8 (типы заданий)
4. src/components/kb/ui/MathText.tsx — понять формат LaTeX строк

Создай файлы:
1. src/lib/formulaEngine/types.ts — все интерфейсы из SPEC: Formula, Variable, FormulaQuestion, QuestionType, Layer, RoundConfig, RoundResult, AnswerRecord, WeakFormula
2. src/lib/formulaEngine/formulas.ts — 12 формул кинематики, типизированных как Formula[]. Данные из mechanics-formulas.json, только секция "Кинематика" (id: kin.01 — kin.12). Включить ВСЕ поля: variables, physicalMeaning, proportionality, whenToUse, commonMistakes, relatedFormulas, difficulty
3. Export: kinematicsFormulas, getFormulaById(id), getRelatedFormulas(formulaId)

Acceptance Criteria:
- AC-2: формульная база содержит ровно 12 формул кинематики с полными метаданными
- Все LaTeX формулы из mechanics-formulas.json перенесены точно (для MathText рендеринга)

Guardrails:
- НЕ создавать questionGenerator в этой задаче (= TASK-3)
- НЕ добавлять формулы из других разделов (динамика, законы сохранения и т.д.)
- Данные хардкодом в TS, НЕ в DB

В конце обязательно:
1. перечисли changed files
2. дай краткий summary
3. validation: TypeScript компилируется, все 12 формул присутствуют
4. какие документы нужно обновить
```

### TASK-3: Formula engine — question generator

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Задача: создать генератор заданий для формульного тренажёра.

Контекст:
- Job: S1-2 (выбрать формулу), S1-4 (понять ошибку)
- Тренажёр генерирует 10 заданий из 12 формул кинематики
- Три типа: true_or_false (Layer 3), build_formula (Layer 2), situation_to_formula (Layer 1)

Сначала прочитай:
1. docs/delivery/features/formula-rounds/spec.md — секция "Formula Engine — алгоритм генерации"
2. docs/SokratAI_physics_game-design-document.md — §4.1 (Правда/ложь + мутации), §4.5 (Собери формулу), §4.8 (Ситуация→Формула), §6.2 (алгоритм выбора), §6.4 (генерация дистракторов), §7 (feedback)
3. src/lib/formulaEngine/types.ts — типы из TASK-2
4. src/lib/formulaEngine/formulas.ts — данные из TASK-2

Создай файлы:
1. src/lib/formulaEngine/questionGenerator.ts:
   - generateRound(config: RoundConfig): FormulaQuestion[]
     * Выбрать 10 формул из пула (без повторов)
     * Распределить: 3-4 true_or_false, 3-4 build_formula, 2-3 situation_to_formula
     * Перемешать порядок
   - generateTrueOrFalse(formula): FormulaQuestion
     * 50% верная, 50% мутированная
     * Мутации: swap_fraction, drop_coefficient, wrong_power, swap_variable (из commonMistakes)
   - generateBuildFormula(formula): FormulaQuestion
     * Правильные переменные + 2-3 лишних из relatedFormulas
   - generateSituationToFormula(formula, pool): FormulaQuestion
     * Текст из whenToUse[random], 4 варианта: correct + 3 дистрактора из relatedFormulas + sameSection
   - generateFeedback(question, isCorrect): string
     * Правильно: 1 строка (physicalMeaning)
     * Неправильно: 2-4 строки, зависит от layer (GDD §7.2):
       Layer 3: размерностная проверка
       Layer 2: смысловая связь
       Layer 1: триггер-подсказка
   - generateRetryRound(weakFormulas, config): FormulaQuestion[]
     * Round только из формул, в которых были ошибки

2. src/lib/formulaEngine/index.ts — public API re-export

Acceptance Criteria:
- AC-2: generateRound() returns exactly 10 questions with correct type distribution (3-4 + 3-4 + 2-3)
- AC-3: generateFeedback(q, true) returns ≤2 строки
- AC-4: generateFeedback(q, false) returns 2-4 строки
- AC-8 (P1): generateRetryRound(weakFormulas) returns round from only weak formulas

Guardrails:
- НЕ создавать React компоненты в этой задаче
- НЕ вызывать AI/LLM — вся логика детерминистическая
- Мутации должны порождать физически осмысленные ошибки (из commonMistakes), не случайный мусор
- Дистракторы всегда из relatedFormulas или sameSection, не из других разделов

В конце обязательно:
1. перечисли changed files
2. дай краткий summary
3. validation: unit tests или manual test в console — generateRound() возвращает 10 заданий правильных типов
4. какие документы нужно обновить
```

### TASK-4: Student UI — FormulaRoundScreen + RoundProgress

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Задача: создать основной экран раунда для ученика.

Контекст:
- Job: S2-4 — увидеть свой прогресс и почувствовать рост
- Round = 10 заданий, 3 жизни, 3-5 минут
- Fullscreen experience внутри homework flow

Сначала прочитай:
1. docs/delivery/features/formula-rounds/spec.md — секция "UX / UI", wireframes
2. docs/SokratAI_physics_game-design-document.md — §2.2 (анатомия раунда)
3. docs/discovery/product/tutor-ai-agents/17-ui-patterns-and-component-rules-sokrat.md — UI стиль Сократа
4. src/lib/formulaEngine/index.ts — API движка
5. src/components/kb/ui/MathText.tsx — компонент для рендеринга формул

Создай файлы:
1. src/components/homework/formula-round/FormulaRoundScreen.tsx
   - Props: roundConfig, questions (from generateRound), onComplete(result)
   - State: currentIndex, lives (init 3), score, answers[], showFeedback
   - State machine: playing → feedback (overlay) → next question → result
   - При lives=0 → вызвать onComplete с completed=false (AC-5)
   - При currentIndex=10 → вызвать onComplete с completed=true (AC-6)
   - Рендерит: RoundProgress + текущую карточку (по question.type) + FeedbackOverlay

2. src/components/homework/formula-round/RoundProgress.tsx
   - Props: current (0-9), total (10), lives (0-3)
   - Progress bar: ●●●●●○○○○○
   - Hearts: ❤️ × lives

Стиль:
- Следовать UI-паттернам doc 17: палитра Сократа, один primary CTA
- Один экран = одна работа (пройти раунд)
- Mobile-first

Acceptance Criteria:
- AC-1: Given student opens round URL, Then sees round screen with progress bar, hearts, first question
- AC-5: Given lives=0, Then round ends, result screen shown
- AC-6: Given all 10 questions answered, Then round ends, result screen shown

Guardrails:
- НЕ создавать TrueOrFalseCard, BuildFormulaCard, SituationCard, FeedbackOverlay — они создаются в TASK-5/6/7/8. Здесь рендери placeholder/stub компонент для каждого типа
- НЕ создавать RoundResultScreen — он в TASK-9
- НЕ подключать API/Supabase — сохранение результата в TASK-10
- НЕ использовать framer-motion

В конце обязательно:
1. перечисли changed files
2. дай краткий summary
3. validation: npm run lint && npm run build pass
4. какие документы нужно обновить
5. self-check against docs 16/17
```

### TASK-5: TrueOrFalseCard

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Задача: создать карточку "Правда или ложь" для Layer 3 тренажёра.

Сначала прочитай:
1. docs/delivery/features/formula-rounds/spec.md — wireframe TrueOrFalse
2. docs/SokratAI_physics_game-design-document.md — §4.1 (UX-логика)
3. docs/discovery/product/tutor-ai-agents/17-ui-patterns-and-component-rules-sokrat.md
4. src/components/kb/ui/MathText.tsx — использовать для рендеринга формул
5. src/lib/formulaEngine/types.ts — FormulaQuestion interface

Создай: src/components/homework/formula-round/TrueOrFalseCard.tsx
- Props: question: FormulaQuestion, onAnswer: (correct: boolean) => void
- Показывает вопрос: "Формула верна?" + формула через <MathText>
- Две кнопки: «Верно» / «Неверно»
- При нажатии: сравнивает с question.correctAnswer, вызывает onAnswer

Acceptance Criteria:
- AC-3: правильный ответ → onAnswer(true)
- AC-4: неправильный ответ → onAnswer(false)
- AC-9 (P1): формула рендерится через KaTeX (MathText) корректно

Guardrails:
- НЕ показывать feedback здесь — это делает FeedbackOverlay
- Один primary CTA выделен (doc 17)

В конце: changed files, summary, validation (lint + build), docs-to-update.
```

### TASK-6: BuildFormulaCard

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Задача: создать карточку "Собери формулу" для Layer 2 тренажёра.

Сначала прочитай:
1. docs/delivery/features/formula-rounds/spec.md — wireframe BuildFormula
2. docs/SokratAI_physics_game-design-document.md — §4.5 (UX-логика, drag-and-drop)
3. docs/discovery/product/tutor-ai-agents/17-ui-patterns-and-component-rules-sokrat.md
4. src/components/kb/ui/MathText.tsx
5. src/lib/formulaEngine/types.ts

Создай: src/components/homework/formula-round/BuildFormulaCard.tsx
- Props: question: FormulaQuestion, onAnswer: (correct: boolean) => void
- Показывает: имя формулы + набор кнопок-кубиков (переменные)
- Зоны: числитель и знаменатель (кнопки "в числитель" / "в знаменатель" при tap на кубик)
- Кнопка «Проверить» → сравнивает собранную формулу с правильной
- Mobile-first: tap-to-select, НЕ drag-and-drop

Acceptance Criteria:
- AC-3: правильная сборка → onAnswer(true)
- AC-4: неправильная сборка → onAnswer(false)
- AC-9 (P1): собранная формула рендерится через MathText

Guardrails:
- Mobile-first: НЕ использовать drag-and-drop
- НЕ показывать feedback — это FeedbackOverlay

В конце: changed files, summary, validation (lint + build), docs-to-update.
```

### TASK-7: SituationCard

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Задача: создать карточку "Ситуация → Формула" для Layer 1 тренажёра.

Сначала прочитай:
1. docs/delivery/features/formula-rounds/spec.md — wireframe Situation
2. docs/SokratAI_physics_game-design-document.md — §4.8 (UX-логика)
3. docs/discovery/product/tutor-ai-agents/17-ui-patterns-and-component-rules-sokrat.md
4. src/components/kb/ui/MathText.tsx
5. src/lib/formulaEngine/types.ts

Создай: src/components/homework/formula-round/SituationCard.tsx
- Props: question: FormulaQuestion, onAnswer: (correct: boolean) => void
- Показывает: текст ситуации (из whenToUse, без чисел)
- 4 варианта ответа (формулы через MathText): правильная + 3 дистрактора
- Tap на вариант → сравнивает с correctAnswer → onAnswer

Acceptance Criteria:
- AC-3: правильный выбор → onAnswer(true)
- AC-4: неправильный выбор → onAnswer(false)
- AC-9 (P1): все 4 формулы рендерятся через MathText

Guardrails:
- Варианты перемешаны (правильный не всегда первый)
- НЕ показывать feedback

В конце: changed files, summary, validation (lint + build), docs-to-update.
```

### TASK-8: FeedbackOverlay

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Задача: создать overlay с объяснением после каждого ответа.

Сначала прочитай:
1. docs/delivery/features/formula-rounds/spec.md — wireframe Feedback Overlay
2. docs/SokratAI_physics_game-design-document.md — §7.1 (feedback всегда), §7.2 (типы объяснений по слоям)
3. docs/discovery/product/tutor-ai-agents/17-ui-patterns-and-component-rules-sokrat.md

Создай: src/components/homework/formula-round/FeedbackOverlay.tsx
- Props: isCorrect, explanation (from generateFeedback), livesLost (0 or 1), onContinue
- Правильно: зелёный фон, «✓ Верно!» + explanation (≤2 строки), кнопка «Далее →»
- Неправильно: красный фон, «✗ Неверно» + explanation (2-4 строки) + «❤️ −1», кнопка «Далее →»
- Кнопка «Далее →» = secondary (doc 17)

Acceptance Criteria:
- AC-3: correct feedback = зелёный, ≤2 строки
- AC-4: incorrect feedback = красный, 2-4 строки, shows lives lost

Guardrails:
- НЕ содержит game logic — только презентация

В конце: changed files, summary, validation (lint + build), docs-to-update.
```

### TASK-9: RoundResultScreen + retry

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Задача: создать итоговый экран после раунда.

Сначала прочитай:
1. docs/delivery/features/formula-rounds/spec.md — wireframe Result Screen
2. docs/SokratAI_physics_game-design-document.md — §2.3 (экран после раунда)
3. docs/discovery/product/tutor-ai-agents/17-ui-patterns-and-component-rules-sokrat.md

Создай: src/components/homework/formula-round/RoundResultScreen.tsx
- Props: result: RoundResult, onRetryErrors: () => void, onClose: () => void
- Score: N/10 (% правильных)
- Оставшиеся жизни
- Список проблемных формул (из result.weakFormulas) с описанием слоя:
  - Layer 3: «путает структуру»
  - Layer 2: «не собирает»
  - Layer 1: «не узнаёт в задаче»
- CTA «Повторить ошибки» (primary) → onRetryErrors()
- CTA «Закрыть» (secondary) → onClose()

Acceptance Criteria:
- AC-5: shown when lives=0, displays score + weak formulas
- AC-6: shown when all 10 answered, displays score + weak formulas
- AC-8 (P1): «Повторить ошибки» triggers retry flow

В конце: changed files, summary, validation (lint + build), docs-to-update.
```

### TASK-10: API + hooks + route wiring

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Задача: подключить formula round к backend и роутингу.

Контекст:
- Round результаты сохраняются один раз при завершении (не после каждого ответа)
- API следует паттерну существующего homework-api Edge Function

Сначала прочитай:
1. docs/delivery/features/formula-rounds/spec.md — секция "API"
2. supabase/functions/homework-api/ — паттерн существующих endpoints
3. src/lib/studentHomeworkApi.ts — паттерн client API functions
4. src/hooks/useStudentHomework.ts — паттерн React Query hooks
5. src/App.tsx — роутинг

Создай/измени:
1. supabase/functions/homework-api/ — добавить endpoints:
   - POST /formula-rounds/:roundId/results — save result (auth: student)
   - GET /formula-rounds/:roundId — get round config (auth: student)
   - GET /formula-rounds/:roundId/results — get student results (auth: student)

2. src/lib/formulaRoundApi.ts — client functions:
   - saveFormulaRoundResult(roundId, result)
   - getFormulaRound(roundId)
   - getFormulaRoundResults(roundId)

3. src/hooks/useFormulaRound.ts — React Query hooks:
   - useFormulaRound(roundId) — query key ['formula-round', roundId]
   - useFormulaRoundResults(roundId) — query key ['formula-round', roundId, 'results']
   - useSaveFormulaRoundResult() — mutation, invalidates results query

4. src/pages/StudentFormulaRound.tsx — page component:
   - Reads :id and :roundId from URL params
   - Loads formula round config via useFormulaRound
   - Renders FormulaRoundScreen
   - On complete: saves result via useSaveFormulaRoundResult

5. src/App.tsx — add route:
   - /homework/:id/round/:roundId → lazy(StudentFormulaRound)

Acceptance Criteria:
- AC-1: GET /homework/:id/round/:roundId loads and shows round screen
- AC-7: On complete, result saved to formula_round_results via POST endpoint

Guardrails:
- Следовать паттерну requestStudentHomeworkApi из studentHomeworkApi.ts
- Bearer token auth
- НЕ трогать существующие homework routes/endpoints

В конце обязательно:
1. changed files
2. summary
3. validation: npm run lint && npm run build
4. docs-to-update
5. self-check against docs 16/17
```

### TASK-11: Seed script

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Задача: создать seed-скрипт для тестирования formula rounds.

Сначала прочитай:
1. docs/delivery/features/formula-rounds/spec.md — Data Model
2. supabase/migrations/20260406_formula_rounds.sql — схема таблиц
3. supabase/seed/ — паттерн существующих seed-скриптов (если есть)

Создай: supabase/seed/formula-round-seed.sql

Содержание:
1. INSERT тестовый homework_tutor_assignment (test-tutor, subject=physics, topic=Кинематика, status=active)
2. INSERT formula_round для этого assignment (section=kinematics, questions_per_round=10, lives=3)
3. INSERT ровно 5 тестовых учеников (test_student_1 … test_student_5) в homework_tutor_student_assignments
   — у каждого свой UUID и своя запись в formula_round_results будет создаваться независимо
   — имена: Тестировщик 1, Тестировщик 2, … Тестировщик 5
4. Для каждого из 5 учеников вывести в комментариях отдельную прямую ссылку:
   -- Тестировщик 1: /homework/{assignment_id}/round/{round_id}?student={student_uuid_1}
   -- Тестировщик 2: /homework/{assignment_id}/round/{round_id}?student={student_uuid_2}
   … и т.д. — с реальными UUID из INSERT-ов

Guardrails:
- НЕ использовать данные Егора или реальных пилотных учеников
- Использовать фиксированные UUID (gen_random_uuid() не подходит — нужны константы, чтобы ссылки были воспроизводимы при повторном запуске seed)
- Seed должен быть идемпотентным: INSERT ... ON CONFLICT DO NOTHING

В конце обязательно выведи:
1. changed files
2. summary
3. Инструкция для запуска теста (3 шага):
   — Шаг 1 (Run seed): команда для запуска seed-скрипта
   — Шаг 2 (Open URL): таблица из 5 строк — имя тестировщика + его прямая ссылка
   — Шаг 3 (Expected state): что должен увидеть тестировщик на экране (round screen с progress bar, первое задание типа T/F)
```

### TASK-12: Codex review

```
Ты — независимый ревьюер SokratAI. Контекст первого агента тебе недоступен.

ПОРЯДОК (строго):
1. Прочитай docs/delivery/features/formula-rounds/prd.md
2. Прочитай docs/delivery/features/formula-rounds/spec.md
3. Прочитай docs/SokratAI_physics_game-design-document.md — §4.1, §4.5, §4.8, §7
4. Прочитай docs/discovery/product/tutor-ai-agents/16-ux-principles-for-tutor-product-sokrat.md
5. Прочитай docs/discovery/product/tutor-ai-agents/17-ui-patterns-and-component-rules-sokrat.md
6. Прочитай git diff (все изменения Phase 1a)

ПРОВЕРЬ:
1. Job alignment: фича усиливает S1-2 (выбор формулы) и R4-1 (сборка ДЗ)?
2. UX drift: нет ли отклонения от homework flow в сторону standalone game?
3. Scope creep: не вошло ли что-то из PRD OUT (XP, streak, spaced repetition)?
4. AC выполнены: все 7 P0 + 3 P1 acceptance criteria из spec?
5. Doc 16 compliance: jobs-first, один экран = одна работа?
6. Doc 17 compliance: один primary CTA, видимый статус, палитра Сократа?
7. GDD compliance: мутации из §4.1, дистракторы из §6.4, feedback из §7?
8. MathText: формулы рендерятся через существующий <MathText> компонент?
9. Mobile: BuildFormulaCard использует tap-to-select, не drag-and-drop?
10. RLS: student видит только свои результаты, tutor — своих уче�
