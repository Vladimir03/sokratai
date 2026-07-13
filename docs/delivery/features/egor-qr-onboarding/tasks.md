# Tasks — Онбординг лидов по QR Егора (промо + сообщество)

**Спека:** `spec.md` · **Бриф:** `claude-code-brief.md` · **CJM:** чат-артефакт `cjm_egor_qr_leads`
**Принцип:** REUSE существующее, строим только дельту. P0 (фронт, `deploy-sokratai`) → потом fast-follow (бэкенд, Lovable).

> **Статус: draft, к реализации.** P0 = T1–T3 (успеть к завтрашней встрече Егора). Fast-follow = T4–T6 (до первых оплат когорты, ~7+ дней). Разведка кода — в `spec.md §5`.

---

## P0 — фронт, один `deploy-sokratai` (к завтра)

## T1 — Capture `?ref/?promo/?utm` → localStorage
**Reuse:** `react-router` `useSearchParams`; паттерн локального стораджа проекта.
**Дельта:** новый `src/lib/promoCapture.ts` — `capturePromoFromUrl(params)` пишет `sokrat-promo`/`sokrat-ref`/`sokrat-utm` (идемпотентно, **не перезатирать непустое**); `getStoredPromo()`. Вызвать на mount в `EgorLanding.tsx`, `RegisterTutor.tsx`, `TutorSignupTrial.tsx`, `SignupRouter.tsx`. **В `RegisterTutor` — только `useSearchParams` + capture; signUp/redirect/role-логику НЕ трогать (rule 96).**
**AC:** после `/register-tutor?ref=egor&promo=BLINOV_20&utm_source=egor` в localStorage лежат промо/ref/utm; повторный заход с пустыми параметрами не стирает; auth-флоу без изменений (`build` зелёный).

## T2 — Бейдж «−20% закреплено» в онбординге
**Reuse:** `src/components/tutor/home/ActivationChecklist.tsx` (шапка), статус premium (`useTutorPlan`/`get_subscription_status`, rule 99).
**Дельта:** тихая строка «−20% закреплено за тобой · применится при оплате», если `getStoredPromo()` непустой И репетитор не premium. **Не второй primary-CTA** (rule 90) — это бейдж, не кнопка.
**AC:** новый лид с промо видит бейдж на `/tutor/home`; premium/без-промо — не видит; тон нейтральный, без таймера; sentence case, Lucide, `data-sokrat-mode="tutor"`.

## T3 — Community-CTA (TG + VK) после «вау»
**Reuse:** `DemoCheckCard.tsx`/`DemoCheckSheet.tsx` (демо-разбор = быстрый «вау»; события `tutor_demo_check_viewed`/`tutor_demo_check_ran`), `tutorPlanCopy.ts` (константы рядом с `TUTOR_SUPPORT_TELEGRAM_URL:14`).
**Дельта:** константы `SOKRAT_COMMUNITY_TELEGRAM_URL` (TG-чат репетиторов) + `SOKRAT_COMMUNITY_VK_URL` (`https://vk.me/join/WooW6wjwjhNwG7R0rzmKxpEBunNfHq1C3QQ=`); новый `CommunityJoinCard.tsx` (2 ссылки-кнопки + рамка «репетиторы + прямая линия с нами + анонсы»). Флаг `sokrat-demo-seen` ставится при просмотре/прогоне демо; карточка появляется на `/tutor/home` только после флага (non-blocking). Ссылки — `openLink`/`<a target=_blank rel=noopener>`.
**AC:** до демо-разбора карточки нет; после — появляется с рабочими TG+VK; клики не блокируют онбординг; ссылки берутся из одной константы (не хардкод инлайн). **Подтвердить, что TG-URL = чат, а не канал (open question 1).**

## Fast-follow — бэкенд, Lovable (до первых оплат когорты)

## T4 — Промо/ref → `profiles.promo_code` при регистрации
**Reuse:** `profiles.promo_code`/`registration_source` (колонки уже есть), signUp-метаданные (паттерн `consent_intent`/`trial_intent`), `email-verify`/`assign-tutor-role`/oauth-коллбэки (создают запись, rule 96).
**Дельта:** прокинуть `getStoredPromo()` в `signUp({ options: { data: { promo, ref } } })`; в `email-verify` (~178-207) и зеркалах записать `profiles.promo_code`/`registration_source`. PII-free, без логирования кода. **Whitelist метаданных email-verify обновить синхронно.**
**AC:** после подтверждения email у репетитора `profiles.promo_code='BLINOV_20'`, `registration_source='egor'`; повторная регистрация не дублирует; oauth-пути (Яндекс/VK) тоже сохраняют.

## T5 — Ветка −20% в `yookassa-create-payment` + показ в модалке
**Reuse:** `yookassa-create-payment` (серверная цена), `TutorPaymentModal.tsx`/`TutorTariffSection.tsx`.
**Дельта (per-user окно, решения владельца 2026-07-13 — см. spec §3):** −20% на band-цену по сохранённому `profiles.promo_code`, гейт `!isFirstTutorPayment && paidCount < 6` (интро исключён, месяцы 2–6); **цену задаёт только сервер, promo-поля в запросе клиента нет** (anti-tamper). Календарного cutoff тут НЕТ — claim-дедлайн 31.12.2026 в `_shared/promo-intent.ts`. Ответ несёт `promo_applied/promo_percent/amount_before_promo`; модалка рисует «−20% по промокоду» + зачёркнутую цену. Ошибки — pre-existing error-shape функции (rule-97-долг, promo-ветка ошибок не добавляет).
**AC:** оплата репетитора с `BLINOV_20` на платежах №2–6 уходит с −20%; интро (№1) и №7+ — полная цена; без кода — полная; клиент не может подставить цену; интро-200 ₽/бэнды/`TEAM_PLAN_REQUIRED` не сломаны.

## T6 — Серверные события воронки QR ✅ (P2, 2026-07-13)
**Reuse:** `supabase/functions/_shared/analytics.ts` (`logAnalyticsEvent`/`logAnalyticsEventOnce`, enum), `analytics_events`.
**Дельта:** `qr_lead_registered` + `promo_captured` — server-side в финализаторах регистрации через `persistPromoAttributionAndTrack` (wrapper поверх атрибуции); `community_cta_clicked` — client fire-and-forget beacon → **`POST /track`** в `tutor-progress-api` (whitelist имени события, дедуп once-per-tutor). CHECK-whitelist расширен миграцией `20260713140000` (rule 99). PII-free (id + категории ref/channel + булевы флаги). **Не** Yandex Metrica.
**AC:** события пишутся с `actor_user_id`, джойнятся с `tutor_students`/`profiles`; видно воронку скан→регистрация→промо→community→оплата.

## T8 — Мягкий дозвон-канал (telegram) ✅ (P2, item 7, 2026-07-13)
**Дельта:** необязательное поле «Telegram (по желанию)» на `RegisterTutor` (не блокирует, без required); прокидка через signUp-метаданные `telegram` → server-side запись `profiles.telegram_username` (`persistTutorTelegramFromMetadata` в email-verify `type=signup` + assign-tutor-role), санитайз хендла, значение НЕ логируется, идемпотентно. Не трогает auth-логику (rule 96). Реминдер-отправка — реюз rule-70 каскада (не новый канал), сама отправка вне scope P2.
**AC:** телеграм опционален; при указании доезжает в профиль; регистрация не ломается при пустом/невалидном; auth-флоу без изменений.

## T7 — Регрессии, валидация, деплой
**AC:** `npm run lint && build && smoke-check` зелёные; auth-флоу (rule 96) не изменён логически; anti-leak (промо не утекает в student-эндпоинты); rule 90 (один primary-CTA); добавлен блок «Deploy needed» (rule 95: фронт — `deploy-sokratai`; edge fast-follow — Lovable на push).

---

## Открытые решения (до старта)
1. TG-ссылка `@sokrat_rep` — чат репетиторов или канал? Нужен инвайт в чат (VK уже чат).
2. ~~Дедлайн промо~~ **РЕШЕНО (2026-07-13):** длительность = per-user первые 6 мес (интро исключён, №2–6); claim до 31.12.2026. См. spec §3.
3. localStorage-промо как P0-носитель принят; `profiles.promo_code` (T4) — надёжный source of truth.

## Out of scope (P1+)
Таймер/countdown · ~~отдельное поле telegram при регистрации~~ (сделано, T8) · справочник промокодов в БД · родительский/ученический онбординг по этому каналу · автоприменение без сохранения на аккаунт · автоматическая реминдер-рассылка репетитору (реюз rule-70 каскада — отдельно).
