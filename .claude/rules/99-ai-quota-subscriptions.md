# AI-квота сообщений / подписки

## Модель дневного лимита (single source of truth)

`get_subscription_status(p_user_id, p_context)` (последняя версия — миграция `20260512134831`) — **единственный** источник правды для дневной квоты AI-сообщений. Backend (`chat/index.ts`, `homework-api` guard'ы check/hint) зовут его через shared `supabase/functions/_shared/subscription-limits.ts::checkAiQuota`; фронт — через `src/hooks/useSubscription.ts`. Не дублировать логику порога — расширять RPC.

- `p_context`: `'chat'` (default) | `'homework'`.
- Premium ученика (`profiles.subscription_tier='premium'`, не истёкший) / собственный trial (`trial_ends_at>now()`) → **unlimited** (`daily_limit=-1`).
- Free-ученик, дневной лимит:
  - `'chat'` → **10**.
  - `'homework'` → **10**, НО **50**, если у ученика есть активная связь `tutor_students` (`status='active'`) с репетитором, у которого `profiles.subscription_tier='premium'` (valid) ИЛИ `trial_ends_at>now()`.
- Счётчик `daily_message_limits` — **ОДИН на пользователя** (общий: chat + все ДЗ). 50/день — потолок **суммарно**, НЕ «50 на каждое ДЗ» (см. копи-инвариант ниже).
- `tutor_can_upgrade=true` в ответе = маркетинговый сигнал: у ученика есть активный тутор, но НИ ОДИН не платит → фронт показывает «проси репетитора подключить AI-старт».
- На сбое RPC `checkAiQuota` **fail-open** (permissive, `FREE_DAILY_LIMIT=10`), но fallback НЕ консультирует `tutor_students` (homework-boost пропускается) — приемлемая деградация.

**FK-инвариант (rule 40):** paid-tutor детект джойнит `tutor_students.tutor_id → tutors.id`, затем `tutors.user_id = profiles.id`. Write-paths (`claim-invite`, `tutor-manual-add-student`) пишут `tutor_id = tutors.id` (PK, НЕ auth.users.id) + `status='active'`. Если джойн сломать (FK-дрейф) — `v_has_paid_tutor=false` при `v_has_any_tutor=true` → ученики платящего тутора молча капаются на 10.

## Оплата репетитора — paid-статус живёт ТОЛЬКО в `profiles`

**Автоматической оплаты тарифа репетитора «AI-старт» НЕТ.** `yookassa-create-payment` захардкожен под ученический Premium (699₽/30д). В таблице `tutors` полей подписки **нет**. Поэтому «платящий репетитор» = `profiles.subscription_tier='premium'` (valid) ИЛИ trial на его собственном профиле — и больше нигде.

Симптом (инцидент 2026-06-15, Елена): у платящего репетитора профиль не помечен premium (вручную не проставлен / истёк / не та дата) → его ученики молча падают на 10/день в ДЗ; в 429-тосте — подсказка «проси AI-старт» (`tutor_can_upgrade=true`, т.к. активная связь есть, а платящего тутора детект не видит).

## Админ-выдача тарифа (durable, вместо ручного SQL по `profiles`)

Миграция `20260615140000_admin_grant_tutor_plan.sql` — admin-gated (`public.is_admin(auth.uid())` = `has_role(uid,'admin') OR is_admin_email(uid)`) SECURITY DEFINER RPC + append-only аудит-таблица `admin_tutor_plan_grants` (RLS: только админ SELECT; запись только через RPC):
- `admin_list_tutor_plans()` — все туторы + `is_paid` + `active_students`.
- `admin_grant_tutor_plan(p_email, p_expires_at, p_note)` — `subscription_tier='premium'` + `subscription_expires_at`. Errcodes: `NOT_ADMIN`/`USER_NOT_FOUND`/`EMAIL_REQUIRED`/`EXPIRES_REQUIRED`/`EXPIRES_IN_PAST`.
- `admin_revoke_tutor_plan(p_email, p_note)` — обратно в `free`.

UI: `/admin → вкладка «Тарифы»` (`src/components/admin/AdminTutorPlans.tsx` + клиент `src/lib/adminTutorPlansApi.ts`, RU-маппинг errcode→фраза). RPC-имена кастятся `as never` на границе `supabase.rpc` (как `useSubscription`; generated `types.ts` их не несёт — это осознанный escape-hatch, не баг).

**Инвариант:** новый способ пометить репетитора платящим — ТОЛЬКО через `admin_grant_tutor_plan` (аудируется), не raw `UPDATE profiles`. Если появится реальная YooKassa-оплата тарифа репетитора — она пишет те же два поля `profiles` (single source) + аудит-строку.

## Копи-инвариант лимита

Не обещать пользователю «50 в каждом ДЗ» — счётчик общий (50/день суммарно). Канон формулировки: «50 сообщений в день». Tutor-facing Pricing («50 AI-сообщений в день для каждого ученика в ДЗ» = per-student, в homework-контексте) корректен. Студенческая подсказка живёт в `src/lib/apiErrorMessage.ts` (ветка `tutor_can_upgrade`).

## Ключевые файлы
- RPC квоты: `supabase/migrations/20260512134831_*.sql` (+ база `20251208123000`, homework-boost `20260512120000`).
- Shared gate: `supabase/functions/_shared/subscription-limits.ts` (`checkAiQuota`, `buildLimitReachedResponse`, `FREE_DAILY_LIMIT=10`).
- Client: `src/hooks/useSubscription.ts`, `src/lib/apiErrorMessage.ts`.
- Админ-тарифы: `20260615140000_admin_grant_tutor_plan.sql`, `src/components/admin/AdminTutorPlans.tsx`, `src/lib/adminTutorPlansApi.ts`, вкладка в `src/pages/Admin.tsx`.
- Оплата ученика (Premium): `yookassa-create-payment` / `yookassa-webhook` (→ `profiles.subscription_tier='premium'` + `subscription_expires_at`).
