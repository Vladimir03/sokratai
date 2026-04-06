# Feature Spec: KB Picker Drawer в визарде создания ДЗ

**Статус:** реализовано (2026-03-14)
**Job:** P0.1 — Собрать ДЗ по теме после урока
**Commit:** `4ed43c8` feat(kb): add KB picker drawer to homework wizard

---

## Проблема

Репетитор создаёт ДЗ в визарде (`TutorHomeworkCreate`). Чтобы добавить задачу из Базы знаний, ему нужно уходить на страницу KB, терять контекст draft-а и возвращаться. Это ломает flow и замедляет сборку ДЗ.

## Решение

Боковой drawer (Sheet), открываемый кнопкой «+ Добавить из базы» прямо внутри визарда. Без page redirect, без потери draft.

---

## Компоненты

### KBPickerSheet (`src/components/tutor/KBPickerSheet.tsx`)

Side drawer (`side="right"`, `w-[460px] max-w-[90vw]`) с двумя табами:

| Таб | Содержимое | Хуки |
|-----|-----------|------|
| Каталог Сократа | Темы → drill-down → задачи (`owner_id IS NULL`) | `useTopics`, `useCatalogTasks`, `useSubtopics` |
| Моя база | Папки → drill-down → задачи (`owner_id = user`) | `useRootFolders`, `useFolder` |

**Props:**

```typescript
interface KBPickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddTasks: (tasks: KBTask[]) => void;   // batch callback
  addedKbTaskIds: Set<string>;              // для дедупликации
  topicHint?: string;                       // auto-select темы
}
```

**Внутренние компоненты:**
- `PickerTaskCard` — компактная карточка задачи (collapsed-only, checkbox для batch, «В ДЗ» CTA)
- `CatalogBrowser` — список тем → drill-down в задачи
- `FolderBrowser` — список папок → drill-down в задачи
- `TopicRow`, `FolderRow` — строки списка

**Batch select:** появляется при 3+ доступных (не добавленных) задачах. Чекбоксы + кнопка «Добавить выбранные (N)».

**Topic hint:** `useEffect` auto-select темы по `topicHint` (string match по названию). Не render-phase setState.

### Интеграция в TutorHomeworkCreate

**Кнопка входа:** «+ Добавить из базы» (Library icon) в `StepTasks`.

**Конвертер:** `kbTaskToDraftTask(task: KBTask): DraftTask` — создаёт DraftTask с KB-provenance полями.

**Batch callback:** `handleAddFromKB(kbTasks: KBTask[])` — single `onChange` call, без stale closure.

**Post-submit:** insert в `homework_kb_tasks` с FK retry pattern (на `23503` — retry с `task_id: null`, на другие ошибки — `toast.warning`).

---

## Поля провенанса в DraftTask

```typescript
kb_task_id?: string | null;          // id задачи в KB
kb_source?: 'socrat' | 'my';        // источник
kb_snapshot_text?: string;           // снапшот текста
kb_snapshot_answer?: string | null;  // снапшот ответа
kb_snapshot_solution?: string | null;
kb_attachment_url?: string | null;   // first image storage:// URL из KB (homework flow пока single-image)
```

## Snapshot-семантика

- Сохраняется **финальный отредактированный текст** (`t.task_text`), не оригинал KB
- `snapshot_edited = true` если изменился text ИЛИ answer (сравнение с `kb_snapshot_*`)
- `task_answer_snapshot = t.correct_answer.trim() || null` — без fallback на KB оригинал
- Если у KB-задачи несколько attachment images, в `kb_attachment_url` попадает только **первое** изображение. Full multi-image homework support остаётся отдельной future phase.

## UX-индикаторы

| Индикатор | Где | Условие |
|-----------|-----|---------|
| `SourceBadge` (Каталог / Моя) | TaskEditor header | `task.kb_source` set |
| Amber attachment badge (📎 Есть изображение в базе) | TaskEditor header | `kb_attachment_url` set && no `task_image_path` |

---

## Архитектурное решение

KBPickerSheet работает через **локальный React state** визарда (`onAddTasks` → `DraftTask[]`), а НЕ через глобальный `hwDraftStore` (Zustand). Это отдельный flow от KB-страниц → HWDrawer (BLOCK 6.1–6.3 в kb-tech-spec.md).

## Ограничения (P2)

- Mobile: Sheet `side="right"` — на mobile нужен `side="bottom"` full-screen (doc 17, section 4.3)
- `kb_attachment_url`: homework flow по-прежнему single-image; extra images из multi-image KB task не переносятся в student homework runtime
- cross-bucket copy (kb-attachments → homework-task-images) не реализован и не нужен для текущего `storage://` pattern
- Поиск/фильтр внутри picker не реализован

---

## Связанные документы

- `CLAUDE.md` → секция «База знаний (KB)» → «Интеграция KB → конструктор ДЗ»
- `docs/kb/kb-tech-spec.md` → BLOCK 6
- `docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules-sokrat.md` → 4.3.1
