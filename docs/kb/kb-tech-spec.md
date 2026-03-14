# Tech Spec — Socrat Knowledge Base MVP

## Контекст для Claude Code

**Проект:** SokratAI — AI platform for tutoring and homework automation.
**Стек:** React / TypeScript / Vite / React Query / Supabase (Auth, DB, Storage, Edge Functions) / KaTeX
**Модуль:** База знаний для кабинета репетитора (Tutor-домен)
**Спецификация:** Этот документ → `docs/kb/kb-tech-spec.md`
**Дизайн-референс:** `docs/kb/kb-design-ref.jsx`
**Задачи:** `docs/kb/kb-tasks.md`

### Интеграция с существующим проектом

**Домен:** Tutor (изолирован от Student — см. CLAUDE.md).
- Страницы: `src/pages/tutor/knowledge/`
- Компоненты: `src/components/kb/`
- Хуки: `src/hooks/useKnowledgeBase.ts`, `src/hooks/useFolders.ts`
- Типы: `src/types/kb.ts`
- Store: `src/stores/hwDraftStore.ts`

**Существующая homework-система:** `homework_tutor_*` таблицы — НЕ ТРОГАТЬ.
KB-модуль создаёт параллельную таблицу `homework_kb_tasks` для связки KB-задач с ДЗ.

**DB rules (из AGENTS.md):** Только additive миграции. Нельзя ALTER/DROP существующих таблиц.

**Safari (из CLAUDE.md):** font-size >= 16px на input/textarea, date-fns для дат, no RegExp lookbehind.

**Валидация:** `npm run build && npm run smoke-check`

### Как использовать дизайн-макет как референс

В `docs/kb/kb-design-ref.jsx` — интерактивный React-макет всех экранов. Это **живой референс**, а не продакшн-код.

**Правила:**
1. Перед каждым блоком прочитай соответствующую секцию макета для UX-контракта.
2. **НЕ копируй** — макет на inline styles с mock-данными. Продакшн = Tailwind + React Query + TypeScript.
3. Используй макет для: структуры компонентов, состава props, порядка элементов, CTA-кнопок.

**Конкретные секции макета → блоки реализации:**

| Секция макета | Компонент/функция | Блок задач |
|---|---|---|
| Tabs `catalog`/`mybase` | Переключатель Каталог/Моя база | BLOCK 2: Frontend |
| `CatalogHome` | Каталог Сократа (read-only) | BLOCK 2: Frontend |
| `MyBaseHome` | Моя база — список папок | BLOCK 2: Frontend |
| `FolderScreen` | Внутри папки: breadcrumbs + подпапки + задачи | BLOCK 2: Frontend |
| `FolderCard` | Карточка папки | BLOCK 2: Frontend |
| `CopyToFolderModal` | Модал выбора папки при копировании из каталога | BLOCK 2: Frontend |
| `TopicCard` | Карточка темы в каталоге | BLOCK 2: Frontend |
| `CatalogTopicScreen` | Экран темы каталога (read-only + copy) | BLOCK 2: Frontend |
| `TaskCard` | Универсальная карточка задачи | BLOCK 2: Frontend |
| `MaterialCard` | Карточка материала | BLOCK 2: Frontend |
| `HWDrawer` | Drawer конструктора ДЗ со snapshot (Flow B: KB-страницы) | BLOCK 6: HW Integration |
| `KBPickerSheet` | Sheet-picker из визарда ДЗ (Flow A: TutorHomeworkCreate) | BLOCK 6: HW Integration |
| `COLORS`, `FONTS` | Дизайн-токены | BLOCK 1: Design System |
| `INITIAL_FOLDERS` | Рекурсивная структура папок | BLOCK 3: Data Model |

---

## BLOCK 1 — Design System & Tokens

**Цель:** Зафиксировать дизайн-токены и базовые UI-примитивы, чтобы все последующие блоки строились на единой системе.

**Референс:** Секции `COLORS`, `FONTS`, `Badge`, `Icon` в макете.

### Задача 1.1 — Tailwind-конфиг

Расширить `tailwind.config.ts`:

```
colors:
  socrat:
    primary: #1B6B4A
    primary-light: #E8F5EE
    primary-dark: #145236
    accent: #E8913A
    accent-light: #FFF3E6
    ege: #1B6B4A
    ege-bg: #E8F5EE
    oge: #5B5FC7
    oge-bg: #EEEFFE
    surface: #F7F6F3
    card: #FFFFFF
    border: #E5E5E0
    border-light: #F0EFEB
    muted: #9CA3AF

fontFamily:
  display: Georgia, Times New Roman, serif
  body: system-ui (-apple-system, Segoe UI, etc.)
  mono: SF Mono, Fira Code, monospace
```

### Задача 1.2 — Базовые UI-компоненты

Создать в `src/components/ui/kb/`:

| Компонент | Props | Назначение |
|---|---|---|
| `ExamBadge` | `exam: 'ege' \| 'oge'` | Бейдж экзамена с цветом |
| `SourceBadge` | `source: 'socrat' \| 'my'` | Бейдж источника задачи |
| `KBSearchInput` | `value, onChange, placeholder` | Поисковая строка с иконкой |
| `FilterChips` | `options[], selected, onChange` | Ряд фильтров-чипсов |
| `ContextMenu` | `items[], trigger` | Dropdown-меню через ⋯ |
| `TopicChip` | `label` | Чип подтемы |
| `StatCounter` | `value, label` | Счётчик (42 задач) |

### Задача 1.3 — Иконки

Использовать `lucide-react` (уже в проекте). Маппинг из макета:

```
search → Search
book → BookOpen
plus → Plus
check → Check
copy → Copy
sparkles → Sparkles (AI-похожая)
chevron-right → ChevronRight
x → X
folder → Folder
file-text → FileText
link → Link2
image → Image
more-vertical → MoreVertical
edit → Pencil
trash → Trash2
arrow-left → ArrowLeft
clock → Clock
filter → Filter
```

---

## BLOCK 2 — Frontend: Экраны и компоненты

**Цель:** Создать все пользовательские экраны Базы знаний.

**Референс:** `HomeScreen`, `TopicScreen`, `TopicCard`, `TaskCard`, `MaterialCard` в макете.

### Задача 2.1 — Роутинг

Добавить маршруты в существующий роутер кабинета репетитора:

```
/tutor/knowledge                → KnowledgeBasePage (tabs: Каталог / Моя база)
/tutor/knowledge/topic/:topicId → CatalogTopicPage  (экран темы каталога)
/tutor/knowledge/folder/:folderId → FolderPage      (экран папки из Моей базы)
```

### Задача 2.2 — KnowledgeBasePage (главный экран с табами)

**Референс макета:** tabs `catalog`/`mybase` и компоненты `CatalogHome` / `MyBaseHome`

Структура экрана:

```
<TabSwitcher>
  [Каталог Сократа] [Моя база]

If tab === "catalog":
  <CatalogHome />
    — Заголовок "Каталог задач" + описание "Общая база · Копируйте нужные задачи к себе"
    — KBSearchInput
    — ExamFilterToggle: ЕГЭ / ОГЭ (pill-switcher, ЕГЭ по умолчанию)
    — Список тем, сгруппированных по section → TopicCard

If tab === "mybase":
  <MyBaseHome />
    — Заголовок "Моя база" + кнопка "Новая папка"
    — Список корневых папок → FolderCard
    — Кнопка "+ Добавить задачу" (в корень)
```

TabSwitcher — pill-стиль на сером фоне, active tab — белый с тенью.

### Задача 2.3 — TopicCard (для каталога)

**Референс макета:** компонент `TopicCard`

```tsx
interface TopicCardProps {
  topic: {
    id: string;
    name: string;
    section: string;
    exam: 'ege' | 'oge';
    taskCount: number;
    materialCount: number;
    kimNumbers: number[];
    subtopics: string[];
  };
  onClick: () => void;
}
```

Layout:
```
[card, rounded-xl, border, hover:border-primary/30]
  Row: justify-between
    Left:
      Row: topic.name + <ExamBadge />
      Row: "{taskCount} задач · {materialCount} материалов · КИМ № {kimNumbers.join(', ')}"
      Row (muted, truncate): subtopics.join(' · ')
    Right:
      <ChevronRight />
```

### Задача 2.4 — CatalogTopicPage (read-only + copy)

**Референс макета:** компонент `CatalogTopicScreen`

Структура:

```
<TopicHeader>
  — card с названием, ExamBadge, бейдж "Каталог", section, KIM lines
  — чипсы подтем
  — счётчик задач

<TasksSection>
  — список TaskCard (все из общей базы по данной теме)
  — кнопки на каждой задаче: "К себе" + "В ДЗ"

<MaterialsSection>
  — grid 2-col: MaterialCard
```

**Ключевое отличие от v1:** Здесь НЕТ фильтра "Мои/Сократ" — это экран каталога, все задачи из общей базы. CTA "К себе" → открывает CopyToFolderModal.

**Данные:**
- `useTasks(topicId)` — задачи только из каталога (owner_id IS NULL)
- `useMaterials(topicId)` — материалы из каталога

### Задача 2.5 — FolderCard

**Референс макета:** компонент `FolderCard`

```tsx
interface FolderCardProps {
  folder: { id: string; name: string; childCount: number; taskCount: number; };
  onClick: () => void;
}
```

Layout:
```
[card, rounded-xl, border, hover:border-folder/40, flex row, gap-3]
  [folder-icon 40x40, rounded-lg, folder-bg]
  Column:
    name (font-semibold, 15px)
    "{childCount} папок · {taskCount} задач" (secondary, 12px)
  ChevronRight
```

### Задача 2.6 — FolderScreen (внутри папки)

**Референс макета:** компонент `FolderScreen`

Структура:

```
<Breadcrumbs>
  Моя база / Физика 10кл / Кинематика
  — каждый сегмент кликабельный → navigate to parent

<FolderHeader>
  title: folder.name
  Actions: [+ Подпапка] [+ Задача]

<SubfoldersSection> (если есть children)
  — заголовок "Папки" (uppercase, secondary)
  — список FolderCard

<TasksSection> (если есть tasks)
  — заголовок "Задачи" (uppercase, secondary)
  — список TaskCard (isOwn = true, полные права)

<EmptyState> (если нет ни children, ни tasks)
  — 📂 "Папка пуста"
  — "Добавьте подпапки или скопируйте задачи из Каталога"
```

**Данные:**
- `useFolder(folderId)` — данные папки
- `useSubfolders(folderId)` — дочерние папки
- `useFolderTasks(folderId)` — задачи в этой папке

### Задача 2.7 — CopyToFolderModal

**Референс макета:** компонент `CopyToFolderModal`

Модал для выбора целевой папки при копировании задачи из каталога.

```
<Modal>
  Header: "Копировать в папку"
  Preview: первая строка текста задачи (line-clamp-1)

  Content (scrollable):
    — Рекурсивный список папок с отступами по глубине
    — Клик на папку → selected state (зелёный фон)
    — Вложенные папки отображаются с indent 20px * depth

  Footer:
    [Отмена] [Скопировать] (disabled если ничего не выбрано)

  При клике "Скопировать":
    — POST в kb_tasks: новая строка с owner_id = user, folder_id = selected, text/answer скопированы
    — Toast: "Скопировано в папку {name}"
    — Закрыть модал
```

**Данные:** `useFolderTree()` — рекурсивный запрос всех папок текущего пользователя.

### Задача 2.8 — TaskCard (универсальный)

**Референс макета:** компонент `TaskCard`

Единый компонент, работает в двух режимах через prop `isOwn`:

```tsx
interface TaskCardProps {
  task: KBTask;
  isOwn: boolean;              // true = из моей папки, false = из каталога
  onCopyToFolder?: () => void; // только для каталога
  onAddToHW: () => void;
  inHW: boolean;
}
```

Два состояния: collapsed и expanded.

```
Collapsed:
  Row: Badge (isOwn ? "Моя" : "Каталог") + subtopic + "КИМ № {N}" + Image icon (+ count if >1)
  Text (line-clamp-2): task.text

  Actions:
    if isOwn === false (каталог):
      [К себе] — фиолетовая кнопка → onCopyToFolder → CopyToFolderModal
      [В ДЗ] — зелёная кнопка → snapshot + addToHW
    if isOwn === true (своя папка):
      [В ДЗ] — зелёная кнопка → snapshot + addToHW
      [⋯] — edit / delete / AI-похожая

Expanded:
  + Полный текст
  + Gallery preview всех attachment images (если есть)
  + Блок "Ответ" на сером фоне
```

**Состояние кнопки "В ДЗ":**
- Не в ДЗ: зелёная кнопка
- В ДЗ: light-зелёный + Check icon, disabled

### Задача 2.9 — MaterialCard

**Референс макета:** компонент `MaterialCard`

```tsx
type MaterialType = 'file' | 'link' | 'media' | 'board';

interface MaterialCardProps {
  material: {
    id: string;
    type: MaterialType;
    name: string;
    format: string; // "PDF", "YouTube", "JPG", etc.
    url?: string;
    storageKey?: string;
  };
}
```

Layout:
```
[card, rounded-xl, border, flex row, gap-3]
  [icon-container 36x36, rounded-lg, tinted bg]
    FileText / Link2 / Image / Layout (по type)
  Column:
    name (truncate)
    format (muted, 11px)
```

### Задача 2.10 — CreateTaskModal

Модальное окно создания задачи в личной базе.

```
Обязательные поля:
  - Условие задачи (textarea, поддержка LaTeX через KaTeX preview)
  - Папка: select из дерева папок пользователя (по умолчанию = текущая папка)

Опциональные поля:
  - Экзамен: select [ЕГЭ / ОГЭ]
  - Ответ (text input)
  - Решение / пояснение (textarea, LaTeX preview)
  - Формат ответа: select [число / выражение / выбор / соответствие]
  - Вложения: до 5 изображений (JPG / PNG / GIF / WebP) → Supabase Storage
    - file picker
    - paste from clipboard
    - drag & drop

Footer:
  [Отмена] [Сохранить]
```

При сохранении: `owner_id = user`, `folder_id = selected folder`. Тема/подтема НЕ обязательны для личных задач.
Если прикреплено хотя бы одно изображение, текст задачи может быть пустым.
Во время `saving` attachment controls frozen. При failed upload / save уже загруженные новые blobs должны очищаться.

### Задача 2.11 — AddMaterialModal

```
Тип материала: radio [Файл / Ссылка / Медиа / Доска]

If файл:
  — file upload (PDF, Word, JPG, PNG) → Supabase Storage
If ссылка / медиа / доска:
  — URL input + auto-detect title
  — Manual title override

Привязка:
  — Тема: select (required)

Footer:
  [Отмена] [Сохранить]
```

---

## BLOCK 3 — Data Model (Supabase)

**Цель:** Создать таблицы, RLS-политики, индексы, seed-данные.

**Референс:** Структуры `PHYSICS_TOPICS`, `SAMPLE_TASKS`, `SAMPLE_MATERIALS` в макете определяют контракт данных.

### Задача 3.1 — Миграция: core-таблицы

```sql
-- Экзамены
CREATE TYPE exam_type AS ENUM ('ege', 'oge');

-- ═══ КАТАЛОГ СОКРАТА (read-only для репетиторов) ═══

-- Темы каталога
CREATE TABLE kb_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  section TEXT NOT NULL,          -- "Механика", "МКТ и термодинамика"...
  exam exam_type NOT NULL,
  kim_numbers INTEGER[] DEFAULT '{}', -- [1, 2, 26]
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Подтемы каталога
CREATE TABLE kb_subtopics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID REFERENCES kb_topics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

-- ═══ ЛИЧНАЯ БАЗА РЕПЕТИТОРА (папки) ═══

-- Папки (рекурсивная структура, произвольная вложенность)
CREATE TABLE kb_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES auth.users(id) NOT NULL,
  parent_id UUID REFERENCES kb_folders(id) ON DELETE CASCADE,  -- NULL = корневая папка
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Индексы папок
CREATE INDEX idx_folders_owner ON kb_folders(owner_id);
CREATE INDEX idx_folders_parent ON kb_folders(parent_id);

-- ═══ ЗАДАЧИ (живут или в каталоге, или в папке) ═══

CREATE TABLE kb_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Привязка к каталогу (для задач общей базы Сократа)
  topic_id UUID REFERENCES kb_topics(id),
  subtopic_id UUID REFERENCES kb_subtopics(id),
  -- Привязка к папке (для личных задач репетитора)
  folder_id UUID REFERENCES kb_folders(id) ON DELETE SET NULL,
  -- Владелец: NULL = общая база (каталог Сократа)
  owner_id UUID REFERENCES auth.users(id),
  exam exam_type,
  kim_number INTEGER,
  text TEXT NOT NULL,
  answer TEXT,
  solution TEXT,
  answer_format TEXT,
  source_label TEXT DEFAULT 'socrat',
  attachment_url TEXT, -- single storage ref or JSON array string for multi-image tasks
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Материалы (аналогично: каталог или папка)
CREATE TABLE kb_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID REFERENCES kb_topics(id),
  folder_id UUID REFERENCES kb_folders(id) ON DELETE SET NULL,
  owner_id UUID REFERENCES auth.users(id),
  type TEXT NOT NULL CHECK (type IN ('file', 'link', 'media', 'board')),
  name TEXT NOT NULL,
  format TEXT,
  url TEXT,
  storage_key TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Индексы
CREATE INDEX idx_tasks_topic ON kb_tasks(topic_id);
CREATE INDEX idx_tasks_folder ON kb_tasks(folder_id);
CREATE INDEX idx_tasks_owner ON kb_tasks(owner_id);
CREATE INDEX idx_tasks_exam ON kb_tasks(exam);
CREATE INDEX idx_tasks_text_search ON kb_tasks USING gin(to_tsvector('russian', text));
CREATE INDEX idx_materials_topic ON kb_materials(topic_id);
CREATE INDEX idx_materials_folder ON kb_materials(folder_id);
CREATE INDEX idx_topics_exam ON kb_topics(exam);
```

**Архитектура двух пространств:**

| Пространство | Задача привязана к | owner_id | Кто видит | Кто редактирует |
|---|---|---|---|---|
| Каталог Сократа | `topic_id` (NOT NULL) | NULL | Все | Никто (read-only) |
| Личная база | `folder_id` (NOT NULL) | user_id | Только владелец | Только владелец |

При копировании задачи из каталога в папку: создаётся новая строка в `kb_tasks` с `owner_id = user`, `folder_id = выбранная папка`, `topic_id = NULL`. Оригинал не затрагивается.

**Attachment contract (implemented 2026-03-14):**

- `NULL` -> у задачи нет изображений
- single image -> `storage://kb-attachments/...`
- multi-image -> JSON array string с `storage://` refs
- каноничные helpers: `parseAttachmentUrls()` / `serializeAttachmentUrls()` в `src/lib/kbApi.ts`
- current max = `5` images per task (UI-enforced)

### Задача 3.2 — Миграция: homework-связка (со snapshot)

**Архитектурное решение — Snapshot при добавлении в ДЗ:**

Когда репетитор нажимает "В ДЗ", система автоматически сохраняет снимок (snapshot) текста задачи и ответа в таблицу `homework_kb_tasks`. Это решает проблему конфликта: если общая база Сократа изменится (условие задачи обновлено, числа исправлены, задача удалена), уже назначенные ДЗ остаются неизменными — ученик видит ровно то, что репетитор задавал.

Snapshot можно редактировать: репетитор может подправить условие прямо внутри конкретного ДЗ (например, поменять числа под уровень ученика). Это правка только в этом ДЗ — оригинал в базе не затрагивается.

Три уровня доступа к задаче:

| Где | Читать | Редактировать | Удалить |
|---|---|---|---|
| Общая база (Сократ) | Все | Никто | Никто |
| Моя база | Только владелец | Только владелец | Только владелец |
| Snapshot в ДЗ | Репетитор + ученик | Репетитор (только этот snapshot) | Репетитор (убрать из ДЗ) |

```sql
-- Задачи в ДЗ (связь homework ↔ kb_tasks) со snapshot
CREATE TABLE homework_kb_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  homework_id UUID REFERENCES homeworks(id) ON DELETE CASCADE,
  task_id UUID REFERENCES kb_tasks(id) ON DELETE SET NULL,  -- SET NULL, не CASCADE: если задачу удалят из базы, snapshot останется
  sort_order INTEGER DEFAULT 0,

  -- Snapshot: фиксация условия на момент назначения
  task_text_snapshot TEXT NOT NULL,        -- условие задачи (копируется при "В ДЗ")
  task_answer_snapshot TEXT,               -- ответ (копируется при "В ДЗ")
  task_solution_snapshot TEXT,             -- решение (копируется при "В ДЗ")
  snapshot_edited BOOLEAN DEFAULT FALSE,   -- TRUE если репетитор правил snapshot вручную

  added_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(homework_id, task_id)
);
```

**Логика snapshot:**
- При нажатии "В ДЗ": `task_text_snapshot` = текущий `kb_tasks.text`, `task_answer_snapshot` = текущий `kb_tasks.answer`, `task_solution_snapshot` = текущий `kb_tasks.solution`.
- Ученик **всегда** видит snapshot, а не оригинал из kb_tasks.
- Если `task_id` стал NULL (задача удалена из общей базы), snapshot продолжает работать — ДЗ не ломается.
- Если репетитор отредактировал snapshot, `snapshot_edited` = TRUE (для аналитики).

**Примечание:** таблица `homeworks` уже должна существовать в текущей схеме. Если нет — создать минимальную:

```sql
CREATE TABLE homeworks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id UUID REFERENCES auth.users(id),
  student_id UUID,
  title TEXT,
  status TEXT DEFAULT 'draft', -- draft | sent | completed
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Задача 3.3 — Виртуальные поля (views)

```sql
-- Вью для тем с агрегатами (counts)
CREATE VIEW kb_topics_with_counts AS
SELECT
  t.*,
  COALESCE(tc.task_count, 0) AS task_count,
  COALESCE(mc.material_count, 0) AS material_count,
  ARRAY(
    SELECT s.name FROM kb_subtopics s
    WHERE s.topic_id = t.id ORDER BY s.sort_order
  ) AS subtopic_names
FROM kb_topics t
LEFT JOIN (
  SELECT topic_id, COUNT(*) AS task_count
  FROM kb_tasks GROUP BY topic_id
) tc ON tc.topic_id = t.id
LEFT JOIN (
  SELECT topic_id, COUNT(*) AS material_count
  FROM kb_materials GROUP BY topic_id
) mc ON mc.topic_id = t.id;
```

### Задача 3.4 — Seed: таксономия физики ЕГЭ и ОГЭ (раздельно)

Заполнить `kb_topics` и `kb_subtopics` на основе кодификатора ФИПИ 2026.

**Важно:** ЕГЭ и ОГЭ — это РАЗНЫЕ экзамены с разной нумерацией КИМ. Одна и та же тема ("Кинематика") создаётся как ДВЕ отдельные строки — для ЕГЭ и для ОГЭ. Тип `exam_type` = только `'ege'` или `'oge'`.

```
═══ ЕГЭ ФИЗИКА ═══

Механика (ЕГЭ):
  Кинематика — КИМ № 1, 2, 26
  Динамика — КИМ № 2, 3, 26
  Законы сохранения — КИМ № 3, 4, 27
  Статика — КИМ № 3, 26

МКТ и термодинамика (ЕГЭ):
  Молекулярная физика — КИМ № 7, 8, 9
  Термодинамика — КИМ № 8, 9, 24

Электродинамика (ЕГЭ):
  Электростатика — КИМ № 10, 11, 25
  Постоянный ток — КИМ № 11, 12, 25
  Магнетизм — КИМ № 12, 13
  Электромагнитная индукция — КИМ № 13, 27

Колебания и волны (ЕГЭ):
  Механические колебания — КИМ № 5, 6
  Электромагнитные колебания — КИМ № 14

Оптика (ЕГЭ):
  Геометрическая оптика — КИМ № 14, 15, 25
  Волновая оптика — КИМ № 15

Квантовая физика (ЕГЭ):
  Фотоэффект — КИМ № 16, 17
  Атом и ядро — КИМ № 17, 18

═══ ОГЭ ФИЗИКА ═══

Механика (ОГЭ):
  Кинематика — КИМ № 1, 2
  Динамика — КИМ № 3, 4
  Законы сохранения — КИМ № 4, 5

Тепловая физика (ОГЭ):
  Тепловые явления — КИМ № 7, 8, 9

Электродинамика (ОГЭ):
  Электрические явления — КИМ № 10, 11, 12
  Магнетизм — КИМ № 12, 13

Оптика (ОГЭ):
  Оптика — КИМ № 13, 14

Квантовая физика (ОГЭ):
  Атом и ядро — КИМ № 15, 16
```

Seed также 15–20 задач для темы "Кинематика ЕГЭ" (из открытого банка ФИПИ) чтобы демонстрировать функционал.

---

## BLOCK 4 — Search

**Цель:** Поиск по темам, подтемам, тексту задач и материалам в каталоге.

### Задача 4.1 — Поиск на стороне Supabase

**Подход:** Postgres full-text search с tsvector по русскому языку. Поиск включает названия тем, подтем и полный текст задач.

```sql
-- Функция поиска (вызывается через supabase.rpc)
CREATE OR REPLACE FUNCTION kb_search(
  query TEXT,
  exam_filter exam_type NOT NULL,       -- обязательный: 'ege' или 'oge' (нет "все")
  source_filter TEXT DEFAULT NULL,       -- 'socrat' | 'my'
  user_id UUID DEFAULT NULL,
  result_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  result_type TEXT,   -- 'topic' | 'task' | 'material'
  result_id UUID,
  title TEXT,
  snippet TEXT,
  exam exam_type,
  source TEXT,
  relevance REAL
) AS $$
BEGIN
  RETURN QUERY

  -- Темы (ищем по названию темы + названиям подтем)
  SELECT 'topic'::TEXT, t.id, t.name, t.section,
         t.exam, 'socrat'::TEXT,
         ts_rank(
           to_tsvector('russian', t.name || ' ' || t.section || ' ' || COALESCE(
             (SELECT string_agg(s.name, ' ') FROM kb_subtopics s WHERE s.topic_id = t.id), ''
           )),
           plainto_tsquery('russian', query)
         )
  FROM kb_topics t
  WHERE to_tsvector('russian', t.name || ' ' || t.section || ' ' || COALESCE(
          (SELECT string_agg(s.name, ' ') FROM kb_subtopics s WHERE s.topic_id = t.id), ''
        )) @@ plainto_tsquery('russian', query)
    AND (t.exam = exam_filter)

  UNION ALL

  -- Задачи (ищем по тексту задачи)
  SELECT 'task'::TEXT, tk.id, SUBSTRING(tk.text, 1, 100), tk.answer,
         tk.exam,
         CASE WHEN tk.owner_id IS NULL THEN 'socrat' ELSE 'my' END,
         ts_rank(to_tsvector('russian', tk.text), plainto_tsquery('russian', query))
  FROM kb_tasks tk
  WHERE to_tsvector('russian', tk.text) @@ plainto_tsquery('russian', query)
    AND (tk.exam = exam_filter)
    AND (source_filter IS NULL
         OR (source_filter = 'socrat' AND tk.owner_id IS NULL)
         OR (source_filter = 'my' AND tk.owner_id = user_id))
    AND (tk.owner_id IS NULL OR tk.owner_id = user_id)

  UNION ALL

  -- Материалы
  SELECT 'material'::TEXT, m.id, m.name, m.format,
         NULL::exam_type, 'socrat'::TEXT,
         ts_rank(to_tsvector('russian', m.name), plainto_tsquery('russian', query))
  FROM kb_materials m
  WHERE to_tsvector('russian', m.name) @@ plainto_tsquery('russian', query)
    AND (m.owner_id IS NULL OR m.owner_id = user_id)

  ORDER BY relevance DESC
  LIMIT result_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Задача 4.2 — React-хук `useKBSearch`

```ts
function useKBSearch(query: string, filters: { exam?: ExamType; source?: string }) {
  // debounce 300ms
  // вызов supabase.rpc('kb_search', { query, exam_filter, source_filter, user_id })
  // группировка результатов по result_type
  // возврат { topics, tasks, materials, isLoading }
}
```

### Задача 4.3 — UI поисковой выдачи

При вводе в `KBSearchInput` на главном экране:

- Показать dropdown с результатами, сгруппированными:
  ```
  Темы (3)
    [TopicCard mini] ...
  Задачи (5)
    [TaskCard mini] ...
  Материалы (2)
    [MaterialCard mini] ...
  ```
- Клик по теме → переход на TopicDetailPage
- Клик по задаче → переход на тему + scroll до задачи

---

## BLOCK 5 — Permissions (RLS)

**Цель:** Row Level Security — общая база только на чтение, своя база с полным доступом.

### Задача 5.1 — RLS-политики для kb_tasks

```sql
ALTER TABLE kb_tasks ENABLE ROW LEVEL SECURITY;

-- Чтение: все видят общие задачи + свои
CREATE POLICY "tasks_select" ON kb_tasks FOR SELECT USING (
  owner_id IS NULL                        -- общая база — всем
  OR owner_id = auth.uid()                -- своя — только владельцу
);

-- Создание: только свои
CREATE POLICY "tasks_insert" ON kb_tasks FOR INSERT WITH CHECK (
  owner_id = auth.uid()
);

-- Обновление: только свои
CREATE POLICY "tasks_update" ON kb_tasks FOR UPDATE USING (
  owner_id = auth.uid()
);

-- Удаление: только свои
CREATE POLICY "tasks_delete" ON kb_tasks FOR DELETE USING (
  owner_id = auth.uid()
);
```

### Задача 5.2 — RLS-политики для kb_materials

```sql
ALTER TABLE kb_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "materials_select" ON kb_materials FOR SELECT USING (
  owner_id IS NULL OR owner_id = auth.uid()
);
CREATE POLICY "materials_insert" ON kb_materials FOR INSERT WITH CHECK (
  owner_id = auth.uid()
);
CREATE POLICY "materials_update" ON kb_materials FOR UPDATE USING (
  owner_id = auth.uid()
);
CREATE POLICY "materials_delete" ON kb_materials FOR DELETE USING (
  owner_id = auth.uid()
);
```

### Задача 5.3 — RLS для kb_topics, kb_subtopics, kb_folders

Темы и подтемы — read-only для всех авторизованных:

```sql
ALTER TABLE kb_topics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "topics_select" ON kb_topics FOR SELECT
  USING (auth.role() = 'authenticated');

ALTER TABLE kb_subtopics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subtopics_select" ON kb_subtopics FOR SELECT
  USING (auth.role() = 'authenticated');
```

Папки — полный CRUD только для владельца:

```sql
ALTER TABLE kb_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "folders_select" ON kb_folders FOR SELECT USING (
  owner_id = auth.uid()
);
CREATE POLICY "folders_insert" ON kb_folders FOR INSERT WITH CHECK (
  owner_id = auth.uid()
);
CREATE POLICY "folders_update" ON kb_folders FOR UPDATE USING (
  owner_id = auth.uid()
);
CREATE POLICY "folders_delete" ON kb_folders FOR DELETE USING (
  owner_id = auth.uid()
);
```

### Задача 5.4 — Storage policies

Bucket: `kb-attachments`

```sql
-- Загружать может только авторизованный
CREATE POLICY "kb_upload" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'kb-attachments' AND auth.role() = 'authenticated');

-- Читать могут все авторизованные
CREATE POLICY "kb_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'kb-attachments' AND auth.role() = 'authenticated');

-- Удалять только владелец (по owner в metadata)
CREATE POLICY "kb_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'kb-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);
```

### Задача 5.5 — Frontend enforcement

В `TaskCard`:
```ts
const isOwn = task.owner_id === currentUser.id;

// CTA-массив зависит от isOwn:
const menuItems = isOwn
  ? ['open', 'edit', 'delete', 'ai_similar']
  : ['open', 'copy_to_my', 'ai_similar'];
```

---

## BLOCK 6 — Homework Integration

**Цель:** Встроить Базу знаний в flow создания ДЗ. Это ключевой UX MVP.

**Референс макета:** компонент `HWDrawer`.

### Задача 6.1 — Состояние "корзины ДЗ" (глобальный стейт)

```ts
// Zustand store или React Context

interface HWDraftTask {
  taskId: string;
  // Snapshot — фиксируется при добавлении, редактируется репетитором
  textSnapshot: string;
  answerSnapshot: string | null;
  solutionSnapshot: string | null;
  snapshotEdited: boolean;
  // Мета-данные для отображения в drawer
  source: 'socrat' | 'my';
  subtopic: string;
  topicName: string;
}

interface HWDraftStore {
  homeworkId: string | null;
  tasks: HWDraftTask[];
  addTask: (task: KBTask) => void;        // создаёт snapshot из текущего текста задачи
  removeTask: (taskId: string) => void;
  reorderTasks: (from: number, to: number) => void;
  updateSnapshot: (taskId: string, field: 'textSnapshot' | 'answerSnapshot', value: string) => void;
  clearDraft: () => void;
  taskCount: number;  // computed
}
```

**Важно:** `addTask` принимает полный объект `KBTask`, но сохраняет в store уже как `HWDraftTask` — с готовыми snapshot-полями. Это момент "фотографирования" задачи.

Стейт живёт на уровне кабинета репетитора (персистится в localStorage чтобы не терялся при навигации).

### Задача 6.2 — HW Badge в навбаре

В верхней навигации кабинета (всегда видна):

```
[BookOpen icon] ДЗ · {taskCount}
```

- Если taskCount === 0: серый, border
- Если taskCount > 0: зелёный фон, primary border
- Клик → открывает HWDrawer

### Задача 6.3 — HWDrawer (правая панель)

> **NOTE (реализовано 2026-03-14):** Интеграция KB в визард ДЗ реализована через
> `KBPickerSheet` (`src/components/tutor/KBPickerSheet.tsx`) — Sheet, открываемый
> inline из `TutorHomeworkCreate.tsx` через локальный React state. `onAddTasks`
> callback передаёт задачи напрямую в локальный `DraftTask[]` массив визарда.
> Глобальный Zustand cart (`hwDraftStore`, задача 6.1) и навбар-бейдж (задача 6.2)
> описанные ниже — **НЕ реализованы** для этого flow и остаются deferred.
> HWDrawer из `src/components/kb/HWDrawer.tsx` продолжает работать для Flow B
> (KB-страницы → hwDraftStore → HWDrawer).
> См. `docs/features/specs/tutor-kb-picker-drawer.md`.

**Референс макета:** компонент `HWDrawer`

Структура:

```
<Sheet side="right" width="420px">
  <Header>
    "Домашнее задание"
    subtitle: "{N} задач"
    [X] close

  <Content scrollable>
    if tasks.length === 0:
      Empty state: иконка 📋, "Пока пусто", "Добавьте задачи из Базы знаний"
    else:
      ForEach task (draggable для reorder):
        [numbered circle] [SourceBadge] [subtopic]

        if NOT editing:
          [text preview of textSnapshot, line-clamp-2]
          [Pencil icon — inline edit] [X remove button]
        
        if editing (toggle по клику на Pencil):
          [textarea с textSnapshot, auto-height]
          [input с answerSnapshot, label "Ответ"]
          [Сохранить] [Отмена]
          — при сохранении: updateSnapshot(taskId, field, value), snapshotEdited = true
          — визуальный индикатор если snapshotEdited: мелкий бейдж "изменено"

  <Footer>
    [+ Добавить из Базы знаний] → navigate to /tutor/knowledge, keep drawer closable
    [Отправить ДЗ] → save to Supabase + send to student
      — disabled если tasks.length === 0
```

**UX-деталь:** Inline-редактирование snapshot — это как правка "от руки" на распечатке задачи. Репетитор может поменять числа, дописать уточнение, убрать лишнее — и это повлияет только на данное конкретное ДЗ.

### Задача 6.4 — Кнопка "В ДЗ" на TaskCard (со snapshot)

При клике:
1. `hwDraftStore.addTask(task)` — внутри метод создаёт snapshot:
   ```ts
   addTask: (task: KBTask) => {
      const draftTask: HWDraftTask = {
        taskId: task.id,
        textSnapshot: task.text,           // фиксируем текущий текст
        answerSnapshot: task.answer,       // фиксируем текущий ответ
        solutionSnapshot: task.solution,   // фиксируем текущее решение
        attachmentSnapshot: task.attachment_url, // single ref или JSON array string
        snapshotEdited: false,
        source: task.owner_id ? 'my' : 'socrat',
        subtopic: task.subtopic_name,
        topicName: task.topic_name,
      };
     set((state) => ({ tasks: [...state.tasks, draftTask] }));
   }
   ```
2. Toast notification: "Задача добавлена в ДЗ"
3. Кнопка меняет state на "✓ В ДЗ" (disabled, light green)
4. Badge в навбаре обновляется

**Ключевой момент:** с этой секунды snapshot живёт независимо от оригинала. Даже если оригинал задачи изменится или будет удалён — snapshot в ДЗ останется.
Если у задачи несколько attachment images, snapshot хранит их все, но текущий homework runtime использует только **первое** изображение. UI должен делать это ограничение видимым для репетитора.

### Задача 6.5 — Сохранение ДЗ (со snapshot)

При клике "Отправить ДЗ":

```ts
async function sendHomework() {
  // 1. Создать/обновить homework
  const { data: hw } = await supabase
    .from('homeworks')
    .upsert({ id: homeworkId, tutor_id: user.id, status: 'sent' })
    .select().single();

  // 2. Привязать задачи со snapshot
  const links = tasks.map((task, i) => ({
    homework_id: hw.id,
    task_id: task.taskId,
    sort_order: i,
    task_text_snapshot: task.textSnapshot,
    task_answer_snapshot: task.answerSnapshot,
    task_solution_snapshot: task.solutionSnapshot,
    snapshot_edited: task.snapshotEdited,
  }));
  await supabase.from('homework_kb_tasks').upsert(links);

  // 3. Очистить draft
  hwDraftStore.clearDraft();

  // 4. (Опционально) Telegram notification ученику
}
```

**Что видит ученик:** всегда `task_text_snapshot` из `homework_kb_tasks`, а не оригинал из `kb_tasks`. Это гарантирует, что задание не "поедет" после изменений в общей базе.

### Задача 6.6 — Точка входа из конструктора ДЗ

> **NOTE (реализовано 2026-03-14):** Вместо навигации на `/tutor/knowledge?hw=draft`
> реализован inline Sheet-drawer (`KBPickerSheet`) прямо внутри визарда.
> Кнопка «+ Добавить из базы» открывает drawer без page redirect.
> Это соответствует принципу 9 из doc 16 (workflow first) и запрету
> page redirect из doc 17 section 4.3.

Если в кабинете уже есть экран создания ДЗ (`/tutor/homework/new`), добавить кнопку:

```
[+ Добавить из Базы знаний]
```

~~Клик → navigate to `/tutor/knowledge` с query param `?hw=draft` чтобы экран знал, что пользователь в режиме подбора задач для ДЗ.~~

**Актуальная реализация:** Клик → открывает `KBPickerSheet` (side drawer) внутри визарда. Задачи добавляются через `onAddTasks` callback в локальный state.

---

## Порядок выполнения

```
Сессия 1: BLOCK 3 (3.1, 3.2) + BLOCK 5 (5.1–5.3) + BLOCK 3 (3.4)
    ↓                                    ↑ RLS создаётся вместе с таблицами
Сессия 2: Types (из BLOCK 3) + Hooks (из BLOCK 2 интерфейсов)
    ↓
Сессия 3: BLOCK 1 (design tokens + UI primitives)
    ↓
Сессия 4: BLOCK 2 (2.1–2.4) — main page + catalog
    ↓
Сессия 5: BLOCK 2 (2.5–2.7) — folders + copy modal
    ↓
Сессия 6: BLOCK 2 (2.8–2.10) — TaskCard + modals
    ↓
Сессия 7: BLOCK 4 (4.1–4.3) — search
    ↓
Сессия 8: BLOCK 6 (6.1–6.6) — HW integration + snapshots
```

**Почему Data Model первым:** Без таблиц в Supabase TypeScript-типы не верифицируемы, хуки не компилируются, компоненты не получат данных. База — фундамент.

**Полная инструкция по сессиям:** см. `docs/kb/claude_code_step_by_step_guide.md`

---

## Валидация

После каждой сессии:

```bash
npm run build        # TypeScript компиляция + Vite bundle
npm run smoke-check  # Smoke tests (main quality gate)
```

Если lint падает — продолжай с build и smoke-check (lint informational per AGENTS.md).
