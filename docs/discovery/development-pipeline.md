# Development Pipeline — SokratAI

> Один pipeline с двумя входами: от Job или от идеи/фичи.
> Обе точки входа сходятся на шаге 2 (Job Ticket).
>
> Автор: Vladimir Kamchatkin × Claude · 2026-03-31

---

## Почему один pipeline, а не два

Job и фича — не параллельные потоки, а разные точки входа в один процесс.

- **Job → фича**: «R1 (проверка ДЗ) занимает 30 мин → нужен AI-автогрейдер»
- **Фича → Job**: «Егор просит развернутое решение → привязываем к R1+R2»

Оба пути обязательно проходят через Job Ticket (шаг 2), где идея привязывается к Job. Если привязки нет — идея идёт в «Отложено» или убивается.

---

## Pipeline: 8 шагов

```
┌─────────────┐     ┌─────────────┐
│  Job Graph  │     │ Идея / Фича │
│ (R1-R4,     │     │ (Егор, я,   │
│  S1-S3,     │     │  наблюдение,│
│  P1-P3)     │     │  конкурент) │
└──────┬──────┘     └──────┬──────┘
       │                    │
       └────────┬───────────┘
                ▼
     ┌──────────────────┐
     │ 1. INTAKE        │  ← 5 минут
     │ Записать в       │
     │ backlog.md       │
     └────────┬─────────┘
              ▼
     ┌──────────────────┐
     │ 2. JOB TICKET    │  ← 15 минут
     │ Привязать к Job  │
     │ Kill / Go / Wait │
     └────────┬─────────┘
              ▼
     ┌──────────────────┐
     │ 3. PRD           │  ← 30-60 минут (Cowork)
     │ Что, зачем, для  │
     │ кого, scope      │
     └────────┬─────────┘
              ▼
     ┌──────────────────┐
     │ 4. SPEC          │  ← 1-2 часа (Cowork + Claude Code)
     │ Section 0: Job   │
     │ AC (testable)    │
     │ Technical design │
     └────────┬─────────┘
              ▼
     ┌──────────────────┐
     │ 5. TASKS         │  ← 30 минут
     │ Нарезка задач +  │
     │ промпты для      │
     │ агентов          │
     └────────┬─────────┘
              ▼
     ┌──────────────────┐
     │ 6. BUILD         │  ← часы-дни (Claude Code + Codex + Lovable)
     │ Реализация +     │
     │ Ревью + Deploy   │
     └────────┬─────────┘
              ▼
     ┌──────────────────┐
     │ 7. FEEDBACK      │  ← непрерывно
     │ Сбор signals от  │
     │ репетиторов      │
     └────────┬─────────┘
              ▼
     ┌──────────────────┐
     │ 8. LEARN         │  ← 15 минут
     │ Signal → Job     │
     │ Graph update     │
     └─────────────────┘
```

---

## Шаг 1: INTAKE (5 минут)

**Что**: записать идею в единый backlog, не теряя в Telegram.

**Формат записи** (одна строка в `docs/discovery/backlog.md`):

```
| 2026-03-31 | Егор: развернутое решение | ? | — | intake | signal |
```

**Правила**:
- Любая идея записывается в backlog.md в течение 5 минут
- Источник: Telegram от Егора, собственная мысль, наблюдение, конкурент, signal
- На этом шаге НЕ нужно думать о реализации — только зафиксировать
- Если идея пришла во время кодинга — не переключайся, запиши одну строку и вернись

---

## Шаг 2: JOB TICKET (15 минут)

**Что**: привязать идею к Job и принять решение Go / Wait / Kill.

**Это ключевой фильтр pipeline.** Заменяет интуицию + срочность на формальную проверку.

**Batch Ticket — формат** (файл `docs/discovery/tickets/YYYY-MM-DD-{source}-batch.md`):

Один файл на источник (звонок, сессия обратной связи). Внутри — несколько пронумерованных идей.

```markdown
# Batch Ticket: {источник} — {дата}

## Источник
{кто, контекст звонка/наблюдения}

---

## #1: {название идеи}

### Discovery
{ответы на уточняющие вопросы, цитаты}

### Job Mapping
- Core Job: {R1/R2/R3/R4/S1/S2/S3/P1/P2/P3}
- Sub-job: {R1-3, S1-2, etc.}
- Если нет привязки → KILL или WAIT

### Пилотный фильтр
- Помогает ли пилоту? {да/нет}
- Усиливает ли wedge (ДЗ за 5-10 мин)? {да/нет}
- Блокирует ли пилот? {да/нет}

### Решение
- [ ] GO → создать PRD
- [ ] WAIT → P1/P2/P3
- [ ] KILL → причина: ...

### Effort: {S/M/L}

### Открытые вопросы
{что ещё нужно выяснить}

---

## #2: {следующая идея}
...
```

**Kill Gate**: явное «НЕТ» с причиной. Убитая идея НЕ удаляется — остаётся в backlog со статусом `killed` и причиной. Это экономит когнитивный ресурс: не нужно помнить, почему отказался.

**Когда пропустить Job Ticket**: hotfix / баг в проде / пользователь заблокирован. Тогда сразу в код, Job Ticket ретроспективно.

### Сводка решений (после каждого batch)

После оформления batch ticket — обновить единую сводку `docs/discovery/tickets/summary.md`.

**Что содержит сводка:**
1. **Сводная таблица** — все идеи из всех batch-ов в одной таблице (номер, источник, название, Job, решение, приоритет, effort)
2. **Рекомендуемый порядок реализации** — приоритизированный список с учётом зависимостей между идеями
3. **Паттерны между источниками** — что просят несколько репетиторов (= сильный signal), что только один
4. **Открытые решения** — идеи без финального GO/WAIT/KILL

**Нумерация**: `Е1-Е8` (Егор), `Ж1-Ж2` (Женя), и т.д. — префикс по источнику + порядковый номер внутри batch.

**Когда обновлять**: после каждого нового batch ticket или после пересмотра приоритетов.

---

## Шаг 3: PRD (30-60 минут)

**Что**: описать что строим, зачем, для кого, что НЕ строим.

**Кто делает**: ты + Cowork (Claude Desktop). Cowork читает discovery docs и помогает структурировать, но решения — твои.

**Формат**: файл в `docs/delivery/features/{feature}/prd.md`

**Обязательные секции**:
1. **Job Context** — из Job Ticket (Core Job + Sub-job + pilot impact)
2. **Problem** — текущая боль, workaround, цитата из signal если есть
3. **Solution** — что делаем (1-2 абзаца)
4. **Scope** — IN (делаем) / OUT (не делаем) / LATER (потом)
5. **User Stories** — по персонам (репетитор / ученик / родитель — только релевантные)
6. **Success Criteria** — leading + lagging (см. ниже)
7. **Open Questions** — что неизвестно перед SPEC (см. ниже)
8. **Risks** — что может пойти не так

### Success Criteria — leading vs lagging

Для каждой фичи указывать оба типа метрик:

- **Leading** (смотрим через 3-7 дней): adoption rate, task completion rate, time to complete, error rate. Пример: «70% учеников открыли guided chat в первые 3 дня после выдачи ДЗ»
- **Lagging** (смотрим через 2-4 недели): retention impact, повторное использование, qualitative signal от репетитора. Пример: «Егор выдаёт ≥3 guided ДЗ в неделю на 4-й неделе пилота»

Для pilot-фичей достаточно pilot-level метрик из doc 18, но привязанных к конкретной фиче: не «retention» в целом, а «retention в контексте этой фичи».

### Open Questions — формат

Каждый вопрос = строка с тремя полями:

```
| Вопрос | Кто решает | Блокирует старт? |
|---|---|---|
| Нужен ли AI fallback если Gemini 5xx? | engineering | нет |
| Какой UX при пустой KB? | product (я) | да |
```

**Blocking** = нельзя начинать SPEC без ответа. **Non-blocking** = можно решить по ходу реализации.

**Проверка перед переходом к Spec**:
- [ ] Job привязка есть и конкретна (не «улучшает UX»)
- [ ] Scope чётко описан (IN/OUT/LATER)
- [ ] Не нарушает docs\discovery\product\tutor-ai-agents\16-ux-principles-for-tutor-product-sokrat.md (UX principles) и docs\discovery\product\tutor-ai-agents\17-ui-patterns-and-component-rules-sokrat.md (UI patterns)
- [ ] Помогает пилоту (success criteria привязаны к pilot metrics из docs\discovery\product\tutor-ai-agents\18-pilot-execution-playbook-sokrat.md)
- [ ] Все blocking Open Questions закрыты

---

## Шаг 4: SPEC (1-2 часа)

**Что**: техническая спецификация по шаблону `FEATURE-SPEC-TEMPLATE.md`.

**Кто делает**: ты + Cowork (структура) → Claude Code (технические детали).

**Обязательные секции** (из шаблона + усиления):

### Section 0: Job Context (ОБЯЗАТЕЛЬНО)
```markdown
## Section 0: Job Context (ниже пример)
- **Core Job**: R4 — Сохранение контроля и качества при масштабировании
- **Sub-jobs**: R4-1 (быстро собрать ДЗ), R4-3 (обновлять базу задач)
- **Segment**: B2B, репетиторы физики ЕГЭ/ОГЭ
- **Wedge alignment**: Да — сокращает время сборки ДЗ
- **Pilot impact**: Усиливает core value prop — homework assembly workflow
```

### Acceptance Criteria (testable) (ОБЯЗАТЕЛЬНО, мин. 3)
```markdown
## Acceptance Criteria (testable)
- AC-1: [конкретная проверка, которую агент может выполнить]
- AC-2: [конкретная проверка]
- AC-3: [конкретная проверка]
```

**Правило для AC**: каждый критерий = команда или действие, которое возвращает PASS/FAIL.
Плохо: «работает хорошо». Хорошо: «при нажатии кнопки X статус меняется на Y».

### Requirements — приоритизация внутри scope IN

Не всё внутри scope IN одинаково важно. Каждый requirement получает приоритет:

- **P0 (Must-Have)**: без этого фича не решает core problem. Тест: «если убрать — фича бесполезна?» Если да → P0
- **P1 (Nice-to-Have)**: улучшает experience, но core use case работает без этого. Деплоим через 1-2 дня после P0

P0 requirements деплоятся первым релизом, P1 — fast follow-up. Это позволяет нарезать tasks.md на «деплоим сегодня» и «деплоим завтра».

**Правило жёсткости P0**: если всё помечено P0 — значит приоритизация не работает. Для типичной фичи: 2-4 P0, 1-3 P1.

### Parking Lot

Секция в конце SPEC для хороших идей, которые всплыли при написании спеки, но не входят в scope v1.

```markdown
## Parking Lot
- {идея} — контекст: {почему всплыла}, revisit: {когда имеет смысл вернуться}
- {идея} — контекст: ..., revisit: ...
```

Отличие от OUT в PRD: OUT — это осознанный отказ. Parking Lot — это «хорошая мысль, запомним в контексте этой фичи». При следующей итерации фичи parking lot ревьюится первым.

### Остальные секции
1. Summary,
2. Problem,
3. Solution (in/out scope),
4. User Stories,
5. Technical Design (файлы, модели, API, миграции),
6. docs\discovery\product\tutor-ai-agents\16-ux-principles-for-tutor-product-sokrat.md (UX principles) и docs\discovery\product\tutor-ai-agents\17-ui-patterns-and-component-rules-sokrat.md (UI patterns),
7. Validation (smoke commands),
8. Risks,
9. Implementation Tasks (краткий план),
10. Parking Lot

### Правило разбивки: когда фича слишком большая для одной SPEC

**Признаки** (любой один = повод разбить):
- P0 requirements > 5 штук
- Затрагивает > 3 несвязанных области кодовой базы (frontend + backend + DB + bot)
- Effort оценивается как L (>2 дней) и requirements слабо связаны друг с другом
- При написании SPEC появляется > 3 Open Questions с blocking = да
- Ты не можешь описать фичу в 1-2 предложениях без «и ещё»

**Что делать**: разбить на фазы. Каждая фаза = отдельная SPEC со своим scope, AC и деплоем.

**Как разбивать**:
1. Найди минимальный срез, который уже даёт пользу пилоту (Phase 1)
2. Каждая следующая фаза должна быть самодостаточной — деплоим и собираем feedback, не ждём Phase N+1
3. Между фазами допустим 1-2 дня на feedback + learn
4. Фазы нумеруются в SPEC: `Phase 1: {название}`, `Phase 2: {название}`
5. Только Phase 1 специфицируется полностью. Phase 2+ — краткое описание scope + условие старта («начинаем когда Phase 1 прошла feedback от Егора»)

**Пример из проекта**: guided chat media upload — Phase 1 (transport/persist), Phase 2 (upload UI), Phase 5 (clipboard paste). Каждая фаза деплоилась отдельно.

### Anti-scope-creep правило

После утверждения SPEC — scope фиксируется. Изменения scope возможны только при соблюдении правила:

> **Добавление нового requirement в SPEC требует либо удаления другого requirement такого же приоритета, либо создания новой фазы.**

Если Егор или Женя пишут «а ещё бы...» в Telegram посреди реализации:
1. Записать в Intake (backlog.md) — 5 минут
2. НЕ добавлять в текущую SPEC
3. Если критично (pilot blocker) — создать отдельную SPEC / hotfix через быстрый Job Ticket

---

## Шаг 5: TASKS (30 минут)

**Что**: нарезать спеку на задачи + написать промпты для AI-агентов.

**Формат**: файл `docs/delivery/features/{feature}/tasks.md`

**Структура задачи**:
```markdown
### TASK-1: {название}

**Job**: R4-1
**Agent**: Claude Code
**Files**: src/components/tutor/..., supabase/functions/...
**AC**: AC-1, AC-2

**Промпт для агента**:
**Ref**: doc 19 (Agent Workflow) описывает как структурировать промпты для агентов. Файл: `docs/discovery/product/tutor-ai-agents/19-agent-workflow-and-review-system-sokrat.md`

**Canonical prompt patterns**: doc 20 — обязательный источник структуры промптов для агентов. Файл: `docs/discovery/product/tutor-ai-agents/20-claude-code-prompt-patterns-sokrat.md`. Каждый промпт должен содержать:
1. **Role block**: «Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.»
2. **Context**: сегмент, wedge, AI = draft + action
3. **Canonical docs read**: спека + CLAUDE.md + relevant .claude/rules/
4. **Task description**: конкретные шаги с номерами строк
5. **Acceptance Criteria**: из спеки (Given/When/Then), встроенные в промпт — агент должен знать что проверять
6. **Guardrails**: scope, запрещённые паттерны (Safari, framer-motion, etc.)
7. **Mandatory end block**: changed files, summary, validation, docs-to-update, self-check against docs 16/17
```

**Правила**:
- Каждая задача привязана к AC из спеки
- Каждая задача указывает какой агент её делает (Claude Code / Codex / Lovable)
- Промпт для агента включает: путь к спеке, scope файлов, validation commands
- Задачи нумеруются последовательно, но могут выполняться параллельно если независимы
- **ОБЯЗАТЕЛЬНО**: в конце файла — секция «Copy-paste промпты для агентов» с plain-text блоками (без `>` blockquote) внутри ` ``` ` fenced code blocks. Это единственное, что копируется в агента — промпты внутри TASK-описаний служат для контекста, а copy-paste блок — для действия

---

## Шаг 6: BUILD (часы-дни)

**Что**: реализация + ревью + деплой.

**Workflow**:
```
Claude Code (автор) → реализует TASK-N
        ↓
npm run lint && npm run build && npm run smoke-check
        ↓
Codex (ревьюер, чистая сессия) → проверяет по discovery docs + AC
        ↓
Fix → Re-check → Merge
        ↓
Lovable → деплой в прод
```

**Ревью-промпт для Codex** (из playbook, Appendix):
```
Ты — независимый ревьюер SokratAI. Контекст первого агента тебе недоступен.

ПОРЯДОК (строго):
1. Прочитай docs/discovery/product/tutor-ai-agents/14-ajtbd-product-prd-sokrat.md
2. Прочитай docs 16, 17
3. Прочитай спеку фичи
4. Прочитай AC
5. Посмотри git diff

ВОПРОСЫ: Job alignment? UX drift? Scope creep? AC выполнены?
ФОРМАТ: PASS / CONDITIONAL PASS / FAIL
```

**Definition of Done** (из doc 19):
1. Job/scenario linkage ✓
2. Wedge linkage ✓
3. Feature spec ✓
4. Claude Code implementation ✓
5. Codex review ✓
6. Feedback incorporated ✓
7. No UX/UI-canon breakage ✓
8. Success signal defined ✓
9. Pilot metrics mapped ✓

---

## Шаг 7: FEEDBACK (непрерывно)

**Что**: сбор signals от пользователей после выкатки.

**Источники**:
- Telegram от Егора и учеников (primary)
- Наблюдение за использованием (Supabase analytics)
- Прямые вопросы на еженедельном созвоне (pilot rhythm из doc 18)

**Формат signal** (файл `docs/discovery/signals/YYYY-MM-DD-{topic}.md`):
```markdown
# Signal: {тема}

**Дата**: YYYY-MM-DD
**Источник**: {Егор / ученик Алина / наблюдение}
**Тип**: strong / medium / weak
**Категория**: confirms / contradicts / new_insight

## Наблюдение
{что произошло, цитата}

## Job Mapping
- Core Job: {R1/S1/P1...}
- Sub-job: {R1-3...}

## Impact
- Pilot blocker: {да/нет}
- Priority: {P0/P1/P2}
- Action: {что делать — backlog, ticket, ignore}
```

**Pilot weekly rhythm** (из doc 18):
- Неделя 1: Вернулись ли? Первый самостоятельный цикл?
- Неделя 2: Что точка входа? Где трение?
- Неделя 3: Стало ли рутиной? Что оправдывает оплату?
- Неделя 4: Будут ли продлевать? Какой messaging работает?

---

## Шаг 8: LEARN (15 минут)

**Что**: замкнуть цикл — signal обратно в систему.

**Действия**:
1. **Signal → Backlog**: если signal = feature request → добавить в backlog.md с Job привязкой
2. **Signal → Job Graph**: если signal меняет понимание Job → обновить job graph (новый sub-job, изменение приоритета)
3. **Signal → PRD/Spec**: если signal показывает что фича работает не так → обновить спеку, не код
4. **Signal → Kill**: если signal показывает что фича бесполезна → kill ticket, архивировать

**Правило**: код меняется через pipeline (signal → doc → spec → code), НЕ напрямую (signal → code). Единственное исключение — hotfix/баг.

---

## Backlog — формат

Единый файл `docs/discovery/backlog.md`:

```markdown
# Product Backlog — SokratAI

Последнее обновление: YYYY-MM-DD

## Фильтры
- **P0**: блокирует пилот, делать сейчас
- **P1**: усиливает wedge, делать в этом спринте
- **P2**: полезно, но не срочно
- **P3**: nice-to-have, когда-нибудь
- **killed**: отклонено с причиной

## Active

| Дата | Название | Job | Пилот? | Приоритет | Статус | Источник |
|---|---|---|---|---|---|---|
| 2026-03-29 | Развернутое решение | R1+R2 | nice-to-have | P1 | intake | signal/Егор |
| ... | ... | ... | ... | ... | ... | ... |

## Killed

| Дата | Название | Причина |
|---|---|---|
| ... | ... | Не привязано к Job / не помогает пилоту |
```

---

## Когда пропускать шаги

| Ситуация | Что пропустить | Что обязательно |
|---|---|---|
| Hotfix / баг в проде | Job Ticket, PRD, Spec | Intake (записать) → Code → Feedback |
| Мелкая правка UI (<1 час) | PRD | Intake → Job Ticket (быстро) → Code |
| Крупная фича (>1 день) | Ничего | Все 8 шагов |
| Signal от Егора = конкретный запрос | — | Intake → Job Ticket → решить Go/Wait/Kill |

---

## Cheat Sheet — каждый шаг за 1 строку

1. **INTAKE**: записать идею в backlog.md (5 мин)
2. **JOB TICKET**: привязать к Job, решить Go/Wait/Kill → обновить сводку (15 мин)
3. **PRD**: что, зачем, scope IN/OUT, leading/lagging metrics, open questions (30-60 мин, Cowork)
4. **SPEC**: технический дизайн + AC testable + P0/P1 requirements + parking lot + фазы если L (1-2 ч)
5. **TASKS**: нарезка + промпты для агентов (30 мин)
6. **BUILD**: Claude Code → Codex review → Lovable deploy (часы-дни)
7. **FEEDBACK**: signals от репетиторов (непрерывно)
8. **LEARN**: signal → backlog/Job Graph/spec update (15 мин)

---

## Ключевые документы pipeline

| Шаг | Документ | Путь |
|---|---|---|
| 1 | Backlog | `docs/discovery/backlog.md` |
| 2 | Batch Tickets | `docs/discovery/tickets/YYYY-MM-DD-{source}-batch.md` |
| 2 | Сводка решений | `docs/discovery/tickets/summary.md` |
| 2 | Job Graph | `docs/discovery/research/SokratAI_AJTBD_job-graphs/` |
| 3 | PRD | `docs/delivery/features/{feature}/prd.md` |
| 4 | Spec Template | `docs/delivery/features/FEATURE-SPEC-TEMPLATE.md` |
| 4 | UX Principles | `docs/discovery/product/tutor-ai-agents/16-...` |
| 4 | UI Patterns | `docs/discovery/product/tutor-ai-agents/17-...` |
| 5 | Tasks | `docs/delivery/features/{feature}/tasks.md` |
| 6 | Agent Workflow | `docs/discovery/product/tutor-ai-agents/19-...` |
| 6 | Playbook | `docs/delivery/engineering/solo-founder-ai-playbook.md` |
| 7 | Signals | `docs/discovery/signals/` |
| 8 | Pilot Playbook | `docs/discovery/product/tutor-ai-agents/18-...` |

---

*Pipeline = живой документ. Обно