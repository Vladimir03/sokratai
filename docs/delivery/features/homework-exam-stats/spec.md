# Feature Spec: Экзаменная статистика ДЗ для репетитора

**Версия:** v0.1
**Дата:** 2026-04-05
**Автор:** Codex
**Статус:** draft
**Источник сигнала:** `docs/discovery/tickets/2026-04-01-zhenya-batch.md` → `#2: Статистика по ДЗ в формате ЕГЭ`

---

## 0. Job Context (обязательная секция)

### Какую работу закрывает эта фича?

| Участник | Core Job | Sub-job | Ссылка на Граф |
|---|---|---|---|
| Репетитор (B2B) | R1 — Автоматическая проверка ДЗ | R1-3 — Классифицировать ошибки; R1-4 — Сформировать черновик персональной обратной связи | `docs/discovery/research/SokratAI_AJTBD_job-graphs/SokratAI_AJTBD_elite-physics-finish-sprint-job-graph.md` |

> Текущая фаза закрывает только B2B-работу репетитора. Потенциальная связь с родителем (`P1-2: понять, какие темы у ребёнка проваливаются`) остаётся вне scope v1.

### Wedge-связка

- **B2B-сегмент:** B2B-1 — репетиторы физики ЕГЭ/ОГЭ с мини-группами и/или 10+ учениками
- **B2C-сегмент:** B2C-1 / B2C-4 — финишная прямая перед экзаменом / premium-тревога за результат
- **Score матрицы:** 125

### Pilot impact

Фича не меняет core wedge, но усиливает retention и perceived value пилота: после сдачи ДЗ репетитор быстрее понимает, по каким номерам экзамена ученик проседает, и может точнее скорректировать следующее ДЗ или урок. Это сокращает ручной review и делает Сократ ближе к workflow neofamily/РЕШУ ЕГЭ, не выводя пользователя в отдельный аналитический модуль.

---

## 1. Summary

Нужно перевести статистику ДЗ для репетитора из общего режима «средний процент + ошибки + задачи по порядку» в экзаменный режим: по номерам КИМ, по каждому ученику, с видимой динамикой ученика относительно самого себя. Главный экран реализации — существующий `TutorHomeworkResults`, без новой top-level навигации и без отдельного модуля аналитики.

Для этого система должна перестать терять экзаменную metadata задачи при переносе из KB в ДЗ, научиться хранить её на уровне `homework_tutor_tasks`, агрегировать результаты guided chat и отдавать на фронт exam-oriented response: `№ задания → балл → статус → изменение vs предыдущий результат этого же ученика`.

---

## 2. Problem

### Текущее поведение

- `TutorHomeworkResults` показывает общие метрики по ДЗ: сколько сдали, средний процент, top error, bar chart по `order_num`.
- Репетитор не видит привычную экзаменную рамку: `№1`, `№7`, `№21`, `№26`, первичные баллы по каждому номеру и прогресс ученика по этим номерам.
- Если задача пришла из KB, `kim_number` живёт в `kb_tasks`, но не сохраняется в `homework_tutor_tasks`. На экране результатов эта связь уже потеряна.
- Итоговая аналитика guided chat остаётся общей и «внутренней», а не экзаменно-ориентированной.

### Боль

Репетитор экзаменного сегмента оценивает качество подготовки не по абстрактному проценту, а по номерам экзамена и первичным баллам. Ему нужно быстро ответить на вопросы:

- по каким номерам ученик стабильно теряет баллы;
- что изменилось относительно прошлого похожего ДЗ;
- где просадка концептуальная, а где это разовая неудача.

Без этого Сократ даёт полезные данные, но не в той рамке, в которой репетитор реально принимает решение о следующем уроке, повторении темы и составлении нового ДЗ.

### Текущие «нанятые» решения

- neofamily.ru как референс exam-oriented статистики;
- РЕШУ ЕГЭ / ОГЭ как база задач и привычная нумерация;
- ручные заметки, таблицы, память репетитора, сравнение нескольких ДЗ вручную.

---

## 3. Solution

### Описание

Внутри текущего homework workflow добавить exam-oriented слой статистики:

1. Каждая задача ДЗ может хранить `exam_kind` и `kim_number`.
2. При создании ДЗ из KB metadata переносится автоматически; для ручных задач её можно указать вручную.
3. `GET /assignments/:id/results` начинает возвращать exam-specific summary и per-student breakdown по номерам.
4. На `TutorHomeworkResults` экзаменно-размеченные ДЗ отображаются в формате `№ задания → балл / макс. балл`, а не только в формате общего процента.
5. При раскрытии ученика репетитор видит простую динамику этого же ученика по тем же номерам относительно предыдущих попыток/ДЗ.

### Ключевые решения

1. **Не делаем отдельный раздел “Аналитика”**. Фича живёт внутри существующего `TutorHomeworkResults`, чтобы не разрывать post-homework workflow и не нарушать jobs-first логику.
2. **Источник истины для экзаменной metadata — `homework_tutor_tasks`**, а не `kb_tasks`. Это позволяет поддержать и KB-задачи, и ручные задачи, и не ломаться, если исходная KB-задача потом изменится.
3. **Считаем в первичных баллах, не в 100-балльной шкале ЕГЭ**. Для v1 нужен рабочий tutor-инструмент, а не официальный калькулятор перевода.
4. **Сравниваем ученика только с самим собой**, а не строим рейтинги учеников. Это соответствует discovery-сигналу Жени и не толкает продукт в CRM/BI-зону.
5. **V1 = простая история, не BI-дашборд**. Вместо сложных графиков и отдельной аналитики — компактные карточки/строки по номерам и delta vs предыдущий результат.
6. **Fallback обязателен**: если у ДЗ нет размеченных экзаменных задач, экран остаётся в текущем generic-режиме.

### Scope

**In scope (P0 — Must-Have):**
- Добавить в `homework_tutor_tasks` поля `exam_kind`, `kim_number` и `kb_task_id`.
- Прокидывать `exam_kind` и `kim_number` из `kb_tasks` в draft-задачу и далее в create/update homework flow.
- Дать репетитору возможность указать/исправить exam metadata на карточке задачи в конструкторе ДЗ.
- Расширить `GET /assignments/:id` и `GET /assignments/:id/results`, чтобы фронт видел exam metadata и exam-oriented aggregation.
- На `TutorHomeworkResults` для exam-tagged ДЗ показать:
  - summary по номерам;
  - по каждому ученику — баллы по номерам;
  - delta vs предыдущий результат этого же ученика по тому же номеру.
- Считать результаты из `task_states` / thread messages guided chat.
- Если exam metadata отсутствует, сохранить текущее generic UI/results API поведение.

**In scope (P1 — Nice-to-Have / fast follow-up):**
- Отдельный contextual endpoint с полной историей по ученику для раскрытого блока: последние 5 exam-tagged результатов по каждому номеру.
- Best-effort backfill exam metadata для уже созданных ДЗ, связанных с KB через `homework_kb_tasks`.
- Desktop-only secondary chart по номерам КИМ, если карточек окажется недостаточно по pilot feedback.

**Out of scope:**
- Новый top-level раздел аналитики, отчётов или CRM.
- Сравнение учеников между собой, рейтинги, leaderboards.
- Перевод первичных баллов в тестовые баллы ЕГЭ / официальный прогноз по 100-балльной шкале.
- Отдельные parent/student экраны прогресса.
- Экспорт PDF-отчёта по прогрессу.
- Автоматическое распознавание exam metadata из текста ручной задачи без явного выбора репетитора.

### Phase Split

**Phase 1: Exam view внутри Homework Results**
- Полностью специфицируется в этом документе.
- Цель: репетитор открывает результаты ДЗ и сразу видит номера КИМ, баллы по ним и self-trend ученика.

**Phase 2: Rich history / progress detail**
- Стартует только если после pilot feedback окажется, что delta vs previous результата недостаточно.
- Scope: richer history, optional chart, возможно richer filters по периоду.

---

## Acceptance Criteria (testable)

- **AC-1:** Если задача ДЗ сохранена с `exam_kind='ege'`, `kim_number=21`, `max_score=3`, а ученик получил `earned_score=2`, то `GET /assignments/:id/results` возвращает для этого ученика exam-item `№21` со значением `2/3`, и `TutorHomeworkResults` показывает этот номер в карточке ученика.
- **AC-2:** Если у того же ученика есть предыдущий завершённый результат по `kim_number=21`, то раскрытие ученика на `TutorHomeworkResults` показывает delta vs previous (`+`, `-` или `0`) без сравнения с другими учениками.
- **AC-3:** Если ДЗ не содержит ни одной задачи с `exam_kind` + `kim_number`, экран `TutorHomeworkResults` остаётся в текущем generic-режиме и не ломает existing summary/per-task blocks.
- **AC-4:** Если задача добавлена из KB с `exam='oge'` и `kim_number=5`, то после `POST /assignments` metadata сохраняется в `homework_tutor_tasks`, а повторный `GET /assignments/:id` возвращает её в `tasks[]`.
- **AC-5:** Exam summary строится из `task_states` guided chat и отдаётся фронту в едином exam-oriented response shape.

---

## 4. User Stories

### Репетитор
> Когда я открываю результаты домашки в экзаменном формате, я хочу сразу видеть баллы ученика по номерам КИМ, чтобы быстро понять, какие номера проседают и что дать в следующее ДЗ.

> Когда я раскрываю конкретного ученика, я хочу видеть его прогресс относительно прошлого похожего результата, чтобы оценивать динамику ученика vs самого себя, а не сравнивать его с другими.

> Когда я добавляю задачу из базы или создаю ручную экзаменную задачу, я хочу сохранить номер КИМ прямо в ДЗ, чтобы потом статистика не теряла экзаменный контекст.

---

## 5. Technical Design

### Затрагиваемые файлы

**Frontend (Tutor):**
- `src/components/tutor/homework-create/types.ts` — добавить exam metadata в `DraftTask`
- `src/components/tutor/homework-create/HWTasksSection.tsx` — прокинуть `exam_kind` / `kim_number` из KB в draft-task
- `src/components/tutor/homework-create/HWTaskCard.tsx` — UI для ручного ввода/правки exam metadata
- `src/pages/tutor/TutorHomeworkCreate.tsx` — сохранить/загрузить exam metadata, включить её в dirty-check и edit flow
- `src/lib/tutorHomeworkApi.ts` — типы payload/response для task exam metadata и student exam progress
- `src/pages/tutor/TutorHomeworkResults.tsx` — новый exam-oriented режим UI с fallback на existing generic layout
- `src/hooks/useTutorHomework.ts` — optional hook для contextual student exam progress endpoint (P1)

**Backend / Edge Functions:**
- `supabase/functions/homework-api/index.ts` — расширить create/update/get details/get results; добавить helper нормализации guided task results; optional endpoint student history (P1)
- `supabase/functions/homework-api/README.md` — обновить публичный контракт homework-api

**Database:**
- новая миграция `homework_tutor_tasks`: `kb_task_id`, `exam_kind`, `kim_number`
- optional P1 migration/backfill для existing KB-linked homework tasks

### Data Model

#### `homework_tutor_tasks` — новые поля

```sql
kb_task_id UUID NULL REFERENCES public.kb_tasks(id) ON DELETE SET NULL,
exam_kind exam_type NULL,
kim_number INTEGER NULL
```

Правила:

- `max_score` остаётся текущим источником первичного балла.
- `exam_kind` + `kim_number` nullable: задача может остаться обычной, не экзаменной.
- Если заполнен `kim_number`, должен быть заполнен и `exam_kind`.
- В одном assignment все **не-NULL** значения `exam_kind` должны совпадать. Untagged задачи (`NULL`) допустимы, но в exam aggregation не участвуют. Смешение `ege` и `oge` в одном ДЗ блокируется на frontend/backend validation.

#### Нормализованная внутренняя модель результата

В `homework-api/index.ts` ввести внутренний helper-тип:

```ts
type TaskResultFact = {
  assignment_id: string;
  student_id: string;
  task_id: string;
  exam_kind: 'ege' | 'oge' | null;
  kim_number: number | null;
  earned_score: number | null;
  max_score: number;
  status: 'in_progress' | 'submitted' | 'ai_checked' | 'tutor_reviewed' | 'completed';
  completed_at: string | null;
};
```

`TaskResultFact` не хранится в БД как отдельная таблица в Phase 1. Это внутренняя нормализующая модель внутри edge function для единообразной агрегации.

### API

#### `POST /assignments`

Расширить task payload:

```json
{
  "tasks": [
    {
      "task_text": "...",
      "max_score": 3,
      "kb_task_id": "uuid-or-null",
      "exam_kind": "ege",
      "kim_number": 21
    }
  ]
}
```

Изменения:
- принимать `kb_task_id`, `exam_kind`, `kim_number`;
- валидировать, что `kim_number` не приходит без `exam_kind`;
- валидировать, что внутри одного assignment нет смешения `ege`/`oge`;
- сохранять metadata прямо в `homework_tutor_tasks`.

#### `PUT /assignments/:id`

Аналогично `POST /assignments`, но для update flow:
- отдавать metadata в edit form;
- разрешать править `exam_kind` / `kim_number`, пока это не ломает правило одного exam_kind на assignment.

#### `GET /assignments/:id`

Расширить `tasks[]`:

```json
{
  "tasks": [
    {
      "id": "uuid",
      "order_num": 3,
      "max_score": 3,
      "kb_task_id": "uuid-or-null",
      "exam_kind": "ege",
      "kim_number": 21
    }
  ]
}
```

Это нужно для edit flow и для явного отображения exam metadata на detail/results UI.

#### `GET /assignments/:id/results`

Существующий endpoint расширяется, а не заменяется.

Новый блок:

```json
{
  "exam_view": {
    "mode": "exam",
    "exam_kind": "ege",
    "by_number": [
      {
        "task_id": "uuid",
        "kim_number": 21,
        "max_score": 3,
        "avg_score": 1.8,
        "avg_percent": 60.0,
        "completed_students": 5
      }
    ]
  }
}
```

И дополнение к `per_student[].submission_items[]`:

```json
{
  "task_id": "uuid",
  "task_order_num": 3,
  "exam_kind": "ege",
  "kim_number": 21,
  "max_score": 3,
  "ai_score": 2
}
```

Правила:
- если tagged exam tasks нет, `exam_view = null`;
- existing `summary`, `per_student`, `per_task` остаются для backward compatibility;
- frontend exam-mode опирается на `exam_view` + `submission_items[].kim_number`.

#### `GET /assignments/:id/students/:studentId/exam-progress` (P1)

Contextual endpoint для раскрытого блока конкретного ученика.

Пример response:

```json
{
  "exam_kind": "ege",
  "numbers": [
    {
      "kim_number": 21,
      "current": { "earned_score": 2, "max_score": 3, "percent": 66.67, "completed_at": "..." },
      "previous": { "earned_score": 1, "max_score": 3, "percent": 33.33, "completed_at": "..." },
      "delta_score": 1,
      "history": [
        { "assignment_id": "a1", "assignment_title": "Оптика 1", "earned_score": 1, "max_score": 3, "completed_at": "..." },
        { "assignment_id": "a2", "assignment_title": "Оптика 2", "earned_score": 2, "max_score": 3, "completed_at": "..." }
      ]
    }
  ]
}
```

Phase 1 UI может ограничиться `current + previous + delta`. `history[]` нужен для P1 richer detail.

### Aggregation Logic

#### Guided chat mode

Источник:
- `homework_tutor_threads`
- `homework_tutor_task_states`
- `homework_tutor_tasks`

Правило:
- использовать `task_states.earned_score`;
- completed_at = `thread.updated_at` или более точный timestamp completion, если он появится позже;
- task_state без `exam_kind` / `kim_number` участвует только в generic results, не в exam aggregation.

### Миграции

**Migration 1 (P0): add exam metadata to homework tasks**

```sql
ALTER TABLE public.homework_tutor_tasks
  ADD COLUMN kb_task_id UUID NULL REFERENCES public.kb_tasks(id) ON DELETE SET NULL,
  ADD COLUMN exam_kind exam_type NULL,
  ADD COLUMN kim_number INTEGER NULL;

ALTER TABLE public.homework_tutor_tasks
  ADD CONSTRAINT homework_tutor_tasks_kim_positive_check
  CHECK (kim_number IS NULL OR kim_number > 0);

CREATE INDEX IF NOT EXISTS idx_homework_tutor_tasks_assignment_exam
  ON public.homework_tutor_tasks (assignment_id, exam_kind, kim_number);
```

**Migration 2 (P1): best-effort backfill from KB links**

Backfill только для homework, где есть связка в `homework_kb_tasks`.

Подход:
- матчить `homework_tutor_tasks.assignment_id = homework_kb_tasks.homework_id`;
- использовать `homework_tutor_tasks.order_num = homework_kb_tasks.sort_order + 1` как best-effort mapping;
- переносить `kb_task_id`, `exam_kind = kb_tasks.exam`, `kim_number = kb_tasks.kim_number`;
- логически считать backfill non-blocking: если mapping неочевиден, задача остаётся untagged.

Причина: `homework_kb_tasks` сейчас не содержит прямой ссылки на `homework_tutor_tasks.id`, поэтому для истории нужен мягкий backfill, а не жёсткая миграция с риском испортить данные.

---

## 6. UX / UI

### Wireframe / Mockup

Экран остаётся тем же route: `TutorHomeworkResults`.

**Exam mode layout:**

1. Header ДЗ без изменений.
2. Summary block `Результаты по номерам`.
3. Список учеников.
4. У каждого ученика:
   - имя, статус, общий exam score;
   - строка/сетка chips: `№1 1/1`, `№7 0/1`, `№21 2/3`;
   - краткий trend label: `vs прошлый раз: +1 балл по №21`;
   - раскрытие с richer detail по номерам и существующим review/thread block.

**Fallback mode:**

- если exam metadata нет, текущий generic layout (`Сдали`, `Средний балл`, `Без ошибок`, `Частая ошибка`, chart) остаётся.

### UX-принципы (из doc 16)

- **Принцип 1. Jobs-first**: экран отвечает на одну работу — быстро понять результаты ученика в экзаменной рамке, а не просто показать «аналитику».
- **Принцип 2. Один экран = одна главная работа**: не добавляем новый top-level flow; exam stats встроены в существующий review flow homework results.
- **Принцип 7. Progressive disclosure**: summary по номерам виден сразу, подробная история ученика раскрывается только по клику.
- **Принцип 8. Частые сценарии на виду**: вход остаётся через `Домашки` → конкретное ДЗ → `Результаты`, без новой навигации.
- **Принцип 12. Надёжность и управляемость > эффектность**: v1 делает понятные score chips и delta, а не тяжёлые BI-графики.
- **Принцип 15. Каждая фича усиливает шанс платного пилота**: feature усиливает удержание и time saved на review, но не размывает wedge.

### UI-паттерны (из doc 17)

- Использовать текущий `TutorHomeworkResults` как основной контейнер, не создавать новый route/module.
- Для mobile — card-based layout, а не широкая таблица с колонками по ученикам и номерам.
- Номера КИМ показывать как компактные chips/cards, чтобы соблюсти правило “не делать таблицы >4 колонок на mobile”.
- Статусы (`Сдано`, `В работе`, `Проверено`) сохраняются как видимые badges рядом с exam metrics.
- Раскрытие ученика остаётся существующим паттерном accordion/expand row.
- `Напомнить несдавшим` остаётся secondary action; фича не добавляет ещё один competing primary CTA.

### Copy / Naming

Допустимые названия:
- `Результаты по номерам`
- `Динамика ученика`
- `Прогресс по №21`
- `Предыдущий результат`

Не использовать:
- `Аналитика AI`
- `Интеллектуальный скоринг`
- `Smart dashboard`

---

## 7. Validation

### Как проверяем успех?

**Leading indicators (3-7 дней после релиза):**
- `exam_results_open_rate` — доля exam-tagged ДЗ, у которых репетитор открыл экран результатов: порог `>= 60%`
- `student_progress_expand_rate` — доля exam results sessions, где раскрыли хотя бы одного ученика: порог `>= 40%`
- `manual_review_time_saved` — qualitative feedback от пилотного репетитора: “быстрее понял слабые номера” в weekly check-in

**Lagging indicators (2-4 недели):**
- рост weekly reuse results screen в exam-tagged homework workflows;
- появление языка ценности типа “вижу по каким номерам ученик проседает” вместо “просто проценты”.

### Связь с pilot KPI

Фича должна усиливать:
- `Weekly active pilot tutors` — репетитор возвращается не только чтобы собрать ДЗ, но и чтобы быстро разобрать результат;
- `Homework workflow completion rate` — review результата становится быстрее и полезнее;
- `Perceived time saved` — уменьшается ручное сравнение нескольких ДЗ и заметок вне Сократа.

### Smoke check

```bash
npm run build
npm run typecheck
npm run smoke-check
```

---

## 8. Risks & Open Questions

| Риск | Вероятность | Митигация |
|---|---|---|
| Исторические ДЗ не получат exam metadata автоматически | Средняя | Phase 1 работает только на новых/обновлённых ДЗ; P1 — best-effort backfill из `homework_kb_tasks` |
| Репетитор смешает `ege` и `oge` задачи в одном ДЗ | Средняя | Frontend + backend validation: один assignment = один `exam_kind` или `NULL` |
| Generic UI и exam UI начнут расходиться и ломать backward compatibility | Средняя | Расширять существующий response shape, а не заменять его; exam mode включать только при `exam_view != null` |
| Захочется превратить экран в полноценный BI-dashboard | Высокая | Явно зафиксировать out-of-scope: без отдельной аналитики, рейтингов и heavy charts в v1 |

### Открытые вопросы

1. Нужен ли для v1 только `delta vs previous`, или Женя ожидает сразу полную историю по номеру за 3-5 ДЗ?
2. Нужен ли визуальный desktop-chart по номерам уже в первой фазе, или достаточно summary cards/chips?
3. Нужно ли запросить у Жени screenshot neofamily до UI-реализации? Предположение: полезно, но не блокирует start Phase 1.

---

## 9. Implementation Tasks

> Переносятся в `docs/delivery/features/homework-exam-stats/tasks.md` после approve спеки.

- [ ] TASK-1: DB migration — add `kb_task_id`, `exam_kind`, `kim_number` to `homework_tutor_tasks`
- [ ] TASK-2: Tutor create/edit flow — carry exam metadata through `DraftTask`, create, update, edit-mode prefill
- [ ] TASK-3: homework-api contracts — extend assignment details/results responses with exam metadata
- [ ] TASK-4: homework-api aggregation — build `TaskResultFact` from guided task_states and produce exam summary
- [ ] TASK-5: Tutor results UI — exam mode with per-number chips and fallback to generic mode
- [ ] TASK-6: Student history / self-trend preview — delta vs previous result, optional P1 endpoint for full history
- [ ] TASK-7: README + QA — update `homework-api` docs and validate guided exam-tagged paths

---

## Parking Lot

- Конвертация первичных баллов в тестовые баллы ЕГЭ/ОГЭ.
- Parent-facing report / weekly progress digest по номерам.
- Экспорт “карты прогресса” в PDF/Telegram.
- Автоматическое определение `kim_number` из текста ручной задачи через AI/regex.
- Тепловая карта тем кодификатора поверх exam numbers.

---

## Checklist перед approve

- [x] Job Context заполнен (секция 0)
- [x] Привязка к Core Job из Графа работ
- [x] Scope чётко определён (in/out)
- [x] UX-принципы из doc 16 учтены
- [x] UI-паттерны из doc 17 учтены
- [x] Pilot impact описан
- [x] Метрики успеха определены
- [x] High-risk файлы не затрагиваются без необходимости
- [x] Student/Tutor изоляция не нарушена
