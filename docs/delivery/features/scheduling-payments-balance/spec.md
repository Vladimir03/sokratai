# SPEC: Баланс ученика — Phase 2 (учёт занятий и оплат)

> Pipeline step 4 (SPEC). Автор: Vladimir × Claude · 2026-06-09
> PRD: `docs/delivery/features/scheduling-payments-balance/prd.md` · Макет: `docs/discovery/prototypes/student-card-balance-mockup.html`
> Деньги-инварианты: rule 60 + новый money-инвариант (PRD §3.7). Единицы: **рубли (integer), без копеек** (PRD §3.8).
>
> **Разбивка (правило pipeline «фича слишком большая»):** Phase 2 трогает DB+backend+frontend+bot (>3 области, L). Полностью специфицируется **Phase 2a** (аддитивный баланс — ничего не ломает). **2b/2c/2d** — краткий scope + условие старта (см. конец).

---

## Section 0: Job Context

- **Core Job**: R4 — сохранять контроль и не утопать в рутине при масштабировании (ветка «деньги/админ»).
- **Sub-jobs (Phase 2a)**: «знать, кто мне сколько должен» · «зафиксировать полученные деньги (одно число)» · «не терять долги по забывчивости».
- **Segment**: B2B, репетиторы физики ЕГЭ/ОГЭ (платный пилот); платит родитель офлайн, репетитор ведёт учёт. Сократ не проводит платежи.
- **Wedge alignment**: НЕ wedge — retention/anti-churn supporting job. Узкий срез личного учёта, не CRM.
- **Pilot impact**: убирает ручной подсчёт «сколько должен за период» + даёт одно число долга → репетитор не бросает на деньгах.

---

## Summary

Вводим **кошелёк ученика**: `баланс = Σ пополнения − Σ списания` (в рублях). Списания капают по занятиям (= цена ученика, редактируемо), пополнения вносятся одним числом. **Phase 2a — аддитивный слой**: баланс живёт параллельно существующему `tutor_payments` (его НЕ ломаем), сидируется из истории, отображается на вкладке «Обзор» + «Оплаты». Полный cutover (заморозка `tutor_payments`, reframe `/pay`-бота, авто-debit cron, отчёт родителю) — Phase 2b+.

---

## Problem

(подробно в PRD §2.) Кратко: «оплачено/не оплачено по занятию» + ручной подсчёт за период = боль. Егор: «хочу одно число и чтобы кто-то посчитал за меня». Нет баланса, дроби, группы stale, посещаемость смешана с оплатой.

---

## Solution

### In scope (Phase 2a)
Аддитивный ledger + баланс (рубли), сид из истории, пополнение (credit), списание при проведении занятия (debit, mirror), отображение баланса на «Обзор»/«Оплаты». **`tutor_payments`, `/pay`-бот, существующая страница «Оплаты» — НЕ трогаем** (работают как сейчас; баланс — параллельный слой). Баланс = **только** Σ ledger (legacy в баланс не входит → нет двойного счёта).

### Out of scope (Phase 2a — это 2b+)
Заморозка `tutor_payments`; reframe «Оплаты»/`/pay`-бота на баланс; авто-debit cron + ежедневная сводка; отчёт родителю; абонемент; посещаемость; платёжный процессинг.

---

## Acceptance Criteria (testable)

- **AC-1 (seed):** После seed-миграции для ученика с историей `tutor_payments` баланс = `Σ(amount where status='paid') − Σ(amount where status in ('pending','overdue'))` в рублях. SQL-проверка: `SELECT balance FROM tutor_students WHERE id=… ` == расчёт из `tutor_payments`. Идемпотентно: повторный прогон seed не меняет баланс (marker-guard `source_kind='seed'`).
- **AC-2 (пополнение):** «Внести оплату» 5000 ₽ → в `tutor_ledger_entries` появляется `kind='credit', amount=5000, source_kind='topup'`; `tutor_students.balance` += 5000; `tutor_payments` не изменился. Видно в ленте «Оплаты».
- **AC-3 (списание при проведении + идемпотентность):** Завершение занятия (PostLessonSheet / grid 3-кнопки / bulk-confirm) создаёт ровно ОДИН `kind='debit', source_kind='lesson', source_lesson_id=…, amount=цена`. Повторное завершение того же занятия для того же ученика НЕ создаёт второй активный debit (partial-unique). `balance` уменьшился на цену.
- **AC-4 (trigger consistency):** `tutor_students.balance` всегда == `Σ(credit.amount) − Σ(debit.amount where reversed_entry_id IS NULL)` по ledger ученика. Проверка: вставка/reverse записи → баланс пересчитан AFTER-trigger'ом; nightly `recompute` совпадает.
- **AC-5 (reverse/undo):** Reverse записи → вставляется offsetting-запись, оригинал помечается `reversed_entry_id`, баланс возвращается, partial-unique освобождён (можно создать новый debit на то же занятие). Оригинал НЕ удаляется (append-only аудит).
- **AC-6 (редактируемое списание):** Изменение суммы списания в «Оплаты» → reverse старого debit + новый debit с новой суммой; баланс = новая сумма; обе записи в ленте (аудит). Сумма decoupled от посещаемости (нет поля «был/не был»).
- **AC-7 (отображение):** На вкладке «Обзор» карточка-сводка показывает баланс (±, цвет) == `tutor_students.balance`; кнопки «Внести оплату» + «Отчёт родителю» (заглушка-disabled до 2c). «Все операции →» ведёт на «Оплаты».
- **AC-8 (единицы):** Нигде нет копеек/`*100`: ledger.amount, balance, цена — целые рубли. Grep: нет новых `_cents` в ledger-коде.
- **AC-9 (RLS/ownership):** Репетитор видит/пишет только свой ledger ТОЛЬКО через SECURITY DEFINER RPC; прямой PostgREST `insert/update` в `tutor_ledger_entries` запрещён (REVOKE). Чужой `tutor_student_id` → отказ внутри RPC.

---

## Requirements (P0 / P1)

**P0 (Must-Have — первый релиз):**
- **R-P0-1**: Миграция — `tutor_ledger_entries` (рубли) + `tutor_students.balance` + AFTER-trigger + partial-unique идемпотентность + RLS/REVOKE.
- **R-P0-2**: RPC `tutor_record_topup` (пополнение) + UI «Внести оплату» (одно поле ₽ + дата) из карточки «Обзор».
- **R-P0-3**: Списание при проведении — `tutor_record_lesson_debit` + вызов из всех complete-точек (frontend `handleCompleteLesson` + bulk-confirm). Идемпотентно.
- **R-P0-4**: Seed-миграция `tutor_payments` → стартовые балансы (рубли 1:1, marker-guard).
- **R-P0-5**: Баланс на вкладке «Обзор» — карточка-сводка (read), кнопка «Внести оплату».

**P1 (Nice-to-Have — fast-follow):**
- **R-P1-1**: Вкладка «Оплаты» → полная лента операций (списания/пополнения, даты, ссылка на занятие) + «ближайшие списания».
- **R-P1-2**: Редактируемая сумма списания (reverse+new) + reverse/undo пополнения.
- **R-P1-3**: «Должники» = отрицательный баланс (read-only список на `/tutor/students` или home-блок).

> P0=5, P1=3 — на верхней границе. Если при имплементации R-P0-3 (debit при проведении) разрастётся (3 разные complete-точки) — выделить bulk-confirm-debit в отдельную задачу/мини-фазу.

---

## Technical Design

### Модель данных (миграции, additive, РУБЛИ)

**Migration 1 — `tutor_ledger_entries`:**
```
id                uuid PK default gen_random_uuid()
tutor_id          uuid NOT NULL            -- → tutors.id (PK), денормализ. для RLS (mirror tutor_payments.tutor_id, rule 40)
tutor_student_id  uuid NOT NULL            -- → tutor_students.id
kind              text NOT NULL CHECK (kind IN ('debit','credit'))
amount            integer NOT NULL CHECK (amount > 0)   -- РУБЛИ, всегда положит.; знак из kind
occurred_on       date NOT NULL            -- debit = дата занятия; credit = дата получения
source_kind       text NOT NULL CHECK (source_kind IN ('lesson','topup','adjustment','seed'))
source_lesson_id  uuid NULL                -- → tutor_lessons(id) ON DELETE SET NULL
reversed_entry_id uuid NULL                -- → self; ставится на ОРИГИНАЛ при reverse (освобождает индекс)
note              text NULL
created_by        uuid NOT NULL            -- auth.uid()
created_at        timestamptz NOT NULL default now()
```
- **Идемпотентность (структурная):** `CREATE UNIQUE INDEX … ON tutor_ledger_entries (source_lesson_id, tutor_student_id) WHERE source_kind='lesson' AND kind='debit' AND reversed_entry_id IS NULL;` → один активный lesson-debit на (занятие, ученик); reverse освобождает.
- **Индекс ленты:** `(tutor_student_id, created_at DESC)`.
- **RLS:** SELECT — `tutor_id = public.resolve_tutor_pk(auth.uid())` (или is-owner helper); **REVOKE INSERT/UPDATE/DELETE FROM authenticated** (запись только через RPC service_role).

**Migration 2 — баланс на `tutor_students`:** `ADD COLUMN balance integer NOT NULL DEFAULT 0;` (РУБЛИ, денормализ.).

**Migration 3 — trigger поддержки баланса:** `AFTER INSERT ON tutor_ledger_entries` → `UPDATE tutor_students SET balance = balance + (CASE WHEN NEW.kind='credit' THEN NEW.amount ELSE -NEW.amount END) WHERE id = NEW.tutor_student_id;` (атомарный +delta, row-lock). + read-only `recompute_student_balance(_id)` (для nightly reconcile, AC-4).

**Migration 4 — seed (marker-guarded):** для каждого `tutor_student_id` без `source_kind='seed'` записи: вставить `credit` = `Σ(tutor_payments.amount WHERE status='paid')` и `debit` = `Σ(amount WHERE status IN ('pending','overdue'))`, `source_kind='seed'`, `occurred_on=CURRENT_DATE`, amount>0 only. Trigger сам пересчитает balance. **Ровно один прогон** (idempotent по marker). Рубли 1:1 (нет `*100`).

### RPC (SECURITY DEFINER, ownership внутри, REVOKE ALL FROM PUBLIC + GRANT authenticated/service_role)
- `tutor_record_topup(_tutor_student_id uuid, _amount int, _occurred_on date, _note text) → uuid` — ownership (`tutor_student → tutors.id = resolve_tutor_pk(auth.uid())`); insert credit `source_kind='topup'`. Возвращает entry_id.
- `tutor_record_lesson_debit(_lesson_id uuid, _tutor_student_id uuid, _amount int) → uuid` — ownership (занятие принадлежит тутору + ученик его); insert debit `source_kind='lesson'`; `ON CONFLICT` (partial-unique) → no-op (вернуть существующий id). Идемпотентно.
- `tutor_reverse_ledger_entry(_entry_id uuid, _note text) → uuid` — ownership; insert offsetting (противоположный kind, та же сумма, `source_kind='adjustment'`, `reversed_entry_id=_entry_id`) + `UPDATE` оригинал `reversed_entry_id = new_id`. (Edit суммы = reverse + record новый — на клиенте/в RPC-обёртке.)
- Все: рубли; ошибки rule 97 (рус. фразы); ownership через `tutors.id` (rule 40 FK-drift — `resolve_tutor_pk(auth.uid())`).

### Backend / интеграция со списанием при проведении (R-P0-3)
**Решение (rule 10 — не рефакторить money-ядро):**
- **Frontend complete-точки** (`handleCompleteLesson` в `TutorSchedule.tsx` — grid 3-кнопки + PostLessonSheet): после успешного `completeLessonAndCreatePayment(...)` вызвать `tutor_record_lesson_debit(lesson, student, amount)` (тот же `amount`, что в оплату; рубли через `calculateLessonPaymentAmount`). Ядро RPC `complete_lesson_and_create_payment` **не трогаем**.
- **Bulk-confirm** (`tutor_confirm_lessons` — server-side): `CREATE OR REPLACE` (additive) — после создания `tutor_payments` участнику вставить и ledger debit (та же сумма, идемпотентно). Помечено как осознанное доп-изменение money-RPC (review-флаг).
- Идемпотентность partial-unique гарантирует: двойное завершение / both paths → один debit.
- **Балансовая независимость:** `tutor_payments` в баланс НЕ агрегируется (баланс = Σ ledger). «paid» в legacy ≠ credit в ledger. Кредит даёт ТОЛЬКО пополнение (`tutor_record_topup`). → в 2a репетитора ориентируем вносить деньги через «Внести оплату», а не legacy «отметить оплаченным» (полный отказ от legacy-пути = 2b).

### Frontend
- **Клиент** `src/lib/tutorBalanceApi.ts` (новый): `recordTopup`, `recordLessonDebit`, `reverseLedgerEntry`, `listLedger(studentId)`, типы (рубли). Через `supabase.rpc(...)` + `extractEdgeFunctionError`-аналог (или RPC-ошибки напрямую). Новый клиентский RPC → запись в `src/integrations/supabase/types.ts` (Functions).
- **React Query keys** (rule performance §2c): `['tutor','balance', studentId]`, инвалидация при topup/debit/reverse + при complete. Новые `useQuery` → `refetchOnWindowFocus:false`.
- **«Обзор» карточка-сводка** (`TutorStudentProfile.tsx`, вкладка `progress`/«Обзор»): компонент `StudentBalanceCard` — баланс (±, цвет), «Внести оплату» (primary), «Отчёт родителю» (disabled до 2c), «Все операции →» (на «Оплаты»). Реюз стиля из макета.
- **«Внести оплату»** sheet/dialog — одно поле ₽ (16px, rule 80) + дата + «Записать» → `recordTopup`.
- **«Оплаты» tab** (P1): `LedgerFeed` — лента операций + редактируемое списание + «ближайшие списания» (из `tutor_lessons` booked будущих × цена).
- **Должники** (P1): фильтр `balance < 0`.

### Money-инварианты (соблюсти)
- Списание = внутренняя запись, без outbound, обратимо, будущие не трогаем (PRD §3.7).
- Идемпотентность `(source_lesson_id, tutor_student_id)` partial-unique.
- Рубли integer везде (нет `*100`); seed 1:1.
- Append-only: правки/откаты = offsetting-записи, не UPDATE/DELETE сумм.
- Ownership через `tutors.id` (rule 40); запись только через RPC (REVOKE).

---

## UX principles (docs 16/17)
- Один primary CTA: на «Обзоре» учебное действие («Требует проверки») primary; «Внести оплату» — вторичный акцент в карточке. На sheet «Внести оплату» — один primary «Записать».
- Прогрессивное раскрытие: сводка на «Обзор», детали на «Оплаты».
- Надёжность > эффектность (Принцип 12): нет авто-outbound; правки обратимы; баланс детерминирован (trigger).
- Без эмодзи в chrome (Lucide), socrat-токены, ₽, 16px инпуты (rule 80/90).

---

## Validation
- `npm run lint` → `build` → `smoke-check`.
- **SQL-гейты (staging/прод-снимок до cutover):** AC-1 (seed net == расчёт), AC-4 (`balance == recompute`), прогон seed дважды → без изменений, прогон complete дважды → один debit.
- **Manual QA** (`/tutor/students/:id`): seed-баланс совпадает с реальностью репетитора · «Внести оплату» 5000 → +5000, лента обновилась · завершить занятие → −цена, повтор → без второго списания · изменить сумму списания → баланс пересчитан · reverse → возврат · копеек нигде нет · Safari/iOS (карточка, sheet).
- Регрессия: `tutor_payments`, страница «Оплаты», `/pay`-бот, complete-flow, конфетти — без изменений (2a аддитивна).

---

## Risks
- **Money-correctness (highest):** seed net, двойной debit, рассинхрон balance↔ledger. Митигация: partial-unique + `ON CONFLICT`, trigger + nightly recompute, SQL-гейты, прогон дважды.
- **Транзиторная дуальность** (legacy paid/pending vs balance): репетитор путает «отметить оплаченным» (legacy) и «Внести оплату» (новое). Митигация: в 2a ориентируем на «Внести оплату»; полный отказ от legacy = 2b; коммуникация Егору.
- **rule 10:** `TutorSchedule.tsx`/`TutorStudentProfile.tsx` высокорисковые — аддитивно (новый компонент карточки + вызов RPC после complete), ядро complete/payment не рефачить. Bulk-confirm RPC — `CREATE OR REPLACE` additive, review-флаг.
- **Не вносят пополнения** → баланс дрейфует. Митигация: 1 тап из карточки; мерить.

---

## Implementation Tasks (краткий план)
1. Миграции 1–4 (ledger + balance + trigger + seed) — DB.
2. RPC topup/debit/reverse + `types.ts` + REVOKE/GRANT — DB/backend.
3. `tutorBalanceApi.ts` + query keys — frontend lib.
4. `StudentBalanceCard` на «Обзор» + «Внести оплату» sheet — frontend (P0-5, P0-2).
5. Debit при проведении: `handleCompleteLesson` + bulk-confirm RPC расширение — frontend+DB (P0-3).
6. (P1) `LedgerFeed` на «Оплаты» + редактируемое списание + должники.

Детальная нарезка + промпты агентам → `tasks.md` (pipeline step 5).

---

## Parking Lot
- Авто-debit cron + ежедневная сводка (без ручного «провести») — **Phase 2b**.
- Полный cutover: заморозка `tutor_payments` (read-only), reframe «Оплаты» + `/pay`-бота на баланс — **Phase 2b**.
- Отчёт родителю (прогресс lite + баланс, share-ссылка `/p/:slug`) — **Phase 2c**.
- Абонемент (объект расписания, фикс/месяц, `covered_by_subscription_id`) — **Phase 3**.
- Посещаемость (был/пропустил/перенёс) + авто-% за пропуск как дефолт списания — отдельный раунд.
- «Ближайшие списания» прогноз с учётом отмен/переносов.

---

## Later phases (краткий scope + условие старта)

- **Phase 2b — Cutover + авто-debit + сводка.** Заморозить `tutor_payments` (read-only), reframe «Оплаты» + `/pay`-бот на баланс/«должники»; авто-debit cron (`net.http_post` → edge, mirror `payment-reminder`, окно start+dur+3ч) для прошедших без ручного «провести»; ежедневная сводка «начислено за день» + undo (эволюция `PastLessonsConfirmBanner`/`ConfirmLessonsSheet`). **Старт:** 2a стабильна + Егор подтвердил, что баланс совпадает с реальностью.
- **Phase 2c — Отчёт родителю.** Один общий read-only отчёт (прогресс lite из R2 + баланс/выписка) по share-ссылке (реюз `/p/:slug` + `public-*` edge, column-whitelist, anti-leak). **Старт:** 2a/2b дали верный баланс.
- **Phase 2d / Phase 3 — Абонемент.** Объект расписания (фикс сумма/день месяца, участники) + авто-списание идемпотентно по `period_key='YYYY-MM'` + флаг «покрыто». **Старт:** по запросу пилотного репетитора (Принцип 15).
