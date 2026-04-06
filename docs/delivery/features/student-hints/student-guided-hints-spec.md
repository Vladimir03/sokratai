# Спецификация: Подсказки при застревании — Guided Homework

**Core Job:** S1 — Получить подсказку при застревании
**Продукт:** СократAI · Guided Homework Chat
**Версия:** 1.0
**Дата:** 2026-03-27
**Статус:** Ready for Implementation
**PRD-источник:** `docs/product/specs/student-guided-hints-prd.md`
**Прототип:** `docs/product/prototypes/student-guided-homework-prototype.html`

---

## 1. Problem Statement

Ученик 10–11 класса решает ДЗ по физике вечером, застревает на задаче и не может продвинуться. Репетитор недоступен. Текущие альтернативы (ChatGPT, РешуЕГЭ, одноклассники) дают готовый ответ, не учат решать. Сократ уже имеет guided homework chat с двумя полями (Ответ + Обсуждение) и тремя AI-путями (check, hint, discussion), но AI-промпты недостаточно структурированы: bootstrap-сообщение generic, подсказки не нарастают по конкретности, фидбек по ошибкам сухой, AI не предлагает следующий шаг.

Проблема критична: severity 7–9/10 по четырём sub-jobs (S1-1 через S1-4). Abandonment rate ~45% — ученик бросает задачу при застревании вместо того, чтобы воспользоваться помощью AI. Для платящего родителя «пустота между уроками» — аргумент против продления. Для репетитора нерешённое ДЗ = потеря контекста на следующем уроке.

---

## 2. Goals

| # | Goal | Метрика | Target | Stretch |
|---|------|---------|--------|---------|
| G1 | Ученик продвигается при застревании | % задач INCORRECT → CORRECT в одном thread | ≥60% | 75% |
| G2 | Снижение abandonment | % active задач без сообщений >10 мин | ≤30% | ≤20% |
| G3 | Ученик использует AI как наставника | Среднее discussion messages до CORRECT | 2–4 | 3–5 |
| G4 | Время решения приемлемо | Медианное время до CORRECT | ≤15 мин | ≤10 мин |
| G5 | Репетитор видит работу ученика | % заданий с ≥3 сообщениями ученика | ≥70% | 80% |

---

## 3. Non-Goals

| # | Non-Goal | Почему |
|---|----------|--------|
| N1 | Замена репетитора AI-тьютором | Wedge = помощь между уроками, не автономное обучение |
| N2 | Генерация визуальных схем/чертежей AI | Технически сложно, низкий ROI. P2 |
| N3 | Voice input / аудио-подсказки | Ученик печатает. Голос — P2 |
| N4 | Адаптивная сложность на ML-профиле | Нужны accumulated data. P2 |
| N5 | Multi-task hints между задачами | Каждая задача = изолированный thread |
| N6 | Показ score ученику | Не ясна реакция 16–18 лет. Собираем данные на пилоте (P1) |

---

## 4. User Stories

### Persona: Школьник 11 класс, цель 70+ ЕГЭ физика

**S1-1: Понять условие**
- US-1.1: Как ученик, открывший задачу с длинным условием, я хочу увидеть от AI разбор «Дано / Найти / Ситуация» — чтобы понять задачу за 1 минуту.
- US-1.2: Как ученик с задачей с графиком, я хочу получить от AI комментарий к изображению — чтобы не гадать, что нарисовано.

**S1-2: Выбрать подход**
- US-2.1: Как ученик, не знающий какой закон применить, я хочу получить наводящий вопрос, а при повторных подсказках — всё более конкретные — чтобы самостоятельно выбрать формулу.
- US-2.2: Как ученик, попробовавший тупиковый подход, я хочу написать «пробовал через энергию, не получается» и получить оценку — чтобы не тратить время.

**S1-3: Проверить шаг**
- US-3.1: Как ученик с промежуточным результатом (v = 15 м/с на шаге 3), я хочу отправить его на проверку через Discussion и получить ✅ или ⚠️ — чтобы не решать 20 минут на основе ошибки на шаге 2.
- US-3.2: Как ученик, я хочу сфотографировать запись и спросить AI «правильно ли подставил?» — чтобы поймать ошибку до финального ответа.

**S1-4: Понять ошибку**
- US-4.1: Как ученик, получивший INCORRECT, я хочу увидеть объяснение с аналогией из жизни + конкретный следующий шаг — чтобы понять физический смысл.
- US-4.2: Как ученик, исправивший ошибку, я хочу увидеть резюме «📌 Запомни: ...» — чтобы не повторить ошибку.

---

## 5. Requirements

### 5.0. Critical Bug Fixes (P0-URGENT) — Bootstrap Hallucination

Обнаружена критическая проблема: AI в bootstrap-сообщении галлюцинирует — придумывает несуществующее решение ученика, говорит о задаче, которую ученик не видит. Проблема воспроизводится на задачах из Каталога Сократа (KB) с изображением.

---

#### TASK-0A: Fix Bootstrap Hallucination — taskContext содержит неверный modeHint

**Severity:** CRITICAL (ученик видит бессмысленное первое сообщение)
**Файлы:**
- `src/components/homework/GuidedHomeworkWorkspace.tsx` → `buildTaskContext()` вызов (строка ~1106), `buildGuidedSystemPrompt()` (строки 156-162)

**Корневая причина:**

При генерации bootstrap-сообщения вызывается:
```typescript
taskContext: buildTaskContext(assignment, currentTask, ..., 'question')
```

Функция `buildTaskContext` с `sendMode: 'question'` генерирует `modeHint`:
```
"Режим: промежуточный шаг решения. Ученик показывает свой ход мыслей..."
```

Этот modeHint попадает в taskContext → бэкенд добавляет в system prompt → AI думает, что уже получил шаг решения от ученика, и начинает «обсуждать» несуществующее решение.

Для задач с `task_text = "[Задача на фото]"` (условие полностью на изображении) проблема усиливается: AI не имеет текстового условия, получает противоречивые инструкции (bootstrap vs «промежуточный шаг»), и галлюцинирует.

**Что сделать:**

1. В `buildTaskContext()` добавить поддержку `sendMode: 'bootstrap'` (или передавать `isBootstrap` опцией):

```typescript
const modeHint =
  sendMode === 'bootstrap' || options?.isBootstrap
    ? 'Режим: стартовое сообщение. Ученик ТОЛЬКО ОТКРЫЛ задачу. Никакого решения ещё нет. Сформулируй короткий стартовый заход: помоги разобрать условие.'
    : sendMode === 'hint_request'
      ? '...'
      : sendMode === 'question'
        ? '...'
        : '...';
```

2. В вызове bootstrap (строка ~1106) передать `'bootstrap'` вместо `'question'`:

```typescript
taskContext: buildTaskContext(assignment, currentTask, assignment.tasks.length, 'bootstrap'),
```

3. Усилить bootstrap system prompt (строки 156-162) — добавить явный запрет на галлюцинацию решения:

```typescript
if (options?.isBootstrap) {
  return [
    ...baseRules,
    'Сейчас нужен короткий стартовый заход по задаче без полного решения.',
    'КРИТИЧНО: ученик ТОЛЬКО ЧТО ОТКРЫЛ задачу. Он ещё НИЧЕГО не писал и не загружал.',
    'НЕ упоминай никакие "решения ученика", "загруженные фото", "предыдущие попытки".',
    'Сформулируй 1-2 предложения, которые помогут ученику начать разбор задачи.',
  ].join('\n');
}
```

4. Для задач с изображением (`task_image_url` присутствует) + минимальный текст (`isMinimalText`) — усилить инструкцию в taskContext:

```
'ВАЖНО: Условие задачи ПОЛНОСТЬЮ на изображении. Прочитай текст и данные НА КАРТИНКЕ.
НЕ придумывай своё условие. Если не можешь прочитать изображение — так и скажи.'
```

**Acceptance Criteria:**

- [ ] Bootstrap для задачи из KB-каталога с изображением НЕ упоминает «решение ученика»
- [ ] Bootstrap для задачи с `task_text = "[Задача на фото]"` читает условие с изображения
- [ ] modeHint в taskContext для bootstrap НЕ содержит «промежуточный шаг решения»
- [ ] AI bootstrap не галлюцинирует — говорит только о том, что видит в условии/изображении
- [ ] Если AI не может прочитать изображение — fallback: «Начинаем задачу N. Напиши решение...»
- [ ] Regression: обычные задачи (с текстовым условием) по-прежнему получают корректный bootstrap
- [ ] `npm run lint` + `npm run build` + `npm run smoke-check` проходят

---

#### TASK-0B: Настройка «Отключить AI-вступление» для репетитора

**Severity:** HIGH (запрос от репетитора — ученики должны начинать решать сами)
**Файлы:**
- `supabase/functions/homework-api/index.ts` → `handleProvisionGuidedThread` / assignment schema
- `src/components/homework/GuidedHomeworkWorkspace.tsx` → bootstrap useEffect
- `src/components/tutor/homework-create/HWExpandedParams.tsx` → UI toggle

**Контекст:**

Репетитор просит убрать первое AI-сообщение (bootstrap). Мотивация: ученик должен сам начинать думать над задачей, а не ждать подсказку от AI.

**Что сделать:**

1. **DB:** Добавить поле `disable_ai_bootstrap: boolean DEFAULT false` в таблицу `homework_tutor_assignments` (миграция).

2. **Конструктор ДЗ (L1):** В `HWExpandedParams.tsx` добавить toggle «AI-вступление к задачам» (по умолчанию ВКЛ). Сохранять в `disable_ai_bootstrap` при submit.

3. **Frontend (student):** В `GuidedHomeworkWorkspace.tsx`, в bootstrap useEffect (строка ~1062), добавить проверку:

```typescript
if (assignment.disable_ai_bootstrap) {
  bootstrapStartedRef.current.add(key);
  return; // skip bootstrap — student starts blank
}
```

4. **Backend:** Включить `disable_ai_bootstrap` в SELECT при `getStudentAssignment()` в `studentHomeworkApi.ts`.

**Acceptance Criteria:**

- [ ] Репетитор видит toggle «AI-вступление к задачам» в L1 конструктора ДЗ
- [ ] По умолчанию: ВКЛ (bootstrap генерируется как раньше)
- [ ] При ВЫКЛ: ученик открывает задачу и видит пустой чат — AI не пишет первое сообщение
- [ ] Ученик может сам начать: написать в Discussion или отправить ответ
- [ ] Кнопка «💡 Подсказка» по-прежнему работает (не зависит от bootstrap)
- [ ] Поле сохраняется при редактировании ДЗ
- [ ] Миграция: `ALTER TABLE homework_tutor_assignments ADD COLUMN disable_ai_bootstrap boolean DEFAULT false`

---

### 5.1. Must-Have (P0) — System Prompt Changes

Все P0 реализуются **только** через изменение system prompts в `guided_ai.ts`. Без изменений frontend. Деплой за 2–4 дня через Supabase Edge Functions.

---

#### TASK-1: Structured Bootstrap (Дано / Найти / Ситуация)

**Sub-Job:** S1-1 (Понять условие)
**Файл:** `supabase/functions/homework-api/guided_ai.ts` → bootstrap system prompt в `streamChat()` (message_kind: 'system')
**User Story:** US-1.1, US-1.2

**Что сделать:**

Обновить bootstrap system prompt. AI при первом сообщении (bootstrap) обязан разбирать условие задачи структурированно:

```
Если условие задачи > 2 предложений или содержит несколько объектов/величин:
1. Раздели на: **Дано** (числовые данные + единицы в LaTeX),
   **Найти** (что определить), **Ситуация** (что происходит, 1-2 предл.)
2. Если есть изображение задачи — прокомментируй ключевые элементы
   (оси, точки, направления)
3. Заверши наводящим вопросом: "Какую формулу можно использовать?"
   или "Попробуй решить. Если застрянешь — напиши."

Для коротких задач (<2 предложений): краткий bootstrap без Дано/Найти.
```

**Acceptance Criteria:**

- [ ] Bootstrap для задач с `task_text.length > 100` содержит «Дано / Найти / Ситуация»
- [ ] Формулы в «Дано» рендерятся через LaTeX (`$v_0 = 20$ м/с`)
- [ ] Для коротких задач — краткий bootstrap без структуры
- [ ] Если у задачи есть `task_image_url` — prompt содержит инструкцию прокомментировать изображение
- [ ] Bootstrap заканчивается наводящим вопросом или предложением действия (R3)
- [ ] Проверить на 5 задачах: структура корректна, LaTeX рендерится в `MathText`

---

#### TASK-2: Progressive Hint Ladder

**Sub-Job:** S1-2 (Выбрать подход)
**Файл:** `supabase/functions/homework-api/guided_ai.ts` → `buildHintPrompt()`
**User Story:** US-2.1

**Что сделать:**

Обновить system prompt в `buildHintPrompt()`. Заменить текущую строку `"Если это не первая подсказка — сделай её чуть более конкретной."` на структурированный ladder:

```
Это подсказка №{hintCount + 1} по этой задаче.

Уровни конкретности:
- Подсказка 1: задай общий наводящий вопрос. "Подумай, какая величина
  здесь сохраняется?" Не называй конкретный закон.
- Подсказка 2: будь конкретнее — назови область физики или тип задачи.
  "Это задача на сохранение энергии. Какие виды энергии участвуют?"
- Подсказка 3+: укажи конкретный закон/формулу, но НЕ подставляй числа
  и НЕ решай. "Используй v² = v₀² − 2gh. Подставь v = 0."

НИКОГДА не давай готовый числовой ответ, даже на 5-й подсказке.
```

**Backend изменение:** `hintCount` уже передаётся в `GenerateHintParams` и присутствует в prompt. Нужно только усилить prompt-инструкцию с ladder-логикой.

**Acceptance Criteria:**

- [ ] Prompt содержит `Это подсказка №{N}` с актуальным значением из `params.hintCount`
- [ ] Hint 1 — общий вопрос (без названия закона)
- [ ] Hint 2 — конкретнее (область физики / тип задачи)
- [ ] Hint 3+ — конкретный закон/формула, но без подстановки чисел
- [ ] AI по-прежнему НЕ даёт готовый ответ даже на 5+ подсказке
- [ ] Score penalty -0.1 за подсказку остаётся без изменений
- [ ] Проверить на 3 задачах: запросить 3 подсказки подряд, убедиться в нарастании

---

#### TASK-3: AI Suggests Next Action (все режимы)

**Sub-Job:** S1-1 — S1-4 (все)
**Файл:** `supabase/functions/homework-api/guided_ai.ts` → `buildCheckPrompt()`, `buildHintPrompt()`, streaming chat system prompt
**User Story:** US-4.1 (next action after error)

**Что сделать:**

Добавить во ВСЕ три system prompt (check, hint, streaming chat) инструкцию:

```
В конце КАЖДОГО ответа ОБЯЗАТЕЛЬНО предложи ученику 1-2 конкретных
следующих действия. Формулируй как действие:
"Попробуй...", "Напиши мне...", "Проверь...", "Переходи к..."

Маппинг по типу:
- INCORRECT: "Попробуй пересчитать с учётом [конкретика].
  Или напиши промежуточный результат — проверю."
- ON_TRACK: "Продолжай! Если застрянешь — напиши промежуточный
  результат, проверю."
- CORRECT: "Отлично! Переходи к следующей задаче."
- Hint: "Попробуй с этим подходом. Если получишь результат — напиши."
- Discussion: предложи релевантный следующий шаг по контексту
- Bootstrap: "Попробуй решить. Если не понял условие — напиши."

НЕ используй абстрактные фразы ("подумай ещё", "будь внимательнее").
Только конкретные действия.
```

**Acceptance Criteria:**

- [ ] Инструкция добавлена в `buildCheckPrompt()` (systemContent array)
- [ ] Инструкция добавлена в `buildHintPrompt()` (systemContent array)
- [ ] Инструкция добавлена в streaming chat system prompt
- [ ] AI не предлагает абстрактные действия — только конкретные
- [ ] Предложение привязано к содержанию ответа (не шаблонное)
- [ ] Проверить на 10 тестовых сценариях: каждый ответ содержит actionable suggestion

---

#### TASK-4: Error Explanation with Analogy

**Sub-Job:** S1-4 (Понять ошибку)
**Файл:** `supabase/functions/homework-api/guided_ai.ts` → `buildCheckPrompt()` (rules for INCORRECT verdict)
**User Story:** US-4.1

**Что сделать:**

Обновить секцию «Правила feedback» для INCORRECT в `buildCheckPrompt()`:

```
При INCORRECT с концептуальной ошибкой (concept | wrong_answer):
1. Назови конкретную ошибку в 1 предложении
2. Объясни ПОЧЕМУ это неправильно через аналогию из повседневной жизни.
   Пример: "Представь, что тормозишь на велосипеде — тормозной путь
   зависит от квадрата скорости, а не от скорости."
3. Предложи как исправить (next action, см. выше)
Тон: дружелюбный, на языке 16-летнего. "Это частая ошибка! Давай..."
НЕ цитируй учебник. НЕ осуждай.

При INCORRECT с вычислительной ошибкой (calculation):
Укажи конкретный шаг с ошибкой: "Ты написал 400/10 = 20, но
400/10 = 40. Проверь деление."
```

**Acceptance Criteria:**

- [ ] При concept error: ответ AI содержит аналогию из жизни (не формальное определение)
- [ ] При calculation error: ответ указывает конкретный шаг
- [ ] Тон дружелюбный, без осуждения
- [ ] LaTeX-формулы в объяснении рендерятся корректно
- [ ] Проверить на 5 задачах с concept errors: аналогия релевантна физике

---

#### TASK-5: Error Summary After Correction

**Sub-Job:** S1-4 (Понять ошибку и не повторить)
**Файл:** `supabase/functions/homework-api/guided_ai.ts` → `buildCheckPrompt()` (rules for CORRECT verdict)
**Файл:** `supabase/functions/homework-api/index.ts` → `handleCheckAnswer` (передача verdict history)
**User Story:** US-4.2

**Что сделать:**

Шаг 1 — Backend: в `handleCheckAnswer` (index.ts), при загрузке conversationHistory, добавить SELECT `message_kind` в query. Передать в `evaluateStudentAnswer()` информацию о том, были ли INCORRECT verdicts в истории. Способ: добавить к systemContent prompt строку: `"Предыдущие попытки ученика по этой задаче: {wrongAnswerCount} неверных."` (уже есть как `Статистика:` — убедиться, что AI обрабатывает).

Шаг 2 — Prompt: добавить правило для CORRECT verdict:

```
При CORRECT, если wrongAnswerCount > 0:
Добавь в конце резюме:
"📌 Запомни: в задачах на [тема] [конкретное правило, привязанное
к допущенной ошибке]. Ты ошибся → разобрался → решил. Так и надо!"
1-2 предложения, конкретное правило (не "будь внимательнее").

При CORRECT с первой попытки: только "Отлично! Переходи к следующей."
```

**Acceptance Criteria:**

- [ ] Резюме генерируется ТОЛЬКО если `wrongAnswerCount > 0`
- [ ] Резюме — 1–2 предложения, конкретное правило
- [ ] При первой попытке CORRECT — резюме НЕ генерируется
- [ ] `message_kind` теперь включается в SELECT conversationHistory (нужно для будущих фич)
- [ ] Проверить: 2 неверных → 1 верный → резюме есть; 1 верный сразу → резюме нет

---

#### TASK-6: Step Check в Discussion Mode

**Sub-Job:** S1-3 (Проверить промежуточный шаг)
**Файл:** `supabase/functions/homework-api/guided_ai.ts` → streaming chat system prompt (streamChat)
**User Story:** US-3.1, US-3.2

**Что сделать:**

Обновить system prompt для streaming discussion chat:

```
Если ученик отправляет промежуточный результат (формулу, подстановку,
число + "правильно?", "верно?", "проверь", "мой шаг"):
- Верно: "✅ Верно, продолжай! [конкретный следующий шаг]"
- Неверно: "⚠️ Проверь [что именно]. Подсказка: [1 предложение]."

НЕ показывай правильный промежуточный результат. НЕ решай дальше.
Ответ на step check: 1-3 предложения max.

Отличай step check от финального ответа: если ученик пишет число без
контекста — уточни: "Это твой промежуточный результат или финальный ответ?
Финальный ответ лучше отправить через зелёное поле «Ответ»."
```

**Acceptance Criteria:**

- [ ] AI распознаёт intent паттерны: `проверь`, `правильно?`, `верно?`, `мой шаг`, число + `?`
- [ ] При верном шаге: «✅ Верно, продолжай!» + следующий шаг
- [ ] При неверном шаге: «⚠️ Проверь...» + подсказка, без ответа
- [ ] Score НЕ снижается при step check через Discussion (это не hint, не answer)
- [ ] AI не путает step check с финальным ответом (мягкое уточнение)
- [ ] Проверить на 3 задачах: верный шаг → ✅, неверный → ⚠️, неясное → уточнение

---

### 5.2. Must-Have (P0) — UI Cleanup

Минимальные UI-изменения, подтверждённые прототипом.

---

#### TASK-7: Убрать дублирующую навигацию «Предыдущая / Следующая»

**Файл:** `src/components/homework/GuidedHomeworkWorkspace.tsx`

**Что сделать:**

Убрать нижнюю панель с кнопками «Предыдущая» / «Следующая» (`ChevronLeft` / `ChevronRight`). Эта навигация дублирует `TaskStepper` сверху. Удаление освобождает ~40px вертикального пространства на мобиле — критично для маленьких экранов.

**Конкретные изменения:**
1. Удалить JSX-блок с кнопками «Предыдущая» / «Следующая» (строки ~1370-1390)
2. Удалить вычисление `nextTaskOrder`, `nextTaskVisited`, `canGoNext` (строки ~470-474) — если не используются в другом месте
3. Удалить `handleGoNext` callback (строки ~1046-1055) — если не используется в другом месте
4. Удалить импорт `ChevronLeft`, `ChevronRight` из `lucide-react` — если не используются в другом месте

**Acceptance Criteria:**

- [ ] Нижняя полоса «Предыдущая / Следующая» удалена
- [ ] `TaskStepper` работает как единственная навигация между задачами
- [ ] Навигация между задачами по-прежнему работает (клик на кружок в Stepper)
- [ ] На мобиле: чат-область получает ~40px дополнительного пространства
- [ ] Нет regression: свободный порядок задач, per-task drafts, auto-scroll — всё работает
- [ ] `npm run lint` + `npm run build` + `npm run smoke-check` проходят

---

### 5.3. Nice-to-Have (P1) — UI Improvements (после пилота)

#### TASK-8: Quick Action Chips в Discussion

**Файл:** `src/components/homework/GuidedChatInput.tsx`
**Срок:** После 2 недель пилота с данными

Контекстные кнопки-чипы над Discussion полем. Зависят от состояния задачи:
- 0 сообщений: «Разобрать условие», «Какой подход?»
- После INCORRECT: «Где ошибка?», «Подсказка к шагу»
- После hint: «Ещё подсказка», «Проверить мой шаг»

Нажатие → отправка предзаполненного сообщения. Генерация контекстных чипов (AI-based) — v2.

#### TASK-9: Follow-up Action Buttons на AI-сообщениях

**Файл:** `src/components/homework/GuidedChatMessage.tsx`

1–2 ghost-кнопки под AI-ответом. Исчезают после следующего сообщения ученика.

#### TASK-10: Адаптивный Bootstrap по сложности задачи

**Файл:** `supabase/functions/homework-api/guided_ai.ts`

Backend определяет сложность по длине task_text + метаданным (номер задания ЕГЭ) и адаптирует bootstrap. Простые задачи — короткий, сложные — развёрнутый.

#### TASK-11: Предложение «Похожая задача» из KB

**Файл:** Backend + KB integration

После ошибки и исправления AI предлагает похожую задачу из `kb_tasks` (тот же `topic_id`). Мини-thread, не ломает основной.

---

### 5.4. Future Considerations (P2)

- **P2-1:** Визуальные SVG-схемы от AI (диаграммы сил, цепи)
- **P2-2:** Voice-to-text для мобильных ответов
- **P2-3:** Персональный профиль ошибок (accumulated data)
- **P2-4:** Per-tutor prompt customization
- **P2-5:** Score visibility для ученика (A/B тест после пилота)
- **P2-6:** Collaborative hints — репетитор подключается к live thread

---

## 6. Implementation Plan

### Phase 0 (день 1): CRITICAL — Bootstrap bug fix + tutor toggle

| Task | Файл | Effort | Risk |
|------|-------|--------|------|
| TASK-0A: Fix Bootstrap Hallucination | `GuidedHomeworkWorkspace.tsx` (buildTaskContext, bootstrap useEffect) | 2h | Medium — frontend change, but isolated to bootstrap |
| TASK-0B: Disable AI Bootstrap toggle | Migration + `HWExpandedParams` + `GuidedHomeworkWorkspace` + `studentHomeworkApi` | 3h | Low — new field, additive |

**Деплой:** Frontend build + Supabase migration + Edge Functions. **Приоритет #1 — баг виден ученикам сейчас.**

### Phase 1 (дни 2–3): Prompt improvements — no-risk

| Task | Файл | Effort | Risk |
|------|-------|--------|------|
| TASK-1: Structured Bootstrap | `guided_ai.ts` → streaming chat bootstrap | 2h | Minimal — prompt only |
| TASK-3: AI Suggests Next Action | `guided_ai.ts` → все 3 промпта | 2h | Minimal — prompt only |
| TASK-4: Error with Analogy | `guided_ai.ts` → `buildCheckPrompt()` | 1h | Minimal — prompt only |

**Деплой:** Supabase Edge Functions redeploy. Без frontend build.

### Phase 2 (дни 4–5): Prompt + minor backend

| Task | Файл | Effort | Risk |
|------|-------|--------|------|
| TASK-2: Progressive Hint Ladder | `guided_ai.ts` → `buildHintPrompt()` | 1h | Minimal — hintCount already available |
| TASK-5: Error Summary | `guided_ai.ts` + `index.ts` (message_kind SELECT) | 2h | Low — добавляем column в SELECT |
| TASK-6: Step Check in Discussion | `guided_ai.ts` → streaming chat prompt | 1h | Minimal — prompt only |

**Деплой:** Supabase Edge Functions redeploy. Без frontend build.

### Phase 3 (день 6): UI cleanup

| Task | Файл | Effort | Risk |
|------|-------|--------|------|
| TASK-7: Убрать Предыдущая/Следующая | `GuidedHomeworkWorkspace.tsx` | 1h | Low — удаление JSX |

**Деплой:** Frontend build + deploy.

### Phase 4 (после пилота, 2+ недели): P1 UI

TASK-8 через TASK-11 — по результатам обратной связи пилота.

---

## 7. Success Metrics

### Leading (1–2 недели)

| Метрика | Baseline | Target | Measurement |
|---------|----------|--------|-------------|
| Discussion messages per task | ~0.5 | 2.0 | DB: `thread_messages WHERE role='user'` grouped by task |
| Hint requests per task | ~0.3 | 1.0 | DB: `thread_messages WHERE message_kind='hint'` |
| AI responses with actionable suggestion | ~20% | 90% | Manual QA на 20 threads |
| Error feedbacks с аналогией | ~0% | 80% | Manual QA на concept errors |
| Abandonment rate | ~45% | ≤30% | DB: active tasks with stale threads |

### Lagging (4–8 недель)

| Метрика | Baseline | Target | Measurement |
|---------|----------|--------|-------------|
| Task completion rate (CORRECT) | ~55% | 70% | DB: `task_states status=completed / total` |
| Average score per task | ~60% | 70% | DB: `avg(earned_score / max_score)` |
| Repeat engagement same day | ~35% | 50% | DB: assignment created vs first message |
| Tutor opens thread review | ~30% | 50% | Analytics: GuidedThreadViewer opens |

---

## 8. Open Questions

| # | Вопрос | Owner | Blocking? | Status |
|---|--------|-------|-----------|--------|
| Q3 | Score visibility — мотивирует ли 16–18-летних? | Product | No | Сбор данных на пилоте |
| Q4 | Как измерять «понял ошибку» vs «просто исправил»? | Data | No | Proxy: не повторяет тип ошибки |
| Q6 | Chips: фиксированные vs AI-генерированные? | Engineering | No (P1) | v1 фиксированные, v2 контекстные |

---

## 9. Architecture Reference

### Три AI-пути (уже реализованы)

| Поле UI | API endpoint | `message_kind` | AI function |
|---------|-------------|----------------|-------------|
| Answer (зелёная рамка) | `POST /threads/:id/check` | `'answer'` | `evaluateStudentAnswer()` |
| Discussion (серая рамка) | `POST /threads/:id/messages` | `'question'` | `streamChat()` |
| Кнопка 💡 | `POST /threads/:id/hint` | `'hint_request'` | `generateHint()` |

### Что передаётся в AI (уже)

`wrongAnswerCount`, `hintCount`, `availableScore`, `maxScore`, `conversationHistory` (last 15 messages), `taskText`, `correctAnswer`, `taskImageUrl`, `studentImageUrls`

### Что добавить для P0

- `message_kind` в SELECT conversationHistory (TASK-5) — для R5 error summary и будущих фич
- `disable_ai_bootstrap` поле в assignments + SELECT в studentHomeworkApi (TASK-0B)
- Bootstrap-specific `modeHint` в `buildTaskContext()` (TASK-0A)

### Bootstrap hallucination — корневая причина (TASK-0A)

`buildTaskContext(assignment, currentTask, ..., 'question')` генерирует modeHint «Режим: промежуточный шаг решения. Ученик показывает свой ход мыслей...» для bootstrap-сообщения. AI получает противоречивые инструкции: system prompt говорит «стартовое сообщение», а taskContext — «ученик показывает шаг». AI выбирает последнее и галлюцинирует несуществующее решение. Усугубляется для задач с `task_text = "[Задача на фото]"`, где текстового условия нет.

### Ключевые файлы P0

- `src/components/homework/GuidedHomeworkWorkspace.tsx` — bootstrap fix (TASK-0A), удаление навигации (TASK-7), bootstrap toggle (TASK-0B)
- `supabase/functions/homework-api/guided_ai.ts` — **все prompt changes** (TASK 1-6)
- `supabase/functions/homework-api/index.ts` — SELECT message_kind (TASK-5)
- `src/components/tutor/homework-create/HWExpandedParams.tsx` — toggle AI-вступление (TASK-0B)
- `src/lib/studentHomeworkApi.ts` — SELECT disable_ai_bootstrap (TASK-0B)

### Что НЕ меняется

- `GuidedChatInput.tsx` — без изменений (📎 уже есть)
- `GuidedChatMessage.tsx` — без изменений в P0
- `TaskStepper.tsx` — без изменений
- Score computation (`computeAvailableScore`) — без изменений

---

## 10. Validation Checklist

После реализации каждой Phase:

```bash
npm run lint
npm run build
npm run smoke-check
```

Ручное тестирование (на каждую Task):
0. **TASK-0A:** Открыть задачу из KB-каталога с изображением (`[Задача на фото]`) → bootstrap НЕ упоминает «решение ученика», не галлюцинирует
0b. **TASK-0B:** Создать ДЗ с отключённым AI-вступлением → ученик видит пустой чат при открытии задачи
1. Открыть guided homework assignment с 3+ задачами
2. Проверить bootstrap → должен содержать Дано/Найти/Ситуация
3. Запросить 3 подсказки → должны нарастать по конкретности
4. Написать промежуточный шаг в Discussion → ✅ или ⚠️
5. Отправить неверный ответ → аналогия + next action
6. Отправить верный ответ после неверного → резюме «📌 Запомни»
7. Каждый AI-ответ заканчивается конкретным предложением
8. На мобиле: нет нижней полосы навигации, TaskStepper работает

Кросс-браузер: Chrome desktop, Chrome Android, Safari iOS (критично!).
