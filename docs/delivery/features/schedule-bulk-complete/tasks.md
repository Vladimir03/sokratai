# Tasks: Подтверждение прошедших занятий (schedule-bulk-complete)

**Дата:** 2026-06-02 · **SPEC:** `spec.md` (v1.0). Паттерн: Claude Code (plan mode) → lint/build/smoke → Codex (чистая сессия) → fix → merge → deploy-sokratai.

## Деплой-порядок
Backend (TASK-A) первым; затем frontend (TASK-B); после фронт-правок — `deploy-sokratai` (rule 95).

---

## TASK-A (P0): Backend — атомарное подтверждение
- **Job:** R4 · **AC:** AC-2, AC-3, AC-4, AC-5
- **Files:** RPC/миграция или `supabase/functions/*` (решить в plan mode), reuse `complete_lesson_and_create_payment`.
- Атомарное подтверждение занятия (индивид: amount; группа: per-participant `payment_amount`, >0 → payment) + bulk-обёртка. Idempotency `(lesson_id, tutor_student_id)`. Ownership через `tutors.id`; только `booked` + `regular`.

## TASK-B (P0): Frontend — баннер + sheet
- **Job:** R4 · **AC:** AC-1, AC-2, AC-3, AC-4, AC-6
- **Files:** новые компоненты `src/components/tutor/schedule/*`, `src/pages/tutor/TutorSchedule.tsx` (минимально: баннер+entry+state), reuse `LessonMaterialsDrawer`.
- Дерив списка клиентом; sheet (индивид + группа); «Подтвердить все»; «не состоялось»; связка с материалами.

## TASK-C: Верификация
- Codex (чистая сессия) + ручная QA (Safari/iOS, деньги/идемпотентность, откат, окно 3ч/14д, расписание не сломано).

---

## Copy-paste промпты

### CC-A — Backend (TASK-A)
```
Роль: senior product-minded full-stack engineer в SokratAI (Supabase/Deno). Reuse > rewrite. Финансовая логика — высокий риск.

Контекст: фича schedule-bulk-complete — bulk-подтверждение прошедших занятий «проведено» (презумпция + подтверждение). Создаём backend для атомарного подтверждения с редактируемыми суммами и групповой посещаемостью.

Прочитай: docs/delivery/features/schedule-bulk-complete/spec.md; .claude/rules/60-telegram-bot.md (оплаты: идемпотентность (lesson_id, tutor_student_id), pending/paid, дата=start_at), 10-safe-change-policy.md, 97-edge-function-error-contract.md; миграцию с complete_lesson_and_create_payment (group-aware) + tutor_lesson_participants; src/lib/tutorSchedule.ts (completeLessonAndCreatePayment), src/lib/tutorScheduleGroupCreate.ts (calculateLessonPaymentAmount, getLessonParticipants).

Задача (plan mode сначала):
1. Атомарное подтверждение ОДНОГО занятия с суммами:
   - индивид: status='completed' + tutor_payments(pending, amount) — reuse/extend complete_lesson_and_create_payment.
   - группа (unified, student_id IS NULL, участники в tutor_lesson_participants): per-participant суммы → participants.payment_amount → payments только для amount>0 (≤0 → пропуск) → status='completed'. ВСЁ в одной транзакции.
   - Решить: новый RPC tutor_confirm_lesson(p_lesson_id, p_payload) vs extend существующего. Идемпотентность участника (повтор не дублирует payments).
2. Bulk-обёртка для «Подтвердить все»: один вызов на массив занятий, per-lesson результат (ok/skip/error), без partial-corruption (каждое занятие атомарно).
3. Ownership: tutor_lessons.tutor_id → tutors.id (resolveTutorPkId-паттерн). Только status='booked' + lesson_type='regular'; иначе отклонять.
4. Edge → verify_jwt=true, flat {error,code} (rule 97), config.toml + deploy workflow (rule 96 #11) + drift-check. Чистый RPC → REVOKE/GRANT как у hw_tutor_* RPC.

AC: AC-2/AC-3/AC-4. Деньги создаются ТОЛЬКО этим вызовом. «Не состоялось» — reuse cancelLesson, не в этом RPC.

Guardrails: НЕ менять поведение complete_lesson_and_create_payment для текущего 3-кнопочного flow; идемпотентность; без overdue; дата=start_at; не логировать суммы/PII; без новых npm-deps.

Mandatory end block: изменённые файлы; summary; lint/build/smoke-check (+drift если edge); self-check против AC + rule 60/10/97; docs обновить; deploy-напоминание.
```

### CC-B — Frontend (TASK-B)
```
Роль: senior product-minded full-stack engineer в SokratAI. Reuse > rewrite. Backend подтверждения готов (CC-A).

Контекст: баннер «Прошедшие занятия (N) — подтвердите» на /tutor/schedule + sheet подтверждения. TutorSchedule.tsx — HIGH-RISK (rule 10).

Прочитай: docs/delivery/features/schedule-bulk-complete/spec.md; .claude/rules/10, 60, 80, 90, 97; src/pages/tutor/TutorSchedule.tsx (LessonDetailsDialog, handleCompleteLesson, useTutorLessons, LessonMaterialsDrawer entry), src/lib/tutorScheduleGroupCreate.ts (getLessonParticipants, calculateLessonPaymentAmount), src/components/ui/sheet.tsx.

Задача (plan mode):
1. Дерив списка клиентом (useMemo, без нового запроса): booked + regular + (start_at+duration_min)+3ч < now + start_at > now−14д.
2. Баннер вверху Расписания «Прошедшие занятия (N) — подтвердите» + «Позже». React.memo.
3. Sheet (Radix): индивид-строка [✓ проведено]·ученик·время·[сумма editable 16px, дефолт=calculateLessonPaymentAmount]·[не состоялось]; групповая — getLessonParticipants → по участнику [✓ был]·имя·[сумма editable], снял «был» → 0. Один primary CTA «Подтвердить все» → CC-A bulk; «не состоялось» → cancelLesson.
4. После успеха — non-blocking «Приложить записи?» → LessonMaterialsDrawer (reuse).
5. TutorSchedule.tsx — МИНИМАЛЬНО: баннер + state + sheet. 3-кнопочный flow и handleCompleteLesson НЕ трогать (coexist, rule 10).

AC: AC-1/2/3/4/6. До «Подтвердить» — ноль изменений в БД. Деньги показываем /100 (formatCurrency).

Guardrails: rule 10 (минимум в TutorSchedule); rule 80 (16px, touch-action, без Array.at); rule 90 (один primary CTA, Lucide без эмодзи, socrat); performance (React.memo, lazy, нет framer-motion).

Mandatory end block: изменённые файлы; summary; lint/build/smoke-check; self-check против AC + rule 10/60/80/90; БЛОК «🚀 Deploy needed».
```

### CODEX-REVIEW (TASK-C, чистая сессия) — scoped к CC-A+CC-B
```
Ты — независимый ревьюер SokratAI. Контекст автора недоступен. Дотошно и скептично, особенно к ФИНАНСАМ.

СКОУП — ревьюй ТОЛЬКО эти файлы (вся фича schedule-bulk-complete = CC-A backend + CC-B frontend):
- supabase/migrations/20260602150000_schedule_bulk_complete_rpcs.sql   (CC-A, уже в main — `git show 594d197`)
- src/lib/scheduleBulkComplete.ts                                       (CC-B)
- src/components/tutor/schedule/PastLessonsConfirmBanner.tsx            (CC-B)
- src/components/tutor/schedule/ConfirmLessonsSheet.tsx                 (CC-B)
- src/pages/tutor/TutorSchedule.tsx — ТОЛЬКО diff `+import PastLessonsConfirmBanner` + 1 строка `<PastLessonsConfirmBanner .../>`
НЕ ревьюй connectivity-banner рефакторинг (~12 tutor-файлов: TutorDataStatus/TutorHome/TutorPayments/TutorStudents/… и connectivity-изменения В ТОМ ЖЕ TutorSchedule.tsx) и mock-exams — это чужой параллельный WIP, НЕ часть этой фичи. Если правка не в списке выше — игнорируй.

Порядок: 1) docs/.../tutor-ai-agents/16,17 (UX/UI); 2) docs/delivery/features/schedule-bulk-complete/spec.md (§7 AC, §8); 3) .claude/rules/10,60,80,90,97; 4) diff перечисленных файлов.

Проверь конкретно (PASS/FAIL):
- ФИНАНСЫ (критично):
  • tutor_payments создаётся ТОЛЬКО через RPC `tutor_confirm_lessons` (на «Подтвердить»); в CC-B нигде раньше/молча (AC-4)?
  • Идемпотентность: reuse `complete_lesson_and_create_payment` (ON CONFLICT (lesson_id, tutor_student_id)) — повтор не дублирует? `tutor_confirm_lessons` повторно на уже-completed → skip (guard status='booked')?
  • Группа: «был» amount>0 → payment; «не был» amount=0 → RPC пропускает (НЕТ payment)? edited суммы (UPDATE tutor_lesson_participants.payment_amount) применяются ПЕРЕД complete?
  • Атомарность: per-lesson BEGIN…EXCEPTION (savepoint) — ошибка одного занятия не валит остальные и не оставляет partial?
  • `complete_lesson_and_create_payment` НЕ изменён (только reuse)?
  • amount = РУБЛИ (integer), НЕ копейки — нет двойного /100; `formatCurrency(rubles)` корректно?
- No-show / отмена: группа «не был» дефолт 0 (не переплата); «не состоялось» → `cancelLesson` (cancelled, 0 платежей — до создания оплаты).
- Откат (AC-5): `tutor_revert_lesson` удаляет ТОЛЬКО pending (paid сохраняет + флаг had_paid); status→cancelled; guard ownership+status='completed'. (UI-кнопка отката в CC-B сознательно не вешается — RPC готов; это ок по spec, не FAIL.)
- Окно (AC-6): баннер-запрос status='booked' + lesson_type='regular' + start_at ≥ now−14д + клиентский фильтр +3ч буфер; trial/mock/consultation и старое не попадают. RPC дополнительно отклоняет не-booked/не-regular → skipped.
- RPC (НЕ edge): SECURITY DEFINER + SET search_path; REVOKE ALL FROM PUBLIC + GRANT authenticated,service_role; ownership ВНУТРИ по auth.uid(); RAISE EXCEPTION коды (INVALID_PAYLOAD / NOT_OWNED_OR_NOT_COMPLETED). Клиент `scheduleBulkComplete.ts` парсит error.message (rule 97-стиль) — пользователь не видит «HTTP …».
- rule 10: diff TutorSchedule.tsx ОТ АВТОРА = только import + 1 mount-строка; complete/cancel/create-логику автор не трогал.
- rule 60: pending/paid, без overdue, дата платежа = CURRENT_DATE (базовая RPC).
- Safari rule 80: 16px суммовые inputs, touch-action:manipulation, parseISO (нет Array.at/lookbehind/structuredClone), числовой `new Date(ms)`. Design rule 90: один primary CTA «Подтвердить все», Lucide без эмодзи, socrat/accent (+amber статус = waiver), reuse Alert. Performance: React.memo (banner/sheet) + lazy sheet, нет framer-motion.
- Anti-leak/scope creep: CC-B запрос tutor_lessons — column-list нужное, RLS-scoped по tutor_id; не тащит лишнего.
- AC §7 (AC-1..AC-6): каждый PASS/FAIL.

Формат: PASS / CONDITIONAL PASS / FAIL + нумерованные находки (blocker / major / minor) с файл:строка и предложением фикса.
```

---

## Definition of Done
1. Job linkage ✓ (R4) 2. Spec ✓ 3. CC-A+CC-B impl 4. Codex review 5. Feedback fixed 6. No payment/schedule regression 7. AC §7 pass 8. deploy-sokratai + ручная QA.
