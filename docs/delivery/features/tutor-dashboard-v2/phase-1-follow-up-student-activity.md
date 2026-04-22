# Follow-up: «Активность учеников» — fix RLS gap + raise student cap

**Version:** v1.0
**Date:** 2026-04-22
**Parent:** [tutor-dashboard-v2/spec.md](./spec.md) (Phase 1)
**Status:** approved
**Task:** TASK-9 (follow-up после TASK-8 landed 2026-04-22)

---

## 0. Job Context

| Participant | Core Job | Sub-job |
|---|---|---|
| Репетитор (B2B) | **R4** — Сохранение контроля и качества при масштабировании | R4-1 (быстрая оценка состояния учеников), R4-2 (проактивная реакция) |

Блок «Активность учеников» — ключевая часть триаж-виджета на `/tutor/home`. Без корректных данных R4-1/R4-2 невозможны: репетитор не видит кто реально сдаёт ДЗ, а кто застрял.

---

## 1. Problem

Репетитор Владимир (test-tutor) видит 3 бага на `/tutor/home` → «Активность учеников»:

1. **Мальцев Даниил** завершил guided ДЗ (AI feedback «Отличная работа!», «Все задачи выполнены!» на скриншотах guided thread), но в таблице — пустой weekly strip, Ø балл `—`, Тренд `—`, сигнал **«Неактивен»**.
2. **Злата** аналогично — успешное AI feedback, в таблице «Неактивен» + пустая статистика.
3. В блоке показывается **17 из 24** учеников (7 теряются).

---

## 2. Root cause

### Issues #1 + #2 — missing tutor SELECT RLS policy

Базовая миграция `supabase/migrations/20260306100000_guided_homework_threads.sql:55-80` включила RLS на `homework_tutor_threads` и `homework_tutor_task_states`, но создала policies **только для студентов** (`student_read_own_threads`, `student_read_own_task_states`). Тьюторская SELECT policy отсутствует.

Администраторская policy появилась позже (`20260320154843_...sql:3`), но для tutor-роли гэп остался.

Миграция TASK-7 (`20260406173000_enable_tutor_realtime_read_homework_thread_messages.sql`) закрыла аналогичную дыру для `homework_tutor_thread_messages` — но только для него.

**Результат:** Hook `useTutorStudentActivity` (`src/hooks/useTutorStudentActivity.ts:210-228`) делает прямые PostgREST запросы:
- `homework_tutor_threads.in('student_assignment_id', saIds)` → 0 строк
- `homework_tutor_task_states.in('thread_id', threadIds)` → 0 строк

Hook далее в ветке attention (`:398-421`) видит пустой `lastActivityStrings` + `studentSas.length > 0` → маркирует ученика как «Неактивен»; weekly/hwTrend/hwAvg остаются пустыми.

### Issue #3 — cap + secondary truncation

`useTutorStudentActivity.ts:49-50, 454-456`:
```ts
const MAX_STUDENTS = 20;
const ATTENTION_LIMIT = 15;
// ...
const withAttention = items.filter(attention).slice(0, ATTENTION_LIMIT);
const rest = items.filter(!attention);
const combined = [...withAttention, ...rest].slice(0, MAX_STUDENTS);
```

Для 24 учеников: 22 получают `attention=true` (из-за RLS bug → все видятся неактивными), 2 без assignment → `attention=false`. Итого `combined = 15 + 2 = 17`. Совпадает с сообщением репетитора.

---

## 3. Solution

### Part A — additive RLS migration

Новая миграция `supabase/migrations/20260422130000_add_tutor_select_policies_on_threads_and_task_states.sql` добавляет две tutor SELECT policies, копируя паттерн из `20260406173000`:

```sql
-- Threads
CREATE POLICY "HW tutor threads select by assignment owner"
  ON public.homework_tutor_threads
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.homework_tutor_student_assignments sa
      JOIN public.homework_tutor_assignments a ON a.id = sa.assignment_id
      WHERE sa.id = homework_tutor_threads.student_assignment_id
        AND a.tutor_id = auth.uid()
    )
  );

-- Task states (one extra JOIN через threads)
CREATE POLICY "HW tutor task_states select by assignment owner"
  ON public.homework_tutor_task_states
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.homework_tutor_threads th
      JOIN public.homework_tutor_student_assignments sa ON sa.id = th.student_assignment_id
      JOIN public.homework_tutor_assignments a ON a.id = sa.assignment_id
      WHERE th.id = homework_tutor_task_states.thread_id
        AND a.tutor_id = auth.uid()
    )
  );
```

**Свойства:**
- **Additive + idempotent** — `DROP POLICY IF EXISTS` + `CREATE POLICY`, можно безопасно перезапустить.
- **FOR SELECT only** — tutor не может апдейтить / удалять через PostgREST; write-paths по-прежнему через edge function (service_role).
- **Student и admin policies нетронуты** — back-compat гарантирована.

### Part B — raise student cap

`useTutorStudentActivity.ts:49-50`:
```diff
-const MAX_STUDENTS = 20;
-const ATTENTION_LIMIT = 15;
+const MAX_STUDENTS = 30;
+const ATTENTION_LIMIT = 30;
```

`ATTENTION_LIMIT === MAX_STUDENTS` означает что secondary-slice (`:454-456`) фактически не урезает — вся логика остаётся ради сортировочного invariant (attention → delta → name).

30 — pilot cap с headroom (реальные tutors имеют ≤ 28 учеников по CLAUDE.md).

### Why RLS migration, not edge function

TASK-7 решил проблему на `thread_messages` через edge function (`service_role` обход + consolidated query). Причина там была другая — brittle nested embed `.eq()` через 3 уровня JOIN, не RLS per se.

Здесь queries в hook простые (`in('thread_id', ids)` — flat), поэтому как только RLS policy появится, PostgREST работает предсказуемо. Edge function был бы overkill — добавил бы ~150 строк кода без benefit.

Если в будущем появятся новые tutor analytics surfaces с аналогичным fetch pattern — они тоже получат working RLS «бесплатно». Follow-up (parking lot): перевести hook на edge function только если дальше появятся нестабильности или нужен consolidated aggregation.

---

## 4. Acceptance criteria

- **AC-A1**: Миграция применена — `\dp homework_tutor_threads` показывает policy `"HW tutor threads select by assignment owner"`. То же для `homework_tutor_task_states`.
- **AC-A2**: Tutor SQL возвращает ненулевой результат (было 0 до миграции):
  ```sql
  SELECT COUNT(*) FROM homework_tutor_threads t
  WHERE t.student_assignment_id IN (
    SELECT id FROM homework_tutor_student_assignments sa
    WHERE sa.assignment_id IN (
      SELECT id FROM homework_tutor_assignments WHERE tutor_id = auth.uid()
    )
  );
  ```
- **AC-A3**: В блоке «Активность учеников» Мальцев Даниил и Злата показывают weekly strip с зелёными/жёлтыми ячейками, ненулевой hwAvg, Sparkline Тренд с данными.
- **AC-A4**: Attention reason для них **не** «Неактивен» (если активны < 7 дней). Показывают «всё хорошо» или конкретный сигнал (Просрочено / Падает балл).
- **AC-A5**: Все 24 ученика репетитора отображаются в таблице (не 17).
- **AC-A6**: Student RLS policies не затронуты — student-side guided chat работает как раньше.
- **AC-A7**: Admin-side policies не затронуты — admin panel работает.

---

## 5. Changed files

**New:**
- `supabase/migrations/20260422130000_add_tutor_select_policies_on_threads_and_task_states.sql`

**Modified:**
- `src/hooks/useTutorStudentActivity.ts` (2 constants).

**Docs:**
- This file (new).
- `docs/delivery/features/tutor-dashboard-v2/tasks.md` — TASK-9 row + checklist.
- `.claude/rules/40-homework-system.md` — инвариант про tutor RLS на threads / task_states.

---

## 6. Verification

1. **Migration apply** (Lovable Cloud / Supabase): `\dp homework_tutor_threads` + `\dp homework_tutor_task_states` confirm policies.
2. **Direct SQL as tutor** — см. AC-A2 query, returns > 0 rows.
3. **Frontend smoke** на preview:
   - `/tutor/home` как test-tutor → Мальцев Даниил / Злата имеют ненулевые weekly + Тренд.
   - В таблице 24 строки (было 17).
4. **Regression:**
   - `/student/homework` — student thread виден ученику как раньше.
   - `/admin` — admin debug panels работают.
5. **Build:** `npm run lint && npm run build && npm run smoke-check`.
6. **Network trace** (DevTools): запрос к `homework_tutor_threads?select=...` возвращает JSON array с items (было `[]`).

---

## 7. Parking lot

- Перенос `useTutorStudentActivity` на edge function `GET /student-activity` (service_role) — если новые tutor-surfaces начнут ломаться через PostgREST или понадобится server-side aggregation.
- Pagination / virtualization таблицы при 50+ учениках.
- Jest coverage для attention ветвей (`overdue > scoreDropping > inactive`).
- Telemetry `student_activity_loaded` для p95 latency measurement.
