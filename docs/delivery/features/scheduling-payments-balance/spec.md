# SPEC: Баланс ученика — Phase 2 (учёт занятий и оплат)

> Pipeline step 4 (SPEC). Автор: Vladimir × Claude · 2026-06-09
> PRD: `docs/delivery/features/scheduling-payments-balance/prd.md` · Макет: `docs/discovery/prototypes/student-card-balance-mockup.html`
> Деньги-инварианты: rule 60 + новый money-инвариант (PRD §3.7). Единицы: **рубли (integer), без копеек** (PRD §3.8).
>
> **Changelog:** **v2 (2026-06-09)** — устранены находки независимого ревью (вердикт v1 = FAIL): seed-формула (P0-1), reverse↔balance (P0-2), прямой UPDATE balance (P0-3), покрытие всех complete-paths (P0-4), double-reverse race (P1-5), delete/cancel reverse (P1-6→P0), legacy mark-paid (P1-7), +6 money-AC. Ключевой сдвиг дизайна: списание создаётся **триггером на `tutor_payments`** (единый чокпоинт), а не app-mirror'ом.
>
> **Разбивка (правило pipeline «фича большая»):** Phase 2 трогает DB+backend+frontend+bot (L). Полностью специфицируется **Phase 2a** (аддитивный баланс). **2b/2c/2d** — краткий scope + условие старта (конец файла).

---

## Section 0: Job Context

- **Core Job**: R4 — сохранять контроль и не утопать в рутине при масштабировании (ветка «деньги/админ»).
- **Sub-jobs (2a)**: «знать, кто мне сколько должен» · «зафиксировать полученные деньги (одно число)» · «не терять долги по забывчивости».
- **Segment**: B2B, репетиторы физики ЕГЭ/ОГЭ (платный пилот); платит родитель офлайн, репетитор ведёт учёт. Сократ не проводит платежи.
- **Wedge alignment**: НЕ wedge — retention/anti-churn supporting job. Узкий срез личного учёта, не CRM.
- **Pilot impact**: убирает ручной подсчёт «сколько должен за период» + даёт одно число долга → репетитор не бросает на деньгах.

---

## Summary

Кошелёк ученика: `баланс = Σ пополнения − Σ списания` (рубли). **Phase 2a — аддитивный слой**: ledger живёт параллельно `tutor_payments` (его НЕ ломаем). Списание создаётся **триггером на INSERT строки `tutor_payments`** (= цена занятия), реверсится триггером на DELETE; пополнение — отдельной записью (credit). Баланс сидируется из истории как **текущий долг** и показывается на вкладке «Обзор» + «Оплаты». Полный cutover (заморозка `tutor_payments`, авто-debit cron, reframe `/pay`, отчёт родителю) — Phase 2b+.

**Инвариант баланса (v2):** `balance = Σ(amount·знак) по ВСЕМ записям ledger ученика` (включая reversed-оригиналы И их offsetting-записи — они сокращаются в 0). `reversed_by_entry_id` НЕ влияет на баланс — только на идемпотентность-индекс и подсветку в UI.

**Ключевой механизм (v2):** `ledger lesson-debit ⟷ строка tutor_payments 1:1` через триггеры (INSERT → создать debit идемпотентно; DELETE → reverse). Это единый чокпоинт: покрывает ВСЕ пути завершения (individual/group/bulk) и delete/cancel без правки ядра `complete_lesson_and_create_payment` (rule 10). Credits = пополнения (+ исторические paid как seed-credits).

---

## Problem

(подробно PRD §2.) «Оплачено/не оплачено по занятию» + ручной подсчёт за период = боль. Егор: «хочу одно число и чтобы кто-то посчитал за меня». Нет баланса, дроби, группы stale, посещаемость смешана с оплатой.

---

## Solution

### In scope (Phase 2a)
Аддитивный ledger + баланс (рубли), seed = текущий долг, debit-через-триггер при создании/удалении `tutor_payments`, пополнение (credit), reverse/edit, отображение на «Обзор»/«Оплаты». **`tutor_payments`, `/pay`-бот, страница «Оплаты», ядро complete-RPC — НЕ трогаем.** Баланс = только Σ ledger.

### Out of scope (2a → это 2b+)
Заморозка `tutor_payments`; reframe «Оплаты»/`/pay` на баланс; авто-debit cron + ежедневная сводка; отчёт родителю; абонемент; посещаемость; платёжный процессинг.

---

## Acceptance Criteria (testable)

- **AC-1 (seed = текущий долг, НЕ выручка):** Seed per-row: на каждое историческое `tutor_payments` → ledger `debit` (`source_kind='lesson'`, `source_lesson_id`, `amount`); на каждое `status='paid'` → ledger `credit` (`source_kind='adjustment'`, note `'seed: оплачено (история)'`). Итог: `balance = Σpaid_credit − Σall_debit = −Σ(amount WHERE status IN ('pending','overdue'))`. **Ученик с ТОЛЬКО оплаченной историей → balance = 0** (не `+Σpaid`). Один прогон (guard: skip если у ученика уже есть seed-записи). SQL: `balance == −(долг из tutor_payments)`.
- **AC-2 (пополнение):** «Внести оплату» 5000 ₽ → `credit, amount=5000, source_kind='topup'`; `tutor_students.balance += 5000`; `tutor_payments` не изменён. Видно в ленте.
- **AC-3 (debit при создании оплаты + идемпотентность):** Завершение занятия ЛЮБЫМ путём (grid 3-кнопки / PostLessonSheet / групповые actions / bulk-confirm) создаёт строку `tutor_payments` → триггер `AFTER INSERT` создаёт ровно ОДИН active `debit` (`source_kind='lesson', source_lesson_id`, amount=сумма оплаты). Повторная вставка оплаты на (занятие, ученик) НЕ создаёт второй active debit (partial-unique). `balance −= amount`.
- **AC-4 (balance = Σ ВСЕХ signed):** `tutor_students.balance == Σ(credit.amount) − Σ(debit.amount)` по ВСЕМ записям ученика (включая reversed-оригиналы и offsetting). После reverse debit (1500): оригинал (−1500, помечен reversed) + offsetting credit (+1500) = 0. Nightly `recompute_student_balance` совпадает.
- **AC-5 (reverse):** Reverse записи → вставляется offsetting-запись (противоположный kind, `reverses_entry_id=orig`), оригинал помечается `reversed_by_entry_id=offset`, баланс корректируется через INSERT-триггер offsetting'а, partial-unique освобождён (можно создать новый lesson-debit), оригинал НЕ удаляется (append-only).
- **AC-6 (редактируемое списание, decoupled от посещаемости):** Изменение суммы списания → reverse старого debit + новый debit с новой суммой; balance = новая сумма; обе записи в ленте. Нет поля «был/не был» — сумма правится свободно (Егор: «вписать в окошко»).
- **AC-7 (отображение):** «Обзор» карточка-сводка: баланс (±, цвет) == `tutor_students.balance`; «Внести оплату» (primary) + «Отчёт родителю» (disabled до 2c) + «Все операции →» (на «Оплаты»).
- **AC-8 (единицы):** Рубли integer везде; нет `*100`; grep — ни одного нового `_cents` в ledger-коде.
- **AC-9 (RLS/ownership):** Запись в `tutor_ledger_entries` — ТОЛЬКО через SECURITY DEFINER (RPC пополнения/reverse + триггеры); `authenticated` имеет SELECT (свой), но **REVOKE INSERT/UPDATE/DELETE**. Чужой `tutor_student_id` в RPC → отказ (ownership через `tutors.id`, rule 40).
- **AC-10 (прямой UPDATE balance запрещён — P0-3):** Клиентский `UPDATE tutor_students SET balance=… ` через PostgREST → **отказ** (column-level GRANT исключает `balance`). Balance меняется ТОЛЬКО balance-триггером от ledger-вставок.
- **AC-11 (delete/cancel reverses debit — P1-6):** Удаление/отмена занятия, при которой удаляется строка `tutor_payments` (`tutor_delete_lessons`/`tutor_revert_lesson` сносят pending/overdue, rule 60) → триггер `AFTER DELETE` reverse'ит active lesson-debit этого занятия; balance корректируется; **нет orphaned active debit** с NULL-занятием. (Paid не удаляются — debit остаётся, верно.)
- **AC-12 (double-reverse идемпотентен — P1-5):** Повторный reverse уже реверснутой записи → отказ/no-op (`SELECT … FOR UPDATE` + guard `reversed_by_entry_id IS NULL` + unique «один реверс на оригинал»); balance не меняется второй раз.
- **AC-13 (все complete-callsites покрыты — P0-4):** grep всех вызовов `completeLessonAndCreatePayment` / `complete_lesson_and_create_payment` → каждый создаёт строку `tutor_payments` → debit гарантирован триггером. Тест: ни один путь завершения не пишет оплату в обход `tutor_payments`.
- **AC-14 (группа = один debit на участника — P0-4/group):** Завершение группового занятия (N оплат участникам) → N active lesson-debit (по одному на участника), не один на группу; идемпотентно.

---

## Requirements (P0 / P1)

**P0 (Must-Have):**
- **R-P0-1**: Миграция ledger — `tutor_ledger_entries` (рубли; `reversed_by_entry_id`/`reverses_entry_id`) + `tutor_students.balance` + AFTER-INSERT balance-trigger + partial-unique идемпотентность + RLS SELECT + **REVOKE write на ledger** + **column-GRANT UPDATE на tutor_students без `balance`** (AC-10).
- **R-P0-2**: Триггеры-чокпоинт на `tutor_payments`: `AFTER INSERT` → идемпотентный lesson-debit; `AFTER DELETE` → reverse. SECURITY DEFINER. Покрывает все complete + delete пути (AC-3/11/13/14).
- **R-P0-3**: Seed-миграция per-row (debit на всё + credit на paid) → opening = −долг; guard one-shot (AC-1).
- **R-P0-4**: RPC `tutor_record_topup` (пополнение) + `tutor_reverse_ledger_entry` (race-guarded) + UI «Внести оплату» (одно поле ₽ + дата) из карточки «Обзор».
- **R-P0-5**: Баланс на «Обзор» — карточка-сводка (read) + кнопка «Внести оплату».

**P1 (Nice-to-Have, fast-follow):**
- **R-P1-1**: «Оплаты» → лента операций (списания/пополнения, даты, ссылка на занятие) + «ближайшие списания».
- **R-P1-2**: Редактируемая сумма списания (reverse+new) + reverse/undo пополнения в UI.
- **R-P1-3**: «Должники» = отрицательный баланс (read-only).

> P0=5, P1=3. Если R-P0-2 (триггеры) при имплементации потребует доработки idempotency для групп — выделить в подзадачу, но не дробить фазу.

---

## Technical Design

### Модель данных (миграции, additive, РУБЛИ)

**Migration 1 — `tutor_ledger_entries`:**
```
id                 uuid PK default gen_random_uuid()
tutor_id           uuid NOT NULL            -- → tutors.id (PK), денормализ. для RLS (mirror tutor_payments.tutor_id, rule 40)
tutor_student_id   uuid NOT NULL            -- → tutor_students.id
kind               text NOT NULL CHECK (kind IN ('debit','credit'))
amount             integer NOT NULL CHECK (amount > 0)   -- РУБЛИ, положит.; знак из kind
occurred_on        date NOT NULL
source_kind        text NOT NULL CHECK (source_kind IN ('lesson','topup','adjustment'))
source_lesson_id   uuid NULL                -- → tutor_lessons(id) ON DELETE SET NULL (debit от занятия)
reverses_entry_id  uuid NULL                -- на OFFSETTING-записи: какую запись она сторнирует
reversed_by_entry_id uuid NULL              -- на ОРИГИНАЛЕ: какой offsetting её сторнировал (ставится при reverse)
note               text NULL
created_by         uuid NOT NULL            -- auth.uid()
created_at         timestamptz NOT NULL default now()
```
- **Balance-инвариант (AC-4):** `balance = Σ(CASE kind WHEN 'credit' THEN +amount ELSE -amount END)` по ВСЕМ записям. reversed-оригинал ОСТАЁТСЯ в сумме; offsetting сокращает его в 0. `reversed_by_entry_id` — только для idempotency-индекса и UI (НЕ вычитается).
- **Идемпотентность lesson-debit:** `CREATE UNIQUE INDEX … (source_lesson_id, tutor_student_id) WHERE source_kind='lesson' AND kind='debit' AND reversed_by_entry_id IS NULL;` → один active lesson-debit на (занятие, ученик); reverse освобождает.
- **Один реверс на оригинал (AC-12):** `CREATE UNIQUE INDEX … (reverses_entry_id) WHERE reverses_entry_id IS NOT NULL;`
- **Индекс ленты:** `(tutor_student_id, created_at DESC)`.
- **RLS:** `SELECT` — `tutor_id = resolve_tutor_pk(auth.uid())`; **REVOKE INSERT/UPDATE/DELETE FROM authenticated** (запись только SECURITY DEFINER).

**Migration 2 — баланс + защита от прямой записи (AC-10):**
- `ALTER TABLE tutor_students ADD COLUMN balance integer NOT NULL DEFAULT 0;` (рубли).
- **`REVOKE UPDATE ON tutor_students FROM authenticated;` затем `GRANT UPDATE (<все редактируемые из edit-формы колонки, КРОМЕ balance>) TO authenticated;`** — паттерн column-GRANT whitelist (rule 40, mirror `homework_tutor_task_states`). Грепнуть `tutor-update-student`/`updateTutorStudentProfile` для полного списка колонок. (Альтернатива — guarded BEFORE-UPDATE trigger; column-GRANT проще, есть прецедент.)

**Migration 3 — balance-trigger:** `AFTER INSERT ON tutor_ledger_entries FOR EACH ROW → UPDATE tutor_students SET balance = balance + (CASE WHEN NEW.kind='credit' THEN NEW.amount ELSE -NEW.amount END) WHERE id = NEW.tutor_student_id;` (атомарный +delta, row-lock). + `recompute_student_balance(_id)` (read-only, nightly reconcile, AC-4). Только INSERT (правки/реверсы = новые insert'ы → дельты складываются).

**Migration 4 — триггеры-чокпоинт на `tutor_payments` (SECURITY DEFINER) — ядро v2:**
- `AFTER INSERT ON tutor_payments`: вставить lesson-debit `{tutor_id, tutor_student_id, kind='debit', amount=NEW.amount, source_kind='lesson', source_lesson_id=NEW.lesson_id, occurred_on=COALESCE(lesson.start_at::date, NEW.due_date)}` **идемпотентно** (`ON CONFLICT` по partial-unique → no-op). Покрывает ВСЕ пути завершения (individual/group/bulk → все создают `tutor_payments`).
- `AFTER DELETE ON tutor_payments`: найти active lesson-debit `(source_lesson_id=OLD.lesson_id, tutor_student_id=OLD.tutor_student_id, kind='debit', reversed_by_entry_id IS NULL)` → reverse (вставить offsetting credit + пометить оригинал). Покрывает delete/cancel/revert (rule 60 сносит pending/overdue).
- **Не трогает** `complete_lesson_and_create_payment` (rule 10 ✓). `tutor_payments` в баланс НЕ агрегируется — триггер лишь СОЗДАЁТ ledger-запись из события.
- **Bridge-природа:** в 2b при заморозке `tutor_payments` (стоп INSERT) debit-creation переносится на cron/прямой ledger-write; эти триггеры снимаются. Документированный мост.

**Migration 5 — seed (one-shot, guarded):** для каждого `tutor_student_id`, у кого ещё нет seed-записи: per-row из `tutor_payments` — debit на каждую строку (`source_kind='lesson'`, `source_lesson_id`, amount), credit на каждую `paid` (`source_kind='adjustment'`, note `'seed: оплачено (история)'`). Net = `−Σ(pending+overdue)` (AC-1). Пишет в ledger напрямую (НЕ в `tutor_payments` → триггеры Migration 4 не фаерятся; исторические строки уже существуют → INSERT-триггер ретро-не-срабатывает). Рубли 1:1, **ни одного `*100`**.

### RPC (SECURITY DEFINER, ownership через `tutors.id`, REVOKE ALL FROM PUBLIC + GRANT authenticated/service_role; ошибки rule 97 рус.)
- `tutor_record_topup(_tutor_student_id, _amount int, _occurred_on date, _note text) → uuid` — ownership; insert credit `source_kind='topup'`.
- `tutor_reverse_ledger_entry(_entry_id uuid, _note text) → uuid` — ownership; `SELECT … FOR UPDATE` оригинала; guard `reversed_by_entry_id IS NULL` иначе 409 (AC-12); insert offsetting (`reverses_entry_id=_entry_id`) + `UPDATE` оригинал `reversed_by_entry_id=new_id`.
- `tutor_edit_lesson_debit(_entry_id, _new_amount)` [P1] — обёртка: reverse(old) + insert new debit (та же занятие/ученик).
- Триггерные функции (Migration 4) — SECURITY DEFINER, пишут ledger в обход REVOKE.

### Backend / интеграция
- **Списание = триггер на `tutor_payments`** (Migration 4). НИКАКОГО app-layer mirror и правки complete-RPC/bulk-RPC (отказ от v1-подхода — он пропускал бы `tutorScheduleGroupActions.ts` callsites, P0-4). Проверка покрытия — grep callsites (AC-13), но гарантия структурная (все идут через `tutor_payments`).

### Frontend
- `src/lib/tutorBalanceApi.ts` (новый): `recordTopup`, `reverseLedgerEntry`, `editLessonDebit`[P1], `listLedger(studentId)` (рубли). RPC-ошибки rule 97. Новый client RPC → `src/integrations/supabase/types.ts` (Functions).
- React Query keys (performance §2c): `['tutor','balance', studentId]` + `['tutor','ledger', studentId]`; инвалидация при topup/reverse/edit + при complete (occurs via tutor_payments → invalidate balance). Новые `useQuery` → `refetchOnWindowFocus:false`.
- **«Обзор» карточка-сводка** (`TutorStudentProfile.tsx`, вкладка `progress`/«Обзор»): `StudentBalanceCard` — баланс (±, цвет), «Внести оплату» (primary), «Отчёт родителю» (disabled до 2c), «Все операции →» (→ «Оплаты»).
- **«Внести оплату»** sheet — одно поле ₽ (16px, rule 80) + дата → `recordTopup`.
- **«Оплаты» tab** [P1]: `LedgerFeed` (лента + редактируемое списание + «ближайшие списания»).
- **Должники** [P1]: `balance < 0`.

### Money-инварианты (соблюсти)
- balance = Σ ВСЕХ signed; `reversed_by_entry_id` не влияет на баланс (AC-4).
- Списание создаётся/реверсится ТОЛЬКО триггером на `tutor_payments` (единый чокпоинт; AC-3/11/13/14).
- Идемпотентность lesson-debit (partial-unique) + один-реверс-на-оригинал.
- Прямой UPDATE balance запрещён (column-GRANT, AC-10); запись ledger только SECURITY DEFINER (AC-9).
- Append-only: правки/реверсы = новые записи, не UPDATE/DELETE сумм.
- Seed = текущий долг, не выручка (AC-1). Рубли integer, нет `*100` (AC-8).
- Ownership через `tutors.id` (rule 40).

---

## UX principles (docs 16/17)
Один primary CTA (на «Обзоре» учебное primary, «Внести оплату» вторичный акцент; на sheet — один «Записать»). Прогрессивное раскрытие (сводка/детали). Надёжность > эффектность (нет outbound; правки обратимы; баланс детерминирован). Без эмодзи (Lucide), socrat-токены, ₽, 16px инпуты (rule 80/90). Legacy «отметить оплаченным» НЕ показывается как операция баланса (P1-7).

---

## Validation
- `npm run lint` → `build` → `smoke-check`.
- **SQL-гейты:** AC-1 (`balance == −долг`; ученик-только-paid → 0); AC-4 (`balance == recompute`, после reverse = 0); seed дважды → без изменений; INSERT оплаты дважды → один active debit; reverse дважды → idempotent (AC-12); DELETE оплаты → debit реверснут (AC-11); группа → N debit (AC-14); прямой `UPDATE balance` → отказ (AC-10).
- **Manual QA** (`/tutor/students/:id`): seed-баланс == реальность репетитора; «Внести оплату» 5000 → +5000; завершить занятие (individual + group + bulk) → −цена, повтор → без второго; отменить/удалить занятие → debit вернулся; изменить сумму списания → пересчёт; копеек нет; Safari/iOS.
- Регрессия (2a аддитивна): `tutor_payments`, «Оплаты», `/pay`-бот, complete-flow, конфетти — без изменений.

---

## Risks
- **Money-correctness (highest):** seed=−долг (НЕ +выручка, AC-1); идемпотентность debit; balance=Σ всех; прямой UPDATE balance закрыт. Митигация: partial-unique + `ON CONFLICT`, триггер + nightly recompute, SQL-гейты, прогон дважды.
- **Триггер-мост на `tutor_payments`** связывает 2a с legacy-таблицей. Осознанно: единый чокпоинт > N callsites/правка ядра. Снимается в 2b (заморозка → debit из cron/прямого write). Документировано.
- **Транзиторная дуальность** (legacy paid/pending vs balance): legacy «отметить оплаченным» НЕ влияет на balance и НЕ показывается как операция; «Все операции» → ledger-лента, не старая `TutorPayments` (P1-7). Полный отказ от legacy = 2b. Коммуникация Егору.
- **rule 10:** ядро `complete_lesson_and_create_payment` не трогаем (триггеры на таблице, не на RPC). `TutorStudentProfile.tsx` — аддитивно (новая карточка).
- **Не вносят пополнения** → дрейф. Митигация: 1 тап из карточки; мерить.

---

## Implementation Tasks (краткий план)
1. Migration 1–3 (ledger + balance + column-GRANT + balance-trigger) — DB.
2. Migration 4 (триггеры INSERT/DELETE на `tutor_payments`) + Migration 5 (seed per-row) — DB.
3. RPC topup + reverse (race-guard) + `types.ts` + REVOKE/GRANT — DB.
4. `tutorBalanceApi.ts` + query keys — frontend lib.
5. `StudentBalanceCard` на «Обзор» + «Внести оплату» sheet — frontend (P0-5/P0-4).
6. [P1] `LedgerFeed` на «Оплаты» + редактируемое списание + должники.

Детальная нарезка + промпты → `tasks.md` (pipeline step 5).

---

## Parking Lot
- Авто-debit cron + ежедневная сводка (без ручного «провести») — **Phase 2b**.
- Полный cutover: заморозка `tutor_payments` (read-only), снятие триггер-моста, reframe «Оплаты» + `/pay`-бота на баланс — **Phase 2b**.
- Редактируемая сумма списания прямо в PostLessonSheet при проведении (а не только пост-фактум в ledger) — P1/2b.
- Отчёт родителю (прогресс lite + баланс, share-ссылка `/p/:slug`) — **Phase 2c**.
- Абонемент (`covered_by_subscription_id`) — **Phase 3**.
- Посещаемость (был/пропустил/перенёс) + авто-% за пропуск как дефолт списания — отдельный раунд.

---

## Later phases (краткий scope + условие старта)

- **Phase 2b — Cutover + авто-debit + сводка.** Заморозить `tutor_payments` (read-only), снять триггер-мост, debit писать из авто-debit cron (`net.http_post` → edge, окно start+dur+3ч) + ежедневная сводка + undo (эволюция `PastLessonsConfirmBanner`/`ConfirmLessonsSheet`); reframe «Оплаты» + `/pay`-бот на баланс/«должники». **Старт:** 2a стабильна + Егор подтвердил совпадение баланса с реальностью.
- **Phase 2c — Отчёт родителю.** Один read-only отчёт (прогресс lite R2 + баланс/выписка) по share-ссылке (реюз `/p/:slug` + `public-*` edge, column-whitelist, anti-leak). **Старт:** 2a/2b дали верный баланс.
- **Phase 2d / Phase 3 — Абонемент.** Объект расписания + авто-списание идемпотентно по `period_key='YYYY-MM'` + флаг «покрыто». **Старт:** по запросу пилотного репетитора (Принцип 15).
