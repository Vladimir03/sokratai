# Feature Spec: Trial Flow — 7 дней бесплатно без карты + soft demotion

**Версия:** v0.1
**Дата:** 2026-05-04
**Автор:** Vladimir + Claude (PM session 2026-05-04)
**Статус:** draft

**Связанные артефакты PM-сессии:**
- HTML mockup всех surfaces — `SokratAI/landing-trial-mockup.html`
- Research конкурентов и рекомендации — `SokratAI/trial-flow-recommendations.md`
- Шаблоны для legacy-репетиторов — `SokratAI/legacy-tutors-personal-message.md`

---

## 0. Job Context

> Trial-flow — это **buying / activation meta-job**. Прямого "use-job" в doc 15 нет, потому что doc 15 описывает работы внутри уже-активированного продукта. Trial — это enabler, без которого репетитор не доходит до своих P0/P1 jobs.

### Какую работу закрывает эта фича?

| Участник | Job | Тип | Ссылка |
|---|---|---|---|
| Репетитор (B2B-1) | **Понять, стоит ли продукт денег, без риска и без друдинга** | Meta-buying | (TODO 🚨: meta-job не каталогизирован в doc 15; зарегистрировать как **B0.1 «Активироваться, не вкладываясь»** при следующей ревизии backlog'а) |
| Репетитор (B2B-1) | P0.1 — Собрать ДЗ по теме после урока | Use-job (enabled by trial) | `15-backlog-of-jtbd-scenarios-sokrat.md §4` |
| Репетитор (B2B-1) | P0.2 — Быстро нарастить новую практику по теме | Use-job (enabled by trial) | `15-backlog-of-jtbd-scenarios-sokrat.md §4` |
| Репетитор (B2B-1) | P1.2 — Сохранить результат в свою базу и переиспользовать | Use-job (enabled by trial) | `15-backlog-of-jtbd-scenarios-sokrat.md §5` |

### Wedge-связка

- **B2B-сегмент:** B2B-1 — индивидуальные репетиторы физики ЕГЭ/ОГЭ, hourly rate 3000–4000 ₽ (`08-wedge-decision-memo-sokrat.md`)
- **B2C-сегмент:** не применимо — фича tutor-only
- **Wedge-promise усиливаемый:** «собрать ДЗ за 5–10 минут» **не существует** для нового репетитора, пока он не зашёл и не попробовал. Trial — основной conversion-механизм для wedge-обещания.

### Pilot impact

Без trial репетитор оценивает продукт по лендингу + 200 ₽ first-month оффер. Гипотеза Vladimir + research RU EdTech (CloudText, Мой Класс, RubiTime, OkoCRM, YCLIENTS): card-friction на новом бренде убивает signup-конверсию ×1.5–2. Trial без карты → +50% signup → +15–25% trial-to-paid (CloudText baseline) = удвоение pilot-cohort за тот же трафик. **Это критический enabler роста pilot KPI**, не optional polish.

---

## 1. Summary

Заменяем «vault gate» (200 ₽ при регистрации) на **7-дневный trial без карты, с полным AI-доступом**. После trial — мягкий demotion на free-tier (оплаты, расписание, профили продолжают работать), либо переход на платный с auto-renewal через ЮKassa.

Доставка двумя фазами по принципу Парето:

- **Phase P0 (1 неделя)** — trial как **маркетинговый оффер**: лендинг-копи + новая signup-страница `TutorSignupTrial.tsx` + миграция `profiles.trial_started_at`. AI **продолжает работать** у всех в P0 — backend-gating не делается. Цель — измерить, увеличивает ли копи signup-конверсию.
- **Phase P1 (2–3 недели)** — полная backend-логика: таблица `tutor_subscriptions`, AI-gating в edge-функциях `chat` / `homework-api/handleCheckAnswer` / `handleRequestHint`, in-app countdown banner, day-7 conversion modal, cron `trial-reminders`, миграция legacy-репетиторов в `paid_grandfathered`.

P2 (Telegram welcome-bot, расширенная email-цепочка дней 1/3/5, A/B тесты 7 vs 14 дней) — отложена в `p2-roadmap.md`, не входит в scope этой спеки.

---

## 2. Problem

### Текущее поведение

Лендинг `sokratai.ru` (`Hero.tsx` / `Pricing.tsx` / `FinalCTA.tsx`) предлагает primary CTA **«Попробовать за 200 ₽ в первый месяц»** с прямым редиректом на `/signup?ref=tutor-landing&tier=ai-start`. После signup — `auth.users` создаётся, `profiles` row создаётся, репетитор попадает на `/tutor/home`. **Никакого backend-trial-механизма не существует** — все авторизованные tutor-юзеры имеют полный AI-доступ. Платёжная ступень 200 ₽ — гипотетическая, реализована частично через ЮKassa для другого продукта (ученический Сократ Premium, см. `supabase/functions/yookassa-create-payment/index.ts`).

`Pricing.tsx` показывает 5 tier'ов: Бесплатно / AI-старт (200 ₽ первый месяц) / AI-плюс (1000 ₽/мес до 10 учеников) / AI-про (2000 ₽/мес до 20) / AI-команда (3000 ₽+ для школ). Перегруженно для нового пользователя.

### Боль

Для репетитора:
- **Card upfront = lost signup.** RU-аудитория не привязывает карту «на пробу» к новому бренду. Hero CTA «Попробовать за 200 ₽» воспринимается как «дай карту прямо сейчас», даже если не списывается. Репетитор закрывает вкладку, не доходит до P0.1 (своего первого ДЗ).
- **5-tier pricing = аналитический паралич.** Репетитор видит «AI-плюс / AI-про / AI-команда» и теряется: «какой мне выбрать?». Когнитивная нагрузка вместо приглашения попробовать.
- **«Попробовать за 200 ₽» противоречит wedge-обещанию «5–10 минут».** Wedge — про скорость до первой ценности (UX-принцип 14 «Первая ценность за 3 минуты»). Любая платежная ступень между лендингом и первой ценностью убивает обещание.

Для бизнеса (Vladimir):
- Гипотеза «карта снижает abandonment» не валидируется в RU EdTech. CloudText.ru (прямой analog), Мой Класс, RubiTime, OkoCRM, YCLIENTS, BigBen, Umai — все 7 дней без карты. Антитренинги — 14 дней.
- Wedge-обещание «5–10 минут» нельзя проверить на новом репетиторе, который не дошёл до AI.

### Текущие «нанятые» решения (из doc 06 / pilot interviews)

- Репетитор смотрит лендинг → закрывает вкладку → продолжает связку **Решу ЕГЭ + Telegram + ChatGPT** (бесплатно, привычно, медленно).
- Репетитор пишет в личку Vladimir/Егор → получает promo-код / руками открытый аккаунт → формальный пилот.
- Один из 8 closed-questions PM-сессии 2026-05-04: «Telegram-канал Егора как warm-up» — частично работает, но trial-юзеров не приводит, конверсия канал→signup ниже чем у личных DM.

### Исследование конкурентов RU EdTech (2026-05-04)

| Сервис | Длительность trial | Карта | После trial |
|---|---|---|---|
| **CloudText.ru** (прямой analog) | 7 дней full | **Нет** | 99 ₽ первый месяц вместо 899 ₽ (anchor −89%) или 1 ₽ первый месяц для скептиков |
| **Мой Класс (moyklass.com)** | 7 дней | **Нет** | Soft demotion на free-tier до 5 групп |
| **RubiTime** | 7 дней | **Нет** («без карты и обязательств» — точная копи) | Платный |
| **OkoCRM** | 7 дней + extension по запросу | **Нет** | Платный |
| **Антитренинги** | 14 дней full | **Нет** | Платный |
| **YCLIENTS, BigBen, Umai** | 7 дней | **Нет** | Платный |

**Стандарт RU EdTech CRM = 7 дней без карты + soft demotion или платный после.** Отклоняться от индустриального паттерна — добавлять friction без обоснования.

---

## 3. Solution

### Описание

**Phase P0** — копи + UX без backend-gating:

1. Hero CTA `«🎁 Попробовать 7 дней бесплатно»` (заменяет «Попробовать за 200 ₽»). Trust-чипы `«Без карты · Полный AI · Потом 200 ₽»`.
2. Pricing упрощается с 5 → **3 главных + 2 дополнительных** карточки. AI-старт highlighted с popular chip «7 дней бесплатно», price-stack `0 → 200 → 1000 ₽/мес` lestnitsa.
3. Telegram-кнопка стилизуется TG-blue (`#229ED9` на фирменный синий, не зелёная outline) — UI-pattern doc 17 §11 «вторичные каналы визуально отличны».
4. Новая страница `TutorSignupTrial.tsx` (single-page form: email + password + предмет + оферта + Telegram OAuth). После signup → `UPDATE profiles SET trial_started_at = NOW()` если URL-param `trial=7`. AI работает у всех (нет backend-gating в P0).
5. Тонкий компонент-диспетчер `SignupRouter.tsx` на route `/signup`: `?ref=tutor-landing` → `<TutorSignupTrial />`, иначе → существующий `<SignUp />` (студенческий путь не трогаем).
6. Yandex Metrika: 5 новых goals для измерения hipothesis trial-копи vs существующая.

**Phase P1** — backend-логика:

7. Таблица `tutor_subscriptions` с `status`, `trial_started_at`, `trial_expires_at`, `paid_until`, `current_tier`, `ai_features_active` (generated column).
8. `<TrialCountdownBanner />` в AppFrame для дней 1–6 trial.
9. `<TrialExpiredDialog />` — Radix blocking modal на день 7+ при `status = trial_expired AND trial_decision IS NULL`.
10. Edge function `tutor-subscription` (GET /me, POST /start-paid, POST /cancel).
11. Cron `trial-reminders` (daily) → email на день 7. Расширенная email-цепочка отложена в P2.
12. AI-gating в edge functions: `homework-api::handleCheckAnswer`, `homework-api::handleRequestHint`, `chat::handleChat` (только когда `guidedHomeworkAssignmentId` — gating по owning tutor, не по student).
13. Migration `paid_grandfathered` для всех текущих tutor-юзеров с cutoff `2026-05-31`.

### Ключевые решения

**A. Trial без карты (Phase P0 + P1)**

- **Choice:** signup-форма не запрашивает карту. `trial_started_at` пишется в `profiles` (P0) и `tutor_subscriptions` (P1) автоматически при создании tutor-аккаунта с `?trial=7`.
- **Why:** RU-аудитория не привязывает карту «на пробу» (research конкурентов §2). Конверсия signup × 3 важнее conversion paid × 0.7. Усиливает **UX-принцип 14 «Первая ценность за 3 минуты»** — карта = friction, который ломает wedge-обещание.
- **Trade-off:** abuse-риск 5% (репетитор регистрирует 2-3 email'а за trial). Vladimir принял риск ради UX 95% (decision из PM-сессии 2026-05-04).
- **Anti-pattern check:** не нарушает `trial-flow-recommendations.md §Anti-patterns #1` (не делать trial с обязательной картой).

**B. 7 дней trial (не 14, не 30)**

- **Choice:** `trial_expires_at = trial_started_at + INTERVAL '7 days'`. Hardcoded в DB DEFAULT и в client-side display.
- **Why:** индустриальный стандарт RU EdTech (research §2). 14 дней — исключение (Антитренинги, не релевантно для AI-продукта где compute-стоимость заметна). 3 дня — agressive funnel, теряет signup'ы.
- **Anti-pattern check:** усиливает doc 16 принцип 15 «Каждая фича усиливает шанс пилота» — 7 дней даёт репетитору достаточно времени увидеть value (1–2 урока), но не растягивает pipeline бесконечно.

**C. Без лимита учеников на trial**

- **Choice:** trial-юзер может добавить любое число учеников (как полноценный AI-про). Никакого `student_count_limit` поля.
- **Why:** CloudText/Мой Класс дают full. Limited trial = anti-pattern (`trial-flow-recommendations.md §Anti-patterns #2` — у юзера нет шанса понять value). Vladimir принял abuse-риск (онлайн-школа регистрирует trial под видом индивидуального репетитора) ради UX честных инд. репетиторов.
- **Trade-off:** mitigation для будущего — IP fingerprint в audit log, отложено в P3.

**D. Soft demotion после trial (не lockout)**

- **Choice:** на день 7+ `status='trial_expired'`, `ai_features_active=false`. Free-tier (оплаты, расписание, профили) **продолжает работать**. AI-edge-functions возвращают `{ error: 'ai_disabled', message: 'Trial завершён. Активируйте подписку.' }`. Базовая платформа не падает.
- **Why:** Мой Класс pattern. Lockout = lost touchpoint навсегда. У Сократа уже есть free-tier с реальной ценностью (`/pay` команда в Telegram, расписание, профили) — soft demotion это естественный следующий шаг, а не выключение.
- **Усиливает UX-принцип 11** «Результаты переиспользуемы» — данные репетитора (ученики, ДЗ-история, оплаты) не теряются.

**E. Без auto-charge через 7 дней**

- **Choice:** `trial_decision = NULL` на день 7 → blocking modal `<TrialExpiredDialog />`. Без карты невозможно технически. Репетитор должен **явно** нажать «Продолжить за 200 ₽» → инициируется ЮKassa-flow с `save_payment_method=true`.
- **Why:** RU-anti-pattern (`trial-flow-recommendations.md §Anti-patterns #1`). Auto-charge без явного согласия = chargeback risk + ущерб бренду. RubiTime подчёркивает «без карты и обязательств» в копи.

**F. Auto-renewal начиная со 2-го месяца**

- **Choice:** карта привязывается в момент оплаты 200 ₽ (1-й месяц) через `payment_method.save = true` в ЮKassa create-payment payload. Со 2-го месяца — auto-charge по числу учеников (1000/2000/3000 ₽). Tier выбирается **вручную** репетитором в первый месяц или **auto-tier** по числу активных учеников (Open Question Q2).
- **Why:** standard SaaS pattern. Покрытие 100% conversion-рисков — без auto-renewal у каждого второго репетитора будет lapse в начале 2-го месяца.
- **Trade-off:** repository не имеет recurring-payment integration в `yookassa-create-payment` (он создан для разовой ученической Premium-оплаты). Расширение — TASK в Phase P1 (Open Question Q6).

**G. Phase P0 = маркетинговый оффер, не gating**

- **Choice:** в P0 trial — это **только копи + UX**, без AI-gating. Все репетиторы (новые и существующие) сохраняют полный AI-доступ. Цель — измерить, **увеличивает ли копи** signup-конверсию.
- **Why:** Парето. Если копи не работает на signup-фазе, gating-машинерия P1 — тратa 2-3 недель впустую. Сначала валидируем top of funnel, потом строим bottom.
- **Risk:** репетитор регистрируется на trial → AI работает после 7 дней → создаётся ожидание «trial всегда продолжается» → frustration в P1 deploy. Mitigation: P0 deploy окно ≤ 14 дней, P1 deploy сразу после валидации.

**H. Legacy-репетиторы → `paid_grandfathered` cutoff 2026-05-31**

- **Choice:** в P1 миграция backfill всех существующих tutor-юзеров: `INSERT INTO tutor_subscriptions (user_id, status, trial_started_at, paid_until) VALUES (id, 'paid_grandfathered', created_at, '2026-05-31T23:59:59Z')`. До cutoff — AI работает. После cutoff — soft demotion / просьба подписаться.
- **Why:** Vladimir знает каждого пилота лично. Hard cutoff без прелюдии = разрыв отношений. Personal TG-сообщения по шаблонам `legacy-tutors-personal-message.md` (3 варианта) идут параллельно за 2 недели до cutoff.
- **Не нарушает doc 16 принцип 12** «Надёжность > эффектность» — даём репетитору 2+ недели на решение, не выключаем рубильник.

**I. Telegram-канал Егора в P0 — без изменений**

- **Choice:** в P0 кнопка `Канал Егора →` ведёт на `t.me/sokrat_rep` (как сейчас). Welcome-bot, pinned posts, inline-кнопки — отложены в P2.
- **Why:** канал «сырой» (2 поста), нет владельца контента. Welcome-bot требует contracts с Егором + content production. P0 не блокируется этим — канал работает как passive warm-up для скептиков, signup-conversion измеряется отдельно по trial-CTA.
- **Visual change в P0:** TG-blue стиль кнопки (UI doc 17 §11) — это копи/UX задача без backend.

---

## 4. Scope

### IN — Phase P0 (1 неделя)

- **P0-1** (P0) Hero copy update: chip + h1/lede + primary CTA «🎁 Попробовать 7 дней бесплатно» + trust-чипы «Без карты · Полный AI · Потом 200 ₽»
- **P0-2** (P0) Pricing simplification: 5 → 3 главных + 2 дополнительных карточки. AI-старт highlighted с popular chip «7 дней бесплатно», price-stack 0 → 200 → 1000
- **P0-3** (P0) Telegram-кнопка → TG-blue стиль (`#229ED9`)
- **P0-4** (P0) `TutorSignupTrial.tsx` — single-page форма (email + password + subject + оферта + TG OAuth fallback)
- **P0-5** (P0) `SignupRouter.tsx` — disambiguator на `/signup`: `?ref=tutor-landing` → TutorSignupTrial, иначе → SignUp (student)
- **P0-6** (P0) Migration: `ALTER TABLE profiles ADD COLUMN trial_started_at TIMESTAMPTZ NULL` + partial index
- **P0-7** (P0) Yandex Metrika goals: 5 новых (`tutor_landing_cta_trial_hero`, `..._pricing`, `..._final`, `tutor_landing_trial_signup_started`, `..._completed`)
- **P0-8** (P1) FreemiumBridge + FAQ + FinalCTA copy update
- **P0-9** (P1) FAQ — добавить новый Q «Что будет с моими данными после trial?»
- **P0-10** (P1) Compare-блок «Было / Стало» в Hero (под trust-чипами)

### IN — Phase P1 (2–3 недели)

- **P1-1** (P0) Migration: `CREATE TABLE tutor_subscriptions` + RLS + индексы
- **P1-2** (P0) Migration: backfill legacy-репетиторов в `paid_grandfathered` с `paid_until = 2026-05-31`
- **P1-3** (P0) Helper `subscription-gating.ts` (`checkTutorAiAccess(db, userId)`)
- **P1-4** (P0) AI-gating в `homework-api/index.ts::handleCheckAnswer` + `handleRequestHint`
- **P1-5** (P0) AI-gating в `chat/index.ts` (только при `guidedHomeworkAssignmentId` — gating по owning tutor)
- **P1-6** (P0) Edge function `tutor-subscription` (GET /me, POST /start-paid, POST /cancel)
- **P1-7** (P0) `<TrialCountdownBanner />` в AppFrame, дни 1–6
- **P1-8** (P0) `<TrialExpiredDialog />` — Radix blocking modal на день 7+
- **P1-9** (P1) Cron `trial-reminders` daily — email на день 7 + день 14 reactivation
- **P1-10** (P1) Email templates `trial-day-7.ts` + `trial-day-14.ts`
- **P1-11** (P1) ЮKassa расширение: `payment_method.save = true` flag + recurring charge

### OUT (явно НЕ в этой спеке)

- A/B тест 7 дней vs 14 дней — отложено, нужны baseline-данные
- A/B тест без-карты vs с-картой — отложено, P3 при trial→paid < 15%
- Trial extension по запросу (OkoCRM-pattern) — операционная нагрузка, отложено в P2 при 50+ trial-юзерах
- «1 ₽ первый месяц» альтернативный оффер для скептиков — P3
- Push-уведомления о trial countdown — P2 (web push tutor-side currently NOT mounted, см. `.claude/rules/95-production-deploy.md` «Future improvements»)
- Telegram welcome-bot — P2
- Trial-juicing protection (IP fingerprint audit log) — P3 если abuse > 10%
- Auto-tier selection по числу учеников — P2 (Open Question Q2)
- Bulk-операции для legacy migration через UI — N/A (manual personal TG/email)

### LATER (Phase P2+, см. `p2-roadmap.md`)

- Telegram welcome-bot для unidentified users
- Email-цепочка дней 1, 3, 5 (сейчас только day-7)
- A/B тесты длительности trial и payment method requirement
- Trial extension dialog
- Push-уведомления о countdown (требует tutor opt-in surface)

### High-risk файлы — не трогаем

`AuthGuard.tsx`, `TutorGuard.tsx`, `Chat.tsx`, `TutorSchedule.tsx`, `telegram-bot/index.ts` — не модифицируются в этой спеке (per `.claude/rules/10-safe-change-policy.md`). Existing `SignUp.tsx` для учеников — не трогается, делаем отдельный `TutorSignupTrial.tsx`.

---

## 5. User Stories

### Репетитор (новый, через лендинг)

> Когда я зашёл на sokratai.ru первый раз и Hero CTA говорит «Попробовать за 200 ₽», я закрываю вкладку — карта upfront для нового бренда означает риск без причины. Я хочу видеть «7 дней бесплатно без карты», чтобы попробовать без обязательств.

> Когда я нажал «🎁 Попробовать 7 дней бесплатно», я хочу увидеть однострочную signup-форму (email + пароль + предмет), чтобы за 30 секунд попасть в кабинет и начать собирать первое ДЗ.

> Когда я создал первое ДЗ через AI и оно сэкономило мне 20 минут, я хочу видеть в шапке кабинета счётчик «Осталось 5 дней пробного» с кнопкой «Что я получу за 200 ₽», чтобы оценить дальнейшее.

> Когда trial закончился и я ещё не решил, я хочу попасть на blocking modal с явным CTA «Продолжить за 200 ₽» (НЕ auto-charge), чтобы решение было моим, не списанием.

> Когда я не готов платить прямо сейчас, я хочу нажать «Остаться на бесплатной» и продолжить пользоваться оплатами учеников и расписанием, чтобы сохранить отношения с продуктом для возможного возврата.

### Репетитор (legacy, был в пилоте)

> Когда я получил от Vladimir/Егора personal TG-сообщение «выходим на платную модель», я хочу увидеть конкретную дату cutoff и spec'оффер «100 ₽ первый месяц для legacy», чтобы решить осознанно, а не наткнуться на blocking modal случайно.

> Когда я не активировал подписку до cutoff и зашёл в кабинет на день N+1, я хочу увидеть тот же blocking modal что и trial-юзер (явный CTA, без автосписания), чтобы понять что произошло и принять решение.

### Родитель / Школьник

Не применимо — фича tutor-only. Student signup (`/signup` без `?ref=tutor-landing`) не затрагивается.

---

## 6. Technical Design

### 6.A. Phase P0 — Frontend + минимальная DB

#### Затрагиваемые файлы

| Файл | Тип | Изменение |
|---|---|---|
| `src/components/sections/tutor/Hero.tsx` | edit | Primary CTA → «🎁 Попробовать 7 дней бесплатно». Trust-чипы. Telegram-кнопка → TG-blue. URL signup_url → `/signup?ref=tutor-landing&trial=7`. Telemetry `tutor_landing_cta_trial_hero`. Compare-блок «Было / Стало» (P1) под trust-чипами. |
| `src/components/sections/tutor/Pricing.tsx` | edit | TIERS array: 5 → 3 главных + 2 дополнительных. AI-старт highlighted с popular chip «7 дней бесплатно» + price-stack `0 ₽ → 200 ₽ → 1000 ₽/мес`. Нижние 2 (1000/2000) — компактные cards. Telemetry `tutor_landing_cta_trial_pricing`. |
| `src/components/sections/tutor/FreemiumBridge.tsx` | edit | Closing copy update (1 строка) — «AI-слой подключается опционально — 7 дней бесплатно, потом 200 ₽ первый месяц». |
| `src/components/sections/tutor/FAQ.tsx` | edit | Update Q «Сколько стоит и есть ли пробный?» + новый Q «Что будет с моими данными после trial?». |
| `src/components/sections/tutor/FinalCTA.tsx` | edit | CTA copy + lede update. Telemetry `tutor_landing_cta_trial_final`. |
| `src/lib/tutorLandingAnalytics.ts` | edit | Расширить `TutorLandingGoal` union: `tutor_landing_cta_trial_hero`, `tutor_landing_cta_trial_pricing`, `tutor_landing_cta_trial_final`, `tutor_landing_trial_signup_started`, `tutor_landing_trial_signup_completed`. Существующие goals НЕ удаляем (нужны для baseline-сравнения). |
| `src/pages/TutorSignupTrial.tsx` | **new** | Single-page форма. Поля: email, password, subject (select из SUBJECTS), оферта-чекбокс. TG OAuth fallback (`<TelegramLoginButton />`). После signup → `UPDATE profiles SET trial_started_at = NOW()` если URL `trial=7`. После success → navigate `/tutor/home`. |
| `src/pages/SignupRouter.tsx` | **new** | Тонкий disambiguator: читает `useSearchParams`, `ref === 'tutor-landing'` → `<TutorSignupTrial />`, иначе → `<SignUp />`. Обе страницы lazy-imported. |
| `src/App.tsx` | edit | Заменить existing `/signup` route element с `<SignUp />` на `<SignupRouter />`. Обе lazy. |
| `src/pages/Index.tsx` | edit | Hero CTA URL теперь приходит из Hero.tsx, но meta-description можно обновить. |
| `index.html` | edit | OG-tags meta description: «Попробуйте Сократ AI 7 дней бесплатно. AI проверяет рукописные ДЗ по физике…» |
| `supabase/migrations/20260505100000_add_trial_started_at_to_profiles.sql` | **new** | `ALTER TABLE profiles ADD COLUMN trial_started_at TIMESTAMPTZ NULL` + `COMMENT ON COLUMN profiles.trial_started_at ...` + `CREATE INDEX idx_profiles_trial_started_at ON profiles(trial_started_at) WHERE trial_started_at IS NOT NULL`. |

#### Не трогаем в P0

- `AuthGuard.tsx`, `TutorGuard.tsx` — guard-логика
- `SignUp.tsx` — student signup (отдельный путь, остаётся как есть)
- Edge functions — все
- AI-функции — продолжают работать у всех

### 6.B. Phase P1 — Backend gating + UI banner/dialog

#### Затрагиваемые файлы

| Файл | Тип | Изменение |
|---|---|---|
| `supabase/migrations/20260512100000_create_tutor_subscriptions.sql` | **new** | `CREATE TABLE tutor_subscriptions` + RLS policies + индексы |
| `supabase/migrations/20260512100100_backfill_legacy_tutors_grandfathered.sql` | **new** | `INSERT INTO tutor_subscriptions ... SELECT FROM profiles JOIN auth.users WHERE has_tutor_role(...) ON CONFLICT DO NOTHING`, `paid_until = '2026-05-31T23:59:59Z'`, `status = 'paid_grandfathered'`. |
| `supabase/functions/_shared/subscription-gating.ts` | **new** | Экспортирует `checkTutorAiAccess(db, tutorUserId)` → `{ allowed: boolean, reason?: 'trial_expired' \| 'paid_lapsed' \| 'never_started' }`. Single source of truth для gating-логики. |
| `supabase/functions/chat/index.ts` | edit | Импортирует `checkTutorAiAccess`. **Только** при `guidedHomeworkAssignmentId` в body — резолвит owning tutor через `homework_tutor_student_assignments → homework_tutor_assignments.tutor_id` → проверяет access. Если `!allowed` → `return new Response(JSON.stringify({ error: 'ai_disabled', reason }), { status: 402 })`. **Обычные** /chat запросы (не guided) — НЕ gated в P1 (это student-side, не tutor-side). |
| `supabase/functions/homework-api/index.ts::handleCheckAnswer` | edit | Перед `evaluateStudentAnswer` — резолвит owning tutor (через `student_assignment.assignment_id → assignment.tutor_id`) → checkTutorAiAccess. Если `!allowed` → 402 с `reason`. |
| `supabase/functions/homework-api/index.ts::handleRequestHint` | edit | Аналогично handleCheckAnswer. |
| `supabase/functions/tutor-subscription/index.ts` | **new** | `GET /me` (читает `tutor_subscriptions` для `auth.uid()`), `POST /start-paid` (создаёт ЮKassa payment с `save_payment_method=true`), `POST /cancel` (отменяет recurring). |
| `supabase/functions/trial-reminders/index.ts` | **new** | Cron daily. Находит users где `status='trial_active' AND trial_expires_at < NOW() + INTERVAL '1 day'` → переводит в `trial_expired` + отправляет day-7 email. На день 14 — reactivation email если `trial_decision='no_action'`. Расширенная цепочка дней 1/3/5 — отложена в P2. |
| `supabase/functions/_shared/transactional-email-templates/trial-day-7.ts` | **new** | Plain TS template, inline styles, zero npm deps (как `homework-notification.ts`, см. `.claude/rules/70-notifications.md`). |
| `supabase/functions/_shared/transactional-email-templates/trial-day-14.ts` | **new** | Reactivation template. |
| `supabase/functions/yookassa-create-payment/index.ts` | edit | Расширение для tutor-flow: distinguish через `metadata.flow` (e.g., `'tutor-trial-paid'` vs `'student-premium'`). Add `payment_method.save = true` для tutor-flow → возвращает `payment_method.id` после первого charge → сохраняем в `tutor_subscriptions.yokassa_payment_method_id` для recurring. |
| `supabase/functions/yookassa-webhook/index.ts` | edit | На `payment.succeeded` с `metadata.flow='tutor-trial-paid'` → `UPDATE tutor_subscriptions SET status='paid_active', paid_until=NOW()+INTERVAL '30 days', current_tier='ai-start-200', yokassa_payment_method_id=p.payment_method.id, trial_decision='paid', trial_decision_at=NOW() WHERE user_id=metadata.user_id`. |
| `src/lib/tutorSubscriptionApi.ts` | **new** | Client wrapper: `fetchMySubscription()`, `startPaidSubscription({ tier })`, `cancelSubscription()`. |
| `src/hooks/useTutorSubscription.ts` | **new** | React Query hook. Query key `['tutor', 'subscription']` (per `.claude/rules/performance.md` query key convention). |
| `src/components/tutor/chrome/TrialCountdownBanner.tsx` | **new** | Top-bar внутри `<main className="t-app__main">`. Показывается когда `subscription?.status === 'trial_active'`. Текст «Осталось N дней пробного. [Что я получу за 200 ₽]». N = `Math.ceil((trial_expires_at - NOW()) / 86400000)`. Hideable session-only (не persist в DB). |
| `src/components/tutor/chrome/TrialExpiredDialog.tsx` | **new** | Radix Dialog blocking. Показывается когда `subscription?.status === 'trial_expired' && subscription?.trial_decision === null`. Нет close-button, нет backdrop-dismiss. Primary CTA «Продолжить за 200 ₽» → POST /tutor-subscription/start-paid → ЮKassa redirect. Secondary CTA «Остаться на бесплатной» → POST /tutor-subscription с `trial_decision='declined'` → dialog закрывается, AI остаётся выключенным. |
| `src/components/tutor/chrome/AppFrame.tsx` | edit | Минимально: добавить `<TrialCountdownBanner />` и `<TrialExpiredDialog />` под `<MobileTopBar />`. Не менять guard-логику. Не менять структуру AppFrame (per `.claude/rules/10-safe-change-policy.md` AppFrame инвариант). |

#### Data Model — `tutor_subscriptions`

```sql
CREATE TABLE public.tutor_subscriptions (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN (
    'trial_active', 'trial_expired', 'paid_active',
    'paid_grandfathered', 'cancelled', 'free'
  )),
  trial_started_at TIMESTAMPTZ NOT NULL,
  trial_expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  paid_until TIMESTAMPTZ NULL,
  current_tier TEXT NULL CHECK (current_tier IN (
    'ai-start-200', 'ai-plus-1000', 'ai-pro-2000', 'ai-team'
  )),
  trial_decision TEXT NULL CHECK (trial_decision IN ('paid', 'declined', 'no_action')),
  trial_decision_at TIMESTAMPTZ NULL,
  yokassa_subscription_id TEXT NULL,
  yokassa_payment_method_id TEXT NULL,
  ai_features_active BOOLEAN GENERATED ALWAYS AS (
    (status = 'trial_active' AND trial_expires_at > NOW())
    OR (status IN ('paid_active', 'paid_grandfathered', 'cancelled') AND paid_until > NOW())
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tutor_subs_trial_expiring
  ON public.tutor_subscriptions(trial_expires_at) WHERE status = 'trial_active';

CREATE INDEX idx_tutor_subs_paid_renewing
  ON public.tutor_subscriptions(paid_until) WHERE status IN ('paid_active', 'paid_grandfathered');

ALTER TABLE public.tutor_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tutor reads own subscription"
  ON public.tutor_subscriptions FOR SELECT
  USING (user_id = auth.uid());
-- writes ONLY via service_role (edge functions). Никаких client-side INSERT/UPDATE/DELETE policies.

GRANT SELECT ON public.tutor_subscriptions TO authenticated;
```

#### Multiple write-paths invariant (per `.claude/rules/40-homework-system.md` правило 0)

`tutor_subscriptions` имеет **множественные write-paths**:

1. **Client-side trial signup** (P0 + P1): `TutorSignupTrial.tsx` после `supabase.auth.signUp()` → upsert `profiles.trial_started_at` (P0) + INSERT в `tutor_subscriptions` через edge function `tutor-subscription` POST `/start-trial` (P1)
2. **Backfill migration** (P1): `20260512100100_backfill_legacy_tutors_grandfathered.sql` → INSERT для всех существующих tutor-юзеров
3. **ЮKassa webhook** (P1): `yookassa-webhook/index.ts` на `payment.succeeded` → UPDATE на `paid_active`
4. **Cron `trial-reminders`** (P1): UPDATE `status` с `trial_active` → `trial_expired` на день 7
5. **`tutor-subscription` edge function** (P1): POST `/cancel` → UPDATE `status='cancelled'`

При добавлении новой колонки в `tutor_subscriptions` (e.g., `whatsapp_notification_consent`, `referral_source`) — **обязательно** проверить все 5 write-paths и обновить там, где field семантически применим. Симптом пропуска: «UI заполняет поле через signup, но cron перетирает на NULL при переводе в trial_expired».

Алгоритм проверки перед merge:
```bash
grep -rn "from('tutor_subscriptions')\.insert\|from('tutor_subscriptions')\.update\|INSERT INTO tutor_subscriptions\|UPDATE tutor_subscriptions" src/ supabase/
```

### 6.C. RLS на `profiles.UPDATE` для self-write `trial_started_at` (Open Question Q5 🚨 Verify before T0)

P0 пишет `profiles.trial_started_at` после `auth.signUp` — клиент должен иметь право на UPDATE своей profile-row. Проверить:

```bash
grep -rn "CREATE POLICY.*profiles.*UPDATE" supabase/migrations/
```

T0 verify result (2026-05-05): базовая миграция `20251004081630_b608a657-835e-403d-bbd6-56a5c180af06.sql` уже содержит policy `Users can update their own profile` (`FOR UPDATE USING (auth.uid() = id)`) без column-mask. Поэтому P0-6/T4 миграция `trial_started_at` не расширяет RLS.

Если в будущем policy будет удалена или column-masked — добавить в P0-6 миграцию idempotent RLS-расширение. **Без этой проверки P0-4 (TutorSignupTrial) сломается на write step.**

---

## 7. UX-принципы + UI-паттерны

### UX-принципы (из `16-ux-principles-for-tutor-product-sokrat.md`)

- **Принцип 1 «Jobs-first»** — Hero CTA говорит про job («попробовать»), не про technology («AI-trial»). Comment в Hero.tsx top: `// Job: B0.1 Активироваться, не вкладываясь, чтобы дойти до P0.1`.
- **Принцип 2 «Один экран = одна главная работа»** — на Hero ровно один primary CTA («Попробовать 7 дней бесплатно»). Telegram-кнопка — secondary outline. На `TutorSignupTrial` ровно один primary («Создать аккаунт»). На `TrialExpiredDialog` ровно один primary («Продолжить за 200 ₽»).
- **Принцип 3 «Recognition over recall»** — Pricing card AI-старт показывает price-stack визуально (`0 → 200 → 1000`) — репетитор узнаёт лестницу, не вычисляет.
- **Принцип 7 «Progressive disclosure»** — 3 главных + 2 компактных pricing card'а. Compare-блок «Было / Стало» под trust-чипами collapsible (P1 priority).
- **Принцип 10 «Названия описывают работу, не технологию»** — «🎁 Попробовать 7 дней бесплатно», не «Activate AI trial». TrialCountdownBanner: «Осталось 5 дней пробного», не «AI subscription expires in 5 days».
- **Принцип 12 «Надёжность > эффектность»** — TrialExpiredDialog blocking, но **без auto-charge**. Все transitions (trial_active → trial_expired) объясняются понятным текстом. AI-gating-error в edge function возвращает `reason` для UI'а, не silent fail.
- **Принцип 14 «Первая ценность за 3 минуты»** — central rationale всей фичи. Сейчас «карта upfront» ломает 3-min обещание. После trial — сразу в `/tutor/home`, никакого wizard'а из 5 шагов.
- **Принцип 15 «Каждая фича усиливает шанс пилота»** — trial enabled top-of-funnel расширения, без которого pilot-cohort не растёт быстрее. Усиливает все P0/P1 use-jobs (P0.1, P0.2, P1.2).
- **Принцип 17 «Экспорт и шаринг — часть workflow»** — не применимо напрямую, но trial-CTA на лендинге + Telegram-канал — часть acquisition workflow.

### UI-паттерны (из `17-ui-patterns-and-component-rules-sokrat.md`)

- **§2.1 «Один экран = один primary CTA»** — Hero, Pricing, FinalCTA, TutorSignupTrial, TrialExpiredDialog — все соблюдают.
- **§2.4 «Статус видим»** — TrialCountdownBanner = explicit status «N дней пробного». TrialExpiredDialog = explicit status «Trial завершён».
- **§5.5 Homework Summary Card** — не применимо здесь, но pattern переноса (badge + status + один primary CTA) применяется к TrialCountdownBanner.
- **§7 Экспорт и шаринг** — не применимо, фича не про export.
- **§11 Антипаттерны** — `Telegram-кнопка как зелёная outline = AI-slop` (нарушено сейчас). Исправляем в P0-3: TG-blue (`#229ED9`).

### Anti-pattern check (из `trial-flow-recommendations.md §Anti-patterns`)

| # | Anti-pattern | Соблюдаем? |
|---|---|---|
| 1 | Не делать trial с обязательной картой и auto-charge | ✅ Без карты |
| 2 | Не делать «trial с лимитами» (3 ученика, 5 ДЗ) | ✅ Full AI access |
| 3 | Не делать hard lockout после trial | ✅ Soft demotion на free |
| 4 | Не показывать «*потом 1000 ₽/мес» мелким шрифтом | ✅ Price-stack `0 → 200 → 1000` явно |
| 5 | Не убирать «Отмена в один клик» | ✅ Trust-чип сохранён |
| 6 | Не делать 5+ CTA «Попробовать» на странице | ✅ Ровно 3 (Hero / Pricing / FinalCTA) |
| 7 | Не делать Telegram-кнопку как зелёную outline | ✅ TG-blue в P0-3 |

### Cross-browser (из `.claude/rules/80-cross-browser.md`)

- `<input>` / `<select>` в TutorSignupTrial — `text-base` (16px) минимум, `touch-action: manipulation`, prevents iOS auto-zoom
- TrialExpiredDialog — нет `RegExp lookbehind` в copy validation
- `Date` парсинг trial_expires_at — `parseISO` из date-fns, не `new Date(string)`
- TrialCountdownBanner — `position: sticky` с `border-separate` если будет nested table-layout (не применимо, это flex-layout, OK)

### Design System (из `.claude/rules/90-design-system.md` + `/SKILL.md`)

- Все цвета — токены `var(--sokrat-*)`. Никаких hex в новом коде.
- Telegram-blue — добавить новый token `--sokrat-telegram-500: #229ED9` в `src/styles/colors_and_type.css` (extension контракт SKILL.md §10). Существующий `bg-socrat-telegram` — verify через `tailwind.config.ts` что hex актуален.
- Golos Text — единственный sans family (уже работает).
- KaTeX — не применимо, фича не про physics content.

---

## 8. Acceptance Criteria

> Каждый AC — testable Given/When/Then или конкретная команда возвращающая PASS/FAIL.

### Phase P0 (минимум 8 AC)

- **AC-P0-1:** Given аноним открывает `https://sokratai.ru/`, when Hero загружается, then виден chip «🎁 Новое: 7 дней пробного периода без карты» и primary CTA с текстом «🎁 Попробовать 7 дней бесплатно». Trust-чипы под кнопками: «Без карты · Полный AI · Потом 200 ₽».

- **AC-P0-2:** Given аноним кликает primary CTA в Hero, when navigation завершается, then URL содержит `/signup?ref=tutor-landing&trial=7` И Yandex Metrika fires goal `tutor_landing_cta_trial_hero` (наблюдаемо через `window.ym` queue или Yandex Metrika dashboard через 24 часа).

- **AC-P0-3:** Given аноним открывает `/signup?ref=tutor-landing&trial=7`, when страница рендерится, then показан `<TutorSignupTrial />` (single-page форма с email / password / subject), а не существующий `<SignUp />` (студенческий путь). Given URL `/signup` (без ref-param), then рендерится `<SignUp />` (backward compat для существующих student-flows).

- **AC-P0-4:** Given новый пользователь успешно регистрируется через `<TutorSignupTrial />`, when signup завершается, then в БД создан `auth.users` row И `profiles.trial_started_at = NOW() ± 5 секунд` И клиент navigates to `/tutor/home`. Yandex Metrika fires goals `tutor_landing_trial_signup_started` (на submit) и `tutor_landing_trial_signup_completed` (на success).

- **AC-P0-5:** Given пользователь на `/`, when открывает Pricing-секцию, then видит ровно 3 главных карточки (Бесплатно / AI-старт / AI-команда) + 2 компактных (1000/2000 ₽). AI-старт highlighted с popular chip «7 дней бесплатно» и price-stack отображает три уровня: «0 ₽» (today, 7 дней), «200 ₽» (первый месяц), «1000 ₽/мес» (далее).

- **AC-P0-6:** Given пользователь видит Hero, when смотрит на Telegram-кнопку, then её background-color resolves к TG-blue токену (`var(--sokrat-telegram-500)` или эквивалент), не зелёному outline. Visual diff vs текущий design подтверждает изменение.

- **AC-P0-7:** Given developer запускает `psql` на dev-БД и выполняет `\d profiles`, when смотрит на columns, then `trial_started_at TIMESTAMPTZ NULL` существует И есть partial index `idx_profiles_trial_started_at ON profiles(trial_started_at) WHERE trial_started_at IS NOT NULL`.

- **AC-P0-8:** Given P0 deploy завершён через `deploy-sokratai`, when существующий tutor-юзер (зарегистрирован до P0) открывает `/tutor/home` и пытается создать ДЗ + проверить ответ ученика, then AI работает как раньше. **AI-gating НЕ активирован в P0** — все tutor'ы сохраняют доступ.

- **AC-P0-9 (P1 priority):** Given пользователь скроллит Hero, when смотрит под trust-чипами, then виден compare-блок «Было / Стало»: «Раньше: карта upfront, 200 ₽ при регистрации. Теперь: 7 дней бесплатно без карты». Acceptable если деплоится отдельным релизом.

- **AC-P0-10 (P1 priority):** Given пользователь раскрывает FAQ, when ищет ответ на «Что будет с моими данными после trial?», then видит явный ответ что данные сохраняются + базовая платформа продолжает работать.

### Phase P1 (минимум 12 AC)

- **AC-P1-1:** Given trial-юзер на дни 1–6 (`trial_expires_at > NOW()`, `status='trial_active'`), when открывает `/tutor/home`, then `<TrialCountdownBanner />` отображается с текстом «Осталось N дней пробного», где `N = Math.ceil((trial_expires_at - NOW()) / 86400000)`.

- **AC-P1-2:** Given trial-юзер на день 7+ (`trial_expires_at < NOW()`), when открывает любой tutor-route внутри AppFrame, then `<TrialExpiredDialog />` рендерится как blocking modal (нет close button, нет backdrop dismiss), primary CTA «Продолжить за 200 ₽», secondary «Остаться на бесплатной».

- **AC-P1-3:** Given trial-юзер на день 7+ кликает «Продолжить за 200 ₽», when обработчик завершается, then POST `/tutor-subscription/start-paid` создаёт ЮKassa payment с `metadata.flow='tutor-trial-paid'`, `metadata.user_id=auth.uid()`, `payment_method.save=true`. Клиент redirects на `payment.confirmation.confirmation_url`.

- **AC-P1-4:** Given репетитор завершил оплату 200 ₽ через ЮKassa, when webhook обрабатывается с `event='payment.succeeded'` и `metadata.flow='tutor-trial-paid'`, then `tutor_subscriptions.status='paid_active'`, `paid_until=NOW()+30 days`, `current_tier='ai-start-200'`, `yokassa_payment_method_id=p.payment_method.id`, `trial_decision='paid'`, `trial_decision_at=NOW()` для соответствующего `user_id`.

- **AC-P1-5:** Given trial-юзер на день 7+ кликает «Остаться на бесплатной», when handler завершается, then POST `/tutor-subscription` с body `{ trial_decision: 'declined' }` обновляет `trial_decision='declined'`, `trial_decision_at=NOW()`. Dialog закрывается. AI остаётся выключенным (см. AC-P1-7).

- **AC-P1-6:** Given trial-юзер с `status='trial_expired'`, when отправляет ответ ученика и backend хочет вызвать AI через `homework-api/handleCheckAnswer`, then handler возвращает HTTP 402 с body `{ error: 'ai_disabled', reason: 'trial_expired' }`. Frontend показывает toast «AI недоступен — активируйте подписку».

- **AC-P1-7:** Given репетитор имеет `tutor_subscriptions.ai_features_active=false` (статус `trial_expired` ИЛИ `cancelled` после `paid_until`), when пытается использовать **любой** AI-путь (check / hint / chat в guided context), then ВСЕ три gating-точки возвращают 402. **Free-tier (оплаты, расписание, профили, ученики, заметки)** при этом продолжает работать без ошибок.

- **AC-P1-8:** Given developer запускает миграцию `20260512100100_backfill_legacy_tutors_grandfathered.sql`, when миграция завершается, then `SELECT COUNT(*) FROM tutor_subscriptions WHERE status='paid_grandfathered'` равно числу существующих tutor-юзеров (через `has_role(user_id, 'tutor')`). У всех `paid_until = '2026-05-31T23:59:59Z'`.

- **AC-P1-9:** Given сегодня `2026-05-15` (до cutoff), when legacy-репетитор с `status='paid_grandfathered'` использует AI, then `ai_features_active=true` (по generated column logic), gating проходит, AI работает. Given сегодня `2026-06-01` (после cutoff), then `ai_features_active=false` для legacy-юзеров без активной подписки, blocking modal показан.

- **AC-P1-10:** Given cron `trial-reminders` запускается ежедневно в 09:00 МСК, when находит пользователей с `status='trial_active' AND trial_expires_at < NOW() + INTERVAL '1 day'`, then переводит их в `status='trial_expired'`, отправляет email через `sendTrialDay7Email` (idempotency-key `trial-day7-{user_id}`). Запись в email queue видна в `pgmq`.

- **AC-P1-11:** Given trial-юзер на день 7 получил email, when открывает email и кликает «Продолжить за 200 ₽», then редиректится на `https://sokratai.ru/tutor/home` с query-param `?action=upgrade` → frontend автоматически открывает `<TrialExpiredDialog />`.

- **AC-P1-12:** Given репетитор с `status='paid_active'` через 25 дней (за 5 дней до `paid_until`), when accessuет `/tutor/home`, then **никакого** banner или dialog не показывается. AI работает. Auto-renewal через ЮKassa subscription API сработает на день 30 (TODO 🚨: точный mechanism зависит от реализации recurring через `payment_method_id`, см. Open Question Q6).

- **AC-P1-13:** Given developer выполняет `npm run smoke-check`, when smoke-check завершается, then проверка subscription invariants проходит:
  ```sql
  -- Все active tutor-юзеры имеют ровно одну row в tutor_subscriptions
  SELECT COUNT(*) FROM tutor_subscriptions GROUP BY user_id HAVING COUNT(*) > 1;
  -- Должно вернуть 0 строк
  ```

- **AC-P1-14:** Given developer открывает `https://sokratai.ru` в Safari iOS 16+, when проходит весь P1 flow (signup → countdown banner → expired dialog), then нет horizontal scroll, форма не auto-zoom'ит на focus, dialog blocking работает корректно (per `.claude/rules/80-cross-browser.md`).

---

## 9. Requirements priorities

> P0 = Must-Have в фазе. P1 = Nice-to-Have в фазе (можно деплоить отдельным релизом).

### Phase P0

| Item | Priority | Rationale |
|---|---|---|
| Hero copy update (P0-1) | **P0** | Без этого фича не существует — главный visual change. |
| Pricing simplification (P0-2) | **P0** | Без этого pricing-блок противоречит Hero (5 tiers vs «попробуй») |
| Telegram TG-blue (P0-3) | **P0** | Anti-pattern fix: secondary CTA визуально отличен |
| TutorSignupTrial.tsx (P0-4) | **P0** | Без этого нет landing place для trial-юзера |
| SignupRouter (P0-5) | **P0** | Backward compat для student signup на `/signup` |
| Migration trial_started_at (P0-6) | **P0** | Без этого нет measurement, и P1 не работает |
| Yandex Metrika goals (P0-7) | **P0** | Без этого hipothesis не валидируется |
| FreemiumBridge / FAQ / FinalCTA copy (P0-8) | **P1** | Coherence, но не блокирует hipothesis |
| Compare-блок «Было / Стало» (P0-10) | **P1** | UX polish, можно отдельным релизом |
| Новый Q «Что будет с данными» (P0-9) | **P1** | Trust-улучшение, не блокирует |

### Phase P1

| Item | Priority | Rationale |
|---|---|---|
| `tutor_subscriptions` table + RLS (P1-1) | **P0** | Foundation для всего gating |
| Backfill legacy `paid_grandfathered` (P1-2) | **P0** | Без этого legacy-юзеры разрываются |
| `subscription-gating.ts` helper (P1-3) | **P0** | Single source of truth, без него gating неконсистентен |
| AI-gating в homework-api (P1-4) | **P0** | Core deliverable Phase P1 |
| AI-gating в chat (P1-5) | **P0** | Полное покрытие AI-путей |
| `tutor-subscription` edge function (P1-6) | **P0** | Без этого dialog не имеет endpoint |
| TrialCountdownBanner (P1-7) | **P0** | Visibility — без него юзер не знает что осталось |
| TrialExpiredDialog (P1-8) | **P0** | Conversion-momento, без него gating работает но конверсия 0 |
| Cron trial-reminders (P1-9) | **P1** | Email на день 7 critical, но reactivation день 14 — nice-to-have |
| Email templates (P1-10) | **P1** | Параллельно cron'у. Day-7 — must, day-14 — bonus |
| ЮKassa расширение (P1-11) | **P1** | Critical для conversion → paid, но при отсутствии можно временно манually-запускать через TG (Vladimir) |

---

## 10. Validation

### Smoke check (per `.claude/rules/20-commands-and-validation.md`)

```bash
npm run lint && npm run build && npm run smoke-check
```

Дополнительно для Phase P1:
- Migration dry-run: `supabase migration up --dry-run` для backfill миграции
- `tutor_subscriptions` invariant query (см. AC-P1-13)
- Edge function gating test: создать test-tutor с `status='trial_expired'`, дёрнуть `/homework-api/check-answer` → ожидать 402

### Manual QA (отдельно от smoke)

- Safari iOS: Hero CTA touch target ≥ 44×44, signup-форма no auto-zoom, dialog blocking работает
- macOS Safari: print-css не применим (фича не про print), но full hover/focus states проверить
- Edge case: trial-юзер регистрируется → выходит из аккаунта → возвращается через 8 дней → blocking modal на login
- Edge case: legacy-репетитор активирует подписку до cutoff → `status='paid_active'` overrides `paid_grandfathered` → нет blocking modal

### Метрики успеха (через 2 недели после P0 deploy)

- **Signup conversion на лендинге:** +50% vs baseline (текущий «200 ₽ при регистрации»). Baseline — последние 30 дней Yandex Metrika `tutor_landing_cta_hero` → `signup_completed`.
- **TutorSignupTrial completion rate:** ≥ 70% (от signup_started до signup_completed). Если < 50% — форма слишком тяжёлая, нужен polish.
- **Trial-to-paid conversion:** через 14 дней после первого batch trial-юзеров (в P1, после backend готов): ≥ 15% (RU EdTech baseline). < 10% — копи или onboarding не доносят value.

### Negative signals (rollback-trigger'ы)

- Signup conversion ↓ vs baseline на 20%+ — копи отпугивает (маловероятно, но возможно если trust-чипы перегружены)
- AC-P0-8 fail (existing tutors теряют AI в P0) — **критический rollback**, означает что P0 ушёл за пределы маркетингового оффера и сломал backend
- ЮKassa webhook не обновляет subscription (P1-4 fail) — manual fix через DB UPDATE до починки

### Связь с pilot KPI (per `18-pilot-execution-playbook-sokrat.md`)

Прямая. Pilot KPI = «N репетиторов прошли cycle активация → создание ДЗ → отправка ученикам → проверка ответа». Trial — top of funnel этого cycle. +50% signup × 15-25% trial-to-paid = ×2 pilot cohort на тот же трафик.

---

## 11. Risks & Open Questions

### Risks

| Риск | Вероятность | Impact | Mitigation |
|---|---|---|---|
| Trial-juicing (multiple email registrations для extension trial) | Средняя | Низкий (5% abuse cap, Vladimir принял) | IP fingerprint audit log в P3 если abuse > 10% |
| Legacy-репетитор пропустил personal TG → разрыв доверия на cutoff | Низкая | Средний (loss of pilot участника) | Vladimir отвечает за personal outreach. 2 недели до cutoff = достаточный buffer |
| Card-attached repeat trial-юзер ругается на auto-renewal через 30 дней | Средняя | Низкий (single-month conversion, easy refund) | Явный disclaimer в TrialExpiredDialog: «Со 2-го месяца — 1000 ₽, отмена в один клик» |
| ЮKassa recurring payment integration занимает > 1 спринта | Средняя | Высокий (блокирует P1) | Manual payment + DB UPDATE как fallback на 1 неделю. P1-11 — P1 priority, не P0 |
| Push web push не подключён tutor-side (TrialCountdownBanner ≠ push) | Известное (см. `.claude/rules/95-production-deploy.md`) | Низкий | Banner inside AppFrame работает без push. Push-reminders — P2 |
| Phase P0 копи увеличивает signup, но на P1 deploy frustration «trial внезапно стал реальным» | Средняя | Средний | P0 → P1 deploy окно ≤ 14 дней. P1 включает email day-7 за 24 часа до expiry |
| Existing tutor получает trial banner после P1 deploy | Низкая | Низкий (UX confusion) | Backfill миграция (P1-2) ставит `paid_grandfathered`, не `trial_active` — banner НЕ показывается legacy |
| TG-blue токен `--sokrat-telegram-500` коллизирует с существующим Tailwind `bg-socrat-telegram` | Низкая | Низкий | Verify через `tailwind.config.ts` существующий hex; либо использовать существующий, либо переименовать новый в `--sokrat-tg-blue` |

### Open Questions

| # | Вопрос | Кто решает | Блокирует старт? |
|---|---|---|---|
| Q1 | Дата cutoff для legacy migration (default 2026-05-31) | Vladimir | Нет — default OK для P1, можно поменять перед TASK миграции |
| Q2 | Auto-tier после первого месяца — по числу учеников (auto) или ручной выбор репетитора? | Vladimir | Нет — P1 not blocked, можно дополнить позже |
| Q3 | Day-7 modal blocking или soft (X в углу)? Default — blocking. | Vladimir | Нет — default OK для P1 |
| Q4 | URL-формат: `/signup?ref=tutor-landing&trial=7` через router-disambiguation, или отдельный route `/trial-signup`? Default — router disamb (выбран в спеке). | Claude+Vladimir | Нет — но если выбрать `/trial-signup`, переписать P0-5 |
| Q5 🚨 | RLS на `profiles.UPDATE` self-write `trial_started_at` — есть ли уже policy `Users update own profile`? | Claude (verify через grep) | **Да — проверить перед T0 (TASK-1 P0)** |
| Q6 🚨 | ЮKassa recurring/subscription API endpoints — какие конкретно использовать? Существующий `yookassa-create-payment` — для разовых ученических Premium-оплат, recurring не реализован. | Claude (verify через grep + ЮKassa docs) | **Да — P1-11 blocked до выяснения** |
| Q7 | Какой cron mechanism — pg_cron или Lovable Cloud scheduled functions? | Claude (verify через `supabase/config.toml` + Lovable docs) | Не блокирует P0; P1-9 нуждается перед TASK-imp |
| Q8 | Telegram welcome-bot canal+bot routing — оставляем `t.me/sokrat_rep` (channel) или меняем на `t.me/sokrat_rep_bot`? | Vladimir | Нет — P0 решение «оставляем как есть», bot — P2 |
| Q9 | Subject-список в TutorSignupTrial — какие предметы? Default из `SUBJECTS` в `src/types/homework.ts` (включает `physics, math, informatics, ...`). | Claude (verify) | Нет — P0-4 default OK |
| Q10 | Spec-оффер для legacy «100 ₽ первый месяц вместо 200 ₽» из `legacy-tutors-personal-message.md` — сделать ли отдельный promo-code mechanism, или Vladimir manually open аккаунты? | Vladimir | Нет — P1 manually OK, promo-code → P3 |

---

## 12. Implementation Tasks

> Детальная нарезка — в отдельном `tasks.md` (Шаг 5 pipeline). Здесь — high-level breakdown для context.

### Phase P0 (~5–7 человеко-дней, 1 неделя)

- T0 Verify (per Open Question Q5): grep `profiles UPDATE` policies → если нет, добавить в P0-6 миграцию
- T1 (M, 1.5д) `Hero.tsx` + `Pricing.tsx` + `FreemiumBridge.tsx` + `FAQ.tsx` + `FinalCTA.tsx` copy update + Telegram TG-blue
- T2 (S, 0.5д) `tutorLandingAnalytics.ts` extension (5 новых goals)
- T3 (M, 2д) `TutorSignupTrial.tsx` + `SignupRouter.tsx` + integration в `App.tsx`
- T4 (S, 0.5д) Migration `20260505100000_add_trial_started_at_to_profiles.sql`
- T5 (S, 0.5д) `index.html` + `Index.tsx` meta-tags
- T6 (S, 0.5д) Compare-блок (P1) + новый FAQ Q (P1)
- T7 (S, 0.5д) `deploy-sokratai` на VPS + post-deploy smoke

### Phase P1 (~10–15 человеко-дней, 2-3 недели)

- T8 Verify (per Open Question Q6, Q7): ЮKassa recurring API + cron mechanism
- T9 (M, 1.5д) Migration `20260512100000_create_tutor_subscriptions.sql` + RLS + индексы
- T10 (M, 1д) Migration `20260512100100_backfill_legacy_tutors_grandfathered.sql` + verify count
- T11 (M, 1д) `subscription-gating.ts` helper + unit tests
- T12 (M, 1.5д) AI-gating в `homework-api::handleCheckAnswer` + `handleRequestHint`
- T13 (M, 1.5д) AI-gating в `chat/index.ts` (только guided context)
- T14 (M, 2д) `tutor-subscription` edge function (GET /me, POST /start-paid, POST /cancel) + ЮKassa recurring extension
- T15 (M, 1.5д) `<TrialCountdownBanner />` + `<TrialExpiredDialog />` + AppFrame integration
- T16 (M, 1.5д) Cron `trial-reminders` + email templates + idempotency-keys
- T17 (M, 1.5д) `useTutorSubscription` hook + `tutorSubscriptionApi.ts` client
- T18 (S, 1д) QA Safari iOS + Chrome desktop + edge cases
- T19 (S, 0.5д) `deploy-sokratai` + smoke + monitor logs первые 24 часа

**Критический путь:** T9 (DB) → T11 (helper) → T12+T13 (gating) параллельно с T15 (UI) → T14 (subscription endpoint) → T18 (QA) → T19 (deploy).

---

## 13. Parking Lot

> Идеи всплывшие на PM-сессии 2026-05-04 или в research, **не входят** в P0/P1, но track'аются для будущих спринтов.

- **A/B тест 7 дней vs 14 дней trial** — Phase P3+ после baseline данных от первой когорты (≥50 trial-юзеров)
- **A/B тест без-карты vs с-картой** — Phase P3+ при trial→paid < 15%
- **«1 ₽ первый месяц»** альтернативный оффер для скептиков (CloudText pattern) — Phase P3
- **Trial extension по запросу** (OkoCRM-pattern, +7 дней через TG-bot или email) — Phase P2 при 50+ trial-юзерах (операционная нагрузка)
- **Email-цепочка дней 1, 3, 5** (welcome / first-DZ-prompt / midpoint-nudge) — Phase P2 (пока только day-7)
- **Telegram welcome-bot** для unidentified users из канала Егора — Phase P2
- **Trial-juicing protection** (IP fingerprint audit log) — Phase P3 если abuse > 10%
- **Auto-tier selection** по числу активных учеников (1000/2000/3000) — Phase P2 (Open Question Q2)
- **Bulk-операции для legacy migration через UI** — N/A (manual personal TG/email per `legacy-tutors-personal-message.md`)
- **Promo-code mechanism для «100 ₽ для legacy» (Open Question Q10)** — Phase P3
- **Push-уведомления о countdown** — Phase P2 (требует tutor opt-in surface, currently NOT mounted, см. `.claude/rules/95-production-deploy.md`)
- **Job workspace для onboarding (jobs-first landing)** — отдельный эпик Sprint 2+ (Помощник landing per doc 17 §4.1)

---

## 14. Phasing notes (rationale разбивки)

**Почему две фазы, а не одна?**

- **Парето-rationale:** копи + UX (P0) реализуется за 1 неделю, измеряется за 2 недели. Полная backend-логика (P1) — 2-3 недели, нет смысла строить если top-of-funnel копи не работает.
- **Risk distribution:** P0 — низкий технический риск (только frontend + 1 миграция). P1 — высокий (recurring payments, cron, gating logic). Если P1 задерживается, P0 уже работает и приносит данные.
- **Customer impact:** P0 deploy не ломает существующих tutor-юзеров (никакого gating). P1 deploy включает gating + миграция legacy в `paid_grandfathered` — все существующие сохраняют доступ до cutoff.
- **Hypothesis isolation:** P0 валидирует «копи без карты увеличивает signup» (изолированная гипотеза). P1 валидирует «trial-to-paid 15-25%» (зависит от P0). Если P0 fail — P1 hypothesis нерелевантна.

**Почему P2 — отдельный документ (`p2-roadmap.md`)?**

- P2 (Telegram welcome-bot, email day-1/3/5, A/B тесты) — depends на baseline данных от P1 (нельзя A/B-тестировать пока нет первой когорты).
- P2 содержит большую долю «depends on cohort size» зависимостей — преждевременно делать spec'у.
- Roadmap stub держит scope явным без преждевременной детализации.

**L-effort (per Шаг 4 pipeline):** trial-flow крупная фича (15+ файлов в P1, 11 в P0). Разбивка на P0/P1 — каноничный паттерн для L-effort spec'и.

---

## 15. Deployment notes

### Phase P0 — Deploy на VPS

**КРИТИЧНО:** Phase P0 затрагивает frontend bundle (`src/components/sections/tutor/*`, `src/pages/TutorSignupTrial.tsx`, `src/App.tsx`, `src/lib/tutorLandingAnalytics.ts`, `index.html`, `src/styles/colors_and_type.css` если добавляем TG-blue token). После push в GitHub Lovable Cloud обновит **только** preview `sokratai.lovable.app`. Прод `sokratai.ru` обслуживается с собственного Selectel VPS Москва (`185.161.65.182`) и **НЕ обновляется автоматически**.

После merge P0 PR — **обязательно**:

```bash
ssh -i "$HOME\.ssh\sokratai_proxy" root@185.161.65.182
deploy-sokratai
```

Скрипт делает: `git pull` → `npm ci` → `npm run build` → копирование `dist/` → `nginx reload` → healthcheck. ~2-5 минут.

Per `.claude/rules/95-production-deploy.md`: каждый AI-агент, делающий frontend-изменения, **обязан** добавить блок «🚀 Deploy needed» в финальное сообщение пользователю с командой выше.

### Phase P0 — Migration apply

Migration `20260505100000_add_trial_started_at_to_profiles.sql` применится автоматически через Lovable Cloud при push в GitHub. Verify через `psql` (или Supabase Studio) что колонка появилась.

### Phase P1 — Deploy на VPS (frontend) + Lovable Cloud (backend)

P1 затрагивает **и** frontend (`<TrialCountdownBanner />`, `<TrialExpiredDialog />`, hooks, AppFrame), **и** backend (миграции, edge functions). Lovable Cloud сам деплоит миграции и edge functions при push. Frontend — `deploy-sokratai` ручной.

### Backend env vars (P1)

Добавить через Supabase Edge Function secrets (НЕ в repo):

- `YOOKASSA_TUTOR_FLOW_SHOP_ID` (если отличается от существующего)
- `YOOKASSA_TUTOR_RETURN_URL` = `https://sokratai.ru/tutor/home?action=upgrade-success`
- `TRIAL_REMINDER_EMAIL_FROM` = `Сократ <noreply@sokratai.ru>`
- `LEGACY_GRANDFATHER_CUTOFF` = `2026-05-31T23:59:59Z` (для backfill SQL — verify)

### Rollback (P0 + P1)

P0 rollback (если копи увеличивает abandonment вместо signup):

```bash
ssh root@185.161.65.182
cd /opt/sokratai
git log --oneline | head -5  # выбрать предыдущий рабочий commit (до P0 merge)
git checkout <hash>
NODE_OPTIONS="--max-old-space-size=2048" npm ci
NODE_OPTIONS="--max-old-space-size=2048" npm run build
cp -r dist/* /var/www/sokratai/
systemctl reload nginx
```

P1 rollback (если AI-gating ломает существующих юзеров):

```sql
-- Emergency disable gating: всем active tutor'ам поставить paid_grandfathered с дальним paid_until
UPDATE tutor_subscriptions
SET status = 'paid_grandfathered', paid_until = NOW() + INTERVAL '1 year'
WHERE status IN ('trial_expired', 'cancelled');
```

После DB-fix — frontend rollback тем же путём что P0.

---

## Checklist перед approve

- [x] **Section 0 Job Context заполнен** — meta-buying job + связь с use-jobs P0.1/P0.2/P1.2
- [x] **Привязка к Core Job** — meta-buying B0.1 (TODO зарегистрировать в doc 15) + indirect P0.1/P0.2/P1.2
- [x] **Wedge-связка явная** — B2B-1, single segment, конкуренция вокруг RU EdTech standard
- [x] **Scope чётко определён** — IN P0 (10), IN P1 (11), OUT (8), LATER (5)
- [x] **UX-принципы** doc 16 учтены — 1, 2, 3, 7, 10, 12, 14, 15, 17 явно названы
- [x] **UI-паттерны** doc 17 учтены — §2.1, §2.4, §11
- [x] **Anti-pattern check** vs `trial-flow-recommendations.md §Anti-patterns` — все 7 anti-patterns проверены
- [x] **Pilot impact описан** — +50% signup × 15-25% trial-to-paid = ×2 pilot cohort
- [x] **Метрики успеха определены** — 3 positive + 3 negative
- [x] **High-risk файлы не затрагиваются без необходимости** — AuthGuard / TutorGuard / Chat.tsx / TutorSchedule.tsx / telegram-bot — не модифицируются
- [x] **Student/Tutor изоляция не нарушена** — `tutor_subscriptions` только для tutor; SignupRouter сохраняет student `<SignUp />` путь без изменений
- [x] **Backward compat для legacy** — через `paid_grandfathered` cutoff `2026-05-31`
- [x] **Deploy reminder для P0 frontend** — Section 15 с командой `deploy-sokratai`
- [x] **Multiple write-paths invariant** — 5 write-paths для `tutor_subscriptions` каталогизированы (Section 6.B)
- [x] **Cross-browser** rules from `.claude/rules/80-cross-browser.md` применены
- [x] **Acceptance Criteria** — 10 для P0 (8 P0 + 2 P1) + 14 для P1 (12 P0 + 2 P1)
- [x] **P0/P1 priorities внутри scope** — каждый IN-item помечен P0/P1
- [x] **Single source of truth для Supabase URL** — `https://api.sokratai.ru` per `CLAUDE.md` Network section

---

## Связанные документы

- **PM-сессия артефакты:**
  - `SokratAI/landing-trial-mockup.html` — HTML mockup всех 7 surfaces
  - `SokratAI/trial-flow-recommendations.md` — research + рекомендации
  - `SokratAI/legacy-tutors-personal-message.md` — шаблоны TG/email для legacy
- **Wedge:** `docs/discovery/research/08-wedge-decision-memo-sokrat.md`
- **Product PRD:** `docs/discovery/product/tutor-ai-agents/14-ajtbd-product-prd-sokrat.md`
- **Jobs backlog:** `docs/discovery/product/tutor-ai-agents/15-backlog-of-jtbd-scenarios-sokrat.md` (P0.1, P0.2, P1.2 — usage; B0.1 meta-buying TODO)
- **UX principles:** `docs/discovery/product/tutor-ai-agents/16-ux-principles-for-tutor-product-sokrat.md`
- **UI patterns:** `docs/discovery/product/tutor-ai-agents/17-ui-patterns-and-component-rules-sokrat.md`
- **Pilot playbook:** `docs/discovery/product/tutor-ai-agents/18-pilot-execution-playbook-sokrat.md`
- **Network rules:** `CLAUDE.md` § «Network & Infrastructure (RU bypass)»
- **Production deploy:** `.claude/rules/95-production-deploy.md`
- **Notifications cascade:** `.claude/rules/70-notifications.md`
- **Cross-browser:** `.claude/rules/80-cross-browser.md`
- **Design system:** `.claude/rules/90-design-system.md` + `/SKILL.md`
- **Existing YooKassa integration:** `supabase/functions/yookassa-create-payment/index.ts` (для student Premium, нужно extend для tutor recurring)

## Roadmap (out of this spec)

- **Phase P2** — `docs/delivery/features/trial-flow/p2-roadmap.md` (Telegram welcome-bot, email day-1/3/5, A/B тесты, trial extension)
- **Phase P3+** — после baseline данных от P2: A/B длительности trial, A/B без-карты vs с-картой, promo-code mechanism, IP fingerprint audit log
