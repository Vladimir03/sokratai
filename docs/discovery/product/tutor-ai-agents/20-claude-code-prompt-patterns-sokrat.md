# 20. Claude Code Prompt Patterns — Сократ

**Продукт:** Сократ  
**Версия:** v0.1  
**Статус:** операционный документ для запуска разработки через Claude Code  
**Дата:** 2026-03-13

---

## Зачем нужен этот документ

Этот документ нужен, чтобы запускать разработку в Claude Code **не из головы и не “по вдохновению”**, а по повторяемому стандарту.

Он должен помогать:
- не терять связь с Jobs и wedge;
- не скатываться в generic chat UX;
- не делать большие рефакторы без плана;
- не забывать про UX/UI-канон;
- не забывать обновлять документацию после реализации.

---

## Главный принцип

> Любая tutor feature сначала запускается через документы, потом через план, и только потом через код.

Порядок всегда такой:

1. Определить тип задачи  
2. Подтянуть canonical docs  
3. Попросить Claude Code сделать audit / plan  
4. Утвердить plan  
5. Реализовывать по фазам  
6. Отдать в review  
7. Обновить документацию

---

## Каноничный стек документов для tutor feature

Для любой tutor-задачи Claude Code должен читать документы **в таком порядке**:

1. `docs/product/research/ajtbd/08-wedge-decision-memo-sokrat.md`
2. `docs/product/specs/tutor_ai_agents/14-ajtbd-product-prd-sokrat.md`
3. `docs/product/specs/tutor_ai_agents/15-backlog-of-jtbd-scenarios-sokrat.md`
4. `docs/product/specs/tutor_ai_agents/16-ux-principles-for-tutor-product-sokrat.md`
5. `docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules-sokrat.md`
6. `docs/product/specs/tutor_ai_agents/19-agent-workflow-and-review-system-sokrat.md`
7. relevant feature spec из `docs/features/specs/`
8. `CLAUDE.md`
9. `AGENTS.md`

Если задача затрагивает пилот или packaging, дополнительно читать:
- `docs/product/specs/tutor_ai_agents/18-pilot-execution-playbook-sokrat.md`

---

## Как выбрать тип задачи

Перед запуском Claude Code сначала определить тип задачи.

### Тип A — новая фича
Использовать, если нужный flow ещё не реализован.

Примеры:
- добавить новый flow в Домашки;
- встроить Базу знаний в draft ДЗ;
- добавить новый AI-result action.

### Тип B — рефакторинг flow
Использовать, если текущий flow уже есть, но его надо переосмыслить.

Примеры:
- полностью переработать flow Домашек;
- переосмыслить UX Помощника;
- переписать screen hierarchy.

### Тип C — UX polish / fix
Использовать, если core flow уже правильный, но есть friction.

Примеры:
- улучшить mobile layout;
- поправить CTA;
- улучшить states;
- сделать batch operation понятнее.

---

## Паттерн 1. Новая фича

### Шаг 1 — только plan

```text
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Нужно поработать над tutor feature:
[НАЗВАНИЕ ЗАДАЧИ]

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ;
- wedge: быстро собрать ДЗ и новую практику по теме урока;
- продукт = workspace / bundle: AI + база + домашки + материалы;
- AI = draft + action, а не generic chat.

Сначала обязательно прочитай документы:
1. docs/product/research/ajtbd/08-wedge-decision-memo-sokrat.md
2. docs/product/specs/tutor_ai_agents/14-ajtbd-product-prd-sokrat.md
3. docs/product/specs/tutor_ai_agents/15-backlog-of-jtbd-scenarios-sokrat.md
4. docs/product/specs/tutor_ai_agents/16-ux-principles-for-tutor-product-sokrat.md
5. docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules-sokrat.md
6. docs/product/specs/tutor_ai_agents/19-agent-workflow-and-review-system-sokrat.md
7. [RELEVANT FEATURE SPEC]
8. CLAUDE.md
9. AGENTS.md

Сейчас ничего не кодируй.

Нужно:
1. понять текущий flow / relevant files;
2. выделить assumptions;
3. предложить minimal vertical slice;
4. разбить реализацию на 3–5 фаз максимум;
5. сказать, нужен ли новый feature spec.

Важно:
- не расширяй scope beyond wedge;
- не делай generic chat UX;
- не придумывай новые product decisions из воздуха.

Формат ответа:
1. Executive summary
2. Assumptions
3. Proposed plan
4. Files likely to change
5. Risks
6. Recommendation: с чего начать первым
```

### Шаг 2 — реализация первой фазы

```text
Ок, теперь реализуй только Phase 1 из своего approved plan.

Требования:
- строго следовать docs и feature spec;
- не трогать следующие фазы;
- не делать scope creep;
- сохранить работающие части системы.

В конце:
1. changed files
2. что сделано
3. что осталось
4. validation results
5. self-check against docs 16, 17, 19
6. какие документы нужно обновить после этой реализации
```

### Шаг 3 — реализация следующих фаз

```text
Теперь реализуй Phase 2–3 из approved plan.

Сохрани:
- приоритет wedge;
- action-first UX;
- tutor workflow context.

В конце дай:
1. changed files
2. summary
3. out of scope
4. validation
5. docs-to-update checklist
```

---

## Паттерн 2. Рефакторинг flow

### Шаг 1 — audit + redesign proposal

```text
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Мне не нравится текущий flow:
[НАЗВАНИЕ FLOW]

Сначала ничего не реализуй.

Нужно:
1. сделать audit текущего flow;
2. найти, что противоречит jobs / wedge / docs 16/17;
3. предложить target flow v2;
4. составить migration plan по фазам;
5. предложить новый feature spec, если нужен.

Сначала прочитай canonical tutor docs + relevant feature spec + CLAUDE.md + AGENTS.md.

Важно:
- не делать redesign ради красоты;
- не расширять scope;
- не предлагать generic chat UX;
- каждая рекомендация должна усиливать шанс платного пилота.

Формат ответа:
1. Executive summary
2. Current flow audit
3. Top UX/UI problems
4. Target flow v2
5. Что оставить / что переписать
6. Migration plan
7. Draft structure for new spec
```

### Шаг 2 — создать spec v2

```text
Теперь создай новый spec:

docs/features/specs/[FLOW]-v2.md

Ничего не реализуй.

Spec должен включать:
- Problem
- Jobs / wedge alignment
- Goals / non-goals
- Current flow problems
- Target flow v2
- Screen-by-screen UX
- States
- Desktop / mobile behavior
- Integrations
- Migration constraints
- Acceptance criteria
- Out of scope
```

### Шаг 3 — реализовать только первую фазу миграции

```text
Теперь реализуй только Phase 1 migration из approved plan.

Не переходи к следующим фазам.
В конце:
1. changed files
2. что сделано
3. какие риски остались
4. validation
5. docs-to-update checklist
```

---

## Паттерн 3. UX polish / fix

### Шаг 1 — найти 3–5 конкретных проблем

```text
Прочитай docs 16, 17, 19 и текущую реализацию [НАЗВАНИЕ ЭКРАНА / FLOW].

Сначала ничего не кодируй.

Нужно:
1. найти 3–5 самых конкретных UX проблем;
2. привязать каждую к job / wedge;
3. предложить минимальные fixes без большого refactor.

Формат:
1. Current problems
2. Why they matter
3. Minimal fixes
4. Files likely to change
5. Recommendation: какие 1–2 fixes делать первыми
```

### Шаг 2 — реализовать только 1–2 fixes

```text
Реализуй только fixes 1–2 из approved list.

Не расширяй scope.
Не делай redesign.
В конце:
1. changed files
2. что улучшено
3. что осталось
4. validation
5. docs-to-update checklist
```

---

## Паттерн 4. Review в Codex

```text
Сделай code review реализованной tutor feature:
[НАЗВАНИЕ ФИЧИ]

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ;
- wedge: быстро собрать ДЗ и новую практику по теме урока;
- продукт = AI + база + домашки + материалы;
- нельзя скатываться в generic chat UX.

Сначала прочитай:
1. docs/product/research/ajtbd/08-wedge-decision-memo-sokrat1.md
2. docs/product/specs/tutor_ai_agents/14-ajtbd-product-prd-sokrat.md
3. docs/product/specs/tutor_ai_agents/16-ux-principles-for-tutor-product-sokrat.md
4. docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules-sokrat.md
5. docs/product/specs/tutor_ai_agents/19-agent-workflow-and-review-system-sokrat.md
6. corresponding feature spec

Проверь:
1. Какой Job усиливает реализация?
2. Усиливает ли она wedge?
3. Нет ли product drift?
4. Нет ли generic chat UX?
5. Есть ли clear primary CTA?
6. Переводится ли результат в действие?
7. Не спрятан ли частый flow слишком глубоко?
8. Нет ли лишнего scope?
9. Нет ли architecture/state risks?
10. Нет ли mobile UX problems?

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

## Что всегда добавлять в запрос Claude Code

В любом tutor-запросе старайся явно прописывать:

1. **Сегмент**
   - репетиторы по физике ЕГЭ/ОГЭ

2. **Wedge**
   - быстро собрать ДЗ и новую практику по теме урока

3. **Продуктовая рамка**
   - workspace / bundle: AI + база + домашки + материалы

4. **AI правило**
   - AI = draft + action, а не chat-only output

5. **Что нельзя**
   - no generic chat UX
   - no scope expansion
   - no new product strategy decisions

---

## Anti-patterns запуска

### Anti-pattern 1
Сразу просить “полностью реализуй фичу”, не увидев plan.

### Anti-pattern 2
Давать все документы подряд без фильтра.

### Anti-pattern 3
Не указывать, какой Job усиливается.

### Anti-pattern 4
Не ограничивать scope.

### Anti-pattern 5
Не просить финальный блок:
- changed files
- validation
- docs-to-update

---

## Обязательный блок в конце каждого dev-запроса

Добавляй в конец каждого запроса такой блок:

```text
В конце обязательно:
1. перечисли changed files
2. дай краткий summary реализации
3. покажи validation results
4. напиши, какие документы нужно обновить после этой реализации

Проверь минимум:
- нужно ли обновить docs/features/specs/
- нужно ли обновить docs/product/specs/tutor_ai_agents/16-ux-principles-for-tutor-product...
- нужно ли обновить docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules...
- нужно ли обновить docs/product/specs/tutor_ai_agents/15-backlog-of-jtbd-scenarios...
- нужно ли обновить docs/product/specs/tutor_ai_agents/18-pilot-execution-playbook...
```

---

## Мини-чеклист перед каждым запуском Claude Code

```text
□ Я понимаю, это новая фича, рефакторинг или polish?
□ Я могу назвать Job, который усиливаю?
□ Я могу объяснить, как это усиливает wedge?
□ Я дал только нужные документы?
□ Я сначала прошу plan, если задача большая?
□ Я ограничил scope?
□ Я попросил docs-to-update в конце?
```

---

## Связанные документы

Этот документ нужно использовать вместе с:
- `19-agent-workflow-and-review-system`
- `16-ux-principles-for-tutor-product`
- `17-ui-patterns-and-component-rules`
- `15-backlog-of-jtbd-scenarios`
