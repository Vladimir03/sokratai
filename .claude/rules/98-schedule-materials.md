# Schedule Materials — «Занятия» (`tutor_lesson_materials`)

Репетитор крепит к занятию материалы (запись-URL / PDF-конспект / ссылку на существующее ДЗ); ученик читает их в новой вкладке **«Занятия»** (лента + деталка). Spec: `docs/delivery/features/schedule-materials/spec.md`. Build-лог: memory `project_schedule_materials.md`. P0 shipped 2026-06-02; P1 (notify/create-ДЗ/нудж) — отложено.

## Архитектура
- Таблица `tutor_lesson_materials` (`material_kind ∈ recording|pdf|homework_ref`, `chk_kind_payload`). Bucket `lesson-materials` (PDF only). Миграции `20260602140000` (table+RLS+GRANT), `_140100` (bucket), `_140200` (per-student homework_ref RLS).
- Edge **`lesson-materials-api`** (tutor CRUD, `verify_jwt=true`) + **`student-lessons-api`** (student read feed, `verify_jwt=true`, service_role DB-клиент). Обе в `config.toml` + deploy workflow, без `--no-verify-jwt` (rule 96 #11).
- Tutor UI: `LessonMaterialsDrawer` из `LessonDetailsDialog` (`TutorSchedule.tsx` — только кнопка+state, rule 10). Student UI: `/student/schedule` (лента) + `/student/schedule/:lessonId` (деталка), вкладка «Занятия» leftmost.

## Группы — unified model (КРИТИЧНО, не как homework)
Unified mini-group = **ОДНА** строка `tutor_lessons` с `student_id IS NULL`; участники в junction `tutor_lesson_participants(lesson_id, student_id, …)`. Поэтому членство НЕ резолвится через `tutor_lessons.student_id`/`group_session_id` — только через participants. Все student-проверки идут через **SECURITY DEFINER** хелперы (participants под tutor-only RLS → прямой subquery как `authenticated` даст false-negative):
- `student_can_see_lesson(_lesson_id)` — `tutor_lessons.student_id = auth.uid()` OR participant.
- `student_assigned_to_homework(_assignment_id)` — есть `homework_tutor_student_assignments` для `auth.uid()`.

## Anti-leak (mirror rule 40)
- `student-lessons-api` — **column-whitelist, никогда `SELECT *`**; `tutor_lessons.notes` и tutor-only поля НЕ отдаются. `tutor_id`/`student_id` читаются server-side (имя тутора, membership) и **drop'аются из ответа** (явный маппинг, не spread).
- **`homework_ref` виден только назначенному ученику** — на ОБОИХ путях: feed (`loadHomeworkInfo` скоупит по `student_id = uid`, не-назначенному омитит) И RLS (`tlm_student_select`: `material_kind <> 'homework_ref' OR student_assigned_to_homework(...)`). Co-participant не получает UUID чужого ДЗ даже прямым PostgREST.

## FK-дрейф ownership (`lesson-materials-api`, mirror rule 40)
`tutor_lessons.tutor_id → tutors.id`; `homework_tutor_assignments.tutor_id → auth.users.id`. `homework_ref` attach требует ВСЕ три: (а) lesson owned (`lesson.tutor_id === resolveTutorPkId(uid)`); (б) `assignment.tutor_id === uid` (auth.uid, НЕ tutorPkId); (в) assignment назначено ученику занятия (`studentSet = lesson.student_id ∪ participants`). Иначе 403 `INVALID_HOMEWORK_REF`. 1:1 на занятие — partial-unique index + 409 `HW_REF_EXISTS`.

## Прочие инварианты
- `homework_assignment_id` FK = **`ON DELETE CASCADE`** (НЕ `SET NULL` — иначе строка `homework_ref` с NULL id молча нарушает `chk_kind_payload`: Postgres не перепроверяет CHECK на cascade).
- **PDF ≤20 МБ + `application/pdf` энфорсятся БАКЕТОМ** (`file_size_limit`/`allowed_mime_types`, миграция `_140100`) на upload — авторитетно. В edge байт-чек НЕ нужен (не плодить мёртвую `MAX_LESSON_PDF_BYTES`). Клиент дополнительно pre-check'ит (`lessonMaterialsApi.MAX_LESSON_PDF_BYTES`).
- **DELETE** (`lesson-materials-api`): ownership → удалить row → `storage.remove()` только для `kind='pdf'` (rule 50 order; recording/homework_ref не трогают storage/ДЗ).
- **One-hop ДЗ (AC-6):** `student-lessons-api` возвращает `entry_task_id` в `homework_ref` (резолв `current_task_id → first-unfinished → first by order_num`); чип/кнопка идут прямо на `/student/homework/:id/problem/:entry_task_id`, fallback `/homework/:id` только если `entry_task_id` null. НЕ вести на redirect-only `/homework/:id` как основной путь.

## Клиентские контракты
- `lessonMaterialsApi.ts` (tutor): `supabase.functions.invoke('lesson-materials-api/<subpath>')` + `extractEdgeFunctionError` (subpath роутится — `FunctionsClient` строит `new URL(${functionsUrl}/${name})`; functionsUrl = `api.sokratai.ru`, RU-safe).
- `studentScheduleApi.ts` (student): транспорт-клон `requestStudentHomeworkApi` (401→refresh+retry→signOut, rule Phase 3.1), но **flat-shape парсинг напрямую** (`body.error`/`body.code`) — НЕ `extractApiErrorMessage` (тот трактует строковый `error` как code, mirror `tutorProgressApi`).
- PDF/recording URL в браузер — recording = generic URL; pdf = `createSignedUrl` (TTL 3600) + `rewriteToProxy` (CC-1, server-side).

## Пост-логин лендинг ученика → `/student/schedule`
Изменён дефолт лендинга студента с `/chat` на `/student/schedule` в 9 точках: `Login.tsx` (pre-check, post-login, OAuth `redirectPath`), `SignUp.tsx` (×3), `TelegramLoginButton.tsx` (×3). Tutor-ветки (`/tutor/home`) не тронуты. Легко откатить (pilot-scope).

## P1 (2026-06-03) — notify-дайджест + «Создать ДЗ» из занятия + нудж

P0 (вкладка «Занятия» + крепление материалов) дополнен тремя fast-follow задачами (TASK-7/8/9). Codex CONDITIONAL PASS → 2 блокера + 1a/1b закрыты.

**TASK-7 — notify-дайджест (`lesson-materials-api` `POST /lessons/:id/materials/notify`):** ОДНО уведомление на вызов, каскад push→telegram→email (first-success-wins, reuse `_shared/push-sender.ts` + новый шаблон `_shared/transactional-email-templates/lesson-materials-notification.ts`), deep-link `/student/schedule/:lessonId`. Получатели = индивид (`tutor_lessons.student_id`) + участники unified-группы (`tutor_lesson_participants`). Drawer «Готово» вызывает notify ОДИН раз (idempotent на клиенте). `@temp.sokratai.ru` пропускается. **Recipient-set lookup invariant (review fix #3):** для ЧИСТОЙ группы (`student_id IS NULL`) сбой запроса участников → **503 `RECIPIENTS_LOOKUP_FAILED`** (flat рус, rule 97), НЕ тихий `ok:true` с нулём; для индивида (есть `student_id`) — мягкая деградация (warn-лог), без 503. Логи PII-free (`lesson_id` + счётчики — ок, конвенция telemetry rule 40, не PII).

**TASK-8 — «Создать ДЗ» из drawer:** кнопка → navigate `/tutor/homework/create?subject&students&lesson_id`. Prefill в `TutorHomeworkCreate` — create-only, **ref-guarded** (`lessonPrefillRef`), не пересекается с edit-prefill (`editPrefilledRef`)/его reset-ordering (rule 40). **1a (server-truth wins):** при наличии `lesson_id` URL-получатели **валидируются против фактического student-set занятия** (`tutor_lessons.student_id` + participants); stale/tampered URL не подставит ученика не с занятия. Fail-safe: сбой валидации → НЕ префиллим получателей (тутор выбирает вручную), не верим URL вслепую. На сохранении — auto-link `homework_ref` через reuse `attachHomework` (idempotent; `HW_REF_EXISTS` = успех). **Attach-failure НЕ fatal** (ДЗ уже создано+назначено — нельзя бросать в outer «create failed»): `toast.error` + **retry-action «Повторить»** (1b). Drawer group-получатели резолвятся **fail-closed** (review fix #2): сбой запроса participants → toast + НЕ навигируем пустым набором.

**TASK-9 — нудж после «Отметить проведённым» (`TutorSchedule.tsx::handleCompleteLesson`):** после УСПЕШНОГО завершения — non-blocking `toast` (action «Добавить», auto-dismiss 8с), переоткрывающий тот же `LessonMaterialsDrawer` (reuse `setMaterialsDrawerLesson`, гейт `selectedLesson.id === lessonId`). Completion-логика (`completeLessonAndCreatePayment`/оплата/конфетти/refetch) НЕ изменена (rule 10); `selectedLesson` добавлен в deps `useCallback`.

**При расширении P1:** новый канал notify → расширить каскад в `handleNotify` (не дублировать); новый источник получателей — резолвить server-side (не из URL вслепую, 1a); любой URL-prefill в конструктор — create-only + ref-guard + валидация против server-truth; attach/link-failure из конструктора — никогда не fatal (ДЗ уже существует), только surface + retry.

## При расширении
- Новый student-facing fetch материалов — только через service_role edge (column-whitelist), не прямой PostgREST с RLS.
- Новый bucket для материалов — добавить в валидацию `lesson-materials-api` + bucket policy + (если уходит в браузер) signed-URL путь.
- Новое поле, видимое ученику, — явное решение tutor-only / student-visible (default paranoid); расширять edge-whitelist, не клиентский select.
- Группы — всегда через participants + SECURITY DEFINER хелперы, не `tutor_lessons.student_id`.

## Shared materials panel + PostLessonSheet + 503 boot-fix (2026-06-08)

Тело материалов-UI вынесено из `LessonMaterialsDrawer` в **`src/components/tutor/schedule/LessonMaterialsPanel.tsx`** (секции Запись/Конспект/Домашка + ВСЯ логика: queries, upload, attach, create-ДЗ). Рендерят ОБА: `LessonMaterialsDrawer` (тонкая Sheet-оболочка, props `{open,onOpenChange,lesson}` НЕ менялись → существующие callsite не тронуты) и новый `PostLessonSheet` (гайд «после занятия»). **Не дублировать тело — править панель.**

**TASK-7 notify-once инвариант (КРИТИЧНО, mirror старого drawer):** дайджест-уведомление при закрытии живёт В ПАНЕЛИ за ref-хэндлом **`flushNotifyOnClose()`** (+ `materialsAddedRef`/`notifiedRef` внутри панели). Оболочка зовёт его на «Готово»/overlay/Esc перед `onOpenChange(false)`. Путь **«Создать ДЗ» использует `onRequestClose()`** (raw close, БЕЗ notify — навигация ≠ «Готово», старый инвариант сохранён). Prop `active` (= host `open`) гейтит queries + reset-effect. Новый host материалов — рендерит панель + зовёт `flushNotifyOnClose` на close, НЕ копирует notify-логику.

**`lesson-materials-api` 503 boot-crash (инцидент, прод сломан ~2026-06-03→06-08):** P1-коммит `f88d4b7` импортировал `sendLessonMaterialsNotificationEmail` из `_shared/email-sender.ts`, но **экспорт НЕ закоммитил** → Deno ESM «missing named export» = link-fail → **503 на ВСЕХ роутах (вкл. OPTIONS)** для всех. Симптом: toast «Failed to send a request to the Edge Function» при открытии материалов И в группе, И индивидуально; при этом список ДЗ грузится (другая, живая функция). Фикс: (1) закоммитить экспорт; (2) **notify runtime-deps (`sendPushNotification` из push-sender, `sendLessonMaterialsNotificationEmail` из email-sender) — ТОЛЬКО dynamic `await import()` внутри `handleNotify`**; top-level оставить лишь `import type { PushPayload, PushSubscriptionData }`. **Инвариант: материалы-CRUD не должен boot-зависеть от notify-модулей** — новый тяжёлый/опциональный import в edge-функции крепления → dynamic import в хендлере, не top-level. Диагностика boot-crash: `curl -X OPTIONS` функции → **503 = boot-fail** (не 401 deployed / не 404 missing).
