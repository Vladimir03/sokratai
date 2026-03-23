# Task Specs: Два поля ввода «Ответ» и «Обсуждение» в guided chat

**UX-аудит:** `student-homework-ux-improvements.html` → раздел 3.7
**Дата:** 2026-03-22
**Sprint:** S2
**Тип задачи:** C — UX polish / fix (критично — подтверждённый churn)

---

## Контекст проблемы

Реальный ученик нажал Enter (= «Шаг», обсуждение) вместо Ctrl+Enter (= «Ответ», проверка). AI начал обсуждать вместо проверки. Ученик расстроился и ушёл к конкуренту. Обратная связь: **«2 поля было бы круто»**.

**Корневая причина:** одно поле ввода + клавиатурное разделение Enter/Ctrl+Enter — недискавербельно, особенно на мобильных.

**Решение:** два раздельных поля — «Ответ» (зелёная рамка, Enter = проверка) и «Обсуждение» (серая рамка, Enter = вопрос AI). На мобильных «Обсуждение» свёрнуто по умолчанию.

---

## Scope (только веб-версия)

**В scope:**
- Рефакторинг `GuidedChatInput.tsx` → два поля (AnswerField + DiscussionField)
- Мобильный аккордеон: «Обсуждение» свёрнуто по умолчанию
- Обновление placeholder-ов в `GuidedHomeworkWorkspace.tsx`
- Обновление race guard в workspace
- CSS transitions для toggle (без framer-motion)

**Вне scope:**
- Backend (callbacks `onSendAnswer` / `onSendStep` без изменений)
- AI логика (режимы `answer` / `question` без изменений)
- Telegram бот
- Tutor view (GuidedThreadViewer)
- Drag-and-drop, новые attachment features

---

## Обзор фаз

| Фаза | Описание | Effort | Зависимости |
|------|----------|--------|-------------|
| **Phase 1** | Рефакторинг GuidedChatInput → два поля | M | — |
| **Phase 2** | Мобильный аккордеон + адаптив | S | Phase 1 |
| **Phase 3** | Обновление Workspace props + placeholders | S | Phase 1 |
| **Phase 4** | QA: кросс-браузерная проверка + edge cases | S | Phase 1-3 |

**Рекомендация:** Phase 1 → Phase 3 → Phase 2 → Phase 4. Начать с core UI, потом подключить workspace, потом адаптив, потом QA.

---

## Phase 1: Рефакторинг GuidedChatInput → два поля

### Задача 1.1: Разделить textarea на два поля (AnswerField + DiscussionField)

**Файл:** `src/components/homework/GuidedChatInput.tsx`

**Текущее состояние (before):**
```typescript
// Одно поле с двумя кнопками
const [message, setMessage] = useState('');

const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      handleSendAnswer();
    } else {
      handleSendStep();
    }
  }
}, [handleSendAnswer, handleSendStep]);

// JSX: одна textarea + два кнопки [Шаг] [Ответ]
```

**Target состояние (after):**
```typescript
// Два отдельных поля — каждое со своим state
const [answerText, setAnswerText] = useState('');
const [discussionText, setDiscussionText] = useState('');

// Поле «Ответ»: Enter = handleSendAnswer (ВСЕГДА)
const handleAnswerKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSendAnswer();
  }
}, [handleSendAnswer]);

// Поле «Обсуждение»: Enter = handleSendStep (ВСЕГДА)
const handleDiscussionKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSendStep();
  }
}, [handleSendStep]);

// JSX: две секции — AnswerField (зелёная) и DiscussionField (серая)
```

**Структура JSX (desktop):**
```
┌─ border-t bg-background ──────────────────────────────┐
│ [AttachmentPreview — shared, над активным полем]        │
│                                                         │
│ ┌─ border-2 border-green rounded-lg p-3 ──────────────┐ │
│ │ ✅ Ответ к задаче                                    │ │
│ │ [📎] [textarea: "Введите ответ: v = ..."] [Проверить]│ │
│ │ Enter = отправить на проверку                        │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                         │
│ ┌─ border border-muted rounded-lg p-3 ────────────────┐ │
│ │ 💬 Обсуждение                                        │ │
│ │ [📎] [textarea: "Задать вопрос AI..."]    [Спросить] │ │
│ │ Enter = обсудить с AI                                │ │
│ └──────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

**Детали реализации:**

1. **Два state**: `answerText` и `discussionText` вместо одного `message`
2. **Два ref**: `answerRef` и `discussionRef` для auto-resize
3. **Два handleKeyDown**: каждый вызывает только свой callback
4. **Убрать Ctrl+Enter логику** — больше не нужна
5. **Attachment привязка**: `attachedFiles` привязаны к **активному полю** (последний в фокусе). `activeField` state: `'answer' | 'discussion'` — трекается по `onFocus` event
6. **AttachmentPreview** рендерится над активным полем (или над answer по умолчанию)
7. **Кнопка 📎** — в каждом поле, но физически одна shared `<input type="file">`. Клик 📎 в любом поле: сначала `setActiveField(field)`, потом `fileInputRef.current.click()`

**Props interface (без изменений для workspace):**
```typescript
interface GuidedChatInputProps {
  onSendAnswer: (text: string) => void;   // БЕЗ ИЗМЕНЕНИЙ
  onSendStep: (text: string) => void;     // БЕЗ ИЗМЕНЕНИЙ
  isLoading: boolean;                      // БЕЗ ИЗМЕНЕНИЙ
  disabled?: boolean;                      // БЕЗ ИЗМЕНЕНИЙ
  // placeholder убираем — у каждого поля свой hardcoded placeholder
  attachedFiles: File[];                   // БЕЗ ИЗМЕНЕНИЙ
  onFileSelect: (file: File) => void;      // БЕЗ ИЗМЕНЕНИЙ
  onFileRemove: (index: number) => void;   // БЕЗ ИЗМЕНЕНИЙ
  isUploading: boolean;                    // БЕЗ ИЗМЕНЕНИЙ
  taskNumber?: number;                     // НОВЫЙ: номер задачи для placeholder «Задача N»
}
```

**Визуальное кодирование полей:**

| Аспект | Ответ | Обсуждение |
|--------|-------|------------|
| Рамка | `border-2 border-green-600` | `border border-slate-200` |
| Иконка | `✅` (CheckCircle2, green) | `💬` (MessageCircle, muted) |
| Label | `font-bold text-green-700` «Ответ к задаче» | `font-semibold text-muted-foreground` «Обсуждение» |
| Кнопка | `variant="default" className="bg-green-600 hover:bg-green-700"` «Проверить» | `variant="outline"` «Спросить» |
| Hint под полем | `text-[10px] text-muted-foreground` «Enter = проверить» | «Enter = обсудить с AI» |
| Кнопка при isLoading | spinner + disabled | spinner + disabled |

**Acceptance criteria:** ✅ Phase 1 DONE (2026-03-22)
- [x] Два поля ввода рендерятся: «Ответ» сверху (зелёная рамка), «Обсуждение» снизу (серая рамка)
- [x] Enter в поле «Ответ» → вызывает `onSendAnswer(answerText)`
- [x] Enter в поле «Обсуждение» → вызывает `onSendStep(discussionText)`
- [x] Ctrl+Enter / Cmd+Enter больше не используется (убрана вся логика)
- [x] Shift+Enter = новая строка в обоих полях (сохранено)
- [x] Оба поля: auto-resize до max-height 150px
- [x] Оба поля: `font-size: 16px` (iOS zoom prevention)
- [x] Оба поля: `touch-action: manipulation` на всех interactive элементах
- [x] Каждое поле очищается **только при своей** отправке (answer очищает только answerText, discussion — discussionText)
- [x] Props interface backward compatible (`placeholder` deprecated, добавлен `taskNumber?`)
- [x] `isLoading` / `disabled` блокирует оба поля одновременно
- [x] Clipboard paste (onPaste) работает в обоих полях — добавляет file к `attachedFiles` через `onFileSelect`

**Решения по review:**
- `activeField` state убран — `AttachmentPreview` фиксированно над answer-полем (без визуальных прыжков при смене фокуса)
- `placeholder` prop сохранён как `@deprecated` для backward compat с Workspace (Phase 3 удалит)

**Не делать:**
- Не менять сигнатуры `onSendAnswer` / `onSendStep` — workspace использует их as-is
- Не добавлять новые npm-зависимости
- Не использовать framer-motion (performance.md)
- Не менять AttachmentPreview — оставить как есть, просто переместить рендер
- Не менять handleFileChange — оставить shared file input

---

### Задача 1.2: Обновить clipboard paste для двух полей ✅

**Файл:** `src/components/homework/GuidedChatInput.tsx`

**Текущее состояние:** `onPaste` handler на wrapping `<div>` — перехватывает image paste глобально.

**Target:** оставить `onPaste` на wrapping `<div>`, attachments shared. Текстовый paste проходит нативно в ту textarea, которая в фокусе.

**Acceptance criteria:** ✅ DONE (2026-03-22)
- [x] Clipboard paste (Ctrl+V / Cmd+V) с изображением → file добавляется в `attachedFiles`
- [x] Text paste в поле «Ответ» → текст вставляется в `answerText`
- [x] Text paste в поле «Обсуждение» → текст вставляется в `discussionText`
- [x] Работает в Chrome, Safari, Firefox (тот же fallback через clipboardData.items)

---

## Phase 2: Мобильный аккордеон + адаптив

### Задача 2.1: Collapsible «Обсуждение» на мобильных

**Файл:** `src/components/homework/GuidedChatInput.tsx`

**Поведение:**
- На **desktop** (`md:` breakpoint, 768px+): оба поля видны всегда
- На **mobile** (< 768px): поле «Обсуждение» свёрнуто по умолчанию
  - Видна кнопка-ссылка: «💬 Обсудить шаг с AI ▾»
  - Тап → разворачивает поле «Обсуждение» с CSS `transition-all duration-200`
  - `isDiscussionExpanded` state: `false` по умолчанию на mobile
  - После отправки discussion-сообщения: поле остаётся развёрнутым (не сворачивать)
  - Кнопка ▴ в развёрнутом состоянии → сворачивает обратно

**Определение mobile:**
```typescript
// Не использовать window.innerWidth напрямую — SSR unsafe.
// Использовать CSS + Tailwind: md:block / hidden для desktop/mobile вариантов.
// Или useMediaQuery hook на `(min-width: 768px)` — но без matchMedia polyfill.
// Рекомендация: CSS-only через Tailwind классы.
```

**CSS-реализация (Tailwind):**
```
// Desktop: оба поля всегда видны
<div className="hidden md:block"> {/* Discussion field — desktop */} </div>

// Mobile: collapsed toggle + expandable field
<div className="md:hidden"> {/* Discussion toggle/field — mobile */} </div>
```

**Альтернатива (проще, рекомендуется):** `isDiscussionExpanded` state + `max-height` transition:
```typescript
const [isDiscussionExpanded, setIsDiscussionExpanded] = useState(false);

// Wrapper discussion:
<div
  className="overflow-hidden transition-all duration-200 md:max-h-none"
  style={{ maxHeight: isDiscussionExpanded ? '300px' : '0px' }}
>
```
**Важно:** на desktop (`md:`) — `max-h-none` переопределяет inline style, поле всегда видно.

**Acceptance criteria:** ✅ Phase 2.1 DONE (2026-03-23)
- [x] Desktop (≥768px): оба поля видны, нет toggle-кнопки
- [x] Mobile (<768px): «Обсуждение» свёрнуто, видна кнопка «💬 Обсудить шаг с AI ▾»
- [x] Тап на кнопку → плавное раскрытие (CSS transition, duration 200ms)
- [x] Кнопка ▴ → сворачивание обратно
- [x] После отправки discussion-сообщения → поле остаётся раскрытым
- [x] Structural breakpoint: `md:` (768px), **НЕ** `sm:` (640px)
- [x] Нет framer-motion — только CSS transitions
- [x] `aria-expanded` + `aria-controls` на toggle-кнопке (accessibility)
- [x] `max-h-96` (384px) вместо `max-h-[300px]` — запас для text zoom

---

### Задача 2.2: Compact answer field при раскрытом discussion (mobile)

**Файл:** `src/components/homework/GuidedChatInput.tsx`

**Поведение:** когда «Обсуждение» раскрыто на мобильных — поле «Ответ» переключается в compact-режим:
- Label скрывается
- Одна строка: `[✅] [textarea compact] [кнопка]`
- Padding уменьшается: `p-3` → `p-2`
- Экономит ~40px вертикального пространства

**Реализация:**
```typescript
// compact mode для answer field на mobile когда discussion expanded
const answerCompact = isDiscussionExpanded; // только влияет на mobile layout
```

```jsx
<div className={cn(
  "border-2 border-green-600 rounded-lg",
  answerCompact ? "p-2 md:p-3" : "p-3"
)}>
  {/* Label: скрывать на mobile в compact mode */}
  <div className={cn(
    "flex items-center gap-1.5 mb-2",
    answerCompact && "hidden md:flex"
  )}>
    ...label...
  </div>
  ...input row...
</div>
```

**Acceptance criteria:** ✅ Phase 2.2 DONE (2026-03-23)
- [x] Mobile + discussion expanded: answer field в compact-режиме (нет label, меньше padding)
- [x] Desktop: answer field всегда в full-режиме (label видна)
- [x] Переход compact ↔ full плавный (CSS transition)
- [x] `answerCompact` derived variable для читаемости

---

## Phase 3: Обновление Workspace + placeholders

### Задача 3.1: Обновить GuidedHomeworkWorkspace props

**Файл:** `src/components/homework/GuidedHomeworkWorkspace.tsx`

**Что сделать:**

1. **Убрать `placeholder` prop** — теперь hardcoded в GuidedChatInput
2. **Добавить `taskNumber` prop** — из `currentTask.order_num`
3. **Убрать `modKey` usage** в placeholder строке (line 1378-1380)

**Before (lines 1372-1386):**
```tsx
<GuidedChatInput
  onSendAnswer={handleSendAnswer}
  onSendStep={handleSendStep}
  isLoading={isStreaming || isCheckingAnswer || isRequestingHint}
  disabled={threadStatus !== 'active' || !isViewingActiveTask}
  placeholder={
    currentTask
      ? `Задача ${currentTask.order_num}: обсудите с AI (Enter) или ответ (${modKey}+Enter)...`
      : `Обсудите с AI (Enter) или ответ (${modKey}+Enter)...`
  }
  attachedFiles={attachedFiles}
  onFileSelect={handleFileSelect}
  onFileRemove={handleFileRemove}
  isUploading={isUploading}
/>
```

**After:**
```tsx
<GuidedChatInput
  onSendAnswer={handleSendAnswer}
  onSendStep={handleSendStep}
  isLoading={isStreaming || isCheckingAnswer || isRequestingHint}
  disabled={threadStatus !== 'active' || !isViewingActiveTask}
  taskNumber={currentTask?.order_num}
  attachedFiles={attachedFiles}
  onFileSelect={handleFileSelect}
  onFileRemove={handleFileRemove}
  isUploading={isUploading}
/>
```

4. **Убрать неиспользуемые переменные** — `modKey` constant (line 70) может быть удалена, если больше нигде не используется. Проверить grep перед удалением.

**Acceptance criteria:**
- [ ] `placeholder` prop удалён из `<GuidedChatInput />`
- [ ] `taskNumber` prop передаётся
- [ ] Нет регрессий: `handleSendAnswer`, `handleSendStep`, `attachedFiles` — без изменений
- [ ] `modKey` удалён если не используется в других местах файла

**Не делать:**
- Не менять `sendUserMessage` (backend-агностик)
- Не менять `handleCheckAnswer` / `handleFileSelect` / `handleFileRemove`
- Не менять state management (attachedFiles, isUploading)

---

### Задача 3.2: Hardcoded placeholders в GuidedChatInput

**Файл:** `src/components/homework/GuidedChatInput.tsx`

**Placeholders:**
```typescript
// Answer field
const answerPlaceholder = taskNumber
  ? `Задача ${taskNumber}: введите ответ...`
  : 'Введите ответ...';

// Discussion field
const discussionPlaceholder = taskNumber
  ? `Задача ${taskNumber}: задайте вопрос AI...`
  : 'Задайте вопрос AI...';
```

**Acceptance criteria:**
- [ ] Answer placeholder содержит номер задачи (если передан)
- [ ] Discussion placeholder содержит номер задачи
- [ ] Нет упоминания Enter/Ctrl+Enter в placeholder (hint под полем, не в placeholder)

---

## Phase 4: QA — кросс-браузерная проверка

### Задача 4.1: Чеклист ручной проверки

**Браузеры:**
- [ ] Chrome desktop (Windows)
- [ ] Chrome mobile (Android)
- [ ] Safari desktop (macOS)
- [ ] Safari mobile (iPhone)

**Функциональность:**
- [ ] Enter в поле «Ответ» → AI проверяет ответ (CheckAnswer flow)
- [ ] Enter в поле «Обсуждение» → AI обсуждает (StreamChat flow)
- [ ] Shift+Enter → новая строка в обоих полях
- [ ] 📎 в обоих полях → открывает file picker
- [ ] Clipboard paste (Ctrl+V / Cmd+V) → image прикрепляется
- [ ] Вложения отображаются в AttachmentPreview
- [ ] `isLoading` → оба поля disabled + spinner
- [ ] `disabled` (completed task) → оба поля disabled
- [ ] Mobile: «Обсуждение» свёрнуто по умолчанию
- [ ] Mobile: тап «Обсудить» → раскрытие с анимацией
- [ ] Mobile: answer field переходит в compact mode при раскрытии discussion
- [ ] Desktop: оба поля видны всегда
- [ ] Нет iOS zoom (font-size ≥ 16px)
- [ ] Нет 300ms tap delay (touch-action: manipulation)

**Edge cases:**
- [ ] Пустой текст + нет файлов → кнопка disabled
- [ ] Текст только в одном поле → другое поле не очищается при отправке
- [ ] Retry failed message → `retryWithStorageRef` работает
- [ ] Быстрые клики → race guard блокирует двойную отправку
- [ ] Переключение задач → оба поля очищаются (reset)

---

## Summary: что меняется, а что нет

| Компонент | Меняется? | Детали |
|-----------|-----------|--------|
| `GuidedChatInput.tsx` | **ДА** | Core рефакторинг: 1 поле → 2 поля |
| `GuidedHomeworkWorkspace.tsx` | **Минимально** | Убрать `placeholder`, добавить `taskNumber` |
| `studentHomeworkApi.ts` | Нет | Без изменений |
| `homework-api/index.ts` (backend) | Нет | Без изменений |
| `GuidedChatMessage.tsx` | Нет | Без изменений |
| `GuidedHomeworkWorkspace.tsx` callbacks | Нет | `onSendAnswer` / `onSendStep` — без изменений |
| Types (`homework.ts`) | Нет | Без изменений |

**Estimated total effort:** 2-3 дня (1 разработчик)
