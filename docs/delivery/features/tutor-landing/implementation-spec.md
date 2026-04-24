# Implementation Spec — Tutor Landing (sokratai.ru /)

**Target:** реализация tutor-лендинга из `preview.html` в React-компоненты, интеграция в routing `sokratai.ru/`, deploy через Lovable.

**Status:** Ready-to-execute — все design-artifacts согласованы в iter 1-4 Cowork.

**Owner:** Владимир Камчаткин (product) + Claude Code (implementation) + Lovable (deploy).

**Pipeline:** Claude Code получает эту спеку → создаёт tasks с промптами → выполняет по одной → делает self-review → pushes to GitHub feature branch → PR → merge → Lovable auto-deploy.

---

## 0. Pre-flight — что уже есть

**Design artifacts (не трогать, только консумить):**
- `docs/delivery/features/tutor-landing/preview.html` — single-file HTML-макет, source-of-truth для layout/styles
- `docs/delivery/features/tutor-landing/copy-deck.md` — финальный копи всех секций (v5)
- `docs/delivery/features/tutor-landing/information-architecture.md` — section map, grid, CTA strategy
- `docs/delivery/features/tutor-landing/positioning-brief.md` — positioning, tone, founders rationale
- `docs/delivery/features/tutor-landing/video-storyboard.md` — video specs (4 scenes)
- `SKILL.md` (repo root) — design system rules
- `src/styles/colors_and_type.css` — токены (single source of truth)

**Existing code to reuse:**
- `src/assets/sokrat-logo.png` — brand logo (заменяет «С» placeholder в preview)
- `src/assets/sokrat-chat-icon.png` — icon альтернатива
- `src/pages/Index.tsx` — current student landing (переименовываем)
- `src/components/sections/*.tsx` — student sections (не трогаем, reference only)
- shadcn primitives (`Button`, `Card`, `DropdownMenu`, etc.)
- Existing routing в `src/App.tsx`

---

## 1. Architectural changes

### 1.1 Routing rearrangement

**До:**
- `/` → Index.tsx (student landing)
- `/tutor/*` → tutor product routes

**После:**
- `/` → **TutorLanding.tsx** (NEW — из preview.html)
- `/students` → **StudentLanding.tsx** (RENAMED from Index.tsx)
- `/tutors` → 301 redirect на `/` (backward compat, была раньше ссылка в брифах)
- Все `/tutor/*` product routes — **не трогаем**
- Все `/student/*`, `/chat`, `/homework`, `/practice` и т.д. — **не трогаем**

### 1.2 SEO / meta impact

- Текущий `sokratai.ru/` теряет SEO для «ЕГЭ подготовка» keyword-cluster
- Новый `/` индексируется под «AI для репетитора», «автопроверка ДЗ», «репетитор физики ЕГЭ»
- Старые keywords переиндексируются на `/students` (временная просадка 1-3 месяца)
- Canonical URL каждого landing'а указывает на себя, не кросс-редиректит

### 1.3 High-risk files (edit only if task explicitly requires)

Из `.claude/rules/10-safe-change-policy.md`:
- `src/components/AuthGuard.tsx`
- `src/components/TutorGuard.tsx`
- `src/pages/Chat.tsx`
- `src/pages/tutor/TutorSchedule.tsx`
- `supabase/functions/telegram-bot/index.ts`

**Ни одна из этих файлов не трогается** в рамках tutor-landing tasks.

---

## 2. Task breakdown

**12 discrete tasks, each с file paths, scope, acceptance criteria, code review checklist.** Каждая task самодостаточна — Claude Code может выполнить в изоляции и self-review.

Порядок следует dependency-chain. Tasks 1-2 — foundational; 3-11 — components; 12 — final integration.

---

### Task 1 — Routing rename + redirect

**Scope:** переименовать `Index.tsx` → `StudentLanding.tsx`, добавить route skeleton для будущего TutorLanding, настроить redirect `/tutors` → `/`.

**Files:**
- `src/pages/Index.tsx` → `src/pages/StudentLanding.tsx` (rename, content без изменений)
- `src/pages/Index.tsx` (NEW) — пустой stub-компонент с `return <div>Tutor Landing — implementation pending</div>` (filled в task 2)
- `src/App.tsx` — update routes

**App.tsx route changes:**
```tsx
<Route path="/" element={<Index />} />  // теперь TutorLanding stub
<Route path="/students" element={<StudentLanding />} />  // NEW
<Route path="/tutors" element={<Navigate to="/" replace />} />  // NEW
// все остальные routes не трогаем
```

**Acceptance criteria:**
- [ ] `sokratai.ru/students` отображает текущий student landing (полный работает)
- [ ] `sokratai.ru/tutors` редиректит на `sokratai.ru/`
- [ ] `sokratai.ru/` показывает stub (temporary; filled в task 2)
- [ ] `npm run build` — без ошибок
- [ ] `npm run lint` — без новых warnings
- [ ] Все существующие user flows (login, homework, chat) работают

**Code review:**
- Нет ли осиротевших `import`-ов от Index.tsx → убедиться что все reference обновлены
- `<Navigate replace>` используется для SEO (301 vs 302) — проверить
- Все внутренние ссылки «на главную» в codebase (`<Link to="/">`) — переосмыслить: они теперь ведут на tutor landing, не на student. В tutor-продукт-флоу, возможно, это ок; в student-флоу — возможно, нужно `<Link to="/students">`. Поискать `to="/"` и оценить case-by-case.

---

### Task 2 — TutorLanding shell + section composition

**Scope:** создать главный `TutorLanding` компонент (теперь он Index.tsx), lazy-load sections в правильном порядке, wrap в mode-class, smoke render.

**Files:**
- `src/pages/Index.tsx` — fill the stub with full TutorLanding
- `src/components/sections/tutor/` — создать директорию (пустую пока — sections fill в следующих tasks)

**Shell code структура (TutorLanding.tsx):**
```tsx
import { lazy, Suspense } from "react";
import TutorLandingHeader from "@/components/sections/tutor/TutorLandingHeader";
// ... lazy imports

const TutorLanding = () => (
  <div className="sokrat sokrat-marketing min-h-screen">
    <TutorLandingHeader />
    <main>
      <Suspense fallback={<HeroSkeleton />}><Hero /></Suspense>
      <Suspense fallback={<StripSkeleton />}><TrustStrip /></Suspense>
      <Suspense fallback={<SectionSkeleton />}><Pain /></Suspense>
      <Suspense fallback={<SectionSkeleton />}><ProductTour1 /></Suspense>
      <Suspense fallback={<SectionSkeleton />}><ProductTour2 /></Suspense>
      <Suspense fallback={<SectionSkeleton />}><ProductTour3 /></Suspense>
      <Suspense fallback={<SectionSkeleton />}><FreemiumBridge /></Suspense>
      <Suspense fallback={<SectionSkeleton />}><SocialProof /></Suspense>
      <Suspense fallback={<SectionSkeleton />}><FAQ /></Suspense>
      <Suspense fallback={<SectionSkeleton />}><Pricing /></Suspense>
      <Suspense fallback={<SectionSkeleton />}><FinalCTA /></Suspense>
    </main>
    <Suspense fallback={<FooterSkeleton />}><Footer /></Suspense>
  </div>
);
```

**Important:** `<div className="sokrat sokrat-marketing">` обязательно — foundations CSS keyed off this class (см. SKILL.md §3). **Нет `data-sokrat-mode`** — marketing surface, не product.

**Acceptance criteria:**
- [ ] `sokratai.ru/` рендерит layout c placeholder-компонентами для каждой секции (секции — `<section>Hero placeholder</section>` и т.д.)
- [ ] Lazy boundaries работают — no-JS fallback показывает skeleton
- [ ] Class `sokrat sokrat-marketing` присутствует на root div
- [ ] Lighthouse performance > 85 на пустом shell (меньше means что-то блокирует)

**Code review:**
- Section order **строго** по `information-architecture.md` §2 section-map
- Suspense boundaries gracefully — skeleton heights реалистичные (uses approximate from IA)
- Нет ошибок React-hydration в консоли

---

### Task 3 — TutorLandingHeader

**Scope:** адаптировать header из preview.html + учесть audience-switch + интегрировать scroll-anchor nav по образу текущего student Index.tsx.

**Files:**
- `src/components/sections/tutor/TutorLandingHeader.tsx` (NEW)

**Structure (desktop row):**
```
[Logo: sokrat-logo.png + "Сократ AI"]  [Главная · Возможности · Цены · Кейсы · FAQ]  [Для учеников →] [Войти ▼]
```

**Components to use:**
- `sokrat-logo.png` из `src/assets/`
- `<Link>` from react-router-dom для `/students`
- `<DropdownMenu>` shadcn для Login — копируй точно из current Index.tsx (разветвление "Я ученик / Я репетитор")
- Tailwind classes + `--sokrat-*` tokens

**Scroll-anchor items:**
```tsx
const anchors = [
  { href: "#hero", label: "Главная" },
  { href: "#product-tour", label: "Возможности" },  // anchor к ProductTour1 wrapper
  { href: "#pricing", label: "Цены" },
  { href: "#social-proof", label: "Кейсы" },
  { href: "#faq", label: "FAQ" },
];
```

**Sticky behavior:** `sticky top-0 z-50 bg-background/95 backdrop-blur-md border-b border-border` (copy from current Index.tsx nav).

**Mobile (< 768px):**
- Scroll-anchors — horizontal scrollable row (как в current Index.tsx — `overflow-x-auto scrollbar-hide`)
- «Для учеников →» link — перенести в Login dropdown или бургер-меню
- Login dropdown остаётся

**Audience switcher «Для учеников →»:**
- Small ghost-style link с иконкой (GraduationCap or BookOpen)
- Ведёт на `/students`
- Desktop: inline в header перед Login; Mobile: внутри Login dropdown как отдельный item

**Acceptance criteria:**
- [ ] Desktop header рендерится как single-row 64 px
- [ ] Scroll-anchors скроллят до соответствующих sections с smooth behavior
- [ ] Logo ведёт на `/` (self-refresh)
- [ ] Login dropdown разветвляет на `/login` (student) и `/tutor/login`
- [ ] «Для учеников →» link ведёт на `/students`
- [ ] Mobile header compact — только logo + burger/dropdown
- [ ] Active state у anchor-nav item при скролле в соответствующую section (intersection observer или scroll position)
- [ ] A11y: focus ring на всех links, `aria-current="location"` на active tab

**Code review:**
- Copy EXACTLY login-dropdown pattern из current Index.tsx — не writing from scratch
- Logo `<img>` has `alt="Сократ AI"` и proper width/height (Lighthouse CLS)
- `backdrop-filter` с `-webkit-` prefix (autoprefixer сделает, проверить в build output)

---

### Task 4 — Hero section

**Scope:** hero-секция с H1 «Инструмент репетитора. От репетитора.», двухуровневый lede, CTA pair, trust-line.

**Files:**
- `src/components/sections/tutor/Hero.tsx` (NEW)

**Content source:** `copy-deck.md` §«Section 1 — Hero»

**Key elements:**
- H1: «Инструмент репетитора. От репетитора.» с `<br>` между предложениями на desktop
- Lede-1 (большой lede): product description (3 sentence)
- Lede-2 (small credentials): founders с регалиями
- CTA primary: «Попробовать за 200 ₽ в первый месяц» → `/signup?ref=tutor-landing&tier=ai-start`
- CTA secondary (ghost): «Канал Егора →» → `https://t.me/sokrat_rep` (external, target="_blank" rel="noopener")
- Trust-line: 3 ✓-buckets

**Design requirements:**
- Background: radial gradients + subtle hero-shift animation (как в preview.html)
- `@media (prefers-reduced-motion: reduce)` — disable animation
- max-width: 800 px, centered
- Padding: 120px top / 80px bottom desktop; 80/56 mobile

**Acceptance criteria:**
- [ ] Hero рендерится с полным copy'ем из copy-deck
- [ ] CTA-кнопки используют shadcn `<Button>` с соответствующими классами
- [ ] Primary CTA bg socrat-green-700, white text, min-height 52px
- [ ] Secondary CTA ghost-style, 2px border socrat-green-700
- [ ] Background gradient animation работает + disable при reduced-motion
- [ ] Mobile: CTA stack вертикально, full-width

**Code review:**
- Никаких inline `hex` цветов — только Tailwind или CSS variables
- H1 имеет `text-wrap: balance` или `<br>` для line-break control
- Внешние ссылки имеют `rel="noopener"` security
- Нет emoji в UI chrome (per SKILL.md anti-drift rule)

---

### Task 5 — TrustStrip section

**Scope:** compact hairline-strip между Hero и Pain с 4 authority-pills.

**Files:**
- `src/components/sections/tutor/TrustStrip.tsx` (NEW)

**Content source:** `copy-deck.md` §«Section 1.5 — Trust-strip»

**4 pills (values):**
1. `GraduationCap` + «10 лет» + «опыта Егора Блинова»
2. `Trophy` + «2×100» + «баллов ЕГЭ лично у Егора»
3. `BookOpen` + «ФИПИ» + «привязка ко всему кодификатору»
4. `ShieldCheck` + «14 дней» + «отмена без объяснений»

**Icons:** `lucide-react` (not inline SVG — используем стандартную library).

**Layout:**
- Desktop: 4-col grid 1fr, gap 32 px
- Mobile: 2×2 grid, gap 20×12 px

**Acceptance criteria:**
- [ ] 4 pills равномерно distributed
- [ ] Icons 24×24 (desktop) / 20×20 (mobile), color socrat-green-700
- [ ] Values — 20px bold desktop / 16px mobile
- [ ] Captions — 13px fg3 desktop / 12px mobile
- [ ] Height ~96px desktop (compact — не section, а strip)
- [ ] Background сlightly отличается от Hero (surface color) — signals visual break

**Code review:**
- Lucide icons импортированы individually (`import { GraduationCap } from "lucide-react"`) для tree-shaking
- Нет абсолютных sizes в style — только Tailwind classes

---

### Task 6 — Pain section

**Scope:** «Знакомая картина?» 2×2 pain-cards с живыми сценами.

**Files:**
- `src/components/sections/tutor/Pain.tsx` (NEW)

**Content source:** `copy-deck.md` §«Section 2 — Pain»

**4 cards:** 23:00/12 работ · Кто прислал? · Ученик в ChatGPT · Как у него дела?

**Layout:**
- Desktop: 2×2 grid, gap 16 px, max-width 960 px
- Mobile: 1-col stack, gap 12 px

**Card styling:**
- Background: `--sokrat-card` white
- Border: 1px `--sokrat-border`
- Radius: `--sokrat-radius-md`
- Padding: 28 px desktop / 20 px mobile
- Hover: border → socrat-green-200 + shadow-sm (subtle)

**Acceptance criteria:**
- [ ] 4 cards с exact copy из copy-deck
- [ ] Card-title 18px semibold / 16px mobile
- [ ] Card-body 15px fg2 / 14px mobile, line-height 1.6
- [ ] Кавычки в card titles 2, 4 — Russian «...» curly
- [ ] Никаких emoji/icons в card (tone: book-ish)
- [ ] Section bg: surface (F8FAFC); contrasts с Hero и Tour #1

**Code review:**
- Russian typography: «curly quotes» not "straight quotes"
- H2 центрирован; cards — grid aligned
- Hover states используют Tailwind `hover:`

---

### Task 7 — ProductTour (template + 3 instances)

**Scope:** создать reusable ProductTour template, использовать 3 раза с different props (Tour #1 flagship / #2 Конструктор ДЗ / #3 Отчёт родителю).

**Files:**
- `src/components/sections/tutor/ProductTour.tsx` (NEW) — generic template
- `src/components/sections/tutor/ProductTour1.tsx` — Tour #1 instance
- `src/components/sections/tutor/ProductTour2.tsx` — Tour #2 instance
- `src/components/sections/tutor/ProductTour3.tsx` — Tour #3 instance

**Alternative pattern:** одна `ProductTour` компонент + data-file `tourData.ts`; использовать 3 раза с props. Предпочтительно для maintainability.

**Template props:**
```ts
interface ProductTourProps {
  id: string;  // для scroll-anchor
  badge?: { icon: LucideIcon; label: string };  // "Экономия 80% времени"
  headline: React.ReactNode;  // может содержать <TransformGroup>
  lede: string;
  bullets: Array<{ title: string; body: string }>;
  inlineCTA?: { label: string; href: string };
  videoPlaceholderText: string;
  videoPlaceholderCaption: string;
  videoSrc?: string;  // when video is ready
  zigzag?: "text-left" | "text-right";
  backgroundSurface?: boolean;  // true → surface bg, false → card bg
}
```

**Tour #1 props:** title с transformation «3 часа → 40 минут», 3 bullets (Рукопись, Классификация, Сократовский диалог), inline CTA «Попробовать за 200 ₽ →», text-left layout.

**Tour #2 props:** badge «За 5 минут вместо 40», H2 «ДЗ из базы за пять минут», 3 bullets (База + архив, AI-генерация, Отправка), zigzag text-right, surface bg.

**Tour #3 props:** H2 «Отчёт родителю — пока вы спите», 3 bullets (Карта тем, Динамика, Каналы доставки), text-left, card bg.

**Video slot:**
```tsx
{videoSrc ? (
  <video src={videoSrc} autoPlay loop muted playsInline poster={poster} />
) : (
  <VideoPlaceholder text={videoPlaceholderText} caption={videoPlaceholderCaption} />
)}
```

**Content source:** `copy-deck.md` §«Section 3, 4, 5»

**Acceptance criteria:**
- [ ] 3 Tour sections рендерятся в правильном порядке
- [ ] Zigzag layout работает (alternating text-left → text-right → text-left)
- [ ] Mobile: всегда text-top, video-bottom (или наоборот — обсудить в review)
- [ ] Tour #1 бейдж «Экономия 80% времени» — ochre chip
- [ ] Tour #2 бейдж «За 5 минут вместо 40»
- [ ] Tour #1 H2 с transformation-style («3 часа → 40 минут» — muted → arrow → bright)
- [ ] Tour #1 inline CTA ведёт на `/signup?ref=tutor-landing&tier=ai-start`
- [ ] Video placeholder с правильным aspect-ratio 16:10
- [ ] Tour #2 имеет `id="product-tour"` (для scroll-anchor из header)

**Code review:**
- ProductTour template — DRY (не дублировать layout в 3 instances)
- Video `<video>` tag имеет `playsInline` обязательно (iOS Safari)
- Все bullets используют одинаковую структуру (title + body), не diverge

---

### Task 8 — FreemiumBridge section

**Scope:** sec 6 с chip «БЕСПЛАТНО НАВСЕГДА», 3 mini-cards + video placeholder.

**Files:**
- `src/components/sections/tutor/FreemiumBridge.tsx` (NEW)

**Content source:** `copy-deck.md` §«Section 6 — Freemium bridge»

**Key elements:**
- Chip top-left: «БЕСПЛАТНО НАВСЕГДА» (ochre-100 bg, ochre-700 text, uppercase, tracking 0.08em)
- H2: «Оплаты и расписание — базовая платформа бесплатно»
- Lede: 2 предложения про free-forever
- 3 mini-cards: Оплаты / Расписание / Профили учеников
- Video placeholder: 16:10 aspect, centered, max-width 680 px
- Closing line: «AI-слой подключается опционально — от 200 ₽ в первый месяц. Без него базовая платформа остаётся.»

**Design requirements:**
- Section bg: `--sokrat-green-50` (#f3f9f5) — **критично** для визуального перелома
- Border top + bottom: 1px `--sokrat-green-100`
- `/pay` код внутри card #1 — inline `<code>` style green-100 bg, green-800 text, font-mono

**Acceptance criteria:**
- [ ] Bg `--sokrat-green-50` — сразу отличается от предыдущей Tour #3
- [ ] Chip виден над H2
- [ ] 3 mini-cards в row на desktop, stack на mobile
- [ ] Closing line center-aligned, 15px
- [ ] Video placeholder max-width 680 px, center

**Code review:**
- Только здесь (+ trust-strip chip + pricing trial) используется ochre — не распространять на другие секции
- H2 color `--sokrat-green-800` (не brand green) — consistent с SKILL.md rule

---

### Task 9 — SocialProof section

**Scope:** founders cards × 2 + 3 case cards (1 video testimonial + 1 placeholder + 1 «Ваш кейс?»).

**Files:**
- `src/components/sections/tutor/SocialProof.tsx` (NEW)

**Content source:** `copy-deck.md` §«Section 7»

**Founders:**
- **Егор Блинов** — 4 credentials + 3-line quote + CTA «Канал Егора →» (TG external)
- **Владимир Камчаткин** — 4 credentials + 3-line quote, no CTA

**Founder photos:**
- Egor: placeholder initials «ЕБ» (240×240 в green gradient bg) — replace with actual photo when available
- Vladimir: placeholder «ВК» — replace
- Placeholder path: `/marketing/tutor-landing/founder-egor.jpg` и `/marketing/tutor-landing/founder-vladimir.jpg`
- **Handoff:** если файлы не существуют, оставить initials fallback

**Cases:**
- Case #1 (VIDEO): placeholder-block с play-overlay + «Видео-отзыв ждём от Егора»; video-slot ожидает `public/marketing/tutor-landing/testimonial-client-egor.mp4`
- Case #2: «Михаил К.» placeholder с инициалами «МК»
- Case #3: «Ваш кейс?» card с 2 CTA (TG primary + email secondary)

**Disclaimer под Case #1:**
«Отзыв снят, когда Сократ AI работал как Telegram-бот. С 2025 платформа переехала на sokratai.ru.»

**Acceptance criteria:**
- [ ] 2 founder cards equal-width desktop, stack mobile
- [ ] Founder quote styled as blockquote с border-left socrat-green-200
- [ ] Case #1 video-placeholder aspect-ratio 3:4 portrait (portrait video mobile-shot)
- [ ] Case #3 «Ваш кейс?» с 2 CTA: TG → `https://t.me/Analyst_Vladimir`, email → `mailto:volodyakamchatkin@gmail.com`
- [ ] Когда MP4 доступен в `public/marketing/tutor-landing/testimonial-client-egor.mp4` — `<video>` автоматически заменяет placeholder (conditional render)

**Code review:**
- Placeholder-логика elegantly handles missing video/photo (no broken icons)
- Disclaimer small-print но readable (11px, fg3)

---

### Task 10 — FAQ + Pricing sections

**Scope:** FAQ accordion + Pricing table с 5 tier cards + ROI box.

**Files:**
- `src/components/sections/tutor/FAQ.tsx` (NEW)
- `src/components/sections/tutor/Pricing.tsx` (NEW)

**Content source:** `copy-deck.md` §«Section 8 + 9»

**FAQ:**
- 5 Q/A items через **native `<details>`/`<summary>`** (не Radix Accordion — native лучше для A11y + no-JS fallback)
- Custom chevron rotation с CSS `transform: rotate(90deg)` на `[open]`
- Max-width 800 px

**Pricing:**
- 5 tier cards: БЕСПЛАТНО · AI-СТАРТ (highlighted) · AI-ПЛЮС · AI-ПРО · AI-КОМАНДА
- Grid: 5 col desktop (1200 max), 2 col при < 1200, 1 col при < 640
- TRIAL (AI-СТАРТ) highlighted: border-2 socrat-green-700, scale(1.02), popular chip
- **Psychology triggers (уже в preview):**
  - Strikethrough «1 000 ₽/мес» + inline ochre chip «−80%» above big price
  - Price «200 ₽» в ochre color (socrat-ochre-700)
  - «Экономия 800 ₽ первый месяц» bold ochre под price
  - Per-day captions на tier 3/4/5 («≈ 33/67/100 ₽ в день»)
- ROI box под таблицей: `--sokrat-green-50` container, title «ОКУПАЕМОСТЬ ПЕРВОЙ НЕДЕЛЕЙ», 3 ✓-lines с bold цифрами («1,5–2 тысячи рублей», «4,5–6 тысяч в месяц», «первой неделей»)

**Acceptance criteria:**
- [ ] FAQ работает без JS (native `<details>`)
- [ ] Chevron rotation smooth 200 ms
- [ ] Pricing grid responsive по 3 breakpoints (5/2/1 col)
- [ ] TRIAL highlighted visually distinct
- [ ] TRIAL discount chip видим **сразу** у price — не ниже features
- [ ] ROI box имеет socrat-green-50 bg + subtle shadow, max-width 800 px
- [ ] ROI numbers точные: 1,5–2K / 4,5–6K / первой неделей

**Code review:**
- FAQ `id="faq"` для scroll-anchor
- Pricing `id="pricing"` для scroll-anchor
- Social-proof `id="social-proof"` — убедиться в task 9 (проверить cross-section)
- Никаких fake «cтарой цены» кроме TRIAL (math-honest case)

---

### Task 11 — FinalCTA + Footer

**Scope:** финальная conversion-секция + footer с 3 колонками + payment badges + social icons.

**Files:**
- `src/components/sections/tutor/FinalCTA.tsx` (NEW)
- `src/components/sections/tutor/Footer.tsx` (NEW)

**Content source:** `copy-deck.md` §«Section 10 + 11»

**FinalCTA:**
- BG: `--sokrat-gradient-hero-soft`
- H2 white: «Готовы перестать проверять до полуночи?»
- Lede white with 90% opacity
- 2 CTA: primary «Попробовать за 200 ₽» (white bg → green-800 text) + secondary «Канал Егора →» (ghost dark)
- Center-aligned, max-width 720 px

**Footer:**
- BG: `--sokrat-green-900` (#0f4432) dark
- Top row: Logo + social icons (Telegram icon → `https://t.me/sokrat_rep`)
- 3 columns:
  - Продукт: Для репетиторов / Для учеников и родителей / Цены / Помощь
  - Компания: О Сократ AI / Блог / Канал Егора (@sokrat_rep) / Написать Владимиру в Telegram / Написать Владимиру на email / Поддержка
  - Правовая информация: Политика конфиденциальности / Пользовательское соглашение / Оферта
- Divider hairline (white 10% opacity)
- Payment badges row: МИР / Visa / Mastercard / СБП / ЮMoney (grayscale на dark)
- Copyright: «© 2026 Сократ AI. Все права защищены.»

**Legal links (обновлено 2026-04-24):**

Документы (Политика / Соглашение / Оферта) появятся **после launch V1** — юрист адаптирует существующие студенческие drafts для репетиторского контекста. До этого:

- Все 3 link-а в footer ведут на `mailto:volodyakamchatkin@gmail.com` с subject-prefill через URL parameters:

```tsx
<a href="mailto:volodyakamchatkin@gmail.com?subject=Политика%20конфиденциальности%20—%20вопрос">
  Политика конфиденциальности
</a>
<a href="mailto:volodyakamchatkin@gmail.com?subject=Пользовательское%20соглашение%20—%20вопрос">
  Пользовательское соглашение
</a>
<a href="mailto:volodyakamchatkin@gmail.com?subject=Оферта%20—%20вопрос">
  Оферта
</a>
```

Это **temporary fallback**. Когда документы готовы — ссылки меняются на `/privacy`, `/terms`, `/offer` через single-file edit `Footer.tsx`.

**Важно для compliance:** если V1 launch включает активную оплату (кнопка «Попробовать за 200 ₽» ведёт на реальный checkout) — Оферта **обязательна до первого рубля** (см. `progress-tracker.md` compliance-workstream). Если «Попробовать» ведёт только на регистрацию/waiting list без payment — можно отложить legal docs до first paying user.

**Acceptance criteria:**
- [ ] FinalCTA h2 white, readable contrast
- [ ] Footer 3 колонки equal width desktop, stack mobile
- [ ] Все URL из Appendix D copy-deck wired корректно
- [ ] Payment badges — text chips на dark bg (не licensed logos — risk)
- [ ] Copyright в конце footer

**Code review:**
- Социальные иконки имеют `aria-label`
- Все external links — `target="_blank" rel="noopener"`
- Нет hard-coded `#1B6B4A` — use `bg-socrat-green-900` (Tailwind + config) или `var(--sokrat-green-900)` inline

---

### Task 12 — Meta, OG, analytics, smoke test

**Scope:** финальная интеграция — meta tags, canonical, OG image, analytics events, smoke tests.

**Files:**
- `index.html` — add dynamic meta title/description switching (или use react-helmet-async если уже installed)
- `src/pages/Index.tsx` — добавить Helmet meta block
- `src/pages/StudentLanding.tsx` — аналогично
- `src/lib/telemetry.ts` (if exists) — добавить events

**Meta для TutorLanding:**
- Title: «Сократ AI для репетиторов · Проверка ДЗ за 40 минут + сократовский AI-чат для учеников»
- Description: «AI-проверка рукописных ДЗ по физике, математике, информатике. Сократовский диалог с учеником — не списывает у ChatGPT. Оплаты и расписание — бесплатно. От 200 ₽ в первый месяц.»
- OG image: **reuse existing** `https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/c99bddc8-b1d7-407d-b578-ed6c55dd9e30/id-preview-7731bc3f--5fbe4a32-1baf-47b0-8f47-83e3060cf929.lovable.app-1777019278659.png` (текущий OG из student landing — согласовано 2026-04-24 «пока как сейчас работает», кастомная tutor-specific OG в V2 roadmap)
- Canonical: `https://sokratai.ru/`

**Meta для StudentLanding:**
- Keep existing title/description (но canonical теперь `https://sokratai.ru/students`)

**Analytics events (Yandex Metrika уже в проекте — см. index.html):**
```ts
window.ym?.(105827612, "reachGoal", "tutor_landing_cta_hero");
window.ym?.(105827612, "reachGoal", "tutor_landing_cta_pricing");
window.ym?.(105827612, "reachGoal", "tutor_landing_cta_final");
window.ym?.(105827612, "reachGoal", "tutor_landing_tg_channel_click");
```

**Smoke tests:**
- `npm run smoke-check` должен pass (из `20-commands-and-validation.md`)
- Отдельные checks:
  - `/` возвращает `<html>` с H1 «Инструмент репетитора»
  - `/students` возвращает H1 из старого Index
  - `/tutors` redirects to `/`

**Acceptance criteria:**
- [ ] Meta tags корректно подтягиваются для обеих страниц (View Source проверка)
- [ ] Canonical URL правильный на каждой странице
- [ ] Yandex Metrika tracking events работают (test в browser console)
- [ ] `npm run build` + `npm run smoke-check` pass
- [ ] Lighthouse: Performance > 85, A11y > 95, SEO > 95

**Code review:**
- React-helmet-async (or native document.title setters) не конфликтует между routes
- Analytics events PII-free (не трекать email/phone/name)
- OG image 1200×630 поствляется отдельно (deferred — может быть static placeholder пока)

---

### Task 13 — Audience routing UX polish (added 2026-04-25)

**Scope:** добавлен post-hoc на основе Vladimir review после tasks 1–8. Wrong-audience bounce risk: школьники/родители на `/` за 3 сек scan могут не заметить audience-switch в header → уходят с лендинга.

**Files:**
- `src/components/sections/tutor/AudienceRibbon.tsx` (NEW) — non-dismissible ribbon над header, bg `--sokrat-green-50`, «Вы ученик или родитель? → Перейти на страницу для школьников» → `/students`.
- `src/pages/Index.tsx` — mount `<AudienceRibbon />` eager выше `<TutorLandingHeader />`.
- `src/components/sections/tutor/Hero.tsx` — pre-H1 pill-badge «● Для репетиторов физики · математики · информатики» (green-100 bg, green-800 text, 11px uppercase tracking 0.08em).

**3-layer audience-routing guard:**
1. AudienceRibbon (Pattern 1: LinkedIn Pro ↔ Personal) — top of page.
2. Hero pre-H1 badge (Pattern 4: Linear / Stripe / Notion) — confirms audience.
3. Header «Для учеников →» (existing) — sticky fallback.

**Не scope creep — visually reinforces tutor primary focus**, не добавляет student-targeted content. IA «11 content sections + header + footer» нестрого нарушена (ribbon — 12-й chrome element), зафиксировано.

**Acceptance:**
- [x] AC-20: Ribbon visible над header с link на `/students`.
- [x] AC-21: Hero pre-H1 pill-badge visible, green-100 bg.
- [x] AC-22: Mobile responsive — flex-wrap на 375 px.
- [x] AC-23: Header audience-switch не изменён (3-й layer sticky).

---

## 3. Deploy flow (GitHub → Lovable)

### 3.1 Branch strategy (updated 2026-04-24 — Lovable preview NOT available)

- Все tasks делаются на **одной feature branch** `feature/tutor-landing-v1`
- Claude Code commits после каждой task с message `feat(tutor-landing): task N — <description>`
- **Ни один commit не merged в main без manual review Владимира** — Lovable preview URLs для non-main branches **не настроены** (подтверждено 2026-04-24)
- **Review protocol:** Claude Code после task 12:
  1. Runs `npm run build && npm run preview` локально
  2. Takes screenshots всех 11 content-секций на desktop 1440×900 + mobile 390×844 (Chrome DevTools)
  3. Публикует screenshots в PR description
  4. **Ждёт explicit approval Владимира** перед merge

### 3.2 Merge protocol

- **Только** после Владимир approve screenshots и общий plan → merge в main
- Lovable auto-syncs main → production deploy (~5-10 минут)
- **НЕ merge'ить speculative** — это main branch = live sokratai.ru, breaking change ломает student + tutor flow одновременно

### 3.3 Rollback plan

- Если V1 breaks после production-deploy — `git revert <merge-commit>` на main, push, Lovable auto-redeploys previous state (~5-10 min recovery)
- Routing changes (`/` swap) — полностью reversible через single `src/App.tsx` edit
- Task 1 rename (Index → StudentLanding) — reversible через `git mv` reverse
- **No DB migrations** — zero schema risk, zero data loss scenarios

---

## 4. V1 acceptance criteria (all tasks combined)

- [ ] `sokratai.ru/` отображает tutor landing (все 11 content secций + header + footer)
- [ ] `sokratai.ru/students` отображает старый student landing (unchanged functionality)
- [ ] `sokratai.ru/tutors` redirects to `/`
- [ ] Все copy verbatim из `copy-deck.md` v5
- [ ] Header с logo `sokrat-logo.png` + scroll-anchor nav (Главная · Возможности · Цены · Кейсы · FAQ) + audience switcher + Login dropdown
- [ ] Pricing psychology working: strikethrough TRIAL + ochre chip «−80%» + «Экономия 800 ₽» + per-day captions
- [ ] ROI box: 1,5–2K / 4,5–6K / первой неделей
- [ ] FAQ accordion native `<details>`, работает без JS
- [ ] Mobile responsive на 360/640/768/1024 viewports
- [ ] A11y: keyboard nav working, focus rings visible, Lighthouse A11y > 95
- [ ] SEO: canonical URLs, meta tags, OG tags на каждой странице
- [ ] Analytics events wired (Yandex Metrika)
- [ ] All URLs работают: `t.me/sokrat_rep`, `t.me/Analyst_Vladimir`, `mailto:volodyakamchatkin@gmail.com`
- [ ] Legal footer links — 3 mailto fallbacks с pre-filled subjects
- [ ] Founder-ВК placeholder с initials «ВК» (Vladimir загружает real photo отдельно, replace после launch)
- [ ] Founder-Егор photo — с Stepik course page (если hi-res есть) или initials «ЕБ»
- [ ] Video testimonial Case #1 — placeholder до получения MP4 от Егора
- [ ] Все существующие flows (login, chat, homework, tutor product) работают
- [ ] Zero new lint/build warnings
- [ ] **Владимир approved локальный build** через screenshots (preview-URL не доступен, см. §3.1)

---

## 5. Out-of-scope V1 (V2 roadmap)

**Deferred features** (перечислены в `progress-tracker.md` V2 roadmap):

- Annual/monthly toggle
- Рассрочка («Долями», Яндекс Сплит, Тинькофф)
- Real video-file в Case #1 (ждём Егора)
- Real photos founders
- Real OG image design (1200×630)
- Price-increase + «Цена запуска» strikethrough на GROWING/SCALING/ENTERPRISE (pending Vladimir decision)
- Social proof counter когда будут данные
- 152-ФЗ compliance badge после РКН registration
- Оферта, Политика, Соглашение documents (создаются с юристом параллельно)
- Support support URL (сейчас linked на `@sokrat_rep`)

---

## 6. Testing protocol

**Manual QA pass (Владимир perform после task 12):**
- Desktop Chrome / Firefox / Safari (macOS): все секции рендерятся, все ссылки работают
- Mobile Safari iOS (iPhone): responsive, touch targets ≥ 44px, no horizontal scroll
- Mobile Chrome Android: responsive
- Lighthouse audit (`npm run build` + serve, или Lovable preview URL)
- Keyboard nav: Tab через весь лендинг — focus order логичный, skip-link если есть
- Screen reader (NVDA/VoiceOver): H-структура правильная (один H1), aria-labels

**Automated checks:**
- `npm run lint` — zero new warnings
- `npm run build` — success
- `npm run smoke-check` — pass

---

## 7. Handoff to Claude Code

### 7.1 Invocation prompt для Claude Code

Это текст, который Владимир дает Claude Code как starting instruction:

```
Read docs/delivery/features/tutor-landing/implementation-spec.md. 
Create a task list from the 12 tasks in §2. 
For each task, generate a detailed implementation prompt that includes:
1. Exact file paths to create/modify
2. Copy from copy-deck.md verbatim (no rewording)
3. Styling using --sokrat-* CSS variables from src/styles/colors_and_type.css (NO hex values)
4. shadcn primitives where appropriate
5. Acceptance criteria from the task
6. Code review checklist from the task

Execute tasks 1-12 sequentially on branch feature/tutor-landing-v1.
After each task, run `npm run lint && npm run build` and self-review against the task's code review checklist.
Commit each task as `feat(tutor-landing): task N — <description>`.
When all 12 tasks complete, create a PR to main.
```

### 7.2 Files Claude Code должен прочитать ДО старта:

1. `docs/delivery/features/tutor-landing/implementation-spec.md` (этот файл)
2. `docs/delivery/features/tutor-landing/copy-deck.md` v5 (source-of-truth для текста)
3. `docs/delivery/features/tutor-landing/preview.html` (visual reference)
4. `SKILL.md` (design system rules)
5. `src/styles/colors_and_type.css` (tokens)
6. `CLAUDE.md` (project conventions)
7. `.claude/rules/10-safe-change-policy.md` (high-risk files list)
8. `.claude/rules/90-design-system.md` (tactical design rules)
9. `.claude/rules/performance.md` (React.memo, lazy loading rules)
10. `.claude/rules/80-cross-browser.md` (Safari/iOS gotchas)

### 7.3 Что Claude Code НЕ должен делать

- ❌ Менять design system files (`colors_and_type.css`, `SKILL.md`)
- ❌ Трогать high-risk files (AuthGuard, TutorGuard, Chat.tsx, TutorSchedule.tsx, telegram-bot)
- ❌ Редактировать текст в `copy-deck.md` — копируем verbatim
- ❌ Использовать `framer-motion` (удалён из проекта, см. performance.md)
- ❌ Добавлять inline `#` hex values — только CSS variables
- ❌ Создавать дубликаты student sections — reuse через rename only

---

## 8. Timeline estimate

**Claude Code execution:** ~4-6 hours сплошным timing (12 tasks × 20-30 min каждая)

**Владимир review:** ~1-2 hours для QA pass + PR review + merge

**Lovable deploy:** автоматический, ~5-10 минут после merge

**Total to live on sokratai.ru/:** 1 день работы + 1 день QA/deploy

---

## 9. Changelog

- **2026-04-24** — initial spec created после согласования с Владимиром routing/header/pipeline decisions
- **2026-04-24** — finalized (v1.1) с 4 post-spec decisions:
  - No Lovable preview URL для non-main → review через local build + screenshots до merge (safety-critical)
  - OG image — reuse existing student-landing Lovable URL в V1, custom tutor OG в V2
  - Legal docs (Политика/Соглашение/Оферта) появятся после launch V1; до того — mailto fallback на `volodyakamchatkin@gmail.com` с pre-filled subjects
  - Vladimir фото загружает отдельно после launch; Claude Code использует initials «ВК» placeholder в V1
