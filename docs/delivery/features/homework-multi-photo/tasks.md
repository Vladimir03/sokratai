# Tasks: Homework Multi-Photo

**Spec:** `docs/delivery/features/homework-multi-photo/spec.md` (v0.2)
**Дата:** 2026-04-14
**Pipeline step:** 5 (TASKS) → 6 (BUILD)

---

## Зависимости и порядок

```
TASK-1 (shared helpers)
   ├─→ TASK-2 (DB migration, parallel)
   │
   ├─→ TASK-3 (HWTaskCard galleries)
   │     └─→ TASK-4 (KB import multi-photo)
   │           └─→ TASK-5 (TutorHomeworkCreate write points)
   │
   ├─→ TASK-6 (backend validation/select)
   │     └─→ TASK-7 (batch signed-URL endpoints)
   │           ├─→ TASK-8 (guided_ai.ts arrays)
   │           │     └─→ TASK-11 (student API resolver)
   │           └─→ TASK-9 (chat/index.ts arrays)
   │                 └─→ TASK-10 (TaskConditionGallery + carousel)
   │
   ├─→ TASK-12 (TutorHomeworkDetail multi-photo)
   ├─→ TASK-13 (GuidedThreadViewer multi-photo)
   └─→ TASK-15 (rules update)

TASK-14 (QA) — после merge всех TASK-3..TASK-13.
```

Параллелится: TASK-1 ↔ TASK-2; TASK-3..5 (frontend) ↔ TASK-6..9 (backend) после TASK-1+TASK-2; TASK-12 ↔ TASK-13.

---

## TASK-1: Shared attachment-refs helpers ✅ Done (2026-04-14)

**Job:** R4-1
**Agent:** Claude Code
**Files:**
- `src/lib/attachmentRefs.ts` (новый)
- `supabase/functions/_shared/attachment-refs.ts` (новый)
- `src/lib/kbApi.ts` (re-export)
**AC:** AC-3, AC-6, AC-7

**Описание:** вынести `parseAttachmentUrls` / `serializeAttachmentUrls` из `src/lib/kbApi.ts:61,90` в доменно-нейтральный `src/lib/attachmentRefs.ts`. Добавить константы `MAX_TASK_IMAGES = 5` и `MAX_RUBRIC_IMAGES = 3`. Создать Deno-клон в `supabase/functions/_shared/attachment-refs.ts` с `MAX_TASK_IMAGES_FOR_AI = 5`. `kbApi.ts` оставить re-export для совместимости KB-кода (нельзя ломать импорты в `src/components/kb/`).

---

## TASK-2: Migration — `rubric_image_urls` column ✅ Done (2026-04-14)

**Job:** R4-2
**Agent:** Claude Code
**Files:**
- `supabase/migrations/20260414120000_homework_rubric_images.sql` (новый)
**AC:** AC-2, AC-3

**Описание:** additive миграция. `ALTER TABLE public.homework_tutor_tasks ADD COLUMN IF NOT EXISTS rubric_image_urls TEXT NULL`. COMMENT-ы на обе колонки (`task_image_url` + `rubric_image_urls`) описывают dual-format и лимиты. Никаких индексов, RLS-изменений, backfill.
**Статус:** выполнено; файл создан: `supabase/migrations/20260414120000_homework_rubric_images.sql`.

---

## TASK-3: HWTaskCard — галереи условия и рубрики ✅ Done (2026-04-14)

**Job:** R4-1, R4-2
**Agent:** Claude Code
**Files:**
- `src/components/tutor/homework-create/HWTaskCard.tsx`
- `src/components/tutor/homework-create/types.ts` (DraftTask shape)
**AC:** AC-1, AC-2, AC-10

**Описание:** галерея условия (горизонтальный ряд миниатюр 80×80 + кнопка `+`, дизейбл на лимите 5). Hover/всегда-на-mobile X для удаления. Блок «Критерии проверки»: textarea + галерея до 3 фото. Lucide `Plus`/`X`. `touch-action: manipulation` на кнопках. `loading="lazy"` на миниатюрах. Использует `parseAttachmentUrls`/`serializeAttachmentUrls` из `@/lib/attachmentRefs` (TASK-1). `DraftTask` получает `rubric_image_paths: string | null` (dual-format).

**Статус выполнения:** `DraftTask.rubric_image_paths` добавлен + JSDoc на `task_image_path`. `HWTaskCard.tsx` полностью переписан: memoized `PhotoThumbnail`/`AddPhotoButton`, общий `PhotoGallery` reused для задачи и рубрики. Blob-URL cleanup через `blobUrlsRef: Set<string>` + `useEffect([])`. Multi-upload через `Promise.all(uploadTutorHomeworkTaskImage)`. Ctrl+V paste appendит в `task_image_path` (не replace). `accept="image/*,.heic,.heif" multiple`.

---

## TASK-4: HWTasksSection — KB-импорт сохраняет до 5 фото ✅ Done (2026-04-14)

**Job:** R4-1
**Agent:** Claude Code
**Files:**
- `src/components/tutor/homework-create/HWTasksSection.tsx`
**AC:** AC-6

**Описание:** в `HWTasksSection.tsx:28` (KB-импорт) вместо `parseAttachmentUrls(task.attachment_url)[0]` использовать `parseAttachmentUrls(task.attachment_url).slice(0, MAX_TASK_IMAGES)`. Сериализовать обратно в dual-format через `serializeAttachmentUrls`. Если у KB-задачи > 5 фото — `toast.info('Из БЗ импортировано 5 из N фото')`. `task_image_path` на DraftTask становится dual-format (single ИЛИ JSON-array string). Не ломать существующий импорт single-фото KB-задач.

**Статус выполнения:** `kbTaskToDraftTask` теперь возвращает `{ draft, truncatedFrom }` вместо голого DraftTask — вызывающий `handleAddFromKB` решает emit'ить toast.info про truncation или нет. `task_image_path` и `kb_attachment_url` заполняются одним `serializeAttachmentUrls(slicedRefs)` (dual-format preserved для провенанса). Snapshot-механика (`kb_snapshot_text`/`answer`/`solution`) не тронута. Signed URL preview резолвится только для первого ref'а (legacy-слот); остальные фото рендерятся галереей из TASK-3. Импорт `parseAttachmentUrls` теперь из `@/lib/attachmentRefs` (не через kbApi re-export).

---

## TASK-5: TutorHomeworkCreate — три точки записи ✅ Done (2026-04-14)

**Job:** R4-1, R4-2
**Agent:** Claude Code
**Files:**
- `src/pages/tutor/TutorHomeworkCreate.tsx`
- `src/lib/tutorHomeworkApi.ts` (type-only sync с TASK-6)
**AC:** AC-1, AC-2, AC-7

**Описание:** актуальные строки на HEAD `e57cada` — `:470, :602, :698`. Pattern сейчас: `task_image_url: t.task_image_path || t.kb_attachment_url || null`. Привести к `task_image_url: t.task_image_path ?? null` (state уже хранит dual-format после TASK-3+4). Добавить `rubric_image_urls: t.rubric_image_paths ?? null` в каждую точку. Существующая логика валидации `validateAll` (TutorHomeworkCreate.tsx:381) не трогается — лимиты проверяет HWTaskCard и backend.

**Статус выполнения:** три pattern-replaces + три новые строки `rubric_image_urls` в `handleSubmit` (POST), save-as-template `tasks_json`, `handleEditSubmit` (PUT). Дополнительно additive-расширение трёх request-интерфейсов (`CreateAssignmentTask`, `UpdateAssignmentTask`, `HomeworkTemplateTask`) в `tutorHomeworkApi.ts` полем `rubric_image_urls?: string | null` — обязательно для compile-safety с TASK-6 backend; все расширения optional, не ломают существующие вызовы.

---

## TASK-6: Backend validation + select

**Job:** R4-1, R4-2
**Agent:** Claude Code
**Files:**
- `supabase/functions/homework-api/index.ts`
**AC:** AC-3, AC-7, AC-8

**Описание:** строки на HEAD `e57cada`:
- `handleCreateAssignment :342` — в task loop (`:418, :439`) добавить dual-format валидацию `task_image_url` count ≤ 5 + `rubric_image_urls` count ≤ 3 через `parseAttachmentUrls` из `_shared/attachment-refs.ts` (TASK-1). Сообщения: `tasks[i].task_image_url exceeds maximum of 5 images` / `tasks[i].rubric_image_urls exceeds maximum of 3 images`.
- `handleUpdateAssignment :848` — задача на `:1064`, добавить ту же валидацию + secondary path `:1098`.
- `handleGetAssignment :672` — включить `rubric_image_urls` в select задач.
- Student-side `getStudentAssignment` — НЕ возвращает `rubric_image_urls` (AC-8 invariant).
- Шаблоны (`handleCreateTemplate :2645`, `handleListTemplates :2596`) — оставить без изменений (шаблоны — отдельный стор, multi-photo для них — parking lot).

---

## TASK-7: Batch signed-URL endpoints

**Job:** S1-2, R4-2
**Agent:** Claude Code
**Files:**
- `supabase/functions/homework-api/index.ts`
- `supabase/functions/homework-api/router.ts` (если есть отдельный, иначе inline в index.ts)
**AC:** AC-4, AC-9

**Описание:** два новых endpoint:
- `GET /assignments/:id/tasks/:taskId/images` — student+tutor; парсит `task_image_url` через `parseAttachmentUrls`, для каждого ref вызывает `db.storage.from('homework-task-images').createSignedUrl(path, 3600)`, возвращает `{ signed_urls: string[] }`.
- `GET /assignments/:id/tasks/:taskId/rubric-images` — tutor-only (403 для student); парсит `rubric_image_urls`; идентичная логика.
- Старый `/image-url` (single) — оставить, для legacy single-photo preview в `TaskImagePreview`.

---

## TASK-8: guided_ai.ts — массивы taskImageUrls + rubricImageUrls

**Job:** R4-2, S1-2
**Agent:** Claude Code
**Files:**
- `supabase/functions/homework-api/guided_ai.ts`
- `supabase/functions/homework-api/index.ts` (call sites `handleCheckAnswer`, `handleRequestHint`)
**AC:** AC-5

**Описание:** изменить контракт:
- `EvaluateStudentAnswerParams.taskImageUrl: string | null` → `taskImageUrls: string[]`.
- Добавить `EvaluateStudentAnswerParams.rubricImageUrls?: string[]` (передаётся только из `handleCheckAnswer`, не из hint).
- `GenerateHintParams.taskImageUrl` → `taskImageUrls: string[]`.
- `inlinePromptImageUrl` вызывается в `Promise.all(refs.map(inlinePromptImageUrl))`.
- Multimodal user content: массив `{ type: 'image_url', image_url: { url } }` объектов + один `{ type: 'text', text: userText }` в конце.
- Promt addition: `buildRubricGuidance(rubricText, hasRubricImages)` — если `rubricImageUrls.length > 0`, инструкция «изображения после rubric_text — это критерии проверки от репетитора».
- Guard `MAX_TASK_IMAGES_FOR_AI = 5` (slice на этом уровне; UI лимит уже 5, это double-protection).

**Статус:** ✅ Done (2026-04-14)

---

## TASK-9: chat/index.ts — taskImageUrls для question + bootstrap

**Job:** S1-2
**Agent:** Claude Code
**Files:**
- `supabase/functions/chat/index.ts`
- `src/components/homework/GuidedHomeworkWorkspace.tsx` (`buildTaskContext`)
**AC:** AC-5

**Описание:** `taskImageUrl: string | null` → `taskImageUrls: string[]` в request body shape. `resolveTaskImageUrlForAI` → `resolveTaskImageUrlsForAI(db, dualFormatValue) → string[]` (парсит через shared helper, резолвит signed URL для каждого ref в `Promise.all`, inline-ит base64). Frontend `buildTaskContext()` в `GuidedHomeworkWorkspace.tsx`: `taskImageUrls = parseAttachmentUrls(task.task_image_url)`. Не трогать `studentImageUrls` — это другой массив (вложения ученика в сообщение).

**Статус:** ✅ Done (2026-04-14)

---

## TASK-10: TaskConditionGallery + fullscreen carousel

**Job:** S1-2
**Agent:** Claude Code
**Files:**
- `src/components/homework/GuidedHomeworkWorkspace.tsx`
**AC:** AC-4, AC-10

**Описание:** заменить `TaskConditionImage` (текущий module-scope компонент `:253-323`) на `TaskConditionGallery`:
- Horizontal row миниатюр (`flex gap-2 overflow-x-auto touch-pan-x`), каждая 120px wide, `max-h-32 object-contain rounded-md border-slate-200`, `loading="lazy"`.
- Клик → Radix `Dialog` с fullscreen carousel: `max-h-[75vh] object-contain` + counter `N/M` + Lucide `ChevronLeft`/`ChevronRight` + swipe-handlers (`touchstart`/`touchend` с порогом 50px).
- Если refs.length === 1 → Dialog без стрелок и без counter (backward compat).
- `key={selectedTask.id}` на компоненте — remount при смене задачи (закрывает Dialog).
- Использует новый batch endpoint из TASK-7 через хук из TASK-11.

---

## TASK-11: studentHomeworkApi — batch signed-URL resolver

**Job:** S1-2
**Agent:** Claude Code
**Files:**
- `src/lib/studentHomeworkApi.ts`
- `src/hooks/useStudentHomework.ts`
**AC:** AC-4

**Описание:** новая функция `getStudentTaskImagesSignedUrlsViaBackend(assignmentId, taskId): Promise<string[]>` — POST/GET в endpoint TASK-7. React Query hook `useStudentTaskImagesSignedUrls(assignmentId, taskId)` с key `['student', 'homework', 'guided-task-images', assignmentId, taskId]`, `staleTime: 50 * 60_000` (signed URL живёт 60 мин). Не удалять старый `getStudentTaskImageSignedUrlViaBackend` (single) — его всё ещё использует attachments-картинки в сообщениях.

---

## TASK-12: TutorHomeworkDetail — multi-photo задачи + рубрика

**Job:** R4-2
**Agent:** Claude Code
**Files:**
- `src/pages/tutor/TutorHomeworkDetail.tsx`
**AC:** AC-7, AC-8 (negative — rubric видна tutor)

**Описание:** `TaskImagePreview` (`:145`) расширить до массива. Принимает `taskImageUrl: string | null`, парсит через `parseAttachmentUrls`, рендерит ряд thumbnails с тем же click-to-zoom Dialog (можно reuse компонент из TASK-10 если вынести в `src/components/homework/shared/`). Новая секция «Критерии проверки» в карточке задачи: `rubric_text` через `MathText` + ряд thumbnails `rubric_image_urls` (через batch endpoint TASK-7 для tutor). Видимость: tutor-only (rubric никогда не утекает в Detail для student).

---

## TASK-13: GuidedThreadViewer — multi-photo task context

**Job:** R4-2
**Agent:** Claude Code
**Files:**
- `src/components/tutor/GuidedThreadViewer.tsx`
**AC:** AC-9

**Описание:** `TaskContextImage` (`:59`) расширить до `TaskContextGallery` — тот же визуал что student-side TaskConditionGallery (TASK-10). Lif logic: парсинг `task.task_image_url` через `parseAttachmentUrls`, batch resolver query с key `['tutor', 'homework', 'task-images-preview', assignmentId, taskId]` (другой prefix чем student, отдельный cache scope). Reuse fullscreen carousel компонент из TASK-10.

---

## TASK-14: QA — все 10 AC на 3 платформах

**Job:** все
**Agent:** human (Vladimir) + Claude Code (smoke)
**Files:** —
**AC:** AC-1..AC-10

**Описание:** прогнать AC-1..AC-10 на:
- Chrome desktop (Windows)
- iOS Safari (iPhone)
- Android Chrome
Особо проверить AC-7 (backward compat) на реальной legacy-задаче с single `task_image_url` ref. Особо проверить AC-10 (swipe vs onClick) на iPhone Safari — нет блокировки horizontal swipe от tap-handler-а на миниатюре. `npm run lint && npm run build && npm run smoke-check` локально.

---

## TASK-15: CLAUDE.md rules update

**Job:** —
**Agent:** Claude Code
**Files:**
- `.claude/rules/40-homework-system.md`
**AC:** —

**Описание:** в секции «Передача изображений задач в AI» заменить `taskImageUrl: string | null` на `taskImageUrls: string[]`. Добавить упоминание `rubricImageUrls?: string[]` для check path. Зафиксировать dual-format invariant: «`task_image_url` колонка хранит single ref ИЛИ JSON-array; всегда читать через `parseAttachmentUrls` из `@/lib/attachmentRefs`». Лимиты `MAX_TASK_IMAGES = 5`, `MAX_RUBRIC_IMAGES = 3`. Backward compat note: миграции данных нет.

---

## Acceptance Criteria — мэппинг к TASK

| AC | Описание | Закрывают TASK |
|---|---|---|
| AC-1 | конструктор: 5 фото условия, кнопка `+` дизейблится на лимите | TASK-3, TASK-5 |
| AC-2 | конструктор: 3 фото рубрики, кнопка `+` дизейблится на лимите | TASK-3, TASK-5 |
| AC-3 | backend 400 при array > 5 / > 3 | TASK-1, TASK-2, TASK-6 |
| AC-4 | student galley + Dialog со стрелками + swipe | TASK-7, TASK-10, TASK-11 |
| AC-5 | AI получает массив image_url блоков, feedback использует данные с фото | TASK-8, TASK-9 |
| AC-6 | KB-импорт сохраняет ≤ 5 фото с toast при срезании | TASK-1, TASK-4 |
| AC-7 | legacy single-ref продолжает работать end-to-end | TASK-1, TASK-5, TASK-6 |
| AC-8 | `getStudentAssignment` не возвращает `rubric_image_urls` | TASK-6 |
| AC-9 | tutor `GuidedThreadViewer` показывает все фото задачи | TASK-7, TASK-13 |
| AC-10 | iOS swipe не триггерит onClick миниатюры | TASK-3, TASK-10 |

---

# Copy-paste промпты для агентов

> Каждый блок ниже = self-contained промпт. Копируется целиком в чистую сессию Claude Code (или Codex для review-passes). Внутри блока `---` отделяет prompt body от mandatory end block.

## TASK-1: shared attachment-refs helpers

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: SokratAI — AI-помощник репетитора (B2B-1: репетитор физики ЕГЭ/ОГЭ, hourly rate 3000-4000₽; B2C-1: школьник 16-18, готовится к экзамену). Wedge — homework assembly за 5-10 минут. AI = draft + action, не chat-only.

Канонические доки (читай в этом порядке):
1. CLAUDE.md
2. .claude/rules/40-homework-system.md
3. .claude/rules/50-kb-module.md (там же живут существующие parseAttachmentUrls / serializeAttachmentUrls)
4. docs/delivery/features/homework-multi-photo/spec.md (целиком, особенно §3 «Ключевые решения» п.2-3 и §5 «Технический дизайн → Shared helpers»)

Задача (TASK-1 из tasks.md):

1. Создать `src/lib/attachmentRefs.ts`:
   - Перенести функции `parseAttachmentUrls(value: string | null | undefined): string[]` и `serializeAttachmentUrls(refs: string[]): string | null` из `src/lib/kbApi.ts:61-94`. Оставить точно ту же логику (single ref ИЛИ JSON-array, malformed JSON → fallback на single).
   - Экспортировать константы `MAX_TASK_IMAGES = 5` и `MAX_RUBRIC_IMAGES = 3`.
   - JSDoc-комментарии — сохранить + добавить ссылку на `homework-multi-photo` спеку.

2. В `src/lib/kbApi.ts` оставить **re-export** из нового модуля:
   `export { parseAttachmentUrls, serializeAttachmentUrls } from './attachmentRefs';`
   Никаких других изменений в kbApi.ts. Это нужно, чтобы не ломать импорты в `src/components/kb/`.

3. Создать `supabase/functions/_shared/attachment-refs.ts`:
   - Deno-runtime клон тех же функций (без зависимостей, чистый TS).
   - Те же константы + дополнительно `export const MAX_TASK_IMAGES_FOR_AI = 5;`
   - Edge functions не могут импортировать `src/lib/*`, поэтому это сознательная дубликация.

Acceptance Criteria (Given/When/Then):
- AC-3: Given backend validation; When request body содержит `task_image_url` = JSON.stringify(массив длины 6); Then 400 VALIDATION (TASK-6 будет использовать parseAttachmentUrls из этого модуля).
- AC-6: Given KB-импорт; When task.attachment_url содержит JSON-array длины 4; Then `parseAttachmentUrls(value).slice(0, MAX_TASK_IMAGES)` возвращает 4 элемента (TASK-4).
- AC-7: Given legacy single-ref; When `parseAttachmentUrls("storage://path")`; Then возвращает `["storage://path"]`.

Guardrails:
- НЕ менять сигнатуры функций — иначе сломаешь kbApi consumer'ов.
- НЕ удалять функции из kbApi.ts — re-export обязателен.
- НЕ добавлять зависимости (zod, lodash и т.д.) — функции должны быть zero-dep.
- Edge function helper не может импортировать ничего из `src/`.

Mandatory end block:
- Список изменённых/созданных файлов.
- Краткое summary что сделано (2-3 строки).
- Команды валидации: `npm run lint && npm run build && npm run smoke-check` — запусти и приложи tail вывода (только релевантные строки, не весь лог).
- Self-check против `.claude/rules/40-homework-system.md`: подтверди что dual-format invariant сохранён.
- Нужно ли что-то обновить в `.claude/rules/50-kb-module.md`? (Обычно нет, т.к. KB-flow не меняется.)
```

---

## TASK-2: rubric_image_urls migration

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: расширяем критерии проверки в ДЗ — добавляем фото к rubric_text (до 3). Существующие колонки не трогаем, миграция additive с нулевым риском для prod.

Канонические доки:
1. CLAUDE.md
2. .claude/rules/40-homework-system.md (секция «Таблицы БД»)
3. docs/delivery/features/homework-multi-photo/spec.md §5 «Data Model»

Задача (TASK-2):

Создать миграцию `supabase/migrations/20260414120000_homework_rubric_images.sql`:

ALTER TABLE public.homework_tutor_tasks
  ADD COLUMN IF NOT EXISTS rubric_image_urls TEXT NULL;

COMMENT ON COLUMN public.homework_tutor_tasks.rubric_image_urls IS
  'Storage refs для фото критериев проверки. Dual-format: single "storage://..." ref ИЛИ JSON-array. Лимит 3. NULL = нет фото. Видимость: только репетитор.';

COMMENT ON COLUMN public.homework_tutor_tasks.task_image_url IS
  'Storage refs для фото условия задачи. Dual-format: single "storage://..." ref (legacy + когда одно фото) ИЛИ JSON-array "[...]". Лимит 5. Используй parseAttachmentUrls / serializeAttachmentUrls.';

Acceptance Criteria:
- AC-2: Given репетитор добавил 2 фото к рубрике; When PUT /assignments/:id; Then записывается dual-format в rubric_image_urls (TASK-6 закроет валидацию).
- AC-3: Given колонка существует; When SELECT на legacy задаче; Then rubric_image_urls = NULL без ошибок.

Guardrails:
- Только additive — никаких ALTER, DROP, RENAME существующих колонок.
- Никаких индексов, RLS-политик, триггеров.
- Никакого data backfill.
- IF NOT EXISTS обязательно — миграция должна быть идемпотентной.
- Имя файла строго `20260414120000_homework_rubric_images.sql` (timestamp = старт спринта).

Mandatory end block:
- Файл миграции.
- Подтверждение что migrations folder ничего другого не сломает (`ls supabase/migrations/ | tail -5` — последние 5 миграций).
- Команды валидации: миграция применяется через Supabase CLI или Lovable auto-apply; локально smoke-check НЕ затрагивает БД.
- Self-check: подтверди что нет конфликта timestamp с другими файлами в supabase/migrations/.
```

---

## TASK-3: HWTaskCard galleries

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: репетитор собирает ДЗ из 5-10 задач за < 5 минут. Сейчас в HWTaskCard одна картинка на задачу — для физики ЕГЭ это блокер (часто нужны 2-3 фото). Расширяем до 5 на условие + 3 на рубрику.

Канонические доки:
1. CLAUDE.md
2. .claude/rules/40-homework-system.md (Task identity, dual-format invariant)
3. .claude/rules/80-cross-browser.md (touch-action, iOS Safari)
4. .claude/rules/90-design-system.md (Lucide иконки, no emoji)
5. .claude/rules/performance.md (React.memo для list items, loading="lazy")
6. docs/delivery/features/homework-multi-photo/spec.md §3 «UI конструктора» + §6 «Wireframe → карточка задачи»

Зависимость: TASK-1 (`@/lib/attachmentRefs`) уже смержен.

Задача (TASK-3):

1. `src/components/tutor/homework-create/types.ts`:
   - Добавить в `DraftTask`: `rubric_image_paths: string | null;` (dual-format string, как `task_image_path`).
   - Дополнить JSDoc на `task_image_path`: «dual-format — single storage ref ИЛИ JSON-array через @/lib/attachmentRefs».
   - `createEmptyTask()` инициализирует `rubric_image_paths: null`.

2. `src/components/tutor/homework-create/HWTaskCard.tsx` — галерея условия (под `task_text` textarea):
   - Заголовок «Фото условия (до 5)» (text-sm font-medium).
   - Парсинг текущего state: `const refs = parseAttachmentUrls(task.task_image_path);`
   - Горизонтальный ряд миниатюр 80×80 (`flex gap-2 flex-wrap`), каждая = `<img loading="lazy" className="w-20 h-20 object-cover rounded-md border border-slate-200">`.
   - На каждой миниатюре: hover-X (24×24) для удаления (Lucide `X`, `aria-label="Удалить фото N"`, `touch-action: manipulation`); на mobile (`md:opacity-0 md:group-hover:opacity-100`) — всегда видна на mobile через breakpoint inverse.
   - Кнопка «+ Добавить фото» (Lucide `Plus` + текст): `disabled={refs.length >= MAX_TASK_IMAGES}` + `aria-disabled` + `title="Максимум 5 фото"`. Triggers `<input type="file" accept="image/*,.heic,.heif" multiple>` (multiple позволяет сразу несколько).
   - При добавлении: для каждого file → upload через существующий helper (используй тот же что был для single — найди по grep `uploadHomeworkTaskImage`). Если суммарно после добавления > 5 → срезать + toast `'Можно прикрепить максимум 5 фото'`.
   - После upload: `serializeAttachmentUrls([...refs, ...newRefs].slice(0, 5))` → `onChange({ ...task, task_image_path: serialized })`.

3. Блок «Критерии проверки» (под `correct_answer` + `max_score` row):
   - Сохраняем существующий textarea `rubric_text`.
   - Под textarea — заголовок «Фото критериев (до 3)» + галерея + кнопка `+` (полная копия логики условия с лимитом 3 и `rubric_image_paths` как target field).

4. Paste (Ctrl+V) на `task_text` textarea:
   - Если уже работает — оставить, но направить вложение в `task_image_path` slot (если refs.length < 5).
   - Если не работает — НЕ добавлять в этой задаче (parking lot).

Acceptance Criteria:
- AC-1: Given свежая задача; When репетитор добавляет 5 фото; Then миниатюры все видны, кнопка `+` дизейблится с aria-disabled и title.
- AC-2: Given свежая задача; When репетитор добавляет 3 фото к рубрике; Then кнопка `+` рубрики дизейблится.
- AC-10: Given галерея на iPhone Safari; When swipe горизонтально; Then onClick миниатюры НЕ триггерится (`touch-action: manipulation` на кнопках, не на ряду; ряд получает `touch-action: pan-x`).

Guardrails:
- НЕ добавлять reorder (drag-handles) — это parking lot для P1.
- НЕ менять sig `DraftTask.task_image_path` (остаётся `string | null`, семантика расширяется).
- НЕ использовать emoji в UI — только Lucide.
- НЕ забыть `loading="lazy"` на каждой `<img>`.
- НЕ использовать framer-motion — только CSS transitions (см. .claude/rules/performance.md).
- НЕ ломать existing single-photo legacy upload flow (если у task уже есть `task_image_path = "storage://x"` — он должен показаться как 1 миниатюра).
- React.memo на новых sub-компонентах (PhotoThumbnail, AddPhotoButton).

Mandatory end block:
- Список изменённых файлов с указанием новых строк (или ссылок на старые места).
- Скриншоты не нужны (нет dev-сервера в этом промпте), но опиши визуальный layout словами.
- Команды валидации: `npm run lint && npm run build && npm run smoke-check` + tail.
- Self-check против docs 16/17 (UX-принципы, UI-паттерны): прогрессивное раскрытие соблюдено? bg-accent на secondary CTA? Lucide вместо emoji?
```

---

## TASK-4: HWTasksSection — KB-импорт multi-photo

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: KB-задачи могут иметь 2-3 фото в attachment_url (JSON-array). Сейчас при импорте берём только первое — теряется контекст. Нужно сохранять до 5.

Канонические доки:
1. CLAUDE.md
2. .claude/rules/40-homework-system.md, .claude/rules/50-kb-module.md
3. docs/delivery/features/homework-multi-photo/spec.md §3 «KB-импорт»

Зависимость: TASK-1 (`@/lib/attachmentRefs`) смержен.

Задача (TASK-4):

1. `src/components/tutor/homework-create/HWTasksSection.tsx:28` (или поищи функцию `kbTaskToDraftTask` / места конвертации KB → DraftTask):
   - Текущий код берёт `parseAttachmentUrls(task.attachment_url)[0]`.
   - Заменить на:
     const refs = parseAttachmentUrls(task.attachment_url);
     const slicedRefs = refs.slice(0, MAX_TASK_IMAGES);
     const taskImagePath = serializeAttachmentUrls(slicedRefs);
     // ...
     task_image_path: taskImagePath,
     kb_attachment_url: serializeAttachmentUrls(slicedRefs), // для провенанса
   - Если `refs.length > MAX_TASK_IMAGES` → `toast.info('Из БЗ импортировано 5 из ${refs.length} фото')` (использует sonner).

2. Если `kbTaskToDraftTask` живёт в `src/components/tutor/KBPickerSheet.tsx` (см. `.claude/rules/50-kb-module.md` секция «Интеграция KB → конструктор ДЗ») — обнови ИМЕННО там, не в HWTasksSection.

Acceptance Criteria:
- AC-6: Given KB-задача с `attachment_url = JSON.stringify([ref1, ref2, ref3, ref4])`; When добавил в DraftTask через KBPickerSheet; Then в DraftTask попадают все 4 ref'а; UI показывает 4 миниатюры.
- AC-6 (срезание): Given KB-задача с 7 фото; When добавил; Then DraftTask содержит 5 фото + toast `'Из БЗ импортировано 5 из 7 фото'`.

Guardrails:
- НЕ менять формат kb_attachment_url на DraftTask (остаётся `string | null` — dual-format).
- НЕ ломать существующий single-photo KB-импорт (legacy задачи в БЗ продолжают работать).
- toast — sonner `toast.info`, не нативный alert (правило из 40-homework-system.md MaterialsList).

Mandatory end block:
- Изменённые файлы.
- Команды валидации.
- Self-check: snapshot-механика KB не нарушена (kb_snapshot_text/answer/solution не трогаем).
```

---

## TASK-5: TutorHomeworkCreate — три точки записи

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: state DraftTask после TASK-3 уже хранит dual-format в task_image_path и rubric_image_paths. Нужно прокинуть это в API request body в трёх местах создания/обновления ДЗ.

Канонические доки:
1. CLAUDE.md
2. .claude/rules/40-homework-system.md
3. docs/delivery/features/homework-multi-photo/spec.md §5 «Конструктор → TutorHomeworkCreate»

Зависимость: TASK-3 (DraftTask shape) + TASK-6 (backend готов принять dual-format).

Задача (TASK-5):

В `src/pages/tutor/TutorHomeworkCreate.tsx` есть три точки записи task в API body. Актуальные строки на HEAD `e57cada`:
- :470 (handleSubmit → POST /assignments)
- :602 (edit-mode update → PUT /assignments/:id)
- :698 (secondary path)

В каждой:
- Текущий pattern: `task_image_url: t.task_image_path || t.kb_attachment_url || null,`
- Новый pattern: `task_image_url: t.task_image_path ?? null,` (state уже хранит dual-format после TASK-3+4; kb_attachment_url использовался как fallback, теперь slice/serialize в TASK-4 уже положил всё в task_image_path).
- Добавить рядом: `rubric_image_urls: t.rubric_image_paths ?? null,`

Verify через grep что `rubric_text` уже передаётся в body (он передаётся — оставить как есть).

Acceptance Criteria:
- AC-1, AC-2: end-to-end create ДЗ с 5 фото условия + 3 фото рубрики → backend получает dual-format в обоих полях.
- AC-7: legacy single-photo задача при edit (PUT) сохраняется без потери ref'а.

Guardrails:
- НЕ трогать validateAll (TutorHomeworkCreate.tsx:381) — лимиты проверяет HWTaskCard и backend.
- НЕ переименовывать meta поля или topic (subjects-flow зафиксирован в e57cada).
- НЕ менять exam_type write — это отдельная фича.
- High-risk файл TutorHomeworkCreate.tsx — изменения должны быть точечными (только три pattern-replaces + один add).

Mandatory end block:
- Diff с тремя точками + новой строкой rubric_image_urls.
- Команды валидации.
- Self-check: state shape DraftTask не сломан, существующие тесты smoke-check проходят.
```

---

## TASK-6: backend validation + GET include rubric

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: backend сейчас принимает task_image_url как scalar string. Нужна dual-format валидация count ≤ 5 / ≤ 3, новая колонка rubric_image_urls в SELECT, защита tutor-only видимости рубрики.

Канонические доки:
1. CLAUDE.md
2. .claude/rules/40-homework-system.md
3. docs/delivery/features/homework-multi-photo/spec.md §3 «Solution → AI-пайплайн → Guard», §5 «Backend»

Зависимость: TASK-1 (`supabase/functions/_shared/attachment-refs.ts`) + TASK-2 (миграция применена).

Задача (TASK-6):

В `supabase/functions/homework-api/index.ts` (line numbers — HEAD `e57cada`):

1. `handleCreateAssignment :342`:
   - В task validation loop (около строк :418, :439): после `isNonEmptyString(t.task_image_url)` парсить через `parseAttachmentUrls(t.task_image_url)`, проверить length ≤ MAX_TASK_IMAGES. Если > 5 → `jsonError(cors, 400, "VALIDATION", \`tasks[\${i}].task_image_url exceeds maximum of 5 images\`)`.
   - Аналогично для optional `t.rubric_image_urls`: парсить, length ≤ MAX_RUBRIC_IMAGES (3). Если > 3 → 400.
   - В `.insert(...)` task — добавить `rubric_image_urls: t.rubric_image_urls ?? null`.

2. `handleUpdateAssignment :848` (task write на :1064):
   - Та же валидация.
   - В update payload — `rubric_image_urls`.

3. Secondary path :1098 — то же.

4. `handleGetAssignment :672`:
   - В `db.from('homework_tutor_tasks').select(...)` добавить `rubric_image_urls`.
   - Возвращать как есть (frontend tutor-side парсит).
   - Student-side `getStudentAssignment` (поищи отдельно — другой handler/endpoint) — НЕ возвращает `rubric_image_urls` в response. Если SELECT включает поле — фильтровать перед возвратом.

5. Шаблоны (`handleCreateTemplate :2645`, `handleListTemplates :2596`) — НЕ ТРОГАТЬ. Multi-photo для шаблонов — parking lot.

Acceptance Criteria:
- AC-3: Given POST /assignments с task_image_url = JSON.stringify(массив длины 6); Then 400 VALIDATION с сообщением про maximum of 5.
- AC-7: Given POST с task_image_url = "storage://x" (single string); Then 201, в БД сохраняется как есть.
- AC-8: Given student вызывает getStudentAssignment; When response парсится; Then в response.tasks[i] нет ключа rubric_image_urls.

Guardrails:
- Импорт из `_shared/attachment-refs.ts` (Deno path), не из `src/lib/`.
- НЕ менять текущую логику validateAll для других полей.
- НЕ ломать backward compat: legacy single-string ref валиден (parseAttachmentUrls вернёт массив длины 1).
- High-risk файл — точечные правки.

Mandatory end block:
- Diff по index.ts с указанием строк.
- Краткое summary (что изменилось в каждом из 4 handlers).
- Команды валидации: lint + build (smoke-check не тестит edge function).
- Self-check: AC-8 проверяется тем, что rubric_image_urls в student SELECT не присутствует ИЛИ фильтруется явно.
```

---

## TASK-7: batch signed-URL endpoints

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: задача может иметь до 5 фото. На student-side при открытии задачи нужны все signed URL за один HTTP-запрос (не N круглоедок). Tutor-side нужен отдельный endpoint для рубрики (с проверкой роли).

Канонические доки:
1. CLAUDE.md
2. .claude/rules/40-homework-system.md (секция «Передача изображений задач в AI» — оригинальный single endpoint)
3. docs/delivery/features/homework-multi-photo/spec.md §5 «API»

Зависимость: TASK-1 (shared helper в _shared/) + TASK-2 (rubric_image_urls колонка).

Задача (TASK-7):

В `supabase/functions/homework-api/index.ts` добавить два новых endpoint:

1. `GET /assignments/:id/tasks/:taskId/images`:
   - Аутентификация: student ИЛИ tutor (через существующие helpers `requireUser` / `getStudentAssignmentOrNull` / `getOwnedAssignmentOrThrow`).
   - SELECT `task_image_url` из `homework_tutor_tasks WHERE id = :taskId AND assignment_id = :id`.
   - `parseAttachmentUrls(value)` → string[] refs.
   - Для каждого ref конвертить `storage://homework-task-images/path` → path, вызвать `db.storage.from('homework-task-images').createSignedUrl(path, 3600)` в Promise.all.
   - Response: `{ signed_urls: string[] }` (порядок сохраняется).
   - 404 если задачи нет; 200 + `{ signed_urls: [] }` если поле NULL.

2. `GET /assignments/:id/tasks/:taskId/rubric-images`:
   - Аутентификация: ТОЛЬКО tutor (через `getOwnedAssignmentOrThrow`). Student → 403.
   - SELECT `rubric_image_urls`.
   - Та же логика с parseAttachmentUrls + createSignedUrl.

3. Старый `GET /assignments/:id/tasks/:taskId/image-url` (single) — НЕ ТРОГАТЬ. Используется в `TaskImagePreview` (TutorHomeworkDetail) для legacy single-photo preview.

4. Routing: добавить новые routes в существующий switch/router (поищи `assignments/.+/tasks/.+/image-url` — рядом).

Acceptance Criteria:
- AC-4: Given задача с 3 фото; When student вызывает GET .../images; Then response.signed_urls.length === 3, каждый — валидный signed URL.
- AC-9: Given tutor открыл viewer; When GET .../images; Then 200 с массивом.
- AC-8: Given student; When GET .../rubric-images; Then 403.

Guardrails:
- НЕ открывать rubric-images student-у даже через косвенные пути.
- Storage path parsing: `storage://homework-task-images/x/y/z.png` → bucket `homework-task-images`, path `x/y/z.png` (учти что некоторые refs в legacy могут быть просто `path` без `storage://` префикса — обработай оба).
- Логирование как в существующих endpoints (`console.log('homework_api_request_success', { route, ... })`).

Mandatory end block:
- Diff index.ts.
- Список новых routes + краткое summary auth-gates.
- Команды валидации.
- Self-check: AC-8 invariant — rubric-images route guard'ится через owner check, не просто JWT-presence.
```

---

## TASK-8: guided_ai.ts — массивы taskImageUrls / rubricImageUrls

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: critical AI-pipeline change. Все 4 пути к AI (answer, hint, question, bootstrap) сейчас принимают `taskImageUrl: string | null`. Расширяем до массива. Дополнительно — rubric images передаём только в `evaluateStudentAnswer` (check path), не в hint.

Канонические доки:
1. CLAUDE.md
2. .claude/rules/40-homework-system.md (секция «Передача изображений задач в AI» — КРИТИЧНО)
3. .claude/rules/40-homework-system.md (Hint quality — FORBIDDEN_HINT_PHRASES + retry-once + fallback)
4. docs/delivery/features/homework-multi-photo/spec.md §3 «Solution → AI-пайплайн», §8 Q3 (rubric_image_urls попадают в check)

Зависимость: TASK-1 (helper) + TASK-7 (signed URL resolver path в backend).

Задача (TASK-8):

1. `supabase/functions/homework-api/guided_ai.ts`:
   - `EvaluateStudentAnswerParams.taskImageUrl: string | null` → `taskImageUrls: string[]` (всегда массив, пустой = нет фото).
   - Добавить `EvaluateStudentAnswerParams.rubricImageUrls?: string[]`.
   - `GenerateHintParams.taskImageUrl` → `taskImageUrls: string[]` (rubric — не передаём).
   - В `evaluateStudentAnswer` и `generateHint`:
     - `inlinePromptImageUrl` вызывается в `Promise.all(taskImageUrls.slice(0, MAX_TASK_IMAGES_FOR_AI).map(inlinePromptImageUrl))` → array of inlined data URLs.
     - Multimodal user content собирается как массив:
       const content = [
         ...inlinedTaskUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
         ...(inlinedRubricUrls ?? []).map((url) => ({ type: 'image_url', image_url: { url } })),
         { type: 'text', text: userText },
       ];
   - Promt addition: добавить `buildRubricGuidance(rubricText: string | null, hasRubricImages: boolean)` — если `hasRubricImages`, инструкция «изображения после rubric_text — критерии проверки от репетитора, проверяй по ним».
   - НЕ трогать `validateHintContent` / `FORBIDDEN_HINT_PHRASES` / retry-once flow — invariant из 40-homework-system.md.

2. `supabase/functions/homework-api/index.ts` — call sites:
   - `handleCheckAnswer`: после SELECT задачи, парсить `parseAttachmentUrls(task.task_image_url)` → resolve каждый через `resolveTaskImageUrlForAI` (signed + inline) в Promise.all → передать как `taskImageUrls`. Аналогично для `task.rubric_image_urls` → `rubricImageUrls`.
   - `handleRequestHint`: то же для taskImageUrls; rubricImageUrls НЕ передаём.

3. Если `resolveTaskImageUrlForAI` сейчас принимает single string — обернуть в `resolveTaskImageUrlsForAI(db, dualFormat: string | null) → string[]` (parseAttachmentUrls + Promise.all + inline).

Acceptance Criteria:
- AC-5: Given задача с 2 фото; When student отправляет ответ; Then в Lovable request multimodal content = [{type:'image_url',...}, {type:'image_url',...}, {type:'text',...}]; AI feedback использует данные с фото.
- AC-7: Given задача с 1 фото (legacy); When check; Then content имеет 1 image_url block, ничего не сломано.

Guardrails:
- НЕ ломать FORBIDDEN_HINT_PHRASES validator + retry-once + fallback (`.claude/rules/40-homework-system.md` Hint quality).
- НЕ передавать `rubricImageUrls` в `generateHint` — это leakage критериев в подсказку.
- `MAX_TASK_IMAGES_FOR_AI = 5` slice как guard от inflated arrays (UI лимит уже 5, double-protection).
- НЕ убирать существующий deterministic fast path (`tryDeterministicShortAnswerMatch`) — он работает до AI и не зависит от изображений.

Mandatory end block:
- Diff guided_ai.ts + index.ts (call sites).
- Краткое summary новых параметров.
- Команды валидации (lint + build).
- Self-check: подтверди что `MAX_TASK_IMAGES_FOR_AI` slice применяется ВО ВСЕХ путях; что rubric не утекает в hint.
```

---

## TASK-9: chat/index.ts — taskImageUrls для question + bootstrap

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: пути `question` и `bootstrap` ходят через streamChat в `supabase/functions/chat/index.ts`, не через homework-api. Нужно расширить body shape до массива и frontend buildTaskContext тоже передаёт массив.

Канонические доки:
1. CLAUDE.md
2. .claude/rules/40-homework-system.md (4 пути к AI)
3. docs/delivery/features/homework-multi-photo/spec.md §3 «AI-пайплайн → chat/index.ts»

Зависимость: TASK-1 (shared helper) + TASK-8 (guided_ai готов).

Задача (TASK-9):

1. `supabase/functions/chat/index.ts`:
   - В body shape: `taskImageUrl: string | null` → `taskImageUrls: string[]` (опциональный, default []).
   - Если есть существующий `resolveTaskImageUrlForAI(db, value: string | null)` → переименовать в `resolveTaskImageUrlsForAI(db, dualFormatValue: string | null): Promise<string[]>` (парсит, signed URL + inline в Promise.all).
   - Multimodal содержимое собирается так же как в TASK-8 (массив image_url объектов + текст в конце).
   - Sanity guard: `taskImageUrls.slice(0, 5)` перед resolve.

2. `src/components/homework/GuidedHomeworkWorkspace.tsx` → функция `buildTaskContext()` (поищи по grep `buildTaskContext\|taskImageUrl`):
   - Сейчас она вычисляет `taskImageUrl = task.task_image_url`.
   - Заменить на `taskImageUrls = parseAttachmentUrls(task.task_image_url)` (импорт из `@/lib/attachmentRefs`).
   - В streamChat-call body: `taskImageUrls` вместо `taskImageUrl`.

3. НЕ трогать `studentImageUrls` — это другой массив (вложения ученика в сообщение, отдельный flow).

Acceptance Criteria:
- AC-5: Given question-режим в guided chat; When student задаёт вопрос; Then chat/index.ts получает body.taskImageUrls = [...refs], multimodal content имеет N image_url blocks.
- AC-7: Given legacy single-ref task; When question; Then taskImageUrls = ["storage://..."], multimodal содержит 1 block.

Guardrails:
- НЕ ломать существующий response stream (SSE / streaming) format.
- НЕ менять `MAX_MESSAGE_LENGTH`, `mergeConsecutiveUserMessages` и Telegram path в chat/index.ts — это другой scope.
- НЕ трогать `responseProfile: 'telegram_compact'` — Telegram-формат не зависит от количества картинок.

Mandatory end block:
- Diff chat/index.ts + GuidedHomeworkWorkspace.tsx.
- Краткое summary contract changes.
- Команды валидации.
- Self-check: подтверди что bootstrap path (NOT student image — только task) тоже использует массив.
```

---

## TASK-10: TaskConditionGallery + fullscreen carousel

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: ученик сейчас видит одну миниатюру в collapsible «Условие задачи». При 3+ фото нужна галерея с fullscreen-каруселью (свайп на mobile, стрелки на desktop).

Канонические доки:
1. CLAUDE.md
2. .claude/rules/40-homework-system.md (Е8 — collapsible task context invariants)
3. .claude/rules/80-cross-browser.md (touch-action: pan-x, iOS Safari swipe handling)
4. .claude/rules/90-design-system.md (Lucide иконки, no emoji, radius 12px для Dialog)
5. .claude/rules/performance.md (loading="lazy", React.memo)
6. docs/delivery/features/homework-multi-photo/spec.md §3 «UI student guided chat», §6 «Wireframe → fullscreen carousel»

Зависимость: TASK-7 (batch endpoint) + TASK-11 (React Query hook).

Задача (TASK-10):

В `src/components/homework/GuidedHomeworkWorkspace.tsx`, текущий компонент `TaskConditionImage` (`:253-323`):

1. Переименовать в `TaskConditionGallery`. Props: `{ assignmentId: string; taskId: string; taskImageUrl: string | null }`.

2. Парсинг: `const refs = parseAttachmentUrls(taskImageUrl);` (из `@/lib/attachmentRefs`).

3. Если refs.length === 0 → `return null` (нет фото).

4. Хук из TASK-11: `const { data: signedUrls = [] } = useStudentTaskImagesSignedUrls(assignmentId, taskId, { enabled: refs.length > 0 });`

5. UI:
   - Horizontal row: `<div className="flex gap-2 overflow-x-auto touch-pan-x">` — каждая миниатюра 120px wide, `<img loading="lazy" className="w-30 h-32 object-contain rounded-md border border-slate-200">` (используй tailwind w-[120px]).
   - Click на миниатюре → `setOpenIndex(i)` → Radix Dialog opens на этом index.

6. Fullscreen Dialog:
   - `<Dialog open={openIndex !== null}>...</Dialog>`.
   - Внутри: full image `max-h-[75vh] object-contain mx-auto`.
   - Если refs.length > 1: counter `"{openIndex+1}/{refs.length}"` в правом верхнем углу + Lucide `ChevronLeft` слева + `ChevronRight` справа.
   - Если refs.length === 1: без counter, без стрелок (backward compat AC-7).
   - Swipe handlers: `onTouchStart` + `onTouchEnd` с порогом 50px (deltaX). Свайп влево → `setOpenIndex(i+1)`, вправо → `setOpenIndex(i-1)`. Loop НЕ нужен (граничные стрелки `disabled`).
   - Keyboard: ArrowLeft/ArrowRight на window listener while Dialog open.
   - Close: Lucide `X` правый верх + Esc.

7. `key={selectedTask.id}` на компоненте — remount при смене задачи закрывает Dialog.

8. React.memo на TaskConditionGallery + sub-компоненты (Thumbnail, FullscreenImage).

Acceptance Criteria:
- AC-4: Given задача с 3 фото; When ученик кликает 2-ю миниатюру; Then Dialog открыт, counter = "2/3"; swipe влево на iPhone → "3/3"; стрелка ← на desktop → "2/3".
- AC-7: Given задача с 1 фото; When клик; Then Dialog без стрелок и без counter.
- AC-10: Given галерея на iPhone Safari; When horizontal swipe по ряду миниатюр; Then onClick миниатюры НЕ срабатывает (touch-pan-x на ряду + tap в Dialog имеет 50ms threshold).

Guardrails:
- НЕ использовать swipe-библиотеки (react-swipeable, etc.) — handlers вручную, как описано.
- НЕ ломать Е8 collapsible behavior в task context.
- НЕ удалять fallback на 1-фото — backward compat обязателен.
- React.memo обязательно (в треде до 50 задач × 5 фото = 250 миниатюр потенциально).
- НЕ забыть `aria-label` на стрелках, на close X, на каждой миниатюре («Открыть фото N во весь экран»).

Mandatory end block:
- Diff GuidedHomeworkWorkspace.tsx.
- Описание UX flow словами.
- Команды валидации.
- Self-check против design-system: bg-accent НЕ используется на close X (это ghost), Lucide вместо emoji, radius 12px (rounded-xl) на Dialog.
```

---

## TASK-11: studentHomeworkApi — batch signed-URL resolver

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: новый batch endpoint из TASK-7 нужно обернуть в API helper + React Query hook.

Канонические доки:
1. CLAUDE.md
2. .claude/rules/40-homework-system.md
3. docs/delivery/features/homework-multi-photo/spec.md §5 «studentHomeworkApi»

Зависимость: TASK-7 (endpoint существует).

Задача (TASK-11):

1. `src/lib/studentHomeworkApi.ts`:
   - Новая функция `getStudentTaskImagesSignedUrlsViaBackend(assignmentId: string, taskId: string): Promise<string[]>` — fetch GET к `/functions/v1/homework-api/assignments/${assignmentId}/tasks/${taskId}/images` через существующий `apiCall` / `dbService.functions.invoke` (паттерн — поищи `getStudentTaskImageSignedUrlViaBackend`).
   - Возвращает `response.signed_urls`.
   - Errors: 404 → пустой массив (задачи нет); 5xx → throw.

2. `src/hooks/useStudentHomework.ts`:
   - Новый hook `useStudentTaskImagesSignedUrls(assignmentId: string, taskId: string, options?: { enabled?: boolean })`:
     useQuery({
       queryKey: ['student', 'homework', 'guided-task-images', assignmentId, taskId],
       queryFn: () => getStudentTaskImagesSignedUrlsViaBackend(assignmentId, taskId),
       enabled: options?.enabled ?? true,
       staleTime: 50 * 60_000, // signed URL живёт 60 мин
       gcTime: 55 * 60_000,
     });

3. НЕ удалять старый `getStudentTaskImageSignedUrlViaBackend` (single) — его всё ещё использует attachments-логика в сообщениях.

Acceptance Criteria:
- AC-4: Given hook вызван; When fetch успешен; Then data — массив signed URL.

Guardrails:
- staleTime ≤ ttl signed URL минус буфер (50/60 мин).
- НЕ использовать `useQueries` для N запросов — у нас один batch endpoint.
- Ошибка → React Query умеет retry с backoff, default ОК.

Mandatory end block:
- Diff studentHomeworkApi.ts + useStudentHomework.ts.
- Команды валидации.
- Self-check: query key prefix `['student', 'homework', ...]` соблюдён.
```

---

## TASK-12: TutorHomeworkDetail — multi-photo + рубрика секция

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: репетитор открывает Detail-страницу ДЗ — должен видеть все фото каждой задачи (не только первое) + новую секцию «Критерии проверки» с фото рубрики.

Канонические доки:
1. CLAUDE.md
2. .claude/rules/40-homework-system.md (Merged Detail + Results страница)
3. docs/delivery/features/homework-multi-photo/spec.md §5 «Tutor detail/viewer»

Зависимость: TASK-6 (rubric_image_urls в response) + TASK-7 (rubric-images endpoint).

Задача (TASK-12):

1. `src/pages/tutor/TutorHomeworkDetail.tsx:145` (`TaskImagePreview`):
   - Принимает `taskImageUrl: string | null` (уже dual-format после TASK-6).
   - Парсить `parseAttachmentUrls(taskImageUrl)` → `string[]`.
   - Если 0 → null. Если 1 → существующий single-thumbnail Dialog. Если 2+ → ряд миниатюр + carousel Dialog (можно reuse TaskConditionGallery если вынести в `src/components/homework/shared/PhotoGallery.tsx`; иначе локальная копия — оба варианта приемлемы для P0, главное чтобы UX совпадал со student-side).

2. Новая секция «Критерии проверки» в task card:
   - Под существующим `task_text` блоком.
   - Заголовок «Критерии проверки» (text-sm font-semibold).
   - `rubric_text` через `<MathText>` (LaTeX support).
   - Если `task.rubric_image_urls`: ряд миниатюр + Dialog (тот же компонент). Endpoint: `/assignments/:id/tasks/:taskId/rubric-images` (TASK-7).
   - Видимость: tutor-only (TutorHomeworkDetail уже под TutorGuard, дополнительной проверки не нужно).

3. Не забыть `loading="lazy"` на всех новых `<img>`.

Acceptance Criteria:
- AC-7: Given legacy задача с 1 фото; When открыл Detail; Then 1 thumbnail + click-to-zoom работает как раньше.
- AC-9 (косвенно): Detail показывает все фото — основа для GuidedThreadViewer переиспользования.

Guardrails:
- НЕ ломать существующий TaskImagePreview API (если он используется где-то ещё — не сломать).
- НЕ дублировать heatmapStyles helpers — single source of truth.
- НЕ вставлять Materials и MathText в каждую новую миниатюру — только в rubric_text.

Mandatory end block:
- Diff TutorHomeworkDetail.tsx (+ optionally нового shared компонента).
- Команды валидации.
- Self-check: rubric_text всегда рендерится через MathText (LaTeX), не через plain text.
```

---

## TASK-13: GuidedThreadViewer — multi-photo task context

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: репетитор смотрит ученический guided-тред — должен видеть все фото задачи (не только первое) при выборе конкретной задачи через taskFilter.

Канонические доки:
1. CLAUDE.md
2. .claude/rules/40-homework-system.md (Е8 — TaskContextImage в GuidedThreadViewer, Е9 — realtime + key={selectedTask.id})
3. docs/delivery/features/homework-multi-photo/spec.md §5 «Tutor detail/viewer»

Зависимость: TASK-7 (batch endpoint работает для tutor).

Задача (TASK-13):

В `src/components/tutor/GuidedThreadViewer.tsx:59` (`TaskContextImage`):

1. Переименовать в `TaskContextGallery`. Props: `{ assignmentId: string; taskId: string; taskImageUrl: string | null }`.

2. Логика — копия TaskConditionGallery (TASK-10), но React Query key: `['tutor', 'homework', 'task-images-preview', assignmentId, taskId]` (другой prefix — отдельный cache scope для tutor).

3. Использует тот же endpoint `/assignments/:id/tasks/:taskId/images` (он tutor+student дружелюбный из TASK-7).

4. `key={selectedTask.id}` на компоненте — invariant из Е8/Е9 сохраняется (Dialog закрывается при смене задачи, realtime channel re-mount).

5. Если есть возможность вынести fullscreen carousel в shared `src/components/homework/shared/FullscreenCarousel.tsx` — вынести (избежит код-дрейфа между student и tutor side). Если делает ревью сложнее — оставить две локальные копии для P0, рефактор в parking lot.

Acceptance Criteria:
- AC-9: Given репетитор открыл viewer, выбрал задачу с 3 фото через taskFilter; Then TaskContextGallery показывает 3 миниатюры; click → carousel со стрелками и counter.

Guardrails:
- НЕ ломать Е8 collapsible blocking (`isTaskContextExpanded` state).
- НЕ ломать Е9 realtime invariant (`key={selectedTask.id}` remount).
- Tutor cache key prefix `['tutor', 'homework', ...]` обязателен (см. .claude/rules/performance.md 2c).

Mandatory end block:
- Diff GuidedThreadViewer.tsx (+ shared компонент если выносил).
- Команды валидации.
- Self-check: cache key изолирован от student space, Dialog remountит при смене задачи.
```

---

## TASK-14: QA — все 10 AC на 3 платформах

```
Твоя роль: QA + Vladimir вручную (Claude Code помогает только smoke-check + scripted assertions).

Контекст: финальная приёмка фичи перед merge в main и redeploy edge function.

Канонические доки:
1. docs/delivery/features/homework-multi-photo/spec.md §7 «Validation» (10 AC + smoke check + manual checklist)
2. .claude/rules/80-cross-browser.md

Задача (TASK-14):

1. Локально: `npm run lint && npm run build && npm run smoke-check`. Всё должно быть зелёным (preexisting lint errors допустимы — не вводить новых).

2. Прогнать AC-1..AC-10 на трёх платформах:
   - Chrome desktop (Windows)
   - iOS Safari (iPhone, реальное устройство, не симулятор)
   - Android Chrome
   Для каждого AC отметить PASS/FAIL/PARTIAL в чек-листе.

3. Особое внимание AC-7 (backward compat): найти в БД задачу с `task_image_url` = single string ref (legacy формат, до этой фичи). Открыть как ученик → должна показаться 1 миниатюра, click → Dialog без стрелок. Edit как репетитор → миниатюра остаётся, можно добавить ещё фото (state переходит в JSON-array, сохраняется без потери legacy ref'а).

4. Особое внимание AC-10 (iOS swipe vs onClick): на iPhone Safari проверить что свайп горизонтально по ряду миниатюр НЕ открывает Dialog. Проверить что tap (короткое касание) — открывает.

5. Дополнительный manual scenarios:
   - Создать ДЗ с 5 фото условия + 3 фото рубрики на одну задачу.
   - Открыть как ученик — должно работать.
   - Отправить ответ — в Network tab проверить request к /chat: body.taskImageUrls = массив из 5.
   - Импортировать KB-задачу с 4 фото — проверить что все 4 попали + toast.

Mandatory end block:
- Чек-лист AC × Platform = таблица 10 × 3 = 30 ячеек.
- Для каждого FAIL — описание + воспроизведение + предложенный фикс.
- Скриншоты или видео для AC-4, AC-10.
- Если все PASS — финальный комментарий «Ready for merge + edge function redeploy».
```

---

## TASK-15: CLAUDE.md rules update

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: после merge multi-photo фичи правила в .claude/rules/40-homework-system.md устаревают (single image_url → array). Обновить, чтобы будущие агенты имели актуальный invariant.

Канонические доки:
1. .claude/rules/40-homework-system.md (текущая версия)
2. docs/delivery/features/homework-multi-photo/spec.md §3 «Ключевые решения», §5 «Backend → guided_ai.ts»

Задача (TASK-15):

В `.claude/rules/40-homework-system.md`, секция «Передача изображений задач в AI (КРИТИЧНО)»:

1. Заменить упоминания `taskImageUrl: string | null` на `taskImageUrls: string[]` для всех 4 путей (answer / hint / question / bootstrap).

2. Добавить упоминание `rubricImageUrls?: string[]` для check path:
   - «`evaluateStudentAnswer` дополнительно принимает `rubricImageUrls` — фото критериев проверки. Передаются ТОЛЬКО в check, не в hint (leakage prevention).»

3. Зафиксировать dual-format invariant отдельным sub-bullet:
   - «`task_image_url` и `rubric_image_urls` в БД — TEXT с dual-format: single `storage://...` ref ИЛИ JSON-array. Всегда читать через `parseAttachmentUrls` из `@/lib/attachmentRefs` (frontend) или `_shared/attachment-refs.ts` (backend). Сериализация — `serializeAttachmentUrls`.»

4. Лимиты: «`MAX_TASK_IMAGES = 5`, `MAX_RUBRIC_IMAGES = 3`, AI-guard `MAX_TASK_IMAGES_FOR_AI = 5`».

5. Backward compat note: «Миграции данных нет — legacy single-ref продолжает работать через parseAttachmentUrls (возвращает массив длины 1).»

6. Update «Четыре пути к AI» bullets — каждый получает обновлённую сигнатуру.

Acceptance Criteria: —

Guardrails:
- НЕ удалять существующие правила в файле — только дописывать/обновлять секцию изображений.
- НЕ менять структуру файла (заголовки секций, порядок).
- Один файл — один PR.

Mandatory end block:
- Diff 40-homework-system.md.
- Self-check: future agent читая обновлённое правило сразу понимает dual-format + tutor-only rubric invariant.
```
