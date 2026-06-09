# SPEC: Баланс ученика — Phase 2 (учёт занятий и оплат)

> Pipeline step 4 (SPEC). Автор: Vladimir × Claude · 2026-06-09
> PRD: `docs/delivery/features/scheduling-payments-balance/prd.md` · Макет: `docs/discovery/prototypes/student-card-balance-mockup.html`
> Деньги-инварианты: rule 60 + новый money-инвариант (PRD §3.7). Единицы: **рубли (integer), без копеек** (PRD §3.8).
>
> **Changelog:**
> - **v6 (2026-06-09)** — re-review CONDITIONAL PASS (3 находки закрыты), 1 P2: `_sync_lesson_debit` — убрана ветка reverse при `amount<=0` (теперь pure no-op `RETURN NULL`); reverse живёт ТОЛЬКО в `_reverse_lesson_debit` (delete/revert/future edit). Делает инвариант «re-complete-to-0 НЕ реверсит» **структурным** (не зависит от callsite-гейта `IF amount>0`). Single-responsibility helper. Миграция `20260609120500` (CREATE OR REPLACE). Поведение текущих callsite не меняется (всегда `amount>0`).
> - **v5 (2026-06-09)** — устранён TASK-3 Codex-ревью (3 находки): **P0** — `_sync_lesson_debit` само-сериализуется `pg_advisory_xact_lock(lesson,student)` + RAISE на conflict-mismatch (никогда silent NULL), не полагается на caller-сериализацию (хотя сейчас payment-row-lock уже сериализует); **P1** — `tutor_id` derived из `tutor_students` (authoritative) + validate переданного + RAISE `STUDENT_TUTOR_MISMATCH` (rule 40); **P1** — re-complete-to-0 на существующем debit НЕ авто-реверсит (мирроринг frozen payment-поведения — payment-row тоже не сносится; undo = delete/revert или edit-списание из Parking Lot). Фикс через новую `CREATE OR REPLACE`-миграцию `20260609120400` (push→Lovable мог уже применить `…120100`).
> - **v4 (2026-06-09)** — устранён 3-й ревью (v3=CONDITIONAL PASS, 3 spec-детали): seed one-shot guard через **marker-таблицу `tutor_ledger_seed_runs`** (P0; не полагаться на note/created_by); RLS/ownership через существующий **`owns_tutor_student`** (`resolve_tutor_pk` не существует, P1); **покрыть ВСЕ активные payment-write сайты** через `_sync_lesson_debit` — подтверждён 2-й путь `update_group_participant_payment_status` (P1, rule-40 dual-write-path).
> - **v3 (2026-06-09)** — устранены находки 2-го ревью (v2=FAIL). **Сдвиг механизма: debit пишется АДДИТИВНО внутри `complete_lesson_and_create_payment` + reverse в `tutor_delete_lessons`/`tutor_revert_lesson`; триггеры на `tutor_payments` УБРАНЫ.** Это снимает P0-A (legacy manual insert), P1-C (ON CONFLICT DO UPDATE), P1-D (нет tutor_id на tutor_payments) естественно + forward-compatible (в 2b убираем из complete только запись в `tutor_payments`, оставляя ledger-debit — без throwaway-bridge). Также: `created_by` nullable + COALESCE (P0-B), balance защищён guarded BEFORE-UPDATE trigger (P0-3), amount `ROUND::int` (tutor_payments.amount = NUMERIC), reverse no-op-safe (P1-5), soft-cancel не реверсит (P1-6).
> - v2 — закрыла математику v1 (seed=−долг P0-1, balance=Σ всех signed P0-2). v1=FAIL.
>
> **Решение архитектуры v3 (Vladimir 2026-06-09):** extend-RPC, НЕ триггеры. Аддитивное изменение rule-10-замороженной `complete_lesson_and_create_payment` авторизовано — чисто аддитивно (payment-поведение не меняется), это денежный чокпоинт by design.
>
> **Разбивка:** Phase 2 большая (L) → полностью специфицируется **Phase 2a**; 2b/2c/2d — кратко (конец).

---

## Section 0: Job Context

- **Core Job**: R4 — контроль + не утопать в рутине при масштабировании (ветка «деньги/админ»).
- **Sub-jobs (2a)**: «знать, кто сколько должен» · «зафиксировать полученные деньги (одно число)» · «не терять долги».
- **Segment**: B2B репетиторы физики ЕГЭ/ОГЭ (пилот); платит родитель офлайн, репетитор ведёт учёт. Сократ не проводит платежи.
- **Wedge alignment**: НЕ wedge — retention/anti-churn. Узкий личный учёт, не CRM.
- **Pilot impact**: убирает ручной подсчёт «сколько за период» + одно число долга.

---

## Summary

Кошелёк ученика: `баланс = Σ пополнения − Σ списания` (рубли). **Phase 2a — аддитивный слой**: ledger живёт параллельно `tutor_payments` (его НЕ ломаем).

**Механизм (v3):**
- **Списание (debit)** создаётся **внутри `complete_lesson_and_create_payment`** (аддитивно, после payment-upsert): идемпотентно, с ФИНАЛЬНОЙ суммой, `tutor_id` derived из `tutor_students`. Все пути завершения (web/group/bulk/Telegram) идут через эту RPC → покрытие гарантировано без триггеров и без N callsites.
- **Reverse** debit'а — внутри `tutor_delete_lessons`/`tutor_revert_lesson` (когда они сносят оплату), no-op-safe.
- **Пополнение (credit)** — RPC `tutor_record_topup` (одно число).
- **Balance** = `Σ(signed)` по ВСЕМ записям (reversed-оригинал + offsetting сокращаются в 0); поддерживается AFTER-INSERT-триггером на ledger; защищён от прямой записи guarded BEFORE-UPDATE-триггером на `tutor_students`.

`tutor_payments` в баланс НЕ агрегируется (баланс = только ledger). Legacy «Оплаты»/`/pay`-бот/ручной `createTutorPayment` — не трогаем; ручная оплата без `lesson_id` debit НЕ создаёт (не идёт через complete-RPC). Полный cutover (заморозка `tutor_payments`, авто-debit cron, отчёт родителю) — 2b+.

**Forward-compat:** в 2b из `complete_lesson_and_create_payment` убирается только запись в `tutor_payments` (остаётся ledger-debit). Никакого bridge на снос.

---

## Problem
(PRD §2.) Ручной подсчёт за период + «оплачено/не оплачено по занятию» = боль. Егор: «хочу одно число, чтобы кто-то посчитал за меня».

---

## Solution

### In scope (2a)
Аддитивный ledger + баланс (рубли); seed = текущий долг; debit внутри complete-RPC; reverse в delete/revert-RPC; пополнение (credit); reverse/edit; отображение «Обзор»/«Оплаты». `tutor_payments`/`/pay`/«Оплаты»/manual createTutorPayment — НЕ трогаем.

### Out of scope (2a → 2b+)
Заморозка `tutor_payments`; reframe «Оплаты»/`/pay` на баланс; авто-debit cron + сводка; отчёт родителю; абонемент; посещаемость; процессинг.

---

## Acceptance Criteria (testable)

- **AC-1 (seed = долг, не выручка):** per-row: debit на каждое историческое `tutor_payments` (`ROUND(amount)::int`, `source_kind='lesson'`, `source_lesson_id`) + credit на каждое `paid` (`source_kind='adjustment'`, note `'seed: оплачено (история)'`, `created_by=NULL`). Итог `balance = −Σ(amount WHERE status IN ('pending','overdue'))`. Ученик только-paid → **0**. One-shot guard через **marker-таблицу `tutor_ledger_seed_runs(tutor_student_id PK)`** (НЕ по note/created_by — seed-debit неотличим, `source_kind='lesson'`).
- **AC-2 (пополнение):** «Внести оплату» 5000 → `credit, amount=5000, source_kind='topup'`; `balance += 5000`; `tutor_payments` не изменён.
- **AC-3 (debit внутри complete + идемпотентность + финальная сумма):** Завершение занятия ЛЮБЫМ путём (web grid / PostLessonSheet / group actions / bulk-confirm / Telegram — ВСЕ через `complete_lesson_and_create_payment`) → ровно ОДИН active lesson-debit (`source_kind='lesson', source_lesson_id`, amount = ФИНАЛЬНАЯ сумма payment после `ON CONFLICT DO UPDATE`). Повтор с той же суммой → no-op. Повтор с ДРУГОЙ суммой → debit обновлён (reverse old + new) на финальную. `balance −= amount`. **Конкурентность (P0):** `_sync_lesson_debit` само-сериализуется `pg_advisory_xact_lock(lesson,student)`; при conflict-with-different-amount → RAISE (`LEDGER_DEBIT_RACE`), не silent NULL. **`_sync_lesson_debit` с amount<=0 → pure no-op (НЕ реверсит, v6)** — реверс живёт ТОЛЬКО в `_reverse_lesson_debit` (delete/revert/future edit-списание). Инвариант «re-complete-to-0 НЕ реверсит» — структурный (мирроринг frozen payment: payment-row тоже остаётся). amount=0 first-time → debit не создаётся (корректно).
- **AC-4 (balance = Σ ВСЕХ signed):** `balance == Σ(credit.amount) − Σ(debit.amount)` по ВСЕМ записям (reversed-оригиналы + offsetting включены; reverse 1500 → −1500 + (+1500) = 0). `recompute_student_balance` совпадает.
- **AC-5 (reverse append-only):** reverse → offsetting (`reverses_entry_id=orig`) + оригинал помечен `reversed_by_entry_id`; баланс корректируется INSERT-триггером; partial-unique освобождён; оригинал НЕ удалён.
- **AC-6 (редактируемое списание, decoupled от посещаемости):** правка суммы → reverse old + new debit; balance = новая; нет поля «был/не был».
- **AC-7 (отображение):** «Обзор» карточка: баланс(±,цвет)==`balance`; «Внести оплату»(primary) + «Отчёт родителю»(disabled до 2c) + «Все операции →»(на «Оплаты»).
- **AC-8 (единицы):** рубли integer; нет `*100`; нет `_cents` в ledger; legacy `tutor_payments.amount` (NUMERIC) → `ROUND(...)::int` при записи в ledger.
- **AC-9 (RLS/ownership):** запись ledger ТОЛЬКО SECURITY DEFINER (complete/delete/revert/topup/reverse RPC); `authenticated` SELECT свой, **REVOKE INSERT/UPDATE/DELETE**. Чужой `tutor_student_id` → отказ. `tutor_id` в ledger derived из `tutor_students` (НЕ из `tutor_payments` — там его нет) + validate lesson↔tutor.
- **AC-10 (прямой UPDATE balance запрещён — P0-3):** Клиентский `UPDATE tutor_students SET balance=…` → **отказ** guarded BEFORE-UPDATE-триггером (balance меняется только в ledger-контексте). Прочие колонки (`notes`, `parent_contact`, `hourly_rate_cents`, `display_name`, `gender`, `target_score`, …) правятся как раньше — table-level UPDATE не урезан (нет enumeration-риска).
- **AC-11 (delete/cancel reverses — P1-6):** `tutor_delete_lessons`/`tutor_revert_lesson` (сносят pending/overdue оплату, rule 60) → внутри RPC reverse active lesson-debit (no-op-safe); balance корректируется; нет orphaned debit. **Soft `cancelLesson` (status→cancelled, оплату НЕ сносит) — debit НЕ реверсит** (заряд стоит; снять = edit→0 или delete) — задокументировано.
- **AC-12 (double-reverse идемпотентен — P1-5):** повторный reverse → no-op (`FOR UPDATE` + guard `reversed_by_entry_id IS NULL` + unique `reverses_entry_id`); вставка offsetting через `ON CONFLICT DO NOTHING` → НЕ роняет вызвавший RPC (delete не падает на unique).
- **AC-13 (created_by-safe — P0-B):** debit/reverse из complete/delete-RPC при service-role/Telegram (нет `auth.uid()`) и seed (миграция, нет user) пишутся БЕЗ NOT NULL violation: `created_by` **nullable**, `= COALESCE(auth.uid(), tutors.user_id)` в RPC; `NULL` в seed.
- **AC-14 (группа = один debit на участника):** групповое завершение (N оплат участникам в complete-RPC) → N active lesson-debit; идемпотентно.
- **AC-15 (покрыты ВСЕ payment-write сайты — P1/rule-40):** grep активных функций, вставляющих `tutor_payments` с `lesson_id` (`complete_lesson_and_create_payment`, `update_group_participant_payment_status`, …) — каждая зовёт `_sync_lesson_debit`; ни один lesson-payment-INSERT не минует ledger. Тест: создать/изменить оплату участника через `update_group_participant_payment_status` → debit создан/обновлён (а не только через complete).

---

## Requirements (P0 / P1)

**P0:**
- **R-P0-1**: Миграция ledger — `tutor_ledger_entries` (рубли int; `created_by` **nullable**; `reverses_entry_id`/`reversed_by_entry_id`) + `tutor_students.balance` + AFTER-INSERT balance-maintenance trigger + **guarded BEFORE-UPDATE trigger** (защита balance, AC-10) + partial-unique (active lesson-debit) + unique (one-reversal) + RLS SELECT + REVOKE write.
- **R-P0-2**: **Покрыть ВСЕ активные payment-write сайты (с `lesson_id`) через `_sync_lesson_debit`** (rule-40 dual-write-path) — НЕ только `complete_lesson_and_create_payment`. Подтверждённые сайты: (1) `complete_lesson_and_create_payment`; (2) **`update_group_participant_payment_status`** (INSERT `tutor_payments` ~стр.235 миграции `20260224220000`). **Перед билдом грепнуть `INSERT INTO ...tutor_payments` по активным функциям** (старые перекрыты `CREATE OR REPLACE`) и подключить каждую. Helper `_sync_lesson_debit(lesson, student, tutor, amount, actor)` (CREATE OR REPLACE, аддитивно, после payment-upsert): нет → insert; есть с другой суммой → reverse+new; та же → no-op; `tutor_id` derived. + **расширить `tutor_delete_lessons`/`tutor_revert_lesson`** — reverse debit при сносе оплаты (no-op-safe). Покрывает AC-3/11/13/14/15.
- **R-P0-3**: Seed per-row (debit на всё + credit на paid, `created_by=NULL`, `ROUND::int`) → opening = −долг; one-shot guard через **marker-таблицу `tutor_ledger_seed_runs`** (AC-1).
- **R-P0-4**: RPC `tutor_record_topup` + `tutor_reverse_ledger_entry` (race-guarded helper, реюзится delete/revert/UI) + UI «Внести оплату».
- **R-P0-5**: Баланс на «Обзор» — карточка + «Внести оплату».

**P1:**
- **R-P1-1**: «Оплаты» → лента операций + «ближайшие списания».
- **R-P1-2**: Редактируемая сумма списания (reverse+new) + reverse/undo пополнения в UI.
- **R-P1-3**: «Должники» = `balance < 0`.

---

## Technical Design

### Migration 1 — `tutor_ledger_entries` (рубли)
```
id                   uuid PK default gen_random_uuid()
tutor_id             uuid NOT NULL          -- → tutors.id (PK). DERIVED из tutor_students (tutor_payments его НЕ имеет!)
tutor_student_id     uuid NOT NULL          -- → tutor_students.id
kind                 text NOT NULL CHECK (kind IN ('debit','credit'))
amount               integer NOT NULL CHECK (amount > 0)   -- РУБЛИ
occurred_on          date NOT NULL
source_kind          text NOT NULL CHECK (source_kind IN ('lesson','topup','adjustment'))
source_lesson_id     uuid NULL              -- → tutor_lessons(id) ON DELETE SET NULL
reverses_entry_id    uuid NULL              -- на offsetting: что сторнирует
reversed_by_entry_id uuid NULL              -- на оригинале: чем сторнирован
note                 text NULL
created_by           uuid NULL              -- NULLABLE (seed/service-role/Telegram); = COALESCE(auth.uid(), tutors.user_id) в RPC
created_at           timestamptz NOT NULL default now()
```
- Balance = `Σ(CASE kind WHEN 'credit' THEN +amount ELSE -amount END)` по ВСЕМ. `reversed_by_entry_id` — только idempotency/UI.
- `UNIQUE (source_lesson_id, tutor_student_id) WHERE source_kind='lesson' AND kind='debit' AND reversed_by_entry_id IS NULL` (один active lesson-debit).
- `UNIQUE (reverses_entry_id) WHERE reverses_entry_id IS NOT NULL` (один реверс на оригинал).
- Индекс `(tutor_student_id, created_at DESC)`.
- RLS SELECT `owns_tutor_student(tutor_student_id)` (реюз существующего helper — как у `tutor_payments`; `resolve_tutor_pk` НЕ существует, не выдумывать); **REVOKE INSERT/UPDATE/DELETE FROM authenticated**.

### Migration 2 — balance + защита (AC-10)
- `ALTER TABLE tutor_students ADD COLUMN balance integer NOT NULL DEFAULT 0;`
- **Guarded BEFORE-UPDATE trigger** на `tutor_students`: `IF NEW.balance IS DISTINCT FROM OLD.balance AND current_setting('app.ledger_op', true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'balance is ledger-managed';`. Прямой клиентский UPDATE balance → reject. **Не урезаем table-level UPDATE** (нет enumeration-риска — прочие колонки правятся как раньше).

### Migration 3 — balance-maintenance trigger
`AFTER INSERT ON tutor_ledger_entries FOR EACH ROW`: `PERFORM set_config('app.ledger_op','on',true); UPDATE tutor_students SET balance = balance + (CASE WHEN NEW.kind='credit' THEN NEW.amount ELSE -NEW.amount END) WHERE id = NEW.tutor_student_id;` (GUC разрешает guarded-trigger; transaction-local). + `recompute_student_balance(_id)` read-only (nightly reconcile).

### Migration 4 — расширение RPC (CREATE OR REPLACE, аддитивно)
- **`complete_lesson_and_create_payment`**: сохранить ВСЮ существующую логику payment-upsert (rule 10 — поведение оплат не меняется) + в конце вызвать `_sync_lesson_debit(_lesson_id, _tutor_student_id, _tutor_id, _amount := <финальная сумма payment>, _actor := COALESCE(auth.uid(), <tutors.user_id>))`. `_tutor_id` derived из `tutor_students`. Идемпотентно + amount-aware (AC-3/P1-C).
- **`tutor_delete_lessons` / `tutor_revert_lesson`**: перед/после сноса pending/overdue оплат — `_reverse_lesson_debit(lesson, student)` (no-op если нет active debit; offsetting через `ON CONFLICT DO NOTHING`, AC-11/12).
- Helper'ы `_sync_lesson_debit` / `_reverse_lesson_debit` (SECURITY DEFINER) — единственная точка записи lesson-debit. `_sync_lesson_debit`: `pg_advisory_xact_lock(lesson,student)` (само-сериализация, P0) → derive+validate `tutor_id` из `tutor_students` (`STUDENT_TUTOR_MISMATCH`, rule 40) → idempotent+amount-aware → conflict-mismatch RAISE (не silent NULL); amount<=0 → no-op (reverse ТОЛЬКО `_reverse_lesson_debit`, v6).

### RPC (клиентские, SECURITY DEFINER, ownership через tutors.id, REVOKE/GRANT, rule-97 ошибки)
- `tutor_record_topup(_tutor_student_id, _amount int, _occurred_on date, _note text) → uuid` — credit `topup`; `created_by=auth.uid()`.
- `tutor_reverse_ledger_entry(_entry_id, _note) → uuid` — `FOR UPDATE` + guard + offsetting (`ON CONFLICT DO NOTHING`). Реюзится `_reverse_lesson_debit` + UI.
- `tutor_edit_lesson_debit(_entry_id, _new_amount)` [P1] — reverse+new.

### Migration 5 — seed (one-shot, marker-guarded)
- Marker: `CREATE TABLE tutor_ledger_seed_runs (tutor_student_id uuid PRIMARY KEY REFERENCES tutor_students(id) ON DELETE CASCADE, seeded_at timestamptz NOT NULL default now());`
- Per-row из `tutor_payments` для учеников **НЕ в маркере**: debit на каждую строку (`ROUND(amount)::int`, `source_kind='lesson'`, `source_lesson_id`, `tutor_id` derived, `created_by=NULL`) + credit на каждую `paid` (`source_kind='adjustment'`, `created_by=NULL`); затем INSERT строки в `tutor_ledger_seed_runs`. Net = −Σ(pending+overdue) (AC-1). Пишет в ledger напрямую. Рубли 1:1, нет `*100`.
- **Guard: marker-таблица** (НЕ note/created_by — seed-debit неотличим от live, `source_kind='lesson'`). Re-run миграции → ученики уже в маркере → skip.

### Frontend
- `src/lib/tutorBalanceApi.ts`: `recordTopup`, `reverseLedgerEntry`, `editLessonDebit`[P1], `listLedger(studentId)` (рубли); RPC через supabase.rpc + rule-97. Новый RPC → `types.ts` Functions.
- Query keys (perf §2c): `['tutor','balance',sid]`/`['tutor','ledger',sid]`; инвалидация при topup/reverse/complete/delete. `refetchOnWindowFocus:false`.
- **`StudentBalanceCard`** на «Обзор» (вкладка `progress`): баланс(±), «Внести оплату»(primary), «Отчёт родителю»(disabled), «Все операции →».
- **«Внести оплату»** sheet — поле ₽(16px) + дата → `recordTopup`.
- [P1] `LedgerFeed` на «Оплаты»; должники `balance<0`.

### Money-инварианты
balance=Σ всех signed; debit только через `_sync_lesson_debit` (в complete-RPC), reverse только через `_reverse_lesson_debit`/RPC; идемпотентность (partial-unique) + one-reversal; прямой UPDATE balance запрещён (guarded trigger); append-only; seed=−долг, рубли int, нет `*100`; ownership tutors.id; `created_by` nullable + COALESCE.

---

## UX principles (docs 16/17)
Один primary CTA; прогрессивное раскрытие (сводка/детали); надёжность>эффектность (нет outbound, правки обратимы, баланс детерминирован); без эмодзи (Lucide), socrat-токены, ₽, 16px. Legacy «отметить оплаченным» НЕ операция баланса; «Все операции» → ledger-лента, не старая `TutorPayments` (P1-7).

---

## Validation
- `npm run lint` → `build` → `smoke-check`.
- **SQL-гейты:** AC-1 (`balance==−долг`; только-paid→0); AC-4 (`balance==recompute`; после reverse=0); seed дважды→без изменений; complete дважды (та же сумма)→один debit; complete с другой суммой→debit=новая (P1-C); delete оплаты→debit реверснут (AC-11); reverse дважды→idempotent, delete не падает (AC-12); группа→N debit (AC-14); прямой `UPDATE balance`→reject (AC-10); seed/Telegram complete (no auth.uid)→без NOT NULL violation (AC-13); concurrent re-complete с разными суммами→ровно один active debit финальной суммы (P0 advisory-lock, прогон параллельно); `_sync` с tutor_id ≠ владельца ученика→`STUDENT_TUTOR_MISMATCH` (P1).
- **Manual QA** (`/tutor/students/:id`): seed==реальность; пополнение 5000→+5000; завершить (web/group/bulk)→−цена, повтор→ок; отменить/удалить занятие→возврат; soft-cancel completed→заряд стоит; править сумму→пересчёт; копеек нет; Safari/iOS.
- Регрессия (2a аддитивна): `tutor_payments`/«Оплаты»/`/pay`/payment-поведение complete-RPC/конфетти — без изменений.

---

## Risks
- **Money-correctness (highest):** seed=−долг (AC-1); идемпотентность+amount-aware debit (AC-3); balance=Σ всех; прямой UPDATE закрыт guarded-trigger. Митигация: partial-unique, helper-чокпоинт, nightly recompute, SQL-гейты, прогон дважды.
- **rule 10/60 — аддитивное изменение `complete_lesson_and_create_payment`** (замороженная money-RPC). Осознанно (Vladimir 2026-06-09): чисто аддитивно (payment-upsert и возврат не меняются — только append ledger-debit), это денежный чокпоинт, **forward-compatible** (в 2b убираем лишь payment-write). **Review-флаг:** проверить, что существующая логика оплат/группы/возврата сохранена дословно.
- **Транзиторная дуальность** (legacy paid/pending vs balance): legacy «отметить оплаченным» не влияет на balance/не операция; «Все операции» → ledger; полный отказ = 2b. Коммуникация Егору.
- **Guarded-trigger GUC** (`app.ledger_op`): клиент не может выставить set_config в одном UPDATE-запросе через PostgREST → защита держится. Проверить в QA (AC-10).
- **Не вносят пополнения** → дрейф. Митигация: 1 тап; мерить.

---

## Implementation Tasks (краткий план)
1. Migration 1–3 (ledger + balance + balance-maintenance trigger + guarded-trigger + helpers-skeleton) — DB.
2. Migration 4 (extend ВСЕ активные payment-write RPC через `_sync_lesson_debit` — `complete_lesson_and_create_payment` + `update_group_participant_payment_status` + grep остальных; delete/revert через `_reverse_lesson_debit`) — DB.
3. Migration 5 (marker `tutor_ledger_seed_runs` + seed per-row) — DB.
4. RPC topup + reverse + `types.ts` + REVOKE/GRANT — DB.
5. `tutorBalanceApi.ts` + `StudentBalanceCard` + «Внести оплату» sheet — frontend (P0-4/5).
6. [P1] `LedgerFeed` + editable списание + должники.

Детальная нарезка + промпты → `tasks.md` (step 5).

---

## Parking Lot
- Авто-debit cron + ежедневная сводка — **2b**.
- Cutover: убрать payment-write из `complete_lesson_and_create_payment` (оставить ledger-debit), заморозить `tutor_payments`, reframe «Оплаты»/`/pay` — **2b**.
- Редактируемая сумма списания прямо в PostLessonSheet — P1/2b.
- Edit-списание / обнуление (mark-absent) на УЖЕ завершённом занятии — undo заряда без delete (re-complete-to-0 в 2a не реверсит, мирроринг frozen payment); пока undo = delete/revert. — P1/2b.
- Отчёт родителю (`/p/:slug`) — **2c**.
- Абонемент (`covered_by_subscription_id`) — **3**.
- Посещаемость + авто-% за пропуск — отдельный раунд.
- **Доковая неточность:** rule 40 утверждает `tutor_payments.tutor_id → tutors.id`, но колонки нет (базовая `20260201183517`). Поправить rule 40 — отдельной правкой.

---

## Later phases (scope + условие старта)
- **2b — Cutover + авто-debit + сводка.** Из `complete_lesson_and_create_payment` убрать payment-write (оставить ledger-debit), заморозить `tutor_payments` (read-only), авто-debit cron (окно start+dur+3ч) + ежедневная сводка + undo; reframe «Оплаты»/`/pay` на баланс. **Старт:** 2a стабильна + Егор подтвердил совпадение баланса.
- **2c — Отчёт родителю.** Один read-only (прогресс lite R2 + баланс) по share-ссылке (реюз `/p/:slug`, column-whitelist, anti-leak). **Старт:** баланс верен.
- **2d/3 — Абонемент.** Объект расписания + авто-списание идемпотентно по `period_key` + флаг «покрыто». **Старт:** по запросу репетитора.
