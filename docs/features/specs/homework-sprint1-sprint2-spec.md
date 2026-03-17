# Домашки — Sprint 1 & Sprint 2 Feature Spec

**Тип задачи:** Паттерн 3 — UX polish (Sprint 1) + Паттерн 2 — Рефакторинг flow (Sprint 2)
**Продукт:** Сократ
**Версия:** v0.1
**Дата:** 2026-03-17
**Статус:** Sprint 1 implemented (2026-03-17), Sprint 2 implemented (2026-03-17)
**Родительский документ:** `docs/features/specs/homework-ux-audit-and-improvements.md`

---

## Контекст

- **Сегмент:** репетиторы по физике ЕГЭ/ОГЭ, мини-группы и/или 10+ учеников
- **Wedge:** быстро собрать ДЗ и новую практику по теме урока за 5–10 минут
- **Bundle:** AI + база задач + сборка ДЗ + материалы
- **Правило:** AI = draft + action, не generic chat

---

# SPRINT 1 (неделя 1): P0 Quick Wins

## Задача 1. MathText в деталях ДЗ

### Problem

На странице `TutorHomeworkDetail.tsx` (строка 179) и `TutorHomeworkResults.tsx` (строки 227, 252) задачи отображаются plain text. Формулы `$$v = 72$$`, `$$t = 2{,}5$$` видны как сырой LaTeX. В то время как в guided chat для ученика (`GuidedChatMessage.tsx`) те же формулы рендерятся через KaTeX.

### Jobs alignment

| Job | Связь |
|-----|-------|
| A2 — верифицировать задачу | Репетитор не видит, как формула выглядит для ученика |
| D2 — проверить ход решения | AI feedback с формулами нечитаем |
| B5 — выдать ДЗ в понятном порядке | Визуальная целостность сломана |

**UX-принцип #16:** "Физика — не plain text. LaTeX-формулы обязательны."

### Scope: файлы

| Файл | Что меняется |
|------|-------------|
| `src/pages/tutor/TutorHomeworkDetail.tsx` | task_text, correct_answer — MathText |
| `src/pages/tutor/TutorHomeworkResults.tsx` | task_text в header, ai_feedback, student_text |

**Не трогать:** `src/components/ui/*`, high-risk files, `TutorHomeworkCreate.tsx`

### Реализация

#### 1.1 TutorHomeworkDetail.tsx

**Добавить import:**
```typescript
import { MathText } from '@/components/kb/ui/MathText';
```

**Строка 179 — task_text:**
```diff
- <p className="text-sm whitespace-pre-wrap break-words">{task.task_text}</p>
+ <MathText
+   text={task.task_text}
+   className="text-sm whitespace-pre-wrap break-words"
+ />
```

**Ответ (correct_answer) — в этом же блоке (строка ~183):**
Если correct_answer отображается inline — обернуть в `<MathText>`:
```diff
- Ответ: {task.correct_answer}
+ Ответ: <MathText text={task.correct_answer || ''} as="span" className="font-mono" />
```

**Секция Решение (answer в expanded section):**
Найти блок, где отображается `task.answer` или `task.correct_answer` в подробном виде. Обернуть в MathText.

#### 1.2 TutorHomeworkResults.tsx

**Добавить import:**
```typescript
import { MathText } from '@/components/kb/ui/MathText';
```

**Строка 227 — task header с обрезанным текстом:**
```diff
- <span className="text-sm font-medium">
-   Задача {item.task_order_num}: {item.task_text.length > 60 ? item.task_text.slice(0, 60) + '...' : item.task_text}
- </span>
+ <span className="text-sm font-medium flex items-baseline gap-1">
+   <span className="shrink-0">Задача {item.task_order_num}:</span>
+   <MathText
+     text={item.task_text.length > 80 ? item.task_text.slice(0, 80) + '…' : item.task_text}
+     as="span"
+     className="line-clamp-1"
+   />
+ </span>
```

**Строка 252 — AI feedback:**
```diff
- {item.ai_feedback}
+ <MathText text={item.ai_feedback} className="text-sm leading-relaxed" />
```

**Student text answer (если отображается):**
Найти блок с `item.student_text` — обернуть в MathText (ученик мог написать формулу).

### Acceptance criteria

- [ ] На странице детали ДЗ: `$$v = 72$$` рендерится как _v_ = 72 (KaTeX)
- [ ] На странице детали ДЗ: `$$t = 2{,}5$$` рендерится с запятой-десятичной
- [ ] На странице результатов: AI feedback с формулами рендерится корректно
- [ ] На странице результатов: заголовок задачи с формулой — line-clamp не ломается
- [ ] Текст без формул отображается нормально (no KaTeX overhead — fast path в MathText)
- [ ] Тест в Safari macOS + Chrome desktop

---

## Задача 2. Сортировка списка ДЗ

### Problem

Список ДЗ на `/tutor/homework` не имеет сортировки. При 20+ ДЗ нужно прокручивать весь список, чтобы найти нужное. Сортировка по дедлайну позволяет быстро увидеть срочные ДЗ.

### Jobs alignment

| Job | Связь |
|-----|-------|
| E4 — чувствовать системность | Сортировка = контроль над потоком ДЗ |
| B5 — выдать ДЗ в понятном порядке | Быстрый доступ к нужному ДЗ |

### Scope: файлы

| Файл | Что меняется |
|------|-------------|
| `src/pages/tutor/TutorHomework.tsx` | Добавить sort dropdown + client-side sort |

### Реализация

#### 2.1 Тип сортировки

```typescript
type HomeworkSortKey = 'created_desc' | 'deadline_asc';

const SORT_OPTIONS: { value: HomeworkSortKey; label: string }[] = [
  { value: 'created_desc', label: 'Новые первыми' },
  { value: 'deadline_asc', label: 'По дедлайну' },
];
```

**Два режима (не три):** по запросу пользователя, режим "по % выполнения" удалён из scope.

#### 2.2 Функция сортировки

```typescript
function sortAssignments(
  items: TutorHomeworkAssignmentListItem[],
  sortKey: HomeworkSortKey,
): TutorHomeworkAssignmentListItem[] {
  const sorted = [...items];
  switch (sortKey) {
    case 'created_desc':
      // По дате создания, новые первыми (default)
      sorted.sort((a, b) => {
        const da = a.created_at ? parseISO(a.created_at).getTime() : 0;
        const db = b.created_at ? parseISO(b.created_at).getTime() : 0;
        return db - da;
      });
      break;
    case 'deadline_asc':
      // По дедлайну, ближайшие первыми; без дедлайна — в конец
      sorted.sort((a, b) => {
        if (!a.deadline && !b.deadline) return 0;
        if (!a.deadline) return 1;  // без дедлайна — в конец
        if (!b.deadline) return -1;
        return parseISO(a.deadline).getTime() - parseISO(b.deadline).getTime();
      });
      break;
  }
  return sorted;
}
```

**Важно:** `parseISO` из `date-fns` — правило CLAUDE.md (Safari compatibility, не `new Date(string)`).

#### 2.3 UI: Sort dropdown

Разместить рядом с filter tabs, справа:

```tsx
// В TutorHomeworkContent:
const [sortKey, setSortKey] = useState<HomeworkSortKey>('created_desc');

const sortedAssignments = useMemo(
  () => sortAssignments(assignments, sortKey),
  [assignments, sortKey],
);

// UI — между filter tabs и grid
<div className="flex items-center justify-between gap-4">
  {/* Filter tabs (существующий код) */}
  <div className="flex gap-1 border-b">
    {FILTER_TABS.map(...)}
  </div>

  {/* Sort dropdown */}
  <select
    value={sortKey}
    onChange={(e) => setSortKey(e.target.value as HomeworkSortKey)}
    className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm"
  >
    {SORT_OPTIONS.map((opt) => (
      <option key={opt.value} value={opt.value}>{opt.label}</option>
    ))}
  </select>
</div>
```

**Примечание:** Используем `<select>` вместо shadcn `<Select>` — проще, не нужен portal, лучше на mobile. Если стиль не подходит — можно заменить на `<Select>` позже.

#### 2.4 Применить в grid

```diff
- {assignments.map((item) => (
+ {sortedAssignments.map((item) => (
    <AssignmentCard key={item.id} item={item} />
  ))}
```

### Acceptance criteria

- [ ] Default sort = "Новые первыми" (по created_at DESC)
- [ ] "По дедлайну" — ДЗ с ближайшим дедлайном первыми, без дедлайна — в конце
- [ ] При переключении фильтра (Все/Активные/Завершённые) сортировка сохраняется
- [ ] `parseISO` для дат (Safari-safe)
- [ ] Input font-size >= 16px (iOS auto-zoom prevention)

---

## Задача 3. Deadline urgency badges

### Problem

На карточке ДЗ в списке дедлайн показан как "21 мар" без индикации срочности. Репетитор не может бегло определить, какие ДЗ требуют внимания (просрочены или горят сегодня).

### Jobs alignment

| Job | Связь |
|-----|-------|
| E4 — системность | Визуальная приоритизация в потоке |
| E3 — не терять качество при 10+ | Attention management |

### Scope: файлы

| Файл | Что меняется |
|------|-------------|
| `src/pages/tutor/TutorHomework.tsx` | Компонент `AssignmentCard` — deadline display |

### Реализация

#### 3.1 Utility: определение urgency

```typescript
import { parseISO, isToday, isPast, isTomorrow, differenceInDays } from 'date-fns';

type DeadlineUrgency = 'overdue' | 'today' | 'soon' | 'normal' | 'none';

function getDeadlineUrgency(deadline: string | null): DeadlineUrgency {
  if (!deadline) return 'none';
  try {
    const d = parseISO(deadline);
    if (isNaN(d.getTime())) return 'none';
    if (isPast(d) && !isToday(d)) return 'overdue';
    if (isToday(d)) return 'today';
    if (isTomorrow(d) || differenceInDays(d, new Date()) <= 2) return 'soon';
    return 'normal';
  } catch {
    return 'none';
  }
}

const URGENCY_CONFIG: Record<DeadlineUrgency, { label?: string; className: string; iconClassName: string }> = {
  overdue: {
    label: 'Просрочено',
    className: 'text-red-600 font-medium',
    iconClassName: 'text-red-500',
  },
  today: {
    label: 'Сегодня',
    className: 'text-amber-600 font-medium',
    iconClassName: 'text-amber-500',
  },
  soon: {
    className: 'text-amber-500',
    iconClassName: 'text-amber-400',
  },
  normal: {
    className: '',
    iconClassName: '',
  },
  none: {
    className: '',
    iconClassName: '',
  },
};
```

#### 3.2 Изменение в AssignmentCard

Заменить секцию deadline (строки 204–209):

```diff
  {/* Deadline */}
- {deadlineStr && (
-   <span className="flex items-center gap-1 ml-auto" title="Дедлайн">
-     <Clock className="h-3.5 w-3.5" />
-     {deadlineStr}
-   </span>
- )}
+ {deadlineStr && (() => {
+   const urgency = getDeadlineUrgency(item.deadline);
+   const cfg = URGENCY_CONFIG[urgency];
+   return (
+     <span className={cn('flex items-center gap-1 ml-auto', cfg.className)} title="Дедлайн">
+       <Clock className={cn('h-3.5 w-3.5', cfg.iconClassName)} />
+       {cfg.label ? `${cfg.label} · ${deadlineStr}` : deadlineStr}
+     </span>
+   );
+ })()}
```

**Добавить import:**
```typescript
import { parseISO, isToday, isPast, isTomorrow, differenceInDays } from 'date-fns';
import { cn } from '@/lib/utils';
```

**Примечание:** `cn` может уже быть импортирован, проверить.

#### 3.3 Визуальный результат

| Состояние | Отображение |
|-----------|------------|
| Просрочено | 🔴 **Просрочено · 15 мар** (красный текст) |
| Сегодня | 🟡 **Сегодня · 17 мар** (amber текст) |
| Через 1–2 дня | 🟠 18 мар (amber иконка) |
| Нормальный | ⚪ 25 мар (обычный) |
| Без дедлайна | _(ничего не показывать)_ |

### Acceptance criteria

- [ ] ДЗ с просроченным дедлайном: красный текст "Просрочено · дата"
- [ ] ДЗ с дедлайном сегодня: amber текст "Сегодня · дата"
- [ ] ДЗ с дедлайном через 1–2 дня: amber иконка часов
- [ ] ДЗ без дедлайна: ничего не показывать (как сейчас)
- [ ] `parseISO` для дат (Safari-safe)
- [ ] Не зависит от filter/sort — работает при любой комбинации

---

## Sprint 1: Validation checklist

```bash
npm run lint
npm run build
npm run test
npm run smoke-check
```

### UX review (из doc 19):
1. **Job** → A2, D2, E3, E4
2. **Wedge** → быстрее находить и управлять ДЗ
3. **Generic chat** → Нет, это library/management UX
4. **Primary CTA** → "Создать ДЗ" остаётся primary
5. **Action layer** → Сортировка + urgency = attention management
6. **Scope creep** → Нет search, нет группировки, нет edit — всё в Sprint 2+

### Cross-browser:
- [ ] `parseISO` вместо `new Date(string)` (Safari)
- [ ] Нет RegExp lookbehind
- [ ] font-size >= 16px на `<select>` (iOS auto-zoom)

---

# SPRINT 2 (неделя 2–3): P0 Full Edit

## Problem

При нажатии "Редактировать" на детали ДЗ открывается модалка с 4 полями: Название, Предмет, Тема, Дедлайн. Нельзя менять задачи, учеников, материалы. Это критически ограничивает Job B2 (собрать релевантное ДЗ) — если репетитор допустил ошибку или хочет обновить ДЗ после урока, ему нужно создавать новое.

**Best practice (Google Classroom, Canvas, DIDAK):** форма редактирования = форма создания с pre-filled данными.

## Jobs alignment

| Job | Связь |
|-----|-------|
| B2 — собрать релевантное ДЗ | Нельзя поправить ДЗ после создания |
| B4 — не повторять задачи | Нельзя заменить задачу |
| B5 — выдать в понятном порядке | Нельзя переупорядочить задачи |
| E2 — переиспользовать | Нельзя добавить ученика к существующему ДЗ |

## Goals

- Полная форма редактирования ДЗ — все поля, как при создании
- Модалка Quick Edit — остаётся для быстрых правок (title, deadline)
- Warnings при редактировании active ДЗ

## Non-goals

- Inline editing задач на детали ДЗ (Sprint 3+)
- Version history
- Concurrent edit detection
- Создание нового API endpoint (используем существующий PUT)

## Scope: файлы

### Изменяемые файлы

| Файл | Что меняется |
|------|-------------|
| `src/pages/tutor/TutorHomeworkCreate.tsx` | Добавить `editMode` prop, pre-fill из API |
| `src/pages/tutor/TutorHomeworkDetail.tsx` | Кнопка "Редактировать" → навигация к edit page |
| `src/lib/tutorHomeworkApi.ts` | Расширить `updateTutorHomeworkAssignment` patch-type (задачи, ученики) |
| `src/App.tsx` (или router) | Добавить route `/tutor/homework/:id/edit` |

### Файлы НЕ трогать

- `src/components/ui/*`
- High-risk files
- Edge functions (если PUT endpoint уже поддерживает нужные поля)

---

## Фаза 1. Audit существующего API

### Шаг 1 — определить API capabilities

Перед реализацией Claude Code должен:

1. **Прочитать edge function** `supabase/functions/homework-api/index.ts` — маршрут PUT `/assignments/:id`
2. Определить, какие поля поддерживает PUT:
   - `title`, `subject`, `topic`, `deadline`, `status` — уже поддерживаются (видно из `tutorHomeworkApi.ts`)
   - `tasks` (добавление/удаление/изменение) — проверить
   - `assigned_students` (добавление/удаление) — проверить
   - `materials` — проверить
3. Если PUT не поддерживает задачи/учеников — нужно расширить endpoint

### Шаг 2 — определить edge cases

**Critical:** Следующие сценарии требуют специальной обработки:

| Сценарий | Поведение |
|----------|-----------|
| Edit draft ДЗ | Полная свобода — все поля редактируемы |
| Edit active ДЗ | Warning: "ДЗ уже отправлено. Изменения увидят все ученики." |
| Edit active ДЗ — удаление задачи | Warning: "Ученики, уже начавшие решение, могут потерять прогресс." |
| Edit active guided_chat ДЗ — задача "в процессе" | Disable editing для задач, по которым есть thread messages |
| Добавление нового ученика к active ДЗ | Опция: "Уведомить новых учеников в Telegram?" |
| Удаление ученика из active ДЗ | Warning: "Ученик больше не увидит это ДЗ." |

---

## Фаза 2. Архитектура edit mode

### 2.1 Route

```typescript
// В router (App.tsx или аналог):
{ path: '/tutor/homework/:id/edit', element: <TutorHomeworkCreate /> }
```

### 2.2 Props и state в TutorHomeworkCreate

```typescript
// TutorHomeworkCreate получает ID из URL:
function TutorHomeworkCreateContent() {
  const { id: editId } = useParams<{ id?: string }>();
  const isEditMode = !!editId;

  // Если editMode — загрузить данные из API
  const { data: existingAssignment, isLoading: editLoading } = useQuery({
    queryKey: ['tutor', 'homework', 'assignment', editId],
    queryFn: () => getTutorHomeworkAssignment(editId!),
    enabled: isEditMode,
  });

  // Pre-fill state при mount (один раз, когда данные загружены)
  useEffect(() => {
    if (existingAssignment && isEditMode) {
      prefillFromAssignment(existingAssignment);
    }
  }, [existingAssignment, isEditMode]);

  // ...
}
```

### 2.3 Pre-fill logic

```typescript
function prefillFromAssignment(details: TutorHomeworkAssignmentDetails) {
  // Step 1 (Meta):
  setTitle(details.assignment.title);
  setSubject(details.assignment.subject);
  setTopic(details.assignment.topic || '');
  setDeadline(details.assignment.deadline || '');
  setWorkflowMode(details.assignment.workflow_mode || 'guided_chat');

  // Step 2 (Tasks):
  setTasks(details.tasks.map(t => ({
    id: t.id,           // Существующий ID задачи
    text: t.task_text,
    imageUrl: t.task_image_url,
    correctAnswer: t.correct_answer || '',
    maxScore: t.max_score || 1,
    rubricText: t.rubric_text || '',
    isExisting: true,   // Флаг: задача уже в БД
  })));

  // Step 2 (Materials):
  setMaterials(details.materials.map(m => ({
    id: m.id,
    type: m.type,
    title: m.title,
    url: m.url,
    storageRef: m.storage_ref,
    isExisting: true,
  })));

  // Step 3 (Assign):
  setSelectedStudentIds(new Set(details.assigned_students.map(s => s.tutor_student_id)));
}
```

### 2.4 Submit в edit mode

```typescript
async function handleSubmitEdit() {
  // 1. Update assignment metadata (PUT /assignments/:id)
  await updateTutorHomeworkAssignment(editId, {
    title, subject, topic, deadline, status,
  });

  // 2. Handle tasks diff:
  //    - Новые задачи (без id) → POST /assignments/:id/tasks
  //    - Изменённые задачи → PUT /assignments/:id/tasks/:taskId
  //    - Удалённые задачи → DELETE /assignments/:id/tasks/:taskId
  for (const task of tasks) {
    if (task.isNew) {
      await createTask(editId, task);
    } else if (task.isChanged) {
      await updateTask(editId, task.id, task);
    }
  }
  for (const deletedTaskId of deletedTaskIds) {
    await deleteTask(editId, deletedTaskId);
  }

  // 3. Handle students diff:
  //    - Новые ученики → POST /assignments/:id/assign
  //    - Удалённые ученики → DELETE /assignments/:id/students/:studentId
  const newStudentIds = [...selectedStudentIds].filter(id => !existingStudentIds.has(id));
  const removedStudentIds = [...existingStudentIds].filter(id => !selectedStudentIds.has(id));

  if (newStudentIds.length > 0) {
    await assignTutorHomeworkStudents(editId, newStudentIds);
    if (shouldNotifyNew) {
      await notifyTutorHomeworkStudents(editId, { studentIds: newStudentIds });
    }
  }
  // Удаление учеников — если API поддерживает

  // 4. Handle materials diff (аналогично)

  // 5. Invalidate cache и navigate back
  queryClient.invalidateQueries({ queryKey: ['tutor', 'homework'] });
  navigate(`/tutor/homework/${editId}`);
  toast.success('ДЗ обновлено');
}
```

### 2.5 UI изменения в TutorHomeworkCreate

| Элемент | Create mode | Edit mode |
|---------|-------------|-----------|
| Page title | "Создание ДЗ" | "Редактирование ДЗ" |
| Back button | → `/tutor/homework` | → `/tutor/homework/:id` |
| Submit button | "Создать ДЗ" / "Создать и уведомить" | "Сохранить изменения" |
| Template picker | Видим | Скрыт |
| Loading state | Нет | Skeleton пока загружаются данные |
| Warning banner | Нет | "ДЗ уже отправлено" (если status = active) |

---

## Фаза 3. Quick Edit → dropdown menu

### Изменение в TutorHomeworkDetail.tsx

**Текущее:** Кнопка "Редактировать" → открывает модалку.

**Целевое:** Кнопка "Редактировать" → навигация к `/tutor/homework/:id/edit`.
**Dropdown menu** (через ContextMenu или DropdownMenu) с опциями:
- "Редактировать" → `/tutor/homework/:id/edit`
- "Быстрая правка" → открывает существующую модалку (title, deadline)
- "Удалить ДЗ" → confirmation dialog (уже есть)

```tsx
// Заменить текущие кнопки Edit + Delete:
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="outline" size="sm">
      <Edit className="h-4 w-4 mr-2" />
      Действия
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuItem onClick={() => navigate(`/tutor/homework/${id}/edit`)}>
      <Edit className="h-4 w-4 mr-2" />
      Редактировать
    </DropdownMenuItem>
    <DropdownMenuItem onClick={() => setEditDialogOpen(true)}>
      <Clock className="h-4 w-4 mr-2" />
      Быстрая правка
    </DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem
      className="text-destructive"
      onClick={() => setDeleteDialogOpen(true)}
    >
      <Trash2 className="h-4 w-4 mr-2" />
      Удалить ДЗ
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

---

## Фаза 4. Warning banners для active ДЗ

В edit mode, если `status === 'active'`:

```tsx
{isEditMode && existingAssignment?.assignment.status === 'active' && (
  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
    <div className="flex items-start gap-3">
      <AlertCircle className="h-5 w-5 shrink-0 text-amber-500 mt-0.5" />
      <div>
        <p className="font-medium">ДЗ уже отправлено ученикам</p>
        <p className="mt-1 text-amber-700">
          Изменения будут видны всем назначенным ученикам.
          Будьте осторожны с удалением задач — ученики могут потерять прогресс.
        </p>
      </div>
    </div>
  </div>
)}
```

---

## Sprint 2: API requirements check

Перед реализацией Phase 2 Claude Code **обязан** проверить edge function `supabase/functions/homework-api/index.ts`:

```text
Checklist (для Claude Code audit):

□ PUT /assignments/:id — какие поля принимает?
□ Есть ли endpoint для обновления отдельной задачи (PUT /assignments/:id/tasks/:taskId)?
□ Есть ли endpoint для удаления задачи (DELETE /assignments/:id/tasks/:taskId)?
□ Есть ли endpoint для добавления задачи к существующему ДЗ (POST /assignments/:id/tasks)?
□ Есть ли endpoint для удаления ученика из ДЗ?
□ Как обрабатываются materials (add/remove)?

Если endpoint-ов не хватает — создать НОВЫЙ feature spec для backend changes.
Не расширять scope этого документа на edge function changes.
```

---

## Sprint 2: Validation checklist

```bash
npm run lint
npm run build
npm run test
npm run smoke-check
```

### UX review:
1. **Job** → B2, B4, B5, E2
2. **Wedge** → исправление ошибок и обновление ДЗ без пересоздания
3. **Progressive disclosure** → Quick Edit (L0) + Full Edit (L1)
4. **Destructive actions** → warnings при edit active ДЗ
5. **Scope creep** → нет inline editing, нет version history, нет concurrent detection

### Cross-browser:
- [ ] `parseISO` для дат
- [ ] `datetime-local` input — Safari поддерживает 14.1+, ОК
- [ ] font-size >= 16px на inputs (iOS)

---

## Docs-to-update после реализации

| Документ | Что обновить |
|----------|-------------|
| `CLAUDE.md` → секция "Система домашних заданий" | Добавить описание edit mode |
| `docs/features/specs/homework-ux-audit-and-improvements.md` | Отметить A1–A4 completed |
| `docs/features/specs/homework-sprint1-sprint2-spec.md` | Статус → implemented |

---

## Промпт для Claude Code: Sprint 1

```text
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Нужно реализовать UX polish для Домашек (Sprint 1, 3 задачи).

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ
- wedge: быстро собрать ДЗ и новую практику по теме урока
- продукт = workspace / bundle: AI + база + домашки + материалы
- AI = draft + action, а не generic chat

Сначала обязательно прочитай документы:
1. docs/product/specs/tutor_ai_agents/16-ux-principles-for-tutor-product-sokrat.md
2. docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules-sokrat.md
3. docs/features/specs/homework-sprint1-sprint2-spec.md (← этот feature spec)
4. CLAUDE.md

Реализуй Sprint 1 (3 задачи):

1. MathText в TutorHomeworkDetail.tsx:
   - task.task_text → <MathText text={task.task_text} />
   - task.correct_answer → <MathText as="span" />
   Также в TutorHomeworkResults.tsx:
   - task_text в заголовке задачи
   - item.ai_feedback → <MathText />
   MathText уже существует: src/components/kb/ui/MathText.tsx

2. Сортировка списка ДЗ в TutorHomework.tsx:
   - State: sortKey ('created_desc' | 'deadline_asc')
   - useMemo sortedAssignments
   - <select> рядом с filter tabs
   - parseISO из date-fns

3. Deadline urgency badges в TutorHomework.tsx:
   - getDeadlineUrgency() → 'overdue' | 'today' | 'soon' | 'normal' | 'none'
   - Красный "Просрочено" / amber "Сегодня" на карточках
   - parseISO, isToday, isPast, isTomorrow, differenceInDays из date-fns

Важно:
- НЕ трогать src/components/ui/* (performance.md)
- НЕ трогать high-risk files
- md: для structural breakpoints, НЕ sm:
- parseISO для всех дат (Safari compatibility)
- cn() для conditional classes

В конце обязательно:
1. перечисли changed files
2. дай краткий summary реализации
3. покажи validation results (npm run lint && npm run build && npm run smoke-check)
4. напиши, какие документы нужно обновить после реализации
5. self-check against docs 16, 17
```

## Промпт для Claude Code: Sprint 2, Шаг 1 (audit + plan)

```text
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Мне нужно добавить Full Edit mode для Домашек.

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ
- wedge: быстро собрать ДЗ и новую практику по теме урока
- продукт = workspace / bundle: AI + база + домашки + материалы

Прочитай документы:
1. docs/product/specs/tutor_ai_agents/16-ux-principles-for-tutor-product-sokrat.md
2. docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules-sokrat.md
3. docs/features/specs/homework-sprint1-sprint2-spec.md (← feature spec, секция Sprint 2)
4. CLAUDE.md
5. supabase/functions/homework-api/index.ts (← edge function, определить API capabilities)

Сейчас ничего не кодируй.

Нужно:
1. Audit edge function PUT /assignments/:id — какие поля поддерживает
2. Проверить, есть ли endpoints для: update task, delete task, add task, remove student
3. Audit TutorHomeworkCreate.tsx — как адаптировать для edit mode
4. Определить, нужны ли новые API endpoints
5. Предложить migration plan по фазам (не более 3 фаз)

Важно:
- не расширяй scope beyond Full Edit
- не меняй edge functions без плана
- не делай generic chat UX
- каждая рекомендация усиливает Job B2 (собрать ДЗ)

Формат ответа:
1. Executive summary
2. API audit results
3. Proposed plan (2–3 фазы)
4. Files likely to change
5. Risks
6. Recommendation: с чего начать
```

## Промпт для Codex review: Sprint 1 + Sprint 2

```text
Сделай code review реализованных Homework UX improvements (Sprint 1 + Sprint 2).

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ
- wedge: быстро собрать ДЗ и новую практику по теме урока
- нельзя скатываться в generic chat UX

Прочитай:
1. docs/product/specs/tutor_ai_agents/16-ux-principles-for-tutor-product-sokrat.md
2. docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules-sokrat.md
3. docs/features/specs/homework-sprint1-sprint2-spec.md

Проверь Sprint 1:
1. MathText в TutorHomeworkDetail: lazy loading, no KaTeX in ui/*
2. Sort: parseISO (Safari-safe), useMemo correctness
3. Deadline badges: date-fns functions, edge cases (null deadline, invalid date)

Проверь Sprint 2:
1. Edit mode: pre-fill correctness, state reset on navigate
2. Task diff logic: add/update/delete без потери данных
3. Active ДЗ warnings: все edge cases из spec
4. Student assign diff: new/removed students handling
5. Regression: create mode не сломан

Формат:
- Must fix
- Should fix
- Nice to have
- Product drift risks
- Architecture risks
```
