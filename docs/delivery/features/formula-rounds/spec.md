# Feature Spec: Тренажёр формул — Кинематика

**Версия:** v0.1
**Дата:** 2026-04-05
**Автор:** Vladimir × Claude
**Статус:** draft
**PRD:** `docs/delivery/features/formula-rounds/prd.md`

---

## 0. Job Context

| Участник | Core Job | Sub-job |
|---|---|---|
| Репетитор (B2B) | R4: Сохранение контроля и качества при масштабировании | R4-1: Быстро собрать качественное ДЗ по теме урока |
| Школьник (B2C) | S1: Решить задачу правильно | S1-2: Выбрать правильный подход к решению (какой закон/формулу применить) |
| Школьник (B2C) | S1: Решить задачу правильно | S1-4: Понять ошибку и не повторить её |
| Школьник (B2C) | S2: Быстро получить обратную связь | S2-4: Увидеть свой прогресс и почувствовать рост |

- **Wedge alignment**: Да — новый тип practice-артефакта внутри homework flow
- **Pilot impact**: усиливает ежедневную практику; даёт репетитору visibility по формулам

---

## Фазы

**Phase 1a** (эта SPEC): DB + formula engine + student round UI.
Ученик может пройти round по прямой ссылке `/homework/:id/round/:roundId`. Данные сохраняются в Supabase. Можно тестировать gameplay.

**Phase 1b** (отдельная SPEC, после feedback по 1a): tutor assignment UI в TutorHomeworkCreate + tutor visibility в TutorHomeworkDetail/Results + homework completion integration (round входит в общий %).

Условие старта Phase 1b: Phase 1a задеплоена, минимум 3 ученика прошли round, собран первый feedback по gameplay.

---

## 1. Summary

Phase 1a добавляет в Сократ движок формульного тренажёра и student-facing UI для прохождения раунда из 10 заданий по кинематике. Три типа заданий (Правда/ложь, Собери формулу, Ситуация→Формула) генерируются из статической базы 12 формул кинематики. Раунд проходится за 3-5 минут, с 3 жизнями и мгновенным feedback после каждого ответа. Результаты сохраняются в Supabase.

---

## 2. Problem

### Текущее поведение
Homework flow — guided chat (пошаговый разбор) — ориентирован на полноценные задачи. Нет лёгкого micro-drill для повторения формул.

### Боль
Ученик (S1-2): не знает какую формулу применить к задаче — нет инструмента для тренировки навигации по формулам. Репетитор (R4-1): не может быстро назначить блок «повтори формулы кинематики», вместо этого добавляет больше задач или просит устно.

### Текущие «нанятые» решения
Шпаргалки, PDF с формулами, устные просьбы «повтори кинематику», Решу ЕГЭ (нет drill-формата, только полные задачи).

---

## 3. Solution

### Описание

Новый артефакт `formula_round` с тремя компонентами:

1. **Formula Engine** (`src/lib/formulaEngine/`) — генерация 10 заданий из пула 12 формул кинематики по правилам из GDD §2.2, §4.1, §4.5, §4.8
2. **Student Round UI** (`src/components/homework/formula-round/`) — fullscreen round experience: прогресс-бар, 3 жизни, карточки заданий, feedback, итоговый экран
3. **DB layer** — таблицы для конфигурации round и сохранения результатов

### Ключевые решения

| Решение | Обоснование |
|---|---|
| Formula engine работает на клиенте, не на сервере | Нет AI-вызовов, чистая логика генерации из статической базы. Экономит latency и Edge Function calls. |
| Формульная база хардкодится в `src/lib/formulaEngine/formulas.ts`, не в DB | Phase 1 = только кинематика (12 формул). Нет CRUD по формулам. DB-миграция для контента — overhead. При добавлении разделов в Phase 2+ — переносим в DB. |
| Round state сохраняется в Supabase после завершения (не после каждого ответа) | Минимизируем DB writes. Round = 3-5 минут, потеря прогресса при закрытии вкладки приемлема в v1. |
| Три типа заданий из GDD (по одному на слой) | Минимальный полноценный coverage: Layer 3 (Правда/ложь — структура), Layer 2 (Собери формулу — переменные), Layer 1 (Ситуация→Формула — навигация). |
| Мутации формул из commonMistakes | GDD §4.1: swap_fraction, drop_coefficient, wrong_power, swap_variable. Дистракторы берутся из relatedFormulas, не генерируются случайно. |

### Scope

**In scope (Phase 1a):**

- DB: таблицы `formula_rounds`, `formula_round_results`
- Formula engine: генерация заданий, мутации, дистракторы
- Student UI: round screen (прогресс, жизни, 3 типа карточек, feedback, итоговый экран)
- Student route: `/homework/:id/round/:roundId`
- Сохранение результата в DB после завершения round
- Кнопка «Повторить ошибки» (новый round из формул с ошибками)
- Рендеринг формул (KaTeX)

**Out of scope (Phase 1a):**

- Tutor assignment UI (= Phase 1b)
- Tutor visibility / analytics (= Phase 1b)
- Homework completion integration (= Phase 1b)
- Inline-card в StudentHomeworkDetail (= Phase 1b)
- Всё из PRD OUT и LATER

---

## 4. User Stories

### Школьник
> Когда я открываю round по ссылке, я вижу 10 заданий по формулам кинематики и прохожу их за 3-5 минут, получая мгновенный feedback после каждого ответа. В конце вижу score и список формул, которые путаю.

> Когда я ошибаюсь в round, я сразу вижу объяснение: почему мой ответ неверный и какой правильный. Это помогает мне не повторить ошибку (S1-4).

> Когда я прохожу round повторно через «Повторить ошибки», я вижу только формулы, в которых ошибся, и могу отследить улучшение score (S2-4).

---

## 5. Technical Design

### Затрагиваемые файлы

**Новые файлы:**

```
src/lib/formulaEngine/
├── formulas.ts           — 12 формул кинематики (типизированная база)
├── types.ts              — FormulaQuestion, RoundConfig, RoundResult
├── questionGenerator.ts  — генерация 10 заданий: mutation engine, distractor picker
└── index.ts              — public API: generateRound(), scoreRound()

src/components/homework/formula-round/
├── FormulaRoundScreen.tsx    — основной экран раунда (fullscreen)
├── RoundProgress.tsx         — прогресс-бар + жизни
├── TrueOrFalseCard.tsx       — Layer 3: формула верна/неверна
├── BuildFormulaCard.tsx      — Layer 2: собери формулу из кубиков
├── SituationCard.tsx         — Layer 1: ситуация → выбери формулу
├── FeedbackOverlay.tsx       — объяснение после ответа
├── RoundResultScreen.tsx     — итоговый экран (score, weak formulas, retry)
└── FormulaDisplay.tsx        — KaTeX рендеринг формулы

src/pages/
└── StudentFormulaRound.tsx   — page component, route handler

src/hooks/
└── useFormulaRound.ts        — React Query hooks для round results

src/lib/
└── formulaRoundApi.ts        — API functions для сохранения результатов
```

**Изменяемые файлы:**

```
src/App.tsx                   — добавить route /homework/:id/round/:roundId
src/types/homework.ts         — добавить типы FormulaRound, FormulaRoundResult
```

### Data Model

**Таблица `formula_rounds`** — конфигурация назначенного round

```sql
CREATE TABLE formula_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES homework_tutor_assignments(id) ON DELETE CASCADE,
  section TEXT NOT NULL DEFAULT 'kinematics',
  formula_count INT NOT NULL DEFAULT 12,
  questions_per_round INT NOT NULL DEFAULT 10,
  lives INT NOT NULL DEFAULT 3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (assignment_id)  -- v1: один round на assignment
);
```

**Таблица `formula_round_results`** — результаты прохождения

```sql
CREATE TABLE formula_round_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES formula_rounds(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES auth.users(id),
  score INT NOT NULL,                    -- правильных ответов (0-10)
  total INT NOT NULL DEFAULT 10,
  lives_remaining INT NOT NULL,          -- сколько жизней осталось
  completed BOOLEAN NOT NULL DEFAULT false,  -- дошёл до конца или потерял все жизни
  duration_seconds INT,                  -- время прохождения
  answers JSONB NOT NULL,               -- массив: [{formulaId, questionType, layer, correct, responseMs}]
  weak_formulas JSONB,                  -- массив: [{formulaId, weakLayer, errorDescription}]
  played_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (round_id, student_id, played_at)  -- допускаем повторные попытки
);

-- RLS
ALTER TABLE formula_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE formula_round_results ENABLE ROW LEVEL SECURITY;

-- Ученик видит rounds своих assignments
CREATE POLICY "student_read_rounds" ON formula_rounds FOR SELECT
  USING (assignment_id IN (
    SELECT sa.assignment_id FROM homework_tutor_student_assignments sa
    WHERE sa.student_id = auth.uid()
  ));

-- Ученик может создавать свои результаты
CREATE POLICY "student_insert_results" ON formula_round_results FOR INSERT
  WITH CHECK (
    student_id = auth.uid()
    AND round_id IN (
      SELECT fr.id FROM formula_rounds fr
      JOIN homework_tutor_student_assignments sa ON sa.assignment_id = fr.assignment_id
      WHERE sa.student_id = auth.uid()
    )
  );

-- Ученик видит свои результаты
CREATE POLICY "student_read_results" ON formula_round_results FOR SELECT
  USING (
    student_id = auth.uid()
    AND round_id IN (
      SELECT fr.id FROM formula_rounds fr
      JOIN homework_tutor_student_assignments sa ON sa.assignment_id = fr.assignment_id
      WHERE sa.student_id = auth.uid()
    )
  );

-- Репетитор видит результаты своих учеников (для Phase 1b)
CREATE POLICY "tutor_read_results" ON formula_round_results FOR SELECT
  USING (round_id IN (
    SELECT fr.id FROM formula_rounds fr
    JOIN homework_tutor_assignments hta ON hta.id = fr.assignment_id
    WHERE hta.tutor_id = auth.uid()
  ));
```

### Formula Engine — алгоритм генерации

Источник правил: GDD §2.2, §4.1, §4.5, §4.8, §6.2, §6.4

```typescript
// src/lib/formulaEngine/types.ts

interface Formula {
  id: string;                    // "kin.01"
  section: string;
  topic: string;
  name: string;
  formula: string;               // LaTeX
  formulaPlain: string;
  variables: Variable[];
  physicalMeaning: string;
  proportionality: { direct: string[]; inverse: string[] };
  dimensions: string;
  derivedFrom: string;
  whenToUse: string[];
  commonMistakes: string[];
  relatedFormulas: string[];
  difficulty: 1 | 2 | 3;
}

type QuestionType = 'true_or_false' | 'build_formula' | 'situation_to_formula';
type Layer = 1 | 2 | 3;

interface FormulaQuestion {
  id: string;
  type: QuestionType;
  layer: Layer;
  formulaId: string;
  prompt: string;
  displayFormula?: string;       // формула для рендера в карточке, если нужна отдельно от prompt
  options?: string[];            // для multiple choice
  correctAnswer: string | boolean | string[];
  explanation: string;           // feedback текст
  mutationType?: string;         // для true/false: "swap_fraction" и т.д.
}

interface RoundConfig {
  section: string;
  questionCount: number;         // 10
  lives: number;                 // 3
  formulaPool: Formula[];        // 12 формул кинематики
}

interface RoundResult {
  score: number;
  total: number;
  livesRemaining: number;
  completed: boolean;
  durationSeconds: number;
  answers: AnswerRecord[];
  weakFormulas: WeakFormula[];
}
```

**Генерация раунда** (GDD §6.2 — упрощено для v1 без spaced repetition):

```
generateRound(config: RoundConfig): FormulaQuestion[]

1. Выбрать 10 формул из пула (12) — random без повторов
2. Распределить типы:
   - 3-4 задания true_or_false   (Layer 3)
   - 3-4 задания build_formula   (Layer 2)
   - 2-3 задания situation_to_formula (Layer 1)
3. Перемешать порядок (не группировать по типу)
4. Для каждого задания:
   - true_or_false: 50% показать верную формулу, 50% мутировать
     Мутации (GDD §4.1): swap_fraction, drop_coefficient, wrong_power, swap_variable
   - build_formula: собрать правильные переменные + 2-3 лишних из relatedFormulas
   - situation_to_formula: текст из whenToUse + 3 дистрактора из relatedFormulas + sameSection
```

**Генерация feedback** (GDD §7):

```
При правильном ответе (1 строка):
  "✓ Верно! {formula.physicalMeaning}"

При неправильном ответе (2-4 строки, зависит от layer):
  Layer 3: размерностная проверка — "[м/с²] ≠ [м·с], формула неверна"
  Layer 2: смысловая связь — "E_к — энергия движения, h — это высота. В кинетической нет h."
  Layer 1: триггер — "Нет времени в задаче? → v² = v₀² + 2as, единственная формула без t"
```

### API

Phase 1a — минимальный API для сохранения результатов.

```
POST /functions/v1/homework-api/formula-rounds/:roundId/results
  Body: { score, total, livesRemaining, completed, durationSeconds, answers, weakFormulas }
  Auth: Bearer token (student)
  Response: { id, played_at }

GET /functions/v1/homework-api/formula-rounds/:roundId/results
  Auth: Bearer token (student)
  Response: FormulaRoundResult[] (все попытки ученика)

GET /functions/v1/homework-api/formula-rounds/:roundId
  Auth: Bearer token (student)
  Response: FormulaRound (конфигурация round)
```

### Миграции

```
supabase/migrations/20260406_formula_rounds.sql
  — CREATE TABLE formula_rounds
  — CREATE TABLE formula_round_results
  — RLS policies
  — Indexes на (round_id, student_id)
```

---

## 6. UX / UI

### Wireframe: Student Round Screen

```
┌─────────────────────────────────────────────┐
│  Кинематика — Формулы          ❤️ ❤️ ❤️      │
│  ●●●●●○○○○○  (5/10)                        │
│─────────────────────────────────────────────│
│                                             │
│  [Карточка задания — зависит от типа]       │
│                                             │
│  Тип 1: Правда/ложь                        │
│  ┌─────────────────────────────────────┐   │
│  │  Формула верна?                     │   │
│  │         v = t / s                   │   │
│  │  [✓ Верно]     [✗ Неверно]         │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  Тип 2: Собери формулу                      │
│  ┌─────────────────────────────────────┐   │
│  │  Собери: "Кинетическая энергия"     │   │
│  │  [m] [v²] [g] [h] [2]             │   │
│  │  Числитель: [___]                   │   │
│  │  ─────────────────                  │   │
│  │  Знаменатель: [___]                 │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  Тип 3: Ситуация → Формула                  │
│  ┌─────────────────────────────────────┐   │
│  │  Автомобиль тормозит. Известно:     │   │
│  │  начальная скорость и тормозной     │   │
│  │  путь. Время НЕ дано.              │   │
│  │                                     │   │
│  │  [v = v₀ + at]                     │   │
│  │  [s = v₀t + at²/2]                │   │
│  │  [v² = v₀² + 2as]        ← верно  │   │
│  │  [F = ma]                          │   │
│  └─────────────────────────────────────┘   │
│                                             │
└─────────────────────────────────────────────┘
```

### Wireframe: Feedback Overlay

```
┌─────────────────────────────────────────────┐
│  ✓ Верно!                          +1 балл  │
│                                              │
│  v = s/t — скорость это расстояние           │
│  делить на время.                            │
│                                              │
│           [Далее →]                          │
└──────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  ✗ Неверно                         ❤️ −1     │
│                                              │
│  Ты выбрал s = v₀t + at²/2,                │
│  но в задаче НЕТ времени.                   │
│                                              │
│  Когда нет t → нужна формула                │
│  v² = v₀² + 2as                             │
│                                              │
│           [Далее →]                          │
└──────────────────────────────────────────────┘
```

### Wireframe: Result Screen

```
┌─────────────────────────────────────────────┐
│  Раунд завершён!                             │
│                                              │
│  Правильно: 7/10  (70%)                    │
│  ❤️ Осталось жизней: 1                       │
│                                              │
│  Проблемные формулы:                         │
│  ⚠ v² = v₀² + 2as — не узнаёт в задаче     │
│  ⚠ a_цс = v²/R — путает структуру          │
│  ⚠ s = v₀t + at²/2 — не собирает           │
│                                              │
│  [Повторить ошибки]    [Закрыть]             │
└──────────────────────────────────────────────┘
```

### Design sources для frontend-задач

Агенты при реализации frontend-компонентов тренажёра обязаны читать:

1. **GDD** (`docs/SokratAI_physics_game-design-document.md`) — дизайн каждого типа задания (§4.1, §4.5, §4.8), структура раунда (§2.2), feedback (§7), result screen (§2.3). Определяет gameplay и UX-логику карточек.
2. **Doc 17** (`docs/discovery/product/tutor-ai-agents/17-ui-patterns-and-component-rules-sokrat.md`) — UI-паттерны Сократа: палитра, компоненты, layout rules. Определяет визуальный стиль.
3. **Существующий `<MathText>`** (`src/components/kb/ui/MathText.tsx`) — для рендеринга формул (не создавать новый компонент).

Приоритет при конфликте: doc 17 (стиль Сократа) > GDD (gameplay дизайн).

### UX-принципы (doc 16)

- **Принцип 1 (Jobs-first)**: каждый экран отвечает на job S1-2 «выбрать формулу» — round = тренировка этого навыка
- **Принцип «один экран = одна работа»**: round screen = пройти раунд. Один primary CTA (ответ), нет побочных действий
- **AI-результат ведёт к действию**: feedback после ответа = конкретное объяснение, result screen → CTA «Повторить ошибки»

### UI-паттерны (doc 17)

- **Один primary CTA**: кнопка ответа — primary. «Далее» в feedback — secondary.
- **Статус виден**: progress bar + жизни + score на result screen
- **Формулы**: рендерим через KaTeX (уже используется в проекте? если нет — добавляем)
- **Dark theme**: следуем текущей палитре Сократа

---

## Acceptance Criteria (testable)

### P0 (Must-Have) — без этого фича бесполезна

- **AC-1**: При GET `/homework/:id/round/:roundId` student видит round screen с progress bar, жизнями и первым заданием
- **AC-2**: Round генерирует ровно 10 заданий: 3-4 true_or_false + 3-4 build_formula + 2-3 situation_to_formula, все из 12 формул кинематики
- **AC-3**: При правильном ответе: прогресс +1, показывается зелёный feedback с объяснением (≤2 строки)
- **AC-4**: При неправильном ответе: жизнь -1, показывается красный feedback с объяснением (2-4 строки, зависит от layer)
- **AC-5**: При потере 3 жизней round завершается, показывается result screen с score и weak formulas
- **AC-6**: При прохождении всех 10 заданий round завершается, показывается result screen
- **AC-7**: Результат (score, answers, weak_formulas) сохраняется в `formula_round_results` через API

### P1 (Nice-to-Have) — core работает без этого

- **AC-8**: Кнопка «Повторить ошибки» генерирует новый round только из формул, в которых были ошибки
- **AC-9**: KaTeX корректно рендерит все 12 формул кинематики (LaTeX из базы), включая дроби, степени и индексы
- **AC-10**: Median время прохождения round-а ≤ 5 минут (валидируем по `duration_seconds`)

---

## 7. Validation

### Smoke checks

```bash
# После деплоя Phase 1a:
# 1. Создать formula_round для тестового assignment (через SQL или seed)
# 2. Открыть /homework/{id}/round/{roundId} как student
# 3. Проверить: 10 заданий, 3 жизни, feedback работает
# 4. Завершить round, проверить result screen
# 5. Проверить запись в formula_round_results через Supabase dashboard
```

### Preview / Lovable QA mode

- Для ручного QA в preview/dev использовать `supabase/seed/formula-round-seed.sql`
- Seed создаёт 5 фиксированных test students и прямые ссылки с `?student=<seed_uuid>`
- `src/pages/StudentFormulaRound.tsx` поддерживает auto-login по этим ссылкам **только** на preview/dev host:
  - `localhost`
  - `*.lovableproject.com`
  - non-prod `*.lovable.app`
- На `sokratai.ru` и `sokratai.lovable.app` query param `student` не должен обходить обычную авторизацию
- Если меняются UUID в seed, нужно синхронно обновлять preview bootstrap в `StudentFormulaRound.tsx`

### Phase 1b tutor UI guardrails

- Phase 1b не должен вводить новый top-level tutor module для formula rounds
- Конфигурация formula round должна жить внутри существующего homework create flow (`TutorHomeworkCreate`)
- Видимость прохождений и результатов должна жить внутри assignment detail/results flows (`TutorHomeworkDetail`, `TutorHomeworkResults`)
- Tutor UI обязан оставаться jobs-first:
  - primary action = собрать/отправить ДЗ или просмотреть результат
  - formula round = подблок homework artifact, а не standalone game screen
- Использовать существующие данные `formula_rounds` / `formula_round_results` и политику `tutor_read_results`; не создавать отдельную tutor-only result schema

### Связь с pilot KPI

- **Leading**: student activation rate (% учеников, запустивших round в первые 24ч)
- **Leading**: completion rate (% завершивших round)
- **Leading**: session fit (median duration ≤ 5 мин)

---

## 8. Risks & Open Questions

| Риск | Вероятность | Митигация |
|---|---|---|
| ~~KaTeX не установлен~~ | — | **СНЯТ**: KaTeX уже в проекте. Используем существующий `<MathText>` из `src/components/kb/ui/MathText.tsx` (lazy-load KaTeX CSS + remarkMath + rehypeKatex). CSS-стили для .katex уже в index.css. |
| BuildFormulaCard (drag-and-drop) сложен на мобильном | Средняя | v1: tap-to-select вместо drag. Кнопки «в числитель» / «в знаменатель» |
| 12 формул мало для разнообразия при повторных прохождениях | Низкая | Мутации + различные дистракторы дают ~50 уникальных вопросов. При 10 вопросах за round — 5 проходов до полного повтора |
| Round без tutor assignment (Phase 1a) сложно тестировать в реальном flow | Средняя | Создаём seed-скрипт: один тестовый assignment + formula_round. Раздаём прямую ссылку ученикам Егора |

### Открытые вопросы

| Вопрос | Кто решает | Блокирует Phase 1a? |
|---|---|---|
| ~~Есть ли KaTeX уже в проекте?~~ | engineering | нет | **ЗАКРЫТ**: KaTeX есть. Используем `<MathText>` из `src/components/kb/ui/MathText.tsx`. |
| ~~Seed-скрипт: assignment Егора или отдельный?~~ | product | нет | **ЗАКРЫТ**: отдельный test-assignment с test-tutor. Не загрязняем пилотные данные Егора. Раздаём прямые ссылки ученикам. |

---

## 9. Implementation Tasks

> Переносятся в `formula-rounds-tasks.md` после approve.

**P0 tasks:**
1. DB migration: `formula_rounds` + `formula_round_results` + RLS
2. Formula engine: `formulas.ts` (12 кинематика) + `types.ts`
3. Formula engine: `questionGenerator.ts` — mutation engine + distractor picker + round generation
4. Student UI: `FormulaRoundScreen.tsx` + `RoundProgress.tsx` — основной экран
5. Student UI: `TrueOrFalseCard.tsx` — Layer 3
6. ~~Student UI: `BuildFormulaCard.tsx` — Layer 2~~ ✅ done (2026-04-05)
7. Student UI: `SituationCard.tsx` — Layer 1
8. ~~Student UI: `FeedbackOverlay.tsx` — объяснения после ответа~~ ✅ done (2026-04-05)
9. ~~Student UI: `RoundResultScreen.tsx` — итоговый экран~~ ✅ done (2026-04-05)
10. API: Edge Function endpoint для сохранения результатов
11. Route: `/homework/:id/round/:roundId` в App.tsx
12. React Query hooks: `useFormulaRound.ts`

**P1 tasks:**
13. «Повторить ошибки» — генерация round из weak formulas
14. `FormulaDisplay.tsx` — обёртка над существующим `<MathText>` для формул тренажёра
15. Seed-скрипт для тестового round

---

## 10. Parking Lot

- **Таймер на задание** (GDD §4.1: 8 секунд) — контекст: повышает давление и тренирует автоматизм, revisit: Phase 2 после feedback по базовому gameplay
- **Звуковые эффекты / haptic feedback** — контекст: Duolingo-style satisfaction, revisit: когда standalone экран появится
- **Per-formula mastery state** (GDD §6.1) — контекст: нужен для spaced repetition и adaptive engine, revisit: Phase 2+ когда появится прогрессия по уровням
- **Offline support** — контекст: round не требует сети для gameplay (только для save), revisit: если ученики жалуются на плохой интернет
- **«Карточка формулы» по нажатию** (GDD §7.3) — контекст: полная справка по формуле в modal, revisit: Phase 1b или Phase 2

---

## Checklist перед approve

- [x] Job Context заполнен (секция 0): R4-1 + S1-2 + S1-4 + S2-4
- [x] Привязка к Core Job из Графа работ
- [x] Scope чётко определён (in/out) — Phase 1a отделена от 1b
- [x] UX-принципы из doc 16 учтены: jobs-first, один экран = одна работа
- [x] UI-паттерны из doc 17 учтены: один primary CTA, видимый статус
- [x] Pilot impact описан
- [x] Метрики успеха определены (activation, completion, session fit)
- [x] High-risk файлы не затрагиваются: homework submission flow не меняется
- [x] Student/Tutor изоляция не нарушена: Phase 1a = только student side
- [x] AC testable: 7 P0 + 3 P1 = 10 критериев, каждый = PASS/FAIL
- [x] P0/P1 приоритизация: 4 P0 (core round), 3 P1 (retry, KaTeX, duration)
- [x] Parking Lot заполнен
- [x] Каноничные документы указаны: GDD, mechanics-formulas.json, PRD
