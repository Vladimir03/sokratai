# Tutor Landing — Progress Tracker

**Feature:** лендинг репетитора `sokratai.ru/tutors`
**Start:** 2026-04-24
**Target ship V1:** ~2026-05-01 (7 дней)
**Owner:** Владимир Камчаткин
**Implementation partner:** Claude (Cowork для strategy/copy/HTML + Code для React-адаптации)

---

## Pipeline (Pareto V1)

```
1. Strategy (Cowork)  →  2. IA/Wireframe (Cowork)  →  3. Copy (Cowork)  →  4. HTML mockup (Cowork)
                                                                                    ↓
                                                                 5. React adapt (Claude Code/IDE)
                                                                                    ↓
                                                              6. Loom/Kap videos (ты/Егор)
                                                                                    ↓
                                                                  7. Deploy (Lovable via GitHub)
```

Dropped из original plan: Claude Design, Higgsfield для product-tour (см. `positioning-brief.md` §12 + обсуждение 2026-04-24).

---

## Iterations

### ✅ Iteration 1 — Positioning Foundation

**Status:** COMPLETED 2026-04-24
**Deliverable:** [`positioning-brief.md`](./positioning-brief.md) (v2, 12 разделов + traceability matrix)

Зафиксированные решения:
- [x] Архитектура: `sokratai.ru/tutors` как отдельная страница с header toggle
- [x] Primary hero — Candidate B (Егор Блинов + Владимир Камчаткин как co-founders)
- [x] Positioning statement (full + knife-phrase «Сократ — AI-слой поверх работы репетитора, не её замена»)
- [x] Tone of voice — 5 правил
- [x] Trust-ladder — 7 уровней
- [x] Ценовая модель — free forever + 200 ₽ первый месяц + tier'ы 1000/2000/3000 + enterprise
- [x] Product tour — 4 блока (3 premium + 1 freemium bridge)
- [x] Имя школы Егора — **Razveday.ru** (подтверждено 2026-04-24)
- [x] Video strategy — screen-capture primary, Higgsfield только для hero-BG и founder-portraits
- [x] Video storyboard — 4 scenes + privacy checklist ([`video-storyboard.md`](./video-storyboard.md))

---

### ✅ Iteration 2 — Information Architecture + Wireframe

**Status:** COMPLETED 2026-04-24
**Deliverable:** [`information-architecture.md`](./information-architecture.md)

Что вошло:
- [x] Карта секций — 11 content blocks + header/footer = 13 блоков
- [x] Per-section specs для каждой секции (purpose, AJTBD coverage, content-points, design tokens, grid/mobile layout, NOT-to-do)
- [x] Full ASCII wireframe (desktop + mobile notes)
- [x] Grid system — max-width, section padding, typography scale
- [x] Responsive breakpoints (mobile / tablet / desktop / wide — align to Tailwind defaults)
- [x] CTA placement strategy — 4 primary CTAs, 3 secondary (TG), правило «каждые ~1800 px scroll»
- [x] SEO/meta structure — title, description, OG, canonical, JSON-LD note
- [x] A11y baseline checklist (contrast ratios подсчитаны, focus-rings, semantic HTML, `prefers-reduced-motion`)
- [x] Handoff notes для iter 3 (что получает копирайтер), iter 4 (что получает HTML-разработчик), iter 5+ (что передаётся в Claude Code для React adapt)

**Открытые вопросы для iter 3 (4 блокирующих + 3 мягких)** — см. §10 information-architecture.md.

Ключевые решения, зафиксированные:
- Structure: 13 блоков, длина ~5800 px desktop (6 viewports, соответствует SaaS-premium паттерну)
- Zigzag product tour: text-L / video-R → video-L / text-R → text-L / video-R
- Freemium bridge (sec 6) как визуально дифференцированная секция с `--sokrat-green-50` bg
- 5-tier pricing table, TRIAL highlighted с ochre «ПОПУЛЯРНО» chip
- 5-Q FAQ через native `<details>` accordion
- Footer — 3 column, dark `--sokrat-green-900` bg

---

### ✅ Iteration 3 — Copy deck

**Status:** COMPLETED 2026-04-24
**Deliverable:** [`copy-deck.md`](./copy-deck.md) (финальный текст всех 13 секций + rationale + rejected alternatives)

Что вошло:
- [x] Meta (title, description, OG-image text)
- [x] Header navigation labels
- [x] Hero — H1 «Инструмент репетитора. От репетитора.» + 2-paragraph lede (what + founders) + CTA «Попробовать за 200 ₽ в первый месяц» + trust-line
- [x] Trust-strip (sec 1.5) — 4 pills (10 лет / 2×100 / 2000+ / 14 дней)
- [x] Pain (4 карточки живых сцен — 23:00, кто прислал, ChatGPT, мамин вопрос)
- [x] Product tour #1 — H2 «Проверка ДЗ: 3 часа → 40 минут» + 4 bullets + inline CTA
- [x] Product tour #2 — H2 «ДЗ за 5 минут вместо 40» + 4 bullets
- [x] Product tour #3 — H2 «Отчёт родителю — пока вы спите» + 4 bullets
- [x] Freemium bridge — chip + H2 + 3 mini-cards + closing line
- [x] Social proof — founder cards × 2 (Егор + Владимир цитаты), 3 case cards (2 placeholder + 1 «Ваш кейс?»)
- [x] FAQ — 5 Q/A с точными текстами
- [x] Pricing — 5-tier table, label/price/caption/features/CTA для каждого + 3 trust-line под
- [x] Final CTA — callback к pain-card 1
- [x] Footer — 3 колонки, social icons, payment methods row
- [x] Appendix A (microcopy / utility strings)
- [x] Appendix B (чего НЕТ в копи — ограничительный чек-лист для iter 4)
- [x] Appendix C (что согласовываем перед iter 4)

**2 блокирующих перед iter 4:** Егор читает секцию 7 (его цитата и регалии); Владимир читает секцию 7 + pricing + footer URLs.

**2 мягких:** legal-review для financial claims (3-4K₽/час) в iter 4; англ. vs рус. tier labels.

Что войдёт:
- [ ] Финальный Hero (Candidate B с именами founders)
- [ ] Pain block: 4-5 буллетов дословно из AJTBD-контекста
- [ ] Каждый product tour block: headline + 3-4 bullet'а с AJTBD-привязкой
- [ ] Freemium bridge копи + визуальная дифференциация
- [ ] Social proof: bio-блоки Егора и Владимира + placeholder-case (помечен `[PLACEHOLDER]`)
- [ ] FAQ — 5 возражений с ответами
- [ ] Pricing table копи + ROI-argument
- [ ] Final CTA + TG-channel secondary
- [ ] Footer
- [ ] Meta (title, description, og-image spec)

---

### ✅ Iteration 4 — HTML mockup

**Status:** COMPLETED 2026-04-24
**Deliverable:** [`preview.html`](./preview.html) — single-file HTML-макет, готовый к открытию в браузере
**Size:** ~1100 lines (HTML + inline CSS)

Что вошло:
- [x] Единый `.html` с inline `<style>` — все `--sokrat-*` токены скопированы из `src/styles/colors_and_type.css` (single source of truth в проекте)
- [x] Golos Text через Google Fonts (preview); production использует self-hosted TTF из `src/fonts/`
- [x] Hero-motion: радиальные gradient'ы + subtle CSS animation 20-sec period с `prefers-reduced-motion` guard
- [x] Все 13 секций (header → hero → trust-strip → pain → 3×tour → freemium → social proof → FAQ → pricing → final CTA → footer)
- [x] **Zigzag layout** в product tour (text-L/video-R → video-L/text-R → text-L/video-R)
- [x] Placeholder-рамки для 4 видео с правильными aspect-ratio (16:10 для tour, 3:4 portrait для video testimonial)
- [x] **Responsive:** mobile-first, breakpoints 640 / 768 / 900 / 1200 (pricing ломается на 2 col)
- [x] **A11y:** focus-visible rings, aria-labels, semantic HTML (`<header>`, `<main>`, `<section>`, `<footer>`), `<details>` accordion без JS
- [x] **FAQ accordion** — native `<details>/<summary>` с custom chevron animation
- [x] **Pricing 5-tier** с highlighted TRIAL + «Популярно» chip
- [x] **Footer** с payment badges, social icons, 3 колонки с URL'ами из Appendix D
- [x] **Все URLs** вшиты по Appendix D: TG-канал Егора, TG Vladimir, email, signup path'ы
- [x] Plaseholder-инициалы для founder photos (ЕБ / ВК)
- [x] Video testimonial Case card #1 — commented `<video>` tag + placeholder, готов к подмене
- [x] Mockup-banner в углу — объясняет что это preview (удаляется одним кликом или в iter 5)

**Где открыть:** `computer://C:\Users\kamch\sokratai\docs\delivery\features\tutor-landing\preview.html`

---

### 🔮 V2 pricing roadmap (future, после launch V1)

**Разблокировать pricing psychology при расширении:**

- [ ] Annual toggle «Месяц / Год −20%» в pricing table (Vladimir подтвердил «да, но в V2»)
- [ ] Рассрочка 0% («Долями» / Яндекс Сплит / Тинькофф) для AI-КОМАНДА tier и онлайн-школ
- [ ] Если Vladimir примет решение о price increase: разблокируется honest strikethrough + «Цена запуска» статус на всех tier'ах
- [ ] Сhip «Рекомендует Егор Блинов» как authority-trigger (когда Егор активно в маркетинге)
- [ ] Real social proof counter («X репетиторов используют Сократ AI») — когда соберём данные

---

### ⏳ Iteration 5+ (out of Cowork, другими инструментами)

**Status:** PENDING — выполняется после iter 4

- [ ] React adaptation через Claude Code → `src/pages/marketing/TutorLanding.tsx` + route `/tutors` в `App.tsx`
- [ ] Header toggle component между tutor/student landings
- [ ] Screen recordings (Loom/Kap) по storyboard — Priority 1: AI-check, Priority 2: Free tier
- [ ] Founder photos prep (портреты Егора + Владимира, 600×600 square)
- [ ] Meta OG-image генерация (1200×630)
- [ ] Deploy через Lovable GitHub sync
- [ ] Analytics events setup (Yandex Metrika — уже есть; добавить custom events: `tutor_landing_cta_clicked`, `tutor_landing_tg_channel_clicked`)

---

## Open items / blockers

| Item | Type | Status | Owner | Deadline |
|---|---|---|---|---|
| Имя школы Егора (Razveday.ru vs GrandExam) | content | ✅ Resolved 2026-04-24 — **Razveday.ru** | — | — |
| Опыт Егора в годах | content | ✅ Resolved 2026-04-24 — **10 лет** (с 2016) | — | — |
| Founder photo — Владимир | asset | ⏳ Нужен до iter 4 | Владимир | 2026-04-28 |
| Founder photo — Егор (hi-res) | asset | ⏳ Можно взять со Stepik; hi-res лучше до iter 4 | Егор/Владимир | 2026-04-28 |
| TG-канал Егора | asset | ⏳ Создаётся (через 2-3 дня от 2026-04-24) | Егор | 2026-04-27 |
| Placeholder case #2 — оставить или удалить на V1? | content | 🟡 Open — предлагаю оставить с честной пометкой «скоро» | Владимир | решить к iter 3 |
| Реальный кейс Егора (с цифрами) | content | 🟡 Soft-request — если Егор сможет назвать 1-2 конкретных числа (часы экономии, кол-во учеников) | Егор | желательно до iter 3 |
| Screen recording кабинета Егора | asset | ⏳ После iter 4 готового макета | Владимир/Егор | 2026-04-29 |
| **Video-отзыв клиентки Егора** — consent basis | asset | ✅ Resolved 2026-04-24 — TG-переписка с explicit OK от клиентки («Ну только если с припиской…») = устное информированное согласие. Скриншот сохраняется как evidence. Anonymous-подача без имени снижает privacy-risk. | — | — |
| Video-файл для Case card #1 (физический MP4 из оригинального отзыва) | asset | ⏳ Получить от Егора (у него оригинал в TG) | Егор/Владимир | до iter 4 |
| «Поддержка» URL в footer | asset | ✅ Resolved 2026-04-24 — ведёт на `https://t.me/sokrat_rep` (тот же TG-канал Егора). | — | — |
| Signup URL schema (`/signup?ref=tutor-landing&tier=X`) совместим ли с Lovable auth? | tech | ⏳ Проверить в iter 5 (React-адаптация) | Владимир + Claude Code | в iter 5 |

### Параллельный compliance-workstream (152-ФЗ / 242-ФЗ / 54-ФЗ)

Отдельный от лендинга трек, **не блокирует V1 launch**, но часть пунктов (Оферта) обязательны до первого платежа.

| Item | Level | Status | Owner | Deadline | Решение |
|---|---|---|---|---|---|
| Политика конфиденциальности актуализирована под SokratAI | L1 | 🟡 Проверить текущую, review с юристом | Владимир + юрист | до launch V1 | — |
| Пользовательское соглашение актуально | L1 | 🟡 Проверить с юристом | Владимир + юрист | до launch V1 | — |
| **Оферта для репетиторов** (обязательна до первого платежа) | L1 | ❌ Студенческая оферта как основа → юрист адаптирует 30-50% | Владимир + юрист | **до первого tutor-платежа** | **Решено 2026-04-24:** юрист адаптирует на основе student оферты, ~10-20K ₽, 1-2 часа работы |
| Checkbox «Согласен с обработкой ПДн» при signup | L1 | 🟡 Проверить в текущем flow регистрации | Владимир | до launch V1 | — |
| **Платёжный шлюз для tutor** | L1 (54-ФЗ) | ✅ Подключить YuKassa (уже integrated для учеников) | Владимир | до launch V1 | **Решено 2026-04-24:** сразу YuKassa, не card transfer. Причины: 54-ФЗ фискализация, 115-ФЗ/161-ФЗ, 14.1 КоАП + perception-фактор. 0 новой разработки (переиспользуем integration). |
| Регистрация оператора ПДн в Реестре Роскомнадзора | L2 | ⏳ Запланировано на неделю с 2026-05-01 (после отпуска Владимира) | Владимир | 2026-05-08 подать форму | **Решено 2026-04-24:** делаем после возвращения из отпуска; ~14 дней рассмотрение → номер к ~2026-05-22; badge возвращается в footer V1.1 |
| **Data localization по 242-ФЗ** — primary storage ПДн граждан РФ на серверах в РФ | L2 | ⏳ **Deferred** с trigger'ами (см. ниже) | Владимир + CTO | При trigger'е | **Решено 2026-04-24:** V1 launch с EU Supabase; миграция при trigger'е |
| Consult с юристом-специалистом по ПДн | — | ❌ Запланировать 1-2 часа (~10-30K ₽) | Владимир | до launch V1 | — |
| Badge «Оператор ПДн №XXXXXX» вернуть в footer | — | ⏳ После получения номера в Реестре РКН (если решено регистрироваться) | Владимир | после регистрации | — |

### Data localization migration triggers

- **Soft trigger:** 500+ активных tutor-пользователей → начать plan миграции на РФ managed Postgres (VK Cloud / Яндекс.Облако / SberCloud)
- **Hard trigger:** media-кампания / платный трафик / упоминание в СМИ → миграция в приоритете
- **Regulatory trigger:** запрос от Роскомнадзора или юриста клиента → immediate action

**Note:** я (Claude) не юрист. Выше — стандартная практика РФ SaaS startups, не юридический совет. Final compliance — через юриста-специалиста по 152-ФЗ/242-ФЗ/54-ФЗ.

**Что дропнуто с лендинга из-за compliance gap:**
- Badge «Обработка данных по 152-ФЗ» в footer (нельзя claim без подтверждённого compliance) — вернётся как «Оператор ПДн №XXXXXX» после регистрации в РКН (если решено)

---

## Handoff matrix

Что уходит из Cowork и куда:

| Артефакт | Hand-off target | Как передаётся |
|---|---|---|
| `landing.html` (iter 4) | Claude Code (IDE) | Файл в репо, Claude Code адаптирует в React |
| `copy-deck.md` (iter 3) | Claude Code + Егор для review | MD в репо; Егор даёт свои комментарии |
| `video-storyboard.md` | Владимир/оператор | Screen recording по pipeline из документа |
| Founder photos | Iter 4 HTML → prod assets | Put в `public/marketing/tutor-landing/` |
| Meta / OG image | Figma/Canva → prod assets | Отдельная задача, не в Cowork scope |

---

## Update log

- **2026-04-24** — проект начат, iter 1 завершён (positioning-brief v2), iter 2 начат
- **2026-04-24** — подтверждена архитектура `/tutors`, Hero Candidate B с Егором+Владимиром, freemium pricing
- **2026-04-24** — добавлен video-storyboard, pipeline упрощён до Pareto V1 (5 шагов вместо 5 с dropping Claude Design и Higgsfield для UI)
- **2026-04-24** — подтверждено имя школы Егора: **Razveday.ru** (не GrandExam)
- **2026-04-24** — iter 2 завершён. Information Architecture готова: 13 блоков, полный wireframe, grid/breakpoints, CTA strategy, SEO, a11y. Iter 3 ready to start после согласования 4 блокирующих вопросов из §10 IA
- **2026-04-24** — iter 2 post-approval updates:
  - Добавлена Section 1.5 «Trust-strip» между Hero и Pain (РФ EdTech pattern, 4 authority-сигнала)
  - Footer расширен: payment methods row (МИР/Visa/MC/СБП/ЮMoney), 152-ФЗ badge, social icons (TG/VK), 3-колоночный layout → Продукт/Компания/Правовая информация
  - Appendix B (РФ EdTech patterns) — ✅ применяемые / ❌ не применяемые + tone-rules
  - Appendix C (Freemium bridge rationale) — 4 аргумента + risks + when-to-revisit
  - IA теперь 14 блоков всего (добавилась sec 1.5), page height ~5900 px desktop
- **2026-04-24** — Iter 3 approved to start. Все 7 открытых вопросов resolved
- **2026-04-24** — 152-ФЗ badge убран из footer V1 (юридический риск без подтверждённого compliance). Добавлены 3 honest legal-links: Политика + Соглашение + Оферта. Compliance-workstream создан как отдельный параллельный трек. Trust-strip обновлён «9 лет» → «10 лет опыта Егора» (с 2016)
- **2026-04-24** — compliance-decisions зафиксированы: Оферта адаптируется юристом на основе студенческой (не с нуля); платёжный шлюз — YuKassa (не card transfer, из-за 54/115/161-ФЗ + 14.1 КоАП); data localization — deferred с 3 trigger'ами; РКН-регистрация — pending Владимир
- **2026-04-24** — РКН-регистрация запланирована на неделю с 2026-05-01 (после отпуска). Badge в footer вернётся к V1.1 (~2026-05-22)
- **2026-04-24** — Iter 3 завершён. Copy deck готов: финальный текст всех 13 секций, rationale и rejected alt задокументированы
- **2026-04-24** — Copy deck v2 применил feedback Владимира: 10 точечных правок (credentials Владимира, video testimonial клиентки Егора вместо Case #1, russification pricing labels, Tier 5 rewrite под школы+20+ репетиторов, «2000+ задач» → «5 мин сборка ДЗ», TG-канал @sokrat_rep вшит, TG @Analyst_Vladimir вместо mailto primary). Добавлен Appendix D — URL mappings.
- **2026-04-24** — Copy deck v3 финализирован:
  - Trust-strip pill 3: ФИПИ-вариант (не «5 мин»)
  - Video-testimonial: anonymous, consent basis = TG-переписка (формальное согласие не делаем); скриншот сохраняется как evidence
  - «Поддержка» в footer = `https://t.me/sokrat_rep` (одна поверхность с «Каналом Егора»)
- **2026-04-24** — **Iter 3 полностью closed**, все open items iter 3 resolved. Готов к запуску Iter 4 (HTML-макет).
- **2026-04-24** — **Iter 4 завершён.** HTML-макет `preview.html` готов — все 13 секций, inline CSS с `--sokrat-*` токенами, responsive mobile-first, A11y baseline, placeholder-слоты для видео и фото. Ready для handoff в Claude Code на iter 5 (React-адаптация).
- **2026-04-24** — **Iter 5 handoff — hybrid pipeline artifacts созданы:**
  - `tasks.md` — 12 canonical-format tasks (Pattern 1 Type A per doc 20) с Role + Context + Canonical docs + Task + NOT-to-do + AC + Mandatory end block. Bottom: 12 copy-paste ready prompts для Claude Code.
  - `codex-review-prompt.md` — independent review prompt для Codex clean session (Pattern 4 per doc 20 + 8 questions per doc 19 + 6 marketing-specific checks). Format: PASS / CONDITIONAL PASS / FAIL.
  - `implementation-spec.md` сохранён as-is (spec content unchanged, tasks.md references it). Existing positioning-brief, IA, copy-deck, preview.html, video-storyboard — все используются как canonical reference для Claude Code.
  - Pipeline workflow: Claude Code executes tasks 1-12 → creates PR → Codex reviews (clean session) → fixes if needed → Vladimir final QA → merge → Lovable auto-deploy.

- **2026-04-24** — **Iter 5 kickoff: implementation-spec.md finalized v1.1** — ready для передачи в Claude Code. Финализированы: no Lovable preview → local build + screenshots review, OG image — reuse existing, legal docs → mailto fallback до launch, Vladimir photo — placeholder initials до later upload.

- **2026-04-24** — **TASK-1 done** (branch `feature/tutor-landing-v1`): `Index.tsx` → `StudentLanding.tsx` (byte-identical rename via `git mv`), new `Index.tsx` stub placeholder для TASK-2, routes `/students` и `/tutors → /` добавлены в `App.tsx`. Student-flow `to="/"` links обновлены на `/students`: `Navigation.tsx` logo, `InvitePage.tsx` error fallback, `BookLesson.tsx` not-found. Legal/generic home links (`Offer`, `PrivacyPolicy`, `Requisites`, `NotFound`, `Admin`) оставлены на `/` — ведут на tutor landing post-TASK-2, что соответствует «общая главная». Lint (touched files) + `npm run build` — PASS.

- **2026-04-24** — **TASK-2 done**: создана директория `src/components/sections/tutor/` с 13 stub-компонентами (`TutorLandingHeader`, `Hero`, `TrustStrip`, `Pain`, `ProductTour` + `ProductTour1/2/3`, `FreemiumBridge`, `SocialProof`, `FAQ`, `Pricing`, `FinalCTA`, `Footer`) + `tourData.ts`. `src/pages/Index.tsx` переписан: shell с `<div className="sokrat sokrat-marketing min-h-screen">`, все 11 content-секций через `React.lazy` + `Suspense` со skeleton fallback в approximate IA heights (Hero 640, TrustStrip 96, Pain 450, Tours 560/480/480, Freemium 440, SocialProof 600, FAQ 520, Pricing 560, FinalCTA 360, Footer 240). **Нет** `data-sokrat-mode` — marketing surface per SKILL.md §3. TutorLandingHeader намеренно eager (не lazy) — above-the-fold sticky. Section anchors (`id="hero"`, `id="product-tour"` на Tour2, `id="social-proof"`, `id="faq"`, `id="pricing"`) проставлены на stub'ах для scroll-nav из TASK-3. Lint + build — PASS.

- **2026-04-24** — **TASK-3 done**: `TutorLandingHeader.tsx` собран на базе паттерна `StudentLanding.tsx`. Sticky header h=64px, `.container` layout: logo (`sokrat-logo.png` 32×32 + «Сократ AI») → scroll-anchor nav (5 items: Главная / Возможности → `#product-tour` / Цены / Кейсы → `#social-proof` / FAQ) → desktop-only audience switcher «Для учеников →» к `/students` → Login dropdown (Я ученик / Я репетитор; на мобиле добавляется mobile-only item «Для учеников и родителей →» после `DropdownMenuSeparator`). Active section detection — `IntersectionObserver` с `rootMargin: "-40% 0px -55% 0px"` (lightweight, без scroll listeners); `aria-current="location"` на активном item. Mobile (<768): brand text hidden (`hidden sm:inline`), audience switcher hidden (`hidden md:inline-flex`), nav scrolls horizontally через `overflow-x-auto scrollbar-hide`. Runtime preview verified: desktop 1280→ header 65px (h-16 + 1px border) с visible brand, mobile 375→ nav 396px scrollWidth > 227px clientWidth = горизонтальный скролл работает. Focus rings на логотипе/nav items/audience switcher. Lint + build — PASS.

- **2026-04-24** — **TASK-6 done**: `Pain.tsx` заполнен. H2 «Знакомая картина?» центрирован (inherits `.sokrat-marketing h2` tokens). 4 card'a в `<ul>`-grid: 1-col mobile (gap-3) → 2×2 desktop md (gap-4), max-w 960px, copy verbatim из `copy-deck.md §2` (курли-кавычки в cards 2 и 4 сохранены). Cards: bg `--sokrat-card` (white), border 1px `--sokrat-border`, radius 14px, padding 20 mobile / 28 desktop. Hover: border → `--sokrat-green-200` + `hover:shadow-sm` с `transition-[border-color,box-shadow] duration-200`. **Важно для cascade:** маркетинг-global rule `.sokrat:not([data-sokrat-mode]) h3/p` форсит 24px/16px (specificity 0,2,1). Task spec требует 16→18 и 14→15. Решение — scoped `<style>` в компоненте с селектором `.sokrat.sokrat-marketing .pain-card-title/body` (0,3,0) — побеждает глобал. Runtime verified: desktop 1280 → 2 cols, h3 18px/600, p 15px/1.6, card radius 14px, border rgb(226,232,240); mobile 375 → 1 col, h3 16px, p 14px, padding 20px. Нет emoji/icons/red, порядок cards сохранён (ChatGPT в позиции 3). Lint + build — PASS.

- **2026-04-24** — **TASK-5 done**: `TrustStrip.tsx` заполнен. 4 pills (GraduationCap/Trophy/BookOpen/ShieldCheck — все Lucide individually imported) с verbatim copy из `copy-deck.md §1.5`: «10 лет» / «2×100» / «ФИПИ» / «14 дней». Section markup = `<section aria-label="Доверительные признаки">` + `<ul>` grid (2-col mobile → 4-col `md:`). Icons 20px mobile / 24px `md:`, color `--sokrat-green-700`. Value 16px mobile / 20px desktop, weight 700, `--sokrat-fg1`. Caption 12/13px, `--sokrat-fg3`. Bg `--sokrat-surface` + hairline borders top/bottom `--sokrat-border-light`. Padding 40px vertical (`py-10`). Runtime preview: desktop 1280 → 4 cols, icons 24×24 green rgb(27,107,74), value 20px/700; mobile 375 → 2 cols, icons 20×20, value 16px. Lint + build — PASS.

- **2026-04-24** — **TASK-4 done**: `Hero.tsx` заполнен. Copy verbatim из `copy-deck.md §1`: H1 «Инструмент репетитора. От репетитора.», lede-1 (AI + Сократ + 5 мин), lede-2 (Егор Блинов + Владимир Камчаткин). Primary CTA «Попробовать за 200 ₽ в первый месяц» → `/signup?ref=tutor-landing&tier=ai-start`; secondary CTA «Канал Егора →» → `https://t.me/sokrat_rep` (target=_blank, rel=noopener noreferrer). Trust-line — 3 ✓-items с зелёным чекмарком. Background: два radial gradient'a (`--sokrat-green-50` + `--sokrat-green-100` over `--sokrat-surface`) + scoped `.tutor-hero::before` linear-gradient анимация `tutor-hero-shift 20s ease-in-out infinite alternate` + `@media (prefers-reduced-motion: reduce)` guard. Скоупед `<style>` inline в компоненте — это marketing-only hero, чтобы не трогать `colors_and_type.css`. H1 наследует `.sokrat-marketing h1` токены (700, 36px mobile → 48px md+, `--sokrat-green-800`, text-wrap: balance). Lede-1 через `.lede` класс. CTA primary `min-h[52px] bg-[--sokrat-green-700] text-white`; secondary outline border-2. Mobile: CTA full-width stack. Runtime preview: desktop 1280 → H1 48px, max-w 800px, padding 120/80, CTAs side-by-side; mobile 375 → H1 36px, padding 80/56, CTAs stacked. Animation keyframe active. Lint + build — PASS.

- **2026-04-24** — **Iter 5 kickoff: implementation-spec.md создан** для передачи в Claude Code.
  - Architecture decisions: tutor landing → `sokratai.ru/`, student → `/students`, `/tutors` → 301 redirect
  - Header: scroll-anchor nav (по паттерну current Index.tsx) + logo `sokrat-logo.png` + audience switcher + Login dropdown
  - 12 discrete tasks с file paths, AC, code review checklist
  - Deploy flow: GitHub → Lovable auto-sync, feature branch `feature/tutor-landing-v1`
  - Timeline: ~1 день Claude Code execution + 1 день QA/deploy
- **2026-04-24** — **Iter 4 v4 — TRIAL discount visibility fix:**
  - Vladimir отметил что скидка не видна сразу (chip был ниже caption)
  - Redesign: inline row «~~1 000 ₽/мес~~ [−80%]» прямо над big price → глаз считывает за 1 movement
  - **200 ₽** теперь в ochre color — price-itself подсвечен как SALE
  - «Экономия 800 ₽ первый месяц» bold ochre под price — tangible ₽-amount
  - Caption consolidated (disclaimer «далее — по числу учеников» вошёл в основную caption)
  - 3 visual cues одновременно вокруг price → скидка не пропустима при 2-сек скане
- **2026-04-24** — **Iter 4 v3 — pricing psychology research + apply:**
  - Research: 10 РФ EdTech pricing triggers (strikethrough, countdown, per-day, scarcity, annual toggle, БНПЛ, etc.). Разделены на honest / deceptive.
  - Applied honest: TRIAL strikethrough «~~1 000 ₽/мес~~ 200 ₽» + chip «Скидка 80% на старт» + disclaimer «Далее — по числу учеников»; per-day captions для ПЛЮС/ПРО/КОМАНДА (≈ 33/67/100 ₽ в день); ochre accent
  - Vladimir decisions: price increase — pending / лимит first-N — нет / annual toggle — V2 / рассрочка — V2
  - ROI numbers обновлены: 3-4K→1,5-2K per час, 10-12K→4,5-6K в месяц
  - «Сократ» → «Сократ AI» везде (9-шаговый placeholder swap, прилагательное «сократовский» сохранено)
- **2026-04-24** — **Iter 4 v2** применил feedback Владимира: 11 точечных правок в preview.html + 3 design-critique улучшения для Tour #1:
  - Tour #1: добавлен ochre chip «Экономия 80% времени», H2 «3 часа → 40 минут» с differentiated emphasis (past muted / future bright) + nowrap anti-break, subheading rewrite («flow» → «цепочка»), удалён bullet «Черновик фидбека», расширен bullet «Сократовский диалог с учеником»
  - Tour #2: добавлен chip «За 5 минут вместо 40», bullet 1 title уточнён («База задач + ваш архив»), bullet 2 «10 000 задач» → «100+ задачах», удалён bullet «Дифференциация по уровням»
  - Tour #3: убрана фраза «Ваш логотип, ваш стиль»; удалён bullet «Ваш бренд, не наш»
  - Freemium: переписан subheading (plain Russian, убраны «AI-слой» и «trial-ловушки»), «Google Sheets» → «Excel»
  - Founder Владимир: «Founder СократAI» → «Основатель Сократ AI»
  - Pricing ROI: вынесен в выделенный green-50 box с title «Окупаемость первой неделей», text 17 px, числа bold
