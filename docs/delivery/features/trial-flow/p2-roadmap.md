# Trial Flow — Phase P2 Roadmap

**Версия:** v0.1
**Дата:** 2026-05-04
**Статус:** roadmap stub (не детальная спека)

---

## Что это

Этот документ — **roadmap-only** stub для Phase P2 фичи trial-flow. Это **не спека** — детальная спека Phase P2 пишется отдельно после того как Phase P0 + P1 прошли feedback от Vladimir и первой когорты ≥50 trial-юзеров.

Каноничная спека Phase P0 + P1 — `docs/delivery/features/trial-flow/spec.md`.

---

## Условие старта Phase P2

Phase P2 начинается **только когда выполнены все три условия**:

1. **Phase P0 deploy на проде ≥ 14 дней** (signup-конверсия валидирована или отвергнута)
2. **Phase P1 deploy на проде ≥ 14 дней** (backend gating работает, ≥1 репетитор прошёл cycle trial → paid)
3. **Когорта ≥ 50 trial-signup-ов** (достаточно данных для cohort-based decision'ов и для A/B-тестов)

До тех пор — этот roadmap живёт без расширения. Не реализовывать P2 заранее.

---

## Scope Phase P2

### P2.1 — Telegram welcome-bot для unidentified users

- **Что:** автоматическая welcome-серия в `supabase/functions/telegram-bot/index.ts` для пользователей, которые написали `/start` боту, но не зарегистрированы в системе.
- **Как:** inline-кнопки `[🎁 Попробовать в кабинете 7 дней]` (deep-link на `/signup?ref=tg-bot&trial=7`), `[📚 3 поста о методе]`, `[❓ Задать вопрос Егору]`.
- **Зачем:** канал Егора `t.me/sokrat_rep` сейчас «сырой» (2 поста). Bot интерактивен и конвертирует лучше пассивного канала.
- **Зависимости:** контент от Егора (pinned posts, welcome copy, метод).

### P2.2 — Email-цепочка дней 1, 3, 5

- **Что:** email на день 1 («Ты создал первое ДЗ?»), день 3 (case study репетитора-донора), день 5 («Осталось 2 дня — попробуй фичу X»).
- **Как:** расширение cron `trial-reminders` + новые email templates `trial-day-1.ts`, `trial-day-3.ts`, `trial-day-5.ts`.
- **Зачем:** в Phase P1 только day-7 reminder. Цепочка дней 1/3/5 повышает activation внутри trial-окна (по research CloudText, Мой Класс).
- **Зависимости:** Phase P1 cron infrastructure готова.

### P2.3 — A/B тест 7 дней vs 14 дней trial

- **Что:** GrowthBook (или native A/B mechanism) flag `trial_duration_days` со значениями 7 или 14. 50/50 split на новых signup'ах.
- **Как:** column `tutor_subscriptions.trial_duration_days` (default 7) + override от feature flag на signup. Cron уважает per-row значение.
- **Зачем:** валидация гипотезы «7 дней — оптимально». 14 дней дают репетитору больше времени увидеть value, но удлиняют voronka.
- **Зависимости:** ≥ 100 trial-юзеров для статистической значимости.

### P2.4 — A/B тест без-карты vs с-картой

- **Что:** flag `trial_requires_card` со значениями `false` (P0/P1 default) или `true`. С-картой — token saved upfront, auto-charge на день 7 если не cancelled.
- **Как:** в `TutorSignupTrial.tsx` per-flag rendering ЮKassa токенизации; backend webhook handler уважает auto-charge logic.
- **Зачем:** валидация гипотезы «без карты лучше». Возможен trade-off: less abandonment vs more conversion.
- **Зависимости:** запускается ТОЛЬКО если P1 trial→paid < 15% — иначе риск ломать что работает.

### P2.5 — Trial extension по запросу (OkoCRM-pattern)

- **Что:** на день 7 в `<TrialExpiredDialog />` добавить tertiary CTA «Нужна ещё неделя — расскажу почему». Открывает text-input → отправка в TG-бот Vladimir/Егор → manual decision (Vladimir даёт +7 дней через DB UPDATE).
- **Как:** UI-only расширение dialog'а + endpoint POST `/tutor-subscription/request-extension` → отправка TG-сообщения Vladimir.
- **Зачем:** повышает conversion в начале trial когда user нерешителен. OkoCRM делает.
- **Зависимости:** ≥50 trial-юзеров (иначе manual extension scale'ится Vladimir личным временем).

### P2.6 — Push-уведомления о countdown

- **Что:** web push на день 6 (за 24 часа до expiry) + mobile push на iOS/Android (через Firebase, существующая infra).
- **Как:** требует mounting `<PushOptInBanner>` на tutor-side (currently mounted only на student-side `StudentHomework.tsx`, см. `.claude/rules/95-production-deploy.md`).
- **Зачем:** банер в кабинете не работает если tutor не открывал кабинет последние 2-3 дня. Push достаёт.
- **Зависимости:** tutor opt-in surface должен быть собран (отдельный TASK).

---

## Что НЕ в Phase P2 (отложено в P3+)

- «1 ₽ первый месяц» альтернативный оффер
- Auto-tier selection по числу учеников
- Promo-code mechanism для legacy «100 ₽ для друзей»
- IP fingerprint audit log для trial-juicing protection
- Bulk-операции для legacy migration через UI
- Job workspace landing для onboarding (jobs-first per doc 17 §4.1)

---

## Связанные документы

- `docs/delivery/features/trial-flow/spec.md` — Phase P0 + P1 канонический spec
- `SokratAI/trial-flow-recommendations.md` — research конкурентов и рекомендации
- `SokratAI/legacy-tutors-personal-message.md` — шаблоны для legacy migration
- `.claude/rules/95-production-deploy.md` — push opt-in tech debt
- `.claude/rules/70-notifications.md` — email/push cascade infrastructure
