# Hotfix deploy — AC-P11 H1-H7 + AC-P9 backfill

## Контекст

Три коммита (`cd1257b`, `809d836`, `a09b13e`) уже в локальном main. Нужно:

1. Закрыть migration drift
2. Переразвернуть две edge functions

## Шаги

### 1. Apply migration drift

В БД отсутствует `20260526120000_ac_p9_partial_credit_backfill.sql` (одноразовый PL/pgSQL backfill multi_choice + ordered partial credit для KIM 5/9/14/18 и 6/10/15/17, идемпотентен через `WHERE earned_score IS DISTINCT FROM new_score`, preserves `score_source='tutor'`).

Применю содержимое файла через `supabase--migration` (новой timestamped миграцией, т.к. legacy файл с этим timestamp уже считается «зарегистрированным», но не выполнен — драфт-state на стороне Lovable).

### 2. Redeploy edge functions

- `mock-exam-tutor-api` (H3 read-only drill-down, H4 signed URL resolve, H5 server-side total recompute, H7 touch target — хотя H7 frontend, edge function тоже задет в commit)
- `mock-exam-student-api` (H1 paused status block в `handleGetResult`)

Через `supabase--deploy_edge_functions`.

### 3. Verification

- `SELECT version FROM supabase_migrations.schema_migrations WHERE version = '20260526120000'` → должна быть.
- Frontend сам пересоберётся (preview).

После apply сообщу готовность — Vladimir попросит preview URL для прод-релиза.

## Что НЕ трогаю

- Никаких code edits (всё уже в main).
- Frontend bundle деплоится автоматически на preview; production `deploy-sokratai` — отдельный шаг по запросу Vladimir.
