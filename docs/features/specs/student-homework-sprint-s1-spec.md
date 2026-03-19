# Student Homework Sprint S1: Quick Wins — MathText + Bootstrap + Input Safety

**Дата:** 2026-03-18
**Тип задачи (doc 20):** Паттерн 3 — UX polish / fix
**Job:** Job C — «Провести ученика через прорешивание с AI»
**Wedge:** быстро собрать ДЗ и новую практику по теме урока
**Статус:** implemented (2026-03-19)

---

## Связь с JTBD

| Сценарий (doc 15) | Как Sprint S1 усиливает |
|---|---|
| C1: ученик получает ДЗ и решает с AI | MathText в условии — формулы читаемы; bootstrap для каждой задачи — AI встречает по каждой задаче |
| C2: AI помогает пошагово | Enter = безопасное обсуждение — ученик не теряет баллы случайно |
| B3: репетитор видит процесс | Bootstrap message label «Введение» — репетитор различает auto-intro от реального диалога |

---

## Задачи Sprint S1

| # | Задача | Файлы | Сложность |
|---|--------|-------|-----------|
| S1-1 | MathText в условии задачи | `GuidedHomeworkWorkspace.tsx` | S |
| S1-2 | Bootstrap для всех задач | `GuidedHomeworkWorkspace.tsx` | M |
| S1-3 | Enter = Обсудить, Ctrl+Enter = Ответ | `GuidedChatInput.tsx` | S |
| S1-4 | Bootstrap message label «Введение» | `GuidedChatMessage.tsx` | S |
| S1-5 | Shared preprocessLatex | `GuidedChatMessage.tsx`, `kb/ui/preprocessLatex.ts` | S |

---

## S1-1: MathText в условии задачи

### Проблема
Строка 1049 в `GuidedHomeworkWorkspace.tsx` рендерит `task_text` как plain `<p>`. Формулы `$$v = 72$$` км/ч видны как raw LaTeX (скриншот 2).

### Решение
Заменить `<p>` на `MathText` из `src/components/kb/ui/MathText.tsx`.

### Код — было

```tsx
// GuidedHomeworkWorkspace.tsx, строка 1049
<p className="text-sm font-medium whitespace-pre-wrap">{currentTask.task_text}</p>
```

### Код — стало

```tsx
// Импорт (в начало файла, рядом с другими lazy/import)
import MathText from '@/components/kb/ui/MathText';

// Строка 1049 — замена
<MathText text={currentTask.task_text} className="text-sm font-medium" />
```

### Важно
- `MathText` уже реализован и протестирован в KB Sprint 1
- Fast path: если текст не содержит `$`, `\(`, `\[` — рендерится как plain text (нулевой overhead)
- Lazy-loaded `ReactMarkdown + remarkMath + rehypeKatex` — не увеличивает initial bundle
- **НЕ импортировать** MathText/KaTeX в `src/components/ui/*` (performance rule из CLAUDE.md)

### Acceptance criteria
- [ ] `$$v = 72$$` рендерится как v = 72 с KaTeX
- [ ] `$t = 2{,}5$` рендерится как t = 2,5
- [ ] Plain text без формул отображается без задержки
- [ ] Safari 15+ совместимость
- [ ] `npm run lint && npm run build` pass

---

## S1-2: Bootstrap для всех задач

### Проблема
Bootstrap (первое AI-сообщение) генерируется только для задачи 1 (строка 818: `if (currentTask.order_num !== 1) return`). При переходе к задачам 2, 3, ... ученик видит пустой чат с placeholder.

### Решение
Убрать ограничение `order_num !== 1`. Bootstrap запускается при первом открытии любой задачи, если для неё нет сообщений.

### Код — было

```tsx
// GuidedHomeworkWorkspace.tsx, строки 815-828
useEffect(() => {
  if (!threadId || !currentTask) return;
  if (threadStatus !== 'active') return;
  if (currentTask.order_num !== 1) return;  // ← ОГРАНИЧЕНИЕ
  if (isStreaming || isCheckingAnswer || isRequestingHint) return;

  const key = `${threadId}:task-1`;
  if (bootstrapStartedRef.current.has(key)) return;

  const hasAnyTaskMessages = messages.some((message) => message.task_order === 1);
  if (hasAnyTaskMessages) {
    bootstrapStartedRef.current.add(key);
    return;
  }

  bootstrapStartedRef.current.add(key);
  // ... runBootstrap()
```

### Код — стало

```tsx
// GuidedHomeworkWorkspace.tsx — bootstrap effect
useEffect(() => {
  if (!threadId || !currentTask) return;
  if (threadStatus !== 'active') return;
  // Убрано: if (currentTask.order_num !== 1) return;
  if (isStreaming || isCheckingAnswer || isRequestingHint) return;

  const taskOrder = currentTask.order_num;
  const key = `${threadId}:task-${taskOrder}`;
  if (bootstrapStartedRef.current.has(key)) return;

  const hasAnyTaskMessages = messages.some(
    (message) => message.task_order === taskOrder,
  );
  if (hasAnyTaskMessages) {
    bootstrapStartedRef.current.add(key);
    return;
  }

  bootstrapStartedRef.current.add(key);

  const runBootstrap = async () => {
    setIsStreaming(true);
    setStreamingContent('');

    // Resolve task image to signed URL for AI (if task has image)
    let bootstrapImageUrl: string | undefined;
    if (currentTask.task_image_url) {
      const signedUrl = await getStudentTaskImageSignedUrlViaBackend(
        assignment.id, currentTask.id,
      );
      if (signedUrl) bootstrapImageUrl = signedUrl;
    }

    let content = '';
    try {
      await streamChat({
        messages: [
          {
            role: 'user',
            content: 'Сформулируй короткое стартовое сообщение для ученика по этой задаче.',
          },
        ],
        taskContext: buildTaskContext(assignment, currentTask, assignment.tasks.length, 'answer'),
        taskImageUrl: bootstrapImageUrl,
        onDelta: (delta) => {
          content += delta;
          setStreamingContent(content);
        },
        onDone: () => undefined,
      });
    } catch {
      // ignore bootstrap stream errors
    } finally {
      setIsStreaming(false);
      setStreamingContent('');
    }

    const introText = content.trim()
      || `Начинаем задачу ${taskOrder}. Напиши решение, и я сразу помогу проверить его.`;

    // Persist intro to DB so it's not regenerated on every page load
    try {
      await saveThreadMessage(threadId!, 'assistant', introText, taskOrder, 'system');
      void queryClient.invalidateQueries({
        queryKey: ['student', 'homework', 'thread', assignment.id],
      });
    } catch (e) {
      console.warn('Failed to persist bootstrap intro:', e);
    }

    const introId = `local-bootstrap-${threadId}-task-${taskOrder}`;
    setMessages((prev) => (
      prev.some((message) => message.id === introId)
        ? prev
        : [
          ...prev,
          {
            id: introId,
            role: 'assistant',
            content: introText,
            image_url: null,
            task_order: taskOrder,
            created_at: new Date().toISOString(),
            message_kind: 'system',
            message_delivery_status: 'sent',
          },
        ]
    ));
    trackGuidedHomeworkEvent('guided_first_run_intro', {
      assignmentId: assignment.id,
      taskOrder,
    });
  };

  void runBootstrap();
}, [
  threadId, currentTask, threadStatus,
  isStreaming, isCheckingAnswer, isRequestingHint,
  messages, assignment, queryClient,
]);
```

### Ключевые изменения
1. Убрано `if (currentTask.order_num !== 1) return`
2. `key` и `hasAnyTaskMessages` используют `currentTask.order_num` вместо хардкод `1`
3. `introId` включает `task-${taskOrder}` для уникальности
4. Fallback-текст адаптирован: `Начинаем задачу ${taskOrder}...`
5. Tracking event включает `taskOrder`

### Edge cases
- **Быстрый переход между задачами**: `bootstrapStartedRef` предотвращает повторную генерацию. Ref сбрасывается только при размонтировании компонента.
- **Параллельные bootstrap**: `isStreaming` guard блокирует запуск нового bootstrap пока текущий стримится.
- **Сохранённые сообщения при reload**: `hasAnyTaskMessages` проверяет наличие DB-сообщений — если bootstrap уже сохранён, повторная генерация не запускается.

### Acceptance criteria
- [ ] При переходе на задачу 2, 3, ... без сообщений → AI генерирует intro
- [ ] Intro сохраняется в БД с правильным `task_order`
- [ ] При повторном открытии — intro загружается из БД, не регенерируется
- [ ] Задача 1 работает как прежде
- [ ] `task_image_url` корректно резолвится в signed URL для каждой задачи
- [ ] `npm run lint && npm run build` pass

---

## S1-3: Enter = Обсудить, Ctrl+Enter = Ответ

### Проблема
Сейчас `Enter` отправляет как «Ответ» (финальный — AI проверяет и снижает баллы при ошибке). Ученик может случайно отправить промежуточный шаг как финальный ответ, потеряв баллы.

### Решение
- `Enter` → «Обсудить» (mode `question`, безопасный — AI обсуждает, баллы не затрагиваются)
- `Ctrl+Enter` / `Cmd+Enter` → «Ответ» (mode `answer`, проверка с verdict)
- Обновить визуальные подсказки (placeholder, tooltip, button order)

### Код — было

```tsx
// GuidedChatInput.tsx, строки 61-68
const handleKeyDown = useCallback(
  (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendAnswer();  // ← Enter = Ответ (опасно!)
    }
  },
  [handleSendAnswer],
);
```

### Код — стало

```tsx
// GuidedChatInput.tsx — новый handleKeyDown
const handleKeyDown = useCallback(
  (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        handleSendAnswer(); // Ctrl/Cmd + Enter = Ответ (финальный)
      } else {
        handleSendStep(); // Enter = Обсудить (безопасный)
      }
    }
  },
  [handleSendAnswer, handleSendStep],
);
```

### Обновить кнопки — поменять порядок и подсказки

```tsx
// GuidedChatInput.tsx — render buttons (строки 94-116)
<div className="flex gap-1.5 shrink-0">
  <Button
    variant="outline"
    size="sm"
    onClick={handleSendStep}
    disabled={!canSend}
    className="h-10 px-2.5 gap-1 text-xs whitespace-nowrap"
    title="Обсудить шаг решения с AI (Enter)"
  >
    {isLoading ? spinner : <MessageCircle className="h-3.5 w-3.5" />}
    Шаг
  </Button>
  <Button
    size="sm"
    onClick={handleSendAnswer}
    disabled={!canSend}
    className="h-10 px-2.5 gap-1 text-xs whitespace-nowrap"
    title="Итоговый ответ — AI проверит (Ctrl+Enter)"
  >
    {isLoading ? spinner : <CheckCircle2 className="h-3.5 w-3.5" />}
    Ответ
  </Button>
</div>
```

### Обновить placeholder

```tsx
// GuidedHomeworkWorkspace.tsx, строка 1176-1180
placeholder={
  currentTask
    ? `Задача ${currentTask.order_num}: ответ или шаг решения...`
    : 'Введите ответ или шаг решения...'
}
```

**Стало:**

```tsx
placeholder={
  currentTask
    ? `Задача ${currentTask.order_num}: обсудите с AI (Enter) или дайте ответ (Ctrl+Enter)...`
    : 'Обсудите с AI (Enter) или ответ (Ctrl+Enter)...'
}
```

### Acceptance criteria
- [ ] `Enter` отправляет как «Шаг» (message_kind: `question`)
- [ ] `Ctrl+Enter` (Win) / `Cmd+Enter` (Mac) отправляет как «Ответ» (message_kind: `answer`)
- [ ] `Shift+Enter` = перенос строки (без изменений)
- [ ] Button titles обновлены с keyboard shortcuts
- [ ] Placeholder содержит подсказку по hotkeys
- [ ] На iOS Safari: `Ctrl+Enter` недоступен → ученик использует кнопку «Ответ»
- [ ] `npm run lint && npm run build` pass

---

## S1-4: Bootstrap message label «Введение»

### Проблема
Bootstrap сообщение (`message_kind: 'system'`) отображается как обычный AI-бубл без пометки. Репетитор в GuidedThreadViewer не может отличить auto-intro от реального AI-ответа.

### Решение
Добавить label «Введение» для сообщений с `message_kind === 'system'` в `formatMessageKind()`.

### Код — было

```tsx
// GuidedChatMessage.tsx, строки 57-63
function formatMessageKind(kind: GuidedMessageKind | undefined): string | null {
  if (!kind) return null;
  if (kind === 'hint_request') return 'Подсказка';
  if (kind === 'question') return 'Шаг решения';
  if (kind === 'answer') return 'Ответ';
  return null;
}
```

### Код — стало

```tsx
// GuidedChatMessage.tsx — обновлённая formatMessageKind
function formatMessageKind(kind: GuidedMessageKind | undefined): string | null {
  if (!kind) return null;
  if (kind === 'system') return 'Введение';
  if (kind === 'hint_request') return 'Подсказка';
  if (kind === 'question') return 'Шаг решения';
  if (kind === 'answer') return 'Ответ';
  return null;
}
```

### Проверить rendering path

Текущая логика рендера (строка 183):
```tsx
if (isSystem) {
  // renders as centered pill
}
```

`isSystem` проверяет `message.role === 'system'` (строка 108). Bootstrap сохраняется с `role: 'assistant'`, поэтому НЕ попадает в system pill. Это корректно.

Но если когда-либо bootstrap попадёт с `role: 'system'` — он отрендерится как крошечный pill. **Добавить safety check:**

```tsx
// GuidedChatMessage.tsx, строка 183 — обновить system-rendering
if (isSystem && message.message_kind !== 'system') {
  // Only render as centered pill for true system messages (e.g., "thread created")
  // Bootstrap intros (message_kind: 'system') should render as normal AI bubbles
  return (
    <div className="flex justify-center my-2">
      <div className="text-xs text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full max-w-[85%] text-center">
        {message.content}
      </div>
    </div>
  );
}
```

**Или проще — изменить проверку isSystem:**

```tsx
// Строка 108
const isSystem = message.role === 'system' && message.message_kind !== 'system';
```

Это гарантирует, что bootstrap (kind='system', role='assistant' или role='system') всегда рендерится как полноценный AI-бубл с label «Введение».

### Также обновить GuidedThreadViewer

Тот же `formatMessageKind` может быть нужен в `GuidedThreadViewer.tsx`. Проверить при реализации — если ThreadViewer использует свой рендер, добавить label «Введение» и там.

### Acceptance criteria
- [ ] Bootstrap сообщение показывает label «ВВЕДЕНИЕ» (uppercase, text-[10px]) над текстом
- [ ] Bootstrap рендерится как полноценный AI-бубл (не как centered pill)
- [ ] Label видим как в student view, так и в tutor GuidedThreadViewer
- [ ] Другие message kinds (Подсказка, Шаг решения, Ответ) не затронуты
- [ ] `npm run lint && npm run build` pass

---

## S1-5: Shared preprocessLatex

### Проблема
`preprocessLatex()` продублирована в двух местах:
- `src/components/homework/GuidedChatMessage.tsx` (строки 35-45, inline)
- `src/components/kb/ui/preprocessLatex.ts` (canonical)

### Решение
Удалить inline `preprocessLatex` из `GuidedChatMessage.tsx`, импортировать из KB-модуля.

### Код — было

```tsx
// GuidedChatMessage.tsx, строки 35-45
/** Convert LaTeX delimiters to remark-math compatible format */
function preprocessLatex(text: string): string {
  // Convert \[...\] to $$...$$
  text = text.replace(/\\\[/g, '$$');
  text = text.replace(/\\\]/g, '$$');
  // Convert \(...\) to $...$
  text = text.replace(/\\\(/g, '$');
  text = text.replace(/\\\)/g, '$');
  // Fix \textfrac to \frac
  text = text.replace(/\\textfrac/g, '\\frac');
  return text;
}
```

### Код — стало

```tsx
// GuidedChatMessage.tsx — удалить inline функцию, добавить импорт
import { preprocessLatex } from '@/components/kb/ui/preprocessLatex';
```

### Проверить совместимость

Канонический `preprocessLatex` в KB (`src/components/kb/ui/preprocessLatex.ts`) должен включать все те же замены. Если отличается — объединить, используя KB-версию как canonical source.

### Acceptance criteria
- [ ] Одна функция `preprocessLatex` в `src/components/kb/ui/preprocessLatex.ts`
- [ ] `GuidedChatMessage.tsx` импортирует из shared utility
- [ ] Нет дублирования
- [ ] LaTeX рендеринг в guided chat работает как прежде
- [ ] `npm run lint && npm run build` pass

---

## Порядок реализации

```
S1-5 (shared preprocessLatex)     — нет зависимостей, чистый refactor
  ↓
S1-4 (bootstrap label)            — нет зависимостей, чистый UI
  ↓
S1-1 (MathText в условии)         — зависит от preprocessLatex (уже shared)
  ↓
S1-3 (Enter = Обсудить)           — нет зависимостей, чистый input change
  ↓
S1-2 (bootstrap для всех задач)   — самый рискованный, идёт последним
```

---

## Claude Code промпт — реализация Sprint S1

**Тип (doc 20):** Паттерн 3 — UX polish / fix

```text
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Нужно реализовать Sprint S1: Quick Wins для student homework solving (guided mode).

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ + их ученики;
- wedge: быстро собрать ДЗ и новую практику по теме урока;
- Job C: провести ученика через прорешивание с AI;
- продукт = workspace / bundle: AI + база + домашки + материалы;
- AI = draft + action, а не generic chat.

Сначала обязательно прочитай:
1. docs/product/specs/tutor_ai_agents/16-ux-principles-for-tutor-product-sokrat.md
2. docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules-sokrat.md
3. docs/product/specs/tutor_ai_agents/19-agent-workflow-and-review-system-sokrat.md
4. docs/features/specs/student-homework-ux-audit-and-improvements.md
5. docs/features/specs/student-homework-sprint-s1-spec.md
6. CLAUDE.md (секции: Система домашних заданий, Кросс-браузерная совместимость, performance.md)

Реализуй 5 задач в таком порядке:

Phase 1: Shared preprocessLatex (S1-5)
- Удалить inline preprocessLatex из GuidedChatMessage.tsx
- Импортировать из src/components/kb/ui/preprocessLatex.ts
- Проверить совместимость обеих реализаций

Phase 2: Bootstrap message label (S1-4)
- Добавить 'system' → 'Введение' в formatMessageKind()
- Safety check: bootstrap с role='system' не рендерится как pill
- Проверить, что GuidedThreadViewer тоже показывает label

Phase 3: MathText в условии задачи (S1-1)
- Заменить <p> на <MathText> в строке 1049 GuidedHomeworkWorkspace.tsx
- Lazy-load, не добавлять в initial bundle

Phase 4: Enter = Обсудить (S1-3)
- Изменить Enter → handleSendStep (question mode)
- Добавить Ctrl/Cmd+Enter → handleSendAnswer (answer mode)
- Обновить title на кнопках и placeholder

Phase 5: Bootstrap для всех задач (S1-2)
- Убрать ограничение order_num !== 1
- Обновить key, hasAnyTaskMessages, introId с task_order
- Обновить fallback текст и tracking event

Что НЕ делать:
- НЕ менять business logic scoring
- НЕ менять backend endpoints
- НЕ добавлять framer-motion
- НЕ трогать src/components/ui/*
- НЕ расширять scope в сторону file upload или free navigation (это Sprint S3/S2)

В конце обязательно:
1. перечисли changed files
2. дай краткий summary реализации
3. покажи validation results (npm run lint && npm run build)
4. напиши, какие документы нужно обновить после этой реализации
5. self-check against docs 16, 17, 19

Проверь минимум:
- нужно ли обновить CLAUDE.md (секция "Система домашних заданий")
- нужно ли обновить docs/features/specs/student-homework-ux-audit-and-improvements.md
```

---

## GPT-5.4 / Codex Review промпт

**Тип (doc 20):** Паттерн 4 — Review

```text
Сделай code review реализованной student homework feature:
Sprint S1: Quick Wins — MathText + Bootstrap fix + Input safety

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ + их ученики;
- wedge: быстро собрать ДЗ и новую практику по теме урока;
- Job C: провести ученика через прорешивание с AI;
- продукт = AI + база + домашки + материалы;
- нельзя скатываться в generic chat UX.

Сначала прочитай:
1. docs/product/specs/tutor_ai_agents/16-ux-principles-for-tutor-product-sokrat.md
2. docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules-sokrat.md
3. docs/product/specs/tutor_ai_agents/19-agent-workflow-and-review-system-sokrat.md
4. docs/features/specs/student-homework-sprint-s1-spec.md
5. docs/features/specs/student-homework-ux-audit-and-improvements.md
6. CLAUDE.md

Затем прочитай changed files и проверь:

1. Какой Job усиливает реализация?
2. Усиливает ли она wedge?
3. Нет ли product drift?
4. Нет ли generic chat UX?
5. Есть ли clear primary CTA?
6. Переводится ли результат в действие?
7. Не спрятан ли частый flow слишком глубоко?
8. Не добавлен ли лишний scope?
9. Нет ли architecture/state risks?
10. Нет ли mobile UX problems?

Дополнительно проверить для Sprint S1:
11. preprocessLatex — нет ли дублирования, совместима ли KB-версия?
12. Bootstrap — не регенерируется ли при повторном открытии?
13. Bootstrap — race conditions при быстром переключении задач?
14. Enter/Ctrl+Enter — работает ли на Mac (Cmd+Enter)?
15. Enter/Ctrl+Enter — как ведёт себя на iOS Safari (нет Ctrl)?
16. MathText — не ломает ли layout при длинных формулах?
17. MathText — не добавлен ли в src/components/ui/* (performance rule)?
18. Bootstrap label — виден ли в GuidedThreadViewer (tutor side)?
19. Safari 15+ совместимость всех изменений?
20. Structural breakpoints = md: для grid/flex?

Формат ответа:
- Executive summary
- Must fix (blocking)
- Should fix (important)
- Nice to have
- Product drift risks
- UX risks
- Architecture/state risks
- Performance risks
- Safari/mobile compatibility risks
- Docs that may need update
```

---

## Обновление CLAUDE.md после Sprint S1

После реализации обновить секцию **«Система домашних заданий»** в `CLAUDE.md`:

```md
### Student-side Guided Homework UX (Sprint S1, 2026-03-18)
- `GuidedHomeworkWorkspace.tsx` — task_text рендерится через `MathText` (LaTeX в условии задачи)
- Bootstrap (первое AI-сообщение) генерируется для КАЖДОЙ задачи (не только задача 1)
- `GuidedChatInput.tsx` — Enter = «Обсудить» (question mode), Ctrl/Cmd+Enter = «Ответ» (answer mode)
- `GuidedChatMessage.tsx` — bootstrap сообщения показывают label «Введение» (message_kind: 'system')
- `preprocessLatex` — shared utility из `src/components/kb/ui/preprocessLatex.ts`, не дублировать
- **Правило**: при добавлении нового пути к AI bootstrap — проверить все task_order, не только 1
```

---

## Валидация

```bash
npm run lint
npm run build
npm run test
npm run smoke-check
```

Дополнительно:
- Открыть guided homework с 2+ задачами
- Проверить bootstrap на задаче 1 и задаче 2
- Проверить Enter → «Шаг», Ctrl+Enter → «Ответ»
- Проверить LaTeX в условии задачи
- Проверить label «Введение» на bootstrap сообщении
- Проверить в Safari 15+ (iOS и macOS)
- Проверить в Lovable preview (~640px width)

---

## Definition of Done (doc 19)

- [x] Связь с Job C: «Провести ученика через прорешивание»
- [x] Связь с wedge: домашки + практика
- [x] Feature spec создан
- [ ] Claude Code реализовал
- [ ] Codex/GPT-5.4 сделал review
- [ ] Замечания учтены
- [ ] UX/UI-канон (docs 16, 17) не нарушен
- [ ] Success signal: LaTeX читаем, bootstrap на всех задачах, ученик не теряет баллы от Enter
- [ ] CLAUDE.md обновлён

---

*Документ следует паттернам из docs 19 (Agent Workflow) и 20 (Claude Code Prompt Patterns).*
