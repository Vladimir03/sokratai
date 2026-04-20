# Сократ AI — Design System

> **Index:** This README • `SKILL.md` • `CLAUDE.md` • `colors_and_type.css` • `fonts/` • `assets/` • `preview/` (token cards) • `ui_kits/tutor/` (desktop workplace) • `ui_kits/student/` (mobile learning app + parent overlay) • `ui_kits/website/` (legacy landing) • `ui_kits/app/` (legacy chat sketch)

---

## START HERE

- **Claude / agent handoff:** read `SKILL.md`. It defines system purpose, the
  tutor / student / parent mode contract, token hierarchy, component-family map,
  anti-drift rules, and the pre-flight checklist.
- **Every project chat:** `CLAUDE.md` at project root pins the hard rules.
- **Designers opening this project:** the Design System tab in the asset-review pane
  surfaces the two live kit previews (tutor, student). Click through, then read each
  kit's README.
- **Developers implementing a feature:**
  1. Read `SKILL.md` (~15 min).
  2. Identify the mode you're building for (tutor / student / parent).
  3. Open the matching kit's README.
  4. If the component exists, copy verbatim. If it doesn't, run the "Extending the
     system" checklist in `SKILL.md §9` before writing new code.
  5. Wrap your surface in `<div class="sokrat" data-sokrat-mode="…">`.

## Folder map

```
sokratai-design-system/
├── README.md                 ← you are here — foundations + navigation
├── SKILL.md                  ← cross-kit handoff spec (Claude entry point)
├── CLAUDE.md                 ← one-screen pointer, pinned every chat
├── colors_and_type.css       ← foundations: tokens, fonts, mode rules, streams
├── fonts/                    Golos Text 400/500/600/700/800/900 (local)
├── assets/                   sokrat-logo.png, sokrat-chat-icon.png, sokrat-hw-banner.png
├── preview/                  token-level preview cards
├── ui_kits/
│   ├── tutor/                ✅ desktop workplace (primary operator surface)
│   │   ├── README.md   tokens.css   primitives.jsx   chrome.jsx
│   │   ├── workplace.jsx   templates.jsx   index.html (live preview)
│   ├── student/              ✅ mobile learning app + parent overlay rules
│   │   ├── README.md   tokens.css   primitives.jsx   chrome.jsx
│   │   ├── learning.jsx   templates.jsx   index.html (live preview)
│   ├── website/              (legacy — sokratai.ru marketing page sketch)
│   └── app/                  (legacy — older chat-centric student sketch)
└── src/                      read-only import from Vladimir03/sokratai
```

## Which kit for which surface

| Surface | Kit | Mode |
|---|---|---|
| Tutor dashboard, roster, grading, payments | `ui_kits/tutor/` | tutor |
| Tutor creating / reviewing homework | `ui_kits/tutor/` | tutor |
| Student home / homework / practice / problem / chat / progress | `ui_kits/student/` | student |
| Parent viewing student progress | `ui_kits/student/` | parent (read-only overlay — no dedicated kit) |
| Admin / super-admin | — | **future pass** |
| Marketing / onboarding | foundations only (see legacy `ui_kits/website/`) | — |

## Completion status

| Area | Status |
|---|---|
| Foundations (tokens, fonts, mode rules, streams) | ✅ shipped |
| Tutor kit (desktop workplace) | ✅ shipped |
| Student kit (mobile learning app) | ✅ shipped |
| Parent overlay (rules baked into mode CSS + student kit) | ✅ shipped |
| Cross-kit `SKILL.md` | ✅ shipped |
| Root `CLAUDE.md` pointer | ✅ shipped |
| Asset-review preview cards (tutor, student) | ✅ shipped |
| Dedicated parent kit | ❌ intentionally not built — re-evaluate if parent-only workflows appear |
| Admin / super-admin surfaces | ⏳ future pass |
| Illustration set for empty states | 🟡 partial |
| Real data bindings (ProgressCard, Mastery, roadmap) | ⏳ future |
| Localization layer (`t()`) | ⏳ future |
| Light-mode only, no theming | out of scope |

## Known open items (rolled up across kits)

- Illustrations for empty states (homework done, no challenges yet).
- OCR wiring on `ImageUpload` → backend helper.
- Live data bindings for student `ProgressCard` / `Mastery` / `ExamRoadmap`.
- Tutor: command palette, notifications drawer, density toggle are stubs.
- Chat virtualization on long AI threads.
- A11y pass on Socratic `AIFeedback` copy.
- Haptics / motion keyframes on streak increment, XP gain, milestone unlock.
- Tablet breakpoint on student kit (phone frame is preview-only).
- Palette canonicality caveat: tailwind declares green/ochre; `src/index.css` declares
  indigo — this DS adopts green/ochre. Confirm with Vladimir before production.

---


**Сократ AI** (sokratai.ru) is a Russian EdTech AI assistant for high-school students preparing for the **ОГЭ** (9th grade) and **ЕГЭ** (11th grade) state exams — primarily **math, physics, informatics**. The product teaches using the **Socratic method**: instead of giving the answer, it asks leading questions so the student arrives at the solution themselves.

Founded by Vladimir (ex-inDrive / T-Bank analyst), the company positions itself against "cheat-mode" generic AI (ChatGPT, etc.). Tagline pattern: *"учит тебя думать и понимать самостоятельно"*.

## Products in scope

1. **Marketing website** (`sokratai.ru`) — landing page with hero, value props, method demo, pricing tiers (FREE / PREMIUM 699₽ / PRO 1399₽), testimonials, parent section, FAQ.
2. **Student web app** (`/chat`, `/homework`, `/practice`, `/progress`, `/profile`) — primary product. Chat-centric tutor with image upload, voice input, LaTeX math rendering, streaks, streak-based gamification.
3. **Tutor web app** (`/tutor/*`) — homework constructor, student roster, mini-group payments. Strictly isolated module.
4. **Telegram bot** (`@sokratai_ru_bot`) — secondary channel for quick questions.

## Sources

- **Codebase:** `github.com/Vladimir03/sokratai` (Vite + React 18 + TS + shadcn-ui + Tailwind + Supabase). Imported files live under `src/` in this project — `tailwind.config.ts`, `src/index.css`, `src/pages/Index.tsx`, `src/pages/Chat.tsx`, `src/components/sections/*` are the main visual sources.
- **Lovable project:** `lovable.dev/projects/5fbe4a32-1baf-47b0-8f47-83e3060cf929` (build platform).
- **Brand artifacts:** `assets/sokrat-hw-banner.png` (tutor-acquisition banner, v3 — canonical brand look), `assets/sokrat-logo.png`, `assets/sokrat-chat-icon.png`.
- **Author / tone docs:** `datanewgold-author-style.md`, `datanewgold-audience.md`, `sokrat-hw-telegram-post-v2.md` (tutor pilot outreach).
- **Product docs** (not imported, referenced in codebase): `docs/discovery/product/tutor-ai-agents/14-ajtbd-product-prd-sokrat.md`, `docs/discovery/product/tutor-ai-agents/16-ux-principles-for-tutor-product-sokrat.md`, `docs/discovery/product/tutor-ai-agents/17-ui-patterns-and-component-rules-sokrat.md`.

## ⚠️ Two palettes exist in the codebase

The tailwind config declares a **green + ochre** `socrat` palette (`#1B6B4A` primary, `#E8913A` accent) that matches the **hw-banner** artifact. But `src/index.css` defines the live HSL tokens as **indigo + green** (`hsl(231 36% 29%)` primary). The marketing landing hero uses the indigo variant via `--gradient-hero`.

**This design system adopts the green/ochre direction** as the brand truth, because (a) the banner-v3 is the most recent brand artifact, (b) the deeply-named `socrat-*` tokens and the logo both lean deep green, (c) the exam-stream semantic mapping (`ege: green`, `oge: indigo`) only makes sense when primary ≠ indigo. Confirm with Vladimir before shipping prod work under a different hypothesis.

---

## CONTENT FUNDAMENTALS

**Language:** Russian (ru). All product copy, CTAs, error states, empty states.

**Pronoun / voice:** informal **«ты»** to students ("спроси", "реши сам", "попробуй"). Formal **«вы»** to tutors and parents. Never mixed — the address switches with the audience.

**Tone:** warm, energetic, "smart friend over coffee" — directly lifted from founder's personal voice in `datanewgold-author-style.md`.
- Signal words: *«погнали»*, *«давайте разберёмся»*, *«хех»*, *«оч»*, *«тк»*, *«мб»*.
- Vulnerability-through-strength: openly admits doubts as process, not complaint ("пока с переменным успехом").
- Never clickbait, never fear-mongering ("ВЫ НЕ ПОВЕРИТЕ", "красная зона" — banned).

**Sentence shape:** short paragraphs (1–3 sentences), em-dash **—** (not hyphen) for list bullets and asides. Occasional emoji-numbering **1️⃣ 2️⃣ 3️⃣**. Separator line `- - - - - -` between sections in long posts.

**Casing:** Sentence case for headings and buttons. ALL-CAPS reserved for chip labels (FREE, PREMIUM, PRO, ЕГЭ, ОГЭ). Never all-caps for sentences.

**Emoji:** sparingly, 3–5 max per post, never as word-replacements. House set: ❤️‍🔥 🔥 😁 😅 🚀 🤩 ✅ 🎉. Emoji-voting pattern ("🔥 — если да, ❤️ — если нет") is a signature move. In product UI emoji appear only in celebratory moments (streak milestone, correct answer toast).

**CTA style:** action verb + object. *"Попробовать бесплатно"*, *"Открыть в браузере"*, *"Начать"*, *"Связаться в Telegram"*. Never *"Узнать больше"* / *"Кликните здесь"*.

**Examples from product copy:**
- Hero: *«AI-помощник по школьным предметам, который учит тебя думать и понимать самостоятельно»*
- Value card: *«Никто не узнает о твоих ошибках»*
- Testimonial voice: *«Испытываю радость от общения с Сократ AI, потому что я поняла, как решать задачу сама»* — Маша, 10 класс.
- Method pitch: *«Вопросы-подсказки вместо готовых ответов»*
- Price framing: *«699₽/мес — это 23₽ в день, дешевле кофе»*.

---

## VISUAL FOUNDATIONS

### Colors
- **Primary:** deep green `#1B6B4A` (banner ring, logo, primary buttons on light surfaces, headings). Shades scale `green-50 → green-900`.
- **Accent:** warm ochre `#E8913A` (CTAs, highlights, lightbulb icon). Used **sparingly** — the banner uses it only for the light-bulb and a single chip label.
- **Exam streams:** ЕГЭ is green-family, ОГЭ is indigo `#5B5FC7`. Each has a tinted bg (`ege-bg #E8F5EE`, `oge-bg #EEEFFE`) for chips and folder covers.
- **Surface:** warm off-white `#F7F6F3` (not pure white) — page background. Cards sit on pure white `#FFFFFF`.
- **Borders:** `#E5E5E0` (standard) and `#F0EFEB` (light). Warm-grey, not cool-grey.

### Typography
- **Family:** `Golos Text` (Google Fonts) for everything — display, body, UI. Weight range 400/500/600/700.
- **Hierarchy:** display titles are `font-bold` with slight negative tracking (`-0.01em`). Body runs at 16/1.55. Russian + Latin coverage is the reason Golos was chosen over Inter.
- **Fallbacks:** `system-ui, -apple-system, sans-serif`.
- **Mono:** `'SF Mono', 'Fira Code'` — used for inline code and math fragments outside of KaTeX.

### Spacing & Layout
- **Grid:** 4px base. Container padded `2rem` (32px), max width `1400px` (`2xl` breakpoint).
- **Section rhythm:** landing sections are `py-20 px-4` (80px vertical). Cards are `p-6` mobile / `p-8–10` desktop.
- **Gutters between cards:** 24–32px.

### Corner radius
- Buttons: **12px–16px** (`rounded-md` = 14, `rounded-lg` = 16). Hero CTAs go up to `rounded-2xl` (24px).
- Cards: **16px** standard, **24px** for hero cards.
- Chips / pills: fully rounded (`9999px`).
- Inputs: `10px`.
- **Default `--radius` is `1rem` (16px)** per `src/index.css`.

### Cards
Flat white on warm-grey page. Subtle `border: 1px solid var(--sokrat-border-light)`. Shadow is light — `0 4px 20px rgba(27,107,74,0.08)` (tinted green, not neutral). On hover: lift `-2px` with stronger shadow and border shifts to `var(--sokrat-ochre-500)` (from `ValueProposition.tsx`). Key pricing cards use `shadow-2xl` (elevated hero).

### Shadows
Two registered systems:
- `shadow-elegant` — base card shadow (green-tinted, 8% alpha).
- `shadow-glow` — ochre-tinted glow on primary CTA (`rgba(232, 145, 58, 0.25)`).

No heavy drop shadows. No neomorphism.

### Backgrounds
- Page: warm off-white `#F7F6F3`.
- Alternating sections: `bg-muted/30` (very faint green tint via the muted token).
- Dark sections: **gradient hero** — `linear-gradient(135deg, #0f4432, #145236, #1B6B4A)`. The banner shows this direction clearly.
- **No stock photography**, **no hand-drawn illustrations**, **no repeating patterns** seen in product or marketing. The banner uses **subtle large-radius circle outlines** (bottom-left, top-right) at `rgba(255,255,255,0.05)` as the only decoration on dark hero.
- Soft **blurred color blobs** on hero sections (`bg-accent/10 blur-3xl` in corners) for organic depth. Very low opacity.

### Gradients
Used only on hero sections and accent CTAs. Never on cards, never on text. Green → darker green, always within the green family. Ochre gradients are subtle (ochre-500 → ochre-700).

### Borders
1px standard. 2px for emphasis (active pricing card, selected state). Dashed borders appear only in upload drop-zones.

### Animation
- **Easing:** `cubic-bezier(0.4, 0, 0.2, 1)` everywhere (declared as `--transition-smooth`). No bouncy springs.
- **Durations:** 150–320ms. Page/modal enters are 500ms.
- **Motion vocabulary:** fade-in + 10–30px upward translate (`fadeInUp`). Accordion expand/collapse is 200ms. No parallax, no scroll-jacking.
- **Hover:** opacity shift (`0.9`), or color shift to `accent`, or lift `-2px` on cards. Never scale-up.
- **Press:** no shrink. Button background deepens (`primary/90`).
- **Loading:** skeleton shimmer (`200% 100%` moving gradient, 1.5s infinite). Spinner is `Loader2` from lucide, 4–5px stroke.

### Interaction states
- Hover on button: `bg-primary/90` (10% darker).
- Hover on text link: shift color to accent.
- Hover on card: border → accent + shadow → `shadow-elegant` + `-translate-y-2`.
- Active/pressed: no scale transform. Background deepens only.
- Focus ring: 2px `hsl(var(--ring))` (green), 2px offset. Never removed.

### Transparency & blur
- Navigation bar: `bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b`.
- Hero decorative blobs: `bg-accent/10 blur-3xl opacity-30`.
- Overlay on images is rare — banner has no overlay on its dark bg.

### Imagery vibe
No photography in current product. If added: should be **warm-toned**, outdoor-daylight, students at desks, **not corporate stock**. Avoid cool blue tones. Tutor side tilts slightly more professional.

### Iconography
See `ICONOGRAPHY` section below.

---

## ICONOGRAPHY

- **Primary icon set:** **lucide-react v0.462.0** (`"lucide-react": "^0.462.0"` in `package.json`). Used across the entire product: `Send, Globe, LogIn, ChevronDown, BookOpen, GraduationCap, MessageSquare, TrendingUp, User, LogOut, Backpack, Target, ShieldCheck, Lightbulb, Heart, Camera, ImagePlus, Mic, MicOff, Loader2, X, ChevronLeft, ChevronRight`, etc.
- **Default stroke:** 1.5–2px (lucide default). Size scales: `w-4 h-4` (small, in buttons), `w-5 h-5` (inline), `w-8 h-8` (nav logo), `w-10–12 h-10–12` (section headers), `w-20–24 h-20–24` (hero logo).
- **Color:** icons inherit text color. Accent icons explicitly `text-accent` (ochre) or `text-primary` (green). Never multi-colored.
- **When this system prototypes for Сократ:** link lucide via CDN (`https://unpkg.com/lucide@latest`) rather than inlining SVGs. Matches codebase exactly.
- **Logo & chat icon:** bitmap PNGs, not SVG — `assets/sokrat-logo.png` (dark ring, two speech bubbles) and `assets/sokrat-chat-icon.png` (same, slight variant). Always use the PNG, don't redraw.
- **Emoji as icon:** only in celebration / affective moments (🎉 on correct answer, ✅ in checklists). Never as a functional icon on a button.
- **Unicode glyphs as icon:** em-dash `—` is used as a bullet replacement throughout marketing copy. Checkmark `✓` appears inline in feature lists (styled as `text-accent font-bold`) — this is a stylistic choice, not an icon substitute.
- **Custom SVG:** only the few hand-tuned illustrations in the banner (circles, subject numerals). No branded icon system beyond lucide.

---

## INDEX

Root files:
- `README.md` — this file.
- `SKILL.md` — cross-kit handoff doc (Claude entry point).
- `CLAUDE.md` — one-screen pointer, pinned every chat.
- `colors_and_type.css` — full token sheet (`--sokrat-*` vars + `.sokrat-*` helper classes).

Folders:
- `fonts/` — Golos Text local files (400/500/600/700/800/900).
- `assets/` — `sokrat-logo.png`, `sokrat-chat-icon.png`, `sokrat-hw-banner.png`.
- `preview/` — token-level preview cards.
- `ui_kits/tutor/` — ✅ desktop tutor workplace (primary operator surface).
- `ui_kits/student/` — ✅ mobile student learning app + parent overlay rules.
- `ui_kits/website/` — **legacy, non-canonical** landing-page sketch (reference only).
- `ui_kits/app/` — **legacy, non-canonical** chat-centric student sketch (superseded by `ui_kits/student/`).
- `src/` — original imported source from the repo (read-only reference).

> **Legacy kits.** `ui_kits/website/` and `ui_kits/app/` predate `colors_and_type.css`
> and may contain inline hex values. They are kept for brand-feel reference only.
> Do not copy components, class names, or inline styles from them into new work.

---

## Caveats / open questions

1. Landing-page hero in the deployed site uses **indigo** gradient (`hsl(231, 36%, 29%)`), but every other signal (logo, banner, tailwind `socrat-*` tokens) is **deep green**. Which is canonical?
2. Font `Golos Text` is loaded from Google Fonts in production; no local `.ttf/.woff2` was committed. This DS uses the Google Fonts CDN — swap to local files if offline delivery is required.
3. Tutor-side screens were not deeply recreated — codebase for `src/pages/tutor/*` and `src/components/tutor/*` exists but isn't in scope of this first pass.
