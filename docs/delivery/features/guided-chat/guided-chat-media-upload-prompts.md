# Промпты для реализации: Загрузка фото/скриншотов/PDF в guided chat

**PRD:** `docs/features/specs/guided-chat-media-upload-prd.md`
**Tasks:** `docs/features/specs/guided-chat-media-upload-tasks.md`
**Паттерн:** doc 20 — Паттерн 1 (Новая фича)
**Дата:** 2026-03-20

---

## Оглавление

1. [Phase 1 — Backend: image_url в student messages](#phase-1)
2. [Phase 1 — Codex Review](#phase-1-review)
3. [Phase 2 — Frontend: UI загрузки](#phase-2)
4. [Phase 2 — Codex Review](#phase-2-review)
5. [Phase 3 — Upload pipeline](#phase-3)
6. [Phase 3 — Codex Review](#phase-3-review)
7. [Phase 4 — AI integration](#phase-4)
8. [Phase 4 — Codex Review](#phase-4-review)
9. [Phase 5 — Clipboard paste + mobile](#phase-5)
10. [Phase 5 — Codex Review](#phase-5-review)
11. [Финальный Codex Review всей фичи](#final-review)

---

<a id="phase-1"></a>
## Phase 1 — Claude Code: Backend + Client API

```text
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Нужно реализовать Phase 1 фичи: загрузка фото/скриншотов/PDF в guided homework chat.
Phase 1 = Backend: принять image_url в student thread messages + extend client API.

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ;
- wedge: быстро собрать ДЗ и новую практику по теме урока;
- продукт = workspace / bundle: AI + база + домашки + материалы;
- AI = draft + action, а не generic chat.

Сначала обязательно прочитай документы:
1. docs/features/specs/guided-chat-media-upload-prd.md (PRD фичи)
2. docs/features/specs/guided-chat-media-upload-tasks.md (task specs — Phase 1)
3. docs/product/specs/tutor_ai_agents/16-ux-principles-for-tutor-product-sokrat.md
4. docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules-sokrat.md
5. CLAUDE.md

Задачи Phase 1:

Задача 1.1: Extend handlePostThreadMessage (backend)
- Файл: supabase/functions/homework-api/index.ts
- Функция: handlePostThreadMessage (обработчик POST /threads/:id/messages)
- Принять optional image_url: string в request body
- Валидировать: должен начинаться с storage:// (иначе null)
- Сохранить в homework_tutor_thread_messages при INSERT
- Паттерн-референс: handleTutorPostMessage в том же файле — уже принимает image_url точно так же. Повтори этот паттерн.

Задача 1.2: Extend saveThreadMessage (client API)
- Файл: src/lib/studentHomeworkApi.ts
- Функция: saveThreadMessage()
- Добавить optional параметр imageUrl?: string
- Передать image_url в request body
- Backward compatible — вызовы без imageUrl работают как раньше

Что НЕ делать:
- Не трогать handleTutorPostMessage (уже работает)
- Не добавлять новые endpoints
- Не менять DB schema (column image_url уже есть в homework_tutor_thread_messages)
- Не менять frontend компоненты
- Не расширять scope beyond Phase 1

После реализации:
1. npm run lint
2. npm run build
3. npm run smoke-check

В конце дай:
1. changed files
2. что сделано
3. что осталось (Phase 2-5)
4. validation results
5. self-check: backward compatibility сохранена? existing calls работают?
6. какие документы нужно обновить
```

---

<a id="phase-1-review"></a>
## Phase 1 — Codex Review

```text
Сделай code review реализации Phase 1 фичи: загрузка фото в guided homework chat.
Phase 1 = Backend: принять image_url в student thread messages + extend client API.

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ;
- wedge: быстро собрать ДЗ и новую практику по теме урока;
- продукт = AI + база + домашки + материалы;
- нельзя скатываться в generic chat UX.

Сначала прочитай:
1. docs/features/specs/guided-chat-media-upload-prd.md
2. docs/features/specs/guided-chat-media-upload-tasks.md (Phase 1)
3. docs/product/specs/tutor_ai_agents/16-ux-principles-for-tutor-product-sokrat.md
4. docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules-sokrat.md
5. CLAUDE.md

Затем проверь изменённые файлы:
- supabase/functions/homework-api/index.ts (handlePostThreadMessage)
- src/lib/studentHomeworkApi.ts (saveThreadMessage)

Проверь:
1. Backward compatibility: существующие вызовы saveThreadMessage без imageUrl работают?
2. Валидация image_url: storage:// prefix проверяется? SQL injection невозможен?
3. Паттерн совпадает с handleTutorPostMessage (reference implementation)?
4. Нет лишнего scope (не добавлены frontend изменения, не менялась DB schema)?
5. Edge cases: пустая строка, null, undefined, non-storage:// URL — все корректно обрабатываются?
6. Нет регрессий: POST /threads/:id/messages без image_url продолжает работать?

Формат ответа:
- Executive summary
- Must fix
- Should fix
- Nice to have
- Backward compatibility check
- Security check (image_url validation)
```

---

<a id="phase-2"></a>
## Phase 2 — Claude Code: Frontend UI загрузки

```text
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Нужно реализовать Phase 2 фичи: загрузка фото/скриншотов/PDF в guided homework chat.
Phase 2 = Frontend: UI загрузки в GuidedChatInput + превью вложений + extend workspace handlers.

Phase 1 уже реализована: backend принимает image_url, saveThreadMessage принимает imageUrl.

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ;
- wedge: быстро собрать ДЗ и новую практику по теме урока;
- AI = draft + action, а не generic chat;
- пользователи: школьники 14-18 лет, iPhone + Safari, Android + Chrome.

Сначала обязательно прочитай:
1. docs/features/specs/guided-chat-media-upload-prd.md (PRD — секции 7, 8, 9)
2. docs/features/specs/guided-chat-media-upload-tasks.md (Phase 2: задачи 2.1, 2.2, 2.3)
3. docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules-sokrat.md
4. CLAUDE.md (секции: кросс-браузерная совместимость, preview parity, performance)

Задачи Phase 2:

Задача 2.1: Кнопка 📎 и file input в GuidedChatInput
- Файл: src/components/homework/GuidedChatInput.tsx
- Добавить кнопку 📎 (Paperclip из lucide-react) слева от textarea
- Hidden <input type="file" accept="image/*,.pdf">
- Валидация: тип (JPG/PNG/HEIC/WebP/PDF), размер ≤ 10 МБ, максимум 3 файла
- Error toasts при невалидном файле
- Новые props: attachedFiles, onFileSelect, onFileRemove, isUploading
- Кнопка disabled в states: isStreaming, isCheckingAnswer, isRequestingHint, !isViewingActiveTask

Задача 2.2: Превью вложений
- Над полем ввода: карточка для каждого attached file
- Thumbnail 48px (URL.createObjectURL для images, иконка 📄 для PDF)
- Имя файла + размер + кнопка ✕
- Во время загрузки: spinner вместо ✕
- URL.revokeObjectURL при unmount/remove (memory cleanup)

Задача 2.3: Extend send handlers в GuidedHomeworkWorkspace
- Файл: src/components/homework/GuidedHomeworkWorkspace.tsx
- Добавить state: attachedFiles, isUploading
- Extend sendUserMessage(text, mode) → sendUserMessage(text, mode, files?)
- При отправке с файлами: upload → persist message с image_url → clear files
- Race guard: добавить isUploading в existing guard
- content = '(фото)' если текст пустой, но есть файл

КРИТИЧНО (из CLAUDE.md):
- НЕ использовать framer-motion (performance.md запрещает в shared components)
- Input font-size ≥ 16px (iOS Safari zoom prevention)
- Structural breakpoints: md: для layout, НЕ sm:
- НЕ использовать crypto.randomUUID() (Safari < 15.4) — fallback через Date.now()
- НЕ использовать RegExp lookbehind (Safari < 16.4)
- НЕ использовать Array.at() (Safari < 15.4)

Что НЕ делать:
- Не добавлять drag-and-drop (Phase 5)
- Не добавлять clipboard paste (Phase 5)
- Не менять GuidedChatMessage.tsx (MessageAttachment уже рендерит image_url)
- Не менять backend (Phase 1 done)
- Не добавлять AI integration (Phase 4)

После реализации:
1. npm run lint
2. npm run build
3. npm run smoke-check

В конце дай:
1. changed files
2. что сделано
3. что осталось (Phase 3-5)
4. validation results
5. self-check against docs 16, 17:
   - iOS Safari: input font-size ≥ 16px?
   - Layout: md: breakpoints?
   - Performance: no framer-motion import?
   - Memory: URL.revokeObjectURL cleanup?
6. какие документы нужно обновить
```

---

<a id="phase-2-review"></a>
## Phase 2 — Codex Review

```text
Сделай code review реализации Phase 2 фичи: загрузка фото в guided homework chat.
Phase 2 = Frontend: UI загрузки в GuidedChatInput + превью + workspace handlers.

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ;
- wedge: быстро собрать ДЗ и новую практику по теме урока;
- пользователи: школьники 14-18, iPhone + Safari, Android + Chrome.

Сначала прочитай:
1. docs/features/specs/guided-chat-media-upload-prd.md (секции 7, 8, 9)
2. docs/features/specs/guided-chat-media-upload-tasks.md (Phase 2)
3. docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules-sokrat.md
4. CLAUDE.md (кросс-браузерная совместимость, performance, preview parity)

Затем проверь изменённые файлы:
- src/components/homework/GuidedChatInput.tsx
- src/components/homework/GuidedHomeworkWorkspace.tsx
- любые новые компоненты (AttachmentPreview?)

Проверь:

1. Safari / iOS compatibility:
   - input font-size ≥ 16px на ВСЕХ input/textarea? (iOS auto-zoom)
   - НЕ использует crypto.randomUUID()? (Safari < 15.4)
   - НЕ использует RegExp lookbehind? (Safari < 16.4)
   - НЕ использует Array.at()? (Safari < 15.4)
   - НЕ использует structuredClone()? (Safari < 15.4)
   - Date парсинг через date-fns/parseISO, не new Date(string)?

2. Performance:
   - НЕ импортирует framer-motion в homework components?
   - URL.revokeObjectURL при cleanup? (memory leak prevention)
   - Нет тяжёлых библиотек в shared components?

3. Layout / responsive:
   - Structural breakpoints: md: для grid/flex layout, НЕ sm:?
   - Кнопка 📎 touch-friendly (min 44x44 tap area)?
   - Preview не ломает layout при 1-5 вложениях?

4. State management:
   - Race guard включает isUploading?
   - attachedFiles очищается после успешной отправки?
   - isUploading предотвращает двойную отправку?
   - Сообщение без текста + с файлом корректно обрабатывается?

5. Error handling:
   - File size > 5 МБ → toast error?
   - Unsupported format → toast error?
   - Upload failure → toast + не ломает state?
   - 6+ файлов → toast error?

6. GuidedHomeworkWorkspace complexity:
   - Файл уже 1189 строк. Изменения минимальны?
   - Новая логика выделена в отдельные функции?
   - Не дублируется код из GuidedThreadViewer?

7. Scope check:
   - Нет drag-and-drop? (Phase 5)
   - Нет clipboard paste? (Phase 5)
   - Нет AI integration? (Phase 4)
   - GuidedChatMessage.tsx НЕ изменён?

Формат ответа:
- Executive summary
- Must fix
- Should fix
- Nice to have
- Safari/iOS risks
- Performance risks
- State/race condition risks
```

---

<a id="phase-3"></a>
## Phase 3 — Claude Code: Upload Pipeline

```text
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Нужно реализовать Phase 3 фичи: загрузка фото/скриншотов/PDF в guided homework chat.
Phase 3 = Upload pipeline: функция uploadStudentThreadImage для загрузки файлов в Storage.

Phase 1 (backend) и Phase 2 (UI) уже реализованы. Phase 2 вызывает uploadStudentThreadImage, которой пока нет.

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ;
- wedge: быстро собрать ДЗ и новую практику по теме урока;
- существующая инфраструктура: bucket homework-submissions, RLS настроен, uploadStudentHomeworkFiles() — reference.

Сначала обязательно прочитай:
1. docs/features/specs/guided-chat-media-upload-tasks.md (Phase 3: задача 3.1)
2. CLAUDE.md (секции: передача изображений задач в AI, кросс-браузерная совместимость)

Задача 3.1: uploadStudentThreadImage

Файл: src/lib/studentHomeworkApi.ts

Создать функцию:
```typescript
export async function uploadStudentThreadImage(
  file: File,
  assignmentId: string,
  threadId: string,
  taskOrder: number,
): Promise<string>  // Returns storage ref: 'storage://homework-submissions/...'
```

Реализация по паттерну uploadStudentHomeworkFiles (уже есть в этом файле):
1. Получить session через getSession() (НЕ getUser — performance.md)
2. Генерировать ext из file.name
3. Генерировать uuid: НЕ crypto.randomUUID() (Safari < 15.4). Используй fallback: `${Date.now()}-${Math.random().toString(36).slice(2)}`
4. Path: {studentId}/{assignmentId}/threads/{taskOrder}/{uuid}.{ext}
5. Upload в bucket homework-submissions
6. Return: storage://homework-submissions/{path}

Что НЕ делать:
- Не создавать новые storage buckets
- Не менять RLS policies
- Не менять другие функции в файле
- Не добавлять image compression (P1, отдельно)
- Не менять frontend (Phase 2 done)
- Не менять backend (Phase 1 done)

КРИТИЧНО:
- getSession(), НЕ getUser() (performance.md: getUser делает сетевой запрос)
- НЕ crypto.randomUUID() (CLAUDE.md: Safari < 15.4)
- storage:// prefix обязателен (CLAUDE.md: передача изображений задач в AI)

После реализации:
1. npm run lint
2. npm run build
3. npm run smoke-check

В конце дай:
1. changed files
2. что сделано
3. что осталось (Phase 4-5)
4. validation results
5. self-check: storage ref format совпадает с existing pattern?
```

---

<a id="phase-3-review"></a>
## Phase 3 — Codex Review

```text
Сделай code review реализации Phase 3 фичи: загрузка фото в guided homework chat.
Phase 3 = Upload pipeline: uploadStudentThreadImage в studentHomeworkApi.ts.

Сначала прочитай:
1. docs/features/specs/guided-chat-media-upload-tasks.md (Phase 3)
2. CLAUDE.md (передача изображений, кросс-браузерная совместимость)

Затем проверь:
- src/lib/studentHomeworkApi.ts (uploadStudentThreadImage)

Проверь:

1. Safari compatibility:
   - НЕ использует crypto.randomUUID()? (Safari < 15.4)
   - UUID fallback корректен?

2. Auth:
   - Использует getSession(), НЕ getUser()? (performance.md)
   - Проверяет session?.user? (throws if not authenticated)

3. Storage ref format:
   - Возвращает storage://homework-submissions/{path}?
   - Формат совпадает с uploadStudentHomeworkFiles pattern?
   - Path не содержит .. или абсолютных путей? (security)

4. Bucket:
   - Использует homework-submissions (уже существует)?
   - НЕ создаёт новые buckets?

5. Error handling:
   - Upload error → throws (caller handles)?
   - Auth error → throws?

6. File extension:
   - Извлекается из file.name?
   - Fallback если нет extension?

Формат ответа:
- Executive summary
- Must fix
- Should fix
- Security check (path traversal, auth)
```

---

<a id="phase-4"></a>
## Phase 4 — Claude Code: AI Integration

```text
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Нужно реализовать Phase 4 фичи: загрузка фото/скриншотов/PDF в guided homework chat.
Phase 4 = AI integration: передача student image в AI при проверке ответа и при обсуждении.

Phase 1-3 уже реализованы: backend принимает image_url, UI загружает файлы, upload сохраняет в Storage.

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ;
- wedge: быстро собрать ДЗ и новую практику по теме урока;
- AI = draft + action: AI видит фото рукописного решения → даёт конкретный фидбэк;
- КРИТИЧНО: storage:// ref НЕЛЬЗЯ передавать напрямую в AI — резолвить в signed HTTP URL (CLAUDE.md).

Сначала обязательно прочитай:
1. docs/features/specs/guided-chat-media-upload-tasks.md (Phase 4: задачи 4.1, 4.2, 4.3)
2. CLAUDE.md (секция: Передача изображений задач в AI — КРИТИЧНО)
3. docs/product/specs/tutor_ai_agents/16-ux-principles-for-tutor-product-sokrat.md

Задача 4.1: Extend evaluateStudentAnswer (backend)
- Файл: supabase/functions/homework-api/guided_ai.ts
- Добавить studentImageUrl?: string в EvaluateStudentAnswerParams
- В buildCheckPrompt(): если есть studentImageUrl, добавить как multimodal image_url
- Prompt должен ясно разделять: "Изображение 1 — условие задачи", "Изображение 2 — рукописное решение ученика"
- Без studentImageUrl → работает как раньше (backward compatible)

Задача 4.2: Resolve student image_url в handleCheckAnswer (backend)
- Файл: supabase/functions/homework-api/index.ts
- В handleCheckAnswer: загрузить latest user message с image_url для текущей задачи
- Если image_url начинается с storage:// → резолвить через db.storage.createSignedUrl()
- Передать signed URL в evaluateStudentAnswer({ studentImageUrl })
- Паттерн-референс: как resolvedTaskImageUrl резолвится в loadAdvanceContext (тот же файл)

Задача 4.3: Extend streamChat для student image
- Файл: src/lib/streamChat.ts
- Добавить optional studentImageUrl?: string в StreamChatOptions
- Передать в request body
- Файл: src/components/homework/GuidedHomeworkWorkspace.tsx
- В requestAssistantReply(): если latest user message имеет image_url, резолвить signed URL → передать в streamChat
- Файл: supabase/functions/chat/index.ts (или где обрабатывается /functions/v1/chat)
- Принять studentImageUrl → добавить как multimodal image в prompt

КРИТИЧНО (из CLAUDE.md):
- НИКОГДА не вставлять storage:// или raw URL как текст в промпт — AI его не увидит
- ОБЯЗАТЕЛЬНО: storage:// → signed HTTP URL через createSignedUrl() (service_role) или через backend endpoint
- Передать как multimodal { type: "image_url", image_url: { url: "https://..." } }
- Четыре пути к AI: answer, hint, question, bootstrap — все должны работать с student image

Что НЕ делать:
- Не менять UI (Phase 2 done)
- Не менять upload pipeline (Phase 3 done)
- Не добавлять OCR или image processing
- Не менять tutor-side AI integration

После реализации:
1. npm run lint
2. npm run build
3. npm run smoke-check

В конце дай:
1. changed files
2. что сделано
3. что осталось (Phase 5)
4. validation results
5. self-check:
   - storage:// НИГДЕ не передаётся в AI промпт как текст?
   - Все 4 пути к AI проверены (answer, hint, question, bootstrap)?
   - Backward compatible: без student image всё работает как раньше?
6. какие документы нужно обновить (CLAUDE.md?)
```

---

<a id="phase-4-review"></a>
## Phase 4 — Codex Review

```text
Сделай code review реализации Phase 4 фичи: загрузка фото в guided homework chat.
Phase 4 = AI integration: передача student image в AI.

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ;
- wedge: быстро собрать ДЗ и новую практику по теме урока;
- КРИТИЧНО: storage:// ref нельзя передавать в AI напрямую.

Сначала прочитай:
1. docs/features/specs/guided-chat-media-upload-tasks.md (Phase 4)
2. CLAUDE.md (секция: Передача изображений задач в AI)

Затем проверь изменённые файлы:
- supabase/functions/homework-api/guided_ai.ts
- supabase/functions/homework-api/index.ts (handleCheckAnswer)
- src/lib/streamChat.ts
- src/components/homework/GuidedHomeworkWorkspace.tsx (requestAssistantReply)

Проверь:

1. КРИТИЧНАЯ БЕЗОПАСНОСТЬ — storage:// → signed URL:
   - storage:// ref НИГДЕ не передаётся в AI prompt как текст?
   - ВСЕ image_url резолвятся через createSignedUrl() перед передачей в AI?
   - Signed URL имеет TTL (expiry)?
   - Нет утечки signed URL в логи или frontend?

2. Multimodal prompt structure:
   - Task image и student image различимы в prompt?
   - AI получает ясную инструкцию: "Изображение 1 — условие", "Изображение 2 — решение ученика"?
   - Порядок: task image → student image → text?

3. Все 4 пути к AI (из CLAUDE.md):
   - answer → handleCheckAnswer → evaluateStudentAnswer: student image передаётся?
   - hint → handleRequestHint → generateHint: student image передаётся (или осознанно нет)?
   - question → streamChat() → /functions/v1/chat: student image передаётся?
   - bootstrap → streamChat() → /functions/v1/chat: student image НЕ передаётся (bootstrap = intro)?

4. Backward compatibility:
   - evaluateStudentAnswer без studentImageUrl работает?
   - streamChat без studentImageUrl работает?
   - handleCheckAnswer без image_url в message работает?

5. Performance:
   - Signed URL создаётся один раз, не на каждый retry?
   - Запрос latest user message оптимален (limit 1, indexed query)?

6. Edge cases:
   - Student image с невалидным storage ref → graceful fallback (null)?
   - Student отправил только текст (no image) → AI работает как раньше?
   - Image URL expired → что происходит?

Формат ответа:
- Executive summary
- Must fix (especially storage:// leaks)
- Should fix
- Nice to have
- Security risks (signed URL exposure)
- AI prompt quality check
```

---

<a id="phase-5"></a>
## Phase 5 — Claude Code: Clipboard Paste + Mobile

```text
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Нужно реализовать Phase 5 фичи: загрузка фото/скриншотов/PDF в guided homework chat.
Phase 5 = Clipboard paste (Ctrl+V) + mobile camera capture.

Phase 1-4 уже реализованы: полный pipeline работает (upload → persist → display → AI).

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ;
- пользователи: школьники 14-18, iPhone + Safari, Android + Chrome;
- десктоп: ученик делает скриншот → Ctrl+V → прикрепляет к сообщению.

Сначала обязательно прочитай:
1. docs/features/specs/guided-chat-media-upload-tasks.md (Phase 5: задачи 5.1, 5.2)
2. CLAUDE.md (кросс-браузерная совместимость)

Задача 5.1: Clipboard paste (Ctrl+V)
- Файл: src/components/homework/GuidedChatInput.tsx
- Добавить onPaste handler на container div
- При paste: проверить clipboardData.files на image files
- Если есть image → вызвать onFileSelect(file), preventDefault
- Text paste НЕ перехватывать (textarea обработает сама)
- Работает в Chrome, Safari desktop, Firefox

Задача 5.2: Mobile camera capture
- Файл: src/components/homework/GuidedChatInput.tsx
- На мобильном: <input type="file" accept="image/*,.pdf"> (native picker предложит камеру)
- НЕ делать bottom sheet (P1, отдельно) — используем native file picker
- Фото с камеры обрабатывается как обычный файл

КРИТИЧНО (из CLAUDE.md):
- НЕ использовать navigator.clipboard.read() напрямую (ограниченная поддержка, нужен permission)
- Использовать event-based paste (clipboardData.files) — работает везде
- touch-action: manipulation на input (300ms delay prevention на iOS)

Что НЕ делать:
- Не добавлять bottom sheet (P1)
- Не добавлять drag-and-drop (P1)
- Не добавлять HEIC конвертацию (P1)
- Не добавлять image compression (P1)
- Не менять backend или AI integration (Phase 1, 4 done)

После реализации:
1. npm run lint
2. npm run build
3. npm run smoke-check

В конце дай:
1. changed files
2. что сделано
3. полный checklist фичи: что работает end-to-end
4. validation results
5. self-check:
   - Paste image работает в Chrome, Safari desktop?
   - Paste text НЕ сломан?
   - Mobile camera открывается?
   - iOS Safari: всё работает?
6. какие документы нужно обновить (CLAUDE.md, PRD acceptance criteria)
```

---

<a id="phase-5-review"></a>
## Phase 5 — Codex Review

```text
Сделай code review реализации Phase 5 фичи: загрузка фото в guided homework chat.
Phase 5 = Clipboard paste + mobile camera capture.

Контекст:
- пользователи: школьники 14-18, iPhone + Safari, Android + Chrome.

Прочитай:
1. docs/features/specs/guided-chat-media-upload-tasks.md (Phase 5)
2. CLAUDE.md (кросс-браузерная совместимость)

Затем проверь:
- src/components/homework/GuidedChatInput.tsx

Проверь:

1. Clipboard paste:
   - Обработчик на paste event, НЕ на clipboard API?
   - Проверяет clipboardData.files?
   - Только image files перехватываются (не text)?
   - Text paste НЕ сломан (textarea по-прежнему принимает текст)?
   - Работает в Chrome, Safari, Firefox?

2. Mobile camera:
   - Input type="file" с accept="image/*,.pdf"?
   - capture attribute используется корректно (или отсутствует для native picker)?
   - touch-action: manipulation на элементах?

3. Safari/iOS:
   - Нет новых запрещённых паттернов (crypto.randomUUID, lookbehind, etc.)?
   - Font-size ≥ 16px сохранён?

4. Scope check:
   - Нет bottom sheet? (P1)
   - Нет drag-and-drop? (P1)
   - Нет HEIC конвертации? (P1)
   - Нет image compression? (P1)

Формат ответа:
- Executive summary
- Must fix
- Should fix
- Cross-browser risks
```

---

<a id="final-review"></a>
## Финальный Codex Review — вся фича end-to-end

```text
Сделай финальный code review всей фичи: загрузка фото/скриншотов/PDF в guided homework chat.
Все 5 фаз реализованы.

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ;
- wedge: быстро собрать ДЗ и новую практику по теме урока;
- продукт = AI + база + домашки + материалы;
- нельзя скатываться в generic chat UX.

Сначала прочитай:
1. docs/features/specs/guided-chat-media-upload-prd.md (полный PRD)
2. docs/features/specs/guided-chat-media-upload-tasks.md (все фазы)
3. docs/product/specs/tutor_ai_agents/16-ux-principles-for-tutor-product-sokrat.md
4. docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules-sokrat.md
5. docs/product/specs/tutor_ai_agents/19-agent-workflow-and-review-system-sokrat.md
6. CLAUDE.md

Проверь ВСЕ изменённые файлы:
- supabase/functions/homework-api/index.ts
- supabase/functions/homework-api/guided_ai.ts
- src/components/homework/GuidedChatInput.tsx
- src/components/homework/GuidedHomeworkWorkspace.tsx
- src/lib/studentHomeworkApi.ts
- src/lib/streamChat.ts

End-to-end checklist:

1. Product alignment:
   - Какой Job усиливает? (должен быть Job C — прорешивание)
   - Усиливает wedge? (ДЗ по физике с графиками/формулами)
   - Нет product drift? (не превратился в generic image chat)
   - AI output переводится в действие? (фидбэк на фото → ученик исправляет)

2. Full data flow:
   - Student selects file → preview → send → upload to Storage → storage ref → save to DB → display in chat → AI receives signed URL → AI gives feedback?
   - Tutor sees student image in GuidedThreadViewer? (should work without changes)

3. Security:
   - storage:// ref НИГДЕ не передаётся в AI как текст?
   - Signed URLs имеют TTL?
   - File path не содержит traversal (../)?
   - RLS: student может загружать только в свой path?

4. Cross-browser (Safari/iOS):
   - Все запрещённые паттерны проверены?
   - font-size ≥ 16px?
   - Clipboard paste работает?
   - Camera capture работает?

5. Performance:
   - Нет framer-motion в homework components?
   - getSession() вместо getUser()?
   - URL.revokeObjectURL cleanup?
   - Lazy loading сохранён?

6. Architecture:
   - Student/Tutor module isolation сохранена?
   - GuidedHomeworkWorkspace не вырос критически? (была 1189 строк)
   - Нет дублирования кода с GuidedThreadViewer?
   - React Query key convention соблюдена?

7. Backward compatibility:
   - Существующие guided chats без images работают?
   - Существующие API calls без image_url работают?
   - GuidedChatMessage рендерит и старые, и новые сообщения?

8. Acceptance criteria (из PRD):
   - [ ] 1-5 изображений к сообщению
   - [ ] Превью с удалением
   - [ ] Clipboard paste (Ctrl+V)
   - [ ] Camera на мобильном
   - [ ] AI получает фото при answer check
   - [ ] AI получает фото при question mode
   - [ ] File size validation
   - [ ] Format validation

Формат ответа:
- Executive summary
- Must fix
- Should fix
- Nice to have
- Product drift risks
- UX risks
- Architecture/state risks
- Security risks
- Cross-browser risks
- Docs that need update
```

---

## Как использовать этот документ

### Порядок работы

```
Phase 1 prompt → Claude Code реализует → Phase 1 review → Codex проверяет → fix if needed
     ↓
Phase 2 prompt → Claude Code реализует → Phase 2 review → Codex проверяет → fix if needed
     ↓
Phase 3 prompt → Claude Code реализует → Phase 3 review → Codex проверяет → fix if needed
     ↓
Phase 4 prompt → Claude Code реализует → Phase 4 review → Codex проверяет → fix if needed
     ↓
Phase 5 prompt → Claude Code реализует → Phase 5 review → Codex проверяет → fix if needed
     ↓
Final review → Codex проверяет end-to-end → fix if needed → DONE
```

### Правила

1. **Не пропускать review** — каждая фаза проходит через Codex перед переходом к следующей
2. **Не объединять фазы** — каждая фаза деплоится отдельно
3. **Must fix** из review = блокер для следующей фазы
4. **Should fix** = желательно перед следующей фазой, но не блокер
5. **Nice to have** = можно отложить на polish sprint
