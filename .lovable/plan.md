# Диагноз

**Данные в БД целы.** Полный аудит:

| Таблица | Записей |
|---|---|
| `tutor_students` | 129 |
| `tutors` | 41 |
| `profiles` | 413 |
| `homework_tutor_assignments` | 153 |
| `homework_tutor_student_assignments` | 343 |
| `tutor_lessons` | 356 |
| `tutor_payments` | 31 |
| `mock_exam_attempts` | 28 |

Конкретно у Владимира_реп в БД **3 ученика** — UI показывает 0.

## Причина: колонка `profiles.full_name` не существует

Код (frontend + edge functions) SELECT'ит `profiles.full_name`, но колонки в БД нет. PostgREST возвращает ошибку → `getTutorStudents()` ловит её, логирует и возвращает `[]` → UI «У вас пока нет учеников».

Подтверждение в логах edge function `homework-api`:
```
resolve_student_identity_profiles_lookup_failed
  error: "column profiles.full_name does not exist"
```

Затронуто:
- `src/lib/tutors.ts:52` — `STUDENT_PROFILE_SELECT` включает `full_name` → ломает **весь список учеников** у каждого репетитора
- `supabase/functions/homework-api/index.ts` (5 точек) — `resolveStudentIdentity`, `tutorExtras` lookup
- Phase 8 / Phase 8.1 (CLAUDE.md §28) предполагали что колонка существует, но миграция её добавления отсутствует (последние миграции на `profiles`: `last_sign_in_at`, `trial_started_at` — `full_name` нигде нет).

## План фикса

**Одна миграция** — добавить недостающую колонку:

```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS full_name text;
```

Безопасно и additive:
- Existing rows получают `NULL` (для всех 413 profiles).
- Priority chain `tutor_students.display_name → profiles.full_name → profiles.username` уже корректно фолбэчит на `username` при NULL (см. CLAUDE.md §8 + §28).
- PostgREST сразу начнёт принимать SELECT с `full_name` → списки учеников вернутся, edge function warnings исчезнут.
- Никаких backfill — `full_name` опционально, заполняется когда юзер сам введёт real-name (signup `full_name` метаданные / future tutor edit).

## Validation после deploy

1. Открыть `/tutor/students` под Владимиром — должно показать 3 учеников.
2. Edge function logs `homework-api` — warning `resolve_student_identity_profiles_lookup_failed` должен исчезнуть.
3. `psql -c "SELECT COUNT(*) FROM profiles WHERE full_name IS NOT NULL"` → 0 (ок, поле новое).

## Frontend/backend изменения

**Никаких.** Код уже корректно использует поле — он опередил schema на 1 миграцию. Фикс полностью на стороне БД.
