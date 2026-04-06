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
