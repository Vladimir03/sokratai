# CEO-аналитика «Пульс» + вкладка «Аналитика» (`/admin`)

Фаундер-дашборд для data-driven решений на pre-PMF (3 платящих / ~50 репетиторов / ~150 учеников). Ядро — **воронка активации ПОИМЁННО** (кликнул ступень → список конкретных репетиторов «кому написать»), а не проценты: на 5 регистрациях в неделю агрегаты = шум. Реализовано 2026-07-15 (main `4f7c303`…`7087cf2`, ревью ChatGPT-5.6 закрыто). Spec: `docs/delivery/features/ceo-analytics/spec.md`. Build-лог: memory `project_ceo_analytics_pulse_2026_07_15.md`. План (все 3 этапа): `~/.claude/plans/proud-growing-mist.md`.

## Вкладки `/admin` (после чистки 2026-07-15)

**Пульс (default)** · Аналитика · CRM · Репетиторы · AI-качество · Тарифы · Платежи · Ошибки. **Удалены:** Бизнес, Открытия, ДЗ (был дубль Репетиторов — тот же `AdminHomeworkChats`, но Репетиторы рендерят его С датами = superset), Пробники (осталась выжимка `AdminAiQuality` = бывший `MockQualityPane`; edge `admin-mock-exams` ЖИВ — его зовёт AI-качество). Edge `admin-business-dashboard` / `admin-product-discovery` удалены из репо (на сервере — сироты). Новую вкладку не добавлять без явного решения: цель админки — минимум поверхностей, каждая = отдельное решение фаундера.

## Пульс — архитектура

- **Вся агрегация — `supabase/functions/_shared/ceo-pulse.ts::computePulse(db, now)`** (не в edge-хендлере: Stage-2 Telegram-дайджест переиспользует ту же функцию). Edge `admin-ceo-dashboard` = тонкая обёртка (auth-зеркало `admin-business-dashboard`: anon getUser → service_role → `rpc is_admin` → 403; rule 97 flat-ошибки). Один POST, пустой body.
- **Клиентское зеркало типов — `src/components/admin/pulse/pulseTypes.ts`** (Deno-модуль не импортируется в браузер; конвенция «mirror locally» как `attachment-refs`/`checkFormatHelpers`). **Меняешь shape → правь ОБА файла.**
- Компоненты: `pulse/PulseDashboard` (контейнер) + `PulseHeader` / `PulseFunnel` / `PulseStageTutorList` / `PulseChannels` / `PulseAtRisk` / `PulseMetricCard` / `PulseBadges` / `EditTutorTagsDialog` (последние два — перенос из удалённой `business/`; диалог пишет `tutor_pilot_crm` напрямую под admin-RLS, монтировать с `key={tutorId}`).

## Инварианты расчётов (ревью ChatGPT-5.6 — НЕ откатывать)

- **Источник правды воронки — ДОМЕННЫЕ таблицы, НЕ `analytics_events`** (та пишется только с 2026-07-01 → старые когорты невидимы). События — для будущих точных дат и канала, не для стадий.
- **Воронка = 6 ПОВЕДЕНЧЕСКИХ ступеней + 2 НЕЗАВИСИМЫЕ коммерческие (КРИТИЧНО).** `PulseTutor.stage` = 1..6 (`registered` → `student_added` → `hw_created` → `hw_sent` → `student_opened` → `student_submitted`), max-достигнутое, счёт «дошло ≥ k» монотонен. **Триал/оплата НИКОГДА не входят в `max(stage)`:** `trial_ends_at` выдаётся при регистрации автоматически (`trial_intent` из `TutorSignupTrial`) → иначе репетитор без единого ученика получал бы stage=7 и «проходил» всю продуктовую воронку (P0 ревью). Ступени `trial`/`paid` — исторические факты (`trialEverIds`/`paidEverIds`), их `stuck` = «в триале без оплаты» / «дошедшие»; монотонность с 1..6 НЕ гарантируется намеренно.
- **Деривации стадий** (FK-дрейф rule 40 — маппинг `tutors.user_id ↔ tutors.id` обязателен): ученик → `tutor_students.tutor_id = tutors.id`; ДЗ → `homework_tutor_assignments.tutor_id = auth.users.id`; отправлено → `COALESCE(hsa.notified_at, assignment.created_at)` (**у `homework_tutor_student_assignments` НЕТ `created_at`**); открыл → существование `homework_tutor_threads` (создаётся лениво при первом открытии учеником); сдал → `thread_messages.message_kind IN ('submission','answer')` при `role='user'` ИЛИ `thread.status='completed'` (legacy-когорты).
- **Каналы — ТОЛЬКО исторические факты**: `reachedValue` (stage ≥ 6) + `paidEver` (реальный `payments`, ручные гранты исключены). Текущий `isTrial`/`isPaying` как «конверсия канала» ЗАПРЕЩЁН (авто-триал ≠ конверсия; оплативший исчезал бы из trials, ручной грант выглядел бы оплатой). Нет `profiles`-строки → канал `unknown` «Без атрибуции», НЕ «Органика» (иначе дрейф данных «улучшает» органику).
- **MRR = run-rate**, не выручка: Σ **NET**-суммы ПОСЛЕДНЕГО succeeded-платежа `plan='tutor_ai_start'` каждого репетитора за 35 дней (30 подписки + 5 grace), где `net = amount − refunded_amount` (clamp на 0; возвраты учитываются с миграции `20260715130000` — механика в rule 99). Ручные гранты НЕ в MRR (но в «Платящие» = валидный premium из `profiles`, `expires_at IS NULL` = бессрочный). Δ = сравнение двух rolling-снапшотов, подписывать «Δ run-rate», не «за неделю». **`mrrAt` SELECT'ит `payments.refunded_amount` → миграция `20260715130000` ОБЯЗАНА быть применена до деплоя edge** (иначе PostgREST «column does not exist» уронит весь Пульс — класс инцидента rule 45 от 2026-06-08).
- **NSM «Weekly Value Tutors»** = репетиторы, чей ученик сдал ДЗ за 7 дней (окна `[−7d, now]` и `[−14d, −7d)` не пересекаются). **At-risk** = (платит ∨ триал) ∧ (нет сдач 7 дней ∨ ручная метка `tutor_pilot_crm.risk_status='at_risk'`).
- **Пагинация обязательна + стабильный `.order()`**: PostgREST молча режет на 1000 строк (`fetchAll`), а offset-страницы без детерминированного порядка дублируют/теряют строки на границах. Новая выборка в `ceo-pulse.ts`/`admin-analytics` → `fetchAll` + `.order('id')` (или `created_at, id`).

## Вкладка «Аналитика» (`admin-analytics`) — инварианты после аудита

- **Активность = AI-чат ученика (`chat_messages`, `role='user'`) ∪ треды ДЗ (`homework_tutor_thread_messages`, `role ∈ {user,tutor}`, по `author_user_id`).** Раньше видела только AI-чат → репетиторы, работающие в ДЗ, числились неактивными. Новый источник активности (напр. чат репетитор↔ученик, rule 100) → добавлять в `fetchActivityInRange`, а не считать отдельно.
- **Все календарные бакеты — МОСКОВСКИЕ** (`mskDay()`, UTC+3 без DST): «сегодня», дни графиков, дни ретеншна. Границы диапазона парсятся как `+03:00`; клиент (`Admin.tsx`) шлёт `format(date,'yyyy-MM-dd')`, **НЕ `toISOString()`** (в МСК полночь 15-го = 14-е UTC → весь диапазон уезжал на день).
- **Ретеншн/воронка — только само-зарегистрированные**: `registration_source='manual'` (placeholder-ученики, заведённые репетитором; маркер ставит `tutor-manual-add-student`) исключены — их `created_at` = дата заведения карточки, а не начала использования, они хоронили D1/D7. В графике регистраций они ОСТАЮТСЯ.
- Ретеншн DN — активность РОВНО в день N (bounded day-N); когорта зрелая **только после ЗАВЕРШЕНИЯ** целевого дня (`targetDay >= todayMsk` → `-1` «рано»), иначе идущий день читался как финальные 0%.
- Premium-сегмент: `subscription_expires_at IS NULL` = бессрочный (ручной грант) — валиден. `totalMessages` = сообщения пользователей (без ответов AI). «Активных сегодня» = **уникальные пользователи**, не строки.
- Формулы метрик дублируются в tooltip'ах фронта (`AdminSummaryCards`/`AdminRetentionCards`/`AdminFunnelChart`) — при правке формулы синхронно править текст.

## Прочее

- **Тарифы**: сортировка платящие → триал → остальные (внутри: `active_students DESC`, имя) — **клиентская** (`useMemo` в `AdminTutorPlans`); RPC `admin_list_tutor_plans` (`ORDER BY is_paid ASC`) НЕ трогать (money-adjacent, отдельная миграция ради сортировки не нужна).
- `fetchAnalytics` гейтится активной вкладкой (`tab === "analytics"`) — Пульс должен открываться мгновенно. Новая тяжёлая вкладка → тот же гейт.

## Пре-воронка «до регистрации» (Яндекс.Метрика, 2026-07-15)

`_shared/metrika.ts::computePreFunnel()` — агрегаты счётчика 105827612 за 7 МСК-дней + дельты: визиты лендинга `/` (ym:pv:users), Σ CTA-целей, открытия формы (`tutor_landing_trial_signup_started`), QR-визиты `/egor`. Вызывается внутри `computePulse` параллельно с DB (fail-safe: нет `METRIKA_API_TOKEN`/API упал → `available:false`, блок скрыт, Пульс жив). UI — `PulsePreFunnel.tsx` над воронкой.
- **Пре-воронка принципиально АНОНИМНА** (агрегаты) — до регистрации имён не бывает; поимённость начинается со ступени «Регистрация».
- **Готча Метрики: `reachGoal` с фронта ИГНОРИРУЕТСЯ, пока цель не заведена в интерфейсе** (Цели → JavaScript-событие с тем же идентификатором). Цели резолвятся runtime по именам через Management API; незаведённые → `missingGoals` (UI показывает «клики CTA занижены»), НЕ тихий ноль.
- **Новый CTA на лендинге** → добавить цель в `tutorLandingAnalytics.ts` И в `CTA_GOAL_NAMES` (`metrika.ts`) И завести в интерфейсе Метрики — три места.
- Секрет `METRIKA_API_TOKEN` = OAuth-токен Яндекса (право чтения Метрики).

## Stage 2 — Telegram-дайджест (`ceo-telegram-digest`, 2026-07-15)

Edge с guard `SCHEDULER_SECRET` (verbatim `tutor-plan-expiry-reminder`), body `{mode: weekly|daily}`; `verify_jwt=false`. Получатели — секрет `CEO_DIGEST_CHAT_IDS` (comma-separated chat id; получатель ОБЯЗАН хоть раз нажать Start у бота, иначе Telegram 403). Отправка — `_shared/telegram-send.ts` (извлечён из reminder'а; новый потребитель telegram-отправки → импортировать его, не копипастить).
- **weekly** (cron пн 04:00 UTC = 07:00 МСК): реюз `computePulse` — шапка + пре-воронка + движение воронки за 7д (по `stageDates`, полный список репетиторов = Map из stuck-списков поведенческих ступеней) + топ-3 «кому написать» (at-risk → свежие застрявшие 1–4 с подсказкой `STUCK_HINTS`).
- **daily** (cron 05:00 UTC = 08:00 МСК): события за 24ч — новые `tutors` (канал через экспортированный `resolveChannel`), оплаты по `payments.subscription_activated_at` (точный момент активации, не created_at), новые триалы владельцев tutors-строк. **Всё пусто → НЕ шлём** (`outcome='empty'`).
- **Идемпотентность**: `ceo_digest_log` UNIQUE(mode, period_key=МСК-дата), claim-first (upsert ignoreDuplicates → 0 строк = уже обработан); ВСЕ отправки упали → claim снимается + 500 (ручной повтор безопасен). Имена в личку владельцев допустимы (не analytics_events).
- **Cron — через Lovable Management API, НЕ миграцией** (rule 95). Ручной тест: `curl -X POST .../ceo-telegram-digest -H "Authorization: Bearer $SCHEDULER_SECRET" -d '{"mode":"daily"}'`.

## При расширении

Новая метрика Пульса → в `computePulse` + оба типа-зеркала + tooltip с формулой. Новый сигнал активации → решить: поведенческий (в 1..6, монотонно) или коммерческий/статусный (независимый счётчик). Любая новая выборка → `fetchAll` + стабильный `.order()`. Новый канал атрибуции → `resolveChannel` (приоритет: referral > egor/promo > utm > web; отсутствие данных = `unknown`). Новая секция дайджеста → внутрь существующих build*Message (не новый edge). Stage 3 (рефералка v1 attribution-only: `tutors.referral_code` + `profiles.referred_by_code`, **НЕ переиспользовать `promo_code`** — занят BLINOV_20 + anti-leak) — см. spec.
