# Task Specs: Загрузка фото/скриншотов/PDF в guided chat

**PRD:** `docs/features/specs/guided-chat-media-upload-prd.md`
**Дата:** 2026-03-20
**Sprint:** S3

---

## Обзор фаз

| Фаза | Описание | Effort | Зависимости |
|------|----------|--------|-------------|
| **Phase 1** | Backend: принять image_url в student messages | S | — |
| **Phase 2** | Frontend: UI загрузки в GuidedChatInput | M | Phase 1 |
| **Phase 3** | Upload pipeline: загрузка файлов в Storage | M | Phase 1 |
| **Phase 4** | AI integration: передача student image в AI | M | Phase 1, 3 |
| **Phase 5** | Clipboard paste + мобильные улучшения | S | Phase 2, 3 |

**Рекомендация:** начать с Phase 1 (backend) → Phase 3 (upload) → Phase 2 (UI) → Phase 4 (AI) → Phase 5 (polish).

**Статус на 2026-03-20:** Phase 1 и Phase 2 реализованы (включая upload pipeline из Phase 3). Phase 3 (Storage bucket policies), Phase 4 (AI integration), Phase 5 (clipboard paste, DnD) остаются в backlog.

---

## Phase 1: Backend — принять image_url в student thread messages

### Задача 1.1: Extend handlePostThreadMessage

**Файл:** `supabase/functions/homework-api/index.ts`
**Функция:** `handlePostThreadMessage` (обработчик `POST /threads/:id/messages`)

**Что сделать:**
1. Принять optional `image_url: string` в request body
2. Валидировать формат: должен начинаться с `storage://`
3. Сохранить `image_url` в `homework_tutor_thread_messages` при INSERT

**Исходный код до Phase 1 (упрощённо):**
```typescript
// handlePostThreadMessage
const { content, role, task_order, message_kind } = body;
await db.from('homework_tutor_thread_messages').insert({
  thread_id, role, content, task_order, message_kind,
  // image_url НЕ передаётся
});
```

**Реализованный паттерн:**
```typescript
const { content, role, task_order, message_kind, image_url } = body;
// Validate image_url format
const validImageUrl = (typeof image_url === 'string' && image_url.trim() &&
  image_url.startsWith('storage://')) ? image_url.trim() : null;

await db.from('homework_tutor_thread_messages').insert({
  thread_id, role, content, task_order, message_kind,
  image_url: validImageUrl,
});
```

**Паттерн-референс:** `handleTutorPostMessage` (line ~3618) — уже принимает `image_url` точно так же.

**Acceptance criteria:**
- [x] `POST /threads/:id/messages` принимает optional `image_url` в body
- [x] `image_url` сохраняется в `homework_tutor_thread_messages`
- [x] Невалидный `image_url` (не `storage://`) → игнорируется (null)
- [x] Пустой или отсутствующий `image_url` → null (backward compatible)
- [x] Существующие вызовы без `image_url` продолжают работать

**Примечание:** Phase 1 сохраняет текущий backend-контракт `content` = non-empty string. Для image-only сообщений caller в Phase 2 должен подставлять placeholder `'(фото)'`.

**Не делать:**
- Не менять `handleTutorPostMessage` (уже работает)
- Не добавлять новые endpoints
- Не менять DB schema (column `image_url` уже есть)

---

### Задача 1.2: Extend saveThreadMessage (client API)

**Файл:** `src/lib/studentHomeworkApi.ts`
**Функция:** `saveThreadMessage()`

**Что сделать:**
1. Добавить optional параметр `imageUrl?: string` в сигнатуру
2. Передать `image_url` в request body

**Сигнатура до Phase 1:**
```typescript
export async function saveThreadMessage(
  threadId: string,
  role: 'user' | 'assistant',
  content: string,
  taskOrder?: number,
  messageKind?: GuidedMessageKind,
): Promise<{ id: string }>
```

**Реализованная сигнатура:**
```typescript
export async function saveThreadMessage(
  threadId: string,
  role: 'user' | 'assistant',
  content: string,
  taskOrder?: number,
  messageKind?: GuidedMessageKind,
  imageUrl?: string,  // storage:// ref
): Promise<{ id: string }>
```

**Acceptance criteria:**
- [x] `saveThreadMessage` принимает optional `imageUrl`
- [x] `imageUrl` передаётся в body как `image_url`
- [x] Backward compatible — вызовы без `imageUrl` работают как раньше

---

## Phase 2: Frontend — UI загрузки в GuidedChatInput

### Задача 2.1: Кнопка 📎 и file input

**Файл:** `src/components/homework/GuidedChatInput.tsx`

**Что сделать:**
1. Добавить кнопку 📎 слева от textarea
2. Hidden `<input type="file">` с `accept="image/*,.pdf"`
3. При клике на 📎:
   - Desktop: открывает native file picker
   - Mobile: тоже native file picker (bottom sheet — Phase 5)
4. При выборе файла: валидация (тип, размер ≤ 10 МБ) → вызвать `onFileSelect(file)`

**Новые props:**
```typescript
interface GuidedChatInputProps {
  // ... existing props
  attachedFiles: File[];
  onFileSelect: (file: File) => void;
  onFileRemove: (index: number) => void;
  isUploading: boolean;
}
```

**Layout изменения:**
```
Сейчас:  [textarea                    ] [Шаг] [Ответ]
После:   [📎] [textarea               ] [Шаг] [Ответ]
```

**Кнопка 📎:**
- Icon: `Paperclip` из lucide-react (уже в проекте)
- Size: 36x36, secondary style
- Disabled когда: `isStreaming || isCheckingAnswer || isRequestingHint || !isViewingActiveTask`
- На мобильном: того же размера, touch-friendly (min 44x44 tap area)

**Валидация при выборе:**
```typescript
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'application/pdf'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_FILES = 3;
```

**Error handling:**
- Размер > 10 МБ → `toast.error('Файл слишком большой. Максимум 10 МБ')`
- Неподдерживаемый формат → `toast.error('Поддерживаются: JPG, PNG, PDF')`
- Уже 3 файла → `toast.error('Максимум 3 вложения')`

**Acceptance criteria:**
- [x] Кнопка 📎 слева от textarea
- [x] File picker открывается по клику
- [x] Валидация типа и размера
- [x] Error toasts при невалидном файле
- [x] Кнопка disabled в нужных states
- [x] Layout не ломается на mobile (iOS Safari)
- [x] Input font-size ≥ 16px сохранён

**Не делать:**
- Не добавлять framer-motion
- Не менять существующий textarea behavior
- Не добавлять drag-and-drop (Phase 5)

---

### Задача 2.2: Превью вложений

**Файл:** `src/components/homework/GuidedChatInput.tsx` (или отдельный `AttachmentPreview.tsx`)

**Что сделать:**
1. Над полем ввода показать карточки прикреплённых файлов
2. Каждая карточка: thumbnail (48px) + имя + размер + кнопка ✕
3. Для изображений: `URL.createObjectURL(file)` → thumbnail
4. Для PDF: иконка 📄 вместо thumbnail
5. Кнопка ✕ → вызывает `onFileRemove(index)`

**Компонент AttachmentPreview:**
```tsx
function AttachmentPreview({ files, onRemove, isUploading }: {
  files: File[];
  onRemove: (index: number) => void;
  isUploading: boolean;
}) {
  // Render horizontal stack of attachment cards
  // Each: [thumbnail] [name · size] [✕]
  // If isUploading: show spinner instead of ✕
}
```

**Визуал:**
```
┌─────────────────────────────────────┐
│ [📷 48px] решение.jpg · 2.1 МБ [✕] │
│ [📄 48px] доп_решение.pdf · 1 МБ[✕]│
└─────────────────────────────────────┘
[📎] [Текст...                ] [Шаг] [Ответ]
```

**Memory cleanup:**
- `URL.revokeObjectURL()` при unmount или remove

**Acceptance criteria:**
- [x] Превью показывается при наличии attached files
- [x] Thumbnail для изображений (object URL)
- [x] Иконка для PDF → убрана (PDF исключён из accept, MessageAttachment рендерит только img)
- [x] Имя файла + размер (human-readable)
- [x] Кнопка ✕ удаляет конкретный файл
- [x] Во время загрузки: ✕ заменяется на spinner
- [x] Memory cleanup (revokeObjectURL)

---

### Задача 2.3: Extend send handlers в GuidedHomeworkWorkspace

**Файл:** `src/components/homework/GuidedHomeworkWorkspace.tsx`

**Что сделать:**
1. Добавить state: `attachedFiles: File[]`, `isUploading: boolean`
2. Добавить handlers: `handleFileSelect`, `handleFileRemove`
3. Extend `sendUserMessage(text, mode)` → `sendUserMessage(text, mode, files?)`
4. При отправке с файлами:
   - Set `isUploading = true`
   - Upload each file → получить storage refs
   - Persist message with `image_url` (первый файл) — multiple images: отдельные сообщения или первый в image_url
   - Set `isUploading = false`
   - Clear `attachedFiles`

**Изменения в `sendUserMessage`:**
```typescript
async function sendUserMessage(rawText: string, sendMode: 'question' | 'answer', files?: File[]) {
  // ... existing validation

  let imageUrl: string | undefined;
  if (files && files.length > 0) {
    setIsUploading(true);
    try {
      // Upload first file (MVP: 1 image per message)
      imageUrl = await uploadStudentThreadImage(files[0], assignment.id, threadId, activeTaskOrder);
    } catch (e) {
      toast.error('Ошибка загрузки файла');
      setIsUploading(false);
      return;
    }
    setIsUploading(false);
  }

  // Persist message
  const content = rawText.trim() || (imageUrl ? '(фото)' : '');
  const saved = await saveThreadMessage(threadId, 'user', content, taskOrder, messageKind, imageUrl);

  // ... rest of flow (AI streaming)
}
```

**Race guard:** добавить `isUploading` в existing race guard:
```typescript
if (isStreaming || isCheckingAnswer || isRequestingHint || isUploading) return;
```

**Acceptance criteria:**
- [x] `attachedFiles` state управляется в workspace
- [x] Upload происходит при отправке сообщения
- [x] Storage ref передаётся в `saveThreadMessage`
- [x] Race guard включает `isUploading`
- [x] Файлы очищаются после успешной отправки
- [x] Toast при ошибке загрузки
- [x] Сообщение без текста + с файлом → content = '(фото)'

---

## Phase 3: Upload Pipeline — загрузка файлов в Storage

### Задача 3.1: uploadStudentThreadImage function

**Файл:** `src/lib/studentHomeworkApi.ts`

**Что сделать:**
1. Новая функция `uploadStudentThreadImage(file, assignmentId, threadId, taskOrder)`
2. По паттерну `uploadStudentHomeworkFiles()` (уже есть в файле)
3. Bucket: `homework-submissions` (RLS уже настроен для студентов)
4. Path: `{studentId}/{assignmentId}/threads/{taskOrder}/{uuid}.{ext}`
5. Return: `storage://homework-submissions/...`

**Сигнатура:**
```typescript
export async function uploadStudentThreadImage(
  file: File,
  assignmentId: string,
  threadId: string,
  taskOrder: number,
): Promise<string>  // Returns storage ref
```

**Реализация (по паттерну из uploadStudentHomeworkFiles):**
```typescript
export async function uploadStudentThreadImage(
  file: File, assignmentId: string, threadId: string, taskOrder: number,
): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) throw new Error('Not authenticated');

  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const uuid = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const objectPath = `${session.user.id}/${assignmentId}/threads/${taskOrder}/${uuid}.${ext}`;

  const { error } = await supabase.storage
    .from('homework-submissions')
    .upload(objectPath, file, { contentType: file.type, upsert: false });

  if (error) throw error;
  return `storage://homework-submissions/${objectPath}`;
}
```

**Safari fallback:** не использовать `crypto.randomUUID()` — fallback через `Date.now()` (см. CLAUDE.md: Safari < 15.4).

**Acceptance criteria:**
- [x] Функция загружает файл в `homework-submissions` bucket
- [x] Возвращает `storage://...` ref
- [x] Path содержит studentId, assignmentId, taskOrder
- [x] Работает в Safari 15+ (no crypto.randomUUID — использует Date.now + Math.random)
- [x] Throws при ошибке (caller обрабатывает)
- [x] Fallback на `homework-images` bucket (по паттерну `uploadStudentHomeworkFiles`)

---

## Phase 4: AI Integration — передача student image в AI

### Задача 4.1: Extend evaluateStudentAnswer (backend)

**Файл:** `supabase/functions/homework-api/guided_ai.ts`

**Что сделать:**
1. Добавить `studentImageUrl?: string` в `EvaluateStudentAnswerParams`
2. В `buildCheckPrompt()`: если есть `studentImageUrl`, добавить как multimodal image
3. Резолвить `storage://` → signed URL в caller (`handleCheckAnswer` в index.ts)

**Текущий interface:**
```typescript
export interface EvaluateStudentAnswerParams {
  taskText: string;
  correctAnswer: string;
  studentAnswer: string;
  taskImageUrl: string | null;  // task condition image
  // ... other fields
}
```

**Целевой interface:**
```typescript
export interface EvaluateStudentAnswerParams {
  taskText: string;
  correctAnswer: string;
  studentAnswer: string;
  taskImageUrl: string | null;      // task condition image
  studentImageUrl: string | null;   // NEW: student's handwritten solution
  // ... other fields
}
```

**В buildCheckPrompt():**
```typescript
// After task image:
if (params.studentImageUrl) {
  userContent.push({
    type: "image_url",
    image_url: { url: params.studentImageUrl },
  });
  userContent.push({
    type: "text",
    text: "Изображение выше — рукописное решение ученика.",
  });
}
```

**Acceptance criteria:**
- [ ] `evaluateStudentAnswer` принимает optional `studentImageUrl`
- [ ] AI получает и task image, и student image (оба как multimodal)
- [ ] Prompt ясно указывает AI что каждое изображение — task vs student solution
- [ ] Без studentImageUrl → работает как раньше

---

### Задача 4.2: Resolve student image_url в handleCheckAnswer (backend)

**Файл:** `supabase/functions/homework-api/index.ts`
**Функция:** `handleCheckAnswer`

**Что сделать:**
1. После получения student answer, загрузить latest user message с `image_url`
2. Если есть `image_url` → резолвить `storage://` → signed URL
3. Передать signed URL в `evaluateStudentAnswer({ studentImageUrl })`

**Логика:**
```typescript
// In handleCheckAnswer, after getting studentAnswer:
let studentImageUrl: string | null = null;

// Load latest user message for this task
const { data: latestMsg } = await db
  .from('homework_tutor_thread_messages')
  .select('image_url')
  .eq('thread_id', threadId)
  .eq('role', 'user')
  .eq('task_order', taskOrder)
  .order('created_at', { ascending: false })
  .limit(1)
  .single();

if (latestMsg?.image_url?.startsWith('storage://')) {
  const parsed = parseStorageRef(latestMsg.image_url);
  if (parsed) {
    const { data: signedData } = await db.storage
      .from(parsed.bucket)
      .createSignedUrl(parsed.path, 3600);
    studentImageUrl = signedData?.signedUrl ?? null;
  }
}

// Pass to AI
await evaluateStudentAnswer({
  ...existingParams,
  studentImageUrl,
});
```

**Acceptance criteria:**
- [ ] Backend загружает latest user message image_url для текущей задачи
- [ ] Резолвит storage:// → signed HTTP URL
- [ ] Передаёт в evaluateStudentAnswer
- [ ] Без image_url → studentImageUrl = null (backward compatible)

---

### Задача 4.3: Extend streamChat для student image (frontend)

**Файл:** `src/lib/streamChat.ts` + `src/components/homework/GuidedHomeworkWorkspace.tsx`

**Что сделать:**
1. В `StreamChatOptions`: добавить optional `studentImageUrl?: string`
2. В `requestAssistantReply()`: если latest user message имеет `image_url`, резолвить → signed URL → передать в streamChat
3. `/functions/v1/chat` endpoint: принять и использовать `studentImageUrl`

**Это менее критично чем answer mode** — в question mode AI тоже полезно видеть фото, но основной use case — answer checking (Phase 4.1-4.2).

**Acceptance criteria:**
- [ ] streamChat принимает optional studentImageUrl
- [ ] Chat endpoint строит multimodal prompt с обоими изображениями
- [ ] Без studentImageUrl → работает как раньше

---

## Phase 5: Clipboard Paste + мобильные улучшения

### Задача 5.1: Clipboard paste (Ctrl+V)

**Файл:** `src/components/homework/GuidedChatInput.tsx`

**Что сделать:**
1. Добавить `onPaste` handler на container div (не на textarea — textarea paste = text only)
2. При paste: проверить `clipboardData.files` на наличие images
3. Если есть image file → вызвать `onFileSelect(file)`
4. Не перехватывать text paste (пусть textarea работает нормально)

```typescript
const handlePaste = (e: React.ClipboardEvent) => {
  const files = Array.from(e.clipboardData.files);
  const imageFile = files.find(f => f.type.startsWith('image/'));
  if (imageFile) {
    e.preventDefault();
    onFileSelect(imageFile);
  }
  // Text paste: не перехватываем, textarea обработает сама
};
```

**Acceptance criteria:**
- [ ] Ctrl+V / Cmd+V с изображением в буфере → прикрепляет файл
- [ ] Ctrl+V с текстом → вставляет текст (не перехватывает)
- [ ] Работает в Chrome, Safari desktop, Firefox
- [ ] На мобильном: не ломает обычный paste текста

---

### Задача 5.2: Mobile camera capture

**Файл:** `src/components/homework/GuidedChatInput.tsx`

**Что сделать:**
1. На мобильном: `<input type="file" accept="image/*" capture="environment">` → открывает камеру
2. Определение мобильного: `window.matchMedia('(max-width: 768px)')` или user agent
3. На десктопе: обычный file picker без `capture`

**Два варианта реализации:**

**Вариант A (простой, рекомендуемый для P0):**
- Один `<input type="file" accept="image/*,.pdf">` для всех платформ
- На iOS/Android native picker сам предложит камеру

**Вариант B (bottom sheet, P1):**
- Sheet с 3 кнопками: Камера (`capture="environment"`) / Галерея (`accept="image/*"`) / Документ (`accept="*/*"`)

**Рекомендация:** Вариант A для Phase 5. Вариант B — отдельная задача P1.

**Acceptance criteria:**
- [ ] На мобильном файловый picker включает опцию камеры (native behavior)
- [ ] Фото с камеры прикрепляется как обычный файл
- [ ] Работает в Safari iOS и Chrome Android

---

## Порядок реализации (рекомендация для Claude Code)

```
Phase 1.1 → Phase 1.2 → Phase 3.1 → Phase 2.1 → Phase 2.2 → Phase 2.3 → Phase 4.1 → Phase 4.2 → Phase 5.1

[Backend]    [Client API]   [Upload]     [UI]         [Preview]    [Workspace]    [AI check]    [AI resolve]   [Paste]
```

**Каждую фазу можно деплоить отдельно.** Phase 1 — backward compatible. Phase 3 — standalone utility. Phase 2 — feature flag (можно скрыть кнопку).

---

## Документы для обновления после реализации

- [x] `CLAUDE.md` — добавить секцию про student image upload в guided chat
- [x] `docs/features/specs/guided-chat-media-upload-prd.md` — отметить acceptance criteria
- [ ] UX-аудит `student-homework-ux-improvements.html` — обновить статус 3.6
