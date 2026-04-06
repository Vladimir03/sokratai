# KB UX Sprint 1: Quick Wins — Feature Spec

**Тип задачи:** Паттерн 3 — UX polish / fix (doc 20)
**Продукт:** Сократ
**Версия:** v0.1
**Дата:** 2026-03-17
**Статус:** ready for implementation

---

## Problem

На странице База знаний (`/tutor/knowledge`) есть 4 конкретных UX-проблемы, мешающих репетиторам выполнять core jobs:

1. **Фото задач скрыты** — thumbnail 80px нечитаем, для задач `[Задача на фото]` контент вообще не виден без клика
2. **LaTeX не рендерится** — `stripLatex()` убивает формулы (`$v_1$` → `v1`, `$(0;\;2)$` → `(0;2)`)
3. **Текст нельзя скопировать** — весь `<div>` = `role="button"`, клик по тексту = toggle карточки
4. **Нет быстрого копирования** — репетиторы не могут скопировать задачу в Telegram/WhatsApp/Docs

---

## Jobs / Wedge alignment

| Проблема | Job (из 04-jobs-graph) | Wedge impact |
|----------|------------------------|--------------|
| Фото скрыты | A1 — подобрать задачу по теме | Замедляет визуальный скан задач ×2 |
| LaTeX сломан | A2 — верифицировать задачу, D1 — понять условие | Репетитор не может прочитать условие без ментального парсинга |
| Текст не выделяется | B3 — избежать дублирования, E2 — переиспользование | Невозможно использовать задачи за пределами Сократа |
| Нет копирования | B3, E2 | Невозможно переслать задачу ученику через мессенджер |

**UX-принципы (doc 16):**
- #3 Recognition over recall → фото должно быть видно сразу
- #16 "Физика — не plain text" → LaTeX обязателен
- #17 Export and sharing → копирование = базовая операция

---

## Goals

- Фото задач видны без клика (hero-image для фото-only задач, увеличенный thumbnail для остальных)
- Формулы рендерятся через KaTeX (как в `/chat`)
- Текст задачи можно выделить мышью
- Одна кнопка = копирование задачи в буфер обмена

## Non-goals

- Поиск по задачам (Sprint 2)
- Фильтры по КИМ (Sprint 2)
- AI-генерация похожих задач (Sprint 3)
- Drag-and-drop (Sprint 3)
- Изменения в homework flow / конструкторе ДЗ
- Изменения в edge functions или БД

---

## Scope: файлы для изменения

### Новые файлы

| Файл | Назначение |
|------|------------|
| `src/components/kb/ui/MathText.tsx` | Lazy-loaded KaTeX рендеринг формул |
| `src/components/kb/ui/CopyTaskButton.tsx` | Кнопка копирования задачи в буфер |

### Изменяемые файлы

| Файл | Что меняется |
|------|-------------|
| `src/components/kb/TaskCard.tsx` | Hero-image, MathText вместо stripLatex, click-зоны, CopyTaskButton |
| `src/components/tutor/KBPickerSheet.tsx` | MathText вместо stripLatex в preview |
| `src/components/kb/HWDrawer.tsx` | MathText вместо stripLatex в snapshot preview |

### Файлы НЕ трогать

- `src/components/ui/*` — shared UI компоненты (performance.md запрещает тяжёлые зависимости)
- `src/components/kb/ui/stripLatex.ts` — оставить как есть (используется в других местах для plain-text fallback)
- `src/lib/kbApi.ts` — API не меняется
- `src/types/kb.ts` — типы не меняются
- Всё из списка high-risk files

---

## Фаза 1. MathText компонент

### 1.1 Создать `src/components/kb/ui/MathText.tsx`

**Задача:** Лёгкая обёртка для рендеринга текста с LaTeX-формулами через KaTeX. Повторяет паттерн из `ChatMessage.tsx`, но как изолированный переиспользуемый компонент.

**Требования:**

```
Компонент: MathText
Props:
  - text: string (обязательный) — текст с LaTeX-разметкой
  - className?: string — CSS-классы для обёртки
  - as?: 'p' | 'div' | 'span' — тег-обёртка (default: 'div')

Поведение:
1. Определить hasMath = text.includes('$') || text.includes('\\(') || text.includes('\\[')
2. Если hasMath = false → вернуть plain text (без import KaTeX)
3. Если hasMath = true:
   a. Lazy import 'katex/dist/katex.min.css' (один раз)
   b. Применить preprocessLatex() к тексту
   c. Рендерить через ReactMarkdown + remarkMath + rehypeKatex
4. Fallback во время загрузки → stripLatex(text)
```

**Preprocessing функция** (извлечь из ChatMessage.tsx в shared utility):

```typescript
// src/components/kb/ui/preprocessLatex.ts
export function preprocessLatex(text: string): string {
  // Convert LaTeX display mode \[...\] to $$...$$
  text = text.replace(/\\\[/g, '$$');
  text = text.replace(/\\\]/g, '$$');
  // Convert LaTeX inline mode \(...\) to $...$
  text = text.replace(/\\\(/g, '$');
  text = text.replace(/\\\)/g, '$');
  // Fix \textfrac to \frac
  text = text.replace(/\\textfrac/g, '\\frac');
  return text;
}
```

**Performance-ограничения (из performance.md):**
- `React.memo` с `text` как зависимость
- `katex.min.css` — lazy import через `useEffect`, не в top-level
- `ReactMarkdown` — dynamic import через `React.lazy`
- НЕ добавлять в `src/components/ui/*`
- Импорт `react-markdown`, `remark-math`, `rehype-katex` уже есть в проекте (используются ChatMessage.tsx) — новых зависимостей не нужно

**Кросс-браузерная совместимость:**
- KaTeX поддерживает Safari 15+ — ОК
- Не использовать RegExp lookbehind в preprocessLatex (Safari < 16.4)
- Все regex в preprocessLatex — простые замены, Safari-safe

**Acceptance criteria:**
- [ ] `<MathText text="Скорость $v_1 = 60$ км/ч" />` рендерит `v₁` с подстрочным индексом
- [ ] `<MathText text="Точка (0;\\;2) и (4;\\;10)" />` рендерит с правильным пробелом
- [ ] `<MathText text="Простой текст без формул" />` НЕ загружает KaTeX CSS
- [ ] `<MathText text="$\\frac{1}{2}mv^2$" />` рендерит дробь корректно
- [ ] Нет ошибок в Safari 15+
- [ ] `line-clamp-2` работает на обёртке

---

## Фаза 2. Hero-image для фото-задач

### 2.1 Изменить thumbnail в `TaskCard.tsx`

**Текущее состояние (строки 197–216):**
```
Collapsed: h-20 max-w-[160px] object-cover → 80px thumbnail, обрезанный
```

**Целевое состояние:**

```
Три режима отображения в collapsed view:

A) Image-only задача (text пуст или = '[Задача на фото]' или < 20 символов):
   → Hero-image: max-h-64 w-full object-contain rounded-xl
   → Скрыть текст-заглушку '[Задача на фото]'

B) Задача с текстом + одно фото:
   → Увеличенный thumbnail: max-h-40 max-w-full object-contain rounded-xl
   → Текст выше, фото ниже

C) Задача с текстом + несколько фото:
   → Горизонтальная лента: flex gap-2 overflow-x-auto snap-x
   → Каждое фото: h-28 object-contain rounded-lg
   → Подгрузка остальных thumbnail при скролле (lazy)
```

**Детекция image-only задачи:**
```typescript
const IMAGE_ONLY_MARKERS = ['[Задача на фото]', '[задача на фото]'];
const isImageOnlyTask = !task.text?.trim() ||
  IMAGE_ONLY_MARKERS.includes(task.text.trim()) ||
  (task.text.trim().length < 20 && attachmentRefs.length > 0);
```

**Acceptance criteria:**
- [ ] Задача `[Задача на фото]` + фото → видно фото на всю ширину карточки, текст-заглушка скрыт
- [ ] Задача с текстом + 1 фото → фото ~160px высоты, читаемо
- [ ] Задача с текстом + 3 фото → горизонтальная лента, можно скроллить
- [ ] Mobile (< 768px) → hero-image max-h-48 (уменьшить для маленьких экранов)
- [ ] Lazy loading для фото (уже есть через useEffect)
- [ ] Structural breakpoints: `md:` для layout switch (не `sm:`)

---

## Фаза 3. Selectable text + Click-зоны

### 3.1 Разделить click-зоны в `TaskCard.tsx`

**Текущее состояние (строки 156–338):**
```
<div role="button" onClick={onToggle}>  ← вся карточка кликабельна
  <badges, text, images, answer, solution>
</div>
```

**Целевое состояние:**
```
<article>
  {/* Zone 1: Header — кликабельна для toggle */}
  <div role="button" onClick={onToggle} className="cursor-pointer">
    <SourceBadge /> <KIM number> <Image icon> <ChevronDown />
  </div>

  {/* Zone 2: Content — текст выделяемый */}
  <div className="select-text" onClick={handleContentClick}>
    <MathText text={task.text} />
    {/* images */}
    {/* answer, solution (expanded) */}
  </div>

  {/* Zone 3: Actions — stopPropagation (уже есть) */}
  <div onClick={e => e.stopPropagation()}>
    <CopyTaskButton /> <В ДЗ> <ContextMenu>
  </div>
</article>
```

**handleContentClick logic:**
```typescript
// Клик по контенту — toggle ТОЛЬКО если нет текстового выделения
const handleContentClick = useCallback(() => {
  const selection = window.getSelection();
  // Если пользователь выделял текст — не toggle
  if (selection && selection.toString().length > 0) return;
  onToggle();
}, [onToggle]);
```

**Keyboard accessibility:**
- `role="button"` + `tabIndex={0}` остаётся на header-зоне
- `onKeyDown` (Enter/Space → toggle) остаётся на header-зоне
- Content zone — обычный `<div>`, focusable через text selection

**Acceptance criteria:**
- [ ] Можно выделить текст задачи мышью (двойной клик по слову, drag для диапазона)
- [ ] Клик по badges/chevron → toggle карточки
- [ ] Клик по тексту БЕЗ выделения → toggle карточки (обратная совместимость)
- [ ] Клик по тексту С выделением → НЕ toggle (текст остаётся выделенным)
- [ ] Кнопки "В ДЗ", "К себе", контекстное меню — работают как раньше
- [ ] Touch-устройства: tap = toggle, long press = выделение (стандартное iOS/Android поведение)
- [ ] Тест в Safari iOS: no 300ms delay (проверить `touch-action: manipulation`)

---

## Фаза 4. Copy-to-clipboard кнопка

### 4.1 Создать `src/components/kb/ui/CopyTaskButton.tsx`

**Компонент:**
```
Props:
  - task: KBTask
  - className?: string

Поведение:
1. Клик → копировать полный текст задачи в буфер обмена
2. Формат копирования:
   - Если есть text → копировать raw text (с LaTeX-разметкой)
   - Если text = '[Задача на фото]' → копировать "(см. изображение задачи)"
   - Если есть answer → добавить "\nОтвет: {answer}"
3. После копирования → иконка меняется на Check (✓) на 2 секунды
4. Toast НЕ нужен (иконка достаточна, не перегружаем UI)
```

**API:**
```typescript
navigator.clipboard.writeText(text)
```

**Safari compatibility:**
- `navigator.clipboard.writeText` работает в Safari 13.1+ — ОК для наших targets
- Требует HTTPS или localhost — ОК (prod = HTTPS, dev = localhost)
- Не работает без user gesture — ОК (вызывается по клику)

### 4.2 Встроить CopyTaskButton в TaskCard.tsx

**Размещение:** В Zone 3 (actions), рядом с "В ДЗ" / "К себе".

```
Desktop: иконка Copy (clipboard) — видна всегда
Mobile: иконка Copy — видна всегда (рядом с "В ДЗ")
```

**Не добавлять** в ContextMenu (три точки) — копирование = частая операция, не прятать.

**Acceptance criteria:**
- [ ] Клик на иконку → текст задачи в буфере обмена
- [ ] Иконка меняется на ✓ на 2 секунды
- [ ] Для задач с ответом — ответ включён в копию
- [ ] Для фото-задач — текст "(см. изображение задачи)"
- [ ] Работает в Safari macOS и iOS
- [ ] Не конфликтует с кнопками "В ДЗ" / "К себе"

---

## Фаза 5. Применить MathText в KBPickerSheet и HWDrawer

### 5.1 KBPickerSheet.tsx

**Текущее (строка 57):**
```typescript
const preview = stripLatex(task.text).slice(0, 120);
```

**Целевое:**
```typescript
// Рендерить через MathText вместо stripLatex
<MathText text={task.text} className="text-[13px] line-clamp-2 text-slate-700" />
```

**Примечание:** В PickerSheet карточки компактные — `line-clamp-2` обязателен. Убрать `.slice(0, 120)` — `line-clamp-2` сам обрежет.

### 5.2 HWDrawer.tsx

**Текущее:**
```typescript
stripLatex(task.textSnapshot)
```

**Целевое:**
```typescript
<MathText text={task.textSnapshot} className="text-sm line-clamp-3" />
```

**Acceptance criteria:**
- [ ] В KBPickerSheet формулы рендерятся с KaTeX
- [ ] В HWDrawer snapshot-текст рендерится с KaTeX
- [ ] `line-clamp` работает корректно с KaTeX inline-формулами
- [ ] При edit mode в HWDrawer — показывать raw text (textarea), не KaTeX

---

## Validation checklist

После реализации выполнить:

```bash
npm run lint
npm run build
npm run test
npm run smoke-check
```

### UX review checklist (из doc 19):

1. **Какой job усиливает реализация?** → A1 (подобрать задачу), A2 (верифицировать), B3 (переиспользование), E2 (шаринг)
2. **Усиливает ли wedge?** → Да — быстрее находить и собирать задачи в ДЗ
3. **Нет ли generic chat UX?** → Нет, это library UX
4. **Есть ли clear primary CTA?** → "В ДЗ" остаётся primary, "Копировать" = secondary
5. **Переводится ли результат в действие?** → Да (copy, add to HW)
6. **Не спрятан ли частый flow?** → Copy кнопка вынесена наружу
7. **Нет ли лишнего scope?** → Нет search, нет filters, нет AI
8. **Нет ли architecture risks?** → Нет, только UI-компоненты в kb/

### UI parity checklist (из 10-safe-change-policy):

- [ ] Structural breakpoints: `md:` для grid/flex layout
- [ ] Card в grid: `animate={false}` (не добавляем framer-motion)
- [ ] SW не кэширует stale UI в preview
- [ ] Нет `framer-motion` в `src/components/ui/*`
- [ ] KaTeX CSS = lazy import (не в bundle root)

### Cross-browser checklist:

- [ ] Тест в Chrome desktop
- [ ] Тест в Safari macOS
- [ ] Тест в Safari iOS (iPhone)
- [ ] Тест в Chrome Android
- [ ] `navigator.clipboard.writeText` — работает
- [ ] `window.getSelection()` — работает для click-zone detection
- [ ] Нет RegExp lookbehind в новом коде
- [ ] Нет `structuredClone()`, `Array.at()`, `Object.hasOwn()`

---

## Docs-to-update после реализации

| Документ | Что обновить |
|----------|-------------|
| `CLAUDE.md` → секция "База знаний (KB)" | Добавить MathText как ключевой компонент |
| `docs/kb/kb-tech-spec.md` | Добавить секцию "LaTeX rendering in KB" |
| `docs/kb/kb-ux-improvements.md` | Отметить A1–A4 как completed |
| `docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules-sokrat.md` | Добавить паттерн "MathText для физических формул" |

---

## Промпт для Claude Code (Паттерн 3, Шаг 2)

Ниже — готовый промпт для запуска реализации:

```text
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Нужно реализовать UX polish для Базы знаний (/tutor/knowledge).

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ
- wedge: быстро собрать ДЗ и новую практику по теме урока
- продукт = workspace / bundle: AI + база + домашки + материалы
- AI = draft + action, а не generic chat

Сначала обязательно прочитай документы:
1. docs/product/specs/tutor_ai_agents/16-ux-principles-for-tutor-product-sokrat.md
2. docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules-sokrat.md
3. docs/features/specs/kb-ux-sprint1-quick-wins.md (← этот feature spec)
4. CLAUDE.md

Реализуй ВСЕ 5 фаз из feature spec:
1. MathText компонент (src/components/kb/ui/MathText.tsx + preprocessLatex.ts)
2. Hero-image для фото-задач (TaskCard.tsx)
3. Selectable text + click-зоны (TaskCard.tsx)
4. CopyTaskButton (src/components/kb/ui/CopyTaskButton.tsx + TaskCard.tsx)
5. MathText в KBPickerSheet.tsx и HWDrawer.tsx

Важно:
- не расширяй scope beyond этих 5 фаз
- не трогай src/components/ui/* (performance.md)
- не трогай high-risk files (AuthGuard, TutorGuard, Chat.tsx и др.)
- не добавляй новых npm-зависимостей (react-markdown, remark-math, rehype-katex уже есть)
- используй md: для structural breakpoints, НЕ sm:
- тестируй Safari-совместимость (CLAUDE.md → кросс-браузерная совместимость)

В конце обязательно:
1. перечисли changed files
2. дай краткий summary реализации
3. покажи validation results (npm run lint && npm run build && npm run smoke-check)
4. напиши, какие документы нужно обновить после этой реализации
5. self-check against docs 16, 17
```

---

## Промпт для Codex review (Паттерн 4)

```text
Сделай code review реализованной KB UX Sprint 1.

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ
- wedge: быстро собрать ДЗ и новую практику по теме урока
- нельзя скатываться в generic chat UX

Прочитай:
1. docs/product/specs/tutor_ai_agents/16-ux-principles-for-tutor-product-sokrat.md
2. docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules-sokrat.md
3. docs/features/specs/kb-ux-sprint1-quick-wins.md

Проверь:
1. MathText: lazy loading KaTeX CSS, React.memo, no KaTeX in ui/* bundle
2. Hero-image: image-only detection, responsive sizing, lazy loading
3. Click-zones: text selectable, toggle still works, no Safari regressions
4. CopyTaskButton: clipboard API, Safari compat, correct text format
5. Performance: no framer-motion, no heavy deps in shared, lazy imports

Формат ответа:
- Must fix
- Should fix
- Nice to have
- Product drift risks
- Architecture risks
```
