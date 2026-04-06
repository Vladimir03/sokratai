# Solo Founder AI Playbook — SokratAI

> Как один человек управляет продуктом, кодом, маркетингом и пилотом с помощью AI-агентов.
>
> Автор: Vladimir Kamchatkin × Claude · Дата: 2026-03-31

---

## Часть 1: Текущая система и где она ломается

### Что работает

| Практика | Статус | Источник |
|---|---|---|
| Spec → Tasks → Implementation | ✅ Работает | AGENTS.md, doc 19 |
| Discovery docs как source of truth | ✅ Работает | docs 08–18 |
| CLAUDE.md + .claude/rules/ | ✅ Начато | 786 строк + 5 rules |
| Signals framework | ✅ Начато | docs/discovery/signals/ |
| Разделение Claude Code / Codex | ✅ Работает | fullstack↔backend split |

### Где ломается

| Проблема | Симптом | Частота |
|---|---|---|
| Баги проскакивают в прод | Егор или ученики находят, а не тесты | Каждый спринт |
| Контекст теряется между сессиями | Агент повторяет ошибки или забывает решения | Каждая длинная сессия |
| Переключение ролей | Код → маркетинг → продукт → поддержка: 15–30 мин на «вкатиться» | Ежедневно |
| Приоритизация размывается | Много идей, непонятно что двигает пилот | Еженедельно |
| CLAUDE.md перегружен | 786 строк, агент грузит всё даже для баннера | Каждая сессия |
| Two-agent review не структурирован | Claude Code и Codex работают параллельно, но не как автор→ревьюер | Каждая фича |

---

## Часть 2: Action Items — внедрить на этой неделе

### Action 1: Testable Acceptance Criteria в спеках

**Проблема**: smoke tests проверяют «билд не сломался», но не «фича работает как в спеке».

**Что сделать**:
- В каждую новую спеку добавлять секцию `## Acceptance Criteria (testable)`
- Каждый критерий = конкретная проверка, которую агент может выполнить после реализации
- Добавить правило в `.claude/rules/` — агент не отмечает задачу как done, пока не прогнал AC

**Пример (guided chat two fields)**:
```
## Acceptance Criteria (testable)
- AC-1: Enter в AnswerField вызывает onSendAnswer → smoke: render + simulate keyDown
- AC-2: Enter в DiscussionField вызывает onSendStep → smoke: render + simulate keyDown
- AC-3: Ctrl+Enter нигде не обрабатывается → grep -r "ctrl.*enter" src/ = 0 matches
- AC-4: attachedFiles shared между полями → smoke: add file, switch field, file visible
```

**Effort**: ~10 минут на спеку. Окупается при первом пойманном баге.

### Action 2: Structured Two-Agent Review

**Проблема**: Claude Code и Codex работают параллельно по доменам, но нет ревью «решает ли код Job?»

**Что сделать** — после реализации фичи запускать ревью-агента с этим промптом:

```
Ты — независимый ревьюер SokratAI. Тебе запрещено смотреть на код первым.

Порядок:
1. Прочитай docs/discovery/product/tutor-ai-agents/14-ajtbd-product-prd-sokrat.md
2. Прочитай docs/discovery/product/tutor-ai-agents/16-ux-principles-for-tutor-product-sokrat.md
3. Прочитай docs/discovery/product/tutor-ai-agents/17-ui-patterns-and-component-rules-sokrat.md
4. Прочитай спеку фичи: [путь]
5. Теперь посмотри git diff main...HEAD

Ответь на 5 вопросов:
- Какой Job (из doc 14) эта фича усиливает?
- Нарушены ли UX-принципы из doc 16?
- Нарушены ли UI-паттерны из doc 17?
- Есть ли scope creep (код, который не требует спека)?
- Есть ли regression risk для high-risk файлов?

Формат: PASS / FAIL + конкретные замечания.
```

**Ключевое правило**: ревьюер работает в **чистой сессии** (новый терминал / Codex task). Если он видит контекст автора — он соглашается.

**Когда запускать**: не на каждый коммит, а на каждую **фичу** перед мержем. 4–8 задач/день → 1–2 ревью/день.

### Action 3: Декомпозиция CLAUDE.md

**Проблема**: 786 строк грузятся в каждую сессию. Агент, делающий маркетинговый баннер, читает про `homework_tutor_thread_messages`.

**Что сделать** — вынести domain-specific секции в `.claude/rules/`:

| Файл | Содержимое | Строк |
|---|---|---|
| `40-homework-system.md` | Система ДЗ, guided chat, workflow modes, таблицы | ~150 |
| `50-kb-module.md` | База знаний, модерация, Source→Copy, fingerprint | ~120 |
| `60-telegram-bot.md` | Бот, /pay, invite flow, auth flow | ~80 |
| `70-notifications.md` | Push, email, каскад доставки, VAPID | ~80 |
| `80-cross-browser.md` | Safari/iOS правила, запрещённые паттерны | ~60 |

**В CLAUDE.md оставить**: архитектуру, критические правила (форматирование, profiles.email), high-risk файлы, общий workflow. Цель: ≤250 строк.

**Effort**: 2–3 часа один раз. Экономит контекст в каждой будущей сессии.

### Action 4: Session Handoff Protocol

**Проблема**: длинные сессии теряют контекст (мы буквально только что это пережили).

**Что сделать** — добавить правило в `.claude/rules/`:

```markdown
# Session Handoff

Перед завершением длинной сессии (или если контекст > 70%) агент создаёт:

`docs/delivery/handoffs/YYYY-MM-DD-{topic}.md`

Формат:
## Что сделано
- [список конкретных изменений с файлами]

## Что осталось
- [список незавершённых задач]

## Ключевые решения
- [решения, которые нельзя вывести из кода]

## Контекст для следующей сессии
- [что должен знать следующий агент]
```

**Когда использовать**: любая сессия, где сделано > 3 изменений или принято архитектурное решение.

### Action 5: Signal → Backlog Pipeline

**Проблема**: signals записываются, но не превращаются в приоритеты.

**Что сделать**:
1. После каждого signal — добавлять `## Impact` секцию: какой Job усиливает, блокирует ли пилот
2. Раз в неделю (или по триггеру): пересмотреть backlog через линзу signals
3. Правило: signal из пилота весит больше, чем внутренняя идея

**Пример** (signal Егора про «развернутое решение»):
```markdown
## Impact
- Job: R1 (проверять ДЗ) + R2 (понимать ход решения)
- Pilot blocker: нет (nice-to-have для текущего пилота)
- Priority: P1 — усиливает wedge, но не блокирует текущий guided flow
- Action: добавить в backlog Sprint S5+, не ломать текущий scope
```

---

## Часть 3: Стратегические правила

### Правило 1: Один агент — одна роль

Не давай одному агенту две роли в одной сессии. «Сделай фичу и потом проверь себя» = нет ревью. «Напиши код и маркетинговый текст» = плохо и то, и другое.

| Роль | Инструмент | Контекст |
|---|---|---|
| Engineer | Claude Code | CLAUDE.md + спека фичи |
| Reviewer | Codex (чистая сессия) | Discovery docs + diff |
| Product | Cowork / Claude | Discovery docs + signals |
| Marketing | Cowork / Claude | Messaging matrix + AJTBD |

### Правило 2: Discovery docs — конституция

Агент может написать любой код, но не может менять:
- Wedge (репетиторы физики ЕГЭ/ОГЭ)
- Segment (B2B2C через репетитора)
- Core Jobs (R1–R4 из doc 14)
- UX principles (doc 16)

Если фича не усиливает один из Core Jobs — она не приоритет.

### Правило 3: Incremental > Perfect

786 строк CLAUDE.md не появились за день. Каждая фича добавляла «ещё одну секцию». То же происходит со спеками, тестами, документацией.

Правило: после каждого спринта — 30 минут на «гигиену»:
- Перенести новые секции из CLAUDE.md в .claude/rules/
- Удалить handoffs старше 2 недель
- Пометить устаревшие signals как `archived`

### Правило 4: Пилот — единственный приоритет до product-market fit

Bottleneck «привлечение пользователей» решается не кодом, а пилотом. Каждая задача проходит фильтр: «Это помогает Егору (и следующим 5 репетиторам) платить и оставаться?»

Если нет — задача уходит в backlog. Не в «потом сделаем», а в конкретный `P2-backlog.md` с Job-привязкой.

### Правило 5: Автоматизируй повторяющееся переключение

4 роли × ежедневное переключение = потерянные часы. Что можно автоматизировать:
- **Утренний стендап**: scheduled task → «Что изменилось вчера? Какие signals? Что в backlog?»
- **Post-deploy check**: после мержа → агент проверяет preview на smoke-level
- **Weekly signal review**: раз в неделю → собрать все signals, пересортировать backlog

---

## Часть 4: Метрики успеха

Как понять, что playbook работает:

| Метрика | Сейчас | Цель (через 2 недели) |
|---|---|---|
| Баги, найденные пользователями | ~2-3 на спринт | ≤1 (остальные ловятся AC или ревью) |
| Потеря контекста между сессиями | Часто | Редко (handoffs работают) |
| Время на переключение ролей | 15–30 мин | 5 мин (role-specific prompts) |
| CLAUDE.md размер | 786 строк | ≤250 строк (остальное в rules/) |
| Signals → Backlog pipeline | Ручной | Структурированный (Impact секция) |

---

## Appendix: Промпт для ревью-агента (copy-paste ready)

```
Ты — независимый ревьюер SokratAI. Контекст первого агента тебе недоступен.

ПОРЯДОК (строго):
1. Прочитай: docs/discovery/product/tutor-ai-agents/14-ajtbd-product-prd-sokrat.md
2. Прочитай: docs/discovery/product/tutor-ai-agents/16-ux-principles-for-tutor-product-sokrat.md
3. Прочитай: docs/discovery/product/tutor-ai-agents/17-ui-patterns-and-component-rules-sokrat.md
4. Прочитай спеку: docs/delivery/features/{FEATURE}/{FEATURE}-spec.md
5. Прочитай acceptance criteria из спеки
6. Посмотри: git diff main...HEAD (или git log --oneline -20)

ВОПРОСЫ (ответь на каждый):
1. Какой Job (R1–R4) эта фича усиливает? Если никакой — FAIL.
2. Нарушены ли UX-принципы из doc 16? Перечисли конкретные.
3. Нарушены ли UI-паттерны из doc 17? Перечисли конкретные.
4. Есть ли scope creep — код, не требуемый спекой?
5. Есть ли regression risk для high-risk файлов (AuthGuard, TutorGuard, Chat, TutorSchedule, telegram-bot)?
6. Выполнены ли acceptance criteria? Проверь каждый.

ФОРМАТ ОТВЕТА:
## Verdict: PASS / CONDITIONAL PASS / FAIL
## Job alignment: [R1/R2/R3/R4 + пояснение]
## Issues: [список, если есть]
## Recommendations: [список, если есть]
```

---

## Часть 5: Как пользоваться этим playbook

### Ежедневно (5 минут)

Перед первой задачей дня спроси себя:
1. Какую **роль** я играю в этой задаче? (Engineer / Product / Marketing / Support)
2. Эта задача двигает **пилот**? Если нет → backlog
3. Есть ли **signal** от Егора или учеников, который меняет приоритет?

Эти 3 вопроса заменяют 30-минутное «вкатывание».

### При создании фичи

```
Спека (с AC) → Claude Code реализует → Codex ревьюит → Fix → Merge
```

Чеклист:
- [ ] Спека содержит `## Acceptance Criteria (testable)` — минимум 3 проверяемых критерия
- [ ] Спека содержит `## Section 0: Job Context` — к какому Job (R1–R4) привязана
- [ ] После реализации — запущен ревью-агент (промпт из Appendix)
- [ ] Ревью = PASS или CONDITIONAL PASS с fix'ами

### При записи signal

```
Наблюдение → Signal файл → Impact секция → Backlog priority update
```

- Signal от пилотного репетитора > любая внутренняя идея
- Каждый signal оценивается: блокирует пилот? Усиливает wedge?

### Раз в неделю (30 минут, пятница)

Гигиена:
- [ ] Новые секции из CLAUDE.md → перенести в `.claude/rules/`
- [ ] Signals за неделю → пересмотреть backlog priorities
- [ ] Handoffs старше 2 недель → удалить или архивировать
- [ ] Метрики из Части 4 → проверить прогресс

### Раз в 2 спринта

Обновить этот playbook:
- Какие action items внедрены? Убрать из «на этой неделе»
- Какие новые проблемы появились? Добавить
- Метрики — поменялись ли baseline'ы?

---

## Часть 6: Текущий инструментарий и распределение ролей

### Инструменты

| Инструмент | Роль | Когда использовать |
|---|---|---|
| **Claude Code** | Primary Engineer | Fullstack фичи, frontend, guided chat, KB, UI |
| **Codex in VS Code** | Backend Engineer + Reviewer | Edge functions, migrations, API routes. Ревью после Claude Code |
| **Lovable** | Deploy + Preview | Деплой в прод, preview для QA, AI gateway для Gemini |
| **Cowork (Claude Desktop)** | Product + Marketing | Signals анализ, маркетинговые артефакты, playbook, AJTBD |

### Текущее распределение (как есть)

Claude Code и Codex работают **параллельно по доменам**:
- Claude Code → frontend, fullstack, UI, guided chat
- Codex → backend edge functions, DB migrations

**Проблема**: это параллелизация, но не ревью. Оба агента — авторы.

### Целевое распределение (как должно быть)

```
Claude Code (автор) → реализует фичу
        ↓
Codex (ревьюер, чистая сессия) → проверяет по Discovery docs
        ↓
Claude Code → fix по замечаниям
        ↓
Merge
```

Для backend-only задач — инвертировать: Codex = автор, Claude Code = ревьюер.

### Контекст для каждой роли

| Роль | Что агент читает | Что НЕ читает |
|---|---|---|
| Engineer (автор) | CLAUDE.md + relevant rules + спека | Signals, marketing |
| Reviewer | Discovery docs 14–17 + спека + diff | CLAUDE.md, предыдущий контекст автора |
| Product (Cowork) | Все discovery docs + signals | Код |
| Marketing (Cowork) | Messaging matrix + AJTBD + signals | Код, спеки фич |

---

## Часть 7: С чего начать (первые 3 шага)

Не внедряй всё сразу. Приоритет по impact/effort:

### Шаг 1: Testable AC в следующей спеке (10 минут)

Самый быстрый win. Берёшь следующую фичу, добавляешь 3–5 acceptance criteria, которые агент проверит после реализации. Не нужно менять ни CLAUDE.md, ни workflow — просто добавь секцию в спеку.

**Первый кандидат**: ту фичу, которую будешь делать завтра.

### Шаг 2: Один structured review (20 минут)

После следующей реализованной фичи — открой новый терминал, вставь промпт из Appendix, замени `{FEATURE}` на реальный путь. Посмотри, что скажет ревьюер. Если найдёт хотя бы одну проблему — процесс уже окупился.

### Шаг 3: Вынести одну секцию из CLAUDE.md (30 минут)

Начни с самой большой: «Система домашних заданий» (~150 строк) → `40-homework-system.md` в `.claude/rules/`. Один файл, один перенос. После этого будет понятно, стоит ли продолжать.

---

*Этот документ — живой. Обновляй после каждых 2 спринтов на основе реальных результатов.*
