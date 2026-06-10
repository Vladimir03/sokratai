# TASKS: Баланс ученика — Phase 2a

> Pipeline step 5. SPEC: `spec.md` v6 (4 раунда ревью закрыты). Автор: Vladimir × Claude · 2026-06-09
>
> **СТАТУС (2026-06-10): TASK-1 ✅ (`3f1f706`) · TASK-2+4 ✅ (`b2d670b`) · TASK-3 ✅ (`f26ab22` + ревью-фиксы `11f961f`/`2de12fa`) · TASK-5 ✅ (`39213ce`) · TASK-6 ✅ (`7000807`/`cb84f9b`, spec v7) · фикс «два долга» ✅ (`3a787c4`) · ChatGPT-5.5 frontend-ревью FAIL→закрыт ✅ (`bf18e98`, spec v8: paid-гейт отмены, error-гейт фетча, parseRubleAmount, invalidateBalanceCaches). 6 миграций `20260609*` применены Lovable, seed-гейт 0 строк ✓. Осталось: Lovable применяет `20260610120000` → `deploy-sokratai` (весь фронт) → QA.**
> Единицы: рубли integer. Деньги: миграции локально НЕ прогоняются → строим аккуратными чанками + SQL-гейты на проде/staging.
> Порядок: TASK-1 (фундамент, NEW) → TASK-2 (helpers+RPC, NEW) → TASK-4 (seed, NEW) → **TASK-3 (вшивание в money-RPC — репродукция замороженного, делать осторожно, отдельным проходом + Codex)** → TASK-5/6 (фронт).

## Задачи

### TASK-1 — Migration: ledger + balance + триггеры (DB) · AC-4/9/10
**Files**: `supabase/migrations/2026060912xxxx_student_balance_ledger.sql`
- `tutor_ledger_entries` (рубли; `reverses_entry_id`/`reversed_by_entry_id`; `created_by` nullable) + 3 индекса (active lesson-debit partial-unique, one-reversal unique, feed).
- `tutor_students.balance integer NOT NULL DEFAULT 0`.
- RLS SELECT `owns_tutor_student(tutor_student_id)` + REVOKE INSERT/UPDATE/DELETE.
- balance-maintenance AFTER-INSERT trigger (GUC `app.ledger_op` + atomic +delta).
- guarded BEFORE-UPDATE trigger на `tutor_students` (reject прямой balance, AC-10).
- `recompute_student_balance(uuid)` (service_role, nightly reconcile, AC-4).
**Только NEW-код, без репродукции RPC. Низкий риск.**

### TASK-2 — Helpers + client RPC (DB) · AC-2/5/12/13
**Files**: `…_balance_ledger_rpcs.sql`, `src/integrations/supabase/types.ts`
- `_sync_lesson_debit(_lesson_id, _tutor_student_id, _tutor_id, _amount int, _actor uuid)` — SECURITY DEFINER: нет active debit → insert; есть с другой суммой → reverse+new; та же → no-op. `tutor_id` derive, `amount`=ROUND::int.
- `_reverse_lesson_debit(_lesson_id, _tutor_student_id)` — no-op-safe (offsetting `ON CONFLICT DO NOTHING`).
- `tutor_record_topup(_tutor_student_id, _amount int, _occurred_on date, _note text)` — credit, `created_by=auth.uid()`, ownership.
- `tutor_reverse_ledger_entry(_entry_id, _note)` — `FOR UPDATE` + guard `reversed_by_entry_id IS NULL` + offsetting (one-reversal unique).
- REVOKE ALL FROM PUBLIC + GRANT authenticated (topup/reverse) / service_role; helpers — internal.
- `types.ts` Functions: новые client-RPC (`Args`).

### TASK-4 — Seed (DB) · AC-1
**Files**: `…_balance_seed.sql`
- Marker `tutor_ledger_seed_runs(tutor_student_id uuid PK, seeded_at timestamptz)`.
- Per-row: для учеников НЕ в маркере — debit на каждую `tutor_payments` (`ROUND::int`, `source_kind='lesson'`, `source_lesson_id`, derive `tutor_id`, `created_by=NULL`) + credit на каждую `paid` (`source_kind='adjustment'`) → INSERT marker. Net = −Σ(pending+overdue).

### TASK-3 — Вшить ledger в money-RPC (DB) · AC-3/11/14/15 · ⚠️ репродукция замороженного (rule 10)
**Files**: `…_wire_lesson_debits.sql`
- **Грепнуть ВСЕ активные функции с `INSERT INTO tutor_payments` (lesson_id)** — старые перекрыты `CREATE OR REPLACE`, взять последние определения.
- `CREATE OR REPLACE complete_lesson_and_create_payment` — **тело дословно** + `PERFORM _sync_lesson_debit(...)` после каждого payment-upsert (group loop по участнику + individual), `_amount`=финальная сумма, `_actor=COALESCE(auth.uid(), tutors.user_id)`.
- `CREATE OR REPLACE update_group_participant_payment_status` — то же при insert/amount-change.
- `tutor_delete_lessons` / `tutor_revert_lesson` — `PERFORM _reverse_lesson_debit(...)` при сносе оплаты.
- **Codex review обязателен** (сохранность payment-поведения).

### TASK-5 — Frontend: баланс на «Обзор» (FE) · AC-7 · P0-5
**Files**: `src/lib/tutorBalanceApi.ts`, `src/components/tutor/StudentBalanceCard.tsx`, `src/pages/tutor/TutorStudentProfile.tsx`
- `tutorBalanceApi` (recordTopup/reverse/listLedger; рубли; rule-97). Query keys `['tutor','balance',sid]`/`['tutor','ledger',sid]`, `refetchOnWindowFocus:false`.
- `StudentBalanceCard` на вкладке «Обзор» (баланс ±, «Внести оплату» primary, «Отчёт родителю» disabled, «Все операции →»).
- «Внести оплату» sheet (одно поле ₽ 16px + дата).
- **🚀 Deploy needed** (frontend).

### TASK-7 — Phase 2c «Отчёт родителю» ✅ (2026-06-10) · AC-20..23 · spec v9
**Files**: `supabase/migrations/20260610140000_student_report_links.sql`, `supabase/functions/_shared/student-progress-build.ts` (verbatim-вынос R2-агрегата), `supabase/functions/tutor-progress-api/index.ts` (тонкая обёртка), `supabase/functions/public-student-report/index.ts`, `config.toml`+workflow, `src/lib/publicReportApi.ts`, `src/pages/PublicStudentReport.tsx`, `src/App.tsx` (`/p/report/:slug`), `src/components/tutor/students/{ParentReportDialog,StudentBalanceCard}.tsx`, `types.ts`.
- Share-ссылка (bearer-slug) + отзыв; публичный отчёт: прогресс lite (single source с тутор-вью) + баланс + выписка без note; anti-leak remap (без uuid/avatar/комментариев).

### TASK-6 — Лента операций + правка записей + должники ✅ (2026-06-10) · AC-16..19 · spec v7
**Files**: `supabase/migrations/20260610120000_ledger_edit_topup.sql`, `src/lib/tutorBalanceApi.ts`, `src/components/tutor/students/{TopupDialog,LedgerFeed,StudentBalanceCard}.tsx`, `src/pages/tutor/TutorPayments.tsx`, `types.ts`
- `replaces_entry_id` + атомарная `tutor_edit_topup` (reverse+new, только topup-credit).
- `LedgerFeed` (collapse «исправлено»/«отменено» + история) на карточке баланса («Все операции») + быстрый Pencil у последнего пополнения.
- Правка списаний — ТОЛЬКО через занятие: re-complete (individual) / hint (группа) / `tutor_revert_lesson` (отмена); занятие удалено → plain reverse.
- «Должники по балансу» на «Оплатах» (balance<0 из `useTutorStudents`) + «Внести» → общий `TopupDialog`.

## Validation (каждая DB-задача)
`npm run lint && npm run build && npm run smoke-check` (фронт/греп) + SQL-гейты на staging/проде (AC-1/3/4/10/11/12/14). Деплой: миграции — Lovable на push; фронт — `deploy-sokratai`.

---

## Copy-paste промпты для агентов

```
TASK-1 — Миграция ledger+balance+триггеры (Claude Code)
Роль: senior product-minded full-stack engineer, проект SokratAI.
Контекст: денежная фича «баланс ученика», Phase 2a. Деньги = highest risk. Единицы — РУБЛИ integer, без копеек.
Читать: docs/delivery/features/scheduling-payments-balance/spec.md (v4, Technical Design Migration 1–3 + AC-4/9/10), .claude/rules/60 (деньги), .claude/rules/40 (FK-drift, column-GRANT), tutor_payments RLS (owns_tutor_student).
Задача: написать ОДНУ миграцию: (1) tutor_ledger_entries (рубли; reverses_entry_id/reversed_by_entry_id; created_by NULLABLE) + partial-unique active lesson-debit + unique one-reversal + feed-индекс; (2) tutor_students.balance integer NOT NULL DEFAULT 0; (3) RLS SELECT owns_tutor_student + REVOKE INSERT/UPDATE/DELETE; (4) AFTER-INSERT balance-maintenance trigger (set_config app.ledger_op + atomic +delta); (5) guarded BEFORE-UPDATE trigger на tutor_students (RAISE если balance изменён вне app.ledger_op='on'); (6) recompute_student_balance(uuid) SECURITY DEFINER service_role.
AC: AC-4 (balance=Σ всех signed; recompute совпадает), AC-9 (REVOKE; SELECT свой), AC-10 (прямой UPDATE balance → RAISE).
Guardrails: только NEW-код (НЕ трогать существующие RPC); рубли integer (нет _cents/*100); SECURITY DEFINER + search_path=public; idemпотентно (IF NOT EXISTS). Без Safari/frontend.
В конце: changed files · summary · валидация · какие AC покрыты · что осталось (TASK-2/3/4).
```

```
TASK-3 — Вшить ledger-debit в money-RPC (Claude Code) — ОСТОРОЖНО (rule 10)
Роль: senior engineer, SokratAI. Контекст: вшить идемпотентный ledger-debit во ВСЕ активные payment-write пути (extend-RPC, НЕ триггеры).
Читать: spec.md v4 (Migration 4 + AC-3/11/14/15), rule 60 (complete_lesson_and_create_payment), rule 10. Грепнуть `INSERT INTO ...tutor_payments` по миграциям → взять ПОСЛЕДНИЕ CREATE OR REPLACE определения complete_lesson_and_create_payment + update_group_participant_payment_status.
Задача: CREATE OR REPLACE обеих функций — ВОСПРОИЗВЕСТИ тело ДОСЛОВНО + PERFORM _sync_lesson_debit(lesson, student, tutor, финальная_сумма, COALESCE(auth.uid(), tutors.user_id)) после каждого payment-upsert (group loop по участнику + individual). Расширить SELECT, чтобы получить tutors.user_id. + tutor_delete_lessons/tutor_revert_lesson: PERFORM _reverse_lesson_debit при сносе оплаты.
AC: AC-3 (один active debit финальной суммы, идемпотентно), AC-14 (группа = N debit), AC-11 (delete/revert reverse), AC-15 (ВСЕ payment-write сайты покрыты — грепом подтвердить).
Guardrails: payment-поведение/RETURN/группу НЕ менять (только append _sync_lesson_debit); рубли; rule 10. ОБЯЗАТЕЛЬНО Codex review дельты на сохранность.
В конце: changed files · grep-список покрытых payment-write сайтов · AC · риски.
```
