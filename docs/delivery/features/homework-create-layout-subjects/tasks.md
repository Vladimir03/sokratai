# Tasks: Homework Create — L0 Layout Reshuffle + Subjects Unification

**Spec**: `docs/delivery/features/homework-create-layout-subjects/spec.md`
**Дата**: 2026-04-14
**Автор**: Vladimir

---

## Обзор задач

| # | Название | Agent | Files | AC | Зависимости |
|---|---|---|---|---|---|
| TASK-1 | Удалить поле «Тема» из L0 | Claude Code | `TutorHomeworkCreate.tsx`, `types/homework.ts` | AC-1 | — |
| TASK-2 | Перенести Title/Subject/Deadline в L0 + Title required | Claude Code | `TutorHomeworkCreate.tsx`, `HWExpandedParams.tsx` | AC-1, AC-2, AC-3 | TASK-1 |
| TASK-3 | Удалить auto-title механику | Claude Code | `HWExpandedParams.tsx`, `TutorHomeworkCreate.tsx` | AC-2 | TASK-2 |
| TASK-4 | Сузить dot indicator L1 | Claude Code | `TutorHomeworkCreate.tsx` | AC-7 | TASK-2 |
| TASK-5 | Backend `VALID_SUBJECTS` split (14 modern + 5 legacy) | Claude Code / Codex | `supabase/functions/homework-api/index.ts` | AC-4, AC-5 | — (parallel) |
| TASK-6 | Убрать `emoji` из `SUBJECTS` | Claude Code | `types/homework.ts`, `HWExpandedParams.tsx` | AC-6 | — (parallel) |
| TASK-7 | QA-smoke по 14 предметам | Vladimir (manual) | — | AC-4 | TASK-5 |
| TASK-8 | iOS Safari регрессия | Vladimir (manual) | — | AC-1, AC-2 | TASK-2 |

---

## TASK-1: Удалить поле «Тема» из L0

**Job**: R4-1 (быстро собрать ДЗ)
**Agent**: Claude Code
**Files**: `src/pages/tutor/TutorHomeworkCreate.tsx`, `src/types/homework.ts`
**AC**: AC-1

**Описание**:
Удалить inline-блок «Тема» (или компонент `HWTopicSection`, если он существует) из L0-рендера в `TutorHomeworkCreate.tsx`. Удалить поле `topic` из типа `HWDraftMeta`. Удалить логику `_topicHint` из `validateAll()` и из типа `ValidationErrors`. Удалить любые usages `meta.topic` (включая submission payload).

**Guardrails**:
- Не трогать `HWAssignSection`, `HWTasksSection`, `HWMaterialsSection`, `HWActionBar`.
- Не менять backend — поля `topic` в `homework_tutor_assignments` нет.
- Если в загруженном черновике с backend приходит `meta.topic` (legacy frontend-only) — игнорировать silently, не падать.

---

## TASK-2: Перенести Title/Subject/Deadline в L0 + Title required

**Job**: R4-1, S1-3
**Agent**: Claude Code
**Files**: `src/pages/tutor/TutorHomeworkCreate.tsx`, `src/components/tutor/homework-create/HWExpandedParams.tsx`
**AC**: AC-1, AC-2, AC-3

**Описание**:
1. Удалить из `HWExpandedParams` props и рендер для «Название», «Предмет», «Дедлайн» — оставить только AI-bootstrap toggle (`disable_ai_bootstrap`) и Materials.
2. В `TutorHomeworkCreate.tsx` добавить L0-блок в порядке: Название → Предмет → Дедлайн, между заголовком страницы и `HWAssignSection`.
3. Поле «Название»: `<input type="text">`, `text-base` (16px), placeholder `Например: Кинематика — контрольная 15.04`, label `Название *`. Required validation: `title.trim().length > 0`. Ошибка `Укажите название` под полем (`text-sm text-red-500`), `border-red-500` на input. Save заблокирован, запрос не уходит.
4. Поле «Предмет»: native `<select>`, `text-base` (16px), `touch-action: manipulation`, default `physics`, рендерит 14 предметов из `SUBJECTS` без emoji. Label `Предмет *`.
5. Поле «Дедлайн»: `<input type="datetime-local">`, `text-base`, label `Дедлайн (необязательно)`. Тот же formatter.
6. На validation error при save — scroll-to-error на первое поле с ошибкой.

**Guardrails**:
- 16px font-size на всех input/select (iOS Safari auto-zoom). См. `.claude/rules/80-cross-browser.md`.
- Не использовать `framer-motion`. См. `.claude/rules/performance.md`.
- Сохранить уже существующий validator pattern (`validateAll()` возвращает `ValidationErrors`).
- Не менять backend save endpoint.

---

## TASK-3: Удалить auto-title механику

**Job**: R4-1
**Agent**: Claude Code
**Files**: `src/components/tutor/homework-create/HWExpandedParams.tsx`, `src/pages/tutor/TutorHomeworkCreate.tsx`
**AC**: AC-2

**Описание**:
Удалить полностью: prop `autoTitle`, generator-хелпер `AUTO_TITLE_FROM_TOPIC` (или аналогичный), hint-text под полем «Название» о том, что title будет сгенерирован автоматически. Title теперь только ручной ввод репетитора, валидируется как required (см. TASK-2).

**Guardrails**:
- Не оставлять dead-code (не комментировать — удалять).
- Никаких backend fallback'ов на auto-title — backend остаётся `title.trim().length > 0` validator (уже есть).

---

## TASK-4: Сузить dot indicator L1 + убрать auto-expand

**Job**: R4-1
**Agent**: Claude Code
**Files**: `src/pages/tutor/TutorHomeworkCreate.tsx`
**AC**: AC-7

**Описание**:
Изменить условие dot indicator на кнопке «Расширенные параметры»:
- **Старое**: `title || subject !== 'physics' || deadline || materials.length > 0`.
- **Новое**: `materials.length > 0 || disable_ai_bootstrap !== false`.
- Title / Subject / Deadline теперь всегда видны на L0 — из dot убраны.

Удалить auto-expand L1 при ошибке `subject` (валидация subject теперь работает на L0, expand не нужен).

**Guardrails**:
- Не менять сам disclosure-механизм (collapsible, иконки) — только условие dot.

---

## TASK-5: Backend `VALID_SUBJECTS` split

**Job**: R4-1, S1-3
**Agent**: Claude Code (или Codex для review)
**Files**: `supabase/functions/homework-api/index.ts`
**AC**: AC-4, AC-5

**Описание**:
Разделить `VALID_SUBJECTS` (текущая строка ~23) на два набора:

```ts
const VALID_SUBJECTS_CREATE = [
  "maths", "physics", "informatics",
  "russian", "literature", "history", "social",
  "english", "french", "chemistry", "biology",
  "geography", "spanish", "other",
] as const;

const VALID_SUBJECTS_UPDATE = [
  ...VALID_SUBJECTS_CREATE,
  "math", "cs", "rus", "algebra", "geometry", // legacy: не появляются в frontend dropdown, но не ломают старые ДЗ (включая previous-iteration `algebra`/`geometry`)
] as const;
```

Применить:
- **Строка 347** (`handleCreateAssignment`, strict guard) → `VALID_SUBJECTS_CREATE`.
- **Строка 860** (второй create-like path) → `VALID_SUBJECTS_CREATE`.
- **Строка 2636** (strict duplicate / template clone) → `VALID_SUBJECTS_CREATE`.
- **Строка 2587** (`handleUpdateAssignment`, conditional guard) → `VALID_SUBJECTS_UPDATE`.

Сообщение ошибки: `subject must be one of: ${list.join(", ")}` — без структурных изменений.

**Guardrails**:
- Не трогать другие edge functions (`telegram-bot/index.ts`, `homework-reminder/index.ts`).
- Не вводить миграцию БД — `homework_tutor_assignments.subject` уже text.
- Перед коммитом проверить grep по `VALID_SUBJECTS` — не должно остаться usages старой константы (если она удалена).

---

## TASK-6: Убрать `emoji` из `SUBJECTS`

**Job**: R4-1 (design-system compliance)
**Agent**: Claude Code
**Files**: `src/types/homework.ts`, `src/components/tutor/homework-create/HWExpandedParams.tsx` (+ grep по проекту)
**AC**: AC-6

**Описание**:
1. Удалить поле `emoji` из массива `SUBJECTS` и из типа `HomeworkSubjectConfig` в `src/types/homework.ts`.
2. Grep по проекту: `SUBJECTS.*emoji`, `subject.emoji`, `\.emoji` в контексте subject. Удалить все usages (или заменить на пустую строку, если потребитель ожидает поле — но лучше адаптировать потребителя).
3. Subject dropdown в L0 (после TASK-2) рендерит только `name` без emoji.
4. `SUBJECT_NAME_MAP` остаётся derived из `SUBJECTS`, значения без emoji в `name`.

**Guardrails**:
- Не добавлять Lucide-иконки в native `<select>` — там SVG не рендерится. Custom dropdown — parking lot.
- KB subject dropdown НЕ трогать — он использует свой topic/section набор.

---

## TASK-7: QA-smoke по 14 предметам

**Agent**: Vladimir (manual)
**AC**: AC-4

**Шаги**:
1. На `/tutor/homework/create` создать ДЗ с одной задачей по каждому из 14 предметов: `maths, physics, informatics, russian, literature, history, social, english, french, chemistry, biology, geography, spanish, other`.
2. Проверить:
   - Create returns 201 OK (не 400 VALIDATION).
   - `subject` сохранён в `homework_tutor_assignments.subject`.
   - Карточка в `TutorHomework.tsx` показывает корректный label через `getSubjectLabel()`.
   - `handleNotifyStudents` отправляет уведомление хотя бы одному ученику; в `delivery_status` появляется `delivered_*`.
3. Дополнительно: открыть существующее ДЗ с `subject: 'math'` (legacy) → save должен пройти 200, subject не блокируется.

---

## TASK-8: iOS Safari регрессия

**Agent**: Vladimir (manual, iPhone)
**AC**: AC-1, AC-2

**Шаги**:
1. Открыть `/tutor/homework/create` в Safari на iPhone.
2. Тапнуть в поле «Название» → проверить, что **не происходит auto-zoom** (font-size 16px).
3. Тапнуть на native `<select>` Предмет → выбрать «Биология» → проверить, что нет zoom и dropdown открывается нативно.
4. Тапнуть «Дедлайн» → datetime picker, нет zoom.
5. Нажать Enter в Title → форма **не сабмитится** (или сабмитится — зависит от текущего поведения, проверить что регрессии нет).
6. Focus-ring на полях не конфликтует со sticky-элементами (HWActionBar).

---

## Copy-paste промпты для агентов

### Промпт для TASK-1 + TASK-2 + TASK-3 + TASK-4 (Claude Code, frontend bundle)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст:
- Сегмент: B2B-1 (репетиторы физики ЕГЭ/ОГЭ), B2C-1 (школьники 16-18 под экзамен).
- Wedge: ДЗ за 5-10 минут. AI = draft + action, не chat-only output.
- Текущая боль: поле «Тема» в L0 — мёртвый ввод, ест 30 сек на каждом ДЗ. «Дедлайн» спрятан в L1 — репетиторы забывают выставить и шлют «прошлое ДЗ».

Канонические доки (читать в порядке):
1. CLAUDE.md
2. .claude/rules/40-homework-system.md (секция «Конструктор ДЗ — L0/L1 архитектура»)
3. .claude/rules/80-cross-browser.md
4. .claude/rules/90-design-system.md
5. .claude/rules/performance.md
6. docs/delivery/features/homework-create-layout-subjects/spec.md
7. docs/discovery/product/tutor-ai-agents/16-ux-principles-for-tutor-product-sokrat.md
8. docs/discovery/product/tutor-ai-agents/17-ui-patterns-and-component-rules-sokrat.md

Задачи (TASK-1..TASK-4 из tasks.md):

TASK-1: Удалить поле «Тема»
- В src/pages/tutor/TutorHomeworkCreate.tsx удалить inline-блок «Тема» (или компонент HWTopicSection, если он есть).
- В src/types/homework.ts удалить поле topic из HWDraftMeta и _topicHint из ValidationErrors.
- Удалить логику _topicHint в validateAll().
- Удалить usages meta.topic (включая submission payload).
- Если backend возвращает legacy meta.topic — игнорировать silently.

TASK-2: Перенести Title / Subject / Deadline в L0
- Из HWExpandedParams.tsx удалить рендер и props для Title, Subject, Deadline. Оставить только AI-bootstrap toggle и Materials.
- В TutorHomeworkCreate.tsx добавить L0-блок в порядке: Название → Предмет → Дедлайн, между заголовком страницы и HWAssignSection.
- Название: <input type="text">, text-base (16px), placeholder «Например: Кинематика — контрольная 15.04», label «Название *». Required: title.trim().length > 0. Ошибка «Укажите название» под полем (text-sm text-red-500), border-red-500 на input. Save блокируется, запрос не уходит.
- Предмет: native <select>, text-base, touch-action: manipulation, default 'physics', 14 предметов из SUBJECTS без emoji, label «Предмет *».
- Дедлайн: <input type="datetime-local">, text-base, label «Дедлайн (необязательно)».
- При validation error → scroll-to-error на первое поле с ошибкой.

TASK-3: Удалить auto-title механику
- Удалить полностью prop autoTitle, generator AUTO_TITLE_FROM_TOPIC (или аналог), hint-text про авто-генерацию title.
- Никакого dead-code. Никаких backend fallback'ов.

TASK-4: Сузить dot indicator L1
- Условие dot изменить на: materials.length > 0 || disable_ai_bootstrap !== false.
- Убрать auto-expand L1 при ошибке subject — валидация теперь на L0.

Acceptance Criteria (из спеки, секция 7):
- AC-1: L0 содержит ровно 5 секций в порядке Название, Предмет, Дедлайн, Кому, Задачи. «Тема» отсутствует.
- AC-2: попытка сохранить с пустым title → ошибка «Укажите название», save не происходит, request не уходит.
- AC-3: L1 содержит ровно 2 блока: AI-вступление, Материалы. Title/Subject/Deadline в L1 отсутствуют.
- AC-7: dot на кнопке L1 не показывается в дефолтном draft без materials. Изменение title/subject/deadline на L0 точку не зажигает.

Guardrails:
- Не трогать HWAssignSection, HWTasksSection, HWMaterialsSection, HWActionBar.
- Не использовать framer-motion (запрещён в проекте). CSS transitions / tailwindcss-animate.
- 16px font-size на всех input/select (iOS Safari auto-zoom). См. .claude/rules/80-cross-browser.md.
- Не использовать crypto.randomUUID, Array.at, structuredClone, RegExp lookbehind, AbortSignal.timeout — Safari < 15.4 не поддерживает.
- Не менять high-risk файлы из .claude/rules/10-safe-change-policy.md.
- Не трогать backend и edge functions (TASK-5 — отдельно).

В конце:
1. Список изменённых файлов.
2. Краткое summary что сделано.
3. Команды валидации: npm run lint && npm run build && npm run smoke-check.
4. Проверка по docs 16/17: соответствует ли изменение UX-принципам и UI-паттернам? Любые отклонения объяснить.
5. Если есть сомнения — открытые вопросы списком, не молчаливые предположения.
```

---

### Промпт для TASK-5 (Claude Code, backend)

```
Твоя роль: senior backend engineer в проекте SokratAI.

Контекст:
- Frontend SUBJECTS определяет 14 предметов: maths, physics, informatics, russian, literature, history, social, english, french, chemistry, biology, geography, spanish, other.
- Backend VALID_SUBJECTS в supabase/functions/homework-api/index.ts валидирует только 8: math, physics, history, social, english, cs, french, chemistry. Это silent failure для большинства предметов — assignment не создаётся, ученик не получает уведомление.
- Цель: разделить на VALID_SUBJECTS_CREATE (14 modern) и VALID_SUBJECTS_UPDATE (14 + 5 legacy: math, cs, rus, algebra, geometry). Update должен принимать legacy для backward-compat существующих ДЗ (включая ДЗ, созданные на предыдущей итерации с algebra/geometry).

Канонические доки:
1. CLAUDE.md
2. .claude/rules/40-homework-system.md
3. docs/delivery/features/homework-create-layout-subjects/spec.md (секции 3, 5, 8.1)

Задача (TASK-5):

В supabase/functions/homework-api/index.ts:

1. Заменить текущую константу VALID_SUBJECTS (~строка 23) на:

const VALID_SUBJECTS_CREATE = [
  "maths", "physics", "informatics",
  "russian", "literature", "history", "social",
  "english", "french", "chemistry", "biology",
  "geography", "spanish", "other",
] as const;

const VALID_SUBJECTS_UPDATE = [
  ...VALID_SUBJECTS_CREATE,
  "math", "cs", "rus", "algebra", "geometry",
] as const;

2. Применить guard'ы:
- Строка 347 (handleCreateAssignment, strict): VALID_SUBJECTS_CREATE.
- Строка 860 (второй create-like path): VALID_SUBJECTS_CREATE.
- Строка 2636 (strict duplicate / template clone): VALID_SUBJECTS_CREATE.
- Строка 2587 (handleUpdateAssignment, conditional): VALID_SUBJECTS_UPDATE.

3. Сообщение ошибки оставить в форме: `subject must be one of: ${list.join(", ")}`.

4. Grep по VALID_SUBJECTS после правки — не должно остаться ссылок на удалённую константу.

Acceptance Criteria:
- AC-4: создание ДЗ по каждому из 14 предметов возвращает 201, запись в homework_tutor_assignments. delivery_status хотя бы один delivered_*.
- AC-5: редактирование ДЗ с subject: 'math' (или 'algebra'/'geometry' из предыдущей итерации) не падает (200 OK).

Guardrails:
- Не трогать другие edge functions (telegram-bot, homework-reminder).
- Не вводить SQL миграцию (subject — text, уже принимает любые значения).
- Не менять frontend (TASK-6 для emoji — отдельная задача).
- Не менять структуру ошибки/response — только список разрешённых значений.

В конце:
1. Diff патч (или список изменённых строк).
2. Проверка: grep "VALID_SUBJECTS" после правки — все 4 call sites используют правильную константу.
3. Команда валидации: npm run lint && npm run build && npm run smoke-check.
4. Подтверждение что edge function deploy не требует SQL миграции.
```

---

### Промпт для TASK-6 (Claude Code, design-system cleanup)

```
Твоя роль: frontend engineer в проекте SokratAI.

Контекст:
- Design-system anti-pattern #1 (.claude/rules/90-design-system.md): emoji в UI chrome (навигация, кнопки, заголовки, dropdown) запрещены.
- В src/types/homework.ts массив SUBJECTS содержит поле emoji ('📈', '📐', '⚛️', '💻' и т.д.). Эти emoji рендерятся в Subject dropdown конструктора ДЗ.
- Цель: убрать поле emoji полностью, оставить только id/name/category.

Канонические доки:
1. CLAUDE.md
2. .claude/rules/90-design-system.md (секции «Иконки», «Anti-patterns»)
3. docs/delivery/features/homework-create-layout-subjects/spec.md (секция 3, AC-6)

Задача (TASK-6):

1. В src/types/homework.ts:
   - Удалить поле emoji из каждого элемента массива SUBJECTS.
   - Удалить emoji из типа HomeworkSubjectConfig.
   - SUBJECT_NAME_MAP оставить derived из SUBJECTS — значения name без emoji.

2. Grep по проекту:
   - rg "SUBJECTS.*emoji"
   - rg "subject\.emoji"
   - rg "\.emoji" в контексте subject (визуально проверить)
   Удалить все usages или адаптировать потребителей. Не оставлять стаб emoji: ''.

3. Subject dropdown в L0 (после TASK-2) должен рендерить только name. Если этот dropdown ещё не на L0 (TASK-2 не сделан) — найти текущий рендер в HWExpandedParams.tsx и убрать emoji там.

Acceptance Criteria:
- AC-6: rg на emoji-pattern (например U+1F300..U+1FAFF) внутри SUBJECTS возвращает 0 совпадений.

Guardrails:
- НЕ заменять emoji на Lucide-иконки в native <select> — SVG там не рендерится. Custom dropdown — parking lot.
- НЕ трогать KB subject dropdown — он использует отдельный topic/section набор.
- НЕ менять backend (subject — просто text).

В конце:
1. Список изменённых файлов.
2. Grep вывод по emoji-pattern в SUBJECTS до/после.
3. Команды валидации: npm run lint && npm run build && npm run smoke-check.
```

---

### Промпт для Codex (review всех TASK после имплементации)

```
Ты — независимый ревьюер SokratAI. Контекст автора-агента тебе недоступен.

ПОРЯДОК (строго):
1. Прочитай docs/discovery/product/tutor-ai-agents/14-ajtbd-product-prd-sokrat.md
2. Прочитай docs/discovery/product/tutor-ai-agents/16-ux-principles-for-tutor-product-sokrat.md
3. Прочитай docs/discovery/product/tutor-ai-agents/17-ui-patterns-and-component-rules-sokrat.md
4. Прочитай docs/delivery/features/homework-create-layout-subjects/spec.md
5. Прочитай AC (секция 7 спеки)
6. Посмотри git diff для веток с TASK-1..TASK-6.

ВОПРОСЫ:
- Job alignment: фича действительно усиливает R4-1 и S1-3? Не drift в сторону generic UX-improvement?
- UX drift: соблюдены принципы экономии клика, progressive disclosure, AI = draft + action?
- Scope creep: что-то выехало за рамки спеки (например, custom dropdown, миграция БД, изменения в KB)?
- AC выполнены: каждый из AC-1..AC-7 проверяем на git diff. Какие PASS, какие FAIL?
- Safari/iOS соблюдён: 16px font-size на input/select, нет запрещённых API из .claude/rules/80-cross-browser.md.
- Performance: нет framer-motion, list-items в memo, нет тяжёлых импортов в shared.
- Backend split: VALID_SUBJECTS_CREATE (14 modern) на 347/860/2636, VALID_SUBJECTS_UPDATE (14 + 5 legacy) на 2587 — точно так?
- Список модерных предметов содержит ровно: maths, physics, informatics, russian, literature, history, social, english, french, chemistry, biology, geography, spanish, other (14 шт., без algebra/geometry).

ФОРМАТ ответа:
- PASS / CONDITIONAL PASS / FAIL
- Если CONDITIONAL — список minor issues.
- Если FAIL — список blockers с указанием AC и файла:строки.
```
