# Промпты и чек-лист для разработки: Подсказки при застревании — Guided Homework

**Спецификация:** `docs/features/specs/student-guided-hints-spec.md`
**Паттерны:** `docs/product/specs/tutor_ai_agents/20-claude-code-prompt-patterns-sokrat.md`
**Дата:** 2026-03-27

---

## Тип задачи

Смешанный:
- **Phase 0** (TASK-0A, TASK-0B) — **Тип C** (UX fix) — баг bootstrap + туггл для репетитора
- **Phase 1–2** (TASK-1 через TASK-6) — **Тип A** (новая фича) — prompt improvements = новый UX AI-ассистента
- **Phase 3** (TASK-7) — **Тип C** (UX polish) — убрать дублирующую навигацию

**Job:** S1 — Получить подсказку при застревании
**Wedge alignment:** ученик не бросает ДЗ вечером → репетитор видит прогресс → родитель видит ценность → оплата пилота

---

## Мини-чек-лист перед запуском (из doc 20)

```
☑ Тип задачи: C (Phase 0), A (Phase 1-2), C (Phase 3)
☑ Job: S1 — Получить подсказку при застревании (sub-jobs S1-1..S1-4)
☑ Wedge: ученик решает ДЗ между уроками с AI-помощью → не бросает
☑ Документы: spec + canonical docs
☑ Plan: утверждён (Phase 0→1→2→3)
☑ Scope ограничен: P0 = prompts + 1 bugfix + 1 toggle + 1 UI cleanup
☑ docs-to-update: запрошен в конце каждого промпта
```

---

## Phase 0 — CRITICAL: Bootstrap Bug Fix + Tutor Toggle

### Промпт Phase 0, Шаг 1 — план

```text
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Нужно СРОЧНО исправить два бага в guided homework chat для ученика.

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ;
- wedge: ученик решает ДЗ между уроками с AI-подсказками;
- AI = draft + action, а не chat-only output;
- Job: S1 — Получить подсказку при застревании.

Сначала обязательно прочитай документы:
1. docs/features/specs/student-guided-hints-spec.md — TASK-0A и TASK-0B
2. docs/product/specs/tutor_ai_agents/16-ux-principles-for-tutor-product-sokrat.md
3. docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules-sokrat.md
4. CLAUDE.md

Сейчас ничего не кодируй.

Проблема 1 (TASK-0A — CRITICAL):
AI bootstrap-сообщение галлюцинирует. При открытии задачи (из KB каталога,
с изображением, task_text="[Задача на фото]") AI пишет "Вижу твоё решение..."
хотя ученик ещё ничего не отправлял. Корневая причина описана в спеке:
buildTaskContext() вызывается с sendMode='question' для bootstrap,
что добавляет modeHint "Режим: промежуточный шаг решения" в контекст.

Проблема 2 (TASK-0B):
Репетитор просит возможность отключить AI-вступление к задачам.
Ученик должен начинать решать сам. Нужен toggle в конструкторе ДЗ (L1)
и поле disable_ai_bootstrap в БД.

Нужно:
1. подтвердить корневую причину TASK-0A в коде;
2. предложить минимальный fix для TASK-0A;
3. предложить план для TASK-0B (миграция + toggle + frontend guard);
4. перечислить files likely to change;
5. оценить risks.

Важно:
- не расширяй scope beyond эти две задачи;
- не трогай prompt improvements (TASK-1..6) — это следующие фазы;
- сохрани работающие части bootstrap для задач с текстовым условием.

Формат ответа:
1. Подтверждение корневой причины (с цитатами из кода)
2. Fix plan для TASK-0A
3. Fix plan для TASK-0B
4. Files likely to change
5. Risks
6. Recommendation: порядок реализации
```

### Промпт Phase 0, Шаг 2 — реализация

```text
Ок, теперь реализуй Phase 0 из approved plan: TASK-0A + TASK-0B.

Требования:
- строго следовать docs/features/specs/student-guided-hints-spec.md;
- TASK-0A: добавить sendMode 'bootstrap' в buildTaskContext, исправить
  modeHint, усилить anti-hallucination в buildGuidedSystemPrompt;
- TASK-0B: миграция disable_ai_bootstrap + toggle в HWExpandedParams +
  guard в bootstrap useEffect + SELECT в studentHomeworkApi;
- не трогать TASK-1..7 — это следующие фазы;
- не делать scope creep;
- сохранить работающие части системы.

В конце обязательно:
1. перечисли changed files
2. дай краткий summary реализации
3. покажи validation results (npm run lint && npm run build && npm run smoke-check)
4. напиши, какие документы нужно обновить после этой реализации

Проверь минимум:
- нужно ли обновить CLAUDE.md (секция guided homework)
- нужно ли обновить docs/features/specs/student-guided-hints-spec.md
```

---

## Phase 1 — Prompt Improvements (TASK-1, TASK-3, TASK-4)

### Промпт Phase 1, Шаг 1 — план

```text
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Нужно реализовать Phase 1 улучшений AI-промптов для guided homework chat.

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ;
- wedge: ученик решает ДЗ между уроками с AI-подсказками;
- AI = draft + action, а не chat-only output;
- Job: S1 — Получить подсказку при застревании;
- Sub-Jobs: S1-1 (понять условие), S1-4 (понять ошибку), все (next action).

Сначала обязательно прочитай документы:
1. docs/features/specs/student-guided-hints-spec.md — секция 5.1, TASK-1, TASK-3, TASK-4
2. docs/product/specs/tutor_ai_agents/16-ux-principles-for-tutor-product-sokrat.md
3. docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules-sokrat.md
4. supabase/functions/homework-api/guided_ai.ts — текущие промпты
5. CLAUDE.md

Сейчас ничего не кодируй.

Phase 1 включает три задачи (все — prompt-only, без UI):
- TASK-1: Structured Bootstrap (Дано / Найти / Ситуация)
- TASK-3: AI Suggests Next Action (во ВСЕХ трёх промптах)
- TASK-4: Error Explanation with Analogy (INCORRECT verdict)

Нужно:
1. показать текущие промпты для bootstrap, check, hint;
2. предложить конкретные diff-изменения в каждом промпте;
3. убедиться, что prompt changes не конфликтуют с TASK-0A fix;
4. проверить, что LaTeX в ответах AI будет рендериться корректно.

Важно:
- только файл guided_ai.ts + возможно streaming chat system prompt;
- не трогать frontend компоненты;
- не менять API-контракт;
- не добавлять новые зависимости.

Формат ответа:
1. Executive summary
2. Текущие промпты (цитаты из кода)
3. Предлагаемые изменения (diff-формат)
4. Files likely to change
5. Risks
6. Как тестировать: 3 примера задач для проверки
```

### Промпт Phase 1, Шаг 2 — реализация

```text
Ок, теперь реализуй Phase 1: TASK-1 + TASK-3 + TASK-4.

Требования:
- строго следовать docs/features/specs/student-guided-hints-spec.md;
- все изменения ТОЛЬКО в supabase/functions/homework-api/guided_ai.ts;
- TASK-1: обновить bootstrap prompt → Дано/Найти/Ситуация для длинных задач;
- TASK-3: добавить "предложи 1-2 следующих действия" во ВСЕ промпты
  (buildCheckPrompt, buildHintPrompt, streaming chat);
- TASK-4: обновить INCORRECT feedback → аналогия + дружелюбный тон;
- НЕ трогать TASK-2, TASK-5, TASK-6 — это Phase 2;
- сохранить работающую логику JSON-парсинга и verdict detection.

В конце обязательно:
1. перечисли changed files
2. дай краткий summary реализации
3. покажи validation results (npm run lint && npm run build && npm run smoke-check)
4. напиши, какие документы нужно обновить после этой реализации
5. self-check against docs 16, 17

Проверь минимум:
- нужно ли обновить CLAUDE.md
- нужно ли обновить docs/features/specs/student-guided-hints-spec.md
```

---

## Phase 2 — Prompt + Minor Backend (TASK-2, TASK-5, TASK-6)

### Промпт Phase 2, Шаг 1 — план

```text
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Нужно реализовать Phase 2 улучшений AI-промптов для guided homework chat.

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ;
- wedge: ученик решает ДЗ между уроками с AI-подсказками;
- AI = draft + action, а не chat-only output;
- Job: S1 — Получить подсказку при застревании;
- Sub-Jobs: S1-2 (выбрать подход), S1-3 (проверить шаг), S1-4 (понять ошибку).

Сначала обязательно прочитай документы:
1. docs/features/specs/student-guided-hints-spec.md — TASK-2, TASK-5, TASK-6
2. supabase/functions/homework-api/guided_ai.ts — текущие промпты (после Phase 1)
3. supabase/functions/homework-api/index.ts — handleCheckAnswer, handleRequestHint
4. CLAUDE.md

Сейчас ничего не кодируй.

Phase 2 включает:
- TASK-2: Progressive Hint Ladder (hint 1 → 2 → 3+ нарастающая конкретность)
- TASK-5: Error Summary After Correction (📌 Запомни после INCORRECT → CORRECT)
- TASK-6: Step Check в Discussion Mode (✅/⚠️ для промежуточных шагов)

Нужно:
1. показать текущий hint prompt (после Phase 1 changes);
2. предложить ladder-логику через hintCount в prompt;
3. для TASK-5: проверить, передаётся ли wrongAnswerCount в prompt.
   Если да — достаточно изменить prompt. Если нет — показать, что добавить;
4. для TASK-6: показать streaming chat prompt и предложить step-check инструкцию.

Важно:
- файлы: guided_ai.ts (промпты) + index.ts (message_kind SELECT для TASK-5);
- не трогать frontend;
- не менять API-контракт;
- hintCount УЖЕ передаётся в params — проверь.

Формат ответа:
1. Executive summary
2. Assumptions
3. Proposed changes per TASK
4. Files likely to change
5. Risks
6. Как тестировать: сценарии для hint ladder, error summary, step check
```

### Промпт Phase 2, Шаг 2 — реализация

```text
Ок, теперь реализуй Phase 2: TASK-2 + TASK-5 + TASK-6.

Сохрани:
- приоритет wedge: ученик не бросает задачу;
- action-first UX: каждый AI-ответ заканчивается предложением действия;
- tutor workflow context: репетитор видит осмысленный thread.

Требования:
- TASK-2: заменить "Если это не первая подсказка — сделай чуть конкретнее"
  на structured ladder: hint 1 = общий вопрос, hint 2 = конкретнее,
  hint 3+ = конкретный закон/формула (но без ответа!);
- TASK-5: при CORRECT verdict, если wrongAnswerCount > 0, добавить
  "📌 Запомни: [правило]". Добавить message_kind в SELECT conversationHistory;
- TASK-6: в streaming chat prompt добавить step-check инструкцию
  (✅ Верно / ⚠️ Проверь) для промежуточных шагов.

В конце обязательно:
1. перечисли changed files
2. дай краткий summary реализации
3. покажи validation results (npm run lint && npm run build && npm run smoke-check)
4. напиши, какие документы нужно обновить после этой реализации
5. self-check against docs 16, 17

Проверь минимум:
- нужно ли обновить CLAUDE.md
- нужно ли обновить docs/features/specs/
```

---

## Phase 3 — UI Cleanup (TASK-7)

### Промпт Phase 3

```text
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Прочитай docs 16, 17 и текущую реализацию GuidedHomeworkWorkspace.tsx.

Нужно реализовать TASK-7 из docs/features/specs/student-guided-hints-spec.md:
убрать нижнюю панель «Предыдущая / Следующая» из guided homework workspace.

Контекст:
- навигация между задачами дублируется: TaskStepper сверху + кнопки снизу;
- удаление освобождает ~40px на мобиле — критично для маленьких экранов;
- TaskStepper должен остаться единственной навигацией.

Требования:
1. удалить JSX-блок с кнопками Предыдущая/Следующая;
2. удалить неиспользуемые переменные (nextTaskOrder, canGoNext, handleGoNext);
3. удалить неиспользуемые импорты (ChevronLeft, ChevronRight);
4. убедиться, что TaskStepper работает как единственная навигация;
5. проверить: свободный порядок задач, per-task drafts, auto-scroll — всё работает.

Не расширяй scope.
Не делай redesign.

В конце обязательно:
1. перечисли changed files
2. дай краткий summary
3. покажи validation results (npm run lint && npm run build && npm run smoke-check)
4. напиши, какие документы нужно обновить после этой реализации

Проверь минимум:
- нужно ли обновить CLAUDE.md (секция Mobile UX polish / GuidedHomeworkWorkspace)
```

---

## Post-Implementation Review (после всех Phase)

### Промпт Review

```text
Сделай code review реализованной tutor feature:
"Подсказки при застревании — Guided Homework (TASK-0A..TASK-7)"

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ;
- wedge: ученик решает ДЗ между уроками с AI-подсказками;
- продукт = AI + база + домашки + материалы;
- нельзя скатываться в generic chat UX.

Сначала прочитай:
1. docs/features/specs/student-guided-hints-spec.md
2. docs/product/specs/tutor_ai_agents/16-ux-principles-for-tutor-product-sokrat.md
3. docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules-sokrat.md
4. docs/product/specs/tutor_ai_agents/19-agent-workflow-and-review-system-sokrat.md
5. supabase/functions/homework-api/guided_ai.ts
6. src/components/homework/GuidedHomeworkWorkspace.tsx
7. CLAUDE.md

Проверь:
1. Какой Job усиливает реализация? (S1 — подсказка при застревании)
2. Усиливает ли она wedge? (ученик не бросает ДЗ)
3. Нет ли product drift? (AI не стал generic chat)
4. Нет ли generic chat UX? (два поля, не один)
5. Есть ли clear primary CTA? (Answer → Проверить, Discussion → Написать)
6. Переводится ли AI-результат в действие? (каждый ответ → next step)
7. Не спрятан ли частый flow слишком глубоко?
8. Нет ли лишнего scope?
9. Нет ли architecture/state risks?
10. Нет ли mobile UX problems?
11. Bootstrap не галлюцинирует для image-only задач?
12. Toggle disable_ai_bootstrap работает корректно?

Формат ответа:
- Executive summary
- Must fix
- Should fix
- Nice to have
- Product drift risks
- UX risks
- Architecture/state risks
- Docs that may need update
```

---

## Полный чек-лист разработки

### Перед началом

```
□ Прочитаны canonical docs (16, 17, spec)
□ Определён тип задачи для каждой Phase
□ Job S1 и sub-jobs S1-1..S1-4 понятны
□ Wedge alignment подтверждён
□ Scope Phase 0..3 зафиксирован
```

### Phase 0 — Bootstrap Fix

```
□ TASK-0A: buildTaskContext() — sendMode 'bootstrap' добавлен
□ TASK-0A: modeHint для bootstrap НЕ содержит "промежуточный шаг"
□ TASK-0A: buildGuidedSystemPrompt — anti-hallucination усилен
□ TASK-0A: задача из KB с изображением → bootstrap НЕ галлюцинирует
□ TASK-0A: задача с текстовым условием → bootstrap работает как раньше
□ TASK-0B: миграция disable_ai_bootstrap выполнена
□ TASK-0B: toggle в HWExpandedParams (L1) добавлен
□ TASK-0B: bootstrap useEffect проверяет assignment.disable_ai_bootstrap
□ TASK-0B: SELECT в studentHomeworkApi включает disable_ai_bootstrap
□ TASK-0B: по умолчанию ВКЛ (bootstrap генерируется)
□ TASK-0B: при ВЫКЛ — ученик видит пустой чат
□ npm run lint ✓
□ npm run build ✓
□ npm run smoke-check ✓
□ Тест на Safari iOS: bootstrap + toggle
```

### Phase 1 — Prompt Improvements

```
□ TASK-1: bootstrap для длинных задач → Дано/Найти/Ситуация
□ TASK-1: для коротких задач (<100 символов) → краткий bootstrap
□ TASK-1: если есть image → prompt комментирует изображение
□ TASK-3: buildCheckPrompt → "предложи 1-2 следующих действия" добавлено
□ TASK-3: buildHintPrompt → "предложи следующий шаг" добавлено
□ TASK-3: streaming chat → next action добавлен
□ TASK-3: AI НЕ предлагает абстрактные фразы ("подумай ещё")
□ TASK-4: INCORRECT + concept error → аналогия из жизни
□ TASK-4: INCORRECT + calculation error → конкретный шаг с ошибкой
□ TASK-4: тон дружелюбный, без осуждения
□ TASK-4: LaTeX в объяснении рендерится корректно
□ npm run lint ✓
□ npm run build ✓
□ npm run smoke-check ✓
□ Ручной тест: 5 задач — каждый ответ AI содержит actionable suggestion
```

### Phase 2 — Prompt + Backend

```
□ TASK-2: hint 1 → общий наводящий вопрос (без названия закона)
□ TASK-2: hint 2 → конкретнее (область физики / тип задачи)
□ TASK-2: hint 3+ → конкретный закон/формула (без подстановки чисел)
□ TASK-2: AI НЕ даёт готовый ответ даже на 5+ подсказке
□ TASK-2: score penalty -0.1 за подсказку сохранён
□ TASK-5: при CORRECT + wrongAnswerCount > 0 → "📌 Запомни: [правило]"
□ TASK-5: при CORRECT с 1-й попытки → резюме НЕ генерируется
□ TASK-5: message_kind добавлен в SELECT conversationHistory
□ TASK-6: AI распознаёт step-check intent (проверь, правильно?, верно?)
□ TASK-6: верный шаг → "✅ Верно, продолжай!" + следующий шаг
□ TASK-6: неверный шаг → "⚠️ Проверь..." + подсказка без ответа
□ TASK-6: score НЕ снижается при step check через Discussion
□ npm run lint ✓
□ npm run build ✓
□ npm run smoke-check ✓
□ Ручной тест: 3 подсказки подряд → нарастание конкретности
□ Ручной тест: ошибка → исправление → резюме "📌 Запомни"
□ Ручной тест: step check в Discussion → ✅/⚠️
```

### Phase 3 — UI Cleanup

```
□ TASK-7: нижняя полоса Предыдущая/Следующая удалена
□ TASK-7: TaskStepper — единственная навигация
□ TASK-7: неиспользуемые переменные и импорты удалены
□ TASK-7: свободный порядок задач работает
□ TASK-7: per-task drafts работают
□ TASK-7: auto-scroll работает
□ TASK-7: на мобиле: +40px пространства для чата
□ npm run lint ✓
□ npm run build ✓
□ npm run smoke-check ✓
□ Тест на Safari iOS: навигация через TaskStepper
```

### После реализации

```
□ Code review по промпту Review (doc 20 паттерн 4)
□ CLAUDE.md обновлён (секция Guided Homework)
□ Spec обновлён (статус, дата, что реализовано)
□ Проверить: нужно ли обновить doc 16 (UX principles)
□ Проверить: нужно ли обновить doc 17 (UI patterns)
□ Проверить: нужно ли обновить doc 15 (backlog of JTBD)
□ Проверить: нужно ли обновить doc 18 (pilot playbook)
□ Кросс-браузер: Chrome desktop, Chrome Android, Safari iOS
□ Метрики baseline зафиксированы (abandonment, discussion msgs, hint requests)
```
