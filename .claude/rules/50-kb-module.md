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
