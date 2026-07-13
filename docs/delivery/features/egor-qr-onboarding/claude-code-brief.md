# Claude Code brief — Онбординг лидов по QR Егора (промо + сообщество)

**Статус:** для реализации · **Версия:** v0.1 · **Дата:** 2026-07-13
**Что читать перед кодом (в этом порядке):**
1. `spec.md` — контракт фичи (Job Context, scope P0/fast-follow, technical design с файлами, AC §7).
2. `tasks.md` — T1–T7 (Reuse / Дельта / AC).
3. CJM — чат-артефакт `cjm_egor_qr_leads` (карта пути лида, где протечки).
4. Правила: `.claude/rules/96-auth-ru-bypass.md`, `90-design-system.md`, `95-production-deploy.md`, `99-ai-quota-subscriptions.md`, `97-edge-function-error-contract.md`, `70-notifications.md`.

---

## ⚠️ Главный принцип: REUSE, не REBUILD

Онбординг, демо-разбор, регистрация, оплата, телеметрия — **уже работают**. Эта фича — тонкий слой: перенести промо от QR в кабинет, показать бейдж, позвать в сообщество после «вау», и (fast-follow) честно применить скидку. НЕ строить новый онбординг/оплату/регистрацию.

| Уже есть (НЕ переписывать) | Где живёт | Как использовать |
|---|---|---|
| Лендинг под QR | `src/pages/EgorLanding.tsx` (роут `/egor`, живой) | несёт `?ref=egor&promo=BLINOV_20&utm_*`; добавить capture на mount |
| Онбординг репетитора | `src/pages/tutor/TutorHome.tsx` → `src/components/tutor/home/ActivationChecklist.tsx` (шапка ~:173) | сюда бейдж «−20% закреплено» |
| Демо-разбор = быстрый «вау» | `DemoCheckCard.tsx` (внутри `ActivationChecklist:168`) → `DemoCheckSheet.tsx`; события `tutor_demo_check_viewed`/`_ran` (`src/lib/demoCheckApi.ts`) | триггер community-CTA после «вау» |
| Константы контактов | `src/lib/tutorPlanCopy.ts:14` (`TUTOR_SUPPORT_TELEGRAM_URL`) | сюда `SOKRAT_COMMUNITY_{TELEGRAM,VK}_URL` |
| Community-ссылка (лендинг) | `t.me/sokrat_rep` в `src/components/sections/tutor/Footer.tsx` и др. | в кабинете её НЕТ — добавляем через константу |
| Регистрация | `src/pages/RegisterTutor.tsx` (не читает URL!), `TutorSignupTrial.tsx`, `SignupRouter.tsx:26` | добавить `useSearchParams` + capture; **auth-логику не трогать** |
| Создание записи tutor/profile | `supabase/functions/email-verify/index.ts:178-207`, `assign-tutor-role`, oauth-коллбэки | сюда запись `profiles.promo_code` (fast-follow) |
| Колонки под промо | `profiles.promo_code` (миграция `20251130201642`), `profiles.registration_source` (`20251109155208`) | реюз, БЕЗ новой миграции на `tutors` |
| Оплата (цена на сервере) | `supabase/functions/yookassa-create-payment/index.ts` (~279-283), `TutorPaymentModal.tsx` | сюда серверная ветка −20% (fast-follow) |
| Серверная телеметрия | `analytics_events`, `_shared/analytics.ts` (`logAnalyticsEventOnce`) | события воронки QR |

---

## Реальная дельта (что строим) + точки интеграции

**P0 (фронт, один `deploy-sokratai`, к завтра):**
1. **Promo-carrier.** Новый `src/lib/promoCapture.ts`: `capturePromoFromUrl(params)` → localStorage `sokrat-promo`/`sokrat-ref`/`sokrat-utm` (идемпотентно, не перезатирать непустое); `getStoredPromo()`. Вызов на mount: `EgorLanding.tsx`, `RegisterTutor.tsx`, `TutorSignupTrial.tsx`, `SignupRouter.tsx`. **В `RegisterTutor` — ТОЛЬКО `useSearchParams` + capture** (rule 96: signUp/redirect/role/INITIAL_SESSION не трогать).
2. **Бейдж «−20% закреплено».** В шапке `ActivationChecklist.tsx` — тихая строка, если `getStoredPromo()` && не premium (`get_subscription_status`, rule 99). Не второй primary-CTA (rule 90).
3. **Community-CTA после «вау».** Константы в `tutorPlanCopy.ts` (`SOKRAT_COMMUNITY_TELEGRAM_URL`, `SOKRAT_COMMUNITY_VK_URL='https://vk.me/join/WooW6wjwjhNwG7R0rzmKxpEBunNfHq1C3QQ='`). Новый `CommunityJoinCard.tsx` (TG+VK) на `/tutor/home`, появляется после флага `sokrat-demo-seen` (ставится при просмотре/прогоне демо). Non-blocking.

**Fast-follow (бэкенд, Lovable, до первых оплат):**
4. **Промо на аккаунт.** `signUp({ options: { data: { promo, ref } } })` → `email-verify`(~178-207)/`assign-tutor-role`/oauth пишут `profiles.promo_code`/`registration_source`. Обновить whitelist метаданных `email-verify`. PII-free.
5. **Скидка на оплате.** Серверная `applyPromoDiscount(price, profiles.promo_code)` в `yookassa-create-payment` (−20% для `BLINOV_20` + дедлайн). **Цену задаёт только сервер, promo-поля в запросе клиента нет.** Показ «−20%» в `TutorPaymentModal`. Ошибки flat `{error, code}` (rule 97).
6. **Воронка.** События `qr_lead_registered`/`promo_captured`/`community_cta_clicked` через `_shared/analytics.ts` (не Yandex Metrica).

---

## Инварианты (обязательны)

- **rule 96** — `RegisterTutor`/`TutorSignupTrial` — auth-зона: добавляем ТОЛЬКО чтение URL + localStorage; signUp, redirect-allow-list, роль, `INITIAL_SESSION`-guard не менять. Токены/PII не логировать.
- **rule 90** — один primary-CTA на экран: бейдж промо — не кнопка; community-CTA — отдельно и после «вау». Sentence case, Lucide, без эмодзи/градиентов/теней, инпуты ≥16px, `data-sokrat-mode="tutor"`.
- **Цена только на сервере** — скидку применяет `yookassa-create-payment` по сохранённому `profiles.promo_code`; клиент цену/промо в запросе не задаёт (anti-tamper). Интро-200 ₽/бэнды/`TEAM_PLAN_REQUIRED` не ломать.
- **Честность обещания** — бейдж «−20% закреплено» обещает скидку → T5 (применение) обязан выйти ДО первых оплат когорты (~7+ дней рантайма). Дедлайн промо — реальный (ЗоЗПП/Закон о рекламе).
- **rule 99** — фича не меняет AI-квоту; новые free-репетиторы — как есть.
- **rule 97** — edge-ошибки flat `{error: рус, code}`; клиент через `extractEdgeFunctionError`.
- **Anti-leak** — `profiles.promo_code` не отдавать в student-эндпоинты; запись server-side.
- **Одна константа ссылок** — community-URL только в `tutorPlanCopy.ts`, не хардкодить инлайн.
- **rule 95** — фронт (P0) через `deploy-sokratai` (VPS); edge (fast-follow) — Lovable на push. После фронт-изменений — блок «Deploy needed».

---

## Что НЕ делать

- НЕ строить новый онбординг / новую регистрацию / новую оплату — всё есть.
- НЕ трогать auth-логику в `RegisterTutor` (только capture URL, rule 96).
- НЕ доверять клиенту цену/промо — скидку считает сервер по сохранённому коду.
- НЕ делать таймер/countdown (это цель №2, отдельно; кастдев — не пережимать).
- НЕ добавлять поле telegram в форму регистрации (P1; контакт покрыт почтой + вступлением в чат).
- НЕ класть продуктовую воронку в Yandex Metrica (только `analytics_events`).
- НЕ добавлять колонку на `tutors` (реюз `profiles.promo_code`).

---

## Acceptance criteria + деплой

AC — в `tasks.md` (T1–T7) и `spec.md §7`. Перед мержем: `npm run lint && npm run build && npm run smoke-check`. Auth-зону (rule 96) не задеть логически. Фронт (P0) — `deploy-sokratai`; edge (fast-follow) — Lovable.

---

## Paste-ready инструкция для Claude Code — P0 (одно сообщение, к завтра)

```
Реализуй P0 фичи «Онбординг лидов по QR Егора (промо + сообщество)» в этом репозитории.

Сначала прочитай: docs/delivery/features/egor-qr-onboarding/spec.md (контракт),
tasks.md (T1–T3, T7), и правила .claude/rules/{96,90,95,99}.

ГЛАВНЫЙ ПРИНЦИП: переиспользовать существующее, НЕ переписывать. Онбординг
(/tutor/home → ActivationChecklist + DemoCheckCard/DemoCheckSheet), регистрация
(RegisterTutor/TutorSignupTrial/SignupRouter), константы контактов (tutorPlanCopy.ts) —
УЖЕ работают. Карта переиспользования — в claude-code-brief.md.

Построй только дельту P0 (фронт, один deploy):
1. src/lib/promoCapture.ts: capturePromoFromUrl(params) пишет sokrat-promo/sokrat-ref/
   sokrat-utm в localStorage (идемпотентно, не перезатирать непустое) + getStoredPromo().
   Вызвать на mount в EgorLanding.tsx, RegisterTutor.tsx, TutorSignupTrial.tsx, SignupRouter.tsx.
   В RegisterTutor — ТОЛЬКО useSearchParams + capture; signUp/redirect/role-логику НЕ трогать (rule 96).
2. Тихий бейдж «−20% закреплено · применится при оплате» в шапке ActivationChecklist.tsx,
   если getStoredPromo() непустой И репетитор не premium (get_subscription_status). Это бейдж,
   НЕ второй primary-CTA (rule 90).
3. Community-CTA: константы SOKRAT_COMMUNITY_TELEGRAM_URL (TG-чат) и
   SOKRAT_COMMUNITY_VK_URL='https://vk.me/join/WooW6wjwjhNwG7R0rzmKxpEBunNfHq1C3QQ='
   в tutorPlanCopy.ts (рядом с TUTOR_SUPPORT_TELEGRAM_URL). Новый CommunityJoinCard.tsx
   (TG+VK, рамка «репетиторы + прямая линия с нами + анонсы») на /tutor/home, появляется
   после флага sokrat-demo-seen (ставится при просмотре/прогоне демо-разбора). Non-blocking.

Инварианты (строго): rule 96 — auth-логику RegisterTutor не менять (только чтение URL);
rule 90 — один primary-CTA, бейдж не кнопка, community после «вау», data-sokrat-mode="tutor",
инпуты ≥16px, Lucide, без эмодзи; одна константа ссылок (не хардкод). НЕ таймер, НЕ поле telegram,
НЕ новая колонка на tutors, НЕ Yandex Metrica.

Перед мержем: npm run lint && build && smoke-check. Добавь блок «Deploy needed» (rule 95):
фронт — deploy-sokratai на VPS.
```

## Paste-ready инструкция для Claude Code — fast-follow (бэкенд, после конференции)

```
Реализуй fast-follow фичи «Онбординг лидов по QR Егора» (T4–T6, tasks.md) — бэкенд.

Прочитай spec.md §5 (technical design) и правила .claude/rules/{96,97,99,95}.

Построй:
4. Промо на аккаунт: прокинь getStoredPromo() в signUp({options:{data:{promo,ref}}});
   в email-verify (~178-207) + assign-tutor-role + oauth-коллбэках запиши profiles.promo_code
   и registration_source из метаданных (обнови whitelist метаданных email-verify). PII-free,
   код не логировать. Реюз колонок profiles.promo_code/registration_source — БЕЗ миграции на tutors.
5. Скидка на оплате: серверная applyPromoDiscount(price, profiles.promo_code) в
   yookassa-create-payment (~279-283): −20% для BLINOV_20 с реальным дедлайном. Цену задаёт
   ТОЛЬКО сервер — promo-поля в запросе клиента НЕТ (anti-tamper). Не ломай интро-200/бэнды/
   TEAM_PLAN_REQUIRED. Покажи «−20% по промокоду» в TutorPaymentModal. Ошибки flat {error,code} (rule 97).
6. Воронка: события qr_lead_registered/promo_captured/community_cta_clicked через
   _shared/analytics.ts (не Yandex Metrica).

Инварианты: цена только на сервере; anti-leak (promo_code не в student-эндпоинты);
rule 97 flat-ошибки; rule 96 auth allow-list не трогать. Edge деплоит Lovable на push.
Перед мержем: npm run lint && build && smoke-check.
```
