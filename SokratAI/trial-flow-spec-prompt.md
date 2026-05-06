# Промпт для Claude Code — создать спеку Trial Flow для репетиторов

**Что это:** готовый промпт для Claude Code (CLI или IDE-плагин), который запросит у агента написать каноничную спеку под Шаг 4 development pipeline.

**Как использовать:** скопировать ВЕСЬ блок ниже (от `---` до `---`), вставить в Claude Code, дождаться выполнения. Агент сам прочитает все source documents, применит правила Шага 4, создаст `docs/delivery/features/trial-flow/spec.md` + `docs/delivery/features/trial-flow/p2-roadmap.md`.

**Ожидаемое время работы агента:** 5–10 минут (он будет читать ~10–15 source файлов, применять template, выписывать AC).

**Перед запуском — убедись что:**
- Все три PM-артефакта существуют в `C:\Users\kamch\sokratai\SokratAI\`: `landing-trial-mockup.html`, `trial-flow-recommendations.md`, `legacy-tutors-personal-message.md`
- Ты в Claude Code сессии с full file access к репо `C:\Users\kamch\sokratai\`

---

## ROLE

Твоя роль: senior product-minded full-stack engineer в проекте SokratAI. Ты пишешь спеки по канонам проекта (FEATURE-SPEC-TEMPLATE + правила Шага 4 из development-pipeline.md), не drift-ишь от UX/UI принципов docs 16/17, и привязываешь каждое решение к Job Graph.

## CONTEXT

Сократ AI — EdTech-платформа для репетиторов физики ЕГЭ/ОГЭ. Wedge: помочь репетитору собирать ДЗ за 5–10 минут и проверять автоматически с сократовским методом. Сегмент B2B-1 — индивидуальные репетиторы, hourly rate 3000–4000 ₽. Принцип «AI = draft + action, не chat-only output».

Сейчас на лендинге `sokratai.ru` есть hero CTA «Попробовать за 200 ₽ в первый месяц» и pricing-блок с 5 тарифами. Вводная card-friction убивает signup-конверсию для нового бренда.

Vladimir решил добавить **7-дневный trial без карты** по образцу CloudText.ru (RU EdTech: 7 дней full + 99 ₽ первый месяц вместо 899 ₽). После trial — soft demotion на free-tier (оплаты, расписание, профили остаются), либо переход на платный с auto-renewal.

Доставка двумя фазами по принципу Парето:
- **Phase P0 (1 неделя)** — trial как маркетинговый оффер на лендинге + новая signup-страница, без backend-gating. AI продолжает работать у всех. Цель — измерить, увеличивает ли копия signup-конверсию.
- **Phase P1 (2–3 недели)** — полная backend-логика: таблица `tutor_subscriptions`, AI-gating в edge-функциях, in-app countdown banner, day-7 conversion modal, cron-напоминалки, миграция legacy-репетиторов.

Phase P2 (Telegram welcome-bot, расширенная email-цепочка, A/B тесты) — отложена в roadmap-only документ.

## CANONICAL DOCS — ПРОЧИТАТЬ ПОЛНОСТЬЮ ПЕРЕД НАПИСАНИЕМ

### Шаг 4 правила и template
1. `docs/discovery/development-pipeline.md` — раздел «Шаг 4: SPEC». Section 0 Job Context, AC testable Given/When/Then, P0/P1 priorities внутри scope IN, Parking Lot, anti-scope-creep, разбивка на фазы при L-effort. **Это нормативный документ для формы спеки.**
2. `docs/delivery/features/FEATURE-SPEC-TEMPLATE.md` — базовый шаблон с секциями 0–9 + checklist.
3. `docs/delivery/features/homework-reuse-v1/spec.md` — образец канонической спеки этого проекта. Скопируй стилистику: ключевые решения помечены кодами A/B/C/D/E, секции «Текущее поведение / Боль / Текущие нанятые решения» внутри Problem, ссылки на UX-принципы и UI-патерны с конкретными номерами.

### Project rules
4. `CLAUDE.md` — особенно секции про Network/Infrastructure (RU bypass, Selectel VPS, deploy), high-risk файлы, Tutor canonical read order.
5. `.claude/rules/00-read-first.md`
6. `.claude/rules/10-safe-change-policy.md` — high-risk files, не трогать без необходимости
7. `.claude/rules/30-docs-structure.md` — discovery/delivery boundary
8. `.claude/rules/70-notifications.md` — email queue, push cascade
9. `.claude/rules/80-cross-browser.md` — Safari/iOS rules
10. `.claude/rules/90-design-system.md` — токены, anti-patterns
11. `.claude/rules/95-production-deploy.md` — deploy через `deploy-sokratai`

### Discovery источники для Job Context
12. `docs/discovery/research/08-wedge-decision-memo-sokrat.md`
13. `docs/discovery/product/tutor-ai-agents/14-ajtbd-product-prd-sokrat.md`
14. `docs/discovery/product/tutor-ai-agents/15-backlog-of-jtbd-scenarios-sokrat.md` — для точных Job IDs
15. `docs/discovery/product/tutor-ai-agents/16-ux-principles-for-tutor-product-sokrat.md`
16. `docs/discovery/product/tutor-ai-agents/17-ui-patterns-and-component-rules-sokrat.md`
17. `docs/discovery/product/tutor-ai-agents/18-pilot-execution-playbook-sokrat.md` — pilot KPI

### Существующие компоненты (для Section 5 Technical Design)
18. `src/components/sections/tutor/Hero.tsx` — текущий Hero (что меняем)
19. `src/components/sections/tutor/Pricing.tsx` — текущий 5-tier pricing (что упрощаем)
20. `src/components/sections/tutor/FreemiumBridge.tsx`, `FAQ.tsx`, `FinalCTA.tsx`
21. `src/pages/SignUp.tsx` — текущий ученический signup (НЕ трогаем, делаем отдельный для tutor)
22. `src/lib/tutorLandingAnalytics.ts` — Yandex Metrika goals
23. `src/components/tutor/chrome/AppFrame.tsx` — куда интегрируется P1 banner и dialog

### PM-артефакты этой сессии (Vladimir × Claude в Cowork, 2026-05-04)
24. `C:\Users\kamch\sokratai\SokratAI\landing-trial-mockup.html` — HTML mockup всех 7 surfaces (Hero, Pricing, Signup, Banner, Day-7 Modal, TG Welcome, Flow Diagram)
25. `C:\Users\kamch\sokratai\SokratAI\trial-flow-recommendations.md` — research cloudtext.ru / moyklass / RubiTime + рекомендации по флоу + 8 закрытых вопросов
26. `C:\Users\kamch\sokratai\SokratAI\legacy-tutors-personal-message.md` — шаблоны для миграции legacy-репетиторов

## КАНОНИЧЕСКИЕ РЕШЕНИЯ ПО ВОПРОСАМ — НЕ ПЕРЕОТКРЫВАТЬ

Vladimir утвердил эти решения 2026-05-04 (см. `trial-flow-recommendations.md` и memory `project_trial_flow_2026_05.md`):

| # | Решение | Выбор |
|---|---|---|
| 1 | Карта на trial | **Нет** — RU-юзеры не привязывают карту «на пробу». |
| 2 | Длительность trial | **7 дней** — стандарт RU EdTech (CloudText, Мой Класс, RubiTime, OkoCRM, YCLIENTS, BigBen, Umai). |
| 3 | Лимит учеников на trial | **Нет** — Vladimir принял риск abuse (5%) ради UX (95%). |
| 4 | После trial | **Soft demotion на free** (free-tier с оплатами/расписанием/профилями остаётся). |
| 5 | Auto-charge через 7 дней | **Нет** — без карты невозможно технически, и это правильный pattern для RU. |
| 6 | Подписка после первого месяца | **Auto-renewal** — карта привязывается в момент оплаты 200 ₽. |
| 7 | Trial как фича в P0 | **Маркетинговый оффер, не gating** — Парето, измеряем гипотезу копи. |
| 8 | Telegram «Канал Егора» в P0 | **Оставить как есть** — ведёт на канал (сырой, 2 поста). Welcome-bot отложен в P2. |
| 9 | Legacy-репетиторы | **Personal TG-сообщения от Vladimir + grandfather до 2026-05-31** (см. `legacy-tutors-personal-message.md`). |

## ИССЛЕДОВАНИЕ КОНКУРЕНТОВ — встроить в Section 2

- **CloudText.ru**: 7 дней full + 99 ₽ первый месяц вместо 899 ₽ (anchor −89%). Прямой analog. cloudtext.ru/pay
- **Мой Класс (moyklass.com)**: 7 дней + soft demotion на free до 5 групп. Pattern для after-trial behavior.
- **RubiTime**: 7 дней «без карты и обязательств» — точная формулировка снимает friction.
- **OkoCRM**: 7 дней + extension по запросу.
- **Антитренинги**: 14 дней (исключение, отвергнуто).
- **YCLIENTS, BigBen, Umai**: 7 дней — индустриальный стандарт.

## КЛЮЧЕВЫЕ ТЕХНИЧЕСКИЕ КОНТРАКТЫ — должны быть в Section 5

### Phase P0 — затрагиваемые файлы

| Файл | Что меняется | Тип |
|---|---|---|
| `src/components/sections/tutor/Hero.tsx` | Primary CTA → «🎁 Попробовать 7 дней бесплатно». Trust ribbons «Без карты · Полный AI · Потом 200 ₽». TG-кнопка → стилизована TG-blue (`#229ED9`). | edit |
| `src/components/sections/tutor/Pricing.tsx` | Свести 5 → 3+2 карточки. AI-старт highlighted с popular chip «7 дней бесплатно», price-stack 0 → 200 → 1000 ₽/мес. | edit |
| `src/components/sections/tutor/FreemiumBridge.tsx` | Closing copy update. | edit |
| `src/components/sections/tutor/FAQ.tsx` | Обновить ответ Q «Сколько стоит и есть ли пробный?», добавить Q «Что будет с моими данными после trial?». | edit |
| `src/components/sections/tutor/FinalCTA.tsx` | Copy CTA + lede. | edit |
| `src/lib/tutorLandingAnalytics.ts` | Добавить goals: `tutor_landing_cta_trial_hero`, `tutor_landing_cta_trial_pricing`, `tutor_landing_cta_trial_final`, `tutor_landing_trial_signup_started`, `tutor_landing_trial_signup_completed`. | edit |
| `src/pages/TutorSignupTrial.tsx` | НОВЫЙ. Single-page форма (email + password + предмет + оферта + TG OAuth fallback). После signup → UPDATE `profiles.trial_started_at = NOW()` если URL-param `trial=7`. | new |
| `src/pages/SignupRouter.tsx` | НОВЫЙ. Тонкий компонент-диспетчер: `?ref=tutor-landing` → TutorSignupTrial, иначе → SignUp. | new |
| `src/App.tsx` | Заменить existing `/signup` route → `<SignupRouter />`. | edit |
| `src/pages/Index.tsx` + `index.html` | Обновить meta-tags для нового offer. | edit |
| `supabase/migrations/{date}_add_trial_started_at_to_profiles.sql` | ALTER profiles ADD COLUMN trial_started_at TIMESTAMPTZ NULL + INDEX. | new |

**Не трогать в P0** (high-risk per `.claude/rules/10-safe-change-policy.md`):
- `AuthGuard.tsx`, `TutorGuard.tsx`, `Chat.tsx`, `TutorSchedule.tsx`, `telegram-bot/index.ts`
- Существующий `SignUp.tsx` (для учеников, не tutor)
- Любые edge-функции

### Phase P1 — затрагиваемые файлы

| Файл | Что меняется | Тип |
|---|---|---|
| `supabase/migrations/{date}_create_tutor_subscriptions.sql` | Новая таблица + RLS. См. data model ниже. | new |
| `supabase/migrations/{date}_backfill_legacy_tutors_grandfathered.sql` | INSERT для всех текущих tutor-юзеров → status='paid_grandfathered', paid_until='2026-05-31'. | new |
| `supabase/functions/_shared/subscription-gating.ts` | Helper `checkTutorAiAccess(db, tutorUserId): { allowed, reason }`. | new |
| `supabase/functions/chat/index.ts` | gating check для tutor-инициированных guided chat-сообщений (только при наличии `guidedHomeworkAssignmentId` — проверка идёт по owning tutor, не по student). | edit |
| `supabase/functions/homework-api/index.ts::handleCheckAnswer` | gating check перед AI-вызовом. | edit |
| `supabase/functions/homework-api/index.ts::handleRequestHint` | gating check перед AI-вызовом. | edit |
| `supabase/functions/tutor-subscription/index.ts` | НОВЫЙ. GET /me, POST /start-paid, POST /cancel. | new |
| `supabase/functions/trial-reminders/index.ts` | НОВЫЙ. Cron daily, день-7 emails. | new |
| `supabase/functions/_shared/transactional-email-templates/trial-day-7.ts` | Email шаблон. | new |
| `supabase/functions/_shared/transactional-email-templates/trial-day-14.ts` | Email шаблон reactivation. | new |
| `src/lib/tutorSubscriptionApi.ts` | API client. | new |
| `src/hooks/useTutorSubscription.ts` | React Query hook (`['tutor','subscription']` per `.claude/rules/performance.md` query key convention). | new |
| `src/components/tutor/chrome/TrialCountdownBanner.tsx` | Top-bar в AppFrame дни 1–6. | new |
| `src/components/tutor/chrome/TrialExpiredDialog.tsx` | Radix Dialog blocking modal на день 7+. | new |
| `src/components/tutor/chrome/AppFrame.tsx` | Минимально: добавить `<TrialCountdownBanner />` и `<TrialExpiredDialog />` под `<MobileTopBar />`. **Не менять guard-логику.** | edit |
| ЮKassa webhook handler | Расширить для tutor-payments (отличать через metadata). | edit |

### Data Model для P1

```sql
CREATE TABLE tutor_subscriptions (
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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tutor_subs_trial_expiring
  ON tutor_subscriptions(trial_expires_at) WHERE status = 'trial_active';
CREATE INDEX idx_tutor_subs_paid_renewing
  ON tutor_subscriptions(paid_until) WHERE status IN ('paid_active', 'paid_grandfathered');

ALTER TABLE tutor_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tutor reads own subscription" ON tutor_subscriptions
  FOR SELECT USING (user_id = auth.uid());
-- writes only via service_role (edge functions)
```

## ACCEPTANCE CRITERIA — обязательно testable Given/When/Then

Минимум **8 AC для Phase P0** и **12 AC для Phase P1**. Каждый AC = команда или сценарий, который возвращает PASS/FAIL. Никаких «работает хорошо» — только конкретные действия и observables.

Примеры формата:

**Phase P0:**
- AC-P0-1: **Given** аноним открывает `https://sokratai.ru/`, **when** Hero загружается, **then** виден chip «Новое: 7 дней пробного периода без карты» и primary CTA с текстом «🎁 Попробовать 7 дней бесплатно».
- AC-P0-2: **Given** аноним кликает primary CTA в Hero, **when** navigation завершается, **then** URL содержит `/signup?ref=tutor-landing&trial=7` И Yandex Metrika fires goal `tutor_landing_cta_trial_hero` (наблюдаемо в `window.ym` queue).
- AC-P0-3: **Given** новый пользователь успешно регистрируется через `TutorSignupTrial`, **when** signup завершается, **then** в БД создан `auth.users` row И `profiles.trial_started_at = NOW() ± 5 секунд`.

**Phase P1:**
- AC-P1-1: **Given** trial-юзер на дни 1–6 (`trial_expires_at > NOW()`), **when** он открывает `/tutor/home`, **then** `TrialCountdownBanner` отображается с числом оставшихся дней = `ceil((trial_expires_at - NOW()) / 1d)`.
- AC-P1-2: **Given** trial-юзер на день 7+ (`trial_expires_at < NOW() AND trial_decision IS NULL`), **when** он открывает `/tutor/home`, **then** `TrialExpiredDialog` blocking, dismiss-кнопки нет, primary CTA «Продолжить за 200 ₽» вызывает `POST /tutor-subscription/start-paid`.
- AC-P1-3: **Given** репетитор оплатил 200 ₽ через ЮKassa, **when** webhook обрабатывается, **then** `tutor_subscriptions.status='paid_active'`, `paid_until=NOW()+30 days`, `current_tier='ai-start-200'`.

## P0/P1 PRIORITIES ВНУТРИ SCOPE IN

Каждый requirement помечается **P0 (Must-Have)** или **P1 (Nice-to-Have)** per Шаг 4 правило. **Запрет:** если всё помечено P0 — приоритизация не работает, переделай.

Для **Phase P0** — 4 P0 + 2 P1 requirements (типично):
- **P0** Hero copy update — без этого фича не существует
- **P0** Pricing 5→3+2 карточек — без этого pricing-блок противоречит Hero
- **P0** TutorSignupTrial.tsx + SignupRouter — без этого нет landing place
- **P0** Migration `trial_started_at` — без этого нет measurement
- **P1** compare-блок «Было / Стало» в Hero — улучшает UX, можно отдельным релизом
- **P1** новый Q в FAQ «Что будет с данными после trial» — улучшает trust, не блокирует

Для **Phase P1** — 5–6 P0 + 2–3 P1.

## OPEN QUESTIONS

| # | Вопрос | Кто решает | Блокирует старт? |
|---|---|---|---|
| Q1 | Дата cutoff для legacy migration (default 2026-05-31) | Vladimir | Нет (default OK для P1) |
| Q2 | Auto-tier после первого месяца — по числу учеников или ручной выбор? | Vladimir | Phase P1 only, нет для P0 |
| Q3 | Day-7 modal blocking или soft (X в углу)? Default — blocking. | Vladimir | Phase P1 only, нет для P0 |
| Q4 | URL-формат: `/signup?ref=tutor-landing&trial=7` через router-disambiguation, или отдельный route `/trial-signup`? Default — router disamb. | Claude+Vladimir | Нет |
| Q5 | RLS на `profiles.UPDATE` self-write `trial_started_at` — есть ли уже такая policy, или нужна отдельная? | Claude (verify) | **Да** — проверить перед T10 |
| Q6 | ЮKassa subscription API для recurring payments — какие конкретно endpoints? Что уже есть для учеников? | Claude (verify через grep) | Phase P1 only |
| Q7 | Какой cron mechanism — pg_cron или Lovable Cloud scheduled functions? | Claude (verify) | Phase P1 only |

## PARKING LOT — что всплыло, но не входит в scope v1

- A/B тест 7 дней vs 14 дней — отложить в Phase 3+ после первых данных trial→paid
- A/B тест «без карты» vs «с картой» — после Phase P1 при trial→paid < 15%
- Trial extension по запросу (OkoCRM-pattern) — после 50+ trial-signup-ов
- «1 ₽ первый месяц» как альтернатива trial для скептиков
- Email-цепочка дней 1, 3, 5 — Phase P2 (только day-7 в P1)
- Telegram welcome-bot для unidentified users — Phase P2
- Trial-juicing protection (audit log с IP fingerprint) — Phase P3 если abuse > 10%
- Bulk-операции для legacy migration через UI (сейчас manual TG/email)

## GUARDRAILS

1. **Не дублировать спеку из `trial-flow-recommendations.md`** — это discovery doc от PM-сессии. Спека делает rigorous переписывание под Шаг 4 формат, не copy-paste.
2. **Не trigger новых архитектурных решений** — все решения уже утверждены Vladimir (см. таблицу выше). Спека только формализует.
3. **Не нарушать UX-принципы doc 16** — особенно «AI = draft + action», «Workflow first, library second», «Если фича не усиливает пилот — не приоритет». В Section 6 явно сослаться на конкретные принципы по номерам.
4. **Не нарушать UI-патерны doc 17** — TG-blue для Telegram CTA (не зелёная outline), highlighted pricing card pattern, ROI-callout box, blocking modal для conversion-momento.
5. **Не трогать high-risk файлы** — `AuthGuard.tsx`, `TutorGuard.tsx`, `Chat.tsx`, `TutorSchedule.tsx`, `telegram-bot/index.ts` (per `.claude/rules/10-safe-change-policy.md` + CLAUDE.md).
6. **Использовать canonical токены** — `--sokrat-green-700`, `--sokrat-ochre-500`, `--sokrat-radius-lg` etc. — никаких hex.
7. **Cross-browser** — все iOS Safari правила из `.claude/rules/80-cross-browser.md` (input ≥ 16px, no `RegExp` lookbehind, `border-separate` если sticky, `touch-action: manipulation` на CTA).
8. **Не предполагать существование Job IDs** — если точные ID jobs из `15-backlog-of-jtbd-scenarios-sokrat.md` неизвестны или неоднозначны, оставь TODO в Section 0 с чётким контекстом, какую job ты пытаешься указать. Не выдумывай ID.
9. **Не писать код в спеке** — Section 5 содержит только перечисление файлов и их роль, не имплементацию. Tasks.md создаётся отдельно (Шаг 5 pipeline).
10. **Single source of truth для Supabase URL** — в новом коде клиента всегда `https://api.sokratai.ru` (RU bypass), не `*.supabase.co` (CLAUDE.md «Network & Infrastructure»).
11. **Deploy reminder** — в конце спеки в Section про deployment явно отметить, что P0 frontend changes требуют ручной `deploy-sokratai` на VPS (per `.claude/rules/95-production-deploy.md`).
12. **Не дублировать FEATURE-SPEC-TEMPLATE-структуру 1:1** — добавляй секции по необходимости (например, отдельную Migration secondary-write-path-проверку для `tutor_subscriptions` per `.claude/rules/40-homework-system.md` правило 0 о множественных write-sites).

## OUTPUT — что должно быть в конце

1. **Файл `docs/delivery/features/trial-flow/spec.md`** (~700–1000 строк markdown). Структура:
   - Header (версия, дата, автор, статус, links to mockup + recommendations)
   - Section 0: Job Context
   - Section 1: Summary
   - Section 2: Problem (Текущее / Боль / Нанятые решения / Исследование конкурентов)
   - Section 3: Solution (описание + Key Decisions A/B/C/D/E... в стиле homework-reuse-v1)
   - Section 4: Scope (IN P0 / IN P1 / OUT / LATER)
   - Section 5: User Stories (репетитор new + репетитор legacy)
   - Section 6: Technical Design — Phase P0 + Phase P1, разделено
   - Section 7: UX Principles + UI Patterns (with refs to doc 16 + 17 by item number)
   - Section 8: Acceptance Criteria — Given/When/Then, separated by phase, минимум 8 для P0 + 12 для P1
   - Section 9: Requirements priorities (P0 vs P1 within each phase)
   - Section 10: Validation (smoke commands)
   - Section 11: Risks & Open Questions (table)
   - Section 12: Implementation Tasks (краткий — детальная нарезка идёт в tasks.md в Шаг 5)
   - Section 13: Parking Lot
   - Section 14: Phasing notes (rationale разбивки)
   - Section 15: Deployment notes (deploy-sokratai reminder)
   - Checklist в конце

2. **Файл `docs/delivery/features/trial-flow/p2-roadmap.md`** (~50–100 строк, scope-only). Содержит:
   - Краткий scope Phase P2: Telegram welcome-bot, email-цепочка дней 1/3/5, A/B тесты, trial extension
   - Условие старта: «начинаем когда Phase P1 прошла feedback от Vladimir и первой когорты 50+ trial-юзеров»
   - НЕ детальная спека — это roadmap stub

3. **Краткий summary в чат**: какие секции созданы, сколько AC в каждой фазе, ссылки на canonical артефакты, какие Open Questions блокируют старт.

4. **Если в процессе нашёл несоответствия** — например, Job IDs не существуют в `15-backlog-of-jtbd-scenarios-sokrat.md`, или RLS policy на `profiles.UPDATE` self отсутствует, или ЮKassa endpoints для recurring payments не интегрированы — отметь в Open Questions с тэгом `🚨 Verify before T0` и в чат-summary явно подсвети.

5. **Self-check в конце спеки**:
   - Каждое key decision (A/B/C...) — какие UX-принципы doc 16 оно усиливает
   - Каждый new component — какой UI-pattern doc 17 он применяет
   - Anti-pattern check: ничего из «6 anti-patterns» в `trial-flow-recommendations.md` не нарушается

## ЧТО **НЕ** ДЕЛАТЬ

- **Не запускать** `npm run lint && npm run build && npm run smoke-check` — спека не требует validation, только tasks.md (Шаг 5) и build (Шаг 6).
- **Не создавать** tasks.md в этой задаче — это отдельный Шаг 5.
- **Не писать** имплементационный код — только перечисление файлов и их role.
- **Не deploy-ить** ничего — это спека, не build.
- **Не менять** существующие файлы кода — read-only при изучении.
- **Не игнорировать** предыдущие PM-артефакты от 2026-05-04 — они авторитетный источник decisions.

## MANDATORY END BLOCK

В конце ответа:

1. **Changed/created files:** список путей с пометкой `new` / `modified`
2. **Summary:** какие секции, сколько AC, какие Open Questions блокируют старт
3. **Open Questions to resolve before T0:** список с пометкой кто решает
4. **Self-check:**
   - Section 0 Job Context заполнен с точными Job IDs из doc 15? (если нет — TODO)
   - Все key decisions имеют ссылку на UX-принцип doc 16 или UI-pattern doc 17?
   - High-risk файлы не затрагиваются?
   - Student/Tutor isolation сохранена (tutor_subscriptions — только tutor)?
   - Backward compat для legacy через `paid_grandfathered`?
   - Deploy reminder для P0 frontend present?

---

# Конец промпта. Скопируй ВСЁ выше до строки `# Конец промпта` в Claude Code.
