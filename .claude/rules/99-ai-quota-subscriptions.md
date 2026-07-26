# AI-квота и подписки — инварианты (всегда в контексте)

**Глубина — skill `ai-quota-subscriptions`** (полная механика `get_subscription_status`, админ-выдача тарифа, самообслуживаемая оплата YooKassa «AI-старт» и ценовая вилка, возвраты и `payment_refunds`, промо BLINOV_20, нудж истечения, телеметрия воронки, демо-разбор репетитора).

## Единственный источник правды по квоте

`get_subscription_status(p_user_id, p_context)` — **единственный** источник дневного лимита AI-сообщений. Backend зовёт через shared `_shared/subscription-limits.ts::checkAiQuota`, фронт — через `useSubscription`. **Не дублировать логику порога — расширять RPC.**

- `p_context`: `'chat'` (default) | `'homework'`.
- Premium/trial ученика → unlimited (`daily_limit = -1`).
- Free-ученик: `'chat'` → 10; `'homework'` → 10, но **50** если есть активная связь `tutor_students` (`status='active'`) с репетитором, у которого premium (valid) ИЛИ trial.
- **Счётчик `daily_message_limits` — ОДИН на пользователя** (chat + все ДЗ вместе). 50/день — потолок **суммарно**, НЕ «50 на каждое ДЗ». Копи-инвариант: не обещать «50 в каждом ДЗ»; канон — «50 сообщений в день».
- Сбой RPC → `checkAiQuota` **fail-open** (permissive, лимит 10), но без homework-boost.

**FK-инвариант (rule 60):** paid-tutor детект джойнит `tutor_students.tutor_id → tutors.id`, затем `tutors.user_id = profiles.id`. Сломаешь джойн — ученики платящего репетитора молча упадут на 10.

## Платный статус живёт ТОЛЬКО в `profiles`

В таблице `tutors` полей подписки **нет**. «Платящий репетитор» = `profiles.subscription_tier='premium'` (valid) ИЛИ trial на его собственном профиле — и больше нигде.

**Пометить репетитора платящим можно ТОЛЬКО** через `admin_grant_tutor_plan` (админ-вкладка «Тарифы») ИЛИ YooKassa-вебхук тарифа. Оба аудируются в `admin_tutor_plan_grants`. **Никакого raw `UPDATE profiles`.**

Симптом нарушения: репетитор платит, но профиль не premium → его ученики молча падают на 10/день, а в 429-тосте им предлагают «попроси AI-старт».

## ⚠️ Гранты service_role-only RPC — ТРОЙНОЙ REVOKE

`REVOKE FROM PUBLIC` **НЕДОСТАТОЧНО.** Supabase default privileges схемы `public` грантят EXECUTE ролям `anon`/`authenticated` **напрямую**, поэтому обязательны все три шага в правильном порядке:

```sql
GRANT EXECUTE ON FUNCTION ... TO service_role;   -- сначала GRANT
REVOKE ALL ON FUNCTION ... FROM PUBLIC;
REVOKE ALL ON FUNCTION ... FROM anon, authenticated;
```

Порядок важен: сначала GRANT, иначе отнимешь доступ у тех, у кого он держался на PUBLIC. Инцидент 2026-07-15: `yookassa_record_refund` сутки исполнялась под anon-ключом (клиент мог фабриковать возвраты). **Новая service_role-only RPC → тройной revoke + верификация PostgREST-пробой под anon** (ждём 42501 permission denied, НЕ ответ функции).

## Деньги: тело вебхука — сигнал, а не истина

YooKassa-вебхуки **не подписаны**. Активация только после верификации через YooKassa API (`GET /v3/payments/{id}` — `status==='succeeded' && paid===true`, сумма матчит строку `payments`, валюта RUB). Статус берётся **из API, не из body**.

- Активация — атомарная RPC `yookassa_activate_subscription(p_payment_id)` (FOR UPDATE claim + expiry + UPDATE profiles + audit одной транзакцией). Конкурентный дубль не продлит дважды.
- **Возврат: body даёт ТОЛЬКО refund id** (`object.id` — это ID ВОЗВРАТА, платёж в `object.payment_id`). Строка `payments` ищется по `payment_id` **из API**. Ни `payment_id`, ни сумму из body не использовать.
- `payments.refunded_amount` **пересчитывается** из `payment_refunds` под `FOR UPDATE`, не инкрементится (дубль вебхука иначе задваивает).
- **Цена — только сервером** (клиенту не доверяем): интро 200 ₽ по трём критериям, дальше по активным ученикам. Гейт `NOT_A_TUTOR` обязателен, иначе ученик купит Premium по тарифу репетитора.
- **Retry-семантика: 200 только когда ретрай гарантированно бесполезен.** Транзиент (API/RPC/lookup/UPDATE статуса/исключение) → 500, YooKassa ретраит до ~24ч. Подделка и битый JSON → 200.

## Новый tutor-AI-путь — свой cap, не ученическая квота

Демо-разбор и подобные tutor-пути: `is_tutor`-гейт + **свой** дневной cap (COUNT событий в `analytics_events`), отдельный `logSource` в `token_usage_logs`. **Не вешать на `FREE_DAILY_LIMIT`** — ученики не должны страдать.
