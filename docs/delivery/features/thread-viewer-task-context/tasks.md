# Tasks: Условие задачи в GuidedThreadViewer (Е8) ✅ COMPLETED 2026-04-06

**Spec:** `docs/delivery/features/thread-viewer-task-context/spec.md`
**Тикет:** Е8 (P2) · Effort S · UI-focused
**Job:** R1-4, R2-3

---

## TASK-1: ✅ Backend — расширить `ThreadTask` полями `task_text` и `task_image_url`

**Job:** R1-4, R2-3
**Agent:** Claude Code
**Files:**
- `supabase/functions/homework-api/index.ts` (handler `handleGetThread`)
- `src/lib/tutorHomeworkApi.ts` (тип `ThreadTask` / response)
**AC:** AC-1, AC-4

**Описание:**
Убедиться, что `GET /threads/:id` возвращает для каждой задачи `task_text` и `task_image_url`. Если поля уже есть — только расширить TS-типы на фронтенде. Если нет — добавить в SELECT из `homework_tutor_tasks` (минимальный диф, без изменений RLS/policies).

**Шаги:**
1. Открыть `handleGetThread` в `supabase/functions/homework-api/index.ts`, найти SELECT/hydration задач treadа.
2. Убедиться, что для `tasks[*]` возвращаются `id`, `order_num`, `task_text`, `task_image_url`, `max_score`, `check_format`. Добавить отсутствующие поля.
3. В `src/lib/tutorHomeworkApi.ts` обновить тип `ThreadTask` (или эквивалент): добавить `task_text: string; task_image_url: string | null`.
4. Не менять контракты `mergeThreadMessage` и Realtime-merge (Е9).

**Guardrails:**
- НЕ трогать `/threads/:id/check`, `/threads/:id/hint`, `/threads/:id/messages`.
- НЕ менять RLS. Не вводить новых SECURITY DEFINER функций.
- НЕ трогать student-side API.

---

## TASK-2: ✅ Frontend — блок «Условие задачи» в `GuidedThreadViewer`

**Job:** R1-4, R2-3
**Agent:** Claude Code
**Files:**
- `src/components/tutor/GuidedThreadViewer.tsx`
**AC:** AC-1, AC-2, AC-3, AC-4, AC-6

**Описание:**
Добавить collapsible-блок «Условие задачи #N» между рядом task-фильтров (`#1 #2 …`) и контейнером сообщений (`scrollContainerRef`). Блок рендерится только когда `taskFilter !== 'all'`. По умолчанию раскрыт; toggle «Свернуть/Развернуть» через `ChevronDown`/`ChevronUp` из `lucide-react`. При смене `taskFilter` state сбрасывается в раскрытый.

**Шаги:**
1. Импортировать `ChevronDown`, `ChevronUp` из `lucide-react` (MathText уже импортирован).
2. Добавить локальный state: `const [isTaskContextExpanded, setIsTaskContextExpanded] = useState(true);`
3. Добавить `useEffect` на `[taskFilter]` → `setIsTaskContextExpanded(true)`.
4. Вычислить `selectedTask = taskFilter === 'all' ? null : threadQuery.data?.tasks.find(t => t.order_num === taskFilter) ?? null;`
5. Отрендерить блок между `<div className="flex flex-wrap gap-2">...фильтры...</div>` и `<div ref={scrollContainerRef} ...>`.
6. Структура блока:
   - Обёртка: `rounded-md border bg-background p-3 text-xs space-y-2`
   - Header row: текст `Условие задачи #${selectedTask.order_num}` (text-muted-foreground, font-medium) + button-toggle (ghost, h-6, icon)
   - Body (только если `isTaskContextExpanded`): `MathText` с `text={selectedTask.task_text}` и `className="whitespace-pre-wrap leading-relaxed break-words"`, плюс `max-h-[200px] overflow-y-auto`
   - Если `selectedTask.task_image_url` — внутри body ниже текста добавить `ThreadAttachments` в `compact`-варианте через существующий `getHomeworkImageSignedUrl(ref, { defaultBucket: 'homework-task-images' })` (проверить правильный bucket по существующему коду resolve изображения задачи).
7. Никаких emoji, никаких framer-motion, никаких hover:scale. Использовать `transition-all` при раскрытии/сворачивании только если нужно — допустим tailwindcss-animate.

**Guardrails:**
- Не менять `mergeThreadMessage`, `threadQuery`, realtime subscription (Е9).
- Не трогать student-side файлы.
- Соблюдать 90-design-system: только токены `bg-background`, `border`, `text-muted-foreground`.
- Safari/iOS: никаких `:has()`, `Array.at()`, `structuredClone()`, framer-motion.
- Condition block скрыт при `taskFilter === 'all'`.

**Acceptance (встроено):**
- Given репетитор открыл viewer и кликнул фильтр `#2`, When `selectedTask` resolved, Then над лентой видно блок `Условие задачи #2` с `task_text` через MathText (AC-1).
- Given блок раскрыт, When клик по toggle, Then body скрывается; повторный клик — раскрывается (AC-2).
- Given клик на `Все задачи`, Then блок полностью скрыт (AC-3).
- Given задача с `$$...$$` и `task_image_url`, Then формулы рендерятся KaTeX, изображение через `ThreadAttachments` (AC-4).
- Safari desktop + iOS: layout не ломается, нет горизонтального скролла (AC-6).

---

## TASK-3: ✅ Validation — lint / build / smoke + ручной QA

**Job:** R1-4, R2-3
**Agent:** Claude Code (validation) + Vladimir (manual QA)
**Files:** — (no code)
**AC:** AC-5, AC-6

**Шаги:**
1. `npm run lint`
2. `npm run build`
3. `npm run smoke-check`
4. Preview deploy (Lovable) → открыть `TutorHomeworkResults` с реальным ДЗ где есть guided thread, проверить AC-1…AC-4.
5. Открыть preview в Safari iOS (iPhone) → проверить AC-6.
6. Зафиксировать результат в PR-описании.

**Guardrails:**
- Не запускать `npm run dev` и `npm run build` параллельно (конфликт `dist/`).
- Если lint ломается на несвязанных файлах — не фиксить в этом PR.

---

## Порядок выполнения

1. TASK-1 (backend + types) — блокирует TASK-2.
2. TASK-2 (UI) — зависит от TASK-1.
3. TASK-3 (validation) — после TASK-2.

Все три задачи укладываются в один короткий PR (UI-only change + минимальный backend patch).

---

## TASK-4: ✅ Click-to-zoom для фото условия задачи (2026-04-06, внесистемное расширение Е8)

**Запрос:** «Добавь возможность увеличить фото с условием при нажатии на фото»

**Изменения:**
- Заменён `<ThreadAttachments compact>` на локальный sub-компонент `TaskContextImage` в `GuidedThreadViewer.tsx`
- Миниатюра (h-24, max-w-[220px]) + hover-badge с `ZoomIn` icon → клик открывает Radix `Dialog` с увеличенным изображением (`max-h-[75vh] object-contain`)
- Signed URL через `getTaskImageSignedUrl(assignmentId, taskId)`, query key `['tutor','homework','task-image-preview',assignmentId,taskId]` — cache sharing с `TaskImagePreview` в `TutorHomeworkDetail.tsx`
- `key={selectedTask.id}` — remount при переключении задачи закрывает Dialog
- lint ✅ · build ✅ · smoke-check ✅ · preview transform ✅

---

## Copy-paste промпты для агентов

### Prompt — TASK-1 (Backend: ThreadTask fields)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст:
- SokratAI — AI-платформа для репетиторов физики ЕГЭ/ОГЭ (B2B primary buyer).
- Wedge: homework assembly + guided chat review. AI = draft + action.
- Сейчас идёт финальный полиш перед платным пилотом 15 апреля.

Спека фичи: docs/delivery/features/thread-viewer-task-context/spec.md
Тикет: Е8 — "Условие задачи в GuidedThreadViewer", P2, effort S.

Прочитай перед работой:
1. docs/delivery/features/thread-viewer-task-context/spec.md (полностью)
2. CLAUDE.md (корень проекта)
3. .claude/rules/10-safe-change-policy.md
4. .claude/rules/40-homework-system.md (секции про GuidedThreadViewer и Realtime Е9)
5. supabase/functions/homework-api/index.ts — найди handleGetThread

Задача (TASK-1):
Убедись, что GET /threads/:id в handleGetThread возвращает в массиве tasks[*] поля:
  id, order_num, task_text, task_image_url, max_score, check_format.
Если каких-то полей нет — добавь их в SELECT минимальным дифом. RLS/policies не трогай.

Затем в src/lib/tutorHomeworkApi.ts обнови тип ThreadTask (или эквивалент response-типа для handleGetThread), добавив:
  task_text: string
  task_image_url: string | null

Acceptance:
- GIVEN репетитор открывает viewer, WHEN выполняется запрос threads/:id, THEN в ответе для каждой задачи есть task_text и task_image_url (может быть null).
- Контракт /threads/:id/check, /threads/:id/hint, /threads/:id/messages не меняется.
- mergeThreadMessage и Realtime subscription (Е9) не затронуты.

Guardrails:
- Student/Tutor изоляция: не трогай студенческие файлы.
- Не меняй RLS. Не добавляй SECURITY DEFINER.
- Никаких миграций.
- Никаких новых зависимостей.

В конце:
1. Перечисли изменённые файлы.
2. Краткое summary изменений.
3. Запусти `npm run lint && npm run build && npm run smoke-check`, приложи результат.
4. Укажи docs-to-update (если есть).
5. Self-check против docs 16/17 (UX principles / UI patterns).
```

### Prompt — TASK-2 (Frontend: condition block in GuidedThreadViewer)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст:
- SokratAI — AI-платформа для репетиторов физики ЕГЭ/ОГЭ.
- Wedge: homework assembly + guided chat review. AI = draft + action.
- Е8 — быстрый win перед платным пилотом. Егор явно просил показывать условие задачи рядом с перепиской, чтобы не держать в голове 15 номеров.

Спека фичи: docs/delivery/features/thread-viewer-task-context/spec.md

Прочитай перед работой:
1. docs/delivery/features/thread-viewer-task-context/spec.md (полностью)
2. CLAUDE.md
3. .claude/rules/10-safe-change-policy.md
4. .claude/rules/80-cross-browser.md
5. .claude/rules/90-design-system.md
6. .claude/rules/performance.md
7. .claude/rules/40-homework-system.md (секции Realtime thread viewer Е9 и GuidedThreadViewer UX)
8. docs/discovery/product/tutor-ai-agents/16-ux-principles-for-tutor-product-sokrat.md
9. docs/discovery/product/tutor-ai-agents/17-ui-patterns-and-component-rules-sokrat.md
10. src/components/tutor/GuidedThreadViewer.tsx (полностью)

Зависимость: TASK-1 должен быть мёрджен — ThreadTask уже содержит task_text и task_image_url.

Задача (TASK-2):
Добавь в GuidedThreadViewer.tsx collapsible-блок «Условие задачи» между рядом task-фильтров (`Все задачи / #1 / #2 / ...`) и контейнером сообщений (scrollContainerRef).

Логика:
- Показывается ТОЛЬКО когда taskFilter !== 'all'.
- Локальный state: const [isTaskContextExpanded, setIsTaskContextExpanded] = useState(true).
- useEffect на [taskFilter]: при смене фильтра сбрасывать в true.
- selectedTask = taskFilter === 'all' ? null : threadQuery.data?.tasks.find(t => t.order_num === taskFilter) ?? null.

Структура блока:
- Обёртка: rounded-md border bg-background p-3 text-xs space-y-2
- Header: `Условие задачи #${selectedTask.order_num}` (text-muted-foreground, font-medium) + ghost-button с ChevronDown/ChevronUp (lucide-react) для toggle
- Body (рендерится только если isTaskContextExpanded):
    - <MathText text={selectedTask.task_text} className="whitespace-pre-wrap leading-relaxed break-words" />
    - Обёртка body: max-h-[200px] overflow-y-auto
    - Если selectedTask.task_image_url — рендер через <ThreadAttachments attachmentValue={selectedTask.task_image_url} resolveSignedUrl={(ref) => getHomeworkImageSignedUrl(ref, { defaultBucket: 'homework-task-images' })} compact />
    - Проверь в существующем коде GuidedThreadViewer / TutorHomeworkDetail правильный bucket для task images и используй его.

Не трогай:
- mergeThreadMessage / Realtime subscription (Е9).
- Фильтры task-бейджей, логику taskStatusById.
- Student-side файлы.
- Message rendering loop.

Guardrails (жёстко):
- Никаких emoji в UI.
- Никаких framer-motion (запрещён в проекте полностью).
- Никаких hover:scale на shared-компонентах.
- Никаких :has(), Array.at(), structuredClone(), crypto.randomUUID в hot path.
- Только токены дизайн-системы: bg-background, border, text-muted-foreground.
- Font-size инпутов не трогаем (но здесь их и нет).
- Блок должен корректно работать в Safari desktop и iOS Safari.

Acceptance (Given/When/Then):
- AC-1: Given viewer открыт, When клик по #2, Then появился блок "Условие задачи #2" с task_text через MathText.
- AC-2: Given блок раскрыт, When клик по toggle, Then body скрыт; повторный клик → раскрыт; смена taskFilter → снова раскрыт.
- AC-3: Given выбран "Все задачи", Then блок полностью не рендерится.
- AC-4: Given задача с $$...$$ и task_image_url, Then формулы рендерятся KaTeX, картинка — через ThreadAttachments.
- AC-6: Safari desktop + iOS — нет горизонтального скролла, layout не ломается.

В конце:
1. Перечисли изменённые файлы.
2. Краткое summary.
3. Запусти `npm run lint && npm run build && npm run smoke-check`, приложи вывод.
4. Self-check против docs 16/17: подтверди что UX-принципы (minimize context switch, AI = draft + action) и UI-паттерны (карточка без вложенных карточек, lucide icons, без emoji) соблюдены.
5. Укажи, какие AC закрыты автоматически и какие требуют ручного QA.
```

### Prompt — TASK-3 (Validation & manual QA)

```
Твоя роль: QA-engineer в проекте SokratAI.

Контекст: готовимся мёрджить Е8 (условие задачи в GuidedThreadViewer) перед платным пилотом 15 апреля.

Спека: docs/delivery/features/thread-viewer-task-context/spec.md

Зависимости: TASK-1 и TASK-2 завершены и закоммичены.

Шаги:
1. `npm run lint`
2. `npm run build`
3. `npm run smoke-check`
   (НЕ запускать параллельно с build — конфликт dist/)
4. Открой preview-деплой, зайди как репетитор в TutorHomeworkResults по реальному ДЗ с guided thread, раскрой ученика, дождись GuidedThreadViewer.
5. Пройди AC-1…AC-4 вручную:
   - AC-1: клик #2 → видно условие задачи #2
   - AC-2: toggle сворачивает/раскрывает, смена фильтра сбрасывает в раскрытый
   - AC-3: "Все задачи" → блок исчез
   - AC-4: задача с LaTeX и изображением — формулы и картинка отображаются
6. Открой ту же страницу в Safari на iPhone → проверь AC-6 (нет горизонтального скролла, нет layout breaks, блок читается).
7. Зафиксируй результат в PR-описании построчно по AC.

Если что-то FAIL — не мёрджить, вернуть автору TASK-2 с указанием AC и шагов воспроизведения.
```
