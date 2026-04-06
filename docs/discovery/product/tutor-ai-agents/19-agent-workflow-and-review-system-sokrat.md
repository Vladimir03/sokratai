# 19. Agent Workflow & Review System — Сократ

**Продукт:** Сократ  
**Версия:** v0.1  
**Статус:** операционный документ для AI-native разработки  
**Дата:** 2026-03-13

---

## Зачем нужен этот документ

Этот документ фиксирует **операционную систему AI-native разработки** в Сократе.

Он нужен, чтобы:

- продукт не уезжал от jobs;
- UX не расползался в “чат ради чата”;
- AI Agents не принимали product decisions из воздуха;
- каждая новая фича усиливала шанс платного пилота;
- Claude Code, Codex, Cowork, `CLAUDE.md` и `AGENTS.md` работали как единая система.

---

## Главный принцип

> AI Agents не определяют продуктовую стратегию самостоятельно.  
> Они реализуют и уточняют решения внутри каноничных продуктовых документов.

То есть:

- **исследование и продуктовая логика** идут из AJTBD-документов;
- **UX/UI-канон** идёт из документов 16 и 17;
- **реализация** идёт через feature-specs и development tasks;
- **ревью** идёт через независимый второй агент + человека;
- **сигналы пилота** возвращаются обратно в research и product docs.

---

## Каноничный порядок источников истины

Для любой новой tutor feature агент должен читать документы **в этом порядке**:

### Уровень 1 — why / jobs / wedge
1. `docs/product/research/ajtbd/08-wedge-decision-memo-sokrat.md`
2. `docs/product/specs/tutor_ai_agents/14-ajtbd-product-prd-sokrat.md`
3. `docs/product/specs/tutor_ai_agents/15-backlog-of-jtbd-scenarios-sokrat.md`

### Уровень 2 — UX / UI canon
4. `docs/product/specs/tutor_ai_agents/16-ux-principles-for-tutor-product-sokrat.md`
5. `docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules-sokrat.md`

### Уровень 3 — pilot / validation context
6. `docs/product/specs/tutor_ai_agents/18-pilot-execution-playbook-sokrat.md`

### Уровень 4 — feature implementation
7. релевантный файл из `docs/features/specs/`

---

## Роли инструментов

## 1. Claude Code — основной implementer

### Роль
Claude Code = основной агент для:
- реализации фич;
- написания и изменения кода;
- миграций;
- компонентов;
- task breakdown;
- refactor в рамках scope;
- тестов и проверки локальной сборки.

### Что Claude Code не должен делать
- менять wedge без explicit решения человека;
- придумывать новый core segment;
- расширять scope “потому что кажется полезным”;
- превращать помощника в generic AI chat;
- игнорировать документы 14, 16, 17.

### Правильный тип задач для Claude Code
- “реализуй flow из feature spec”;
- “добавь drawer выбора задач из базы в ДЗ”;
- “обнови UI по document 17”;
- “исправь friction point, найденный на пилоте”.

---

## 2. Codex / VS Code review — независимый reviewer

### Роль
Codex = второй независимый агент для:
- code review;
- поиска архитектурных рисков;
- проверки edge cases;
- верификации API / документации;
- поиска расхождений между реализацией и spec.

### Что Codex должен проверять
- соответствует ли реализация wedge;
- соответствует ли реализация UX/UI-документам;
- не добавил ли Claude Code scope creep;
- не сделал ли generic chat UX;
- нет ли регрессий;
- нет ли слабых мест в state, naming, action hierarchy.

### Что Codex не должен делать
- заменять Claude Code как основного builder без причины;
- самостоятельно переопределять продуктовые приоритеты;
- предлагать большие refactor без привязки к wedge и pilot value.

---

## 3. Cowork — research / synthesis / GTM / pilot assistant

### Роль
Cowork = knowledge-work agent.

Используем для:
- ревью продуктовых документов;
- исследования best practices;
- сравнения конкурентов;
- подготовки офферов;
- weekly synthesis по пилоту;
- анализа повторяющихся сигналов;
- review copy / onboarding / landing;
- подготовки decision support materials.

### Что Cowork не должен делать
- быть основным implementer кода;
- принимать решения о product scope без source docs;
- писать generic product strategy без привязки к AJTBD.

### Типовые задачи для Cowork
- “изучи best practices и проревьюй document 17”;
- “собери recurring pilot signals за неделю”;
- “предложи 3 варианта value messaging для репетиторов”;
- “сравни наш workflow с тем, как реально работают tutor tools”.

---

## 4. Человек / CEO / product owner

### Роль
Человек — единственный субъект, который:
- принимает решения об изменении wedge;
- меняет сегмент;
- меняет pricing;
- решает, что считать успехом пилота;
- утверждает новые product docs;
- принимает или отклоняет большие refactor и новые направления.

### Что нельзя отдавать полностью агентам
- product strategy;
- pricing;
- pilot success criteria;
- смену segment / wedge;
- решение “что строим дальше”.

---

## Артефакты и их роль

### AJTBD research docs
Используются как source of truth для:
- jobs;
- сегмента;
- wedge;
- value hypotheses.

### Product docs
Используются как source of truth для:
- упаковки продукта;
- scope;
- pilot logic;
- product flows.

### UX/UI docs
Используются как source of truth для:
- naming;
- hierarchy;
- action patterns;
- state patterns;
- anti-patterns.

### Feature specs
Используются как source of truth для:
- конкретной реализации;
- acceptance criteria;
- технических решений внутри уже подтверждённого scope.

---

## Workflow по новой фиче

## Шаг 1. Уточнить, зачем нужна фича
Вопросы:
- какой job она усиливает?
- усиливает ли она wedge?
- повышает ли шанс платного пилота?
- это P0 / P1 / P2 scenario?

Если ответ неясен — не идти в код.

## Шаг 2. Найти каноничные документы
Минимум:
- `08-wedge-decision-memo`
- `14-ajtbd-product-prd`
- `15-backlog-of-jtbd-scenarios`
- `16-ux-principles`
- `17-ui-patterns`

## Шаг 3. Создать или обновить feature spec
Путь:
`docs/features/specs/...`

### Feature spec должен отвечать:
- какой сценарий усиливаем;
- какой главный CTA;
- какой expected outcome;
- какие состояния;
- что не входит в scope.

## Шаг 4. Передать реализацию Claude Code
Формат задачи:
- какие документы прочитать;
- что именно реализовать;
- что не делать;
- acceptance criteria;
- какие файлы можно менять.

## Шаг 5. Отдать реализацию на review в Codex
Codex должен проверять:
- соответствие docs;
- architecture;
- edge cases;
- regressions;
- product drift.

## Шаг 6. Принять правки через Claude Code
Правки делаем только после review triage:
- must fix;
- should fix;
- future consideration.

## Шаг 7. Если фича идёт в пилот — логировать signal
После выпуска:
- usage;
- friction;
- qualitative quotes;
- pilot implication.

---

## Workflow по продуктовой гипотезе / пилотному сигналу

## Шаг 1. Получить сигнал
Источники:
- интервью;
- пилотный фидбек;
- поведение пользователей;
- support;
- Cowork synthesis.

## Шаг 2. Привязать сигнал к job / сценарию
Нельзя писать:
- “пользователи хотят кнопку X”.

Нужно писать:
- “в сценарии Y пользователь застревает на этапе Z”.

## Шаг 3. Обновить один из документов
Какой документ обновлять:
- job / segment → research docs;
- wedge / scope → product docs;
- UX pattern → doc 16/17;
- конкретная реализация → feature spec.

## Шаг 4. Только потом менять код
Не наоборот.

---

## Правила good request к AI Agent

Хороший запрос к Claude Code / Codex / Cowork должен содержать:

1. **Роль** агента
2. **Контекст продукта**
3. **Фокусный сегмент**
4. **Wedge**
5. **Какие документы прочитать**
6. **Что конкретно нужно сделать**
7. **Что нельзя делать**
8. **Формат ответа / артефакта**

### Пример правильного запроса
> Прочитай docs 08, 14, 16, 17 и feature spec X.  
> Реализуй flow добавления задач из базы в ДЗ.  
> Не расширяй scope в сторону generic chat.  
> Сохрани приоритет на wedge “собрать ДЗ и новую практику по теме”.

---

## Правила плохих запросов

Плохие запросы:
- “сделай красивый экран помощника”
- “улучши UX”
- “придумай новые фичи”
- “сделай как лучший edtech”
- “добавь AI в этот экран”

Почему они плохие:
- не привязаны к job;
- не привязаны к wedge;
- провоцируют agent drift;
- создают generic output.

---

## Каноничные guardrails

### Guardrail 1
Если идея не усиливает P0/P1 сценарии, она не приоритет.

### Guardrail 2
Если экран выглядит как generic chat, значит UX drift уже начался.

### Guardrail 3
Если AI output не переводится в действие (`В ДЗ`, `В базу`, `Экспорт`), значит ценность недостроена.

### Guardrail 4
Если фича не помогает пилоту, она не должна ломать сроки пилота.

### Guardrail 5
Если агент предлагает “полезную” фичу, но не может привязать её к job и wedge, фича не принимается.

---

## Что должно быть в CLAUDE.md

В `CLAUDE.md` нужно держать короткий operational memory block.

### Рекомендуемый блок

```md
## Tutor AI Agents — canonical docs

Read in this order before implementing tutor features:
1. docs/product/research/ajtbd/08-wedge-decision-memo-sokrat-v0.1.md
2. docs/product/specs/tutor_ai_agents/14-ajtbd-product-prd-sokrat-v0.1.md
3. docs/product/specs/tutor_ai_agents/15-backlog-of-jtbd-scenarios-sokrat-v0.1.md
4. docs/product/specs/tutor_ai_agents/16-ux-principles-for-tutor-product-sokrat-v0.2.md
5. docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules-sokrat-v0.2.md
6. relevant file in docs/features/specs/

Rules:
- Do not expand scope beyond the current wedge.
- Prioritize tutor workflows around homework and practice generation.
- AI = draft + action, not chat-only output.
- Prefer additive iterations over refactors unless explicitly asked.
```

---

## Что должно быть в AGENTS.md

В `AGENTS.md` лучше держать короткие project rules для Codex и других агентов.

### Рекомендуемый блок

```md
For tutor product tasks:
- Start from AJTBD docs before proposing features.
- Review code against wedge, UX principles, and implementation specs.
- Flag any feature that looks useful but does not strengthen the paid pilot.
- Do not turn Tutor Assistant into a generic chat product.
- Prefer flows that end in action: add to homework, save to base, export/share.
```

---

## Что должно быть в hooks / local workflow

Если используешь hooks или полуавтоматические проверки, они должны помогать дисциплине, а не создавать шум.

### После изменения feature files
- run lint / build / relevant tests

### После изменения product docs
- remind to update checklist
- remind to sync affected feature specs

### После изменений в tutor assistant
- run UX review checklist:
  - wedge?
  - action-first?
  - not chat-first?
  - clear primary CTA?
  - result status visible?

---

## Review checklist для Codex

Перед принятием tutor feature Codex должен ответить на 8 вопросов:

1. Какой job усиливает эта реализация?
2. Усиливает ли она wedge?
3. Не уехал ли UX в generic chat?
4. Есть ли чёткий primary CTA?
5. Переводится ли AI output в действие?
6. Явны ли состояния результата?
7. Не прячется ли частый workflow слишком глубоко?
8. Не добавлен ли лишний scope?

---

## Weekly operating rhythm

### Раз в неделю
- review pilot signals;
- review what shipped;
- review what changed in product docs;
- reprioritize only through JTBD backlog.

### Раз в 2 недели
- пройтись по:
  - `15-backlog-of-jtbd-scenarios`
  - `18-pilot-execution-playbook`
- обновить приоритеты P0/P1/P2.

### Раз в месяц
- audit:
  - CLAUDE.md
  - AGENTS.md
  - source-of-truth docs
  - feature specs that may be outdated.

---

## Что считать нарушением системы

Нарушение системы, если:
- feature shipped without checking wedge;
- UI screen built from taste, not docs;
- agent invented new scope;
- pilot signals ignored;
- docs and implementation diverged;
- “чат ради чата” просочился в продукт;
- backlog стал фиче-бэклогом вместо scenario backlog.

---

## Definition of Done для AI-native feature

Фича считается done только если:

1. есть связь с job / scenario;
2. есть связь с wedge;
3. есть feature spec;
4. Claude Code реализовал;
5. Codex сделал review;
6. учтены замечания;
7. фича не ломает UX/UI-канон;
8. есть понятный success signal;
9. если это pilot feature — она вписана в pilot metrics.

---

## Следующий уровень зрелости системы

После внедрения этого документа система должна перейти из режима:
> “у нас много AI-инструментов”

в режим:
> “у нас есть управляемая AI-native product operating system”.

---

## Связанные документы

Этот документ опирается на:
- `08-wedge-decision-memo`
- `14-ajtbd-product-prd`
- `15-backlog-of-jtbd-scenarios`
- `16-ux-principles-for-tutor-product`
- `17-ui-patterns-and-component-rules`
- `18-pilot-execution-playbook`

И должен использоваться вместе с:
- `CLAUDE.md`
- `AGENTS.md`
- feature specs in `docs/features/specs/`
