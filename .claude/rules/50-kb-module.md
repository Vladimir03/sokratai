# Knowledge Base — инварианты (всегда в контексте)

Здесь ТОЛЬКО первично-нарушаемое. **Глубина — skill `kb-module`** (модерационный пайплайн Source→Copy, fingerprint-дедуп, Банк ДЗ, темы/подтемы/источники, AI-загрузчик задач из PDF/фото, чанкинг и таблица ответов, ФИПИ-импорт, олимпиады, мультипредметность, уборка каталога).

Модуль живёт в Tutor-домене: `src/pages/tutor/knowledge/`, `src/components/kb/`, `src/hooks/{useKnowledgeBase,useFolders}.ts`, `src/types/kb.ts`, `src/stores/hwDraftStore.ts`.

## Два пространства

- **Каталог Сократа** — read-only витрина: `kb_tasks WHERE owner_id IS NULL AND moderation_status='active'`.
- **Моя база** — `kb_folders` + `kb_tasks WHERE owner_id = user`.

## Публикация — только через `kb_publish_task`

**Никогда прямой `owner_id = NULL`.** `promote_folder_to_catalog` REVOKE'нут от authenticated (он писал в каталог в обход дедупа и без strip). Любой новый путь публикации идёт через `kb_publish_task`/`kb_resync_task` — их column-list и есть контракт того, что попадает в общий каталог.

Fingerprint-дедуп: `kb_normalize_fingerprint(text, answer, attachment_url)` (**3 аргумента**) + `pg_advisory_xact_lock`. Первый опубликовавший fingerprint побеждает, дубли → `hidden_duplicate`. Правка, создающая дубль → `RAISE EXCEPTION` (сохранение блокируется).

**Смена темы у опубликованного источника ОБЯЗАНА переносить каталожную копию**, а не скипаться: иначе задачи «застревают» в мусорной теме и из UI неисправимы (инцидент Светланы, 78 задач).

## Доступ к каталогу — tutor/moderator only

SELECT каталожных задач сужен до `is_tutor(auth.uid()) OR has_role('moderator')`. Раньше ЛЮБОЙ authenticated (включая учеников) читал каталог с `solution` прямым PostgREST.

⚠️ **Новая SECURITY DEFINER RPC, отдающая контент `kb_tasks` и GRANT'нутая authenticated, ОБЯЗАНА звать `kb_require_tutor_or_moderator()`** — такие RPC обходят RLS. Это закрыло дыру в `fetch_catalog_tasks_v2` / `_all` / `kb_search`.

Destructive-операции модератора (удаление тем/разделов/подтем, перенос из каталога) — через `kb_require_moderator_subject(p_subject)` (права по `tutors.subjects`, `is_admin` bypass первым), не через голый `kb_require_moderator()`.

**Гранты `kb_mod_*`: тройной набор обязателен** — `GRANT authenticated, service_role` → `REVOKE FROM PUBLIC` → `REVOKE FROM anon`. `REVOKE FROM PUBLIC` в одиночку НЕ снимает anon (Supabase грантит anon напрямую) — тот же класс, что инцидент `yookassa_record_refund` (rule 99). Порядок важен: сначала GRANT, потом REVOKE.

## Storage — порядок удаления

Триггер `trg_protect_kb_attachments_from_delete` блокирует удаление объекта из `kb-attachments`, если на него ссылается `kb_tasks.attachment_url` или `solution_attachment_url`.

**Порядок обязателен: сначала UPDATE/DELETE ссылки в `kb_tasks`, потом `storage.remove()`.** Иначе `KB_STORAGE_PROTECTED`. Новый callsite `deleteKBTaskImage` — тем же порядком. Намеренный orphan-cleanup: сначала `UPDATE kb_tasks SET attachment_url=NULL`, потом удаление файлов. (Триггер появился после того, как файлы были потеряны через ручное удаление в Storage UI — карточки в каталоге стали пустыми.)

## Папка «сократ» — ТОЧНОЕ имя

`kb_is_in_socrat_tree` сравнивает `_name = 'сократ'` **регистрозависимо и без trim** + требует роль `moderator` у КОРНЯ дерева. «Сократ» / « сократ» → авто-публикация молча не сработает.

**CASE A авто-публикации МОЛЧА пропускает задачи без `topic_id`** — задача без темы, попавшая в дерево «сократ», просто не публикуется, без обратной связи. Компенсация — янтарный баннер в `FolderPage`; не убирать его и не «чинить» триггер авто-темизацией.

Папки модератора создаются автоматически триггером на `user_roles` — **новый модератор: выдать роль `moderator`, папки появятся сами.** Онбординг-миграции больше не копипастят создание папок. И: тьютор-модератор ОБЯЗАН иметь **обе** роли `tutor` + `moderator` (KB-UI живёт под `/tutor/*`).

## Двойной write-path в ДЗ (см. rule 40)

Задача попадает в ДЗ двумя путями: «+ из БЗ» в конструкторе (path A, через edge) и «В ДЗ» с карточки KB (path B, прямой INSERT в `HWDrawer`). Новое поле-носитель → в **оба**: `KBTask` → `kbTaskToDraftTask` → `DraftTask`, и `HWDraftTask` → `hwDraftStore.addTask` → `HWDrawer`. Плюс `copyTaskToFolder` (base→base копия обязана быть lossless) и `handleSaveTasksToKB` (save-back из ДЗ).

## Тип задачи в AI-загрузчике — `ReviewExam`, а не `ExamType`

`ReviewOverrides.exam` = `'' | ege | oge | olympiad | other` (БД-enum `exam_type` расширять НЕЛЬЗЯ — готча `ALTER TYPE`; `olympiad`/`other` живут как **`exam NULL`**). Любой новый читатель `ov.exam` — маппер, скоринг, чекер, insert — ОБЯЗАН пройти **`overrideExamToDb`** (`AiTaskLoader/reviewTypes.ts`), а фолбэки/сравнения типа считать в домене `ReviewExam` **до** конверсии: `overrideExamToDb('olympiad') = null`, поэтому цепочка `a ?? b ?? d.exam` доезжает до AI-догадки и приклеивает ЕГЭ-тему к олимпиадной задаче (в БД `exam NULL` + ЕГЭ-тема, а kind-фильтр селекта её прячет — в UI «Не выбрана»). Гейт `!isOlympiad` для № КИМ нужен в **КАЖДОМ** маппере (KB/hw/mock) — иначе скрытый КИМ уводит олимпиадную задачу в Часть 2 варианта. Олимпиада: **`difficulty === primary_score` безусловно** (зеркало `CreateTaskModal`), пустая сложность = молчаливая потеря типа. Глубина — skill `kb-module` (ВОЛНА 8).

## Прочее

- `MathText`/KaTeX **не импортировать** в `src/components/ui/*` (performance.md). В KB — только через `MathText` (lazy KaTeX); `hasMath=false` → plain text, нулевой overhead.
- Новое поле `kb_tasks` → решить: catalog-safe (в column-lists `kb_publish_task`/`kb_resync_task` + условие resync-триггера) или tutor-only. Default — catalog-safe; tutor-only только если поле утечёт ученикам через homework-рантайм.
- Рекурсивные счётчики папок — только через RPC `kb_folder_recursive_counts()`. Client-side подсчёт по всем `kb_tasks` **не возрождать**: PostgREST режет ответ на 1000 строк → тихий недосчёт у крупной базы.
- Новый bucket в KB/homework write-path → `HOMEWORK_AI_BUCKETS` (rule 40), иначе AI галлюцинирует.
