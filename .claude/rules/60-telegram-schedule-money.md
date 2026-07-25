# Telegram-бот · Расписание · ДЕНЬГИ — инварианты (всегда в контексте)

Здесь ТОЛЬКО то, что можно нарушить первой же правкой. **Глубина — skill `telegram-schedule-payments`** (`/pay`-флоу, web-invite, добавление учеников, подтверждение прошедших занятий, серии/личные дела, полная история Phase 2a/2b баланса, архив, группы и метки).

## Деньги — читай ЭТО прежде любой правки money-пути

**Модель баланса (Phase 2b, задеплоена).** `tutor_students.balance` (**РУБЛИ, integer** — никаких копеек и `/100`) = Σ подписанных записей `tutor_ledger_entries`. Оплаченное занятие = debit + credit = net 0; неоплаченное = только debit; ручная оплата/topup = только credit.

1. **Ledger append-only.** Записи НИКОГДА не UPDATE/DELETE — только offsetting reverse (`reverses_entry_id`/`reversed_by_entry_id`). «Правка» суммы = reverse + новая запись.
2. **`balance` ledger-managed.** Прямой `UPDATE balance` → RAISE (BEFORE-UPDATE guard). В `types.ts` `balance` только в `Row`, не в Insert/Update — compile-time гард.
3. **Запись в ledger только через SECURITY DEFINER.** Клиентских INSERT/UPDATE/DELETE-политик нет. Списание — единственная точка `_apply_lesson_debit_from_current_cost` (под 2-key advisory-lock). Зачисление — `_sync_lesson_credit` (lesson, требует active debit той же суммы) / `_credit_manual_payment` (идемпотентен по `source_payment_id` навсегда) / `tutor_record_topup`.
4. **Новый путь «деньги получены» ОБЯЗАН зачислить credit.** НИКОГДА прямой `tutor_payments.status='paid'` без credit — иначе оплаченные занятия уводят баланс в минус. Грепни `status='paid'` и `INSERT INTO ...tutor_payments`.
5. **Revert/delete симметричны:** сторнируют И debit, И credit (`kind IN ('debit','credit')`). Асимметрия = баланс прыгает на сумму.
6. **Цена = `COALESCE(participant.payment_amount, lesson.payment_amount, ставка×длительность)`.** Не «participant ∥ derived». `0` = waive, пусто = derived.
7. **Удаление занятия — только `tutor_delete_lessons`** (money-guard: блок при `status='paid'`, re-parent серии). **Никогда raw `.delete()` на `tutor_lessons`** — FK осиротит платежи и разорвёт серию.
8. **Длительность групповых занятий НЕ редактируется** — completion берёт сохранённый снимок `participants.payment_amount` и не пересчитывает, поэтому правка длительности оставила бы устаревший заряд. У индивидуальных — редактируется.
9. **Идемпотентность оплат** — participant-level `(lesson_id, tutor_student_id)`. Статусы только `pending`/`paid` (никаких `overdue` в новой логике). Дата занятия = `tutor_lessons.start_at`, **НЕ `tutor_payments.due_date`** (тот = `CURRENT_DATE` при создании).
10. **Мутации не ретраятся** (`mutations.retry: 0`, `src/App.tsx`) — ответ, съеденный DPI, неотличим от неотправленного запроса; ретрай = двойная запись.
11. **Любой UI-путь, дёргающий money-RPC, ОБЯЗАН инвалидировать** `['tutor','balance'|'ledger'|'students'|'student']` + `['tutor','received-payments']` — хелпер `invalidateBalanceCaches`. Иначе stale-чипы долга.
12. Legacy `payment:*` callback'и бота и `payment-reminder` — **dormant, не возрождать** money-мутацию: после cutover они завершали занятие без credit.

⚠️ **`tutor_lesson_participants` ИМЕЕТ клиентские write-RLS-политики** (`20260224123937`). Комментарий «no client write policy» в `20260604140000` **устарел — не верить**. Таблица НЕ «RPC-only write».

## FK-дрейф — конвертировать обязательно

`tutor_students.tutor_id`, `tutor_lessons.tutor_id`, `tutor_payments.tutor_id`, `tutor_groups.tutor_id` → **`public.tutors.id` (PK)**.
`homework_tutor_assignments.tutor_id`, `mock_exam_assignments.tutor_id` → **`auth.users.id`**.

Любой JOIN между этими группами ОБЯЗАН конвертировать через map `tutors.user_id ↔ tutors.id` (`resolveTutorPkId`). Симптом пропуска: аналитика «0/N», пропавшее имя/пол ученика в AI-промпте.

## Бот — надёжность

- **ВСЕ вызовы `/functions/v1/chat` — через `fetchChatWithTimeout`** (55с таймаут + 1 ретрай на 5xx/network). Прямой `fetch` мимо неё запрещён.
- Бот **ВСЕГДА отвечает**: каждая ветка роутинга (text/photo/voice) имеет `else` с `safeSendError`. Top-level catch: доставка удалась → HTTP 200 (Telegram не ретраит), не удалась → 500.
- `MERGED_MESSAGE_MAX_CHARS` (8000) **не должен превышать** `MAX_MESSAGE_LENGTH` в `chat/index.ts` (10000) — иначе склеенные сообщения дают «Произошла ошибка» на длинных диалогах.
- Callback data ≤ **64 байта** (лимит Telegram).
- `sendTypingLoop` ловит ошибки внутри себя — typing non-critical, его сбой не ломает flow.
- Команда `/homework` и classic-режим ДЗ **удалены, не возрождать**.

## Ученики

- **Добавление: имя + предмет обязательны** (гейт на фронте; backend лоялен по наличию, но валидирует значение по `CANONICAL_SUBJECT_IDS`). Контакт **опционален** — плейсхолдер по имени легален, канал нужен до первой отправки ДЗ.
- **Список для выбора — только `getTutorStudents()`** (фильтрует `archived_at IS NULL`). Новый server-side enumerate → добавить `.is('archived_at', null)` явно: `status='active'` этого НЕ покрывает (колонки ортогональны, архивный остаётся `active`, иначе поедет AI-квота rule 99).
- **Share-ссылка приглашения — только `getTutorInvitePreviewLink`** (`api.sokratai.ru/functions/v1/invite-preview`). `getTutorInviteWebLink` (`sokratai.ru/invite/{code}`) — для внутренней навигации, НЕ для шаринга: там OG репетиторского лендинга, который пугал учеников.
- Новая FK-ссылка на `tutor_students(id)` → задавать `ON DELETE` явно, иначе тихо блокирует удаление ученика.
- Учебная группа — `is_primary=true`; метки — `is_primary=false`, их ∞. Учебные контексты (групповое занятие, селектор основной группы) берут **только primary**.
