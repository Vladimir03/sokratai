# PRD: Загрузка фото, скриншотов и PDF в guided chat

**Продукт:** Сократ
**Автор:** Vladimir / UX-аудит
**Версия:** v0.1
**Статус:** implemented for guided chat upload/storage/render + image-to-AI; PDF currently stays in chat/tutor view and is not sent to AI
**Дата:** 2026-03-20
**Тип задачи:** A — новая фича

---

## 1. Executive Summary

Ученик в guided homework chat может отправлять только текст. Для физики и математики этого недостаточно — 80%+ решений ЕГЭ/ОГЭ пишутся от руки: формулы, чертежи, графики, схемы. Ученик должен иметь возможность прикрепить фото рукописного решения, скриншот или PDF к своему сообщению в guided chat.

**Фича:** добавить мультимодальный ввод (текст + изображение/PDF) в `GuidedChatInput` и провести изображение через весь pipeline: загрузка → хранение → отображение → передача в AI.

**Статус на 2026-04-17:** все фазы (Phase 1–5) реализованы для end-to-end image flow. Актуальный pipeline: выбор/вставка до 5 файлов → preview → upload в Storage → persist refs в `image_url` → отображение в чате и у репетитора → передача изображений в AI (`answer`, `hint`, `question`). Clipboard paste работает через `clipboardData.files` + `items` fallback (Safari/Firefox). Mobile camera доступна через native file picker. PDF поддержан в upload/storage/rendering, но в AI path передаются только изображения.

---

## 2. Job / Wedge Alignment

### Какой Job усиливает
**Job C (P0):** «Провести ученика через прорешивание ДЗ с AI» — из doc 15 (backlog-of-jtbd-scenarios).

Ученик решает задачу на бумаге → фотографирует решение → отправляет AI для проверки → AI анализирует рукописное решение и даёт фидбэк. Без загрузки фото этот loop невозможен для задач с графиками, чертежами и развёрнутыми решениями.

### Как усиливает wedge
Wedge: «быстро собрать ДЗ и новую практику по теме урока».
- Репетитор задаёт задачи из ЕГЭ с графиками → ученик должен уметь показать своё решение
- AI видит рукописное решение → даёт step-level фидбэк → ученик учится
- Репетитор видит фото и PDF решения в GuidedThreadViewer

### Повышает ли шанс платного пилота
**Да.** Без загрузки фото:
- guided mode ограничен текстовым вводом (не подходит для ЕГЭ физика)
- репетитор не видит процесс решения ученика
- AI не может проверить рукописные решения

---

## 3. Goals

1. Ученик может прикрепить 1-5 изображений (JPG, PNG, HEIC) или PDF к сообщению в guided chat
2. Фото отображается в чате как кликабельный thumbnail (с zoom)
3. Репетитор видит вложения ученика в GuidedThreadViewer
4. AI получает фото ученика при проверке ответа (`answer` mode) и при обсуждении (`question` mode)
5. Clipboard paste (Ctrl+V / Cmd+V) работает на десктопе
6. Камера/галерея доступны на мобильном через bottom sheet

---

## 4. Non-Goals (Out of Scope)

- ❌ Drag & Drop зона (P1, отдельный спринт)
- ❌ HEIC → JPG конвертация на клиенте (P1, отдельно)
- ❌ Авто-сжатие изображений > 5 МБ (P1, отдельно)
- ❌ OCR рукописного текста (future — AI сам анализирует изображение)
- ❌ Рисование/аннотации поверх фото (future)
- ❌ PDF preview с постраничным просмотром (future)
- ❌ Загрузка видео (out of scope)
- ❌ Изменение существующего tutor upload flow (работает, не трогаем)
- ❌ Новые storage buckets (используем существующий `homework-submissions`)

---

## 5. Current State Audit

### Что уже есть
| Компонент | Статус | Детали |
|-----------|--------|--------|
| Storage bucket `homework-submissions` | ✅ Есть | RLS: студент может загружать в `{student_id}/...` |
| `uploadStudentHomeworkFiles()` | ✅ Есть | Загрузка в `homework-submissions`, возвращает `storage://...` ref |
| `getStudentTaskImageSignedUrl()` | ✅ Есть | Резолвит `storage://` → signed HTTP URL |
| `ThreadAttachments` в `GuidedChatMessage` | ✅ Есть | Рендерит до 5 attachment refs из `message.image_url` через signed URL |
| `image_url` column в `homework_tutor_thread_messages` | ✅ Есть | Хранит single `storage://...` ref или JSON array refs |
| Tutor upload + display (GuidedThreadViewer) | ✅ Есть | `uploadTutorHomeworkTaskImage()` + `handleSendMessage()` |
| Передача task image в AI | ✅ Есть | `storage://` → signed URL → multimodal API |

### Что нужно добавить
| Компонент | Статус | Что делать |
|-----------|--------|------------|
| UI загрузки в `GuidedChatInput` | ✅ | Кнопка 📎, preview stack, remove, upload/error states, `multiple`, PDF cards |
| Student upload function для guided chat | ✅ | `uploadStudentThreadImage()` загружает в Storage и возвращает `storage://...` ref |
| `saveThreadMessage()` с attachments | ✅ | `saveThreadMessage()` принимает array refs и сериализует их в `image_url` |
| Backend: `POST /threads/:id/messages` | ✅ | Student `handlePostThreadMessage` валидирует ownership/path и сохраняет refs в `homework_tutor_thread_messages` |
| Передача student image в AI | ✅ | `evaluateStudentAnswer`, `generateHint`, `streamChat` принимают multiple student images |
| Clipboard paste handler | ✅ | `paste` event → file extraction → preview |

---

## 6. Target Flow

### 6.1. Ученик прикрепляет фото (мобильный)

```
[Ученик нажимает 📎]
  → Bottom Sheet: "Сфотографировать" / "Галерея" / "Документ"
  → Ученик выбирает фото
  → Превью появляется НАД полем ввода (thumbnail 56px + имя + размер + ✕)
  → Ученик добавляет текст (опционально)
  → Нажимает "Шаг" или "Ответ"
  → Фото загружается → storage ref → сообщение сохраняется в БД
  → Сообщение появляется в чате (thumbnail + текст)
  → AI получает фото + текст
```

### 6.2. Ученик вставляет скриншот (десктоп)

```
[Ученик делает скриншот → Ctrl+V в поле ввода]
  → Превью появляется НАД полем ввода
  → Ученик добавляет текст
  → Отправляет
```

### 6.3. AI обрабатывает фото ученика

```
Режим "Ответ" (answer):
  → Student image uploaded → storage ref
  → Backend resolves storage ref → signed URL
  → evaluateStudentAnswer() receives { studentAnswer, studentImageUrls }
  → AI prompt: "Изображение — рукописное решение ученика. Текст ответа: ..."
  → AI видит и текст, и фото → даёт фидбэк
  → Если среди вложений есть PDF, он остаётся в чате, но в AI path не передаётся

Режим "Шаг" (question):
  → streamChat() receives { messages, taskImageUrl, studentImageUrls? }
  → AI видит условие задачи + последние изображения ученика + текст вопроса
  → Отвечает в контексте увиденного
```

---

## 7. Screen-by-Screen UX

### 7.1. GuidedChatInput — новый layout

```
┌─────────────────────────────────────────────┐
│ ┌──────────────────────────────────────────┐ │  ← Превью вложений
│ │ [📷 thumb] решение.jpg · 2.1 МБ    [✕]  │ │     (появляется если есть файл)
│ └──────────────────────────────────────────┘ │
│                                             │
│ [📎]  [Текст сообщения...              ]    │  ← Основная строка
│        [💬 Шаг]  [✓ Ответ]                  │
└─────────────────────────────────────────────┘
```

**Элементы:**
- `📎` — кнопка вложения (слева от textarea)
- Превью — горизонтальная карточка: thumbnail 48px + имя файла + размер + кнопка ✕
- Максимум 3 вложения (стек карточек)
- Textarea остаётся на месте, не заменяется

### 7.2. Bottom Sheet (мобильный, при нажатии 📎)

```
┌─────────────────────────────┐
│  ─── (grab handle)          │
│  Прикрепить                 │
│                             │
│  [📷] Сфотографировать      │  ← input capture="environment"
│  [🖼️] Галерея               │  ← input accept="image/*"
│  [📄] Документ              │  ← input accept="image/*,.pdf"
└─────────────────────────────┘
```

### 7.3. Фото в чате (отправленное)

```
┌──────────────────────┐
│  ШАГ РЕШЕНИЯ         │  ← label
│ ┌──────────────────┐ │
│ │                  │ │  ← thumbnail image (max-w-[200px], h-24)
│ │   📷 фото        │ │     кликабельный → lightbox zoom
│ └──────────────────┘ │
│ Вот моё решение,     │  ← текст сообщения
│ скорость = 0 м/с     │
└──────────────────────┘
```

---

## 8. States

### 8.1. Attachment states
| State | Визуал | Действия |
|-------|--------|----------|
| `idle` | Кнопка 📎 обычная | Клик → file picker / bottom sheet |
| `preview` | Превью карточка над textarea | ✕ убрать, отредактировать текст |
| `uploading` | Progress indicator на thumbnail | Кнопки send disabled |
| `uploaded` | Сообщение в чате с thumbnail | Lightbox zoom по клику |
| `error` | Toast «Ошибка загрузки. Повторить?» | Retry или ✕ |

### 8.2. Interaction states (GuidedChatInput)
| Condition | Attachment button | Send buttons |
|-----------|------------------|--------------|
| `isStreaming` | disabled | disabled |
| `isCheckingAnswer` | disabled | disabled |
| `isRequestingHint` | disabled | disabled |
| `!isViewingActiveTask` | disabled | disabled |
| File uploading | enabled (can add more) | disabled до завершения |
| File attached + text empty | enabled | enabled (сообщение = только файл) |
| File attached + text filled | enabled | enabled |
| No file + text empty | enabled | disabled |

---

## 9. Desktop / Mobile Behavior

| Аспект | Desktop | Mobile |
|--------|---------|--------|
| Кнопка 📎 | Открывает native file picker | Открывает bottom sheet |
| Clipboard paste | Ctrl+V → превью | Кнопка «Вставить» (paste API ограничен) |
| Drag & Drop | Out of scope (P1) | — |
| Input font-size | 14px | ≥ 16px (iOS zoom prevention) |
| Thumbnail в чате | max-w-[300px] | max-w-[200px] |
| Lightbox | Modal с padding | Full-screen |
| Bottom sheet | Не показывается | Slide-up sheet |

---

## 10. Technical Architecture

### 10.1. Upload path
```
Student selects file
  → [Client] validate: type (jpg/png/heic/pdf), size (≤ 10 MB)
  → [Client] generate path: {studentId}/{assignmentId}/threads/{taskOrder}/{uuid}.{ext}
  → [Client] supabase.storage.from('homework-submissions').upload(path, file)
  → [Client] returns storageRef: 'storage://homework-submissions/...'
```

### 10.2. Message persist path
```
[Client] saveThreadMessage(threadId, 'user', text, taskOrder, messageKind, attachmentRefs?)
  → POST /threads/:id/messages { content, role, task_order, message_kind, image_url?, image_urls? }
  → [Backend] INSERT INTO homework_tutor_thread_messages (..., image_url)
```

### 10.3. AI path (answer mode)
```
[Client] checkAnswer(threadId, answer, taskOrder)
  → POST /threads/:id/check { answer, task_order }
  → [Backend] load latest user message with image_url
  → [Backend] resolve storage:// → signed HTTP URL
  → [Backend] evaluateStudentAnswer({ studentAnswer, studentImageUrls, taskImageUrl })
  → [AI] receives multimodal: task image + student images + answer text
```

### 10.4. AI path (question/step mode)
```
[Client] streamChat({ messages, taskImageUrl, studentImageUrls? })
  → POST /functions/v1/chat { messages, taskImageUrl, studentImageUrls? }
  → [Backend] builds multimodal prompt with both images
  → [AI] responds in context of both images
```

---

## 11. File Limits

| Параметр | Значение | Причина |
|----------|----------|---------|
| Max file size | 5 МБ | Защита mobile upload и prompt payload |
| Soft total per message | 15 МБ | Не даём одному сообщению раздувать upload/prompt budget |
| Formats | JPG, JPEG, PNG, HEIC, WebP, PDF | HEIC = iPhone default |
| Max attachments per message | 5 | Multi-page solutions |
| Max student images passed to AI | 5 | Одинаковый лимит в `chat` / `check` / `hint` |
| Storage bucket | `homework-submissions` | Уже существует, RLS настроен |
| Signed URL TTL | 1 час | Consistent with existing URLs |

---

## 12. Acceptance Criteria

### Реализовано
- [x] `POST /threads/:id/messages` принимает `image_url` / `image_urls`
- [x] `saveThreadMessage()` передаёт attachment refs в backend
- [x] Вызовы без `image_url` остаются backward compatible
- [x] `uploadStudentThreadImage()` загружает student image в Storage и возвращает `storage://...` ref
- [x] Upload pipeline использует `getSession()` и Safari-safe ID без `crypto.randomUUID()`
- [x] Guided upload сохраняет fallback на legacy `homework-images` bucket, если `homework-submissions` недоступен
- [x] Backend валидирует student attachment refs по bucket + student-scoped path

### P0 (Must Have)
- [x] Ученик может прикрепить 1-5 изображения/PDF к сообщению в guided chat
- [x] Превью вложения показывается над полем ввода
- [x] Ученик может удалить вложение до отправки
- [x] Вложение отправляется с текстом или без текста
- [x] Изображения отображаются в чате как thumbnail, PDF как file card
- [x] Репетитор видит вложения ученика в GuidedThreadViewer
- [x] Clipboard paste (Ctrl+V) работает на десктопе
- [x] Камера доступна на мобильном через native file picker
- [x] Кнопки send disabled во время загрузки файла
- [x] AI получает фото ученика при проверке ответа
- [x] AI получает фото ученика при обсуждении (question mode)
- [x] AI получает фото ученика при hint mode
- [x] File size > 5 МБ → error toast
- [x] Суммарный размер вложений > 15 МБ → error toast
- [x] Unsupported format → error toast

### P1 (Should Have)
- [ ] Bottom sheet на мобильном (Камера / Галерея / Документ)
- [ ] Drag & Drop на десктопе
- [ ] HEIC → JPG конвертация на клиенте
- [ ] Авто-сжатие > 5 МБ

### P2 (Nice to Have)
- [ ] Progress bar загрузки (determinate %)
- [ ] PDF preview thumbnail
- [ ] Multiple image lightbox (swipe between)

---

## 13. Risks

| Риск | Mitigation |
|------|------------|
| Safari iOS zoom при font-size < 16px на input | Уже 16px в GuidedChatInput |
| HEIC файлы с iPhone не поддерживаются Supabase Storage | P1: конвертация на клиенте. P0: файл загрузится как есть |
| Большие файлы замедляют загрузку | Лимит 10 МБ + будущее сжатие |
| storage:// ref leaked в AI prompt | Резолвить в signed URL на backend (существующий паттерн) |
| Race condition: user sends while upload in progress | Disable send buttons during upload |
| Clipboard paste не работает на mobile Safari | Не критично — есть кнопка 📎 с камерой |
| GuidedHomeworkWorkspace.tsx 1189 строк — сложный | Минимальные изменения: только extend sendUserMessage |

---

## 14. Files Likely to Change

### Frontend
- `src/components/homework/GuidedChatInput.tsx` — основные изменения (UI загрузки)
- `src/components/homework/GuidedHomeworkWorkspace.tsx` — extend sendUserMessage, handleCheckAnswer
- `src/lib/studentHomeworkApi.ts` — новая функция uploadStudentThreadImage + extend saveThreadMessage
- `src/lib/streamChat.ts` — accept optional studentImageUrls

### Backend
- `supabase/functions/homework-api/index.ts` — extend handlePostThreadMessage (accept attachments + validate ownership)
- `supabase/functions/homework-api/guided_ai.ts` — extend evaluateStudentAnswer / generateHint (accept studentImageUrls)

### Не трогаем
- Storage buckets / RLS policy model — используем существующие `homework-submissions` / `homework-images`
- DB schema — `image_url` column уже есть

---

## 15. Self-Check Against Docs

### Doc 16 (UX Principles)
- ✅ П5: AI → действие — AI видит фото → даёт actionable фидбэк
- ✅ П6: Прозрачный статус — upload states чётко показаны
- ✅ П7: Progressive disclosure — bottom sheet раскрывается по клику
- ✅ П12: Надёжность > эффектность — нет анимаций, чистый upload

### Doc 17 (UI Patterns)
- ✅ Не добавляем framer-motion в shared components
- ✅ Используем md: breakpoint для layout
- ✅ iOS font-size ≥ 16px
- ✅ Не создаём новые storage buckets

### Doc 19 (Agent Workflow)
- ✅ Фича привязана к Job C (P0)
- ✅ Усиливает wedge (ДЗ по физике ЕГЭ)
- ✅ Scope ограничен guided chat (не generic)
- ✅ Не расширяет product decisions

### CLAUDE.md
- ✅ Используем существующий `homework-submissions` bucket
- ✅ storage:// → signed URL перед AI
- ✅ Не трогаем high-risk files
- ✅ Student/Tutor module isolation сохранена
