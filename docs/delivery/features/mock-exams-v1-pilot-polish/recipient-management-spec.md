# Mock Exams v1 — Recipient Management (TASK-17)

**Status:** Implementation landed
**Created:** 2026-05-17
**Trigger:** Egor's screenshot showing 3 duplicate "Пробник Тренировочный 1" rows because there was no UX to add students to an existing assignment + no UX to remove invalid students.

## Section 0 — Job Context

**Core Job (Egor):** «Хочу управлять списком учеников в существующем пробнике, а не плодить дубликаты». Cited example: «по ошибке влепил пробник 9-класснику — надо чтоб убрать можно было».

Solves 3 connected UX gaps:
1. No way to add students to existing assignment → tutor creates duplicates
2. No way to remove single student from assignment → list cluttered with mistakes
3. No way to delete entire assignment → mock-exams lacked parity with homework

## Section 1 — Acceptance Criteria

### AC-T17-1: Add students to existing assignment

- **AC-T17-1a** Frontend `AddStudentsToMockExamDialog` через header button «+ Добавить учеников» в `TutorMockExamDetail`. Button disabled при:
  - `mode === 'manual_entry'` (single-student backfill — нечего добавлять)
  - `status === 'closed'`
  - `variant_id IS NULL`
  - Tooltip explains why each case.
- **AC-T17-1b** Picker — reuse `HWAssignSection` (groups + individuals + locked existing). Already-assigned ученики lock'нуты в picker.
- **AC-T17-1c** Footer: checkbox «Отправить уведомление сейчас (push + Telegram)» default ON + amber chip если deadline прошёл.
- **AC-T17-1d** Backend `POST /assignments/:id/assign-students` body `{student_ids, notify}`:
  - Idempotent: skip уже-assigned (returns `skipped_existing` count)
  - INSERT `mock_exam_attempts` per new student (`status='in_progress'`, `started_at=null`)
  - If notify=true → parallel push + telegram cascade per student
  - Response: `{added, skipped_existing, deadline_passed, notify: {sent_push, sent_telegram, failed, failed_no_channel}}`
- **AC-T17-1e** On success → toast with counts + invalidate detail/list queries. Amber warning toast если deadline passed.

### AC-T17-2: Delete entire assignment

- **AC-T17-2a** `DeleteMockExamDialog` доступен через 2 entry points:
  - List-card (`TutorMockExams`): «⋮» dropdown → «Удалить пробник» (red text)
  - Detail header (`TutorMockExamDetail`): «⋮» dropdown справа от «+ Добавить учеников»
- **AC-T17-2b** Context-aware AlertDialog copy зависит от attempts severity:
  - `approvedCount > 0` → **red** «У N учеников подтверждённые работы. Их баллы пропадут навсегда»
  - `submittedCount + inProgressCount > 0` → **amber** «N учеников сдали/решают. Все данные пропадут»
  - else → neutral «Удалить пустой пробник?»
- **AC-T17-2c** Destructive button color match severity (red/amber/slate). «Никогда не блокировать» (Vladimir UX choice — strong confirmation вместо hard block).
- **AC-T17-2d** Backend `DELETE /assignments/:id`:
  - Cascade FK: attempts + part1_answers + part2_solutions + public_links
  - Best-effort storage cleanup (blank_photo, part2_bulk_photos) — non-fatal
- **AC-T17-2e** On success → toast + invalidate list + remove cached detail + (если из detail) navigate('/tutor/mock-exams').

### AC-T17-3: Remove individual student

- **AC-T17-3a** `RemoveStudentFromMockExamDialog` доступен через ✕ icon в sticky name column of `MockExamHeatmap` row. Visibility:
  - Mobile (< md): always visible (touch target ≥32px)
  - Desktop (md+): hover-revealed (`opacity-0 group-hover:opacity-100`)
- **AC-T17-3b** Context-aware copy зависит от `attempt.status`:
  - `not_started` (in_progress + started_at=null) → neutral «потерь нет»
  - `in_progress` (started_at != null) → amber «прогресс пропадёт»
  - `submitted/ai_checking/awaiting_review` → red «работа и AI-черновик пропадут»
  - `approved/manually_entered` → red strong + score «({N} баллов) пропадут навсегда»
- **AC-T17-3c** Backend `DELETE /attempts/:id`:
  - Ownership через assignment.tutor_id
  - Cascade FK: part1_answers + part2_solutions
  - Best-effort storage cleanup для этого attempt'а
- **AC-T17-3d** On success → toast + invalidate detail query.

## Section 2 — Files

### Backend (1 file modified)
| File | Change |
|---|---|
| `supabase/functions/mock-exam-tutor-api/index.ts` | + `notifyStudentAssigned` cascade helper (push → telegram) + `handleAssignStudents` + `handleDeleteAssignment` + `handleDeleteAttempt` + 3 route registrations |

### Frontend (5 NEW + 4 MODIFY)
| File | Type | Change |
|---|---|---|
| `src/components/tutor/mock-exams/AddStudentsToMockExamDialog.tsx` | NEW | Wraps HWAssignSection + notify checkbox + deadline warning |
| `src/components/tutor/mock-exams/DeleteMockExamDialog.tsx` | NEW | AlertDialog с context-aware copy (3 severity levels) |
| `src/components/tutor/mock-exams/RemoveStudentFromMockExamDialog.tsx` | NEW | AlertDialog с context-aware copy по `attempt.status` |
| `src/lib/mockExamApi.ts` | MODIFY | + `assignMockExamStudents` + `deleteMockExamAssignment` + `deleteMockExamAttempt` |
| `src/components/tutor/mock-exams/MockExamHeatmap.tsx` | MODIFY | + optional `onRemoveAttempt` prop, ✕ icon в sticky name column (mobile always, desktop hover) |
| `src/pages/tutor/mock-exams/TutorMockExamDetail.tsx` | MODIFY | Header actions (+ Добавить + ⋮ dropdown), dialog mounts, heatmap onRemoveAttempt wiring |
| `src/pages/tutor/mock-exams/TutorMockExams.tsx` | MODIFY | List-card ⋮ dropdown (Открыть / Удалить), local delete dialog with synthetic attempts from counters |

## Section 3 — Hard invariants (don't break)

1. **Notify scope locked at push + telegram only.** No email in this iteration (Vladimir UX choice). При расширении на email — добавить case в `notifyStudentAssigned` cascade + transactional template `mock-exam-notification.ts` mirror `homework-notification.ts`.
2. **Backend status guard локализован в frontend AlertDialog.** Vladimir выбрал «никогда не блокировать» — backend выполняет cascade на любом status'е. UI обязан confirmation для submitted/approved (severity copy в `DeleteMockExamDialog` + `RemoveStudentFromMockExamDialog`).
3. **Idempotent assign — skip уже-assigned silently.** `handleAssignStudents` фильтрует existing student_ids перед INSERT. Не error — graceful skip с counter в response.
4. **Storage cleanup best-effort, non-fatal.** Если `db.storage.remove()` падает — лог warning + продолжаем response. Orphan blobs могут остаться (по дизайну — лучше orphan blob чем broken delete на UI).
5. **`mock_exam_attempts.assignment_id` FK с `ON DELETE CASCADE`** обеспечивает атомарный cleanup на DELETE assignment (см. migration `20260508120000_mock_exams_v1_schema.sql`). Не менять без re-think delete flow.
6. **Add button disabled на closed/manual_entry/no_variant — UI-level guard.** Backend тоже возвращает 409/400 (defense-in-depth), но primary UX через disabled state + tooltip.

## Section 4 — Verification

| Scenario | Expected |
|---|---|
| Add 3 учеников в active form-mode пробник + notify=true | 3 INSERTs + push/telegram sent + toast «Добавлено 3 · уведомлено 3» |
| Add ученика уже-assigned + 2 новых | Toast «Добавлено 2 · пропущено 1 уже назначены» |
| Add ученика с deadline 5 дней назад | Add работает + amber toast «Дедлайн прошёл 5 дней назад» |
| Add на closed пробник через DevTools direct call | 409 ASSIGNMENT_CLOSED (frontend disable защищает обычный flow) |
| Delete пробник с 3 approved attempts | Red AlertDialog «3 ученика — баллы пропадут» → confirm → cascade |
| Delete пустой пробник | Neutral dialog «Удалить пустой пробник?» |
| Remove single approved attempt (через ✕ icon) | Red dialog «{name}: подтверждённый результат пропадёт» |
| Remove not-started attempt | Neutral «потерь нет» |
| Mobile ✕ icon видна без hover | Touch target ≥32px |
| `npm run build` | ✅ green |
| `npm run smoke-check` | ✅ green |

## Section 5 — Out of scope (deferred)

- **Email cascade leg** в `notifyStudentAssigned` — push/telegram only для пилот. Если станет нужно — mirror `homework-notification.ts` template + add case в cascade.
- **Merge two assignments** action (combine duplicates) — не нужно: с новым «+ Добавить учеников» tutor не будет создавать дубликаты впервые.
- **Bulk-remove students** через checkbox selection в heatmap — Phase 2. Текущий flow: one-at-a-time через ✕ icon.
- **Auto-archive vs hard delete** (status='deleted' vs cascade) — Vladimir выбрал hard delete для пилот scale. Soft archive — Phase 2 если будут регрессы.
- **Push subscription onboarding для учеников без него** — failed_no_channel counter exposed в response, но UI не показывает «X учеников без канала — пришли invite». Phase 2 nice-to-have.

## Section 6 — Rollback

- Backend handlers → Lovable Studio → rollback prior deployment (handlers удалятся, routes 404)
- Frontend → `git revert <hash> && deploy-sokratai`
- Никаких schema migrations в TASK-17 — все changes на code level. FK cascade в `mock_exam_attempts.assignment_id` уже был с TASK-1 (`20260508120000_mock_exams_v1_schema.sql`)

## Section 7 — Egor's cleanup plan (after deploy)

1. Egor открывает `/tutor/mock-exams` (Lovable preview, после deploy)
2. На Row 2 (invalid student) нажимает «⋮» → «Удалить пробник» → red dialog «N учеников решают/сдали…» → confirm → удалится с cascade
3. Если Row 3 (4 учеников, 3 approved) — оставить как есть, это «боевая» строка
4. Для Row 1 (1 ученик): открыть → «+ Добавить учеников» → выбрать новых учеников → save с notify=true
5. Going forward: при необходимости добавить ученика — через «+ Добавить учеников» в шапке, не создавать новый пробник

Никакой SQL cleanup от Vladimir не нужен — Egor справится через новый UI.
