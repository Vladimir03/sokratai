# Knowledge Base (KB) Module

Модуль живёт в Tutor-домене:
- `src/pages/tutor/knowledge/` — страницы
- `src/components/kb/` — компоненты
- `src/components/kb/ui/` — UI-утилиты KB (MathText, CopyTaskButton, stripLatex, preprocessLatex, SourceBadge, ContextMenu)
- `src/hooks/useKnowledgeBase.ts`, `src/hooks/useFolders.ts` — хуки
- `src/types/kb.ts` — типы
- `src/stores/hwDraftStore.ts` — Zustand store для корзины ДЗ

## Управление папками в «Моя база» (2026-03-28)

Репетитор может переименовать и удалить папки в KB.

**UI:**
- `FolderCard.tsx` — inline иконки Pencil/Trash2 (desktop: appear on hover, mobile: always visible)
- `FolderPage.tsx` — Pencil/Trash2 рядом с заголовком текущей папки
- `RenameFolderModal.tsx` — модалка с pre-filled input
- `DeleteFolderDialog.tsx` — подтверждение с рекурсивными счётчиками (подпапки + задачи)

**Хуки:**
- `useRenameFolder()` — мутация, invalidates `['tutor', 'kb']`
- `useDeleteFolder()` — рекурсивно удаляет задачи во ВСЕХ дочерних папках перед удалением корневой
- `countFolderDescendants(folderId)` — возвращает `{ subfolderCount, taskCount }` для всего дерева

**Known tech debt:** удаление папки не чистит blob-ы вложений в `kb-attachments` storage (orphaned objects)

## LaTeX-рендеринг в KB (Sprint 1, 2026-03-17)
- `MathText` (`src/components/kb/ui/MathText.tsx`) — lazy-loaded KaTeX рендеринг
- `preprocessLatex` (`src/components/kb/ui/preprocessLatex.ts`) — нормализация LaTeX-делимитеров
- `stripLatex` (`src/components/kb/ui/stripLatex.ts`) — plain-text fallback
- **Правило**: hasMath = false → plain text (нулевой overhead KaTeX); hasMath = true → lazy ReactMarkdown + remarkMath + rehypeKatex
- **Не импортировать** MathText/KaTeX в `src/components/ui/*` (performance.md)

## Архитектура двух пространств + Source→Copy Model (Moderation V2)
- **Каталог Сократа** — read-only витрина. Читает **ТОЛЬКО** `kb_tasks WHERE owner_id IS NULL AND moderation_status = 'active'`
- **Моя база** (kb_folders + kb_tasks where owner_id = user) — личные папки
- **Запрос каталога (обычные пользователи)**: `fetch_catalog_tasks_v2(topic_id)` — фильтрует owner_id=NULL + moderation_status='active'
- **Запрос каталога (модераторы)**: `fetch_catalog_tasks_all(topic_id)` — возвращает все статусы для модераторов
- **Модераторы**: роль через `has_role(uid, 'moderator')` (таблица `user_roles`), не хардкод email
- **Source→Copy**: задача-источник в папке «сократ» модератора → каноническая публичная копия (owner_id=NULL) в каталоге
  - `published_task_id` на источнике → указывает на публичную копию
  - `source_task_id` на копии → указывает на источник
- **Auto-publish**: перенос в «сократ» → триггер автоматически создаёт публичную копию
- **Auto-resync**: правка источника в «сократ» → триггер обновляет публичную копию
- **Fingerprint dedup**: `kb_normalize_fingerprint(text, answer, attachment_url)` + `pg_advisory_xact_lock`
  - Fingerprint = md5(text + '::' + answer + '::' + attachment_url)
  - Первый опубликовавший fingerprint побеждает; дубли → `hidden_duplicate`
  - Правка, создающая дубль → `RAISE EXCEPTION` (save blocked)
- **RPCs**: `kb_mod_unpublish(p_published_task_id)`, `kb_mod_reassign(p_published_task_id, p_new_source_task_id)`
- **Security**: `kb_publish_task()` / `kb_resync_task()` — REVOKE FROM PUBLIC, authenticated (только триггеры)
- **RLS**: non-moderators видят только `moderation_status = 'active'` каталожные задачи

## Модерационный пайплайн (KB)
- У каждого модератора: папка «Черновики для сократа» (скрыта) + «сократ» (auto-publish в каталог)
- Поток: SQL-сид → Черновики → ревью → перенос в «сократ» (+ topic_id) → триггер создаёт публичную копию → каталог
- Подпапки в «сократ» разрешены — `kb_is_in_socrat_tree()` рекурсивно проверяет

## Видимость hidden_duplicate для модераторов (2026-03-30)
- Новый RPC `fetch_catalog_tasks_all(topic_id)` — модераторы видят ВСЕ статусы
- `useCatalogTasksAll(topicId, enabled)` — query key `['tutor', 'kb', 'catalog-tasks-all', topicId]`
- `CatalogTopicPage.tsx` — если `isModerator`, использует `useCatalogTasksAll`

## Триггеры модерации (точные имена)
- `trg_kb_before_update_block_dup` — BEFORE UPDATE, блокирует дубли fingerprint
- `trg_kb_after_update_moderation` — AFTER UPDATE, auto-publish + auto-resync
- `trg_kb_after_insert_moderation` — AFTER INSERT, auto-publish если задача вставлена в «сократ»

## Самообслуживаемый каталог + раздел «Олимпиады» (2026-06-11)

Каталог стал самообслуживаемым для модератора (Егор) + добавлен раздел «Олимпиады». Аддитивно, **без переписывания** read-path каталога. Контекст: темы/подтемы заводились SQL-миграциями (модератор не мог менять без кода), а олимпиадные задачи не помещались в ЕГЭ/ОГЭ-модель. Миграции `20260611130000…130300`. Spec/лог: `~/.claude/plans/wild-nibbling-comet.md` + memory `project_kb_self_serve_olympiad.md`.

**Схема (additive, `20260611130000`):**
- `kb_topics.kind TEXT NOT NULL DEFAULT 'exam' CHECK ('exam'|'olympiad')` + `subject TEXT DEFAULT 'physics'` (закладка под математику) + `exam` стал **NULLABLE** (олимпиадные темы: `exam=NULL`, `kind='olympiad'`). **Enum `exam_type` НЕ трогали** (готча `ALTER TYPE ADD VALUE`) — `kind` чище.
- `kb_folders.catalog_topic_id`/`catalog_subtopic_id` — биндинг папки к теме публикации (папка «помнит» тему → повторная публикация в один клик).
- View `kb_topics_with_counts` — `subject`/`kind` добавлены **В КОНЕЦ** (CREATE OR REPLACE требует сохранить порядок старых колонок).

**Модераторская таксономия (`20260611130100`, SECURITY DEFINER + `kb_require_moderator()` = `has_role(uid,'moderator')` + REVOKE FROM PUBLIC + GRANT authenticated, рус. ошибки rule 97):** `kb_mod_create/update/delete_topic` + `…_subtopic`. `kind` после создания не меняется. **Delete-гейты:** тема — нет задач (`kb_tasks.topic_id`) И нет материалов (`kb_materials.topic_id`, оба FK RESTRICT); подтема — нет задач. `kb_topics`/`kb_subtopics` остаются SELECT-only для authenticated (нет write-политик) → запись ТОЛЬКО через эти RPC.

**Публикация папки (`20260611130200`, `kb_publish_folder_to_catalog(folder, topic, subtopic?)`):** модель **source→copy через существующий `kb_publish_task`** (НЕ destructive `promote_folder_to_catalog`). Личная папка = редактируемый источник, каталог = проекция; рубрика НЕ копируется (whitelist `kb_publish_task`), fingerprint-dedup, audit. Инварианты:
- **Skip уже опубликованных** (`published_task_id IS NOT NULL`) — идемпотентная повторная публикация.
- **Re-read `published_task_id` после `UPDATE`** перед явным `kb_publish_task`: если папка в дереве «сократ», `UPDATE topic_id` авто-публикует через CASE A триггера → явный вызов упал бы «already published» и откатил батч.
- **Нормализация по теме:** `subtopic_id = p_subtopic_id` (НЕ `COALESCE` — иначе подтема от старой темы); `exam = <exam темы>`; `kim_number = NULL` у олимпиадных (иначе КИМ-маркер на карточке + экзам-задачи выпадали из поиска).
- Пишет биндинг `kb_folders.catalog_topic_id/_subtopic_id`.

**Broadened resync (`20260611130200`):** `trg_fn_kb_after_update_moderation` CASE B (resync опубликованного источника) **больше НЕ гейтится** `kb_is_in_socrat_tree` → правка источника синхронит каталог из любой папки. CASE A (авто-публикация при переносе в «сократ») не тронут. `kb_resync_task` сам ловит коллизии fingerprint.

**Anti-leak рубрики — legacy `promote` нейтрализован (`20260611130300`):** `promote_folder_to_catalog` (прямой `owner_id=NULL` без strip рубрики, в обход dedup) **REVOKE’нут от authenticated/PUBLIC** (в UI/edge не вызывается; миграции-сиды от superuser работают) + **scrub** `UPDATE kb_tasks SET rubric_text=NULL, rubric_image_urls=NULL WHERE owner_id IS NULL`. `kb_publish_task` INSERT и `kb_resync_task` UPDATE рубрику не копируют → каталожные копии чисты by construction. **Любой новый путь публикации — ТОЛЬКО через `kb_publish_task`**, не прямой `owner_id=NULL`.

**Поиск kind-aware (`20260611130300`):** `kb_search` получил параметр `kind_filter TEXT DEFAULT NULL` (DROP+CREATE, старые 4-арг вызовы работают). `'olympiad'` → `t.kind='olympiad'` / каталожные задачи под олимпиадной темой; иначе ветка `exam` (как было). Без этого олимпиадный поиск был пуст (`t.exam=NULL ≠ exam_filter`).

**Frontend:**
- Фильтр витрины — `CatalogFilter = 'ege'|'oge'|'olympiad'` (3-я кнопка «Олимпиады»). `useTopics(filter)`: `olympiad`→`kind='olympiad'`, ege/oge→`exam=filter AND kind='exam'`. `useTopics()` без аргумента = все темы (селекторы в `CreateTaskModal`/`KBPickerSheet`).
- Олимпиадная тема: группировка задач **по подтемам** (`groupTasksBySubtopic`, не `groupTasksByKim`); № КИМ скрыт; `ExamBadge` рисует по `kind` (бейдж «Олимпиада», т.к. `exam=NULL`).
- `CatalogTaskGroups` расширен **backward-compat**: `KimGroup` получил опц. `key`/`label` (КИМ-группы их не задают → пикер ДЗ не тронут, rule 40).
- Модераторский UI за `useIsModerator()`: «＋ Тема» на лендинге, «Редактировать тему» + `SubtopicManager` на странице темы, «В каталог» (`PublishFolderModal`) на странице папки. Новые: `TopicEditorModal`, `SubtopicManager`, `PublishFolderModal`, `kbModeratorApi.ts`, `useModeratorCatalog.ts`.
- `kbModeratorApi.rpcError`: кириллица в message → показываем (rule 97), иначе рус. fallback + `console.warn` сырого текста (диагностика).

**Контент:** математика отложена (решение владельца) — колонка `subject` заложена, это добавление контента+под-фильтра, не схемы. Олимпиадный контент = физика Егора.

**При расширении:** новая запись в `kb_topics`/`kb_subtopics` — через `kb_mod_*` RPC (не прямой PostgREST); новый путь публикации — через `kb_publish_task` (рубрика не утекает); новый предмет/измерение — additive колонка + фильтр; олимпиадные темы — `exam=NULL`, без № КИМ; смена сигнатуры `useTopics`/`KimGroup` — проверить `KBPickerSheet`/`CreateTaskModal` (rule 40 risk-zone).

## Storage protection (2026-05-20, миграция `20260520120000`)

`trg_protect_kb_attachments_from_delete` — BEFORE DELETE на `storage.objects`. Блокирует удаление объекта из bucket `kb-attachments`, если хоть один `kb_tasks.attachment_url` или `kb_tasks.solution_attachment_url` ссылается на него.

**Что блокирует:** ручное удаление файлов через Lovable Cloud Storage UI. Именно так Егор потерял несколько файлов из папки `a7212758-.../` в мае 2026 — канонические копии в каталоге показывали пустые карточки.

**Что НЕ блокирует:** application-level flows безопасны и сначала чистят kb_tasks ref, потом удаляют storage:
- `useKnowledgeBase.removeTask` — DELETE FROM kb_tasks → потом `deleteKBTaskImage`
- `EditTaskModal` onSuccess — UPDATE с новым attachment_url → потом delete removed refs
- `CreateTaskModal` onError — orphan blob cleanup до INSERT

**При добавлении нового callsite на `deleteKBTaskImage`:** сначала UPDATE/DELETE kb_tasks ref, потом storage. Иначе триггер выбросит `KB_STORAGE_PROTECTED`.

**При намеренном orphan-cleanup** (фикс для битых refs): сначала `UPDATE kb_tasks SET attachment_url=NULL`, потом удаление файлов.

**Incident runbook** (диагностика + recovery SQL + история инцидентов): `docs/delivery/engineering/runbooks/kb-broken-storage-refs.md`. Использовать при появлении amber-плашки «Фото недоступно» в каталоге или 400 на `/storage/v1/object/sign/kb-attachments/...` в DevTools.

## Дизайн-токены KB
- Primary: `bg-accent` / `fill-accent` (socrat green, #1B6B4A)
- Folder: `bg-socrat-folder` / `bg-socrat-folder-bg` (purple, #5B5FC7)
- Accent: `bg-socrat-accent` (orange, #E8913A, "Моя" badge)
- Surface hover: `hover:bg-socrat-surface` (#F7F6F3)

## Рубрика (критерии) в «Моей базе» (field-parity fix, 2026-06-03)

`kb_tasks.rubric_text` + `rubric_image_urls` (миграция `20260603120100`, dual-format как у homework). Критерии — **first-class поле задачи в личной базе** (запрос Эмилии: «добавила из базы — критерии не прикрепились»).

**Каталог чист (КРИТИЧНО):** moderation-триггеры публикации (`kb_publish_task` / `kb_resync_task`, `20260318150000`) копируют **явный список колонок без rubric** → каталожная копия (`owner_id IS NULL`) рубрику не несёт. Личные строки видит только owner (RLS). При добавлении нового поля в `kb_tasks`, которое должно/НЕ должно попадать в Каталог — синхронно реши, вносить ли его в INSERT-список триггеров.

**Путь рубрики (правь ВСЕ):** `KBTask`/`Create`/`UpdateKBTaskInput` типы → `kbTaskToDraftTask` (импорт в ДЗ, обрезка до `MAX_RUBRIC_IMAGES`=3) → `hwDraftStore.addTask`+`HWDrawer` (path B) → `handleSaveTasksToKB` (save-back из ДЗ) → `Create/EditTaskModal` («Критерии оценки», текст; update через `.update(input)` не зануляет невыбранные поля). Детали — rule 40 «Field-parity (2026-06-03)».

## Форма задачи: каскад классификации + авто-балл + источники + серия (запрос Егора, 2026-06-21)

Упрощение загрузки задач в «Мою базу» (`CreateTaskModal` / `EditTaskModal`). Аддитивно поверх self-serve каталога. Миграции `20260621120000` (difficulty) + `20260621120100` (kb_sources). НЕ задеплоено. Build-лог: memory `project_kb_task_loader_egor_2026_06_21.md`. План `~/.claude/plans/zesty-discovering-sphinx.md`.

**Общий каскад — `src/components/kb/TaskClassificationFields.tsx` (НЕ дублировать в модалках):** Тип (`Не указан / ЕГЭ / ОГЭ / Олимпиада`) → фильтрует темы (`useTopics(filter)`) → Тема → Подтема. Оба модала рендерят этот компонент; каждый держит state + хендлеры сброса (смена типа → сброс темы/подтемы/балла + очистка противоположного КИМ↔сложность; смена КИМ → сброс ручного балла; смена темы → сброс подтемы). Сброс подтемы — **в хендлере, не в useEffect** (иначе клобберит prefill на mount — урок EditTaskModal).

**`kb_tasks.difficulty SMALLINT 1–5` (олимпиада) — КЛАССИФИКАЦИЯ, не рубрика:**
- Только при Тип=Олимпиада; `exam=NULL`, № КИМ скрыт. Уровень 1–5 ОДНОВРЕМЕННО пишется в `primary_score` (= балл за задачу) → переносится в ДЗ как `max_score` через существующий `kbTaskToDraftTask` (`primary_score ?? 1`), без правок homework write-path.
- **Безопасно копируется в Каталог** (в отличие от рубрики): добавлена в column-lists `kb_publish_task`/`kb_resync_task` + в условие resync-триггера `trg_fn_kb_after_update_moderation` (миграция `20260621120000`, базировалась на последних версиях `20260330130615` + `20260611181252` — 3-арг fingerprint сохранён). При добавлении нового поля `kb_tasks` — решить tutor-only (как рубрика, НЕ в триггеры) vs catalog-safe (в INSERT/UPDATE-списки + resync-условие).
- Путь типа (правь ВСЕ): `KBTask`/`Create`/`UpdateKBTaskInput` + `types.ts` (Row/Insert/Update **И** 2 RPC-return-шейпа `fetch_catalog_tasks_v2/_all`) + insert/update payload модалок + бейдж в `TaskCard`/`PickerTaskCard` + сортировка в `kbCatalogGrouping.groupTasksBySubtopic` (олимпиада — по `difficulty` asc внутри подтемы; ЕГЭ/ОГЭ уже по № КИМ asc).

**Авто-балл по № КИМ — `src/lib/kbKimScores.ts` (frontend-only, НЕ грейдинг):** `getKimPrimaryScore(exam, kim)`. Физика ЕГЭ (Σ=45, совпадает с mock-part1-checker check_modes) + ОГЭ (Σ=39, 22 задания, критерии ФИПИ от Егора 2026-06-21) — обе карты заполнены. UX: чип «балл по ФИПИ · Изменить» (редактируемо). На submit: `primaryScore` (ручной override) ∥ авто. Карта = только МАКС за задание (частичный балл — забота грейдинга). Новый предмет → добавь карту; значения подтверждает предметник.

**Справочник источников — `kb_sources` (глобальный, модераторский):** RLS SELECT для authenticated, запись только через RPC `kb_mod_create/update/delete_source` (зеркало `kb_mod_*_subtopic`). Выбранное имя пишется в **`kb_tasks.source_label`** (гибрид: список + «Другой»). Бейдж «Моя/Каталог» по-прежнему из `owner_id`, не из `source_label` (`'my'`/`'socrat'` — служебные sentinel). UI модератора — `SourcesManager` (gated `useIsModerator`, кнопка «Источники» на лендинге каталога). FK на задачи нет → удаление источника безопасно.

**Серия задач (наследование + «Сохранить и добавить ещё»):** `src/lib/kbLastClassification.ts` (localStorage) — наследует классификацию (тип/КИМ/сложность/тема/подтема/источник/формат/папка) в новую задачу. Кнопка «Сохранить и добавить ещё» (`CreateTaskModal`) НЕ закрывает форму — чистит только контент (условие/ответ/решение/фото, `useImageUpload.reset()`), классификацию + рубрику оставляет. Балл/контент не наследуются (балл выводится из КИМ). Только Create; Edit — каскад без наследования.

**При расширении:** новое поле задачи → реши catalog-safe vs tutor-only (триггеры); новый предмет авто-балла → добавь карту в `kbKimScores`; новый источник-write-путь → через RPC, имя в `source_label`; каскад — единый компонент, не дублировать.

## Snapshot-механика
При добавлении задачи в ДЗ — текст фиксируется в homework_kb_tasks.task_text_snapshot.
Ученик видит snapshot, не оригинал. Репетитор может редактировать snapshot в drawer.

## Интеграция KB → конструктор ДЗ (KBPickerSheet)

- `src/components/tutor/KBPickerSheet.tsx` — Sheet-drawer с двумя вкладками (Каталог / Моя база)
- `kbTaskToDraftTask(task: KBTask): DraftTask` — канонический конвертер KB-задачи в черновик
- Каноничные helpers для attachment refs: `parseAttachmentUrls()` / `serializeAttachmentUrls()` в `src/lib/attachmentRefs.ts`
- `src/lib/kbApi.ts` держит только re-export этих helpers для backward compat старых KB consumer'ов
- `MAX_TASK_IMAGES` импортировать из `@/lib/attachmentRefs`, не из `kbApi.ts`

### Поля провенанса в DraftTask (обязательны при добавлении задачи из KB)
- `kb_task_id`, `kb_source: 'socrat' | 'my'`, `kb_snapshot_text`, `kb_snapshot_answer`, `kb_snapshot_solution`, `kb_attachment_url`
- `kb_attachment_url` — может быть `storage://...`. **Требует разрешения в signed URL перед передачей в AI**

**Важно:** KBPickerSheet работает через локальный React state визарда (`onAddTasks` callback → `DraftTask[]`), а **НЕ** через глобальный `hwDraftStore` (Zustand).

## Каталог: группировка по КИМ + фильтр подтем + рекурсивные счётчики папок (2026-06-01)

### Внутри темы — группировка по номеру КИМ + кликабельные подтемы
Задачи темы рендерятся секциями «КИМ № N · M задач» (по возрастанию КИМ; группа без номера — в конце) + кликабельные чипы подтем со счётчиками (single-select, комбинируется с фильтром по КИМ). Применяется в **ДВУХ** поверхностях: витрина (`CatalogTopicPage.tsx`) и пикер конструктора ДЗ (`KBPickerSheet.tsx::CatalogBrowser`).

**Канонические примитивы (переиспользовать, НЕ дублировать sort/filter):**
- `src/lib/kbCatalogGrouping.ts` — `groupTasksByKim(tasks, subtopicOrder?)`, `countTasksBySubtopic(tasks)`, sentinel `NO_SUBTOPIC_FILTER` (= «Без подтемы», отличается от `null` = «Все»).
- `src/components/kb/CatalogTaskGroups.tsx` — сворачиваемые КИМ-секции, **render-prop** (`renderTask`): каждая поверхность отдаёт свою карточку (каталог → `TaskCard`, пикер → `PickerTaskCard`).
- `src/components/kb/ui/SubtopicFilterChips.tsx` — чипы подтем со счётчиками.

**Инварианты:**
- Сорт внутри группы: `kim asc → subtopic.sort_order → created_at → id`. `kim_number=null` → группа «Без номера КИМ» в конце.
- `key={topicId}` на `CatalogTaskGroups` сбрасывает collapse при смене темы; page-level фильтры — `useEffect([topicId])` (param-only навигация не размонтирует компонент).
- Фильтры КИМ (клик по бейджу) × подтема (чип) комбинируются как **AND**. Счётчики подтем считаются по ВСЕМ задачам темы (до фильтра).
- В пикере batch-select привязан к `visibleTasks`; `selectedIds` очищается при смене темы/подтемы.
- Новый catalog-surface → переиспользуй примитивы, а не реализуй сорт/фильтр заново.

### «Моя база»: рекурсивные счётчики задач в папках
Карточка папки показывает «N задач» **РЕКУРСИВНО** (папка + все вложенные подпапки любой глубины); «N папок» — **ПРЯМЫЕ** подпапки.

**Источник истины — RPC `kb_folder_recursive_counts()`** (миграция `20260601130000`, `SECURITY DEFINER`, scoped `auth.uid()`, `GRANT EXECUTE TO authenticated`). Возвращает `(folder_id, recursive_task_count, direct_child_count)` для всех папок вызывающего. `useFolders.ts::fetchRootFolders` / `fetchFolder` зовут его.

**Инварианты (КРИТИЧНО):**
- **НИКОГДА** не возрождай client-side безлимитный подсчёт по всем `kb_tasks` / `kb_folders` — PostgREST режет ответ на 1000 строк → тихий недосчёт у крупной базы (модератор каталога). Рекурсивные счётчики — только через RPC.
- Новый RPC, вызываемый клиентом → обнови `src/integrations/supabase/types.ts` (`Functions`): strict `createClient<Database>` иначе не пропустит `.rpc()` (no-arg стиль = `Args: never`).
- `fetchFolder` фильтрует личные чтения `.eq('owner_id', userId)` (defense-in-depth поверх RLS).
- Дерево папок без циклов (репэрентинга папок в UI нет) → в recursive CTE нет cycle-guard. Появится перенос папок — добавить `CYCLE`/depth-cap.

### Русское склонение
`src/lib/pluralizeRu(n, [one, few, many])` — канонический helper («1 задача / 2 задачи / 5 задач», корректный `% 100 / % 10`). Используй вместо inline `n < 5 ? …`. Применён в `CatalogTaskGroups`, `FolderCard`. Старые места (`TopicRow` / `FolderRow` / `TopicCard`) — кандидаты на миграцию.

## Спецификация
- Tech spec: docs/delivery/features/kb/kb-tech-spec.md
- Design ref: docs/discovery/product/kb/kb-design-ref.jsx
- Tasks: docs/delivery/features/kb/kb-tasks.md
