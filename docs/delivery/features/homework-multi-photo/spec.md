# Feature Spec: Homework Multi-Photo (задача до 5 фото, критерии до 3 фото)

**Версия:** v0.2
**Дата:** 2026-04-14
**Автор:** Vladimir
**Статус:** approved-for-tasks

### Changelog

- **v0.2 (2026-04-14)** — sync line numbers с актуальным состоянием repo после коммита `e57cada feat(homework-create): L0 layout reshuffle + subjects unification`. Зафиксирована зависимость: эта фича стартует поверх унифицированного subject-flow (`SUBJECTS` из `@/types/homework`, `VALID_SUBJECTS_CREATE`/`VALID_SUBJECTS_UPDATE` в backend). Добавлено уточнение про `meta.exam_type` в Out of Scope (AI не получает exam_type — отдельная итерация). Подтверждена доступность `parseAttachmentUrls` / `serializeAttachmentUrls` в `src/lib/kbApi.ts:61,90`.
- **v0.1 (2026-04-14)** — initial draft.

### Dependencies

- Завершённая фича `homework-create-layout-subjects` (commit `e57cada`). `SUBJECTS` теперь единый источник в `@/types/homework`; `DraftTask.task_image_path: string \| null` готов к dual-format без миграции state shape; `meta.exam_type` живёт в `MetaState` как отдельное поле (его передача в AI — out of scope этой спеки).
- Существующие helper-ы в `src/lib/kbApi.ts:61,90` (`parseAttachmentUrls` / `serializeAttachmentUrls`) — TASK-1 их выносит в shared module.

---

## 0. Job Context (обязательная секция)

### Какую работу закрывает эта фича?

| Участник | Core Job | Sub-job | Ссылка на Граф |
|---|---|---|---|
| Репетитор (B2B) | R4: Контролировать и повышать качество при росте нагрузки | R4-1: Быстро собирать ДЗ из существующего банка задач | job-graph.md#R4 |
| Репетитор (B2B) | R4: Контролировать и повышать качество при росте нагрузки | R4-2: Задавать свои критерии проверки, не теряя время на перенабор | job-graph.md#R4 |
| Школьник (B2C) | S1: Понять, что именно надо сделать к занятию | S1-2: Быстро разобраться в условии задачи без расшифровки мелкого фото | job-graph.md#S1 |

> Фича закрывает две параллельные работы репетитора (скорость сборки + точность критериев) и улучшает восприятие условия учеником — сильный сигнал приоритета.

### Wedge-связка

- **B2B-сегмент:** B2B-1 (репетитор физики ЕГЭ/ОГЭ)
- **B2C-сегмент:** B2C-1 (школьник 16–18, готовится к экзамену)
- **Score матрицы:** высокий — основной flow создания ДЗ в pilot

### Pilot impact

Физические задачи ЕГЭ/ОГЭ часто снабжаются несколькими картинками (чертёж + таблица + график, или фото из учебника + ручная схема). Текущее ограничение «одна фото на задачу» заставляет репетитора либо склеивать изображения в графическом редакторе (+40–90 секунд на задачу), либо урезать материал (ухудшая понимание учеником). Снятие этого ограничения напрямую сокращает время сборки ДЗ (KPI пилота R4) и повышает самостоятельность ученика в guided chat (KPI пилота S1).

---

## 1. Summary

Расширяем поддержку изображений в задачах ДЗ и в критериях проверки (рубрике):

- **До 5 фото на условие задачи** (было: 1).
- **До 3 фото на критерии проверки** (было: 0 — только `rubric_text`).

Хранение — в уже существующем TEXT-поле `task_image_url` и новом TEXT-поле `rubric_image_urls`, через тот же dual-format паттерн (single storage ref ИЛИ JSON-массив refs), который уже работает в KB-модуле (`parseAttachmentUrls` / `serializeAttachmentUrls` в `src/lib/kbApi.ts`). Это означает **ноль миграций данных** для существующих ДЗ — старые строки со single-ref продолжают читаться как одноэлементный массив.

Конструктор (`HWTaskCard.tsx`) получает галерею с превью, кнопкой «Добавить фото» (до лимита), drag-reorder, удалением. Student-side guided chat (`GuidedHomeworkWorkspace.tsx`) отрисовывает каждое фото отдельной миниатюрой в ряд с общим zoom-dialog / fullscreen carousel (индекс + стрелки prev/next + swipe на mobile). Все 4 AI-пути (`answer`, `hint`, `question`, `bootstrap`) получают массив signed+inlined images вместо одного. KB-импорт больше не сплющивает `kb_attachment_url` JSON-массив в первое фото — сохраняет все до лимита.

---

## 2. Problem

### Текущее поведение

- `homework_tutor_tasks.task_image_url TEXT NULL` — хранит один `storage://...` ref.
- `HWTaskCard.tsx` UI позволяет прикрепить ровно одну картинку; повторный upload перезаписывает.
- `homework_tutor_tasks.rubric_text TEXT NULL` — только текстовое описание критериев; изображения не поддерживаются совсем.
- `HWTasksSection.tsx:28` при импорте из KB берёт `parseAttachmentUrls(task.attachment_url)[0]` — **сбрасывает** все дополнительные фото KB-задачи.
- `TutorHomeworkCreate.tsx:468, 602, 700` пишет `task_image_url: t.task_image_path || t.kb_attachment_url || null` — скалярный single-ref.
- Student-side `TaskConditionImage` (module-scope в `GuidedHomeworkWorkspace.tsx`, строки 253–323) ожидает ровно один `task_image_url` на задачу.
- Все 4 AI-пути в `supabase/functions/homework-api/guided_ai.ts` и `chat/index.ts` принимают `taskImageUrl: string | null` (single), не array.

### Боль

**Репетитор (R4-1, R4-2):** физические задачи ЕГЭ часто требуют 2–3 изображения (условие + схема + график). Сейчас репетитор вынужден:
- склеивать фото в Preview / Paint / Photoshop — +40–90 сек на задачу, теряется разрешение;
- ИЛИ загружать только одно, теряя контекст — ученик не понимает условие и тратит hint quota впустую;
- ИЛИ писать часть условия словами и прикладывать только схему — проигрывает конкурентам (neofamily.ru, Умскул), где задачи с множественными изображениями работают из коробки.

Критерии проверки (`rubric_text`) часто существуют у репетитора в виде сфотографированной страницы методички (Мякишев, Рымкевич, Касьянов). Сейчас репетитор вынужден переписывать всё вручную или отказываться от рубрики — теряется точность AI-проверки в `detailed_solution`-задачах.

**Школьник (S1-2):** в guided chat видит только одну мелкую миниатюру; при двух-трёх фото в оригинале (которые склеены в PNG) детали теряются при object-contain-ресайзе на mobile. Ученик тратит время на расшифровку вместо решения.

### Текущие «нанятые» решения

- Preview.app / Paint.NET / iPhone Photos Collage — склейка в одну картинку перед загрузкой.
- Отдельные PDF-материалы к ДЗ через `homework_tutor_materials` — но они не попадают ни в guided chat условия задачи, ни в AI-контекст, ученик должен открывать их отдельно.
- Рубрика → ручная транскрипция с фото → `rubric_text`.

---

## 3. Solution

### Описание

**Схема (минимально-инвазивная):**

Переиспользуем dual-format паттерн, уже работающий в KB-модуле:

- `homework_tutor_tasks.task_image_url TEXT NULL` — без миграции данных. Семантика расширяется: значение может быть single `storage://...` ref (legacy + когда одно фото) ИЛИ JSON-array `["storage://...", "storage://..."]` (когда 2–5 фото). Чтение/запись через уже существующие хелперы `parseAttachmentUrls` / `serializeAttachmentUrls` из `src/lib/kbApi.ts` (вынести в `src/lib/attachmentRefs.ts` как shared helper — см. «Ключевые решения»).
- `homework_tutor_tasks.rubric_image_urls TEXT NULL` — **новая колонка**, тот же dual-format. Nullable. Миграция additive, нулевой риск для существующих строк.

**Лимиты (hard, проверяются на фронте И на бэке):**
- Условие задачи: ≤ 5 storage refs.
- Критерии проверки: ≤ 3 storage refs.

**UI конструктора (`HWTaskCard.tsx`):**
- Галерея: горизонтальный ряд миниатюр (80×80, `rounded-md`, `border-slate-200`) + кнопка «Добавить фото» с иконкой Lucide `Plus`. Кнопка скрывается при достижении лимита.
- На каждой миниатюре: hover-X для удаления (иконка Lucide `X`, 24×24, `aria-label="Удалить фото N"`), `touch-action: manipulation`. На mobile X всегда видна.
- Reorder: Drag handles не добавляем в P0 (parking lot) — фото показываются в порядке добавления.
- Новый блок «Критерии проверки» в карточке задачи: textarea `rubric_text` + галерея до 3 фото. Галерея ниже textarea, `mt-2`.
- Paste (Ctrl+V) остаётся на `task_text` textarea — работает как сейчас, прикрепляет в слот условия (если не достигнут лимит 5).

**UI student guided chat (`GuidedHomeworkWorkspace.tsx`):**
- Сохраняем существующий collapsible блок «Условие задачи» (Sprint S3 + Е8).
- Внутри collapsible: `task_text` (через `MathText`) + галерея миниатюр.
- Галерея: горизонтальный ряд `gap-2` с `overflow-x-auto touch-pan-x`. Каждая миниатюра — 120px wide, `max-h-32 object-contain rounded-md border-slate-200`, `loading="lazy"`.
- Клик по миниатюре → Radix `Dialog` с fullscreen-каруселью: `max-h-[75vh] object-contain` + индикатор `1/3` + стрелки prev/next (Lucide `ChevronLeft` / `ChevronRight`) + swipe-left/right на touch (через `touch-action: pan-x` на wrapper + раздельные touch handlers; без внешних библиотек).
- Если только одно фото — dialog как сейчас, без стрелок и индикатора (backward compat).
- Рубрика (фото критериев) **не показывается ученику** — это tutor-side только, остаётся внутри `TutorHomeworkDetail` (см. Out of scope).

**AI-пайплайн (все 4 пути):**
- `guided_ai.ts` → расширяем `EvaluateStudentAnswerParams.taskImageUrl: string | null` → `taskImageUrls: string[]` (всегда массив, пустой = нет фото). `inlinePromptImageUrl` вызывается в цикле `Promise.all`. В multimodal user content передаём массив `{ type: 'image_url', image_url: { url } }` объектов.
- Аналогично для `answer` / `hint`.
- `chat/index.ts` (path `question` + `bootstrap`) → `taskImageUrl` → `taskImageUrls: string[]`. Frontend `buildTaskContext()` передаёт массив.
- Guard: лимит `MAX_TASK_IMAGES_FOR_AI = 5` на бэке (совпадает с UI-лимитом) — защита от deliberately-inflated arrays.

**KB-импорт (`HWTasksSection.tsx:28`):**
- `parseAttachmentUrls(task.attachment_url)` — уже возвращает `string[]`. Берём `.slice(0, 5)` и сериализуем обратно через `serializeAttachmentUrls(refs.slice(0, 5))`.
- `kb_attachment_url` на `DraftTask` становится `string | null` с тем же dual-format (существующий тип не ломаем — `parseAttachmentUrls` принимает оба формата).
- `HWTasksSection:36` `task_image_path: attachmentRef` → превращается в `task_image_path: serializeAttachmentUrls(refs.slice(0, 5))`.
- Если у KB-задачи больше 5 фото — импортируем первые 5 и показываем toast `Из KB импортировано 5 из N фото` (non-blocking).

### Ключевые решения

1. **Dual-format TEXT вместо `jsonb[]`** — точно следуем существующему KB-паттерну (`parseAttachmentUrls` / `serializeAttachmentUrls`). Плюсы: backward-compat без миграции, одна ментальная модель на весь продукт, работает с любым clientom через TEXT. Минусы: нет native JSON-операторов в SQL-запросах, но они сейчас и не нужны — чтение/запись всегда через helper.
2. **Shared helper в `src/lib/attachmentRefs.ts`** — выносим `parseAttachmentUrls` / `serializeAttachmentUrls` из `kbApi.ts` (остаётся re-export для совместимости KB-кода) в доменно-нейтральный модуль. Homework и KB импортируют оттуда. Это предотвращает расхождение двух копий функции.
3. **Backend-shared helper в `supabase/functions/_shared/attachment-refs.ts`** — тот же paste, но для Deno runtime (edge functions не могут импортировать `src/lib/*`). Minimal, zero deps.
4. **Нет отдельного bucket** — все фото и условий, и рубрики лежат в `homework-task-images` bucket (как сейчас для task_image). Path-schema: `{tutor_id}/{assignment_id}/{task_id}/{fileId}.{ext}` для условия, `{tutor_id}/{assignment_id}/{task_id}/rubric/{fileId}.{ext}` для рубрики. Префикс `rubric/` даёт cheap визуальную сегрегацию в storage browser без новых политик.
5. **Файловые лимиты те же, что у student attachments** — ≤ 10 МБ, `accept="image/*,.heic,.heif"`. **PDF не принимаем** для task-condition и rubric — guided chat рендерит inline, PDF ломает UX. (Student-side PDF в attachments остаётся — это другой сценарий.)
6. **HEIC → передаём как есть** — Apple-устройства отдают HEIC при загрузке; не конвертируем клиентски (P1). На AI-путь полагаемся на то же поведение, что сейчас (Lovable gateway принимает HEIC корректно в ~80% кейсов; при fail — пользователь получает feedback через retry-once fallback).
7. **Порядок фото = порядок добавления** — сортировка или reorder отложены в parking lot. Порядок фиксируется в JSON-массиве.
8. **Лимит проверяется в трёх точках** — UI (disable «+»), backend create/update validation (400 `VALIDATION`), AI-path guard (`.slice(0, 5)`). Три уровня защиты от breakage.
9. **Миграция данных — нулевая** — существующие `task_image_url` со single-ref продолжают работать через `parseAttachmentUrls`, возвращающий `[ref]`. Это прямая реализация пользовательского решения «Только для новых ДЗ, старые не трогаем» — **без** риска «two sources of truth», т.к. формат один и тот же с точки зрения читателя.
10. **Рубрика — tutor-only видимость** — `rubric_image_urls` возвращается только в `handleGetAssignment` (repetitor endpoint) и в AI-payload для `handleCheckAnswer`. НЕ возвращается в `getStudentAssignment`. Это защищает педагогический замысел: ученик не видит critical points до сдачи.

### Scope

**In scope:**
- Миграция: additive column `rubric_image_urls TEXT NULL`.
- `src/lib/attachmentRefs.ts` + `supabase/functions/_shared/attachment-refs.ts` — shared helpers.
- `HWTaskCard.tsx` — галерея условия (до 5) и галерея рубрики (до 3).
- `HWTasksSection.tsx` — KB-импорт сохраняет до 5 фото, передаёт dual-format ref.
- `TutorHomeworkCreate.tsx` — три places (create/update/secondary) записи `task_image_url` и `rubric_image_urls`.
- Backend `homework-api/index.ts` — валидация лимитов, select + возврат `rubric_image_urls`, передача arrays в все 4 AI path.
- `guided_ai.ts` — `taskImageUrls: string[]`, `Promise.all` inline, multimodal content array.
- `chat/index.ts` — `taskImageUrls: string[]`, передача в Lovable multimodal.
- `GuidedHomeworkWorkspace.tsx` — галерея в collapsible «Условие задачи», fullscreen carousel, swipe на mobile.
- `studentHomeworkApi.ts` + `useStudentHomework.ts` — batch signed URL resolver и React Query hook для массива.
- `TutorHomeworkDetail.tsx` — отображение массива фото задачи + секция «Критерии проверки» с фото рубрики (tutor-only).
- `GuidedThreadViewer.tsx` — `TaskContextImage` расширить до массива (tutor смотрит ученический тред, должен видеть все фото задачи).

**Out of scope (parking lot):**
- Drag-to-reorder фото внутри задачи — линейный порядок добавления достаточен для P0.
- Клиент-сайд HEIC → JPEG конвертация.
- Клиент-сайд compression (Tinypng-like) — делаем, если 10МБ лимит окажется тесным.
- PDF-страницы как условие задачи — остаётся через `homework_tutor_materials`.
- Reorder/preview рубрики у ученика — рубрика показывается только после сдачи в отдельной итерации (R11 разбор).
- Миграция старых single-ref `task_image_url` → JSON-array формат — **сознательно не делаем**, т.к. dual-format helper уже справляется (см. Ключевое решение #9).
- Unified attachment-refs helper для `homework_tutor_thread_messages.image_url` (student-side multi-attachment) — уже работает через свой serializer, отдельная миграция.
- Передача `meta.exam_type` (`'ege' | 'oge'`) в AI-промпты (`buildExamTypeGuidance`). После коммита `e57cada` exam_type — отдельное поле на L0, но multimodal pipeline для multi-photo строится без него; интеграция exam_type в промпты — отдельная мини-итерация.

---

## 4. User Stories

### Репетитор

> Когда я собираю ДЗ по физике и у меня задача из Мякишева с чертежом + таблицей + графиком, я хочу прикрепить все три изображения к одной задаче, чтобы не тратить 1–2 минуты на склейку в графическом редакторе.

> Когда я пишу критерии проверки для задачи на полное решение, я хочу прикрепить сфотографированную страницу методички Касьянова с рубрикой, чтобы AI проверял по настоящим критериям, а не по моему сокращённому пересказу.

### Школьник

> Когда я открываю задачу с тремя изображениями в guided chat, я хочу листать их свайпом в полноэкранном режиме, чтобы рассмотреть детали чертежа и графика без pinch-zoom в мелкой миниатюре.

---

## 5. Technical Design

### Затрагиваемые файлы

**Shared helpers (новые):**
- `src/lib/attachmentRefs.ts` — `parseAttachmentUrls` / `serializeAttachmentUrls` / константы `MAX_TASK_IMAGES` (5) и `MAX_RUBRIC_IMAGES` (3). `src/lib/kbApi.ts` оставляет re-export для совместимости KB-кода (не ломаем import'ы в KB).
- `supabase/functions/_shared/attachment-refs.ts` — Deno-совместимый клон helpers + `MAX_TASK_IMAGES_FOR_AI = 5`.

**Типы:**
- `src/components/tutor/homework-create/types.ts` — `DraftTask.task_image_path: string | null` → семантика остаётся (single ref ИЛИ JSON-array), добавляем JSDoc. Добавляем `DraftTask.rubric_image_paths: string | null`.
- `src/types/homework.ts` — `StudentHomeworkTask.task_image_url` остаётся `string | null`, но тип документируется как dual-format (JSDoc отсылает к `parseAttachmentUrls`).
- `src/lib/tutorHomeworkApi.ts` — `TutorHomeworkTask` расширить `rubric_image_urls?: string | null`.

**Конструктор:**
- `src/components/tutor/homework-create/HWTaskCard.tsx` — галерея условия (+blok рубрики с галереей).
- `src/components/tutor/homework-create/HWTasksSection.tsx` — KB-импорт сохраняет до 5 фото.
- `src/pages/tutor/TutorHomeworkCreate.tsx` — три точки записи `task_image_url` (актуальные строки **470, 602, 698** на HEAD `e57cada`; pattern `task_image_url: t.task_image_path || t.kb_attachment_url || null`) становятся `task_image_url: t.task_image_path ?? null` (serializer уже запустили при записи в state); добавить `rubric_image_urls`.

**Tutor detail/viewer:**
- `src/pages/tutor/TutorHomeworkDetail.tsx` — `TaskImagePreview` расширить до массива; новая секция «Критерии проверки» с фото рубрики.
- `src/components/tutor/GuidedThreadViewer.tsx` — `TaskContextImage` расширить до массива с fullscreen caroussel (reuse student-side компонент).

**Student:**
- `src/components/homework/GuidedHomeworkWorkspace.tsx` — `TaskConditionImage` (строки 253–323) превращаем в `TaskConditionGallery` с fullscreen caroussel.
- `src/lib/studentHomeworkApi.ts` — `getStudentTaskImageSignedUrlViaBackend` остаётся per-photo; новый endpoint `GET /assignments/:id/tasks/:taskId/images` возвращает `{ signed_urls: string[] }` (batch resolver, предотвращает N HTTP-круглоедок на mobile).

**Backend:**
- `supabase/functions/homework-api/index.ts` (line numbers — HEAD `e57cada`):
  - `handleCreateAssignment` (строка **342**) — task validation loop пишет `task_image_url` на строках **418, 439**; добавить dual-format валидацию count ≤ 5 через `parseAttachmentUrls`.
  - `handleUpdateAssignment` (строка **848**) — task write на строке **1064**; то же + валидация `rubric_image_urls` count ≤ 3.
  - secondary paths (строка **1098**) — write-through.
  - `handleGetAssignment` (строка **672**) — включаем `rubric_image_urls` в select, возвращаем как есть.
  - `GET /assignments/:id/tasks/:taskId/image-url` → **оставляем per-single-photo**, плюс новый `GET /assignments/:id/tasks/:taskId/images` — возвращает массив signed URLs.
  - `handleCheckAnswer` / `handleRequestHint` / system → resolve массива через `Promise.all(resolveTaskImageUrlForAI)`, передают `taskImageUrls: string[]` в `evaluateStudentAnswer` / `generateHint`.
  - Student-side `getStudentAssignment` — возвращает `task_image_url` как есть (dual-format), НЕ возвращает `rubric_image_urls`.
- `supabase/functions/homework-api/guided_ai.ts`:
  - `EvaluateStudentAnswerParams.taskImageUrl: string | null` → `taskImageUrls: string[]`.
  - `GenerateHintParams` — аналогично.
  - `inlinePromptImageUrl` вызывается в `Promise.all`; multimodal user content получает по одному `{ type: 'image_url', image_url: { url } }` на каждое фото + один `{ type: 'text', text: userText }` в конце.
- `supabase/functions/chat/index.ts`:
  - `taskImageUrl` → `taskImageUrls: string[]` в body shape.
  - `resolveTaskImageUrlForAI` → `resolveTaskImageUrlsForAI(db, dualFormat) → string[]`.
  - Frontend `buildTaskContext()` (в `GuidedHomeworkWorkspace.tsx`) → `taskImageUrls = parseAttachmentUrls(task.task_image_url)`.

### Data Model

**Миграция `20260414120000_homework_rubric_images.sql`:**

```sql
ALTER TABLE public.homework_tutor_tasks
  ADD COLUMN IF NOT EXISTS rubric_image_urls TEXT NULL;

COMMENT ON COLUMN public.homework_tutor_tasks.rubric_image_urls IS
  'Storage refs для фото критериев проверки. Dual-format: single "storage://..." ref ИЛИ JSON-array. Лимит 3. NULL = нет фото. Видимость: только репетитор.';

COMMENT ON COLUMN public.homework_tutor_tasks.task_image_url IS
  'Storage refs для фото условия задачи. Dual-format: single "storage://..." ref (legacy + когда одно фото) ИЛИ JSON-array "[...]". Лимит 5. Используй parseAttachmentUrls / serializeAttachmentUrls.';
```

Никаких индексов, никаких RLS-изменений, никакого data backfill.

### API

**Новый endpoint (student-side batch):**
`GET /assignments/:id/tasks/:taskId/images` → `{ signed_urls: string[] }` — batch-резолвер для галереи. Вызывается из `TaskConditionGallery` один раз при открытии задачи, не по одному запросу на фото.

**Существующий `GET /assignments/:id/tasks/:taskId/image-url`** — оставляем, используется для легковесного single-photo preview в других местах (e.g. `TaskImagePreview` в Detail).

**Новый endpoint (tutor-side rubric):**
`GET /assignments/:id/tasks/:taskId/rubric-images` → `{ signed_urls: string[] }`. Аутентифицирован как tutor, 403 если студент.

**Изменения существующих endpoints:**
- `POST /assignments` — body `tasks[i].task_image_url` принимает single-ref ИЛИ JSON-array-string; `tasks[i].rubric_image_urls` (новое, optional); валидация count ≤ 5 / ≤ 3 через `parseAttachmentUrls`.
- `PUT /assignments/:id` — то же.
- `POST /assignments/:id/tasks` (и duplicate) — то же.

### Миграции

1. `supabase/migrations/20260414120000_homework_rubric_images.sql` — `ADD COLUMN rubric_image_urls TEXT NULL` + COMMENT-ы.

Никаких data-migration-ов.

---

## 6. UX / UI

### Wireframe / Mockup

**Конструктор — карточка задачи:**

```
┌─────────────────────────────────────────────┐
│ Задача 1                          [⬆][⬇][✕] │
├─────────────────────────────────────────────┤
│ Текст задачи *                              │
│ [Шарик массой 0.5 кг падает...        ]     │
│                                             │
│ Фото условия (до 5)                         │
│ [📷][📷][📷] [+]                            │
│                                             │
│ Правильный ответ      Макс. баллов          │
│ [4 Дж            ]    [1  ]                 │
│                                             │
│ Формат проверки                             │
│ [Развёрнутое решение              ▼]        │
│                                             │
│ Критерии проверки                           │
│ [Полный балл: приведены все этапы...]       │
│ Фото критериев (до 3)                       │
│ [📷][📷] [+]                                │
└─────────────────────────────────────────────┘
```

**Student guided chat — collapsible «Условие задачи #1»:**

```
┌─────────────────────────────────────────────┐
│ ▼ Условие задачи #1                         │
├─────────────────────────────────────────────┤
│ Шарик массой 0.5 кг падает с высоты 2 м...  │
│                                             │
│ [📷 thumb 1] [📷 thumb 2] [📷 thumb 3]       │
│  ← swipe on mobile →                        │
└─────────────────────────────────────────────┘
```

**Fullscreen caroussel (клик по миниатюре):**

```
┌─────────────────────────────────────────────┐
│                                   2/3   [✕] │
│                                             │
│      [←]      [большое фото]      [→]       │
│                                             │
│                                             │
└─────────────────────────────────────────────┘
```

### UX-принципы (из doc 16)

- **Прогрессивное раскрытие** — галерея рубрики появляется только после клика на «Добавить фото»; иначе — только textarea (default UX не перегружается).
- **Scale-friendly** — репетитор с 25+ учениками должен собрать ДЗ за минуты, не часы. Исключение ручной склейки PNG экономит 40–90 сек/задача × 5–10 задач/ДЗ = 3–15 минут/ДЗ.
- **Прозрачность для ученика** — все фото условия видны сразу в collapsible, не нужно «листать» скрытые ресурсы.

### UI-паттерны (из doc 17)

- **Lucide иконки** — `Plus` для добавления, `X` для удаления, `ChevronLeft`/`ChevronRight` для carousel (per design-system rule «Иконки»).
- **Радиусы 8px** для миниатюр (`rounded-md`), 12px для Dialog (`rounded-xl`).
- **`touch-action: manipulation`** на кнопках добавления/удаления, `touch-action: pan-x` на горизонтальном ряду миниатюр (per 80-cross-browser.md).
- **`loading="lazy"`** на миниатюрах (per performance.md).
- **16px минимум** на input/textarea (per 90-design-system.md + 80-cross-browser.md).
- **`bg-accent`** на кнопке «Добавить фото» — secondary (`bg-white border-slate-200 text-accent`), т.к. primary CTA на экране — «Сохранить» / «Отправить».

---

## 7. Validation

### Как проверяем успех?

**Качественно:**
- Репетитор может прикрепить 5 фото к задаче и 3 фото к рубрике без ошибок в UI.
- Ученик видит все 5 фото, может листать их в полноэкранной каруссели свайпом на iPhone и стрелками на desktop.
- AI (все 4 пути) получает и анализирует все фото — проверяется вручную на тестовой задаче с 3 фото (условие + чертёж + график), где правильный ответ зависит от значения на графике.
- KB-задача с 4 фото импортируется в ДЗ с сохранением всех 4.

**Количественно (pilot KPI):**
- Медианное время сборки ДЗ из 5 задач с изображениями: **−40–90 сек на задачу** для задач с 2+ фото (было: ~2 мин на склейку → ~30 сек на multi-upload).
- % задач в ДЗ репетитора с 2+ фото: ≥ 15% после первой недели (сигнал, что фича нашла реальную боль).
- Время выполнения ученика по задачам с 2+ фото: не растёт (галерея не должна создать UX-регрессию на «слишком много всего»).

### Testable Acceptance Criteria

1. **AC-1 (конструктор, условие):** репетитор добавляет 3 фото к задаче в `HWTaskCard.tsx`; все 3 видны как миниатюры в ряду; после достижения 5 кнопка «Добавить фото» дизейблится с `aria-disabled` и `title="Максимум 5 фото"`.
2. **AC-2 (конструктор, рубрика):** репетитор добавляет 2 фото к `rubric_image_urls`; кнопка дизейблится после 3.
3. **AC-3 (backend, лимиты):** `POST /assignments` с `task_image_url` = JSON-array длиной 6 → 400 `VALIDATION: tasks[i].task_image_url exceeds maximum of 5 images`.
4. **AC-4 (student galley):** ученик открывает задачу с 3 фото → collapsible «Условие задачи #1» содержит 3 миниатюры; клик на вторую → Dialog со счётчиком `2/3`; свайп влево на iPhone Safari → `3/3`; стрелка ← на desktop → `2/3`.
5. **AC-5 (AI-путь `answer`):** задача с 2 фото (одно текстовое условие, одно с графиком), ученик отправляет ответ; backend логи показывают 2 `image_url` блока в multimodal user content, переданных Lovable; AI feedback упоминает значение, считываемое ТОЛЬКО с графика (не угадывает).
6. **AC-6 (KB-импорт):** KB-задача с `attachment_url = JSON.stringify([ref1, ref2, ref3, ref4])` → в DraftTask попадают все 4 ref'а; в БД записывается JSON-array; UI показывает 4 миниатюры.
7. **AC-7 (backward compat):** существующая задача (до деплоя) с `task_image_url = "storage://..."` (single-ref) — ученик видит её как 1 миниатюру; AI получает 1 image_url; никаких ошибок в логах.
8. **AC-8 (rubric tutor-only):** `getStudentAssignment()` возвращает задачу → поле `rubric_image_urls` отсутствует в response (проверяется через network tab + unit test).
9. **AC-9 (realtime тред viewer):** репетитор открывает `GuidedThreadViewer` с задачей, имеющей 3 фото; через `initialTaskFilter` выбирает эту задачу → `TaskContextImage` показывает все 3 миниатюры с той же каруссель-механикой.
10. **AC-10 (iOS Safari):** swipe по галерее миниатюр НЕ триггерит onClick миниатюры на iPhone (`touch-action: pan-x` + раздельные tap/pan handlers в Dialog).

### Связь с pilot KPI

- **R4-1 (скорость сборки ДЗ):** прямое снижение latency на подготовку материала. Метрика из doc 18 (pilot execution): «Репетитор собирает ДЗ из 5 задач за < 5 минут». Multi-photo расширяет охват этого KPI на задачи с визуальным материалом (~40% задач физики ЕГЭ).
- **R4-2 (точность критериев):** AI-проверка detailed_solution улучшается, когда рубрика содержит источник из методички — репетитор меньше ретачит баллы вручную.
- **S1-2 (школьник понимает задачу):** меньше hints на задачах с визуалом, т.к. ученик сразу видит контекст.

### Smoke check

```bash
npm run lint && npm run build && npm run smoke-check
```

Дополнительно вручную:
1. Создать ДЗ с задачей, имеющей 5 фото условия + 3 фото рубрики.
2. Открыть задачу как ученик, листать carousel свайпом + стрелками.
3. Отправить ответ, проверить в Network tab что `taskImageUrls` — массив из 5 элементов.
4. Открыть legacy-ДЗ (single `task_image_url`) — проверить что UI не сломан.
5. Импортировать KB-задачу с 3 фото — проверить что все 3 попали в draft.

---

## 8. Risks & Open Questions

### Риски

| Риск | Вероятность | Митигация |
|---|---|---|
| Репетитор ожидает «одна задача = одна картинка» и put'ит 5 фото в одну карточку, а не создаёт 5 задач | Средняя | Hint-text под галереей: «Для отдельных задач используйте кнопку ‘Добавить задачу’». Не блокирующий. |
| Lovable AI gateway плохо работает с 5 images в одном turn (токены, latency) | Средняя | Замерить latency на тестовой задаче с 5 фото; если > 30 сек — срезать до 3 в AI-path (UI остаётся 5 для хранения, AI берёт `.slice(0, 3)`). Задокументировать в guided_ai.ts. |
| HEIC с iPhone ломает rendering в Chrome/Firefox на репетитор-side | Средняя | Ранее принималось без конвертации — проверить актуальность в QA. Если ломается — добавить client-side HEIC → JPEG через heic2any (P1). |
| JSON-array TEXT усложняет дебаг SQL-запросов | Низкая | Helper `parseAttachmentUrls` — один. Все SQL-запросы читают через API, не напрямую. В admin-интерфейсе раз в полгода — ок. |
| Миграция «только новые» порождает ожидание, что можно будет dobавить фото к старой задаче → не сработает в UI | Низкая | Нет — UI `HWTaskCard.tsx` работает с dual-format на чтение И на запись. Старую задачу можно открыть и добавить фото → сериализуется в JSON-array → записывается. `HWTasksSection:28` parseAttachmentUrls уже это умеет. Так что ограничение «только новые» фактически не существует — это просто миграция-данных-не-нужна. |
| N+1 signed URL запросов на student-side при галерее | Средняя | Новый batch endpoint `GET .../images`, один запрос на задачу. Query key `['student','homework','guided-task-images', assignmentId, taskId]`. |
| Storage bloat (5 × 10МБ × 10 задач × 100 ДЗ = 50 ГБ) | Средняя | Bucket lifecycle policy (parking lot). На pilot-объёме (10 репетиторов × 20 ДЗ = 200 ДЗ) — макс ~100 ГБ, принимаемо. |
| Fullscreen carousel блокирует vertical scroll страницы на iOS | Низкая | Radix Dialog уже сам управляет body-scroll-lock. Galley outside Dialog — `touch-pan-x`. |

### Открытые вопросы

1. **Q: Делаем ли batch endpoint `GET /images` за пределами student-side, или оставляем per-single для tutor detail/viewer?**
   **A:** Делаем batch в обоих местах — student `images`, tutor `rubric-images` + `images`. Экономит 2–5 HTTP-запросов на открытие treada с 3-фотной задачей. Trade-off: ещё один роут, но маленький.

2. **Q: `MAX_TASK_IMAGES_FOR_AI = 5` или меньше?**
   **A:** Старт 5 (= UI-лимит). Если latency/качество AI падают — срезать до 3 в guided_ai.ts, но оставлять 5 в storage. Решение после первого QA-прогона.

3. **Q: Картинки рубрики попадают в AI для `handleCheckAnswer`, или только `rubric_text`?**
   **A:** Да, попадают. Именно это главная ценность фичи для репетитора R4-2. `evaluateStudentAnswer` получает `rubricImageUrls: string[]` как отдельное поле (не склеивается с taskImageUrls — AI должен понимать, что это критерии проверки, а не условие). Промпт расширяется: `buildRubricGuidance(rubricText, hasRubricImages)`.

4. **Q: Как отрисовывать галерею условия на mobile, если фото 5 — ряд становится слишком длинный?**
   **A:** `overflow-x-auto touch-pan-x`, миниатюры фиксированной ширины 120px + gap-2. На iPhone помещается 3–4 с частью следующей — явный affordance для свайпа. Альтернатива (grid 2-column) откладывается — карусельный паттерн ближе к guided chat UX.

---

## 9. Implementation Tasks

> Переносятся в `homework-multi-photo-tasks.md` после approve спека.

- [x] **TASK-1:** Создать `src/lib/attachmentRefs.ts` + `supabase/functions/_shared/attachment-refs.ts` (вынести `parseAttachmentUrls` / `serializeAttachmentUrls` + константы `MAX_TASK_IMAGES = 5`, `MAX_RUBRIC_IMAGES = 3`). `kbApi.ts` → re-export для совместимости. Выполнено 2026-04-14.
- [x] **TASK-2:** Миграция `20260414120000_homework_rubric_images.sql` (ADD COLUMN `rubric_image_urls TEXT NULL` + COMMENT-ы на обе колонки). Выполнено 2026-04-14.
- [ ] **TASK-3:** `HWTaskCard.tsx` — галерея условия (до 5 фото); превью + удаление + кнопка `+` с дизейблом по лимиту; `touch-action: manipulation`; блок «Критерии проверки» с textarea + галерея (до 3).
- [ ] **TASK-4:** `HWTasksSection.tsx` — KB-импорт через `parseAttachmentUrls(task.attachment_url).slice(0, 5)`; `task_image_path` сохраняется как dual-format (single или JSON-array); toast при срезании.
- [ ] **TASK-5:** `TutorHomeworkCreate.tsx` — обновить три точки записи (create/update/secondary) — передавать `task_image_path` как есть (уже dual-format) + `rubric_image_urls`.
- [ ] **TASK-6:** Backend create/update/duplicate валидация + select: количество ≤ 5 / ≤ 3 через `parseAttachmentUrls`; включить `rubric_image_urls` в `GET /assignments/:id` select.
- [ ] **TASK-7:** Новые endpoints: `GET /assignments/:id/tasks/:taskId/images` (student+tutor), `GET /assignments/:id/tasks/:taskId/rubric-images` (tutor-only с 403 для student).
- [x] **TASK-8:** `guided_ai.ts` — `taskImageUrls: string[]` + `rubricImageUrls?: string[]` (для check); `Promise.all(inlinePromptImageUrl)`; multimodal content array. Обновить все use sites (`evaluateStudentAnswer`, `generateHint`). Выполнено 2026-04-14.
- [x] **TASK-9:** `chat/index.ts` — `taskImageUrls: string[]` в body shape; `resolveTaskImageUrlsForAI(db, value)` возвращает `string[]`; `buildTaskContext` (frontend) передаёт массив. Выполнено 2026-04-14.
- [ ] **TASK-10:** `GuidedHomeworkWorkspace.tsx` — заменить `TaskConditionImage` на `TaskConditionGallery`: horizontal row миниатюр + Radix Dialog с carousel (counter `N/M`, стрелки, swipe через touch handlers, `key={selectedTask.id}` для remount при смене задачи).
- [ ] **TASK-11:** `studentHomeworkApi.ts` — новый `getStudentTaskImagesSignedUrlsViaBackend(assignmentId, taskId)` → возвращает `string[]`; query key `['student','homework','guided-task-images', assignmentId, taskId]`.
- [x] **TASK-12:** `TutorHomeworkDetail.tsx` — `TaskImagePreview` расширить до массива (в details page видно все фото); новая секция «Критерии проверки» с фото рубрики под `rubric_text`. Выполнено 2026-04-14.
- [x] **TASK-13:** `GuidedThreadViewer.tsx` — `TaskContextImage` расширить до `TaskContextGallery` (reuse логика student-side compontент'a, один визуал). Выполнено 2026-04-14.
- [ ] **TASK-14:** QA — прогнать все 10 AC на Chrome desktop + iOS Safari + Android Chrome; специально проверить AC-7 (backward compat) на реальной legacy-задаче.
- [x] **TASK-15:** Обновить `.claude/rules/40-homework-system.md` секцию «Передача изображений задач в AI» — заменить `taskImageUrl: string | null` на `taskImageUrls: string[]`, упомянуть `rubricImageUrls`, добавить dual-format rule. Выполнено 2026-04-14.

---

## Checklist перед approve

- [x] Job Context заполнен (секция 0)
- [x] Привязка к Core Job из Графа работ (R4-1, R4-2, S1-2)
- [x] Scope чётко определён (in/out)
- [x] UX-принципы из doc 16 учтены (прогрессивное раскрытие, scale-friendly, прозрачность)
- [x] UI-паттерны из doc 17 учтены (Lucide, touch-action, 16px, `bg-accent`)
- [x] Pilot impact описан
- [x] Метрики успеха определены (+10 AC)
- [x] High-risk файлы не затрагиваются без необходимости (Chat.tsx, TutorGuard и т.д. — не трогаем)
- [x] Student/Tutor изоляция не нарушена (rubric возвращается только в tutor-endpoint)
