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

В таблице `tutors` полей подписки **нет**. «Платящий репетитор» = `profiles.subscription_tier='premium'` (valid) ИЛИ trial на его собственном профиле — и больше нигде.

**С 2026-07-02 есть самообслуживание — YooKassa-оплата тарифа «AI-старт»** (см. секцию ниже). До этого тариф выдавался только вручную админом.

Симптом (инцидент 2026-06-15, Елена): у платящего репетитора профиль не помечен premium (вручную не проставлен / истёк / не та дата) → его ученики молча падают на 10/день в ДЗ; в 429-тосте — подсказка «проси AI-старт» (`tutor_can_upgrade=true`, т.к. активная связь есть, а платящего тутора детект не видит).

## Админ-выдача тарифа (durable, вместо ручного SQL по `profiles`)

Миграция `20260615140000_admin_grant_tutor_plan.sql` — admin-gated (`public.is_admin(auth.uid())` = `has_role(uid,'admin') OR is_admin_email(uid)`) SECURITY DEFINER RPC + append-only аудит-таблица `admin_tutor_plan_grants` (RLS: только админ SELECT; запись только через RPC):
- `admin_list_tutor_plans()` — все туторы + `is_paid` + `active_students`.
- `admin_grant_tutor_plan(p_email, p_expires_at, p_note)` — `subscription_tier='premium'` + `subscription_expires_at`. Errcodes: `NOT_ADMIN`/`USER_NOT_FOUND`/`EMAIL_REQUIRED`/`EXPIRES_REQUIRED`/`EXPIRES_IN_PAST`.
- `admin_revoke_tutor_plan(p_email, p_note)` — обратно в `free`.

UI: `/admin → вкладка «Тарифы»` (`src/components/admin/AdminTutorPlans.tsx` + клиент `src/lib/adminTutorPlansApi.ts`, RU-маппинг errcode→фраза). RPC-имена кастятся `as never` на границе `supabase.rpc` (как `useSubscription`; generated `types.ts` их не несёт — это осознанный escape-hatch, не баг).

**Инвариант:** новый способ пометить репетитора платящим — ТОЛЬКО через `admin_grant_tutor_plan` ИЛИ YooKassa-webhook тарифа (оба аудируются в `admin_tutor_plan_grants`), не raw `UPDATE profiles`.

### Промо-скидка BLINOV_20 (egor-qr-onboarding, 2026-07-13)

Ветка −20% в `yookassa-create-payment` поверх серверной цены (см. ниже). **По сохранённому `profiles.promo_code`, НЕ из запроса** (anti-tamper: promo/amount клиент не шлёт). −20% на **band-цену** в течение **первых 6 месяцев подписки** (`!isFirstTutorPayment && paidCount < PROMO_BLINOV_20_WINDOW_MONTHS`) — **интро-месяц исключён** (−20% со 2-го платежа: месяцы 2–6). Ответ несёт `promo_applied/promo_percent/amount_before_promo`; модалка рисует строку скидки. Календарной даты в yookassa НЕТ — **claim-дедлайн 31.12.2026** живёт в `_shared/promo-intent.ts::PROMO_CLAIM_DEADLINES` (после — код не цепляется новым аккаунтам; закреплённые дорабатывают окно). `profiles.promo_code`/`registration_source` пишутся из signUp-метаданных (`persistPromoAttribution`, гейт new+tutor+signup). **При правке тарифной цены — сохранить discount-блок и порядок (скидка ПОСЛЕ intro/band/TEAM-гейтов).** Детали: `docs/delivery/features/egor-qr-onboarding/` + memory `project_egor_qr_onboarding.md`.

## Самообслуживание — YooKassa-оплата тарифа «AI-старт» (2026-07-02)

`yookassa-create-payment` принимает опциональный `plan: 'tutor_ai_start'` (absent → ученический Premium 699₽/30д, byte-identical; неизвестное значение → 400 `UNKNOWN_PLAN`). Инварианты money-path:

- **Цена — ТОЛЬКО сервером** (клиенту не доверяем): интро **200₽** — только действительно новым по **трём** критериям (решение Vladimir 2026-07-02: Елена/Эмилия/Вадим с ручными грантами 200₽ не получают): (а) нет succeeded-оплат `plan='tutor_ai_start'`, (б) нет `action='grant'` строк в `admin_tutor_plan_grants`, (в) нет ДЕЙСТВУЮЩЕГО premium (ловит исторические raw-SQL гранты до аудит-таблицы). Иначе по активным ученикам: ≤10 → **1000₽**, 11–20 → **2000₽**. «Активный» = `tutor_students.status='active' AND archived_at IS NULL` (то же определение, что на фронте). FK-дрейф: счёт через `tutors.id`, не auth uid. **Клиентское зеркало** — RPC `tutor_intro_price_available()` (миграция `20260702140000`, SECURITY DEFINER) → `useTutorIntroAvailable`: гейтит «200 ₽» в hint'ах CTA и кнопке триал-плашки; premium-карточка показывает цену продления по вилке. Правя критерии — синхронно RPC и edge.
- **`NOT_A_TUTOR` gate (КРИТИЧНО):** нет строки `tutors` по `user_id` → 403. Без него ученик купил бы Premium за 200₽ через тариф репетитора (webhook пишет те же поля `profiles`).
- **21+ активных учеников → 409 `TEAM_PLAN_REQUIRED`** (AI-команда, связь через Telegram). UI прячет кнопку оплаты при 21+ (`PayCta` в `TutorTariffSection`), серверный 409 — backstop.
- **Fail-closed на деньгах:** сбой любого lookup'а (tutors/students/prior-payments) → 500 с `code`, не «цена наугад». Tutor-path `dbError` при insert в `payments` → 500 `PAYMENT_SAVE_FAILED` ДО выдачи confirmation token (иначе оплата пройдёт, а вебхук не сможет валидировать → premium молча не включится). Ученический путь оставлен как был (log-and-continue) — отдельный follow-up.
- **`payments.plan`** (миграция `20260702120000`) — trust anchor: вебхук ветвится по **строке payments**, НЕ по `metadata.plan` (body вебхука подделываем; verify_jwt=false).
- **Вебхук (переработан по ревью ChatGPT-5.5, 2026-07-02, P0-фиксы):** YooKassa вебхуки НЕ подписаны → body = сигнал «проверь», не истина. Активация только после **верификации в YooKassa API** `GET /v3/payments/{id}` (shop-credentials; `status==='succeeded' && paid===true`, сумма `Number.isFinite` + матч против строки payments, валюта RUB) — закрыта pre-existing дыра «поддельный POST с известными id/user/amount активировал неоплаченный premium» (била и студенческий флоу). Транзиентный сбой верификации/активации → **500** (YooKassa ретраит до ~24ч); подделка → 200 без активации. Сама активация — **атомарная RPC `yookassa_activate_subscription(p_payment_id)`** (миграция `20260702150000`, SECURITY DEFINER, только service_role): FOR UPDATE claim платежа + расчёт expiry (extend-from-future) + UPDATE profiles + audit-строка тарифа одной транзакцией → конкурентный дубль не продлит дважды; `subscription_days` — из строки payments, НЕ из body. Сбой аудита внутри RPC — RAISE WARNING, premium не откатывается. Общая для ученика и репетитора.
- **Деплой-порядок (КРИТИЧНО):** миграция `payments.plan` ОБЯЗАНА примениться ДО деплоя вебхука — иначе SELECT `plan` роняет валидацию ВСЕХ платежей (включая ученические) и молча сиротит успешные оплаты.
- **Frontend:** `TutorPaymentModal` (`src/components/tutor/TutorPaymentModal.tsx`, зеркало механики студенческого `PaymentModal` — тот НЕ тронут); CTA в `TutorTariffSection` (free/trial/premium-продление) + плашка `TariffNudgeBanner` на Главной (открывает модал сразу). **Успех модал поллит по СВОЕЙ строке `payments.subscription_activated_at` (по `payment_id`, RLS даёт SELECT своих строк), НЕ по `is_premium`** — иначе продлевающий premium-репетитор получал мгновенный ложный success без оплаты (ревью P1-3). Успех → invalidate `['tutor','plan']`. Возврат из redirect-flow → `/tutor/profile?payment=success` (поллинг в `TutorProfile`).
- **Known drift (follow-up):** `admin_list_tutor_plans.active_students` считает без `archived_at IS NULL` → может расходиться с ценовой вилкой.

### Возвраты YooKassa — `payment_refunds` + `payments.refunded_amount` (2026-07-15, ревью ChatGPT-5.6 P1 #4)

Миграция `20260715130000`. Два money-бага одной природы («body вебхука = источник истины») в `yookassa-webhook`:
1. **`refund.succeeded` резолвился по `body.object.id`, но там ID ВОЗВРАТА** (платёж — в `object.payment_id`) → возврат падал в «payment not found», оплата навсегда оставалась `succeeded`, возвращённые деньги считались выручкой (MRR Пульса, rule 101).
2. **Прочие события писали `status: body.object.status` ВСЛЕПУЮ.** Body не подписан → поддельный `payment.canceled` переводил чужую succeeded-оплату в `canceled`: искажение MRR **+ сброс интро-цены 200₽** (`yookassa-create-payment` определяет «первый платёж» отсутствием succeeded-строк → бесконечные 200₽ вместо 1000/2000₽). Теперь статус берётся ТОЛЬКО из `GET /v3/payments/{id}`.

**Инварианты (НЕ откатывать):**
- **Ветка `refund.succeeded` — ДО lookup'а `payments`** (поиск по refund id даёт «not found»). Порядок доверия: body даёт ТОЛЬКО refund id → `GET /v3/refunds/{id}` (те же shop-credentials) даёт истину → строка `payments` ищется по **`payment_id` ИЗ API**. Ни `payment_id`, ни сумма из body не используются — иначе поддельный POST списывал бы произвольную сумму с чужой оплаты. Чужой/несуществующий возврат → API 404 → 200 без записи.
- **Возврат = отдельная append-only строка `payment_refunds`** (PK = YooKassa refund id → повторная доставка идемпотентна by construction; частичных возвратов на платёж может быть несколько). Запись — только SECURITY DEFINER RPC `yookassa_record_refund` (service_role, `REVOKE FROM PUBLIC`); RLS без политик → клиенты видят 0 строк.
- **`payments.refunded_amount` ПЕРЕСЧИТЫВАЕТСЯ из `payment_refunds` внутри RPC под `FOR UPDATE` на платеже, НЕ инкрементится** — дубль вебхука не задваивает. Новый write-path возвратов → через эту RPC.
- **`payments.status` при возврате НЕ меняется** (частичный возврат ≠ отмена; платёж состоялся). Потребители считают `net = amount − refunded_amount` (`ceo-pulse.ts::mrrAt`). Следствие-решение: полностью возвращённый платёж **всё ещё считается «первым платежом»** в интро-цене 200₽ — смена этого = отдельное продуктовое решение владельца.
- **Подписка при возврате НЕ отзывается автоматически** (прежнее продуктовое решение — снимает админ через «Тарифы»).
- **Retry-семантика (уточнена ревью р.2 ChatGPT-5.6 — принцип: 200 ТОЛЬКО когда ретрай гарантированно бесполезен):** транзиент (API/RPC/**lookup строки payments** — `.maybeSingle()`, error≠отсутствие строки/**сбой UPDATE статуса**/**неожиданное исключение**) → 500, YooKassa ретраит до ~24ч; подделка (строки/ресурса нет, mismatch суммы) и битый JSON → 200. **`refund.succeeded` при API-статусе `pending` → 500** (событие финальное, второго не будет; лаг webhook↔API нельзя гасить 200-м), `canceled` → 200 (финал, succeeded уже не станет). **Сбой UPDATE `payments.status` в ветке `payment.succeeded` → 500 ДО активации** (иначе подписка активна при строке `pending` → платёж вне MRR + ложная интро-цена 200₽). Регресс любого из этих пунктов = потерянные money-события.
- **Ops-факты (проверено 2026-07-15, ShopID 1226455):** вебхуки настраиваются ТОЛЬКО в кабинете (**Интеграция → HTTP-уведомления**) — API-метод `POST /v3/webhooks` доступен лишь OAuth-партнёрским приложениям, у нас Basic auth (shopId:secretKey) → программно ни настроить, ни прочитать список нельзя. Подписки: `payment.succeeded` + `payment.canceled` + `refund.succeeded` (последний был включён ЗАДОЛГО до фикса — события возвратов приходили и молча падали в «payment not found»; это и был баг, а не отсутствие подписки). **URL уведомлений переведён с `vrsseotrfmsxpbciyqzc.supabase.co` на `https://api.sokratai.ru/functions/v1/yookassa-webhook`** (оба проверены POST'ом — 200; прокси добавляет ~0.3с). Мотив: если supabase.co потеряет доступность для серверов YooKassa (RU-блокировки, rule 95), прямой URL умрёт молча и оплаты перестанут активироваться. Цена: активация оплат зависит от VPS — смягчено ретраями YooKassa (до ~24ч) и graceful `nginx reload` в `deploy-sokratai`.
- **Исторические возвраты до фикса НЕ восстанавливаются автоматически** — YooKassa не переотправляет старые события. Если в кабинете (Операции) были возвраты — внести вручную вызовом `yookassa_record_refund` под service_role.
- **Deploy-порядок:** миграция ПЕРВОЙ — `ceo-pulse.ts::mrrAt` SELECT'ит `refunded_amount`; edge раньше миграции = «column does not exist» → Пульс 500 (класс инцидента rule 45 от 2026-06-08).

### Round 3 — конверсия (2026-07-02)

- **Нудж об истечении:** edge `tutor-plan-expiry-reminder` (SCHEDULER_SECRET-guard, `verify_jwt=false`, pg_cron через Management API — ops) — premium-репетиторы с `subscription_expires_at` в окне ≤3 дней → каскад telegram (`tutors.telegram_id`) → email (`sendTutorPlanExpiryEmail`, temp-guard). Идемпотентность: `tutor_plan_expiry_reminder_log` UNIQUE `(user_id, expires_at)` (миграция `20260702130000`); продление сдвигает expires_at → новый нудж. Гейт «только tutors-строки» ОБЯЗАТЕЛЕН — premium учеников тоже в profiles.
- **Агрессивный триал-CTA:** `TariffNudgeBanner` при `trialDaysLeft <= 2` показывает кнопку «Подключить за 200 ₽» (открывает `TutorPaymentModal`); 200₽ честно — триал не платил → серверная интро-цена.
- **Social proof:** `yookassa-create-payment` (тарифная ветка) возвращает `paying_tutors_count` (premium-valid + trial-active среди владельцев tutors-строк; fail-open). Модал показывает «Уже N репетиторов…» только при N ≥ 5.
- **Телеметрия воронки:** server — `analytics_events` `tutor_payment_created` (create-payment) + `tutor_payment_succeeded` (webhook, внутри atomic-claim); client — `src/lib/tutorPlanTelemetry.ts` (`tariff_cta_clicked` c source profile_card/home_banner/trial_banner, `payment_modal_opened`, `payment_succeeded`) → console/dataLayer/gtag. CHECK-whitelist analytics_events расширять миграцией.

## Копи-инвариант лимита

Не обещать пользователю «50 в каждом ДЗ» — счётчик общий (50/день суммарно). Канон формулировки: «50 сообщений в день». Tutor-facing Pricing («50 AI-сообщений в день для каждого ученика в ДЗ» = per-student, в homework-контексте) корректен. Студенческая подсказка живёт в `src/lib/apiErrorMessage.ts` (ветка `tutor_can_upgrade`).

## Демо-разбор репетитора — отдельный AI-путь и cap (2026-07-08)

Демо «проверить свою задачу» (сдвиг aha влево, memory `project_activation_aha_left_shift_2026_07_08`) — route `POST /tutor/demo-check` в `homework-api` (reuse `evaluateStudentAnswer`). **Инварианты квоты:**
- **НЕ трогает ученическую дневную квоту** (`checkAiQuota` НЕ зовётся) — это tutor-путь, ученики не страдают.
- **Свой per-tutor дневной cap** = COUNT событий `tutor_demo_check_ran` за сегодня (`analytics_events`, ключ `tutor_id = tutors.id`), дефолт `DEMO_CHECK_DAILY_CAP=10`. Исчерпан → 429 `DEMO_LIMIT_REACHED` → фронт предлагает реальный флоу (собрать ДЗ) / тариф.
- Гейт `is_tutor` (ученик не может использовать как бесплатный грейдер).
- Токены логируются в `token_usage_logs` под `source='demo_check'` (`EvaluateStudentAnswerParams.logSource`; добавлен в `TokenUsageSource`) — не смешивать со стоимостью `homework_check`.
- **Новый tutor-AI-путь** → повторять паттерн: свой cap (не ученическая квота) + `is_tutor`-гейт + отдельный `logSource`. НЕ вешать на `FREE_DAILY_LIMIT`.

## Ключевые файлы
- RPC квоты: `supabase/migrations/20260512134831_*.sql` (+ база `20251208123000`, homework-boost `20260512120000`).
- Shared gate: `supabase/functions/_shared/subscription-limits.ts` (`checkAiQuota`, `buildLimitReachedResponse`, `FREE_DAILY_LIMIT=10`).
- Client: `src/hooks/useSubscription.ts`, `src/lib/apiErrorMessage.ts`.
- Админ-тарифы: `20260615140000_admin_grant_tutor_plan.sql`, `src/components/admin/AdminTutorPlans.tsx`, `src/lib/adminTutorPlansApi.ts`, вкладка в `src/pages/Admin.tsx`.
- Оплата ученика (Premium): `yookassa-create-payment` / `yookassa-webhook` (→ `profiles.subscription_tier='premium'` + `subscription_expires_at`).
