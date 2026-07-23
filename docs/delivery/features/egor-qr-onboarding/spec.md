# Feature Spec: Онбординг лидов по QR Егора (промо + сообщество)

**Версия:** v0.1
**Дата:** 2026-07-13
**Автор:** Владимир (+ Claude)
**Статус:** draft

> Контекст: завтра Егор раздаёт на встрече репетиторов визитки с QR → `sokratai.ru/egor` (промокод `БЛИНОВ_20`). Эта фича делает так, чтобы тёплый лид доехал до ценности, увидел закреплённую скидку и попал в сообщество — не потерявшись внутри продукта. CJM: см. чат-артефакт `cjm_egor_qr_leads`.

---

## 0. Job Context (обязательная секция)

### Какую работу закрывает эта фича?

| Участник | Core Job | Sub-job | Ссылка на Граф |
|---|---|---|---|
| Репетитор (B2B) | R: «Быстро понять, стоит ли инструмент моего времени» | получить «вау» (второй взгляд) до подключения учеников; довериться рекомендации коллеги (Егора) | job-graph.md#R (сверить ID при review) |
| Репетитор (B2B) | R: «Не потеряться в одиночку — найти опору/сообщество» | вступить в чат репетиторов, задать вопрос, увидеть, что «я не один» | job-graph.md#R (сверить ID при review) |

> Фича обслуживает **цель фаундера №1 — активация** (aha быстрее оплаты) и №2 — оплата с честной скидкой. Родитель/школьник не участвуют.

### Wedge-связка

- **B2B-сегмент:** репетиторы физики ЕГЭ/ОГЭ (когорта Егора, оффлайн-встреча Иваново).
- **B2C-сегмент:** n/a (лид — репетитор).
- **Score матрицы:** n/a (growth-фича, не продуктовая работа графа напрямую — сверить при review).

### Pilot impact

Тёплые лиды от Егора — самый дешёвый и доверенный канал пилота. Фича снимает 3 протечки (промо теряется → доверие Егора; сообщества нет в кабинете → тихий отвал; скидка не применяется → сломанное обещание) и поднимает activation-rate когорты, не пережимая «tough professional» аудиторию (кастдевы: не оверселлить).

---

## 1. Summary

Репетитор сканирует QR Егора → `/egor` → регистрация → онбординг. Фича: (а) **не теряет промокод/ref** из URL (сейчас `RegisterTutor` их выбрасывает), (б) показывает **тихий бейдж «−20% закреплено»** в онбординге, (в) после первого «вау» (демо-разбор) зовёт в **сообщество (TG + VK)**, (г) fast-follow — **реально применяет −20% на оплате** (бэкенд) и пишет промо в аккаунт.

Сегодня (P0, фронт, один `deploy-sokratai`): capture промо + бейдж + community-CTA. Fast-follow (бэкенд, Lovable): промо на аккаунт + скидка на оплате + серверная телеметрия воронки.

---

## 2. Problem

### Текущее поведение

- `src/pages/EgorLanding.tsx` ведёт на `/register-tutor?ref=egor&promo=BLINOV_20&utm_source=egor&utm_campaign=ivanovo`, но `src/pages/RegisterTutor.tsx` **не читает URL-параметры вообще** — `?ref/?promo/?utm` молча теряются (подтверждено разведкой). Промо нигде не сохраняется.
- Сообщество (`t.me/sokrat_rep`, VK-чат) есть только в секциях лендинга (`src/components/sections/tutor/Footer.tsx` и др.), **в кабинете репетитора его нет**.
- Оплата (`supabase/functions/yookassa-create-payment`) промокоды **не принимает**: цена считается сервером по eligibility (интро 200 ₽ / бэнды 1000/2000 ₽), поля promo нет ни в UI (`TutorPaymentModal.tsx`), ни в запросе.

### Боль

- Репетитор с визитки Егора платит через неделю и **не получает −20%** → обещание с визитки не сдержано → бьёт по доверию Егора (ради которого весь канал). Job: «довериться рекомендации коллеги».
- После первого «вау» репетитору **некуда пойти за опорой** внутри продукта → тихий отвал до конца триала. Job: «не потеряться в одиночку».

### Текущие «нанятые» решения

Репетиторы держатся за сарафан/личку (кастдев: «WhatsApp умер, Telegram умер, в VK никто не хочет» — сообщество работает только если даёт реальную ценность: пиры + прямая линия с нами + анонсы, а не «свалка»).

---

## 3. Solution

### Описание

Тонкий слой поверх существующего онбординга (`/tutor/home` → `ActivationChecklist` + `DemoCheckCard`). Промо переносится от QR до кабинета, показывается как **страховка, а не давёж** (цель №1 = активация), сообщество зовётся **после** первого «вау», скидка честно применяется на оплате (fast-follow).

### Ключевые решения

- **Промо-carrier — localStorage на P0** (фронт, без бэкенда): захват `?ref/?promo/?utm` при заходе на `/egor` и на `/register-tutor` → `localStorage`. Ноль риска для ночного релиза. **Source of truth для скидки — сервер** (fast-follow: `profiles.promo_code` из signUp-метаданных), localStorage — временный носитель для бейджа.
- **Бейдж «−20% закреплено» — тихий, не второй primary-CTA** (rule 90: один primary на экран). Появляется в шапке `ActivationChecklist`, если промо в localStorage и репетитор не premium.
- **Community-CTA — после «вау», не блокирующий.** Триггер — факт просмотра/прогона демо-разбора (`tutor_demo_check_viewed`/`tutor_demo_check_ran`). Ссылки — **одна константа** рядом с `TUTOR_SUPPORT_TELEGRAM_URL` в `src/lib/tutorPlanCopy.ts` (не хардкодить инлайн в N местах).
- **Скидку применяет ТОЛЬКО сервер** (fast-follow): ветка в `yookassa-create-payment` по сохранённому `profiles.promo_code` — клиент цену не задаёт (anti-tamper, как сейчас).
- **Реюз `profiles.promo_code`/`registration_source`** (колонки уже есть) — без новой миграции на `tutors`.
- **Телеметрия — серверная `analytics_events`** (паттерн онбординг-активации), не Yandex Metrica.

#### Промо-механика — решения владельца (2026-07-13, LOCKED)

Уточняют абстрактный «дедлайн промо» из первой версии спеки. Реализовано в `yookassa-create-payment` + `_shared/promo-intent.ts`.

- **Длительность скидки — per-user, первые 6 месяцев подписки.** Считается по числу уже оплаченных тарифных месяцев (`paidCount`, только `status='succeeded'`), НЕ по глобальной календарной дате. **Интро-месяц (первый платёж, 200 ₽) НЕ трогаем** → −20% идёт со **2-го** платежа. Окно = платежи **№2..№6** (`!isFirstTutorPayment && paidCount < 6`) = 5 скидочных band-платежей (band 1000→800 / 2000→1600); платёж №7+ — полная цена. Итог: месяц 1 — интро, месяцы 2–6 — −20% = «первые полгода». (Если понадобится 6 скидочных band-платежей вместо 5 — `PROMO_BLINOV_20_WINDOW_MONTHS` `6 → 7`.)
- **Claim-дедлайн 31.12.2026** (`_shared/promo-intent.ts::PROMO_CLAIM_DEADLINES`) — до какой даты `BLINOV_20` можно ЗАКРЕПИТЬ за новым аккаунтом. После — код не пишется (скидки нет), но `registration_source='egor'` сохраняется для аналитики. Уже закреплённые лиды дорабатывают свои 6 месяцев (окно per-user, поэтому скидка может уходить в 2027 — это by design, не глобальный cutoff).
- **Бейдж «−20% закреплено» (P0 #2)** — показывается ТОЛЬКО при точном `BLINOV_20` И в окне claim-акции (`hasActiveDiscountPromo()`), не при любом `?promo=`. Клиентский claim-дедлайн — зеркало серверного (менять оба).
- **Атрибуция пишется ТОЛЬКО при регистрации нового репетитора (P1 #5):** OAuth — `isNewUser && intendedRole==='tutor'`; email-verify — `type==='signup'`; кнопки шлют promo/ref только в tutor-контексте. Иначе `egor` попал бы на ученический профиль (student `/profile` показывает `registration_source`).
- **Anti-tamper — accepted decision (P1 #3):** цену клиент подставить не может (в запросе нет ни `amount`, ни `promo`). `profiles.promo_code` технически редактируем самим юзером через RLS, но `BLINOV_20` — **публичный** код с визитки (самоприсвоить ≡ вписать код) → приемлемо. Строгий column-lock — опциональный follow-up.
- **Accepted-risk — гонка `paidCount`:** два параллельных платежа видят один `paidCount`; ограничено тем, что считаются лишь `succeeded`, а двойную оплату режет YooKassa idempotency + one-flow модалка.

### Scope

**In scope (P0, фронт, сегодня):**
- Захват `?ref/?promo/?utm` → localStorage (helper).
- Бейдж «−20% закреплено» в онбординге.
- Community-CTA (TG + VK) после демо-разбора + константа ссылок.

**In scope (fast-follow, бэкенд):**
- Запись промо/ref в `profiles.promo_code`/`registration_source` при регистрации (signUp-метаданные → `email-verify`/`assign-tutor-role`/oauth-коллбэки).
- Ветка −20% в `yookassa-create-payment` + отображение скидки в `TutorPaymentModal`.
- Серверные события воронки QR (`qr_lead_registered`, `promo_captured`, `community_cta_clicked`).

**Out of scope:**
- Таймер/countdown обратного отсчёта (инструмент цели №2, отдельно; кастдев — не пережимать).
- Отдельное поле telegram при регистрации (контакт под дозвон покрыт почтой + вступлением в чат; P1).
- Автоприменение промо без сохранения на аккаунт / доверие цены клиенту.
- Yandex Metrica под продуктовую воронку.

---

## 4. User Stories

### Репетитор
> Когда я сканирую QR Егора и регистрируюсь, я хочу, чтобы обещанные −20% закрепились за мной и я их не потерял, чтобы при оплате скидка реально сработала.

> Когда я впервые увидел, как AI разбирает работу («вау»), я хочу попасть к другим репетиторам и напрямую к команде, чтобы не остаться один на один с новым инструментом.

---

## 5. Technical Design

### Затрагиваемые файлы

**P0 (фронт):**
- `src/lib/promoCapture.ts` — **новый** helper: `capturePromoFromUrl(searchParams)` пишет `sokrat-promo`/`sokrat-ref`/`sokrat-utm` в localStorage (идемпотентно, не перезатирать непустое); `getStoredPromo()`.
- `src/pages/EgorLanding.tsx` — на mount вызвать `capturePromoFromUrl` (belt-and-suspenders: URL уже несёт промо). **2026-07-23 копия страницы переписана** (маркетинг QR): H1 «×2 учеников» + строка предметов (в зале физики/математики/химики/гуманитарии) + цена «200 ₽ первый месяц» + уточнённая механика промо (интро-месяц вне −20%) + цифры/цитата синхронизированы с прод-лендингом + блок чатов TG/VK после обоих CTA. Детали — memory `project_egor_qr_onboarding.md`.
- `src/pages/RegisterTutor.tsx` — добавить `useSearchParams` + `capturePromoFromUrl` (**только capture; auth/signUp-логику не трогать**, rule 96). Аналогично `TutorSignupTrial.tsx`, `SignupRouter.tsx`.
- `src/components/tutor/home/ActivationChecklist.tsx` — тихий бейдж «−20% закреплено» (`getStoredPromo()` && не premium).
- `src/components/tutor/home/DemoCheckCard.tsx` / `DemoCheckSheet.tsx` — по факту просмотра/прогона демо поднять community-CTA (флаг в localStorage `sokrat-demo-seen`).
- `src/components/tutor/**` — **новый** `CommunityJoinCard.tsx` (TG + VK), монтируется на `/tutor/home` после `sokrat-demo-seen`.
- `src/lib/tutorPlanCopy.ts` — константы `SOKRAT_COMMUNITY_TELEGRAM_URL`, `SOKRAT_COMMUNITY_VK_URL` (рядом с `TUTOR_SUPPORT_TELEGRAM_URL:14`).

**Fast-follow (бэкенд):**
- `src/pages/RegisterTutor.tsx` / `TutorSignupTrial.tsx` — прокинуть `promo`/`ref` в `signUp({ options: { data: {...} } })` (метаданные, паттерн `consent_intent`).
- `supabase/functions/email-verify/index.ts` (~178-207) + `assign-tutor-role` + oauth-коллбэки — записать `profiles.promo_code`/`registration_source` из метаданных.
- `supabase/functions/yookassa-create-payment/index.ts` (~279-283) — ветка скидки по `profiles.promo_code`; цена по-прежнему считается сервером.
- `src/components/tutor/TutorPaymentModal.tsx` / `TutorTariffSection.tsx` — показать «−20% по промокоду» в цене.
- `supabase/functions/_shared/analytics.ts` — расширить enum событиями воронки QR.

### Data Model

- **Реюз без миграции:** `profiles.promo_code text` (миграция `20251130201642`), `profiles.registration_source text` (`20251109155208`). Новых колонок на `tutors` не добавляем.
- Community-ссылки — константы в коде, не в БД.

### API

- `yookassa-create-payment` — внутренняя ветка −20% по сохранённому `profiles.promo_code` (`isPromoBlinov20`), гейт окна `!isFirstTutorPayment && paidCount < PROMO_BLINOV_20_WINDOW_MONTHS`; **никакого promo-поля в запросе клиента** (цена не доверяется клиенту, anti-tamper). Ответ несёт `promo_applied`/`promo_percent`/`amount_before_promo` для строки цены в модалке. Календарного cutoff в этой функции НЕТ — claim-дедлайн живёт в `_shared/promo-intent.ts`.

### Миграции

- P0: нет.
- Fast-follow: нет (реюз `profiles.promo_code`). Если понадобится справочник промокодов — отдельной миграцией (out of scope v0.1).

---

## 6. UX / UI

### Wireframe / Mockup

- Бейдж: строка в шапке `ActivationChecklist` — «−20% закреплено за тобой» + мелко «применится при оплате». Нейтральный тон, без таймера.
- `CommunityJoinCard`: заголовок «Ты не один — загляни в сообщество», 2 кнопки-ссылки (Telegram-чат, VK-чат), подпись «репетиторы + прямая линия с нами + анонсы». Появляется после демо-разбора.

### UX-принципы (из doc 16)

- Активация раньше монетизации: промо = страховка, не продающий таймер.
- Community после ценности, не до (иначе спам-ощущение).

### UI-паттерны (из doc 17 + rule 90)

- Один primary-CTA на экран (бейдж — не CTA; community-CTA появляется отдельно, после «вау»).
- Иконки Lucide; sentence case; без эмодзи/градиентов/теней; инпуты ≥16px (rule 80); `data-sokrat-mode="tutor"`.

---

## 7. Validation

### Как проверяем успех?

- **Promo capture rate:** доля QR-регистраций, у которых промо доехал (localStorage/`profiles.promo_code`): порог ≥ 95%.
- **Activation rate когорты Егора:** доля, дошедших до демо-разбора («вау»): цель ≥ 40%.
- **Community join:** доля активированных, кликнувших в чат: цель ≥ 25%.
- **Discount honored:** 100% оплат с сохранённым `BLINOV_20` уходят с −20% (fast-follow, до первой оплаты).

### Связь с pilot KPI

Активация тёплой когорты Егора = верх воронки пилота; сохранённое доверие (скидка + сообщество) → удержание и реферал (15%/год).

### Smoke check

```bash
npm run lint && npm run build && npm run smoke-check
```

---

## 8. Risks & Open Questions

| Риск | Вероятность | Митигация |
|---|---|---|
| Бейдж обещает −20%, а на оплате скидки нет (fast-follow не успел) | Средняя | У лида ≥7 дней до оплаты — бэкенд-ветка обязана выйти до первых оплат; трекать дату |
| localStorage промо теряется (другое устройство / чистка) | Средняя | P0-компромисс; надёжный носитель — `profiles.promo_code` из signUp-метаданных (fast-follow) |
| Правка `RegisterTutor` заденет auth-флоу (rule 96) | Низкая | Только `useSearchParams` + capture; signUp/redirect/role-логику не трогать |
| Клиент подделает цену через promo | Низкая | Скидку применяет только сервер по сохранённому коду; promo-поля в запросе нет |
| Пуш сообщества «пережмёт» профи | Низкая | Community после «вау», non-blocking, рамка «пиры + доступ + анонсы» |

### Открытые вопросы

1. `t.me/sokrat_rep` — это **чат** репетиторов или канал? Нужен инвайт именно в чат (VK уже чат: `vk.me/join/…`). Подтвердить URL.
2. ~~`BLINOV_20` дедлайн~~ — **РЕШЕНО (2026-07-13):** длительность −20% = per-user первые 6 месяцев (интро исключён, месяцы 2–6); claim-дедлайн 31.12.2026. См. «Промо-механика — решения владельца» в §3.
3. Сверить точные ID Core Jobs с `job-graph.md` перед approve.

---

## 9. Implementation Tasks

> Детально — в `tasks.md` (T1–T6).

- [ ] T1 — Capture `?ref/?promo/?utm` → localStorage (helper + 3 точки входа)
- [ ] T2 — Бейдж «−20% закреплено» в онбординге
- [ ] T3 — Community-CTA (TG + VK) после демо-разбора + константа
- [ ] T4 — (fast-follow) Промо/ref → `profiles.promo_code` при регистрации
- [ ] T5 — (fast-follow) Ветка −20% в `yookassa-create-payment` + показ в модалке
- [ ] T6 — (fast-follow) Серверные события воронки QR
- [ ] Регрессии + `Deploy needed` (rule 95)

---

## Checklist перед approve

- [ ] Job Context заполнен (секция 0) — ID Core Job сверить с Графом
- [ ] Scope чётко определён (in/out; P0 vs fast-follow)
- [ ] UX-принципы (активация раньше монетизации; community после «вау»)
- [ ] UI-паттерны rule 90 (один primary-CTA; бейдж — не CTA)
- [ ] Pilot impact описан
- [ ] Метрики успеха определены
- [ ] High-risk auth-файлы (`RegisterTutor`, rule 96) — только capture, без auth-логики
- [ ] Student/Tutor изоляция не нарушена
