# Feature Spec: KB → ДЗ flow polish (драфт-корзина, KB-импорт, поля провенанса)

**Версия:** v0.2
**Дата:** 2026-04-15
**Автор:** Vladimir (при участии Claude)
**Статус:** P0 implemented, pending Lovable preview QA

---

## 0. Job Context

### Какую работу закрывает эта фича?

| Участник | Core Job | Sub-job | Ссылка на Граф |
|---|---|---|---|
| Репетитор (B2B) | R4: Сохранение контроля и качества при масштабировании | R4-1: Быстро собрать качественное ДЗ по теме урока | `docs/discovery/research/SokratAI_AJTBD_job-graphs/SokratAI_AJTBD_elite-physics-finish-sprint-job-graph.md#R4-1` |
| Репетитор (B2B) | R4 | R4-3: Поддерживать и обновлять свою базу задач | `...#R4-3` |

Ученик и родитель — не затрагиваются (фича строго в tutor-домене, не меняет student runtime кроме видимости эталонного решения — см. §3).

### Wedge-связка

- **B2B-сегмент:** репетиторы физики ЕГЭ/ОГЭ (primary buyer, hourly 3000–4000₽)
- **Wedge:** «Сборка качественного ДЗ за 5–10 минут» — canonical wedge из `docs/discovery/research/08-wedge-decision-memo-sokrat.md`
- **Score матрицы:** high (wedge-defining path)

### Pilot impact

Убирает трение на главном wedge-пути (КБ → драфт-корзина → конструктор ДЗ → отправка). Текущий флоу работает, но четыре точки трения (лишний счётчик, узкий drawer, невидимые фото, потерянные поля КБ) заставляют репетитора перепроверять, что попало в ДЗ, и открывать КБ заново — это добивает целевое «5–10 минут». Фича — полировка уже существующего пути, не новый сценарий.

---

## 1. Summary

Полировка существующего флоу «База знаний → черновик ДЗ → конструктор → отправка». Меняем четыре вещи без расширения скоупа:

1. Убираем вводящий в заблуждение счётчик драфт-корзины со вкладки «Домашки».
2. Расширяем sheet-драйвер «Домашнее задание» (`HWDrawer`) до 75vw и даём ему тот же рендер превью, что и у `KBPickerSheet` — репетитор видит ровно то, что добавил.
3. В карточке задачи конструктора (`HWTaskCard`) показываем превью картинок KB-задачи (не плейсхолдер) и добавляем click-to-zoom fullscreen carousel.
4. Переносим из КБ два поля в конструктор: `solution` (+ `solution_attachment_url`) как read-only блок «Эталонное решение» в «Критериях проверки» и `source_label` как tutor-only badge в шапке карточки. Ученику эти поля не показываем никогда. По умолчанию «AI-вступление к задачам» — выключено во всех точках создания и редактирования ДЗ.

---

## 2. Problem

### Текущее поведение

Репетитор нажимает `+ в ДЗ` в каталоге КБ → задача падает в глобальную драфт-корзину (`hwDraftStore`, Zustand, `persist`). Дальше два пути:

- **Путь A — через драйвер «Домашнее задание»**: клик на бейдж «ДЗ · N» в шапке КБ открывает правый sheet (`HWDrawer`, `w-[420px]`). Кнопка «Создать черновик ДЗ» делает прямой `INSERT` в `homework_tutor_assignments`, минуя конструктор. Репетитор потом редактирует ДЗ в `/tutor/homework/:id/edit`.
- **Путь B — через конструктор ДЗ**: репетитор открывает `/tutor/homework/create` и нажимает «Добавить из базы» → откроется `KBPickerSheet` (правый sheet, `w-[75vw]`). Задачи конвертируются через `kbTaskToDraftTask` в `DraftTask[]` и вставляются в `HWTasksSection`.

Проблемы флоу (со скриншотов пользователя):

1. **Лишний счётчик на tab «Домашки»** (скриншот 1): `hwDraftStore` persist-ит драфт-корзину, `TutorLayout` рисует red dot-badge «1» на tab `/tutor/homework`. Репетитор идёт туда и ничего не находит — вкладка ведёт на список assignments, а не на драфт-корзину. Лишний клик и путаница.
2. **Узкий HWDrawer с неинформативными карточками** (скриншот 2): в sheet 420px задачи показаны как 3 строки текста + крохотный `<Image className="h-3 w-3" />` иконка-placeholder вместо превью. Отличается от `KBPickerSheet` (75vw, полноразмерное фото). Нельзя убедиться, что правильная задача попала в корзину, без выхода в конструктор.
3. **HWTaskCard не рисует превью KB-фото** (скриншот 4): `HWTaskCard` рисует `<img src={previewUrl}>` только для файлов, загруженных в текущей сессии через `<input type="file">` (blob URL). Для задач из КБ в `parseAttachmentUrls(task.task_image_path)` лежат `storage://...` refs, но signed URL резолвится только для первого refа и только в legacy-слоте `task_image_preview_url` (внутри `HWTasksSection.handleAddFromKB`). Галерея в `HWTaskCard` показывает `ImageIcon` плейсхолдер. То же самое в edit-mode: открыл существующий ДЗ → видишь иконки вместо фото.
4. **Нет fullscreen-просмотра фото** в конструкторе. В student runtime уже есть `TaskConditionGallery` в `GuidedHomeworkWorkspace.tsx:346` — fullscreen carousel с keyboard/touch navigation. В конструкторе репетитор не может проверить читаемость фото без открытия файла в Storage через DevTools.
5. **Поля «решение» и «источник» из КБ теряются в UI конструктора**. `kbTaskToDraftTask` сохраняет их в `kb_snapshot_solution` / `kb_snapshot_text` и потом пишет в `homework_kb_tasks` (провенанс). Но в `HWTaskCard` их не видно. Репетитор не знает, какое решение было эталонным (важно при правке краткого ответа / рубрики), и не знает источник (важно при миксе ФИПИ + авторских).
6. **Дефолт AI-вступления**: в `TutorHomeworkCreate` для нового ДЗ `disable_ai_bootstrap: true` (AI-вступление выкл.), но при редактировании существующего ДЗ или загрузке шаблона (`?? false`) — AI-вступление включается по умолчанию для legacy-assignments. Пользователь просит явного единого дефолта OFF.

### Боль

- Репетитор тратит 30–60с на «проверку, что правильная задача легла в корзину» — выход в конструктор, скролл, сверка.
- Путь через `HWDrawer` — короче (один клик «Создать черновик»), но из-за отсутствия превью репетитор вынужден идти длинным путём через конструктор, обесценивая drawer.
- `R4-1` (wedge) — «собрать ДЗ за 5–10 минут». Каждая микро-проверка вычитает из этого бюджета.
- Потерянные поля `solution` / `source_label` — репетитор не может быстро валидировать корректность ответа, полагается на «я верю КБ».

### Текущие «нанятые» решения

- Telegram чаты с учениками/родителями — пересылают ДЗ.
- Google Docs / Word со своей базой задач, копипаст.

---

## 3. Solution

### Описание

Четыре изменения, все additive, без миграций БД (кроме опционального поля при переносе `solution` в AI-контекст — отложено в P1):

- **P0-1**: убрать `showHWBadge` из `TutorLayout.tsx` (строки 125 и 183). Счётчик драфт-корзины остаётся в шапке КБ (`HWBadgeButton` в `KnowledgeBaseFrame.tsx`) — он там на своём месте.
- **P0-2**: `HWDrawer` — расширить до `w-[75vw] !max-w-none` (как `KBPickerSheet`). Карточки задач переключаем на паттерн `PickerTaskCard`: `<img>` thumbnail (signed URL через `getKBImageSignedUrl` / batch-резолв), `MathText` условия, inline-редактор условия/ответа остаётся (edit-кнопка). Превью изображений — через тот же `useEffect` + `getKBImageSignedUrl`, что уже работает в `KBPickerSheet.PickerTaskCard`.
- **P0-3**: `HWTaskCard` — на этапе рендера `PhotoThumbnail` для каждого storage ref, который не содержится в локальном `previewUrls` state, резолвим signed URL лениво. Это покрывает KB-import (из обоих флоу) и edit-mode.
- **P0-4**: `HWTaskCard.PhotoThumbnail` → click-to-zoom. Переиспользуем паттерн `TaskConditionGallery` из `GuidedHomeworkWorkspace.tsx:346` (fullscreen `Dialog` + keyboard/touch navigation + counter). Выделяем общий компонент в `src/components/homework/shared/FullscreenImageCarousel.tsx` (уже есть `PhotoGallery.tsx` в shared — см. search).
- **P0-review fix**: `HWDrawer.handleSendHomework` обязан сохранять все фото условия в dual-format `task_image_url` через `serializeAttachmentUrls(parseAttachmentUrls(...).slice(0, MAX_TASK_IMAGES))`, а не только первый ref. Иначе drawer показывает `+N фото`, но edit-mode получает только одно фото.
- **P0-review fix**: upload в `HWTaskCard` обязан показывать instant blob preview до завершения upload. Временные `blob:` refs допустимы только в локальном draft state на время upload и затем заменяются на storage refs; `blob:` URLs считаются direct URLs в `useKBImagesSignedUrls`.
- **P1-1**: `HWTaskCard.RubricField` — в collapsible «Критерии проверки» добавляем read-only блок «Эталонное решение (из БЗ)» — рендерится только если `task.kb_snapshot_solution` не пуст ИЛИ `kb_solution_image_refs.length > 0`. Текст через `MathText`, фото — как read-only thumbnails с click-to-zoom (без удаления/добавления). Кнопка «Скопировать в критерии» — copies to `rubric_text`. Ученик и AI это поле не видят.
- **P1-2**: `HWTaskCard` шапка — рядом с `SourceBadge` показываем `source_label` как маленький серый текст (`text-xs text-muted-foreground`). Только для репетитора (карточка вся — tutor surface). Read-only. Заодно отображаем в `HWDrawer` в шапке карточки.
- **P1-3**: AI-bootstrap по умолчанию OFF — меняем fallback с `?? false` на `?? true` в `TutorHomeworkCreate.tsx:171` (edit-mode load) и `:227` (template-apply). Явный инвариант: для любой точки входа в конструктор `meta.disable_ai_bootstrap` дефолтится в `true` (toggle = OFF) если в БД нет значения. Существующие ДЗ с явным `false` в БД остаются как есть.

### Ключевые решения

- **Где резолвить signed URL для KB-фото в HWTaskCard**. Вариант «прокидывать готовый signed URL в DraftTask» — тяжёлый: rebatch на каждое добавление/редактирование, истечение URL. Вариант «ленивый resolve в PhotoThumbnail» — дешёвый, не меняет контракт `DraftTask`. Выбор: ленивый resolve с кешем по storage ref на уровне HWTaskCard (через `useQuery` key `['kb', 'signed-url', ref]` если удобно, или локальный `useState` record).
- **Почему не трогаем схему `homework_tutor_tasks`**. Эталонное решение хранится в `homework_kb_tasks.task_solution_snapshot` (уже пишется `TutorHomeworkCreate.tsx:526`). В UI конструктора читаем из `task.kb_snapshot_solution` — это provenance поле `DraftTask`. При edit-mode `kb_snapshot_solution` нужно добавить в `getAssignment` response → рефакторим edge function `homework-api` / `/assignments/:id` и `convertAssignmentToDraftTasks` в `TutorHomeworkCreate.tsx:171`. Точечное расширение без миграции. (См. §5 и §8 Open Questions — это blocking для P1-1.)
- **Почему не рубрика-prefill**. `rubric_text` — авторский текст репетитора (критерии баллов). Автоматом зашить решение КБ — значит стирать его первой же правкой и смешивать два семантически разных поля. Read-only блок рядом сохраняет оба.
- **Почему tutor-only badge, а не строка в критериях**. `source_label` — метаданные задачи, не критерий проверки. В шапке рядом с `SourceBadge` он читается как breadcrumb. Внутри критериев — шум.
- **Click-to-zoom carousel — общий компонент или копипаст**. Пока копипаст фрагмента логики из `TaskConditionGallery` (в HWTaskCard нет realtime-signed-URL-hook `useStudentTaskImagesSignedUrls`, там другая resolve-логика). Вынос в `FullscreenImageCarousel` — parking lot, если паттерн повторится третий раз.

### Scope

**In scope (P0 — деплоим первым релизом):**
- P0-1: удалить HW-badge со вкладки `Домашки` (desktop + mobile nav).
- P0-2: расширить HWDrawer до 75vw и переписать рендер карточек в стиле `PickerTaskCard` (превью фото, MathText, edit-pencil остаётся).
- P0-3: ленивый resolve signed URL для KB/edit-mode фото в `HWTaskCard.PhotoThumbnail`.
- P0-4: click-to-zoom + fullscreen carousel для `PhotoThumbnail` в `HWTaskCard`.

**In scope (P1 — fast follow-up, деплой 1–2 дня после P0):**
- P1-1: read-only блок «Эталонное решение» в `RubricField` (текст + фото). Требует расширения `getAssignment` response полем `kb_snapshot_solution` + `kb_snapshot_solution_image_refs` (derived).
- P1-2: `source_label` tutor-only badge в шапке `HWTaskCard` и `HWDrawer` карточек. Требует расширения `DraftTask.kb_source_label` + `getAssignment` response.
- P1-3: дефолт `disable_ai_bootstrap = true` в edit-mode load + template-apply.

**Out of scope:**
- Передача эталонного решения в AI как контекст для оценки (`reference_solution` field + edge function + миграция). Вариант C из AskUserQuestion отвергнут. Если сигнал от Егора покажет «AI ошибается, хотя решение в БД есть» — отдельная SPEC.
- Показ эталонного решения ученику после сдачи. Сейчас нет UX-точки для этого — если появится, отдельная SPEC.
- Редактируемый `source_label` в конструкторе (вариант C вопроса 2). Источник фиксируется в КБ, не в ДЗ.
- Унификация `HWDrawer` и `KBPickerSheet` в один компонент. Разные user-flows (корзина vs picker), не сливаем.
- Drag-and-drop reorder в `HWDrawer` (уже есть `reorderTasks` в store, но UI в drawer не рисует handle). Нерелевантно к жалобе пользователя.
- Миграция `hwDraftStore` → серверный drafts-in-DB. Текущий `persist` в localStorage работает, проблем пользователь не жалуется.

**Later (parking lot в конце):**
- Общий `FullscreenImageCarousel` компонент для student + tutor surfaces.
- Кнопка «Эталонное решение → скопировать в критерии проверки» в `RubricField`.

---

## 4. User Stories

### Репетитор

> Когда я добавил 4 задачи в драфт-корзину ДЗ через каталог Сократа, я хочу открыть sheet «Домашнее задание» и сразу увидеть превью фото каждой задачи, чтобы убедиться, что нужные задачи в корзине — без выхода в конструктор.

> Когда я открыл конструктор ДЗ с импортированными из КБ задачами, я хочу видеть фото условий прямо в карточке и иметь возможность кликом раскрыть фото на весь экран, чтобы проверить читаемость рисунков и графиков.

> Когда я редактирую задачу, импортированную из КБ, я хочу видеть рядом эталонное решение и источник (ФИПИ/автор), чтобы не ошибиться при правке ответа или критериев.

> Когда я открываю tab «Домашки» в навигации, я хочу попадать в список ДЗ — без отвлекающих счётчиков от корзины, которая живёт в другом месте.

---

## 5. Technical Design

### Затрагиваемые файлы

**P0:**
- `src/components/tutor/TutorLayout.tsx` — удалить `showHWBadge` логику в desktop (L125–139) и mobile (L183–200) nav; удалить импорт `useHWTaskCount` если больше не нужен (остаётся в `KnowledgeBaseFrame` и `HWDrawer`).
- `src/components/kb/HWDrawer.tsx` —
  - `SheetContent className`: `w-[420px] max-w-[90vw]` → `w-[75vw] !max-w-none sm:max-w-none`.
  - Карточка задачи: добавить `<img>` thumbnail ниже текста (паттерн из `KBPickerSheet.PickerTaskCard` L143–157); локальный `useState` preview URL + `useEffect` с `getKBImageSignedUrl(firstRef)`.
  - Сохранить `MathText` условия и inline edit-режим как сейчас.
- `src/components/tutor/homework-create/HWTaskCard.tsx` —
  - `PhotoThumbnail` props: принять `resolvedUrl?: string | null` в дополнение к `previewUrl`. Render `<img src={previewUrl ?? resolvedUrl ?? ...}>`.
  - В `HWTaskCard` добавить `useKBThumbs(taskRefs)` + `useKBThumbs(rubricRefs)` — хук, который для каждого ref без записи в `previewUrls` резолвит signed URL через `getKBImageSignedUrl` и возвращает `Record<ref, url>`.
  - Добавить state `zoomIndex: number | null` + fullscreen `<Dialog>` с carousel (паттерн `TaskConditionGallery` из `GuidedHomeworkWorkspace.tsx:346`). Поддержка: prev/next кнопки, keyboard Arrow keys, touch swipe (`TAP_THRESHOLD_MS`, `SWIPE_THRESHOLD_PX` — переиспользовать константы), счётчик `1/N`, `X` закрыть.
  - Для rubric-фото тот же carousel (может делить state / `Dialog`).

**P1:**
- `src/components/tutor/homework-create/HWTaskCard.tsx.RubricField` — добавить read-only блок `{task.kb_snapshot_solution || kbSolutionRefs.length > 0 ? <ReferenceSolution /> : null}`. Компонент `ReferenceSolution` рендерит `MathText(kb_snapshot_solution)` + ряд thumbnails из `kb_snapshot_solution_image_refs` с click-to-zoom.
- `src/components/tutor/homework-create/HWTaskCard.tsx` шапка — после `<SourceBadge>` добавить `{task.kb_source_label && <span className="text-xs text-muted-foreground">{task.kb_source_label}</span>}`.
- `src/components/tutor/homework-create/types.ts` — расширить `DraftTask`:
  - `kb_snapshot_solution_image_refs?: string | null` (dual-format attachment ref, как `task_image_path`).
  - `kb_source_label?: string | null`.
- `src/components/tutor/homework-create/HWTasksSection.tsx.kbTaskToDraftTask` — прокинуть `task.solution_attachment_url → kb_snapshot_solution_image_refs` и `task.source_label → kb_source_label` в возвращаемый `draft`.
- `src/pages/tutor/TutorHomeworkCreate.tsx:171` (edit-mode `convertAssignmentToDraftTasks`) — читать `kb_snapshot_solution`, `kb_snapshot_solution_image_refs`, `kb_source_label` из response, маппить в DraftTask. Требует расширения backend response (см. ниже).
- `src/pages/tutor/TutorHomeworkCreate.tsx:91, :810` — оставить `disable_ai_bootstrap: true` как есть (уже OK).
- `src/pages/tutor/TutorHomeworkCreate.tsx:171, :227` — `disable_ai_bootstrap: a.disable_ai_bootstrap ?? false` → `?? true`.
- `supabase/functions/homework-api/index.ts` — `handleGetAssignment` (или аналог) должен join-ить `homework_kb_tasks` и прокидывать на каждую задачу: `kb_snapshot_solution`, `kb_source_label`. `kb_snapshot_solution_image_refs` — derived из `kb_tasks.solution_attachment_url` по `task_id` (JOIN на канонический `kb_tasks` copy в каталоге).

### Data Model

**Без миграций для P0.**

**Для P1** — без миграций. Новые данные приходят из уже существующих таблиц (`homework_kb_tasks.task_solution_snapshot`, `kb_tasks.source_label`, `kb_tasks.solution_attachment_url`). Изменяется только backend response на `GET /assignments/:id` (additive поля) и TS-тип `DraftTask`.

### API

- **P1**: extend `GET /assignments/:id` response. Каждая задача получает optional поля:
  ```ts
  kb_snapshot_solution?: string | null;           // from homework_kb_tasks.task_solution_snapshot
  kb_snapshot_solution_image_refs?: string | null; // dual-format ref, derived from kb_tasks.solution_attachment_url if kb_task_id still exists
  kb_source_label?: string | null;                // from kb_tasks.source_label if kb_task_id still exists
  ```
  Fallback: если исходная задача удалена из КБ (`kb_task_id` не существует в `kb_tasks`) — `kb_snapshot_solution` берём из `homework_kb_tasks`, остальные = `null`.

### Миграции

Нет.

---

## 6. UX / UI

### UX-принципы (из doc 16)

- **«AI = draft + action, не chat-only»**. Эталонное решение — это draft-инфо в помощь репетитору при правке рубрики. Не чат, не генерация.
- **«Не заставляй репетитора вспоминать, что было в КБ»**. P1-1/P1-2 — это прямая реализация принципа: контекст КБ остаётся рядом с задачей в ДЗ.
- **«Wedge-first»**. Лишний tab-badge, узкий drawer, невидимые фото — всё режет 5–10 минут на сборку ДЗ. Убираем трение.

### UI-паттерны (из doc 17)

- **Sheet-drawer справа**: используем уже канонизированный паттерн `w-[75vw] !max-w-none`, как `KBPickerSheet`. Не вводим третью ширину.
- **Fullscreen image carousel**: `Dialog` + counter + keyboard + touch-swipe. Паттерн из `TaskConditionGallery` (student runtime) — тот же.
- **Tutor-only metadata (`source_label`)**: `text-xs text-muted-foreground` рядом с badge. Запрет emoji в UI chrome (см. `.claude/rules/90-design-system.md` anti-patterns).
- **Read-only КБ-блок в рубрике**: `bg-socrat-surface` card внутри collapsible, с заголовком uppercase `text-[11px] tracking-[0.12em]` — паттерн из `src/components/kb/TaskCard.tsx:345` (секция «Ответ»/«Решение»). Визуально консистентно с витриной КБ.

### Anti-drift guardrails (из CLAUDE.md)

- Не вводить новый top-level route в tutor-домене.
- Не расширять драйвер `HWDrawer` в сторону общего «drawer для всего» — он остаётся строго корзиной КБ → ДЗ.
- Ученик не должен видеть `kb_snapshot_solution` ни на каком пути — `getStudentAssignment` уже не возвращает это поле (проверить).

### iOS Safari / cross-browser

- `PhotoThumbnail` `<img>` — `loading="lazy"`.
- Fullscreen `<Dialog>`: `touch-pan-x` на swipe-container; keyboard `ArrowLeft/Right` handlers; explicit `z-[60]` so it opens above Sheet; image height cap uses `dvh` (`max-h-[75dvh]`) rather than `vh`.
- `<select>`/`<input>` в HWDrawer edit-режиме — `text-base` (16px) уже так, не менять.
- HWDrawer width `w-[75vw]` на mobile безопасен — `!max-w-none` + `sheet` автоматически респектит `max-w-[100vw]` через Radix.

---

## 7. Validation

### Acceptance Criteria (testable)

**P0:**
- **AC-1** *(P0-1)*: добавив 1+ задачу в драфт-корзину из каталога Сократа, на десктопе и мобиле в топ-навигации `/tutor/homework` tab НЕ содержит dot-badge со счётчиком.
- **AC-2** *(P0-1)*: счётчик в шапке КБ (`HWBadgeButton` «ДЗ · N») остаётся и обновляется.
- **AC-3** *(P0-2)*: `HWDrawer` открывается шириной `~75vw` (визуально идентично `KBPickerSheet`). На каждой карточке задачи отображается превью фото KB-задачи (а не `<Image className="h-3 w-3" />` плейсхолдер), если у задачи есть `attachmentSnapshot`.
- **AC-3a** *(P0-review)*: при создании черновика через `HWDrawer` все фото условия сохраняются в `homework_tutor_tasks.task_image_url` в dual-format до `MAX_TASK_IMAGES`; edit-mode видит те же фото, которые drawer показывал через `+N фото`.
- **AC-4** *(P0-3)*: в `HWTaskCard` в конструкторе `/tutor/homework/create` после импорта задачи из КБ с фото — `PhotoThumbnail` рендерит `<img>` (не `ImageIcon` placeholder). То же при загрузке существующего ДЗ через `/tutor/homework/:id/edit`.
- **AC-5** *(P0-4)*: клик по `PhotoThumbnail` в `HWTaskCard` открывает fullscreen `Dialog` с текущим фото. При 2+ фото работают: ArrowLeft/Right keyboard, touch swipe, prev/next кнопки, счётчик `1/N`, кнопка X и backdrop-клик закрывают viewer.
- **AC-6** *(P0-4)*: тот же fullscreen работает для rubric-фото (`MAX_RUBRIC_IMAGES`), а новое фото через upload появляется как instant blob preview до завершения upload / signed URL resolution.

**P1:**
- **AC-7** *(P1-1)*: в `HWTaskCard` при `task.kb_snapshot_solution` не пуст ИЛИ `task.kb_snapshot_solution_image_refs` не пусто — в раскрывашке «Критерии проверки» показан read-only блок «Эталонное решение» (MathText + фото с click-to-zoom). Блок НЕ редактируется. Блок НЕ содержится в ответе `getStudentAssignment`.
- **AC-8** *(P1-2)*: в шапке `HWTaskCard` и в карточке `HWDrawer` для KB-задачи с непустым `source_label` отображается мелкий серый текст `source_label` (tutor-only). Если source_label пустой — ничего не рендерится.
- **AC-9** *(P1-3)*: открыв существующее ДЗ (созданное до этой фичи, с `disable_ai_bootstrap = null` в БД) в `/tutor/homework/:id/edit`, toggle «AI-вступление к задачам» находится в положении OFF (не ON).
- **AC-10** *(P1-3)*: для нового ДЗ при нажатии «Создать ДЗ» без раскрытия «Расширенных параметров» — `disable_ai_bootstrap` отправляется как `true` (AI bootstrap OFF) в backend.

### Как проверяем успех?

**Leading (3–7 дней):**
- Репетитор собирает ДЗ через `HWDrawer` (путь A) с той же частотой или выше, чем раньше (сейчас ~0 раз — drawer был бесполезен). Метрика: # созданных `homework_tutor_assignments.title LIKE 'ДЗ из Базы знаний%'` / неделя.
- Время от добавления первой задачи в корзину до нажатия «Создать черновик» — снижение (proxy для «репетитор не ходит в конструктор проверять»).

**Lagging (2–4 недели):**
- Егор в еженедельном звонке не называет КБ-flow как точку трения.
- Доля ДЗ, созданных с ≥1 задачей из КБ: остаётся ≥70% (не ломаем существующий путь).

### Связь с pilot KPI

Pilot playbook `doc 18` wedge — «сборка ДЗ за 5–10 минут». Фича полирует два самых частых пути (драйвер vs конструктор) в этом окне. Без неё репетитор тратит ~30–60с на каждую задачу на проверку превью → выход из wedge-окна на 10+ задач.

### Smoke check

```bash
npm run lint && npm run build && npm run smoke-check
```

**Automated validation (2026-04-15):**
- `npm run build` — PASS.
- `npm run smoke-check` — PASS; existing non-blocking warning about small input font-size remains.
- `npx eslint src/components/kb/HWDrawer.tsx src/components/tutor/homework-create/HWTaskCard.tsx src/components/homework/shared/FullscreenImageCarousel.tsx src/hooks/useKBImagesSignedUrls.ts` — PASS.
- `npm run lint` — FAIL on pre-existing repo-wide lint debt outside this feature (`any`, hook deps, regex warnings/errors); changed feature files pass targeted ESLint.

Ручная проверка (P0):
1. Добавить 2 задачи с фото из каталога → tab «Домашки» без badge ✅.
2. Открыть `HWDrawer` → шире, чем было; превью фото видны ✅.
3. Клик «+ Добавить из базы» в `/tutor/homework/create` → добавить задачу с фото → превью в карточке ✅.
4. Клик по превью → fullscreen ✅. Arrow keys, swipe ✅.

Ручная проверка (P1):
5. KB задача с `solution` и `source_label` → в `HWTaskCard` видны в нужных местах, у ученика `StudentHomeworkTask` — нет ✅.
6. Старое ДЗ в edit-mode → toggle AI-вступление OFF ✅.

---

## 8. Risks & Open Questions

| Риск | Вероятность | Митигация |
|---|---|---|
| Lazy signed URL resolve в `HWTaskCard` ломает перформанс при 5 задачах × 5 фото = 25 запросов на рендер | Средняя | Кешировать через React Query (`['kb', 'signed-url', ref]`, `staleTime: 55 * 60 * 1000`). Сейчас signed URL TTL 60 мин. Batch через общий endpoint — parking lot. |
| Расширение `HWDrawer` до 75vw ломает UX на `/tutor/knowledge/catalog` где sheet оверлеит контент | Низкая | Drawer открывается поверх — не взаимодействует с фоном. Проверяем визуально на Safari/Chrome. |
| Fullscreen carousel конфликтует с parent `<Sheet>` / другими Radix стеками | Низкая | `Dialog` имеет свой portal, z-index. Smoke тест в KBPickerSheet и HWTaskCard одновременно. |
| Переход `disable_ai_bootstrap ?? false` → `?? true` меняет поведение для legacy ДЗ | Низкая | Legacy ДЗ без явного значения в БД (`null`) получат OFF-дефолт. Ученики могли уже привыкнуть к AI-intro для старых ДЗ — но в job-graph AI-intro = optional, не core value. Приемлемо. |
| `kb_snapshot_solution_image_refs` в ответе backend — дополнительный JOIN на `kb_tasks` по `kb_task_id`, задача могла быть удалена | Низкая | `LEFT JOIN` + `null` fallback. В UI `task.kb_snapshot_solution_image_refs ?? null`. |

### Открытые вопросы (закрыты 2026-04-15)

| Вопрос | Решение | Обоснование |
|---|---|---|
| Кешировать signed URL через React Query или локальный state? | **React Query**, новый hook `useKBImagesSignedUrls(refs)` | `HWTaskCard` не `React.memo` → reorder/edit ремоунтит карточки → локальный state теряет кеш → мерцание плейсхолдеров. Cross-component cache (HWDrawer + HWTaskCard шарят photos). TTL signed URL 60 мин → `staleTime: 55min` = почти ноль повторов. Канон уже есть — `useStudentTaskImagesSignedUrls`. |
| Вынести `FullscreenImageCarousel` в shared сейчас? | **Да**, создаём в `src/components/homework/shared/FullscreenImageCarousel.tsx` и используем только в tutor-коде | Это уже второй use case — третий копипаст = расхождение touch/keyboard UX. Student `TaskConditionGallery` **не трогаем** — миграция на shared перемещается в parking lot. Ноль риска для student runtime. |
| Удалённая KB-задача — что показывать в `source_label`? | **Ничего**, slot не рендерится; текст решения остаётся из `homework_kb_tasks.task_solution_snapshot` | `source_label` пустой у 99% задач (репетитор не заполняет в КБ). Добавить «задача удалена» = false positive → шум. `SourceBadge` («из БЗ») всё равно виден — провенанс сохраняется. Текст решения snapshot'ится при создании, поэтому LEFT JOIN на `kb_tasks` нужен только для `solution_attachment_url` — если null → фото решения не показываем, текст остаётся. |

---

## 9. Implementation Tasks

Переносятся в `kb-hw-flow-polish/tasks.md` после approve. Нарезка:

**P0 релиз (1 день):**
- [ ] TASK-1: Убрать HW-badge с tab «Домашки» (`TutorLayout.tsx`).
- [ ] TASK-2: Расширить `HWDrawer` до 75vw + отрисовать превью фото в карточках (паттерн `PickerTaskCard`).
- [ ] TASK-3: `HWTaskCard` — ленивый resolve signed URL для KB/edit-mode фото.
- [ ] TASK-4: `HWTaskCard` — fullscreen carousel для task + rubric фото.
- [ ] TASK-5: Smoke check + ручная QA (Chrome desktop, Safari iOS).

**P1 релиз (1–2 дня после P0):**
- [ ] TASK-6: Backend — расширить `getAssignment` response полями `kb_snapshot_solution`, `kb_snapshot_solution_image_refs`, `kb_source_label`.
- [ ] TASK-7: `kbTaskToDraftTask` + `DraftTask` type — прокинуть `solution_attachment_url` и `source_label`.
- [ ] TASK-8: `HWTaskCard.RubricField` — read-only блок «Эталонное решение».
- [ ] TASK-9: `HWTaskCard` шапка + `HWDrawer` карточка — `source_label` tutor-only badge.
- [ ] TASK-10: `TutorHomeworkCreate` — `disable_ai_bootstrap ?? true` в edit-mode и template-apply.
- [ ] TASK-11: QA: ученик не видит эталонное решение на `/student/homework/:id`; проверка `getStudentAssignment` response.

---

## Parking Lot

- **`FullscreenImageCarousel` — общий компонент** (tutor + student). Revisit после третьего копипаста или когда появится разница в поведении.
- **Кнопка «Эталонное решение → скопировать в критерии проверки»** в `RubricField`. Revisit после P1, если Егор попросит.
- **Передача эталонного решения в AI** как контекст для оценки detailed_solution. Revisit если hint-quality / grading-quality signal покажет, что AI недооценивает по сравнению с эталоном.
- **Показ эталонного решения ученику после сдачи** как обучающий материал. Revisit когда появится UX-точка «разбор ошибок» на student-side.
- **Drag-and-drop reorder в `HWDrawer`**. Revisit если корзина становится 6+ задач регулярно.
- **Серверный drafts-in-DB вместо localStorage persist**. Revisit если репетиторы теряют драфты при переходе между устройствами.
- **Batch signed-URL endpoint для KB-attachments** (по аналогии с `/assignments/:id/tasks/:taskId/images` для homework). Revisit при регрессии перформанса.

---

## Checklist перед approve

- [x] Job Context заполнен (секция 0) — R4-1, R4-3
- [x] Привязка к Core Job из Графа работ
- [x] Scope чётко определён (in/out/later)
- [x] UX-принципы из doc 16 учтены (wedge-first, draft+action, context near task)
- [x] UI-паттерны из doc 17 учтены (75vw sheet, fullscreen Dialog carousel)
- [x] Pilot impact описан (wedge 5–10 min)
- [x] Метрики успеха определены (leading: HWDrawer usage, lagging: Егор feedback)
- [x] High-risk файлы не затрагиваются без необходимости (только `TutorHomeworkCreate.tsx` — уже в high-risk, минимальные правки)
- [x] Student/Tutor изоляция не нарушена — student runtime не получает `kb_snapshot_solution` / `kb_source_label`
- [x] AC testable (10 штук, все PASS/FAIL)
- [x] Фазы: P0 (4 AC) + P1 (4 AC) самодостаточны, каждая деплоится отдельно
- [x] Requirements приоритизированы (4 P0, 3 P1)
- [x] Parking Lot сформулирован
