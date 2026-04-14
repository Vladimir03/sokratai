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

## Дизайн-токены KB
- Primary: `bg-accent` / `fill-accent` (socrat green, #1B6B4A)
- Folder: `bg-socrat-folder` / `bg-socrat-folder-bg` (purple, #5B5FC7)
- Accent: `bg-socrat-accent` (orange, #E8913A, "Моя" badge)
- Surface hover: `hover:bg-socrat-surface` (#F7F6F3)

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

## Спецификация
- Tech spec: docs/delivery/features/kb/kb-tech-spec.md
- Design ref: docs/discovery/product/kb/kb-design-ref.jsx
- Tasks: docs/delivery/features/kb/kb-tasks.md
