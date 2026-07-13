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

**⚠️ ПОЛИТИКА ИЗМЕНЕНА (unified-task-model M2, `20260705120100`, решение владельца 2026-07-05):** публикация в каталог теперь несёт **ПОЛНУЮ AI-настройку включая рубрику**: `check_format, task_kind, cefr_level, grading_criteria_json, rubric_text, rubric_image_urls` добавлены в column-lists `kb_publish_task`/`kb_resync_task` + resync-условие триггера. Прежний инвариант «рубрика не публикуется» (`20260318150000` + scrub `20260611130300`) ОТМЕНЁН: ценность Банка ДЗ = «готовое ДЗ с настроенной проверкой»; безопасно, т.к. (а) публикуют ТОЛЬКО модераторы (сознательная курация; `promote_folder_to_catalog` остаётся REVOKED), (б) ученикам tutor-only поля не текут — их защита на homework-раннтайме (strip + column-GRANT), (в) **M2b `20260705120200` hardening**: каталожный SELECT сужен до tutors/moderators (`is_tutor(auth.uid()) OR has_role('moderator')`, initplan-обёртки) — раньше ЛЮБОЙ authenticated (вкл. учеников) читал каталог с `solution` через прямой PostgREST (пред-существующая дыра, закрыта); (г) **RPC-hardening `20260706120000`** (ревью-фикс P0): SECURITY DEFINER RPC `fetch_catalog_tasks_v2`/`_all`/`kb_search` обходили RLS и были GRANT authenticated без гарда — теперь все три зовут `kb_require_tutor_or_moderator()`. **Инвариант: новая SECURITY DEFINER RPC, отдающая kb_tasks-контент и GRANT'нутая authenticated, ОБЯЗАНА звать этот гард** (RETURNS SETOF kb_tasks сохраняем — сужение колонок сломало бы импорт Банка для репетиторов). Новая student-поверхность, читающая kb_tasks (напрямую или через RPC), — теперь НЕВОЗМОЖНА без правки политики/гарда (осознанно). При добавлении нового поля в `kb_tasks` — default catalog-safe (в INSERT/UPDATE-списки + resync-условие), tutor-only только если поле утечёт ученикам через homework-runtime.

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

## UX загрузки задач для лидеров предметов (2026-07-11)

Ускорение наполнения Банка предметными лидерами (Егор/физика, Милада/общество, Эмилия/французский, Светлана/математика — последние двое онбордятся модераторами). Аддитивно, без миграций. Build-лог: memory `project_subject_leaders_ux_2026_07_11.md`. План волн 2-3: `~/.claude/plans/federated-conjuring-anchor.md`.

- **Источник на карточках (#3):** `source_label` («ФИПИ», …) в шапке `TaskCard` + `PickerTaskCard` (`KBPickerSheet`). Sentinel-провенанс `'my'`/`'socrat'` скрыт (это владение, не источник). Данные уже в `KBTask` — новый card-surface показывает так же.
- **Одна картинка в списке (#2):** свёрнутый `TaskCard` = ОДНА hero-картинка + чип «Ещё N фото»; остальные раскрываются с карточкой (без дубля hero). `TaskCard`/`PickerTaskCard` резолвят signed URL через **`useKBImagesSignedUrls`** (кэш 55 мин, дедуп) — НЕ прямой `getKBImageSignedUrl` в `useEffect` (был до 3×N RPC на тему). Новый card-surface → тот же хук.
- **«Формат ответа» удалён из UI (#60, Егор):** селект `answer_format` убран из `TaskClassificationFields` — дублировал «Формат проверки» (в нём «крутая штука по КИМ»). Пропы `answerFormat`/`onAnswerFormatChange`/`hideAnswerFormat` → **deprecated-optional** (чтобы НЕ трогать high-risk `HWTaskCard`, который и так слал `hideAnswerFormat`). Модалки не шлют ключ `answer_format` (Edit НЕ зануляет сохранённое). Колонка `kb_tasks.answer_format` — legacy, фолбэк `resolveCheckFormatFromKb` работает.
- **Порядок полей + авто-формат по КИМ (#13, Елена):** «Ответ и решение» ВЫШЕ «Классификации» + раскрыто по умолчанию (`showAnswerSection=true`). «Формат проверки» показывает авто-значение по № КИМ прямо в первой опции (физика; в Edit — под `subjectKnown`-гейтом, как авто-балл). `''` в БД = NULL (дерайв `resolveCheckFormatFromKb` на импорте не тронут). Инфострока «критерии ФИПИ №N автоматически» при физике-ЕГЭ 21–26.
- **Подсказка для AI (#45а):** поле «Подсказка для AI» в `InputStage` → `tutor_hint` (≤500) в теле `kb-ai-extract` → инжект в промпт рядом с exam/topic_hint. Deploy-skew-safe (старый edge игнорит), PII-free (содержимое не логируется).
- **Якорные предметы витрины:** `KB_SUBJECTS` += `maths`, `french` (pills видны до первых тем). Онбординг Эмилии (FR, `pacane@gmail.com`) / Светланы (математика, `lana-tichonova@yandex.ru`) модераторами — миграция `20260712120000_grant_moderator_emilia_svetlana.sql` (ОБЕ роли tutor+moderator + папки, зеркало Милады `20260706140000` + урок хотфикса `20260707120000`). **Готча:** сброс пароля (`ForgotPassword.tsx` → дефолтный `resetPasswordForEmail`) НЕ RU-safe (recovery-ссылка на заблокированный `*.supabase.co`) — новый тьютор с проблемой входа лечится админ-паролем в Supabase dashboard; системный фикс (кастом Recovery-шаблона под RU-bypass, rule 96 §B) — отложен.
- **Несколько допустимых ответов + диапазон (#61, Егор):** хранение в `kb_tasks.answer` (текст), грейдинг + разделитель « или » (НЕ «;») + зеркала парсера — канон в **rule 40 «Несколько допустимых ответов + числовой диапазон»**. UI `AnswerAlternativesField` в модалках KB.

### Волна 2 (2026-07-12): таблица пакетного ревью + refine + AI-кроп рисунков

Ревью-стадия AI-загрузчика перестроена под пачки 10–30 задач (#54 + #45 + #10-кроп). Миграций НЕТ. E2E пройден на живом деплое (extract через старый прод-edge = deploy-skew подтверждён: отсутствие `image_bbox` в ответе → кроп молча выключен).

- **Review-модель (`AiTaskLoader/reviewTypes.ts`):** контент — `drafts: ExtractedTask[]`; классификация тутора — параллельный `overrides: ReviewOverrides[]` (topicId/subtopicId/sourceLabel/exam/kimNumber/primaryScore). **Пре-резолв темы при входе в ревью** (exact-name match в `handleExtracted` + bulk-фетч подтем) — тутор сразу видит несматченную тему (amber), commit читает ТОЛЬКО overrides. Темы ЕГЭ/ОГЭ дублируются по именам → селекты скоупятся по `override.exam` (карточка/строка/bulk-бар).
- **Таблица `DraftTable`** (desktop ≥768 default; mobile — карточки; тумблер персистится `sokrat-kb-ai-loader-view`): колонки ☑/№/Условие(`stripLatex` clamp-2, клик=expand)/Ответ✎/Экзамен✎/КИМ✎/Балл✎(placeholder=авто ФИПИ)/Тема✎/Статус(saved/failed/дубль/без ответа/фото/кроп)/⌄. **Expand-row = `DraftCard`** (детальный редактор, `hideSelect`). Safari rule 80: `border-separate border-spacing-0`, `<colgroup>`+`tableLayout:fixed`+`width:max-content`, `touch-pan-x`, 16px inputs, memo-строки (KaTeX только в expand). `BulkActionsBar`: тема(+подтема)/экзамен/источник → «Применить к выбранным», сентинел «не менять», «Снять дубликаты».
- **`DraftCard` расширен (#54):** решение и критерии теперь editable textarea; блок «Классификация» (экзамен/КИМ/балл/тема/подтема/источник-datalist) через props `override`/`onOverrideChange`/`topics`; структурный `CriteriaEditor` НЕ тащим (extract отдаёт rubric_text-текст).
- **Refine («Переспросить AI», #45а полная):** `mode:'refine'` в ТОЙ ЖЕ edge `kb-ai-extract` (body `{mode,folder_id,subject,comment≤2000,draft,image_refs?≤2}` → `{draft}`; whitelist-проекция черновика в промпт; usage `kb_extract_refine`). Клиент `refineDraft` мержит **ТОЛЬКО контент-поля** (text/answer/solution/rubric_text/needs_review/notes/fingerprint) — классификацию тутора НЕ затирает. Rate-guard: один refine за раз. `source_image_index` как контекст — только при `stats.unreadable_images === 0` (иначе индексы смещены).
- **AI-кроп (#45б/#10):** модель отдаёт `image_bbox` **Gemini-конвенцией `[ymin,xmin,ymax,xmax]` 0..1000** (нативная детекция — свой формат роняет точность); edge валидирует (clamp, min-сторона 3%, y/x min<max) → клиенту `{x,y,w,h}` доли 0..1. **Backstop ослаблен:** изображение у >1 задач живёт, ЕСЛИ у задачи есть bbox; без bbox — обнуляется (прежний «весь скриншот с чужими условиями»). Кроп — **клиентский canvas** (`src/lib/cropImage.ts`: fetch→blob→objectURL АНТИ-TAINT — прямой `<img src=signedUrl>` в canvas = SecurityError на toBlob; белый фон; кап 4МБ). Правка рамки — `BboxEditor` (Pointer Events + setPointerCapture + `touch-action:none`, хендлы 24px, нормализованные координаты, БЕЗ внешних либ). Ручной кроп доступен и без AI-bbox («Вырезать фрагмент», дефолтная рамка 10%). Превью — CSS background-техника (`CropPreview`, без canvas до commit). **Кроп-аплоад ЛЕНИВО на commit** + кэш `cropUploadCacheRef` между ретраями; **сбой кропа → задача сохраняется БЕЗ картинки** (мультискрин целиком НЕ прикрепляется молча — решение владельца). Промпт-правки: СНАЧАЛА `prompts.md` §2/§3, потом зеркало String.raw ×3 промпта (physics/social/generic) + few-shot.
- **Bulk-commit:** `useKnowledgeBase.ts::useCreateTasksBulk` — цикл по ТОМУ ЖЕ `insertTask` (НЕ батч-RPC, НЕ новый write-site), параллельность 3, per-row `rowStatus`, ОДНА инвалидация `['tutor','kb']`. Частичный сбой → строки `failed` + CTA «Повторить неудачные» (без ухода со страницы); полный успех → **orphan-cleanup** `uploadedRefs`, не попавших ни в один сохранённый attachment (кропы заменяют оригиналы мультискринов).
- **Телеметрия:** `kb_ai_draft_refined`, `kb_ai_crop_action` (edited/full/removed), `kb_ai_tasks_saved` + failed/cropped/cropFailed. Метрика точности bbox = crop_action к suggested-кропам.
- **При расширении:** новый режим edge — в ту же функцию с dispatch по `body.mode`; правка extract-схемы — все 3 схемы + few-shot + prompts.md; новое поле ревью — в `ReviewOverrides` (не в ExtractedTask); кроп-операции — только оригинальные пиксели (redraw = P2 отдельная spec).
- **Удаление черновика из ревью (запрос Милады 2026-07-13, «из 8 оставить меньше»):** ✕/«Удалить» на каждой строке `DraftTable` (ячейка действий рядом с ⌄) и в шапке `DraftCard` (только режим карточек `!hideSelect` — в таблице ✕ уже в строке). **Мягкое скрытие через `removed: boolean[]` в `AiTaskLoaderPage`, НЕ splice массивов** (КРИТИЧНО): индексы обязаны быть стабильны — `cropUploadCacheRef` (Map по абсолютному индексу) и `source_image_index → uploadedRefs` (абсолютный индекс) сломались бы при сдвиге. `removed[i]` скрывает строку из рендера (таблица+карточки) и исключает из `selectedCount`/`dupCount`/`applyBulk`/`selectAll`/commit-`chosen`/`skippedDup`; undo = снять флаг (тост sonner «Задача убрана · Вернуть», 6с). Заголовок «Найдено задач» = `visibleCount`. Сохранённую строку (`rowStatus==='saved'`, уже в БД) удалить нельзя — гард в `removeDraft` + ✕ скрыт при saved в таблице. **При расширении ревью-списка — исключать `removed` из ЛЮБОГО нового счётчика/итератора; удаление — мягкое (флаг), никогда не splice параллельных массивов.**

### Волна 3 (2026-07-12): чанкинг PDF до 60 стр + CSV + счётчики вклада

- **Чанкинг PDF (W3.1):** `MAX_PDF_PAGES_TOTAL=60`; страницы сверх первых 10 слотов → `pdfQueue` (плашка «В очереди ещё N стр. · Убрать»); `handleExtract` бьёт материал на чанки по `MAX_LOADER_IMAGES=10` и гонит их циклом с прогрессом «Прогон k из m» — сборник больше не грузят 10 раз руками. **Инварианты:** текст материала — ТОЛЬКО в первый чанк (иначе задачи из него дублируются каждым прогоном); `source_image_index` нормализуется в ГЛОБАЛЬНУЮ систему координат `uploadedRefs` на аккумуляции (сбойный инлайн внутри чанка → null) — page-refine больше НЕ гейтится stats; сбой чанка №1 → обычный error-путь, сбой чанка k>1 → уходим в ревью с распознанным + честный тост (страницы недоделанных чанков не переносятся); refs сбойного чанка чистятся сразу. Телеметрия `kb_ai_extract_run.chunks`.
- **CSV/таблица (W3.2, zero deps):** «Загрузить CSV-таблицу» под полем текста — `arrayBuffer` → `TextDecoder('utf-8',{fatal:true})` → catch → `windows-1251` (Excel-RU) → текст добавляется в поле (кап 60k = edge MAX_TEXT_CHARS). AI сам маппит колонки (промпт понимает таблицы). Paste из Excel = TSV-текст → уже работает через Ctrl+V (хинт в UI). **Бинарный .xlsx — НЕ читается** (нужна зависимость sheetjs → решение владельца; честный тост «сохраните как CSV»).
- **Счётчики вклада (W3.3):** витрина — «{Предмет}: N задач» в сабтайтле Каталога (Σ `task_count` тем предмета из уже загруженного `allTopics`, ноль запросов; маркетинг-цифра); «Моя база» — «вы загрузили N задач» (Σ рекурсивных счётчиков root-папок).
- **`PickerTaskCard` мемоизирован (W3.4, ревью P2):** `memo` + колбэки с параметром (`onAdd(task)`, `onToggleSelect(id)`) + стабильные хендлеры в обоих браузерах пикера — инлайн-замыкания в props ломали бы memo.

### Хотфиксы репорта Светланы (математика, 2026-07-12)

- **`stripLatex` рендерит дроби (КРИТИЧНО для математики):** раньше `\frac` просто вырезался → `\frac{16}{x+5}` в плотном превью (таблица ревью загрузчика, карточки, homework preview) превращался в «16x+5» — тутор видел ДРУГОЕ, неверное уравнение. Теперь `\frac{a}{b}`→`a/b` (скобки для составных: `16/(x+5)`), `\sqrt`→`√`, `\sin/\cos/\ln/…` сохраняются, `\cdot/\pm/\leq/…` и греческие → юникод; неизвестные команды по-прежнему удаляются. Правка в `src/components/kb/ui/stripLatex.ts` (единственная реализация; 6 callsite — все выигрывают). **При добавлении в KB-текст новой LaTeX-конструкции, видной в dense-превью → расширять `stripLatex`, а не мириться с мусором.**
- **PDF worker через Vite `?worker`, НЕ `?url` (`pdfToImages.ts`) — КОРНЕВОЙ фикс:** прод-nginx на VPS отдаёт `.mjs` как `application/octet-stream` (**подтверждено curl'ом:** `.js`→`application/javascript` ✓, `.mjs`→`octet-stream` ✗), а `?url` сохранял исходный `pdf.worker.min.mjs` → браузер по strict-MIME отвергает module-worker из octet-stream → `getDocument().promise` реджектится «не удалось открыть файл» у ВСЕХ на проде (в node/Vite-dev MIME иной — там работало; класс octet-stream = rule 95). `disableWorker`-фолбэк НЕ помогал (fake-worker грузит тот же битый `.mjs`). Фикс: `import PdfWorker from '…/pdf.worker.min.mjs?worker'` → Vite бандлит воркер в обычный `.js`-чанк (`pdf.worker.min-*.js`, application/javascript) → грузится; `GlobalWorkerOptions.workerPort = new PdfWorker()` (внешний port pdfjs НЕ терминейтит на `destroy()` → переиспользуется между файлами). **Инвариант: worker/wasm-ассеты pdfjs (и любые `.mjs`-воркеры) — только через `?worker`, не `?url`, пока nginx не мапит `.mjs`.** Follow-up (ops, необязательно): добавить `.mjs`=`application/javascript` в nginx mime.types. Известное ограничение: pdfjs-legacy на некоторых сборниках недосчитывает страницы (система видит 200, pdfjs — 5) — отдельная задача (другой парсер); задачи всё равно грузятся скриншотами/вставкой.

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

## AI-загрузка задач — `kb-ai-extract` (P0, 2026-06-25)

Конвейер «материал (текст/фото) → AI извлекает черновики → карточки с правкой → запись в «Мою базу»». Снимает барьер наполнения базы (ручной ввод ~2–4 мин/задача → < 30 сек). Tutor-домен, аддитивно, **без миграций**. Вход — кнопка «AI-загрузка задач» (Lucide `Sparkles`) в «Моей базе» (`KnowledgeBasePage`) и тулбаре папки (`FolderPage`, текущая папка = назначение) → роут `/tutor/knowledge/ai-loader?folder=`. Spec: `docs/delivery/features/kb-ai-task-loader/{spec.md, prompts.md, kb-ai-task-loader-tasks.md}`. Build-лог: memory `project_kb_ai_task_loader.md`.

**Единый write-path (КРИТИЧНО, rule 40):** edge `kb-ai-extract` **ТОЛЬКО извлекает** черновики (ноль записи в БД); запись — через существующий `insertTask`/`useCreateTask`. НЕ плодить новый `from('kb_tasks').insert` — грепни перед мержем.

**Edge (`supabase/functions/kb-ai-extract/index.ts`, `verify_jwt=true`, service_role внутри):**
- Ownership: `kb_folders.owner_id === userId` → иначе 403 `INVALID_FOLDER` (rule 97 flat `{error, code}`).
- Картинки: клиент грузит скриншоты в `kb-attachments` → шлёт `storage://` refs; edge парсит (**own-namespace `{userId}/…` bind**, anti-SSRF) → `createSignedUrl` → `rewriteToDirect` → base64 (`_shared/ai-lovable.ts::inlineImageUrlToBase64`, SVG/size-guard). `storage://` **НИКОГДА** не уходит в AI текстом. Кап **≤10 изображений/вызов** (= единственная защита стоимости в P0; квота — P1, rule 99). Если все картинки отвалились и текста нет → 422 `IMAGES_UNREADABLE` (не звать AI вслепую).
- Системный промпт — **verbatim `prompts.md §2` через `String.raw`** (LaTeX `\text`/`\frac`/`\sin` — литеральные бэкслеши; обычная строка превратила бы `\t`→TAB, `\f`→FF — класс бага rule 80) + схема/few-shot §3/§7 + опц. `exam_hint`/`topic_hint`.
- `callLovableJson` (Gemini, temp 0.2) из **нового self-contained `_shared/ai-lovable.ts`** — `homework-api/ai_shared.ts` НЕ тронут (rule 10; repo-конвенция «mirror locally», `_shared` без cross-function deps). Validate `{tasks[]}` → **retry-once** → 502 `EXTRACT_FAILED`.
- Нормализация: `answer=null` при `answer_confidence='low'` (anti-hallucination — неверный ответ отравляет авто-проверку ДЗ); `image_action='attach_original'` форсится (**P0 рисунки НЕ перерисовываются**); `kim_number` 1..30; enums.
- **Прикрепление картинки (решение владельца 2026-06-25):** `image_index` ставится ТОЛЬКО если изображение = **одна** задача И в ней есть существенный рисунок (график/схема/чертёж/цепь). Мультизадачный скрин / чисто текстовая задача / сомнение → `null` (только распознанный текст; сомнение помечается `"image"` в `needs_review_fields`). Таблицы → LaTeX-`array` в тексте, не картинкой. **Серверный backstop:** если AI привязал одно изображение к >1 черновику → edge обнуляет `attachment_ref`/`image_index` у всех (мультизадачный скрин = текст). **Ручной контроль:** `DraftCard` даёт добавить/убрать картинку независимо от AI. Display image-only `[Задача на фото]` — поддержан `TaskCard` (текст скрыт); одиночное фото в `TaskCard` показывается один раз (hero-клик), галерея — только для нескольких фото.
- Дедуп extract-time: `kb_normalize_fingerprint(p_text, p_answer, p_attachment_url)` (**3-арг**, attachment через `serializeAttachmentUrls` для parity с insert-триггером) → `kb_tasks` SELECT (mine+catalog) → `fingerprint_match` → карточка с баннером + снятой галочкой. Advisory (fail-open).
- **Логи PII-free:** только counts/ids/status. AI-output-несущие пути (gateway error body, JSON-parse error, extraction-call) санитизированы (status/error_type, без preview ответа); `error.message` — только у DB/infra-ошибок (дедуп/unhandled), task text туда структурно не попадает.

**Anti-leak:** рубрика/решение пишутся в личную папку (owner=tutor) — в Каталог не уходят (publish-триггеры рубрику не копируют; `solution` в Каталог уходит by design, spec §8 Q6). Edge возвращает только `{drafts, stats}`.

**Клиент:** `src/lib/kbAiExtractApi.ts` (типы зеркалят edge-схему; `extractEdgeFunctionError` — никогда «non-2xx»). UI: `AiTaskLoaderPage` (роут, `React.lazy`) + `AiTaskLoader/{InputStage, DraftCard}`. `DraftCard` (`React.memo`): условие/ответ — сырой `$…$` (16px) + live `MathText`; `answer=null` → amber «впишите/поправьте»; рубрика «видно только вам»; рисунок «авторский — AI не меняет» + «Заменить вручную». Reuse `useImageUpload`/`ImageUploadField`/`uploadKBTaskImage`/`getKBImageSignedUrl`/`useFolderTree` (не изобретать). Commit — `insertTask` loop; `topic_suggestion → topic_id` **точным именем** (физ-таксономия `useTopics`, иначе null — темы НЕ создаём), subtopic bulk-fetch одним `kb_subtopics`-запросом; invalidate `['tutor','kb']`. Телеметрия `kbAiLoaderTelemetry.ts` (типизирована: `kb_ai_extract_run`/`kb_ai_tasks_saved`, PII-free counts/ids).

**Deploy:** edge — Lovable (на синк main; `config.toml verify_jwt=true` + deploy workflow); фронт — `deploy-sokratai`.

**При расширении (P1+, tasks.md TASK-10..15):** PDF-задачник/Excel/пакетный режим/правка-репликой/вход в конструктор ДЗ/квота; новый AI-путь с картинками → `inlineImageUrlToBase64` + bucket whitelist (`kb-attachments` уже в `HOMEWORK_AI_BUCKETS`); новый write — через `insertTask`, не новый site; AI-перерисовка рисунка (vector-first) — P2, отдельная spec.

## Мультипредметный каталог + PDF-загрузка (2026-07-06)

Онбординг модератора обществознания (Milada, `milada.met@yandex.ru`) + PDF в AI-загрузчик. Коммиты `7d5a43f`/`6f67904`/`1fc2266`/`ce8278d`. Build-лог: memory `project_kb_multisubject_social_2026_07_06.md` + `project_kb_pdf_loader_2026_07_06.md`.

**Предмет живёт на `kb_topics.subject`** (TEXT default 'physics', колонка с `20260611130000`; у `kb_tasks` СВОЕЙ subject-колонки НЕТ — задача получает предмет через тему). **Словари (2026-07-07, все-предметы итерация):** личные формы (Create/EditTaskModal, AI-загрузчик, каскад `TaskClassificationFields`) рендерят **полный `SUBJECTS` (14, `@/types/homework`)** — школьный репетитор любого предмета грузит задачи в свою базу; `KB_SUBJECTS` (`src/types/kb.ts`) сужен до «якорных каталожных предметов» (physics/social — pills витрины показывают их всегда; новый модератор-предметник → допиши сюда + онбординг с ОБЕИМИ ролями). Pills витрины = union(якорные ∪ предметы существующих тем ∪ предметы профиля репетитора) в каноническом порядке. **Дефолт предмета ВЕЗДЕ — `resolveTutorDefaultSubject(profileSubjects, lastUsed)`** (`src/lib/tutorSubjects.ts`): last-used → профиль (`tutors.subjects`, канонические id; 'other'/legacy нормализуются) → physics. KB-поверхности передают lastUsed из `kbLastClassification.subject`; конструктор ДЗ — из `readHwLastSubject()` (LS `sokrat-hw-last-subject`, пишется после create). Профиль в lazy-init форм — СИНХРОННО из кэша (`useTutorProfile` тёплый через SideNav; в конструкторе — `queryClient.getQueryData(TUTOR_PROFILE_CARD_KEY)`, БЕЗ новых подписок/эффектов-клобберов). Онбординг-нудж `SubjectsNudgeBanner` (профиль без предметов → чипы в Базе, реюз `SubjectsMultiSelect`). `kb-ai-extract`: `VALID_SUBJECT` = все 14; physics/social — выделенные промпты, остальные — generic (`buildGenericExtractPrompt`: LaTeX-инструкция только формульным maths/informatics/chemistry/biology; КИМ — только явно указанный). `tutor_students.subject` теперь пишется id (select в `AddStudentDialog`; prefill предмета — one-shot effect на open, ТОЛЬКО при ровно одном контент-предмете профиля; legacy free-text рендерится через `getSubjectLabel` fallback-raw). **Ревью р.2 (`87afcf9`, инварианты):** «В ДЗ» с каталожной карточки несёт `subjectSnapshot` (= `kb_topics.subject` темы) → HWDrawer префиллит предмет из единого snapshot'а корзины (rule 40 path B); `EditTaskModal` — авто-балл по КИМ применяется ТОЛЬКО при `subjectKnown` (предмет резолвлен из темы / выбран вручную; unresolved physics-дефолт = гипотеза, авто-балл запрещён); AI-загрузчик персистит выбранный предмет через `saveLastSubject` (merge в `kbLastClassification`) после успешного extract; нудж-баннер сохраняет только при ≥1 контент-предмете (`['other']` = ложная персонализация). **Отложено:** дубли лейблов в фильтре учеников (legacy «Математика» текст + id 'maths' → две одинаковые опции, группировка по label) — post-deploy.

**Проводка subject (UI-only, схема уже готова):**
- `useTopics(filter, subject?, searchQuery?)` — `subject` в query-key ОБЯЗАТЕЛЕН (иначе кэш склеит предметы); `fetchTopics` `.eq('subject', subject)` когда задан. Старые вызовы `useTopics(undefined, undefined)` (KBPickerSheet) / `useTopics()` (PublishFolderModal) = все предметы (backward-compat).
- `TaskClassificationFields` — опц. `subject`/`onSubjectChange` (селектор «Предмет» первым полем, скоупит темы). undefined → homework-контекст, все темы (как раньше). **`HWTaskCard` НЕ передаёт → homework не тронут** (rule 40 risk-zone цел, smoke §8 пройден).
- `KnowledgeBasePage` — предмет = компактные **pills** (НЕ второй сегмент-контрол — UX-ревью: три уровня навигации одного веса перегружали); над exam-фильтром; empty-state subject-aware (`SUBJECT_DATIVE`).
- `Create/EditTaskModal` держат `subject` (Create: наследуется в серии `kbLastClassification`; Edit: резолвится из темы задачи через `useTopic` + ref-guard, показывает тему без потери).
- `TopicEditorModal`/`kbModeratorApi.createCatalogTopic` — `subject` в create (RPC `kb_mod_create_topic` уже принимает `p_subject`). Sources (`kb_sources`) остаются **глобальными** (имена «ФИПИ»/«Решу ЕГЭ» предмет-агностичны).

**Авто-балл/check_format — ТОЛЬКО физика (review fix P1/P2, КРИТИЧНО):** физ-карты КИМ (`kbKimScores.ts` 1-26/1-22) пересекаются с обществознанием (1-25) → без гейта физ-балл течёт в social (нарушает locked «ручной балл»). `getKimPrimaryScoreForSubject(subject, exam, kim)` (physics-only, single source of truth) во ВСЕХ KB-callsite; `HWTaskCard` — прямой `getKimPrimaryScore` (физика, не тронут). `resolveCheckFormatFromKb({..., subject})` — физ-КИМ-эвристика (21-26→detailed) только physics, иначе `short_answer` default. `EditTaskModal` показывает сохранённый балл ВЕРБАТИМ (не сворачивает в «авто» при совпадении с физ-баллом — иначе маскирует social).

**`kb-ai-extract` subject-switch:** `VALID_SUBJECT`(physics/social), `resolveExtractPrompt(subject)` → системный промпт+few-shot по предмету (fallback physics). **Social-промпт: БЕЗ формул/LaTeX; типы (суждения/соответствие/текст/план); каждое суждение с новой строки `\n`; КИМ ЕГЭ 1-25/ОГЭ 1-24.** Клиент шлёт `subject` (`InputStage` селектор → `extractTasks` → `AiTaskLoaderPage.resolveTopicId` скоупит по subject). Физ-промпт байт-в-байт не тронут. `normalizeTask` KIM-clamp 1..30 покрывает обществознание. String.raw в few-shot: `\n` остаётся JSON-escape'ом.

**MathText fast-path (`src/components/kb/ui/MathText.tsx`):** текст БЕЗ формул с `\n` рендерит `<br/>` (зеркало math-пути) — суждения «1)…2)…» читаемы. Однострочный текст — прежний zero-overhead путь.

**Milada onboarding — миграция `20260706140000`** (зеркало Егора `20260318134400`): роль moderator + папки «Черновики для сократа»/«сократ». Идемпотентна; **нет аккаунта → no-op+NOTICE** (перезапустить после регистрации). Темы обществознания — self-serve. **ИНВАРИАНТ: тьютор-модератор ОБЯЗАН иметь ОБЕ роли `tutor`+`moderator`** — KB-модераторский UI под `/tutor/knowledge/*`, вход требует `is_tutor` (`TutorLogin`/`TutorGuard`); модератор без `tutor` → «Этот аккаунт не репетиторский» (signOut). Онбординг-миграция выдаёт только `moderator` — если модератор НЕ зарегистрирован как репетитор, доливай `tutor` (образец — `20260707120000`; **для Milada оказался no-op — у неё уже был `tutor` от собственной регистрации**). Следующего модератора онбордить с ОБЕИМИ ролями. **Login-хэнг ≠ роли:** залипшая кнопка «Вход…» в `TutorLogin` — обычно РФ-DPI роняет `signInWithPassword`/`is_tutor` (одиночные критичные запросы к `api.sokratai.ru`, без retry-таймаута в форме) → фикс на стороне юзера (VPN/повтор), не код. Диагностика роли — `SELECT array_agg(role) FROM user_roles JOIN auth.users ON ... WHERE email=…`.

**PDF-загрузка (P1 TASK-10, frontend-only, edge/БД/контракты НЕ тронуты):** PDF → картинки страниц **на клиенте** → существующий image-пайплайн (`useImageUpload` → kb-attachments → `image_refs` → `kb-ai-extract`). `src/lib/pdfToImages.ts`: pdfjs-dist **legacy**-build (modern требует Promise.withResolvers = Safari 17.4+, rule 80); **строго lazy** `await import('@/lib/pdfToImages')` из `InputStage.handlePdfSelect` (532КБ вне initial-chunk); `onProgress`+yield `setTimeout(0)` (**НЕ rAF** — замерзает в фоновой вкладке); canvas белый фон под JPEG (нет альфы); **`destroy()` на loading task, не proxy** (v6); страница >4МБ → re-render quality 0.7/scale ×0.75. `useImageUpload.addFiles(files)` (реюз валидации/капа). `InputStage`: PDF-кнопка (accept=pdf, «Страница N из M», honest-toast «первые K из N» — no silent caps rule 40; фаза аплоада «Загружаем N/M» отдельно от «Распознаём»), кап = `MAX_LOADER_IMAGES`(10). Телеметрия `kb_ai_pdf_rendered`. `ImageUploadField.previewVariant='document'` (A4-contain + «стр. N» — страницы PDF нельзя кропать квадратом).

**Клик-зум превью (единый UX с ДЗ):** `ImageUploadField` реюзает `FullscreenImageCarousel` (`homework/shared` — тот же, что `HWTaskCard`) на клик по превью; массив зума = existing signed + new blob (порядок отображения); placeholder без signed URL некликабелен.

**Отложено (осознанно):** сборники/диапазон страниц/Excel(TASK-11)/вход из конструктора(TASK-14); `kb_search` subject-scoping (вернёт все предметы); homework-picker/`PublishFolderModal` темы всех предметов; авто-балл КИМ обществознания (нужна таблица ФИПИ от Милады); языковой промпт (Эмилия); текстовый слой цифровых PDF; единый блок «Материал» в загрузчике (IA). **Готча workflow:** dev-сервер без `@lovable.dev/mcp-js` потрошит `supabase/functions/mcp/index.ts` — перед коммитом `git checkout --` его.

## Спецификация
- Tech spec: docs/delivery/features/kb/kb-tech-spec.md
- Design ref: docs/discovery/product/kb/kb-design-ref.jsx
- Tasks: docs/delivery/features/kb/kb-tasks.md
