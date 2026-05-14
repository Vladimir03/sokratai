# Mock Exams v1 — Tutor cabinet bugs fix (TASK-11)

**Created:** 2026-05-14
**Status:** ✅ Landed
**Trigger:** Vladimir QA after TASK-10 (per-attempt answer_method choice) — 3 bugs blocking pilot.

## 0. Job Context

- **Job:** R4-2 (репетитор видит работу ученика для проверки), S2-1 (ученик проходит пробник в комфортном режиме)
- **Wedge alignment:** репетитор не может работать с пробником пока stats показывают NaN, ссылки не грузятся, и работа submitted ученика не отображается. Все три бага блокируют core «check student submission» flow пилота.

## 1. Problem

После landing TASK-10 (commit `7025fdc`) Vladimir обнаружил три бага в тюторском кабинете:

1. **TutorMockExams list page (Bug 1):** «Сдали 0/2», «В процессе NaN», «Требует проверки 0» — хотя один ученик реально нажал submit. Root cause: семантика `attempts_approved` была узкой (только `approved + manually_entered`), submitted-attempts не попадали в счётчик. NaN — undefined arithmetic в формуле `total - submitted - … - not_started` без null-safe fallback'ов.

2. **MockExamInviteLinksSection (Bug 2):** красный «Не удалось загрузить ссылки. Повторить» для любого assignment'а (даже без созданных ссылок). Root cause: `service_role` не имел GRANT на `mock_exam_public_links` → handler `handleListInviteLinks` (под service_role) получал Postgres permission denied → HTTP 500 → frontend рендерил error banner вместо empty state.

3. **TutorMockExamReview (Bug 3):** для submitted ученика показывает «Часть 1: 0/0», «Часть 2 пока не загружена». Root cause: после TASK-10 ученик мог выбрать `answer_method='blank'` (ФИПИ бланк от руки) — но submit handler **всё равно** перебирал все part1Tasks и записывал `earned_score=0` для каждого, потому что student_answer всегда `null` в blank mode. Tutor видел auto-checked zeros, а не контент бланка.

## 2. Solution (Phase A)

### 2.1 DB — `service_role` GRANT на mock-exam таблицы

Миграция `20260514140000_invite_links_service_role_grant.sql` выдаёт `SELECT, INSERT, UPDATE, DELETE` на все 8 mock-exam v1 таблиц для `service_role`. Превентивно покрывает все таблицы, не только `mock_exam_public_links` — другие endpoints могут молча упасть с тем же permission denied при следующем баг-репорте.

### 2.2 Backend — submit handler answer_method gate

`mock-exam-student-api::handleSubmitAttempt`:

- Читает `attempt.answer_method` (default `'form'` для legacy attempts без значения)
- `shouldAutoCheckPart1 = (answerMethod === 'form')`
- Если `false`: skip per-task auto-check loop; `totalPart1 = null` (semantic «требует ручной проверки», не «0 баллов»)
- Validation gate: `answer_method='blank' && blank_photo_url IS NULL && part1_blank_photo_url IS NULL` → 400 `NO_BLANK_PHOTO` (мягкая блокировка submit — tutor должен иметь что проверять)

Response теперь возвращает `answer_method` + `auto_checked_part1` для frontend визуализации.

### 2.3 Backend — KPI new semantics

`mock-exam-tutor-api::handleGetAssignmentsList` + `handleGetAssignment` теперь возвращают backend-computed aggregate с explicit полями:

- `attempts_in_progress` — explicit (вместо `total - ... - ...` subtract на фронте)
- `attempts_completed_total` = `submitted + ai_checking + awaiting_review + approved + manually_entered` — **«Сдали»** (всё кто нажал submit)
- `attempts_pending_review` = `submitted + ai_checking + awaiting_review` — **«Требует проверки»**
- Legacy поля (`attempts_submitted`, `attempts_approved`, etc.) сохранены для backward compat

Detail page response также включает `aggregate` object для быстрого чтения без client-side агрегации.

### 2.4 Backend — manual Part 1 scoring endpoints

`mock-exam-tutor-api`:
- `POST /attempts/:id/part1-manual-score` body `{kim_number, earned_score}` — upsert в `mock_exam_attempt_part1_answers` с `student_answer=null`. Ownership + status guard (нельзя править на `approved`/`manually_entered`/`in_progress`).
- `POST /attempts/:id/part1-finalize` — пересчёт `total_part1_score = SUM(earned_score)` → UPDATE attempt.

Дополнительно: `handleGetAttempt` теперь возвращает полный список `part1_answers` (все KIM Часть 1 из variant'а, не только те где есть row в `mock_exam_attempt_part1_answers`) — frontend нужен полный список для manual scoring inputs. Form-mode case полностью совместим (там все rows всё равно создаются submit handler'ом).

### 2.5 Frontend — list page (`TutorMockExams.tsx`)

- Null-safe чтение всех `attempts_*` полей через `?? 0`
- Приоритет: новые backend поля → fallback на client-side subtract → 0
- KPI «Сдали» теперь показывает `attempts_completed_total` (включает submitted)
- KPI «Требует проверки» = `attempts_pending_review`

### 2.6 Frontend — detail page (`TutorMockExamDetail.tsx`)

- `deriveKpi` использует `detail.aggregate` если есть (backward-compat fallback на client-side count)
- KPI label «Сдали» = `completedTotal`, «Требует AI-проверки» → переименован в «Требует проверки» с семантикой `awaitingReview` (submitted+ai_checking+awaiting_review)
- `DetailHeader` показывает **answer_method aggregate** badge: «Способы: Бланк 2 · Цифровой 1» вместо `MODE_LABEL[detail.mode]` («С бланком»). assignment.mode label убран потому что после TASK-10 ученик сам выбирает.

### 2.7 Frontend — review page (`TutorMockExamReview.tsx`)

Новый `Part1BlankReviewPanel` компонент — рендерится когда `attempt.answer_method === 'blank'`:
- Photo ФИПИ-бланка (`blank_photo_url`) и fallback Часть 1 (`part1_blank_photo_url`) — клик открывает в новой вкладке
- 20 (или сколько Part 1 KIMs в variant'е) `<Input type="number">` inputs «KIM N / max» для tutor manual entry
- Auto-save per row через `setMockExamPart1ManualScore` на `onBlur`
- Live draft sum + saved sum
- Button «Часть 1 проверена» → `finalizeMockExamPart1` → invalidates query

Form mode unchanged — рендерит существующий `Part1SummaryCard` (auto-check display).

### 2.8 Frontend — tutor invite UI (`TutorMockExamCreate.tsx`)

Шаг 2 «Режим прохождения» скрыт. Default `mode='form'` (нейтральный для backend). Ученик решает на taking page через TASK-10 `AnswerMethodSelectModal`.

## 3. Acceptance Criteria

- **AC-T11-1 (stats):** На list page assignment с одним submitted attempt и одним notStarted показывает «Сдали 1/2», «В процессе 0», «Не приступали 1», «Требует проверки 1». Никаких NaN. На detail — те же значения.
- **AC-T11-2 (invite links):** `/tutor/mock-exams/:id` секция «Публичные ссылки» рендерит:
  - empty state «Пока ни одной публичной ссылки» при `query.success && items=[]`
  - existing list при `query.success && items.length > 0`
  - red banner только при `query.error`
- **AC-T11-3 (blank-mode review):** Открыть `/tutor/mock-exams/:id/review/:studentId` для ученика в blank mode. Видно:
  - photo ФИПИ-бланка
  - 20 input полей KIM 1..20 (или столько сколько в variant'е) с placeholder'ом
  - При вводе балла → toast «KIM X сохранён» (или silent success); refetch invalidates attempt
  - Button «Часть 1 проверена» → toast «Часть 1 пересчитана: N баллов»
- **AC-T11-4 (form-mode review backward compat):** Для ученика в form mode `Part1SummaryCard` рендерится как раньше с auto-check данными.
- **AC-T11-5 (submit blank validation):** ученик в blank mode без `blank_photo_url` И без `part1_blank_photo_url` пытается submit → 400 NO_BLANK_PHOTO «В режиме бланка нужно загрузить хотя бы одно фото».
- **AC-T11-6 (tutor create UI):** Шаг 2 «Режим прохождения» в `/tutor/mock-exams/create` не виден.
- **AC-T11-7 (DetailHeader badge):** detail page header показывает «Способы: Бланк N · Цифровой M · Не выбрали K» вместо «С бланком» / «Форма».

## 4. Out of scope (deferred)

- AI OCR ФИПИ-бланка → auto Part 1 (Phase 3)
- Drop `mock_exam_assignments.mode` column (breaking change, отдельная миграция)
- Full anonymous lead flow на taking page (TASK-12 anonymous mode spec)
- Tutor review surface для bulk Part 2 photos / part1_blank_photo_url gallery (показать рядом с per-task — desirable, не блокирует пилот)
- `mock-exam-grade` (Part 2 AI grader) integration с blank mode — текущая логика подхватит per-task Part 2 photos независимо от answer_method

## 5. Files (landed)

| File | Type | Change |
|---|---|---|
| `supabase/migrations/20260514140000_invite_links_service_role_grant.sql` | NEW | GRANTs `service_role` на все 8 mock-exam таблиц |
| `supabase/functions/mock-exam-student-api/index.ts` | MODIFY | submit handler answer_method gate + NO_BLANK_PHOTO validation |
| `supabase/functions/mock-exam-tutor-api/index.ts` | MODIFY | KPI new fields, full part1_answers list, `/part1-manual-score` + `/part1-finalize` endpoints, extended attempt fields |
| `src/types/mockExam.ts` | MODIFY | `attempts_in_progress` / `attempts_completed_total` / `attempts_pending_review`; `MockExamAttemptListItem.answer_method`; `MockExamAttemptDetail.answer_method` / `part1_blank_photo_url` / `part2_bulk_photo_urls`; `MockExamAssignmentDetail.aggregate` |
| `src/lib/mockExamApi.ts` | MODIFY | `setMockExamPart1ManualScore` + `finalizeMockExamPart1` API functions |
| `src/pages/tutor/mock-exams/TutorMockExams.tsx` | MODIFY | null-safe stats + new KPI labels («Сдали» = completed_total) |
| `src/pages/tutor/mock-exams/TutorMockExamDetail.tsx` | MODIFY | new KPI semantics через `detail.aggregate`; answer_method aggregate badge в DetailHeader |
| `src/pages/tutor/mock-exams/TutorMockExamReview.tsx` | MODIFY | `Part1BlankReviewPanel` компонент; conditional render по `attempt.answer_method` |
| `src/pages/tutor/mock-exams/TutorMockExamCreate.tsx` | MODIFY | Шаг 2 «Режим прохождения» скрыт; default `mode='form'` |
| `docs/delivery/features/mock-exams-v1-pilot-polish/tutor-bugs-fix-spec.md` | NEW | этот документ |

## 6. Verification

Plan-driven:

1. **Lovable Cloud applies миграции** ~1-2 минуты после push.
2. **SQL проверка GRANT:**
   ```sql
   SELECT grantee, table_name, privilege_type
   FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND grantee = 'service_role'
     AND table_name LIKE 'mock_exam_%'
   ORDER BY table_name, privilege_type;
   -- Expected: 32 rows (8 tables × 4 privileges).
   ```
3. **Bug 2 fix:** `/tutor/mock-exams/:id` секция «Публичные ссылки» → empty state ИЛИ список, **не** red banner при empty.
4. **Bug 1 fix:** На assignment с 1 submitted attempt: «Сдали: 1/2», «В процессе: 0», «Требует проверки: 1». Никаких NaN.
5. **Bug 3 fix:**
   - blank mode ученик: видно фото бланка + 20 input полей; ввод балла → silent save → refetch; «Часть 1 проверена» → toast с суммой
   - form mode ученик: auto-check display unchanged
6. **Tutor invite create:** Шаг 2 «Режим прохождения» не виден; create POST использует `mode='form'`
7. **Production deploy:** `deploy-sokratai` на VPS после Lovable preview verification.

## 7. Rollback

- Frontend: `git revert <commit> && deploy-sokratai` (~3 мин)
- Backend edge functions: Lovable Studio → rollback to previous deployment
- Migration `20260514140000`: idempotent GRANT, не требует rollback. Никаких destructive changes.
