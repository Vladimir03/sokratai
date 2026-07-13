# Prompts для Claude Code — Онбординг лидов по QR Егора (фазы P0–P3)

**Спека:** `spec.md` · **Задачи:** `tasks.md` · **Бриф:** `claude-code-brief.md`
Каждый блок ниже — самодостаточный промпт: копируй целиком в Claude Code. Запускать по порядку.

| Фаза | Когда | Что | Деплой |
|---|---|---|---|
| **P0** | к завтрашней встрече Егора | промо-carrier + бейдж + community после «вау» (фронт) | `deploy-sokratai` (VPS) |
| **P1** | до первых оплат когорты (~7+ дней) | промо на аккаунт + −20% на оплате (бэкенд) | Lovable на push |
| **P2** | после конференции | воронка-телеметрия + дозвон-канал + дедлайн промо | Lovable + `deploy-sokratai` |
| **P3** | бэклог (опц.) | справочник промокодов, реферал, A/B | — |

---

## P0 — фронт, к завтра (T1–T3)

```
Реализуй P0 фичи «Онбординг лидов по QR Егора (промо + сообщество)» в этом репозитории.

Сначала прочитай: docs/delivery/features/egor-qr-onboarding/spec.md и tasks.md (T1–T3, T7),
правила .claude/rules/{96,90,95,99}.

ПРИНЦИП: переиспользовать существующее, НЕ переписывать. Онбординг (/tutor/home →
ActivationChecklist + DemoCheckCard/DemoCheckSheet), регистрация (RegisterTutor/
TutorSignupTrial/SignupRouter), tutorPlanCopy.ts — уже работают.

Построй только дельту P0 (фронт, один deploy):
1. Новый src/lib/promoCapture.ts: capturePromoFromUrl(params) пишет sokrat-promo/sokrat-ref/
   sokrat-utm в localStorage (идемпотентно, не перезатирать непустое) + getStoredPromo().
   Вызвать на mount в EgorLanding.tsx, RegisterTutor.tsx, TutorSignupTrial.tsx, SignupRouter.tsx.
   В RegisterTutor — ТОЛЬКО useSearchParams + capture; signUp/redirect/role/INITIAL_SESSION
   НЕ трогать (rule 96).
2. Тихий бейдж «−20% закреплено · применится при оплате» в шапке ActivationChecklist.tsx,
   если getStoredPromo() непустой И репетитор не premium (get_subscription_status, rule 99).
   Это бейдж, НЕ второй primary-CTA (rule 90).
3. Community-CTA: константы SOKRAT_COMMUNITY_TELEGRAM_URL (TG-чат репетиторов) и
   SOKRAT_COMMUNITY_VK_URL='https://vk.me/join/WooW6wjwjhNwG7R0rzmKxpEBunNfHq1C3QQ='
   в src/lib/tutorPlanCopy.ts (рядом с TUTOR_SUPPORT_TELEGRAM_URL). Новый CommunityJoinCard.tsx
   (TG+VK, рамка «репетиторы + прямая линия с нами + анонсы») на /tutor/home, появляется
   ПОСЛЕ флага sokrat-demo-seen (ставится при просмотре/прогоне демо-разбора). Non-blocking,
   ссылки через одну константу (не хардкод инлайн).

Инварианты (строго): rule 96 — auth-логику RegisterTutor не менять (только чтение URL);
rule 90 — один primary-CTA, бейдж не кнопка, community после «вау», data-sokrat-mode="tutor",
инпуты ≥16px, Lucide, sentence case, без эмодзи/градиентов/теней. НЕ таймер, НЕ поле telegram
в форме, НЕ новая колонка на tutors, НЕ Yandex Metrica.

Перед мержем: npm run lint && build && smoke-check. Добавь блок «Deploy needed» (rule 95):
фронт — deploy-sokratai на VPS.
```

---

## P1 — бэкенд, до первых оплат (T4–T5)

```
Реализуй P1 фичи «Онбординг лидов по QR Егора» (T4–T5, tasks.md) — бэкенд.
Задача: честно сдержать обещание бейджа «−20% закреплено».

Прочитай spec.md §5 (technical design) и правила .claude/rules/{96,97,99,95}.

ПРИНЦИП: реюз колонок profiles.promo_code (миграция 20251130201642) и profiles.registration_source
(20251109155208) — БЕЗ новой миграции на tutors. Оплата (yookassa-create-payment) считает цену
на сервере — эту логику расширяем, не переписываем.

Построй:
4. Промо на аккаунт: прокинь getStoredPromo() (из P0) в signUp({options:{data:{promo,ref}}})
   в RegisterTutor.tsx и TutorSignupTrial.tsx; в supabase/functions/email-verify/index.ts (~178-207)
   + assign-tutor-role + oauth-коллбэках (Яндекс/VK) запиши profiles.promo_code и
   registration_source из метаданных. Обнови whitelist метаданных email-verify синхронно.
   PII-free — промокод/ref не логировать.
5. Скидка на оплате: серверная applyPromoDiscount(price, profiles.promo_code) в
   supabase/functions/yookassa-create-payment/index.ts (~279-283): −20% для BLINOV_20 с РЕАЛЬНЫМ
   дедлайном промо. Цену задаёт ТОЛЬКО сервер — promo-поля в запросе клиента НЕТ (anti-tamper).
   Не сломай интро-200 ₽ / бэнды 1000-2000 / TEAM_PLAN_REQUIRED. Покажи «−20% по промокоду»
   в строке цены TutorPaymentModal.tsx. Edge-ошибки flat {error: рус, code} (rule 97).

Инварианты (строго): цена только на сервере; anti-leak — profiles.promo_code НЕ отдавать в
student-эндпоинты; rule 96 — tutor-role allow-list в email-verify не трогать; rule 97 flat-ошибки.
Edge деплоит Lovable на push.

Перед мержем: npm run lint && build && smoke-check.
```

---

## P2 — воронка + дозвон-канал + дедлайн (T6 + добор)

```
Реализуй P2 фичи «Онбординг лидов по QR Егора» — замеры и добор.

Прочитай spec.md, tasks.md (T6), правила .claude/rules/{96,90,97,70}.

Построй:
6. Серверная воронка: события qr_lead_registered, promo_captured, community_cta_clicked через
   supabase/functions/_shared/analytics.ts (logAnalyticsEventOnce, расширь enum; если нужно —
   регенерация types.ts). PII-free, джойнятся с tutor_students/profiles. НЕ Yandex Metrica
   (она только под лендинг).
7. Мягкий дозвон-канал: на экране регистрации репетитора — ненавязчивое опциональное поле/нудж
   «telegram (по желанию — чтобы напоминать про ДЗ)». НЕ блокирует регистрацию, НЕ трогает
   auth-логику (rule 96); email уже собираем. Записать в профиль server-side (не логировать).
8. Дедлайн промо BLINOV_20: реальная дата окончания (ЗоЗПП/Закон о рекламе) — отражается в
   бейдже (P0) и в скидке (P1). После дедлайна — полная цена + бейдж не показывается.

Инварианты: rule 96 — регистрация auth-зона, поле telegram опционально и не ломает флоу;
rule 90 — не плодить primary-CTA; rule 97 flat-ошибки; анти-спам напоминаний (rule 70 каскад
push→telegram→email уже есть — реюз, не новый канал).

Перед мержем: npm run lint && build && smoke-check. Deploy: edge — Lovable; фронт — deploy-sokratai
(добавь блок «Deploy needed»).
```

---

## P3 — бэклог (опционально, out of scope v0.1)

```
(Только если появится потребность — обсудить со спекой отдельным раундом.)

Реализуй P3-добор фичи «Онбординг лидов по QR Егора»:
- Справочник промокодов: таблица promo_codes (code, discount_pct, valid_until, partner) + миграция +
  RLS + чтение в yookassa-create-payment вместо хардкода BLINOV_20 (когда кодов/партнёров станет больше).
- Реферал сообщества: поверхность «пригласи репетитора» (15%/год) — реюз существующей реф-механики.
- A/B: плейсмент бейджа/community-CTA (с таймером/без) — только на серверной телеметрии P2.

Инварианты: цена только на сервере; миграции — Lovable на push; rule 97 flat-ошибки; PII-free.
Перед мержем: npm run lint && build && smoke-check.
```

---

## Порядок и зависимости

- **P0 не зависит ни от чего** — фронт, отдельный деплой, к завтра.
- **P1 зависит от P0** (`getStoredPromo()` из P0 прокидывается в signUp-метаданные). Должен выйти ДО первых оплат когорты.
- **P2 зависит от P0/P1** (события ссылаются на промо/community; дедлайн — на скидку P1).
- **P3** — по потребности, отдельным решением.

**Открытые вопросы (закрыть до старта соответствующей фазы):** TG-ссылка = чат или канал (P0); дедлайн BLINOV_20 (P1/P2); сверка ID Core Job с job-graph.md (approve спеки).
