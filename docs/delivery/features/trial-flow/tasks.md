# Tasks: Trial Flow для репетиторов (P0 + P1)

**Спека:** `docs/delivery/features/trial-flow/spec.md` (v0.1, 2026-05-04)
**Pipeline шаг:** 5 (TASKS) из `docs/discovery/development-pipeline.md`
**Дата:** 2026-05-04

> Нарезка спеки на задачи + промпты для AI-агентов. Каждая задача: Job link → Agent → Files → AC → промпт. Финальный блок — copy-paste-ready промпты в plain text для прямой вставки в Claude Code / Codex / Lovable.

---

## Карта задач

### Phase P0 (~5–7 человеко-дней)

| ID | Subject | Agent | Effort | Blocks | AC |
|---|---|---|---|---|---|
| T0 | Verify RLS на `profiles.UPDATE` self-write `trial_started_at` | Claude Code | XS (15 мин) | T4 | — (предусловие) |
| T1 | Update Hero copy + Telegram TG-blue + Compare-блок | Claude Code | M (1.5д) | — | AC-P0-1, AC-P0-2 |
| T2 | Update Pricing 5→3+2 карточек + price-stack в AI-старт | Claude Code | M (1д) | — | AC-P0-6 |
| T3 | Update FreemiumBridge + FAQ + FinalCTA copy | Claude Code | S (0.5д) | — | AC-P0-7 |
| T4 | Migration `add_trial_started_at_to_profiles.sql` | Claude Code | S (0.5д) | T6 | — (foundation) |
| T5 | Расширить `tutorLandingAnalytics.ts` 5 новых goals | Claude Code | XS (1ч) | T1, T2, T6 | AC-P0-2, AC-P0-9 |
| T6 | Создать `TutorSignupTrial.tsx` + `SignupRouter.tsx` + route registration | Claude Code | M (2д) | — | AC-P0-3, AC-P0-4, AC-P0-5 |
| T7 | Update meta-tags в `index.html` + `Index.tsx` | Claude Code | XS (30 мин) | — | — (SEO) |
| T8-P0 | Validation + deploy P0 на VPS | Vladimir | S (0.5д) | all P0 | AC-P0-9, AC-P0-10 |
| T9-P0 | Codex review (independent) после deploy | Codex | S (1ч) | T8-P0 | AC-P0-* compliance |

### Phase P1 (~10–15 человеко-дней)

| ID | Subject | Agent | Effort | Blocks | AC |
|---|---|---|---|---|---|
| T10 | Verify ЮKassa recurring API + cron mechanism | Claude Code | S (2ч) | T15 | — (предусловие, Q6/Q7) |
| T11 | Migration `create_tutor_subscriptions.sql` + RLS | Claude Code | M (1.5д) | T13, T14, T15 | AC-P1-1, AC-P1-13 |
| T12 | Migration backfill legacy `paid_grandfathered` | Claude Code | M (1д) | T11 | AC-P1-8, AC-P1-9 |
| T13 | `_shared/subscription-gating.ts` helper | Claude Code | M (1д) | T14, T15 | AC-P1-2, AC-P1-7 |
| T14 | AI-gating в `chat`, `homework-api/check-answer`, `homework-api/hint` | Claude Code | M (1.5д) | T13 | AC-P1-2, AC-P1-7, AC-P1-13 |
| T15 | Edge function `tutor-subscription` (GET/POST endpoints) | Claude Code | M (2д) | T11 | AC-P1-5, AC-P1-6, AC-P1-12 |
| T16 | ЮKassa webhook расширение для tutor-payments | Claude Code | M (1.5д) | T15 | AC-P1-5, AC-P1-11 |
| T17 | `tutorSubscriptionApi.ts` + `useTutorSubscription` hook | Claude Code | M (1д) | T15, T18, T19 | AC-P1-3, AC-P1-4 |
| T18 | `TrialCountdownBanner.tsx` | Claude Code | M (1д) | T17, T20 | AC-P1-3 |
| T19 | `TrialExpiredDialog.tsx` (Radix Dialog blocking) | Claude Code | M (1.5д) | T17, T20 | AC-P1-4, AC-P1-5, AC-P1-6 |
| T20 | Интеграция banner и dialog в `AppFrame.tsx` | Claude Code | S (0.5д) | T18, T19 | AC-P1-3, AC-P1-4 |
| T21 | Update `TutorSignupTrial.tsx` для INSERT в `tutor_subscriptions` | Claude Code | S (0.5д) | T11, T15 | AC-P1-1 |
| T22 | Email templates `trial-day-7.ts` + `trial-day-14.ts` | Claude Code | S (1д) | T23 | AC-P1-10 |
| T23 | Cron edge function `trial-reminders` | Claude Code | M (1.5д) | T22 | AC-P1-10 |
| T24 | Validation + deploy P1 (frontend через `deploy-sokratai`, backend через Lovable) | Vladimir | S (0.5д) | all P1 | all AC-P1-* |
| T25 | Manual QA per 13 AC-P1-* + Codex review | Vladimir + Codex | M (1д) | T24 | AC-P1-* compliance |
| T26 | Personal TG/email рассылка legacy-репетиторам | Vladimir / Egor | S (0.5д) | T12, T25 | (offline) |

---

## Implementation Status

| ID | Status | Result |
|---|---|---|
| T0 | Done 2026-05-05 | RLS OK: `public.profiles` already has `Users can update their own profile` (`FOR UPDATE USING (auth.uid() = id)`) without column-mask. No RLS SQL needed in T4. |
| T1 | Done 2026-05-05 | `Hero.tsx`: chip → «🎁 Новое: 7 дней пробного периода без карты» (animate-pulse dot), primary CTA → «🎁 Попробовать 7 дней бесплатно» с href `/signup?ref=tutor-landing&trial=7` и goal `tutor_landing_cta_trial_hero`, secondary TG-кнопка outline TG-blue (#229ED9) — единственный visually-primary CTA сохранён, 4 trust ribbons, inline compare-блок «Было / Стало» с tokenized colors (`var(--sokrat-danger-*)` + green-50/300/800 fallbacks). |
| T2 | Done 2026-05-05 | `Pricing.tsx`: 5 → 3+2. Tier type extended `priceStack` + `cta.microcopy`. Tiers `plus`/`pro` уехали в новый `pricing-extra-row` (2 компактные карточки). AI-старт highlighted с popular chip «7 дней бесплатно», price-stack 0 (ochre trial chip) → 200 (big ochre) → 1000 (followup). CTA «🎁 Начать пробный — без карты», microcopy «Через 7 дней спросим, продолжать ли. Не списываем сами.», telemetry `tutor_landing_cta_trial_pricing`. |
| T3 | Done 2026-05-05 | `FreemiumBridge.tsx`: closing → «AI-слой подключается опционально — 7 дней бесплатно, потом 200 ₽ первый месяц». `FAQ.tsx`: переписан Q «Сколько стоит и есть ли пробный?» под trial-лестницу + новый Q «Что будет с моими учениками и данными после trial, если я не продолжу?». `FinalCTA.tsx`: lede + primary CTA «🎁 7 дней бесплатно», href `/signup?ref=tutor-landing&trial=7`, telemetry `tutor_landing_cta_trial_final`. `ProductTour1.tsx`: inline CTA «🎁 Попробовать 7 дней бесплатно →» + новый href. |
| T4 | Done 2026-05-05 | Added `supabase/migrations/20260505100000_add_trial_started_at_to_profiles.sql`: nullable `trial_started_at`, column comment, partial index `idx_profiles_trial_started_at`; no backfill/drop. `supabase migration list` unavailable locally because Supabase CLI is not in PATH. |
| T5 | Done 2026-05-05 | Extended `TutorLandingGoal` with 5 P0 trial goals. `COUNTER_ID` and `trackTutorLandingGoal` signature unchanged. Validation: `npm run build` passed. |
| T6 | Done 2026-05-05 | `TutorSignupTrial.tsx`: 2-колоночный grid (form + value-prop), zod schema (email/password 8+/uppercase/digit, subject enum, oferta literal true), inline-валидация после blur, `signup_started` fires after zod success в submit (не на mount), `signUp({email,password,options.data.username,subject,signup_source})` → **`assign-tutor-role` invoke** (parity с RegisterTutor) → `claimPendingInvite` → `applyTrialMarker(userId): Promise<boolean>` (UPDATE `profiles.trial_started_at = NOW()` если `?trial=7`) → `signup_completed` fires **только** при role+marker success → navigate `/tutor/home`. TG path: `TutorTelegramLoginButton` (intended_role=tutor); `onAuthStateChange('SIGNED_IN')` listener применяет marker и fires goal conditionally. Mount: getSession → если session → navigate `/tutor/home`. Inputs `font-size: 16px`, `touch-action: manipulation`. Wrapper `min-height: 100dvh` (вместо 100vh — iOS Safari fix). `SignupRouter.tsx`: disambiguator `?ref=tutor-landing || trial=7` → TutorSignupTrial, иначе SignUp. `App.tsx`: route `/signup` → `<SignupRouter />`. |
| T7 | Done 2026-05-05 | `index.html` все 3 description meta-tag + `src/pages/Index.tsx` `TUTOR_LANDING_DESCRIPTION` синхронизированы: tail «От 200 ₽ в первый месяц.» → «7 дней бесплатно — без карты. Потом 200 ₽ первый месяц.» |
| T8-P0 | Pending | Validation + deploy на VPS — за Vladimir после code review approval. |
| T9-P0 | Done 2026-05-05 (Round 1) | ChatGPT-5.5 independent review: FAIL → исправлены P0 blockers (assign-tutor-role missing, generic TelegramLoginButton, signup_started fired on mount + signup_completed on marker fail) + P1 (ProductTour1 stale CTA) + P2 (Hero gift icon AC-P0-1, secondary CTA hierarchy, Compare colors tokenized, 100vh→100dvh). Re-review pending. |

---

## Phase P0 — Detailed Tasks

### T0: Verify RLS на `profiles.UPDATE` (Open Question Q5)

**Job:** R3-1 (Acquisition foundation)
**Agent:** Claude Code
**Files:** `supabase/migrations/*.sql` (read-only)
**Effort:** XS (15 минут)
**Blocks:** T4

**Описание:** Перед написанием миграции `add_trial_started_at_to_profiles.sql` нужно убедиться, что существующая RLS policy на `profiles` разрешает аутентифицированному пользователю UPDATE собственной строки (column `trial_started_at` будет писаться клиентом из `TutorSignupTrial.tsx` после signup).

**Шаги:**
1. `grep -rn "CREATE POLICY.*profiles" supabase/migrations/`
2. Найти UPDATE policy для self
3. Если policy с `USING (auth.uid() = id)` (или эквивалентным self-update condition) уже есть — OK, миграция T4 без RLS-изменений
4. Если column-mask или ограничение — добавить в миграцию T4 расширение policy

**Output:** строка в conversation thread «RLS OK / нужно расширить», для T4 reference.

**Status:** Done 2026-05-05 — RLS OK, базовая policy `Users can update their own profile` уже разрешает self-update по `profiles.id`.

---

### T1: Hero copy update + TG-blue + Compare-блок

**Job:** R1-3 (показать ценность до commit)
**Agent:** Claude Code
**Files:**
- `src/components/sections/tutor/Hero.tsx` (edit)
- `tailwind.config.ts` (edit, добавить `socrat.tg` color если нет)

**AC из спеки:** AC-P0-1, AC-P0-2

**Описание:**
Заменить primary CTA с «Попробовать за 200 ₽» на «🎁 Попробовать 7 дней бесплатно». Сделать secondary CTA Telegram-blue (узнаваемость). Добавить compare-блок «Было / Стало» под trust-ribbons.

**Конкретные copy-changes:**
- Chip: ~~«Для репетиторов физики · математики · информатики»~~ → «🎁 Новое: 7 дней пробного периода без карты»
- H1: оставляем «Инструмент репетитора. От репетитора.»
- Lede: оставляем
- Byline: оставляем
- Primary CTA: «Попробовать 7 дней бесплатно» (text), telemetry goal `tutor_landing_cta_trial_hero` (T5)
- Secondary CTA: «Канал Егора →», `bg-socrat-tg` (`#229ED9`), white text
- Trust ribbons: «Без карты · Полный AI-доступ · Потом 200 ₽ — первый месяц · Отмена в один клик»
- Compare-блок (новый): grid-cols-2 → красный «Было: Сразу платите ~~200 ₽~~ в первый месяц», зелёный «Стало: 7 дней бесплатно — без карты»

**Guardrails:**
- НЕ менять структуру компонента, только copy и стили secondary CTA
- НЕ создавать новые design tokens — переиспользовать существующие
- Compare-блок — inline в Hero (не выносить в отдельный компонент в P0; это парковочное в spec §13)
- Mobile (`<sm`): compare-блок ниже trust-ribbons, full-width 1 column

---

### T2: Pricing simplification 5→3+2

**Job:** R3-1, R1-3
**Agent:** Claude Code
**Files:** `src/components/sections/tutor/Pricing.tsx` (edit)

**AC:** AC-P0-6

**Описание:** Свести 5 карточек к 3+2: Free / **AI-старт** (highlighted, popular chip «7 дней бесплатно») / AI-команда + 2 компактных «До 10 учеников?» / «До 20 учеников?» в дополнительном ряду.

**Изменения в `TIERS` array:**
- Удалить tier `plus` и `pro` из основной grid (они переезжают в `pricing-extra-row`)
- Поменять highlighted-карточку `ai-start`:
  - `popularChip`: «7 дней бесплатно» (было «Популярно»)
  - Внутри карточки — price-stack:
    - «Сегодня: 0 ₽ — 7 дней полного AI» (text accent ochre-700)
    - ~~1 000 ₽/мес~~ −80%
    - 200 ₽
    - Caption «первый месяц после trial — экономия 800 ₽»
    - «Со 2-го месяца: от 1 000 ₽/мес по числу учеников»
  - CTA: «🎁 Начать пробный — без карты» → `/signup?ref=tutor-landing&trial=7`
  - Microcopy под CTA: «Через 7 дней спросим, продолжать ли. Не списываем сами.»
- Tier `team` остаётся как есть, CTA «Связаться» → @Analyst_Vladimir

**Новый row "extra-cards" под pp-grid (НЕ внутри grid):**
- Card 1: emoji 🔟 + «До 10 учеников на AI? — 1 000 ₽/мес со 2-го месяца»
- Card 2: emoji 2️⃣0️⃣ + «До 20 учеников на AI? — 2 000 ₽/мес со 2-го месяца»

**Guardrails:**
- Сохранить existing CSS `.pp-card`, `.pp-grid`, `.pp-card--highlighted` (минимальные правки только под price-stack)
- ROI-callout в конце Pricing — оставить как есть
- Telemetry: highlighted CTA — goal `tutor_landing_cta_trial_pricing` (T5)

---

### T3: FreemiumBridge + FAQ + FinalCTA copy

**Job:** R3-1
**Agent:** Claude Code
**Files:**
- `src/components/sections/tutor/FreemiumBridge.tsx` (edit)
- `src/components/sections/tutor/FAQ.tsx` (edit)
- `src/components/sections/tutor/FinalCTA.tsx` (edit)

**AC:** AC-P0-7

**Описание:** Точечные copy-правки в трёх компонентах.

**FreemiumBridge.tsx** — closing string:
- БЫЛО: «AI-слой подключается опционально — от 200 ₽ в первый месяц. Без него базовая платформа остаётся.»
- СТАЛО: «AI-слой подключается опционально — **7 дней бесплатно, потом 200 ₽ первый месяц**. Без него базовая платформа остаётся.»

**FAQ.tsx**:
1. Update вопрос «Сколько стоит и есть ли пробный период?» — ответ:
   > Да, **7 дней бесплатно с полным AI-доступом — без карты**. После trial покажем, что вы получили, и спросим, продолжать ли. Если да — 200 ₽ первый месяц (вместо 1 000 ₽), отмена в один клик. Если нет — AI выключится, базовая платформа (оплаты, расписание) останется. Дальше: 1 000 ₽/мес до 10 учеников, 2 000 ₽ до 20, 3 000 ₽ за 20+. Один час вашего времени — 1,5–2 тысячи рублей. Платформа окупается первой неделей использования.

2. Add new вопрос (вставить **последним** в `ITEMS` array): «Что будет с моими учениками и данными после trial, если я не продолжу?»
   > Все данные сохранятся. Ученики, ДЗ, история проверок — всё на месте. Просто AI-слой выключится — новые ДЗ нельзя будет проверять автоматически. Базовая платформа (оплаты, расписание, профили) продолжит работать бесплатно. Захотите вернуть AI — один клик в настройках.

**FinalCTA.tsx**:
- БЫЛО: «Попробуйте Сократ AI за 200 ₽ в первый месяц.»
- СТАЛО: «Попробуйте Сократ AI **7 дней бесплатно — без карты**. Понравится — продолжите за 200 ₽ первый месяц. Не понравится — базовая платформа всё равно останется бесплатной.»
- Primary CTA text: «🎁 7 дней бесплатно»
- Telemetry: goal `tutor_landing_cta_trial_final` (T5)

**Guardrails:**
- Compare-блок в FinalCTA НЕ добавляем (он только в Hero, чтобы не дублировать сообщение)
- Существующие классы и структура остаются

---

### T4: Migration `profiles.trial_started_at`

**Job:** R3-1 (foundation)
**Agent:** Claude Code
**Files:** `supabase/migrations/20260505100000_add_trial_started_at_to_profiles.sql` (new)

**AC:** — (foundation для AC-P0-3, AC-P0-4)

**Описание:** Additive миграция: новая колонка + index. Per T0 verify, RLS уже разрешает self-update.

**Status:** Done 2026-05-05 — файл создан, RLS-расширение не потребовалось.

**SQL:**
```sql
-- supabase/migrations/20260505100000_add_trial_started_at_to_profiles.sql

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN profiles.trial_started_at IS
  'Timestamp когда репетитор начал trial. NULL для legacy и тех, кто пришёл не через trial-flow. P0: только measurement; AI-gating в P1 через tutor_subscriptions.';

CREATE INDEX IF NOT EXISTS idx_profiles_trial_started_at
  ON profiles(trial_started_at)
  WHERE trial_started_at IS NOT NULL;

-- Если T0 показал что нужно расширение RLS policy:
-- (только если verify показал необходимость)
-- DO $$
-- BEGIN
--   IF NOT EXISTS (...) THEN
--     CREATE POLICY "Users update own profile trial_started_at" ...
--   END IF;
-- END $$;
```

**Guardrails:**
- НЕТ DROP-операций
- НЕТ миграции данных существующих row (NULL по умолчанию OK)
- Idempotent: `IF NOT EXISTS` везде

**Validation:** `rg` проверил отсутствие `DROP` и наличие `IF NOT EXISTS`; `supabase migration list` не запустился локально, потому что Supabase CLI не установлен/не в PATH.

---

### T5: Yandex Metrika goals extension

**Job:** R3-1 (measurement)
**Agent:** Claude Code
**Files:** `src/lib/tutorLandingAnalytics.ts` (edit)

**AC:** AC-P0-2, AC-P0-9

**Описание:** Расширить тип `TutorLandingGoal` 5 новыми event-ами:

```ts
export type TutorLandingGoal =
  | "tutor_landing_cta_hero" // existing
  | "tutor_landing_cta_tour1" // existing
  | "tutor_landing_cta_pricing" // existing
  | "tutor_landing_cta_final" // existing
  | "tutor_landing_tg_channel_click" // existing
  | "tutor_landing_cta_trial_hero" // P0 — Hero CTA
  | "tutor_landing_cta_trial_pricing" // P0 — Pricing AI-старт CTA
  | "tutor_landing_cta_trial_final" // P0 — FinalCTA
  | "tutor_landing_trial_signup_started" // P0 — TutorSignupTrial mount
  | "tutor_landing_trial_signup_completed"; // P0 — успешный signup
```

**Привязка:**
- `tutor_landing_cta_trial_hero` — клик primary CTA в `Hero.tsx` (T1)
- `tutor_landing_cta_trial_pricing` — клик в `AI-старт` highlighted-карточке (T2)
- `tutor_landing_cta_trial_final` — клик в FinalCTA (T3)
- `tutor_landing_trial_signup_started` — mount `TutorSignupTrial.tsx` без авто-redirect-а (T6)
- `tutor_landing_trial_signup_completed` — успешный signup (T6)

**Guardrails:** не трогать `COUNTER_ID` или `trackTutorLandingGoal` сигнатуру; только тип расширяем.

**Status:** Done 2026-05-05 — union расширен, `COUNTER_ID` и `trackTutorLandingGoal(goal: TutorLandingGoal)` не изменены.

**Validation:** `npm run build` passed. AC-P0-2/AC-P0-9 telemetry dashboard confirmation remains post-deploy/24h check.

---

### T6: TutorSignupTrial.tsx + SignupRouter

**Job:** R3-1 (acquisition)
**Agent:** Claude Code
**Files:**
- `src/pages/TutorSignupTrial.tsx` (new)
- `src/pages/SignupRouter.tsx` (new, тонкий диспетчер)
- `src/App.tsx` (edit, заменить Route `/signup` на `<SignupRouter />`)

**AC:** AC-P0-3, AC-P0-4, AC-P0-5

**Описание:** Single-page форма trial-регистрации. Переиспользует zod-валидацию из существующего `SignUp.tsx`, плюс TG OAuth fallback. После успешного signup — UPDATE `profiles.trial_started_at = NOW()` если URL-param `trial=7`.

**Layout:** двухколоночный grid (form слева 50%, value-prop справа 50%) на ≥md, single-column на mobile.

**State (zod):**
```ts
const trialSignupSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(8).regex(/[A-Z]/).regex(/[0-9]/),
  subject: z.enum(["physics", "maths", "informatics", "multiple", "other"]).default("physics"),
  oferta: z.literal(true),
});
```

**Username auto-generation (Q4 default):**
```ts
function emailToUsername(email: string): string {
  return email.split("@")[0].toLowerCase().replace(/[^a-z0-9_-]/g, "");
}
// При коллизии — `_2`, `_3` через попытку повторного signup; в P0 принимаем что collision rare
```

**Поведение при mount:**
1. `supabase.auth.getSession()` — если session есть → redirect `/tutor/home` (или `/chat` для не-tutor)
2. Else: `trackTutorLandingGoal("tutor_landing_trial_signup_started")` (T5), показать форму

**Поведение при submit:**
1. zod validation
2. `supabase.auth.signUp({ email, password, options: { data: { username: emailToUsername(email) }}})`
3. Если `data.session`:
   - `await claimPendingInvite()` (existing helper)
   - Если URL-param `trial === '7'`: `await supabase.from('profiles').update({trial_started_at: new Date().toISOString()}).eq('user_id', data.user.id)`
   - `trackTutorLandingGoal("tutor_landing_trial_signup_completed")`
   - `navigate('/tutor/home')`

**TG OAuth:** существующий `<TelegramLoginButton />` — после установки сессии тот же UPDATE + redirect.

**Right-side value-prop (см. mockup Surface 3):**
- H4: «Что включено в trial»
- H3: «Полный AI-доступ — как у платных тарифов. Никаких лимитов.»
- 4 perks: AI-проверка / Сократовский чат / Конструктор ДЗ / Отчёты родителям
- Box «После 7 дней»: «Покажем, что вы получили: сколько ДЗ AI проверил, сколько часов сэкономили...»

**SignupRouter.tsx:**
```tsx
import { useSearchParams } from "react-router-dom";
import { lazy } from "react";

const TutorSignupTrial = lazy(() => import("./TutorSignupTrial"));
const SignUp = lazy(() => import("./SignUp"));

export default function SignupRouter() {
  const [params] = useSearchParams();
  const isTutorTrial =
    params.get("ref") === "tutor-landing" || params.get("trial") === "7";
  return isTutorTrial ? <TutorSignupTrial /> : <SignUp />;
}
```

**App.tsx:** заменить `<Route path="/signup" element={<SignUp />} />` на `<Route path="/signup" element={<SignupRouter />} />`.

**Guardrails:**
- НЕ трогать существующий `SignUp.tsx` (оставляем для учеников)
- НЕ запрашивать `username` явно (auto-generate)
- Все `<input>` font-size 16px (anti iOS auto-zoom per `.claude/rules/80-cross-browser.md`)
- `touch-action: manipulation` на CTA
- Inline-validation, НЕ toast-error при первом keystroke
- Использовать существующий `<TelegramLoginButton />` без изменений

---

### T7: Meta-tags в `index.html` + `Index.tsx`

**Job:** R3-1 (SEO)
**Agent:** Claude Code
**Files:**
- `index.html` (edit, meta block)
- `src/pages/Index.tsx` (edit, `TUTOR_LANDING_*` constants)

**AC:** —

**Описание:** Обновить title и description везде, где они ссылаются на «от 200 ₽».

**`index.html`:**
- `<title>` — оставляем «Сократ AI для репетиторов · Проверка ДЗ за 40 минут + сократовский AI-чат для учеников»
- `<meta name="description">` content: ~~«...От 200 ₽ в первый месяц.»~~ → «...**7 дней бесплатно — без карты. Потом 200 ₽ первый месяц.**»
- Same для `og:description` и `twitter:description`

**`Index.tsx`:** обновить `TUTOR_LANDING_DESCRIPTION` константу — синхронно.

**Guardrails:** НЕ трогать canonical, `og:image`, `twitter:image`, `og:url`.

---

### T8-P0: Validation + deploy

**Agent:** Vladimir
**Files:** —

**Шаги:**
1. `npm run lint && npm run build && npm run smoke-check`
2. Push на main → Lovable Cloud применяет миграцию T4
3. На VPS:
   ```bash
   ssh -i $HOME\.ssh\sokratai_proxy root@185.161.65.182
   deploy-sokratai
   ```
4. `curl https://sokratai.ru/` — healthcheck
5. Открыть https://sokratai.ru/ в браузере, кликнуть Hero CTA, заполнить форму, проверить запись `trial_started_at` через Supabase Studio (P0-3)
6. Yandex Metrika через 24 часа: проверить firing новых goals (P0-9)

---

### T9-P0: Codex review

**Agent:** Codex (independent, чистая сессия)
**Files:** PR diff с T1-T8

**Промпт для Codex** — см. секцию [Copy-paste промпты] ниже.

---

## Phase P1 — Detailed Tasks

### T10: Verify ЮKassa recurring API + cron mechanism

**Job:** Foundation
**Agent:** Claude Code
**Effort:** S (2 часа)
**Blocks:** T15, T23

**Описание:** Перед стартом backend-работы — выяснить два technical-блокера (Open Q6, Q7):

**Q6 — ЮKassa recurring:**
1. `grep -rn "yookassa\|yokassa\|payment_method\|subscription" supabase/functions/`
2. Понять текущий путь оплаты учеников (разовые ли, recurring ли?)
3. Прочитать ЮKassa docs: https://yookassa.ru/developers/payment-acceptance/scenario-extensions/recurring-payments
4. Output: «recurring уже есть / нет, нужно добавить через [конкретные endpoints]»

**Q7 — Cron mechanism:**
1. `cat supabase/config.toml` — есть ли pg_cron extension включён?
2. `grep -rn "pg_cron\|cron" supabase/migrations/` — кто-то уже использует?
3. Lovable Cloud scheduled functions — поддерживается ли?
4. Output: «используем X mechanism, конкретно так:»

**Result:** комментарий в conversation thread / обновление спеки §11 Open Questions с новыми ответами.

---

### T11: Migration `tutor_subscriptions` table

**Job:** Foundation для P1 gating
**Agent:** Claude Code
**Files:** `supabase/migrations/20260512100000_create_tutor_subscriptions.sql` (new)

**AC:** AC-P1-1, AC-P1-13 (foundation)

**Описание:** Новая таблица + RLS + indexes + trigger updated_at. См. §6.B.Data Model в спеке.

**SQL** (точный — из спеки §6.B):
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
  ON tutor_subscriptions(trial_expires_at)
  WHERE status = 'trial_active';
CREATE INDEX idx_tutor_subs_paid_renewing
  ON tutor_subscriptions(paid_until)
  WHERE status IN ('paid_active', 'paid_grandfathered');

ALTER TABLE tutor_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tutor reads own subscription"
  ON tutor_subscriptions FOR SELECT USING (user_id = auth.uid());
-- writes only via service_role

CREATE TRIGGER trg_tutor_subscriptions_updated_at
  BEFORE UPDATE ON tutor_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

**Guardrails:**
- НЕТ INSERT для существующих юзеров в этой миграции (это T12)
- НЕТ DROP операций
- Idempotent: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE POLICY IF NOT EXISTS`

---

### T12: Migration backfill legacy

**Job:** Foundation для P1
**Agent:** Claude Code
**Files:** `supabase/migrations/20260512100100_backfill_legacy_tutors_grandfathered.sql` (new)

**AC:** AC-P1-8, AC-P1-9

**Описание:** Однократный INSERT всех существующих tutor-юзеров → `paid_grandfathered` до 2026-05-31 (Q1 default).

**SQL:**
```sql
INSERT INTO tutor_subscriptions
  (user_id, status, trial_started_at, trial_expires_at, paid_until)
SELECT
  t.user_id,
  'paid_grandfathered',
  COALESCE(t.created_at, NOW() - INTERVAL '30 days'),
  COALESCE(t.created_at, NOW() - INTERVAL '30 days') + INTERVAL '7 days',
  '2026-05-31T23:59:59+03:00'::timestamptz
FROM tutors t
WHERE NOT EXISTS (
  SELECT 1 FROM tutor_subscriptions s WHERE s.user_id = t.user_id
);

-- Verify count after migration:
-- SELECT COUNT(*) FROM tutor_subscriptions WHERE status = 'paid_grandfathered';
-- Should match COUNT of tutors table
```

**Verify после apply:**
```sql
SELECT
  (SELECT COUNT(*) FROM tutors) as tutors_count,
  (SELECT COUNT(*) FROM tutor_subscriptions WHERE status = 'paid_grandfathered') as backfilled_count;
-- Должно совпасть
```

**Rollback:** `DELETE FROM tutor_subscriptions WHERE status = 'paid_grandfathered';`

**Guardrails:**
- `WHERE NOT EXISTS` — idempotent (можно запускать повторно)
- Нет UPDATE существующих row
- Нет TRANSACTION (single statement, безопасно)

---

### T13: `_shared/subscription-gating.ts` helper

**Job:** R3-1 / Foundation для T14, T15
**Agent:** Claude Code
**Files:** `supabase/functions/_shared/subscription-gating.ts` (new)

**AC:** AC-P1-2, AC-P1-7

**Описание:** Single source of truth для AI-access проверки. Используется в 3 edge functions (T14).

**API contract:**
```ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export type AiAccessResult =
  | { allowed: true }
  | { allowed: false; reason: 'no_subscription' | 'trial_expired' | 'subscription_inactive' };

export async function checkTutorAiAccess(
  db: SupabaseClient,
  tutorUserId: string
): Promise<AiAccessResult> {
  const { data, error } = await db
    .from('tutor_subscriptions')
    .select('ai_features_active, status')
    .eq('user_id', tutorUserId)
    .maybeSingle();

  if (error || !data) {
    // Fail closed для tutor (helper всегда вызывается ПОСЛЕ проверки роли)
    return { allowed: false, reason: 'no_subscription' };
  }
  if (!data.ai_features_active) {
    return {
      allowed: false,
      reason: data.status === 'trial_expired' ? 'trial_expired' : 'subscription_inactive',
    };
  }
  return { allowed: true };
}
```

**Unit-test (manual или vitest):**
- mock SupabaseClient → `select().eq().maybeSingle()` returns `{ai_features_active: true, status: 'trial_active'}` → expect `{allowed: true}`
- returns `{ai_features_active: false, status: 'trial_expired'}` → expect `{allowed: false, reason: 'trial_expired'}`
- returns null → expect `{allowed: false, reason: 'no_subscription'}`

**Guardrails:**
- Использовать `maybeSingle()`, не `single()` — для graceful absence
- Helper НЕ вызывает gating сам — возвращает result, caller решает что вернуть юзеру
- НЕ кэшировать на module-level (per-request DB call) — в P1 OK, P2 если perf-проблема — Redis

---

### T14: AI-gating в 3 edge functions

**Job:** R3-1 (core deliverable)
**Agent:** Claude Code
**Files:**
- `supabase/functions/chat/index.ts` (edit, добавить gating для guided context paths)
- `supabase/functions/homework-api/index.ts` (edit, `handleCheckAnswer` + `handleRequestHint`)

**AC:** AC-P1-2, AC-P1-7, AC-P1-13

**Описание:** Перед AI-вызовом для tutor-инициированной операции — `checkTutorAiAccess`. Если `allowed=false` → 402.

**Pattern (apply в каждом из 3 мест):**
```ts
import { checkTutorAiAccess } from '../_shared/subscription-gating.ts';

// Внутри handler, ПОСЛЕ определения tutorUserId, ПЕРЕД AI-call:
const tutorUserId = await resolveTutorUserId(req); // existing logic
if (!tutorUserId) {
  // Если запрос не от tutor — продолжать без gating (student paths)
  // ... continue as before
} else {
  const access = await checkTutorAiAccess(db, tutorUserId);
  if (!access.allowed) {
    return new Response(JSON.stringify({
      error: 'ai_disabled',
      reason: access.reason,
      message: access.reason === 'trial_expired'
        ? 'Trial завершён. Активируйте подписку для AI-функций.'
        : access.reason === 'no_subscription'
        ? 'У вас нет активной подписки. Начните 7-дневный trial.'
        : 'Подписка не активна.',
    }), {
      status: 402,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
// ... continue with AI call
```

**КРИТИЧНО для `chat/index.ts`:** в edge function `chat` есть код, который определяет, является ли запрос частью guided homework. Gating применяется к **owning tutor** of homework assignment, не к student. Это разделение per AC-P1-13:
- Если запрос от student в guided context → найти `assignment.tutor_id` → проверить `checkTutorAiAccess(db, assignment.tutor_id)`. Если tutor inactive → graceful fallback message (НЕ 402, потому что student не виноват)
- Если запрос от tutor (например preview диалога) → gating tutor сам

**Не gate-имся:**
- `/chat` general (без homework context) для учеников и репетиторов
- Telegram bot routes (если они сами не идут через chat function)
- Student-side fetches signed URLs

**Guardrails:**
- НЕ трогать high-risk файлы (`AuthGuard.tsx`, `TutorGuard.tsx`)
- НЕ менять existing AI prompt building, только pre-AI gating check
- Telemetry: `console.warn(JSON.stringify({event: 'ai_gating_blocked', reason: access.reason, tutorUserId}))` для observability
- Тестировать локально: создать test user с `ai_features_active=false`, дёрнуть `/check-answer` → ожидать 402

---

### T15: Edge function `tutor-subscription`

**Job:** R3-1 (API foundation для UI)
**Agent:** Claude Code
**Files:** `supabase/functions/tutor-subscription/index.ts` (new)

**AC:** AC-P1-5, AC-P1-6, AC-P1-12

**Описание:** REST API для tutor-side subscription operations.

**Endpoints:**
- `GET /tutor-subscription/me` — read self status (clientside через client-RLS либо через service_role в edge function для consistency). Returns `{ status, trial_started_at, trial_expires_at, paid_until, ai_features_active, current_tier, trial_decision }`
- `POST /tutor-subscription/start-paid` — body `{ tier: 'ai-start-200' }`. Создаёт ЮKassa payment (через T16 расширение webhook); возвращает `{ payment_url }` для редиректа клиента. Сохраняет ЮKassa metadata (`tutor_user_id`, `tier`) для webhook-handler-а
- `POST /tutor-subscription/cancel` — отменяет auto-renewal: `UPDATE tutor_subscriptions SET status='cancelled' WHERE user_id=auth.uid() AND status='paid_active'`. AI работает до текущего `paid_until`. Returns `{ paid_until }`

**Auth:** все endpoints требуют JWT (auth.uid()). Service-role используется внутри для UPDATE.

**Guardrails:**
- НЕ позволять CHANGE tier через `/start-paid` если уже `paid_active` (это renewal путь, не upgrade) — return 409
- `cancel` идемпотентен: повторный POST на `cancelled` subscription — 200, no-op
- НЕ возвращать `yokassa_*` поля клиенту в `/me` (они internal)

---

### T16: ЮKassa webhook расширение

**Job:** R3-1 (conversion path)
**Agent:** Claude Code
**Files:** `supabase/functions/{yokassa-webhook-existing}/index.ts` (edit, найти через `grep yookassa supabase/functions/`)

**AC:** AC-P1-5, AC-P1-11

**Описание:** Существующий webhook (для ученических Premium-оплат) расширяется через metadata-различение.

**Pattern:**
```ts
// В webhook-handler, после verify signature и parse payment:
const metadata = payment.metadata || {};
const isTutorPayment = metadata.tutor_user_id != null;

if (isTutorPayment) {
  await handleTutorPaymentWebhook(db, payment, metadata);
  return new Response('OK', { status: 200 });
}

// existing student logic continues...
```

**`handleTutorPaymentWebhook`:**
```ts
async function handleTutorPaymentWebhook(db, payment, metadata) {
  if (payment.status !== 'succeeded') return; // ignore pending/cancelled

  const tutorUserId = metadata.tutor_user_id;
  const tier = metadata.tier || 'ai-start-200';

  // Idempotency: проверить yokassa_payment_id уже обработан
  const existing = await db.from('tutor_subscriptions')
    .select('user_id, paid_until')
    .eq('user_id', tutorUserId)
    .maybeSingle();

  const isFirstPayment = tier === 'ai-start-200' && !existing?.paid_until;
  const newPaidUntil = isFirstPayment
    ? new Date(Date.now() + 30*24*3600*1000) // first month
    : new Date((existing.paid_until?.getTime() || Date.now()) + 30*24*3600*1000); // renewal

  // Q2: auto-tier-bump по числу учеников
  const studentCount = await db.from('tutor_students')
    .select('id', { count: 'exact', head: true })
    .eq('tutor_id', tutorUserId);
  const autoTier = studentCount.count <= 10 ? 'ai-plus-1000'
    : studentCount.count <= 20 ? 'ai-pro-2000'
    : 'ai-team';

  const finalTier = isFirstPayment ? 'ai-start-200' : autoTier;

  await db.from('tutor_subscriptions').upsert({
    user_id: tutorUserId,
    status: 'paid_active',
    trial_started_at: existing?.trial_started_at || new Date(),
    trial_expires_at: existing?.trial_expires_at || new Date(),
    paid_until: newPaidUntil.toISOString(),
    current_tier: finalTier,
    yokassa_subscription_id: payment.subscription_id,
    yokassa_payment_method_id: payment.payment_method?.id,
    trial_decision: 'paid',
    trial_decision_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
}
```

**Guardrails:**
- Idempotent (повторный webhook на тот же `payment_id` не должен дублить данные)
- Если `payment.status === 'cancelled'` или `failed` → не трогать subscription, log warning
- Если `tutor_user_id` в metadata, но в БД нет — log error, return 200 (chargeback ситуация)

---

### T17: Client API + React hook

**Job:** Foundation для UI
**Agent:** Claude Code
**Files:**
- `src/lib/tutorSubscriptionApi.ts` (new)
- `src/hooks/useTutorSubscription.ts` (new)

**AC:** AC-P1-3, AC-P1-4

**Описание:**

**`tutorSubscriptionApi.ts`:**
```ts
import { supabase } from '@/lib/supabaseClient';

export type TutorSubscription = {
  status: 'trial_active' | 'trial_expired' | 'paid_active' | 'paid_grandfathered' | 'cancelled' | 'free';
  trial_started_at: string;
  trial_expires_at: string;
  paid_until: string | null;
  current_tier: string | null;
  ai_features_active: boolean;
  trial_decision: 'paid' | 'declined' | 'no_action' | null;
};

export async function getTutorSubscription(): Promise<TutorSubscription | null> {
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session) return null;
  const { data, error } = await supabase
    .from('tutor_subscriptions')
    .select('status, trial_started_at, trial_expires_at, paid_until, current_tier, ai_features_active, trial_decision')
    .eq('user_id', sess.session.user.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function startPaidSubscription(tier: string): Promise<{ payment_url: string }> {
  const res = await supabase.functions.invoke('tutor-subscription/start-paid', { body: { tier }});
  if (res.error) throw res.error;
  return res.data;
}

export async function cancelSubscription(): Promise<{ paid_until: string }> {
  const res = await supabase.functions.invoke('tutor-subscription/cancel', { body: {}});
  if (res.error) throw res.error;
  return res.data;
}

export async function recordTrialDecision(decision: 'paid' | 'declined'): Promise<void> {
  await supabase.from('tutor_subscriptions')
    .update({ trial_decision: decision, trial_decision_at: new Date().toISOString() })
    .eq('user_id', (await supabase.auth.getSession()).data.session!.user.id);
}
```

**`useTutorSubscription.ts`:**
```tsx
import { useQuery } from '@tanstack/react-query';
import { getTutorSubscription } from '@/lib/tutorSubscriptionApi';

export function useTutorSubscription() {
  return useQuery({
    queryKey: ['tutor', 'subscription'],
    queryFn: getTutorSubscription,
    staleTime: 60 * 1000, // 1 минута
    refetchOnWindowFocus: true, // ловим возврат после оплаты
  });
}
```

**Guardrails:**
- Query key — `['tutor', 'subscription']` per `.claude/rules/performance.md` конвенцию
- НЕ вызывать в guard-компонентах (high-risk) — только в banner и dialog
- Cache invalidation после success-оплаты — handled через `refetchOnWindowFocus`

---

### T18: TrialCountdownBanner

**Job:** R1-3 (visibility)
**Agent:** Claude Code
**Files:** `src/components/tutor/chrome/TrialCountdownBanner.tsx` (new)

**AC:** AC-P1-3

**Описание:** Top-bar inside AppFrame для дней 1–6 trial. См. mockup Surface 4.

**Behavior:**
- Render только если `subscription.status === 'trial_active'` И `daysRemaining > 0`
- НЕ render на `/tutor/onboarding` (если есть)
- Локальный `dismissed` в `sessionStorage` (возвращается при следующем session-старте)

**Layout:**
- Зелёный gradient bg
- Слева: 🎁 + «Trial: осталось N из 7 дней. Создано M ДЗ, AI проверил K работ — экономия ~X часов.»
- Справа: progress bar (height 6px) + label «Y дней прошло · N осталось»
- CTA «Посмотреть тариф» → открывает `TrialExpiredDialog` с pre-filled state «текущий день» (опц.)
- ✕ для session-only dismiss

**Stat-метрики:** в P1 минимально — «Создано {N} ДЗ» через одну query (либо placeholder static «7 дней full AI» если нет дешёвого endpoint).

**Source data:** `useTutorSubscription()` для `daysRemaining`, отдельный fetch для stats.

**Guardrails:**
- Не sticky-positioned — обычный top-of-content (per `.claude/rules/80-cross-browser.md`, sticky+iOS WebKit fragile)
- Не использовать `framer-motion` (запрещён per `.claude/rules/performance.md`)
- Mobile (`<sm`): компактный layout, скрывать stat row, оставить только counter + CTA

---

### T19: TrialExpiredDialog (blocking)

**Job:** R3-1 (conversion)
**Agent:** Claude Code
**Files:** `src/components/tutor/chrome/TrialExpiredDialog.tsx` (new)

**AC:** AC-P1-4, AC-P1-5, AC-P1-6

**Описание:** Radix Dialog blocking modal, показывается на день 7+ при первом входе после истечения trial. См. mockup Surface 5.

**Render condition:**
- `subscription.status === 'trial_expired' && trial_decision === null`
- ИЛИ trigger вручную через клик в TrialCountdownBanner (опц.)

**Layout (см. Surface 5 mockup):**
- Badge «7 дней пройдены»
- H3 «Спасибо, что попробовали!»
- Stats grid (3 колонки): ДЗ создано / работ проверил AI / часов сэкономлено
- Pricing-card: ~~1000 ₽~~ → **200 ₽** первый месяц
- Primary CTA «Продолжить за 200 ₽ →» — вызывает `startPaidSubscription('ai-start-200')`, открывает payment_url
- Secondary CTA «Остаться на бесплатной» — вызывает `recordTrialDecision('declined')`, dialog закрывается
- Closer fine-print

**Behavior:**
- Если `trial_decision !== null` → не показывается
- Закрытие через ✕ — **НЕ доступно** в blocking-режиме per AC-P1-4
- При клике «Продолжить за 200 ₽» → `window.location.href = payment_url` (полный редирект на ЮKassa)
- При клике «Остаться» → optimistic update query cache + invalidate `['tutor', 'subscription']`

**Stats — same source как в T18.**

**Guardrails:**
- Radix Dialog без `onOpenChange` callback — не позволяет dismiss
- НЕ сохранять `dismissed` для blocking-режима
- Все CTA-buttons — min-h 44px, font-size 16px (anti iOS auto-zoom irrelevant для button, но для consistency)
- Использовать существующие design tokens

---

### T20: AppFrame integration

**Job:** Integration
**Agent:** Claude Code
**Files:** `src/components/tutor/chrome/AppFrame.tsx` (edit, минимально)

**AC:** AC-P1-3, AC-P1-4

**Описание:** Подключить banner и dialog в существующий AppFrame, не трогая TutorGuard или mode wrapper.

**Pattern:**
```tsx
// AppFrame.tsx (existing structure)
export default function AppFrame() {
  return (
    <TutorGuard>  {/* unchanged */}
      <div className="sokrat t-app" data-sokrat-mode="tutor">
        <SideNav />
        <MobileTopBar />
        <MobileDrawer />
        <TrialCountdownBanner />  {/* NEW: показывается conditionally inside */}
        <main className="t-app__main">
          <Suspense fallback={...}>
            <Outlet />
          </Suspense>
        </main>
        <TrialExpiredDialog />  {/* NEW: blocking dialog, render at root level */}
      </div>
    </TutorGuard>
  );
}
```

**Guardrails:**
- НЕ менять TutorGuard, mode wrapper, SideNav (high-risk)
- Banner и dialog — чистые adds, не изменения existing structure
- Каждый компонент сам решает render/skip через `useTutorSubscription`

---

### T21: Update TutorSignupTrial для INSERT в `tutor_subscriptions`

**Job:** P1 acquisition
**Agent:** Claude Code
**Files:** `src/pages/TutorSignupTrial.tsx` (edit) + новый edge function `start-trial` (либо inline в `tutor-subscription` T15)

**AC:** AC-P1-1

**Описание:** В P0 после signup просто пишется `profiles.trial_started_at`. В P1 надо ещё INSERT в `tutor_subscriptions(status='trial_active', ...)`.

**Изменения в TutorSignupTrial.tsx:**
```ts
// Внутри submit handler, после auth.signUp success:
await supabase.from('profiles').update({...}).eq(...); // existing P0
// NEW for P1:
await supabase.functions.invoke('tutor-subscription/start-trial', {
  body: { user_id: data.user.id }
});
```

**Edge function `start-trial`** (либо отдельная, либо POST endpoint в `tutor-subscription` T15):
```ts
// service_role INSERT (RLS write disabled для clients)
await db.from('tutor_subscriptions').insert({
  user_id,
  status: 'trial_active',
  trial_started_at: new Date(),
  trial_expires_at: new Date(Date.now() + 7*24*3600*1000),
});
```

**Guardrails:**
- Idempotent: если subscription уже exists (например repeat signup) → no-op, не дублить
- НЕ позволять trial_active если уже был `trial_decision='declined'` (защита от juicing). В P1 это soft check, P3 — strict с email/IP audit

---

### T22: Email templates

**Job:** Reactivation
**Agent:** Claude Code
**Files:**
- `supabase/functions/_shared/transactional-email-templates/trial-day-7.ts` (new)
- `supabase/functions/_shared/transactional-email-templates/trial-day-14.ts` (new)

**AC:** AC-P1-10

**Описание:** Plain TS templates по паттерну existing `homework-notification.ts` (per `.claude/rules/70-notifications.md`).

**`trial-day-7.ts`:**
- Subject: «Завтра завершается trial Сократа AI»
- Body: «Привет! Через 24 часа ваш 7-дневный trial AI-функций завершится. За эти дни вы создали {N} ДЗ, AI проверил {K} работ — это сэкономило ~{X} часов вашего времени. Хотите продолжить за 200 ₽ первый месяц вместо 1000 ₽? [Продолжить за 200 ₽] [Остаться на бесплатной]»
- HTML + plain text variants

**`trial-day-14.ts`:**
- Subject: «Ваши N учеников ждут AI-проверки»
- Body: «Прошло 7 дней с момента, как вы решили остаться на бесплатной платформе. Ваши N учеников решают ДЗ — но проверять их приходится вручную. Помните, что 200 ₽ покрывают примерно один час вашего времени. [Вернуть AI за 200 ₽]»

**Guardrails:**
- Per `.claude/rules/70-notifications.md`: temp email (`@temp.sokratai.ru`) — пропускать
- Sender: `Сократ <noreply@sokratai.ru>`, domain `sokratai.ru`
- Idempotency key: `trial-reminder-day-{N}-{user_id}-{trial_expires_at}` — defends against duplicate cron-runs

---

### T23: Cron `trial-reminders`

**Job:** Reactivation
**Agent:** Claude Code
**Files:** `supabase/functions/trial-reminders/index.ts` (new)

**AC:** AC-P1-10

**Описание:** Daily cron, шлёт day-7 (за 24 часа до expiry) и day-14 (через 7 дней после expiry).

**Mechanism:** per T10 verify (pg_cron OR Lovable Cloud scheduled functions).

**Logic:**
```ts
Deno.serve(async (req) => {
  // 1. Day-7: status='trial_active' AND trial_expires_at < NOW() + 24h
  //    Send day-7 email + log idempotency
  //    Plus UPDATE status='trial_expired' if trial_expires_at < NOW()
  
  // 2. Day-14: status='trial_expired' AND trial_decision IN ('declined','no_action')
  //    AND trial_expires_at < NOW() - 7 days AND no day-14 email yet (check idempotency table)
  //    Send day-14 email
});
```

**Idempotency:** simple table или `email_sent_log` (если есть в проекте).

**Guardrails:**
- Использовать существующую `process-email-queue` infrastructure (per `.claude/rules/70-notifications.md`)
- НЕ слать email на `@temp.sokratai.ru`
- Если `tutor_subscriptions.trial_decision = 'paid'` — НЕ слать никаких reminders (юзер конвертился)

---

### T24-P1: Validation + deploy P1

**Agent:** Vladimir
**Files:** —

**Шаги:**
1. `npm run lint && npm run build && npm run smoke-check`
2. Push на main → Lovable Cloud применяет миграции T11, T12 + edge functions T13-T16, T22, T23
3. Verify backfill: `SELECT COUNT(*) FROM tutor_subscriptions WHERE status='paid_grandfathered'` == `SELECT COUNT(*) FROM tutors`
4. На VPS:
   ```bash
   ssh -i $HOME\.ssh\sokratai_proxy root@185.161.65.182
   deploy-sokratai
   ```
5. Verify cron registered (per T10 mechanism)

---

### T25-P1: Manual QA per 13 AC-P1-*

**Agent:** Vladimir + Codex review
**Files:** —

**Сценарии:**
1. Создать test trial → проверить INSERT (`AC-P1-1`)
2. UPDATE `trial_expires_at = NOW() - 1h` → открыть кабинет → blocking modal (`AC-P1-4`)
3. Кликнуть «Продолжить 200₽» → ЮKassa sandbox payment → возврат → проверить `paid_active` (`AC-P1-5`)
4. UPDATE `status='cancelled'` → AI работает до `paid_until`, после — soft demotion (`AC-P1-12`)
5. Trigger cron вручную → email отправлен + idempotent (`AC-P1-10`)
6. Legacy verify: открыть кабинет под legacy-юзером до 2026-05-31 → no banner, AI works (`AC-P1-8`); после — modal (`AC-P1-9`)

**Codex review prompt** — см. ниже.

---

### T26: Legacy outreach

**Agent:** Vladimir / Egor
**Files:** —

**Шаги:**
1. За 2 недели до 2026-05-31 (т.е. ~2026-05-17): personal TG/email каждому legacy-репетитору по шаблонам из `SokratAI/legacy-tutors-personal-message.md`
2. Track conversions через Yandex Metrika + Supabase queries
3. После 2026-05-31: список не-конвертившихся → последнее напоминание email от Vladimir

---

## Copy-paste промпты для агентов

> Plain text внутри fenced code blocks. Это **то, что копируется в агента** — текст выше служит для context. Промпты ниже — finished, ready to paste.

---

### PROMPT-T0: Verify RLS на `profiles.UPDATE`

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI (EdTech для репетиторов физики ЕГЭ/ОГЭ).

Контекст: готовлю миграцию `add_trial_started_at_to_profiles.sql` для P0 trial-flow (см. docs/delivery/features/trial-flow/spec.md §6.A). Клиентский код TutorSignupTrial.tsx будет писать `profiles.trial_started_at = NOW()` через `supabase.from('profiles').update(...).eq('user_id', user.id)`. Нужна self-update RLS policy на этой колонке.

Canonical docs (прочитай ДО действий):
- docs/delivery/features/trial-flow/spec.md §6.C — описание Open Question Q5
- supabase/migrations/*.sql (grep)

Задача:
1. Запусти grep на CREATE POLICY .* profiles в supabase/migrations/
2. Найди существующую UPDATE policy для self (USING (user_id = auth.uid()))
3. Если policy открыта на все колонки (no column-mask) → output "RLS OK, T4 миграция без RLS-расширения"
4. Если policy column-masked или отсутствует → output точный SQL fragment, который надо добавить в T4 миграцию

Output format: ровно один абзац с decision + SQL fragment если нужно. НЕ менять файлы, это verification-task.

Guardrails: read-only, не запускай миграции, не меняй существующих policies.
```

---

### PROMPT-T1: Hero copy update + TG-blue + Compare-блок

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: SokratAI — EdTech для репетиторов физики ЕГЭ/ОГЭ. Wedge — индивидуальные репетиторы, AI = draft + action (не chat-only output). Меняем landing copy с card-friction "Попробовать за 200 ₽" на "Попробовать 7 дней бесплатно" — снимаем card-блокер, увеличиваем signup-конверсию.

Canonical docs (прочитай ДО действий):
- docs/delivery/features/trial-flow/spec.md §6.A (Hero changes)
- .claude/rules/90-design-system.md (TG-blue paterns)
- .claude/rules/80-cross-browser.md (mobile pattern)
- src/components/sections/tutor/Hero.tsx (current implementation)
- tailwind.config.ts (existing socrat tokens)

Задача:
1. Открой src/components/sections/tutor/Hero.tsx
2. Замени chip text на "🎁 Новое: 7 дней пробного периода без карты" (сохранить структуру chip с pulse-dot)
3. Замени Primary CTA с "Попробовать за 200 ₽ в первый месяц" на "Попробовать 7 дней бесплатно" — link target меняем на `/signup?ref=tutor-landing&trial=7`. Telemetry goal остаётся `trackTutorLandingGoal("tutor_landing_cta_trial_hero")` (T5 расширит тип)
4. Замени Secondary CTA "Канал Егора" — стиль на TG-blue: backgroundColor `#229ED9` (можно через inline style в P0, токен `--sokrat-tg-blue` добавить опционально), color white, без border. Убрать `border-2`, заменить на shadow.
5. Trust ribbons: "Без карты · Полный AI-доступ · Потом 200 ₽ — первый месяц · Отмена в один клик" (4 пункта)
6. Под trust-ribbons добавить compare-блок (новый раздел внутри Hero):
   - Grid 2 колонки на md+, 1 колонка на mobile
   - Левая красная "Было": ~~200 ₽~~ Сразу платите в первый месяц. Не понимаете, подходит ли — но карту привязали.
   - Правая зелёная "Стало": **7 дней бесплатно — без карты.** Понравится — продолжите за 200 ₽. Нет — базовая платформа (оплаты, расписание) останется.

Acceptance Criteria (из спеки):
- AC-P0-1: chip "🎁 Новое..." виден, primary CTA text "Попробовать 7 дней бесплатно"
- AC-P0-2: клик primary CTA → редирект /signup?ref=tutor-landing&trial=7 + Yandex Metrika fires goal

Guardrails:
- НЕ трогать h1, lede, byline (контент создателей)
- НЕ удалять существующие background gradients и анимации (`tutor-hero::before` keyframes)
- Mobile: compare-блок ниже trust, full-width 1 column
- Все CTA min-h 52px, font-weight 600
- НЕ создавать новый file для Compare — inline в Hero.tsx (per Parking Lot спеки)

Mandatory end block (в твоём ответе):
1. Files changed: список абсолютных путей
2. Summary: 3-5 строк что сделал
3. Validation: запустил `npm run lint && npm run build` — output статус
4. Docs to update: какие docs (если any) надо синхронизировать
5. Self-check: проверка по AC-P0-1, AC-P0-2 — PASS/FAIL для каждого
```

---

### PROMPT-T2: Pricing simplification

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: упрощаем pricing-блок с 5 карточек до 3+2. Highlighted-карточка "AI-старт" теперь рассказывает всю воронку 0 → 200 → 1000 ₽ как лестницу — пользователь видит весь путь сразу, не путается между 5 tier-ами.

Canonical docs:
- docs/delivery/features/trial-flow/spec.md §6.A (Pricing changes)
- src/components/sections/tutor/Pricing.tsx (current 5 tiers + styles)

Задача:
1. Открой src/components/sections/tutor/Pricing.tsx
2. В TIERS массиве:
   a) Удалить tiers `plus` и `pro` из основной grid
   b) Изменить tier `ai-start`:
      - highlighted.popularChip: "7 дней бесплатно"
      - Внутри карточки сделай price-stack (структура tier требует extension type Tier для опциональных stack-полей):
        * Шаг 1 (ochre): "Сегодня: 0 ₽ — 7 дней полного AI"
        * Шаг 2 (anchor row): ~~1 000 ₽/мес~~ + chip −80%
        * Шаг 3 (big price): 200 ₽
        * Caption: "первый месяц после trial — экономия 800 ₽"
        * Шаг 4: "Со 2-го месяца: от 1 000 ₽/мес по числу учеников"
      - cta.label: "🎁 Начать пробный — без карты"
      - cta.href: `/signup?ref=tutor-landing&trial=7`
      - cta.tracking goal: `tutor_landing_cta_trial_pricing` (T5 ещё не сделан, но добавь call site, тип расширим в T5)
      - microcopy под CTA (новое поле или JSX): "Через 7 дней спросим, продолжать ли. Не списываем сами."
   c) Tier `team` остаётся как есть
3. Под `<div className="pp-grid">` добавь новый `<div className="pricing-extra-row">`:
   - Card 1: emoji 🔟 + "До 10 учеников на AI? — 1 000 ₽/мес со 2-го месяца"
   - Card 2: emoji 2️⃣0️⃣ + "До 20 учеников на AI? — 2 000 ₽/мес со 2-го месяца"
   - Эти cards имеют свой scoped CSS либо переиспользуют существующий `.extra-card` если есть; иначе inline стили per spec §6.A
4. ROI-callout box в конце Pricing — оставить как есть

Acceptance Criteria:
- AC-P0-6: 3 главных карточки + 2 компактных. AI-старт highlighted, popular chip "7 дней бесплатно". Price-stack 0 → 200 → 1000 виден.

Guardrails:
- Сохранить scoped CSS .pp-card, .pp-grid, .pp-card--highlighted (минимум правок)
- НЕ удалять ROI-callout
- Telemetry goal для AI-старт CTA — `tutor_landing_cta_trial_pricing` (требует T5 для type)
- Mobile (`<sm`): стандартный grid-template-columns: 1fr (existing)

Mandatory end block:
1. Files changed
2. Summary
3. Validation status
4. Docs to update (если scope)
5. Self-check AC-P0-6
```

---

### PROMPT-T3: FreemiumBridge + FAQ + FinalCTA copy

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: точечные copy-правки в трёх компонентах для согласования с новой trial-механикой.

Canonical docs:
- docs/delivery/features/trial-flow/spec.md §6.A (точные copy-стрингу)

Задача:

[FreemiumBridge.tsx]
Найти closing string:
"AI-слой подключается опционально — от 200 ₽ в первый месяц. Без него базовая платформа остаётся."
Заменить на:
"AI-слой подключается опционально — 7 дней бесплатно, потом 200 ₽ первый месяц. Без него базовая платформа остаётся."

[FAQ.tsx]
1. Update вопрос "Сколько стоит и есть ли пробный период?" — новый ответ:

Да, 7 дней бесплатно с полным AI-доступом — без карты. После trial покажем, что вы получили, и спросим, продолжать ли. Если да — 200 ₽ первый месяц (вместо 1 000 ₽), отмена в один клик. Если нет — AI выключится, базовая платформа (оплаты, расписание) останется. Дальше: 1 000 ₽/мес до 10 учеников, 2 000 ₽ до 20, 3 000 ₽ за 20+. Один час вашего времени — 1,5–2 тысячи рублей. Платформа окупается первой неделей использования.

2. Add NEW Q (в конец ITEMS array): "Что будет с моими учениками и данными после trial, если я не продолжу?"
Ответ:

Все данные сохранятся. Ученики, ДЗ, история проверок — всё на месте. Просто AI-слой выключится — новые ДЗ нельзя будет проверять автоматически. Базовая платформа (оплаты, расписание, профили) продолжит работать бесплатно. Захотите вернуть AI — один клик в настройках.

[FinalCTA.tsx]
1. Lede заменить на: "Попробуйте Сократ AI 7 дней бесплатно — без карты. Понравится — продолжите за 200 ₽ первый месяц. Не понравится — базовая платформа всё равно останется бесплатной."
2. Primary CTA text: "🎁 7 дней бесплатно"
3. CTA href: `/signup?ref=tutor-landing&trial=7`
4. Telemetry goal — добавить call to `trackTutorLandingGoal("tutor_landing_cta_trial_final")` (T5 type extension позже)

Acceptance Criteria: AC-P0-7

Guardrails:
- НЕ менять structure components, только copy
- НЕ добавлять compare-блок в FinalCTA (only Hero)

Mandatory end block:
1. Files changed (3 files)
2. Summary (3-5 lines)
3. Validation
4. Docs to update
5. Self-check AC-P0-7
```

---

### PROMPT-T4: Migration trial_started_at

```
Твоя роль: backend engineer в проекте SokratAI.

Контекст: P0 trial-flow требует minimal DB-расширение — один column в profiles для tracking когда репетитор начал trial. Это foundation для P1 (где появится tutor_subscriptions). В P0 значение пишется, но не используется для gating.

Canonical docs:
- docs/delivery/features/trial-flow/spec.md §6.A.Data Model
- T0 verify result (RLS check)

Задача:
1. Создай файл `supabase/migrations/20260505100000_add_trial_started_at_to_profiles.sql`
2. Точный SQL:

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN profiles.trial_started_at IS
  'Timestamp когда репетитор начал trial. NULL для legacy и тех, кто пришёл не через trial-flow. P0: только measurement; AI-gating в P1 через tutor_subscriptions.';

CREATE INDEX IF NOT EXISTS idx_profiles_trial_started_at
  ON profiles(trial_started_at)
  WHERE trial_started_at IS NOT NULL;

3. Если T0 verify показал что RLS требует расширения — добавь в эту же миграцию (idempotent через DO $$ block с IF NOT EXISTS check)

Guardrails:
- NO DROP operations
- Idempotent (повторный apply безопасен)
- Не миграция данных существующих row (NULL default OK)

Mandatory end block:
1. File path
2. SQL summary
3. Validation: `supabase migration list` или `supabase db reset` test (опц.)
4. Docs to update: spec §6.C если RLS изменилась
```

---

### PROMPT-T5: Yandex Metrika goals extension

```
Твоя роль: frontend engineer в проекте SokratAI.

Контекст: telemetry для измерения trial-конверсии. 5 новых goals добавляются в существующий tutorLandingAnalytics.ts.

Canonical docs:
- docs/delivery/features/trial-flow/spec.md §6.A.Telemetry
- src/lib/tutorLandingAnalytics.ts (current)

Задача: расширить тип `TutorLandingGoal` в src/lib/tutorLandingAnalytics.ts:

export type TutorLandingGoal =
  | "tutor_landing_cta_hero"          // existing
  | "tutor_landing_cta_tour1"          // existing
  | "tutor_landing_cta_pricing"        // existing
  | "tutor_landing_cta_final"          // existing
  | "tutor_landing_tg_channel_click"   // existing
  | "tutor_landing_cta_trial_hero"     // P0 — Hero CTA
  | "tutor_landing_cta_trial_pricing"  // P0 — Pricing AI-старт CTA
  | "tutor_landing_cta_trial_final"    // P0 — FinalCTA
  | "tutor_landing_trial_signup_started"   // P0 — TutorSignupTrial mount
  | "tutor_landing_trial_signup_completed"; // P0 — успешный signup

НЕ менять signature `trackTutorLandingGoal` или COUNTER_ID.

Acceptance Criteria: AC-P0-2, AC-P0-9 (после deploy через 24+ часов в Yandex Metrika dashboard)

Mandatory end block:
1. Files changed
2. Summary
3. Validation
4. Self-check AC-P0-2, AC-P0-9
```

---

### PROMPT-T6: TutorSignupTrial.tsx + SignupRouter

```
Твоя роль: senior frontend engineer в проекте SokratAI.

Контекст: создаём новую single-page форму trial-регистрации. Переиспользует zod из существующего SignUp.tsx, plus TG OAuth fallback. После signup — UPDATE profiles.trial_started_at = NOW() если URL `?trial=7`.

Canonical docs (прочитай ДО действий):
- docs/delivery/features/trial-flow/spec.md §5.3 (full TutorSignupTrial contract)
- src/pages/SignUp.tsx (current ученический signup, образец)
- src/components/TelegramLoginButton.tsx (existing TG OAuth, переиспользовать)
- src/lib/inviteApi.ts (existing claimPendingInvite helper)
- src/lib/supabaseClient.ts (existing supabase singleton)
- .claude/rules/80-cross-browser.md (font-size 16px, touch-action manipulation)
- .claude/rules/90-design-system.md (--sokrat-* tokens)

Задача:

1. Создай `src/pages/TutorSignupTrial.tsx`:
   - Двухколоночный grid: form слева (50%), value-prop справа (50%) на >=md, single-column на mobile
   - State: email, password, subject (default 'physics'), oferta (default true), loading
   - zod schema:

const trialSignupSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(8).regex(/[A-Z]/).regex(/[0-9]/),
  subject: z.enum(["physics","maths","informatics","multiple","other"]),
  oferta: z.literal(true),
});

   - Username auto-gen: `email.split("@")[0].toLowerCase().replace(/[^a-z0-9_-]/g, "")`
   - При mount: `supabase.auth.getSession()` → если session есть → navigate('/tutor/home') (или '/chat')
   - Else: `trackTutorLandingGoal("tutor_landing_trial_signup_started")` + render form
   - При submit:
     a) zod validation
     b) `supabase.auth.signUp({email, password, options:{data:{username:auto}}})`
     c) Если data.session:
        - `claimPendingInvite()` (existing)
        - Если URL.searchParams.get('trial') === '7': UPDATE profiles.trial_started_at = NOW()
        - `trackTutorLandingGoal("tutor_landing_trial_signup_completed")`
        - `navigate('/tutor/home')`
   - TG OAuth: existing `<TelegramLoginButton />` → callback после установки session делает то же UPDATE + navigate
   - Right-side value-prop (см. mockup Surface 3):
     * H4: "Что включено в trial"
     * H3: "Полный AI-доступ — как у платных тарифов. Никаких лимитов."
     * 4 perks: AI-проверка ДЗ / Сократовский чат / Конструктор ДЗ / Отчёты родителям
     * Box "После 7 дней": "Покажем, что вы получили: сколько ДЗ AI проверил, сколько часов сэкономили..."

2. Создай `src/pages/SignupRouter.tsx` (тонкий диспетчер):

import { useSearchParams } from "react-router-dom";
import { lazy } from "react";
const TutorSignupTrial = lazy(() => import("./TutorSignupTrial"));
const SignUp = lazy(() => import("./SignUp"));
export default function SignupRouter() {
  const [params] = useSearchParams();
  const isTutorTrial = params.get("ref") === "tutor-landing" || params.get("trial") === "7";
  return isTutorTrial ? <TutorSignupTrial /> : <SignUp />;
}

3. В `src/App.tsx`: заменить `<Route path="/signup" element={<SignUp />} />` на `<Route path="/signup" element={<SignupRouter />} />` (lazy loaded). Не удалять SignUp lazy import — он используется внутри SignupRouter.

Acceptance Criteria:
- AC-P0-3: signup → profiles.trial_started_at = NOW(), redirect /tutor/home, goal fired
- AC-P0-4: TG OAuth → то же
- AC-P0-5: уже-авторизованный → redirect без формы

Guardrails:
- НЕ трогать SignUp.tsx (existing для учеников)
- Все input font-size 16px, touch-action manipulation
- НЕ запрашивать username явно
- Inline-validation, НЕ toast при первом keystroke
- Использовать существующие design tokens (--sokrat-*)
- TG OAuth — переиспользовать `<TelegramLoginButton />` без модификаций

Mandatory end block:
1. Files changed (3 files: TutorSignupTrial new, SignupRouter new, App.tsx edit)
2. Summary
3. Validation: lint + build + manual test
4. Self-check AC-P0-3, AC-P0-4, AC-P0-5
```

---

### PROMPT-T7: Meta-tags update

```
Твоя роль: frontend engineer в проекте SokratAI.

Контекст: SEO meta-tags ссылаются на "от 200 ₽ в первый месяц" — обновить под новый trial-оффер.

Canonical docs:
- docs/delivery/features/trial-flow/spec.md §6.A.Затрагиваемые файлы

Задача:

[index.html]
Найти все вхождения "От 200 ₽ в первый месяц" в meta description, og:description, twitter:description.
Заменить на: "7 дней бесплатно — без карты. Потом 200 ₽ первый месяц."

[src/pages/Index.tsx]
Найти `TUTOR_LANDING_DESCRIPTION` константу. Заменить tail "От 200 ₽ в первый месяц." на: "7 дней бесплатно — без карты. Потом 200 ₽ первый месяц."

Guardrails:
- НЕ менять title, canonical, og:image, og:url
- Index.tsx и index.html должны быть синхронны

Mandatory end block:
1. Files changed (2)
2. Summary
3. Validation
```

---

### PROMPT-T9-P0 (Codex Review для Phase P0):

```
Ты — независимый ревьюер SokratAI. Контекст первого агента тебе недоступен.

ПОРЯДОК (строго):
1. Прочитай docs/discovery/product/tutor-ai-agents/14-ajtbd-product-prd-sokrat.md
2. Прочитай docs/discovery/product/tutor-ai-agents/16-ux-principles-for-tutor-product-sokrat.md и 17-ui-patterns-and-component-rules-sokrat.md
3. Прочитай docs/delivery/features/trial-flow/spec.md (Phase P0 sections)
4. Прочитай AC-P0-1 до AC-P0-10 (Section 8)
5. Посмотри git diff (последний commit / PR с T1-T7)

ВОПРОСЫ:
- Job alignment: фича закрывает R3-1 / Acq.1 / Acq.2 (мнение)?
- UX drift: ничего не нарушает doc 16/17 паттернов? Compare-блок в Hero — вписывается ли в систему?
- Scope creep: всё внутри P0, или агент захватил P1 elements?
- AC compliance: 10 AC-P0-* выполнены? (PASS/FAIL для каждого)
- Anti-patterns: использование framer-motion, sticky на iOS, font-size <16px на input — проверить
- Cross-browser: компоненты тестируются в Safari iOS (per .claude/rules/80-cross-browser.md)?

ФОРМАТ:
- PASS / CONDITIONAL PASS / FAIL
- Список конкретных issues с цитатами строк кода
- Recommendations: что fix, что defer на P1
```

---

### PROMPT-T10: Verify ЮKassa + cron

```
Твоя роль: senior backend engineer в SokratAI.

Контекст: P1 нуждается в (a) ЮKassa recurring/subscription API для auto-renewal после первого месяца, и (b) cron mechanism для daily trial-reminders. Оба — Open Questions Q6/Q7 в spec.

Canonical docs:
- docs/delivery/features/trial-flow/spec.md §11 Open Questions Q6, Q7
- supabase/config.toml
- supabase/functions/* (особенно yookassa-related)

Задача:

[Q6 — ЮKassa]
1. grep -rn "yookassa\|yokassa\|payment_method\|subscription_id" supabase/functions/
2. Найди существующие edge functions для ученических Premium-оплат
3. Понять текущий path: разовая оплата или recurring? Какие endpoints используются?
4. Прочитай ЮKassa docs https://yookassa.ru/developers/payment-acceptance/scenario-extensions/recurring-payments
5. Output: "Recurring [уже есть / нет, нужно добавить через X endpoints]". Конкретные шаги для T16.

[Q7 — cron]
1. grep -rn "pg_cron\|cron" supabase/migrations/
2. cat supabase/config.toml — найди extensions block
3. Search Lovable Cloud docs for "scheduled functions"
4. Output: "Cron mechanism: [pg_cron / Lovable scheduled / external], setup такой:". Конкретные шаги для T23.

Guardrails:
- Read-only research, НЕ менять код
- Output — два абзаца с decision + конкретными шагами

Mandatory end block:
1. ЮKassa decision + steps for T16
2. Cron decision + steps for T23
3. Open questions to escalate
```

---

### PROMPT-T11: Migration `tutor_subscriptions`

```
Твоя роль: senior backend engineer в SokratAI.

Контекст: foundation таблица для P1 trial-flow. Хранит status каждого репетитора (trial_active / trial_expired / paid_active / paid_grandfathered / cancelled / free), trial dates, paid_until для auto-renewal, ЮKassa metadata.

Canonical docs:
- docs/delivery/features/trial-flow/spec.md §6.B.Data Model (точный SQL)
- .claude/rules/40-homework-system.md (RLS patterns)

Задача:
1. Создай `supabase/migrations/20260512100000_create_tutor_subscriptions.sql`
2. Точный SQL — копировать из спеки §6.B (CREATE TABLE + 2 индекса + ALTER ... ENABLE RLS + SELECT policy + trigger updated_at)
3. Idempotent: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, etc.

Guardrails:
- NO DROP
- Только SELECT policy для clients, все INSERT/UPDATE/DELETE — service_role в edge functions
- ai_features_active — GENERATED STORED column (не VIRTUAL — STORED для performance в gating-вызовах)
- update_updated_at_column trigger — должен уже существовать в проекте, проверить grep

Acceptance Criteria: AC-P1-1, AC-P1-13 (foundation)

Mandatory end block:
1. File path
2. SQL summary (объекты созданы)
3. Verify trigger update_updated_at_column existence
4. Self-check AC-P1-1
```

---

### PROMPT-T12: Backfill legacy

```
Твоя роль: backend engineer в SokratAI.

Контекст: все существующие репетиторы пользовались SokratAI бесплатно во время пилота. Нужно migrate их в `paid_grandfathered` до 2026-05-31, чтобы они не сломались на P1 deploy. После 2026-05-31 — TrialExpiredDialog с custom copy для legacy.

Canonical docs:
- docs/delivery/features/trial-flow/spec.md §6.B и §11 Q1
- SokratAI/legacy-tutors-personal-message.md (контекст человеческой communication)

Задача:
1. Создай `supabase/migrations/20260512100100_backfill_legacy_tutors_grandfathered.sql`
2. SQL:

INSERT INTO tutor_subscriptions
  (user_id, status, trial_started_at, trial_expires_at, paid_until)
SELECT
  t.user_id,
  'paid_grandfathered',
  COALESCE(t.created_at, NOW() - INTERVAL '30 days'),
  COALESCE(t.created_at, NOW() - INTERVAL '30 days') + INTERVAL '7 days',
  '2026-05-31T23:59:59+03:00'::timestamptz
FROM tutors t
WHERE NOT EXISTS (
  SELECT 1 FROM tutor_subscriptions s WHERE s.user_id = t.user_id
);

3. Add verification comment в конце:
-- Verify: SELECT COUNT(*) FROM tutors == COUNT WHERE status='paid_grandfathered'

Guardrails:
- WHERE NOT EXISTS — idempotent
- Не UPDATE existing row (ничего не должно конфликтовать с T11 migration applied first)
- Hardcoded date 2026-05-31 — Q1 default; перед apply Vladimir подтверждает финальную дату

Acceptance Criteria: AC-P1-8, AC-P1-9

Mandatory end block:
1. File path
2. SQL
3. Verify query
4. Rollback command (DELETE WHERE status='paid_grandfathered')
5. Self-check AC-P1-8
```

---

### PROMPT-T13: subscription-gating.ts helper

```
Твоя роль: backend engineer в SokratAI.

Контекст: single source of truth для AI-feature gating. Используется в 3 edge functions (chat, homework-api/check-answer, hint). Returns AiAccessResult discriminated union.

Canonical docs:
- docs/delivery/features/trial-flow/spec.md §5.6 и §6.B (точный contract)

Задача:
1. Создай `supabase/functions/_shared/subscription-gating.ts`
2. Импорт SupabaseClient типа
3. Реализация (точно как в spec §6.B):

import { SupabaseClient } from "@supabase/supabase-js";

export type AiAccessResult =
  | { allowed: true }
  | { allowed: false; reason: 'no_subscription' | 'trial_expired' | 'subscription_inactive' };

export async function checkTutorAiAccess(
  db: SupabaseClient,
  tutorUserId: string
): Promise<AiAccessResult> {
  const { data, error } = await db
    .from('tutor_subscriptions')
    .select('ai_features_active, status')
    .eq('user_id', tutorUserId)
    .maybeSingle();
  if (error || !data) {
    return { allowed: false, reason: 'no_subscription' };
  }
  if (!data.ai_features_active) {
    return {
      allowed: false,
      reason: data.status === 'trial_expired' ? 'trial_expired' : 'subscription_inactive',
    };
  }
  return { allowed: true };
}

Guardrails:
- maybeSingle (graceful absence), не single
- Helper НЕ возвращает Response напрямую — caller решает status code
- НЕ кэшировать на module-level

Acceptance Criteria: AC-P1-2, AC-P1-7

Mandatory end block:
1. File created
2. Type contract
3. Manual unit test (3 scenarios)
4. Self-check
```

---

### PROMPT-T14: AI-gating в 3 edge functions

```
Твоя роль: senior backend engineer в SokratAI.

Контекст: добавляем gating check ПЕРЕД AI-вызовом в 3 edge functions. Если tutor's `ai_features_active = false` → 402 Payment Required. Student paths не gateимся (их gateит owning tutor).

Canonical docs:
- docs/delivery/features/trial-flow/spec.md §5.6 (точный pattern)
- supabase/functions/_shared/subscription-gating.ts (T13 создал)
- supabase/functions/chat/index.ts
- supabase/functions/homework-api/index.ts (handleCheckAnswer + handleRequestHint)
- .claude/rules/40-homework-system.md (anti-patterns: dual-host validators, multi-write paths)

Задача:

[chat/index.ts]
1. Импортируй checkTutorAiAccess
2. Найди paths где AI вызывается с homework guided context
3. Перед AI call: resolve owning tutor of homework assignment (через homework_tutor_assignments.tutor_id)
4. Если запрос от student → check tutor's access. Если tutor inactive → graceful fallback message (НЕ 402)
5. Если запрос от tutor (preview/test) → 402 с reason

[homework-api/index.ts::handleCheckAnswer]
1. После определения tutorUserId из assignment
2. Перед AI evaluateStudentAnswer call: checkTutorAiAccess
3. Если access.allowed=false → 402 с error: 'ai_disabled', reason

[homework-api/index.ts::handleRequestHint]
1. Same pattern as handleCheckAnswer

Pattern (apply во всех 3):

const access = await checkTutorAiAccess(db, tutorUserId);
if (!access.allowed) {
  return new Response(JSON.stringify({
    error: 'ai_disabled',
    reason: access.reason,
    message: access.reason === 'trial_expired'
      ? 'Trial завершён. Активируйте подписку для AI-функций.'
      : access.reason === 'no_subscription'
      ? 'У вас нет активной подписки. Начните 7-дневный trial.'
      : 'Подписка не активна.',
  }), {
    status: 402,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

Guardrails:
- НЕ трогать AI prompt building, только pre-AI gate
- НЕ применять gating к student-direct paths (free /chat без homework context)
- Telemetry: console.warn JSON для observability ('ai_gating_blocked')
- Test locally: создать test tutor с status='trial_expired' через UPDATE → check-answer → expect 402
- legacy paid_grandfathered: ai_features_active=true (computed), gating НЕ блокирует

Acceptance Criteria: AC-P1-2, AC-P1-7, AC-P1-13

Mandatory end block:
1. Files changed (3 functions)
2. Summary of integration points
3. Validation: manual test scenario для каждого path
4. Self-check AC-P1-2, AC-P1-7, AC-P1-13
```

---

### PROMPT-T15 to T23 — следуют тому же паттерну

> **Note:** для краткости промпты T15–T23 следуют тому же шаблону: Role → Context → Canonical docs → Task description с точными SQL/код блоками из спеки → AC → Guardrails → Mandatory end block.

> Ключевые отличия каждого промпта:
> - **T15** — Edge function `tutor-subscription` (3 endpoints), требует verify ЮKassa из T10
> - **T16** — Webhook расширение, идемпотентность по yokassa_payment_id
> - **T17** — Client API + React Query hook с key `['tutor', 'subscription']`
> - **T18** — TrialCountdownBanner: render condition + sessionStorage dismiss
> - **T19** — TrialExpiredDialog: blocking без ✕, primary/secondary CTA, `recordTrialDecision`
> - **T20** — AppFrame integration: добавить 2 компонента, не трогая TutorGuard
> - **T21** — TutorSignupTrial update: INSERT в tutor_subscriptions через service-role edge function
> - **T22** — Email templates по паттерну existing homework-notification.ts
> - **T23** — Cron edge function с idempotency keys

> При прохождении T10 (verify) ответы Q6/Q7 будут известны — финализируй промпты T15, T16, T23 на их основе перед запуском.

---

### PROMPT-T25-P1 (Codex Review для Phase P1):

```
Ты — независимый ревьюер SokratAI. Контекст первого агента тебе недоступен.

ПОРЯДОК (строго):
1. Прочитай docs/discovery/product/tutor-ai-agents/14-ajtbd-product-prd-sokrat.md
2. Прочитай docs/discovery/product/tutor-ai-agents/16-ux-principles-for-tutor-product-sokrat.md и 17-...md
3. Прочитай docs/delivery/features/trial-flow/spec.md (Phase P1 sections + §10 Validation)
4. Прочитай AC-P1-1 до AC-P1-13 (Section 8)
5. Посмотри git diff (последний commit / PR с T11-T23)

ВОПРОСЫ:
- Job alignment: P1 закрывает R3-1, R1-3, Ret.1?
- AC compliance: все 13 AC-P1-* implemented? (PASS/FAIL для каждого)
- Multi-write-path safety (per .claude/rules/40-homework-system.md правило 0):
  * AI gating применён в ВСЕХ 3 edge functions (chat, check-answer, hint)?
  * Никакой forgotten path (например telegram-bot или student-direct)?
- RLS invariants:
  * tutor_subscriptions SELECT only через USING (user_id = auth.uid())?
  * INSERT/UPDATE/DELETE только service_role?
- Idempotency:
  * Backfill T12 — повторный run безопасен?
  * Webhook T16 — duplicate payment_id не создаёт дублей?
  * Cron T23 — idempotency keys на email?
- Anti-patterns:
  * framer-motion НЕ использован?
  * sticky/iOS issues в TrialCountdownBanner?
  * `.eq()` через nested embed НЕ используется (per spec known-bad pattern)?
- Legacy migration:
  * Backfill даёт ai_features_active=true для all existing tutors?
  * После 2026-05-31 paid_until expires → ai_features_active=false?

ФОРМАТ:
- PASS / CONDITIONAL PASS / FAIL
- Issues с цитатами строк кода
- Recommendations: что fix, что defer на P2

Special check для P1:
- Test transition: trial_active → trial_expired (день 7) → paid_active (после оплаты) — все states transition корректны?
- Soft demotion работает: status='trial_expired', trial_decision='declined' → AI off, базовая платформа on?
```

---

## Заметки для Vladimir

**Перед запуском P0:**
1. Прочитать `spec.md` целиком, утвердить статус → `approved`
2. Vladimir подтверждает Q1 (cutoff date), Q2 (auto-tier-bump), Q3-Q4 (defaults), Q8 (TG channel choice)
3. Запустить T0 (Verify RLS) — это 15-минутный read-only research
4. После T0 → T1, T2, T3, T4, T5, T6, T7 параллельно или последовательно (Claude Code, separate sessions если нужно)
5. T8-P0 (deploy) — Vladimir вручную через `deploy-sokratai`
6. T9-P0 (Codex review) — после deploy в новой Codex-сессии с предоставленным промптом

**Перед запуском P1:**
1. Подтвердить что P0 показывает положительный signup-conversion после 14 дней (см. spec §10 Negative signals)
2. Запустить T10 (Verify ЮKassa + cron) — research, обновить spec §11 Open Questions
3. После T10 → T11 (table) → T12 (backfill) последовательно
4. T13 (helper) → T14 (gating) — последовательно (T13 блокирует T14)
5. Параллельно T15 (subscription endpoint), T16 (webhook), T17 (client/hook), T18-T20 (UI)
6. T21 — после T15 (требует endpoint)
7. T22 (templates) → T23 (cron) — последовательно
8. T24-P1 deploy → T25-P1 QA + Codex review → T26 (legacy outreach by Vladimir)

**Pareto-напоминание:** P0 = 20% усилий, 80% результата для measurement. Не торопитесь на P1, пока не увидите signup-conversion рост на проде ≥ 14 дней.

---

## Приложение: ссылки на Canonical docs

- Spec: `docs/delivery/features/trial-flow/spec.md`
- Pipeline rules (Шаг 4 SPEC + Шаг 5 TASKS): `docs/discovery/development-pipeline.md`
- HTML mockup (7 surfaces): `SokratAI/landing-trial-mockup.html`
- Рекомендации и исследование RU EdTech: `SokratAI/trial-flow-recommendations.md`
- Шаблоны personal-сообщений legacy-репетиторам: `SokratAI/legacy-tutors-personal-message.md`
- AJTBD doc 14, 15: `docs/discovery/product/tutor-ai-agents/14-ajtbd-product-prd-sokrat.md`, `15-...`
- UX/UI doc 16, 17: `docs/discovery/product/tutor-ai-agents/16-ux-principles-for-tutor-product-sokrat.md`, `17-...`
- Pilot doc 18: `docs/discovery/product/tutor-ai-agents/18-pilot-execution-playbook-sokrat.md`
- Existing rules: `.claude/rules/{20,40,70,80,90,95}-*.md`
- Existing telemetry: `src/lib/tutorLandingAnalytics.ts`
- Existing SignUp: `src/pages/SignUp.tsx`
- Existing AppFrame: `src/components/tutor/chrome/AppFrame.tsx`
