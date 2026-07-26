# Материалы занятий («Занятия») — инварианты (всегда в контексте)

Репетитор крепит к занятию запись / PDF-конспект / ссылку на существующее ДЗ; ученик читает во вкладке «Занятия». **Глубина — skill `schedule-materials`** (edge-роуты и их контракты, notify-дайджест, несколько ДЗ на урок, attach=assign, пост-логин лендинг ученика, история фич).

## Группы — unified model, членство через participants

Unified мини-группа = **ОДНА** строка `tutor_lessons` с `student_id IS NULL`; участники в junction `tutor_lesson_participants`.

⚠️ **Членство НЕ резолвится через `tutor_lessons.student_id` / `group_session_id`** — только через participants, и **только через SECURITY DEFINER хелперы** (`student_can_see_lesson`, `student_assigned_to_homework`). Participants живёт под tutor-only RLS, поэтому прямой subquery как `authenticated` даст false-negative.

## Anti-leak

- **Column-whitelist, никогда `SELECT *`.** `tutor_lessons.notes` и прочие tutor-only поля ученику не отдаются. `tutor_id`/`student_id` читаются server-side (имя тутора, membership) и **drop'аются из ответа** — явным маппингом, не spread'ом.
- **`homework_ref` виден ТОЛЬКО назначенному ученику — на ОБОИХ путях:** в feed (скоуп по `student_id = uid`) И в RLS (`material_kind <> 'homework_ref' OR student_assigned_to_homework(...)`). Со-участник не должен получить UUID чужого ДЗ даже прямым PostgREST.
- Новое поле, видимое ученику → явное решение tutor-only vs student-visible (default paranoid); расширять edge-whitelist, **не** клиентский select.

## FK-дрейф ownership (rule 60)

`tutor_lessons.tutor_id → tutors.id`; `homework_tutor_assignments.tutor_id → auth.users.id`.

`homework_ref` attach требует ВСЕ три проверки: (а) занятие принадлежит (`lesson.tutor_id === resolveTutorPkId(uid)`); (б) `assignment.tutor_id === uid` (**auth.uid, НЕ tutorPkId**); (в) ДЗ назначено ученику этого занятия. Иначе 403.

## `ON DELETE CASCADE`, не SET NULL

`homework_assignment_id` FK = **CASCADE**. При `SET NULL` строка `homework_ref` осталась бы с NULL id и **молча нарушила `chk_kind_payload`** — Postgres не перепроверяет CHECK на cascade.

## Attach = assign (единственный write-path назначения)

Прикрепление ДЗ к занятию **авто-назначает** учеников занятия (групповое → всех участников). Но:

⚠️ **`lesson-materials-api` НЕ пишет в `homework_tutor_student_assignments` сам.** Он делает awaited server-side `fetch` на `homework-api/assignments/:id/assign-students` с форвардом пользовательского `Authorization` и `notify:false`. Так бесплатно достаются whitelist `tutor_students`, идемпотентный upsert, `provisionGuidedThread`, draft→active. **Новый путь «прикрепить ДЗ» → только реюзом `homework-api`, не второй write-path** (rule 40).

Порядок: UUID/ownership → studentSet → кап → assign → `insertMaterial`. Материал не появляется без назначений.

## Fail-closed на резолве получателей

Сбой запроса участников **чистой группы** (`student_id IS NULL`) → **503**, НЕ тихий `ok:true` с нулём получателей и не частичное назначение. Для индивидуального занятия (есть `student_id`) допустима мягкая деградация с warn-логом. Любой новый резолв получателей занятия — fail-closed.

## Boot-зависимости edge-функции

⚠️ **Материалы-CRUD не должен boot-зависеть от notify-модулей.** Top-level `import` тяжёлого/опционального модуля с отсутствующим экспортом = Deno link-fail = **503 на ВСЕХ роутах, включая OPTIONS** (инцидент: прод сломан ~5 дней). Notify runtime-deps (`push-sender`, `email-sender`) — только **динамический `await import()`** внутри хендлера; top-level оставлять лишь `import type`.

Диагностика boot-crash: `curl -X OPTIONS` функции — **503 = boot-fail** (401 = задеплоено и живо, 404 = функции нет).

## Несколько ДЗ на урок

Разрешено N разных `homework_ref`, запрещён дубль одного (partial-unique `(lesson_id, homework_assignment_id)`; `23505` → 409). Любой surface со списком материалов → `filter`, **не `find`**; порядок — `sort_order` + `created_at` tie-breaker (несколько `homework_ref` имеют `sort_order=0`, без tie-breaker порядок «плавает»).

## Клиентские контракты

- Tutor: `supabase.functions.invoke('lesson-materials-api/<subpath>')` + `extractEdgeFunctionError`.
- Student: транспорт-клон `requestStudentHomeworkApi` (401 → refresh → retry → signOut), но **flat-shape парсинг напрямую** (`body.error`/`body.code`) — НЕ `extractApiErrorMessage` (тот трактует строковый `error` как code).
- PDF в браузер — `createSignedUrl` + `rewriteToProxy` (RU-safe, rule 96).
- **One-hop в ДЗ:** чип ведёт на `/student/homework/:id/problem/:entry_task_id`; redirect-only `/homework/:id` — только fallback при `entry_task_id === null`.
