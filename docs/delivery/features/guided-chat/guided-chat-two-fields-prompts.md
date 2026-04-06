# Промпты для реализации: Два поля ввода «Ответ» и «Обсуждение»

**Tasks:** `docs/features/specs/guided-chat-two-fields-tasks.md`
**UX-аудит:** `student-homework-ux-improvements.html` → раздел 3.7
**Паттерн:** doc 20 — Паттерн C (UX polish / fix)
**Дата:** 2026-03-22

---

## Оглавление

1. [Phase 1 — Claude Code: Core рефакторинг двух полей](#phase-1)
2. [Phase 1 — Codex Review](#phase-1-review)
3. [Phase 2 — Claude Code: Мобильный аккордеон](#phase-2)
4. [Phase 2 — Codex Review](#phase-2-review)
5. [Phase 3 — Claude Code: Workspace props](#phase-3)
6. [Phase 3 — Codex Review](#phase-3-review)
7. [Phase 4 — Codex: Финальный end-to-end review](#phase-4-review)

---

<a id="phase-1"></a>
## Phase 1 — Claude Code: Core рефакторинг GuidedChatInput → два поля

✅ **DONE** (2026-03-22)

```text
Твоя роль: senior product-minded frontend engineer в проекте SokratAI.

Нужно реализовать Phase 1: рефакторинг GuidedChatInput.tsx — заменить одно поле ввода на два раздельных: «Ответ» и «Обсуждение».

Контекст проблемы:
- Реальный ученик нажал Enter (= «Шаг», обсуждение) вместо Ctrl+Enter (= «Ответ», проверка).
- AI начал обсуждать вместо проверки → ученик расстроился → ушёл к конкуренту.
- Решение: два поля, каждое со своим Enter, без Ctrl+Enter.

Контекст продукта:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ;
- wedge: быстро собрать ДЗ и новую практику по теме урока;
- пользователи: школьники 14-18 лет, iPhone + Safari, Android + Chrome;
- AI = draft + action, а не generic chat.

Сначала обязательно прочитай:
1. docs/features/specs/guided-chat-two-fields-tasks.md (task specs — Phase 1: задачи 1.1, 1.2)
2. docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules-sokrat.md
3. CLAUDE.md (секции: кросс-браузерная совместимость, preview parity, performance)

Задачи Phase 1:

Задача 1.1: Разделить textarea на два поля
- Файл: src/components/homework/GuidedChatInput.tsx (ЕДИНСТВЕННЫЙ файл для Phase 1)
- Заменить один state `message` на два: `answerText` + `discussionText`
- Заменить один textarea на два: AnswerField (зелёная рамка, сверху) + DiscussionField (серая рамка, снизу)
- Каждое поле со своим handleKeyDown: Enter = свой callback, Shift+Enter = новая строка
- УБРАТЬ всю логику Ctrl+Enter / Cmd+Enter — она больше не нужна
- Кнопка «Проверить» (green) для answer, «Спросить» (outline) для discussion
- Hint-текст под каждым полем: «Enter = проверить» / «Enter = обсудить с AI»
- Визуальное кодирование: answer = border-2 border-green-600, discussion = border border-slate-200
- Label с иконкой: ✅ «Ответ к задаче» (bold green) / 💬 «Обсуждение» (semibold muted)
- attachedFiles остаётся shared — AttachmentPreview фиксированно над answer-полем
- File input остаётся один shared <input type="file">
- Добавить новый prop: taskNumber?: number (для placeholder)

Задача 1.2: Clipboard paste в двух полях
- onPaste handler оставить на wrapping <div> (как сейчас)
- Image paste → onFileSelect (без изменений)
- Text paste → нативное поведение textarea (в фокус-поле)
- Никаких изменений в paste-логике, кроме совместимости с двумя полями

КРИТИЧНО (из CLAUDE.md):
- НЕ использовать framer-motion (performance.md запрещает в shared components)
- font-size ≥ 16px на обоих textarea (iOS Safari zoom prevention)
- touch-action: manipulation на всех кнопках и interactive элементах
- НЕ использовать crypto.randomUUID() (Safari < 15.4)
- НЕ использовать RegExp lookbehind (Safari < 16.4)
- Structural breakpoints: md: для layout, НЕ sm:

Что НЕ делать:
- Не менять GuidedHomeworkWorkspace.tsx (Phase 3)
- Не менять сигнатуры onSendAnswer / onSendStep — workspace использует их as-is
- Не менять AttachmentPreview компонент (оставить как есть)
- Не менять handleFileChange (shared file input)
- Не добавлять npm-зависимости
- Не добавлять мобильный аккордеон (Phase 2)
- Не менять backend / API

Props interface остаётся backward compatible:
- onSendAnswer: (text: string) => void  — БЕЗ ИЗМЕНЕНИЙ
- onSendStep: (text: string) => void    — БЕЗ ИЗМЕНЕНИЙ
- isLoading: boolean                     — БЕЗ ИЗМЕНЕНИЙ
- disabled?: boolean                     — БЕЗ ИЗМЕНЕНИЙ
- attachedFiles: File[]                  — БЕЗ ИЗМЕНЕНИЙ
- onFileSelect: (file: File) => void     — БЕЗ ИЗМЕНЕНИЙ
- onFileRemove: (index: number) => void  — БЕЗ ИЗМЕНЕНИЙ
- isUploading: boolean                   — БЕЗ ИЗМЕНЕНИЙ
- placeholder — DEPRECATED (сохранён, но игнорируется)
- taskNumber?: number — ДОБАВИТЬ

После реализации:
1. npm run lint
2. npm run build
3. npm run smoke-check

В конце дай:
1. changed files (должен быть ТОЛЬКО GuidedChatInput.tsx)
2. что сделано
3. что осталось (Phase 2-4)
4. validation results
5. self-check: Props backward compatible? Ctrl+Enter убран? Enter работает в каждом поле?
6. какие документы нужно обновить
```

---

<a id="phase-1-review"></a>
## Phase 1 — Codex Review

✅ **DONE** (2026-03-22)

```text
Сделай code review реализации Phase 1: рефакторинг GuidedChatInput.tsx — два поля ввода.

Контекст проблемы:
- Ученик путал Enter (обсуждение) и Ctrl+Enter (проверка) → ушёл к конкуренту.
- Решение: два раздельных поля, каждое со своим Enter.
- Phase 1 = core рефакторинг GuidedChatInput.tsx.

Сначала прочитай:
1. docs/features/specs/guided-chat-two-fields-tasks.md (Phase 1: задачи 1.1, 1.2)
2. docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules-sokrat.md
3. CLAUDE.md (секции: кросс-браузерная совместимость, performance)

Затем проверь изменённый файл:
- src/components/homework/GuidedChatInput.tsx

Проверь:

1. Два поля:
   - answerText и discussionText — два отдельных state?
   - Каждое поле со своим handleKeyDown?
   - Enter в answer → onSendAnswer? Enter в discussion → onSendStep?
   - Shift+Enter → новая строка в обоих?
   - Ctrl+Enter / Cmd+Enter полностью убран?

2. Visual design:
   - Answer: зелёная рамка (border-2 border-green-600), CheckCircle2 icon, label «Ответ к задаче»?
   - Discussion: серая рамка (border border-slate-200), MessageCircle icon, label «Обсуждение»?
   - Кнопки: «Проверить» (green bg) vs «Спросить» (outline)?
   - Hint-текст под каждым полем?

3. Safari compatibility:
   - font-size: 16px на обоих textarea? (style={{ fontSize: '16px' }})
   - touch-action: manipulation на всех кнопках?
   - Нет crypto.randomUUID(), Array.at(), RegExp lookbehind?
   - Нет framer-motion?

4. Attachment handling:
   - attachedFiles — shared state?
   - AttachmentPreview рендерится один раз (над answer)?
   - File input — один shared?
   - onPaste работает в обоих полях?

5. Props interface:
   - onSendAnswer / onSendStep сигнатуры не менялись?
   - placeholder prop — deprecated (сохранён, игнорируется)?
   - taskNumber? prop добавлен?
   - Все существующие props сохранены?

6. Edge cases:
   - Пустой текст + нет файлов → кнопка disabled?
   - isLoading → оба поля disabled?
   - disabled prop → оба поля disabled?
   - Отправка answer не очищает discussionText (и наоборот)?
   - Auto-resize textarea работает для обоих полей?
   - Memory cleanup: URL.revokeObjectURL при unmount?

7. Performance:
   - Нет framer-motion import?
   - memo() сохранён на компоненте?
   - useCallback на обоих handleKeyDown?
   - Нет лишних ререндеров?

Формат ответа:
- Executive summary
- Must fix (blocking issues)
- Should fix (non-blocking improvements)
- Nice to have
- Safari compatibility check
- Backward compatibility check
```

---

<a id="phase-2"></a>
## Phase 2 — Claude Code: Мобильный аккордеон + адаптив

✅ **DONE** (реализовано в Phase 1 — объединили)

> Мобильный аккордеон был включён в Phase 1 по результатам review:
> `isDiscussionExpanded` state, toggle-кнопка `md:hidden`, CSS `transition-all duration-200`,
> compact answer при раскрытом discussion.

```text
Твоя роль: senior product-minded frontend engineer в проекте SokratAI.

Нужно реализовать Phase 2: мобильный аккордеон для поля «Обсуждение» в GuidedChatInput.tsx.

Phase 1 уже реализована: GuidedChatInput имеет два поля — «Ответ» (зелёная рамка) и «Обсуждение» (серая рамка). Оба видны всегда.

Контекст:
- пользователи: школьники 14-18 лет, основной девайс — iPhone + Safari;
- на мобильных экранная клавиатура занимает ~50% экрана;
- два полных поля не влезут — «Обсуждение» нужно сворачивать.

Сначала прочитай:
1. docs/features/specs/guided-chat-two-fields-tasks.md (Phase 2: задачи 2.1, 2.2)
2. CLAUDE.md (секции: кросс-браузерная совместимость, preview parity)

Задачи Phase 2:

Задача 2.1: Collapsible «Обсуждение» на мобильных
- Файл: src/components/homework/GuidedChatInput.tsx
- Desktop (≥768px, md:): оба поля видны всегда
- Mobile (<768px): «Обсуждение» свёрнуто по умолчанию
- Видна кнопка: «💬 Обсудить шаг с AI ▾» (dashed border, muted text)
- Тап → плавное раскрытие (CSS transition-all duration-200)
- Кнопка ▴ в раскрытом состоянии → сворачивает обратно
- После отправки discussion → поле остаётся раскрытым
- isDiscussionExpanded state, default false
- На desktop: поле всегда видно, toggle-кнопка скрыта

Реализация через Tailwind:
- Вариант A (рекомендуется): CSS-only через md:block / hidden + md:hidden для toggle
- Вариант B: JS media query + isDiscussionExpanded state
- Решение за тобой — главное чтобы на desktop всегда оба поля видны

Задача 2.2: Compact answer field при раскрытом discussion (mobile)
- Когда «Обсуждение» раскрыто на мобильных: answer field → compact mode
- Label скрывается (hidden md:flex)
- Padding уменьшается: p-3 → p-2
- Экономит ~40px вертикали

КРИТИЧНО:
- Structural breakpoint: md: (768px), НЕ sm: (640px)
- Нет framer-motion — только CSS transitions
- touch-action: manipulation на toggle-кнопке
- Transition: transition-all duration-200 (или max-height transition)

Что НЕ делать:
- Не менять Phase 1 логику (два state, два handleKeyDown)
- Не менять GuidedHomeworkWorkspace.tsx
- Не менять backend

После реализации:
1. npm run lint
2. npm run build
3. npm run smoke-check

В конце дай:
1. changed files (должен быть ТОЛЬКО GuidedChatInput.tsx)
2. что сделано
3. validation results
4. self-check: Desktop оба поля видны? Mobile discussion свёрнут? Transition плавный?
```

---

<a id="phase-2-review"></a>
## Phase 2 — Codex Review

```text
Сделай code review реализации Phase 2: мобильный аккордеон для «Обсуждение» в GuidedChatInput.

Phase 1 уже реализована: два поля ввода. Phase 2 = collapsible discussion на мобильных.

Сначала прочитай:
1. docs/features/specs/guided-chat-two-fields-tasks.md (Phase 2: задачи 2.1, 2.2)
2. CLAUDE.md (секции: кросс-браузерная совместимость, preview parity)

Проверь файл:
- src/components/homework/GuidedChatInput.tsx

Проверь:

1. Desktop (≥768px):
   - Оба поля видны ВСЕГДА?
   - Toggle-кнопка «Обсудить» СКРЫТА?
   - Никакого compact mode для answer field?

2. Mobile (<768px):
   - Discussion свёрнут по умолчанию (isDiscussionExpanded = false)?
   - Кнопка «💬 Обсудить шаг с AI ▾» видна?
   - Тап → раскрытие с CSS transition (duration ~200ms)?
   - Кнопка ▴ → сворачивание?
   - Answer field → compact mode (нет label, меньше padding)?

3. Breakpoint:
   - Используется md: (768px), а НЕ sm: (640px)?
   - Lovable preview (~640-700px) — будет ли корректно работать?

4. Transitions:
   - CSS-only (transition-all / max-height)?
   - НЕТ framer-motion?
   - Нет мерцания при открытии/закрытии?

5. iOS Safari:
   - touch-action: manipulation на toggle-кнопке?
   - Нет 300ms tap delay?
   - Клавиатура не ломает layout при открытии discussion?

6. Edge cases:
   - Discussion expand → ввести текст → свернуть → текст сохранён?
   - Resize окна desktop → mobile: discussion сворачивается?
   - Discussion expanded + клавиатура открыта: нет overlap с answer field?

Формат ответа:
- Executive summary
- Must fix
- Should fix
- Nice to have
- iOS Safari compatibility check
```

---

<a id="phase-3"></a>
## Phase 3 — Claude Code: Workspace props + placeholders

```text
Твоя роль: senior product-minded frontend engineer в проекте SokratAI.

Нужно реализовать Phase 3: обновить GuidedHomeworkWorkspace.tsx для работы с новым GuidedChatInput.

Phase 1-2 уже реализованы: GuidedChatInput имеет два поля + мобильный аккордеон. Props interface обновлён: placeholder deprecated (игнорируется), taskNumber добавлен.

Сначала прочитай:
1. docs/features/specs/guided-chat-two-fields-tasks.md (Phase 3: задачи 3.1, 3.2)
2. CLAUDE.md

Задачи Phase 3:

Задача 3.1: Обновить GuidedHomeworkWorkspace props
- Файл: src/components/homework/GuidedHomeworkWorkspace.tsx
- Убрать placeholder prop из <GuidedChatInput /> (lines ~1377-1381)
- Добавить taskNumber={currentTask?.order_num} prop
- Проверить: modKey constant (line ~70) — если нигде не используется кроме удалённого placeholder, удалить
  - Сначала grep "modKey" по файлу
  - Если используется только в placeholder (который удаляем) → удалить const
  - Также удалить isMac constant (line ~69) если modKey был единственным потребителем

Задача 3.2: Удалить deprecated placeholder prop из GuidedChatInput
- Файл: src/components/homework/GuidedChatInput.tsx
- Убрать `placeholder` из interface GuidedChatInputProps
- Убрать из destructuring в компоненте
- Placeholders уже hardcoded внутри (Phase 1 сделала): answerPlaceholder и discussionPlaceholder

Что НЕ делать:
- Не менять sendUserMessage, handleCheckAnswer, handleFileSelect
- Не менять state management (attachedFiles, isUploading)
- Не менять backend
- Не расширять scope

После реализации:
1. npm run lint
2. npm run build
3. npm run smoke-check

В конце дай:
1. changed files (максимум 2: GuidedHomeworkWorkspace.tsx, GuidedChatInput.tsx)
2. что сделано
3. validation results
4. self-check: placeholder удалён? taskNumber передаётся? modKey cleanup? isMac cleanup?
```

---

<a id="phase-3-review"></a>
## Phase 3 — Codex Review

```text
Сделай code review реализации Phase 3: обновление GuidedHomeworkWorkspace props.

Сначала прочитай:
1. docs/features/specs/guided-chat-two-fields-tasks.md (Phase 3)
2. CLAUDE.md

Проверь файлы:
- src/components/homework/GuidedHomeworkWorkspace.tsx
- src/components/homework/GuidedChatInput.tsx

Проверь:

1. Workspace:
   - placeholder prop удалён из <GuidedChatInput />?
   - taskNumber={currentTask?.order_num} добавлен?
   - modKey — удалён если неиспользуемый? isMac — удалён если modKey удалён?
   - Нет других изменений в workspace (sendUserMessage, states, callbacks)?

2. GuidedChatInput:
   - placeholder prop убран из interface?
   - placeholder убран из destructuring?
   - taskNumber? prop в interface?
   - Placeholders hardcoded: «Задача N: введите ответ...» / «Задача N: задайте вопрос AI...»?

3. TypeScript:
   - Нет type errors?
   - Нет unused imports после cleanup?

4. Backward compatibility:
   - Все остальные props без изменений?
   - Если кто-то ещё передаёт placeholder — TS ошибка (а не silent fail)?

Формат ответа:
- Executive summary
- Must fix
- Should fix
- Backward compatibility check
```

---

<a id="phase-4-review"></a>
## Phase 4 — Codex: Финальный end-to-end review всей фичи

```text
Сделай финальный end-to-end code review всей фичи: два поля ввода «Ответ» и «Обсуждение» в guided homework chat.

Контекст:
- Проблема: ученик путал Enter (обсуждение) и Ctrl+Enter (проверка) → ушёл к конкуренту.
- Решение: два раздельных поля, каждое со своим Enter, без Ctrl+Enter.
- Phase 1: core рефакторинг GuidedChatInput (два поля, два state, два handleKeyDown) + мобильный аккордеон
- Phase 3: workspace props (убрать placeholder, добавить taskNumber)

Сначала прочитай:
1. docs/features/specs/guided-chat-two-fields-tasks.md (полностью)
2. docs/product/specs/tutor_ai_agents/16-ux-principles-for-tutor-product-sokrat.md
3. docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules-sokrat.md
4. CLAUDE.md

Затем проверь все изменённые файлы:
- src/components/homework/GuidedChatInput.tsx
- src/components/homework/GuidedHomeworkWorkspace.tsx

Комплексная проверка:

1. UX корректность:
   - Enter в «Ответ» → checkAnswer flow (не discussion)?
   - Enter в «Обсуждение» → streamChat flow (не checkAnswer)?
   - Ctrl+Enter полностью убран?
   - Visual hierarchy: answer = primary (зелёный), discussion = secondary (серый)?
   - Ученик НЕ МОЖЕТ случайно перепутать поля?

2. Data flow:
   - onSendAnswer(answerText) → workspace.handleSendAnswer → sendUserMessage('answer')?
   - onSendStep(discussionText) → workspace.handleSendStep → sendUserMessage('question')?
   - attachedFiles → shared state, preview фиксированно над answer?
   - upload flow (Phase 2 media upload) не сломан?

3. Safari/iOS:
   - Оба textarea: fontSize 16px?
   - Все кнопки: touch-action manipulation?
   - Нет запрещённых API (crypto.randomUUID, Array.at, RegExp lookbehind)?
   - Нет framer-motion?
   - Input auto-zoom на iOS не срабатывает?

4. Mobile UX:
   - Discussion collapsed по умолчанию на <768px?
   - Toggle «Обсудить» → плавное раскрытие?
   - Answer compact mode при раскрытом discussion?
   - Breakpoint = md: (768px), НЕ sm: (640px)?
   - Keyboard не ломает layout?

5. Architecture:
   - Student/Tutor isolation: изменения только в student компонентах?
   - Нет изменений в backend (homework-api)?
   - Нет изменений в types (homework.ts)?
   - Нет новых зависимостей?

6. Performance:
   - memo() сохранён?
   - useCallback на обработчиках?
   - Нет лишних ререндеров?
   - CSS transitions (не JS анимации)?

7. Регрессии:
   - Retry failed message работает?
   - Race guard (isStreaming || isCheckingAnswer || isRequestingHint) работает для обоих полей?
   - Task switching: оба поля очищаются при переключении задач?
   - Completed task: оба поля disabled?
   - Bootstrap (AI intro) не сломан?

8. Соответствие UX-принципам (doc 16):
   - П1. Jobs-first: усиливает Job C (прорешивание)?
   - П5. AI → действие: ответ → проверка, обсуждение → помощь?
   - П12. Надёжность > эффектность: два поля надёжнее Ctrl+Enter?
   - П16. Физика ≠ текст: вложения (📎) работают в обоих полях?

Формат ответа:
- Executive summary: проблема решена?
- Must fix (blocking)
- Should fix
- Nice to have
- Safari compatibility: PASS / FAIL (с деталями)
- Mobile UX: PASS / FAIL
- Backward compatibility: PASS / FAIL
- Рекомендация: ready to merge / needs fixes
```
