---
name: sokratai-design
description: Use this skill for any UI work on Сократ AI (sokratai.ru) — Russian Socratic-method AI tutor for ОГЭ/ЕГЭ prep. Covers tutor workplace (desktop), student learning app (mobile), and parent read-only overlay. Brand: deep green #1B6B4A + ochre #E8913A, Golos Text, KaTeX math. Use before making any design decision so all three modes stay coherent.
user-invocable: true
---

# Сократ AI — Design System (cross-kit handoff)

This is the system-level entry point. Read it once, then route to the kit-specific
README you need. Do **not** redesign foundations, tutor kit, or student kit based on
this file — it documents what exists, enforces how the pieces fit, and defines how
new work extends the system without drifting.

Heavy detail lives in:
- `README.md` (top-level) — folder map, quick-start, completion status
- `colors_and_type.css` — tokens, fonts, mode rules, exam-stream rules
- `ui_kits/tutor/README.md` — tutor workplace kit
- `ui_kits/student/README.md` — student learning kit + parent overlay rules

---

## 1. System purpose

Сократ AI (sokratai.ru) is a Russian-language Socratic tutor for 9th- and 11th-grade
students preparing for the **ОГЭ** and **ЕГЭ** state exams — math, physics, informatics.

The core product promise: the AI does **not** hand over answers. It asks leading
questions so the student arrives at the solution themselves. This promise shapes every
UI decision in this system — from the absence of a "show correct answer" state to the
gamification boundaries that never use completion as a substitute for understanding.

## 2. Product truth

- **Tutor is the primary operator.** The business model is tutor-led. Build tutor-first.
- **Student is the learner.** Student surfaces host the Socratic loop — they are a
  classroom, not a game.
- **Parent is an observer.** Parent is a read-only lens on student surfaces, not its own
  product. If a parent-only workflow ever needs a dedicated surface, that is a separate
  design pass, not a reuse of student chrome.
- **Russian-language only** in product UI. Docs (this file, README.md, CLAUDE.md) are
  English. In-product copy is Russian.
- **Exam-stream aware.** ЕГЭ (green family) and ОГЭ (indigo `#5B5FC7`) are distinct
  streams with their own chip colors, folder covers, and filter semantics.
- **Math-and-physics heavy.** Every surface may render formulas. Math containers are
  non-optional.

## 3. Mode contract

Every surface wraps in:

```html
<div class="sokrat" data-sokrat-mode="…"> … </div>
```

One of `tutor`, `student`, `parent`. The wrapper is **mandatory** — surfaces without it
are not valid Сократ AI UI.

| Axis | tutor | student | parent (overlay) |
|---|---|---|---|
| Primary device | desktop 13–16″ | mobile 390 | inherits student |
| Density | **compact → comfortable** (never roomy) | **comfortable → roomy** (never compact) | inherits student |
| Body size | 14–15 px | 16–17 px | inherits student |
| Hit target min | 36 px | 44 px (52 for primary learning CTAs) | inherits student |
| Gamification | off | on | hidden via `[data-parent-hide]` |
| Streak / XP / milestone motion | off | on | off |
| Learning CTAs | full | full | **inert** (`pointer-events:none`, 0.5 opacity) |
| Allowed parent CTAs | n/a | n/a | **contact tutor, pay invoice, message** remain active |
| Socratic encouragement tone | n/a | full | flattened to neutral |
| Math container | `FormulaBlock` 18 / 1.8 | `SFormulaBlock` 20 / 1.7 | inherits student |
| Primary CTA per screen | action-verb, one | learning verb, exactly one | none meaningful |
| Ochre usage | never | streak / XP / daily-goal / milestone only | hidden (gamification) |
| Green-tinted shadow | yes | yes | yes |

**Parent mode is not a global lockout.** It disables *learning actions* (Проверить,
Открыть подсказку, Следующая задача, etc. — everything carrying `data-learning-cta`)
and hides *gamification* (`[data-parent-hide]`). Contact-tutor, pay-invoice, and
message-tutor controls remain fully interactive in parent mode — these are the
legitimate parent actions.

## 4. Foundations (frozen)

Single source of truth: `colors_and_type.css` at project root.

- **Tokens**: `--sokrat-*` CSS variables (brand green, ochre, exam-stream, neutrals,
  state colors, spacing, radii, shadows, hit targets, durations).
- **Fonts**: Golos Text (400/500/600/700/800/900) served from local `fonts/` — the
  system sans for all display, body, and UI. Math uses KaTeX and its own rendering
  stack. No other webfont families are loaded.
- **Mode rules**: `.sokrat[data-sokrat-mode="…"]` selectors that fold density,
  typography, gamification visibility, and motion into the wrapper.
- **Exam-stream rules**: `.sokrat-stream-ege`, `.sokrat-stream-oge` chip/tint
  classes.
- **Assets**: `assets/sokrat-logo.png`, `assets/sokrat-chat-icon.png`,
  `assets/sokrat-hw-banner.png`.

**Do not reopen.** If a token is missing, extend `colors_and_type.css` — never shadow
it in a kit file, never inline a new hex value in a component.

## 5. Token hierarchy

Precedence, top wins:

1. **Pass-1 CSS variables** (`--sokrat-*`) — source of truth.
2. **Kit helper classes** in `ui_kits/*/tokens.css` — consume the variables, never
   redeclare them.
3. **Component-level inline styles** — only for one-off composition that a helper class
   cannot express cleanly.
4. **Never**: new hex values, new font stacks, new ad-hoc gradients, new shadow recipes
   outside foundations.

## 6. Component-family map

### Tutor workplace (`ui_kits/tutor/`)

| File | Exports |
|---|---|
| `tokens.css` | Helper classes layered over foundations (density, chrome, rows, drawers). |
| `primitives.jsx` | Button, Input, Chip, StatusDot, Avatar, Tabs, Segment, Tooltip, KbdHint, Progress, Difficulty, Icon, InlineMath / FormulaBlock, AnswerInput, EmptyState. |
| `chrome.jsx` | AppFrame, SideNav, TopBar, PageHeader, Toolbar, BulkActionBar. |
| `workplace.jsx` | RosterTable, StudentRow, StudentCard, HomeworkListRow, HomeworkSetCard, TaskCard, TaskBankRow, SubmissionRow, SubmissionReview, AICheckBlock, SessionBlock, WeekGrid, PaymentRow, GroupPanel. |
| `templates.jsx` | Dashboard, HomeworkList, HomeworkDetail, StudentProfile, TaskBank (+ stubs). |
| `index.html` | Master preview, routed via SideNav. |

### Student learning (`ui_kits/student/`)

| File | Exports |
|---|---|
| `tokens.css` | Mobile helpers: phone frame, app-shell, bottom-nav, buttons, cards, chips, streak, ring, mastery, roadmap, hints, steps, formulas, graph, answer inputs, MCQ, upload, AI feedback, chat, rows, section, comeback, sheet, parent overlay. |
| `primitives.jsx` | SIcon, SButton, SChip, StreakBadge, StreakCard, DailyGoal, Mastery, SProgress, SInlineMath, SFormulaBlock, SAnswerInput, MCQ, HintLadder, StepBlock, AIFeedback. |
| `chrome.jsx` | PhoneFrame (preview), AppShell, TopHeader, BottomNav, Section, BottomSheet, ParentBanner. |
| `learning.jsx` | ProgressCard, ChallengeCard, MilestoneCard, ExamRoadmap, GraphBlock, ImageUpload, ComebackCard, HomeworkRow, PracticeTopicRow. |
| `templates.jsx` | Home, Homework, Practice, Problem, Chat, Progress. |
| `index.html` | Phone-framed preview with route switcher + Ученик/Родитель toggle. |

### Parent
No kit. Render student kit under `data-sokrat-mode="parent"`. The ParentBanner
component is the one piece unique to parent mode; everything else is the student tree
with suppressed interactions.

### Legacy previews (older passes)
- `preview/` — token-level cards (colors, type, radii, shadows, buttons, chips, forms).
- `ui_kits/website/` — **legacy** pre-foundations landing-page sketch of sokratai.ru.
- `ui_kits/app/` — **legacy** pre-foundations chat-centric student sketch, superseded
  by `ui_kits/student/`.

> **Legacy kits are non-canonical.** `ui_kits/website/` and `ui_kits/app/` predate
> `colors_and_type.css` and contain inline hex values (`#1B6B4A`, `#E8913A`, etc.).
> They are reference-only for brand feel. **Do not copy their components, class
> names, or inline styles into new canonical work.** All new surfaces must use the
> tutor or student kit under the mode contract.

## 7. Template map

| Surface | Kit | Template |
|---|---|---|
| Tutor dashboard | tutor | `TplDashboard` |
| Tutor homework list | tutor | `TplHomeworkList` |
| Tutor homework detail (review) | tutor | `TplHomeworkDetail` |
| Tutor student profile | tutor | `TplStudentProfile` |
| Tutor task bank | tutor | `TplTaskBank` |
| Student home | student | `TplHome` |
| Student homework inbox | student | `TplHomework` |
| Student practice | student | `TplPractice` |
| Student problem-solving | student | `TplProblem` |
| Student AI chat | student | `TplChat` |
| Student progress | student | `TplProgress` |
| Parent progress view | student + parent mode | reuses `TplProgress` + `TplHomework` under `data-sokrat-mode="parent"` |
| Admin / super-admin | — | **future pass** |

## 8. Anti-drift rules (the ten laws)

1. **One source of truth.** `colors_and_type.css` owns every token. Do not shadow or fork.
2. **Mode wrapper mandatory.** No surface renders without `data-sokrat-mode`.
3. **Gamification is student-only.** Ochre is celebration-only — never chrome, never CTA.
4. **Brand green ≠ success.** State colors come from `--sokrat-state-*`, not `--sokrat-green-*`.
5. **Parent is an overlay, not a kit.** Same tree, fewer active surfaces. Learning
   actions inert; parent actions (contact, pay, message) remain active.
6. **No ready-answer state.** Wrong → Socratic hint or question. The UI never reveals
   the solution on its own.
7. **Math never in sans.** Only `FormulaBlock` / `SFormulaBlock` / `InlineMath` render math.
8. **Hit targets.** 36 px min on tutor desktop, 44 px min on student mobile, 52 px for
   primary student learning CTAs.
9. **No density bleed.** Tutor's 32-px rows and 13-px body never appear on student
   mobile. Student's 52-px CTAs never appear on tutor chrome.
10. **No cards inside cards.** Use `inset`, `rowgroup`, or `Section` primitives.

## 9. Extending the system

Before shipping any new component, pattern, or token, answer this checklist:

- [ ] Does an existing primitive cover 80% of the need? If yes → **refine**, do not add.
- [ ] Which mode owns this? (tutor / student / shared) — place accordingly.
- [ ] Does it obey the mode contract (§3) in **all three** modes? Verify parent too.
- [ ] Does it introduce a new color, font, shadow, radius, or hit-target?
      → **Stop**. Extend `colors_and_type.css` first, then use the token.
- [ ] Does it break any of the ten anti-drift rules (§8)? → Redesign before coding.
- [ ] Is parent-mode behavior documented? (gamification hidden, learning CTAs inert,
      motion off, parent actions allowed.)
- [ ] Does it keep hit targets in the right bucket for its mode?
- [ ] Does math go through the correct container?
- [ ] Is the Russian copy verbatim and reviewed, or draft? Flag drafts.

If any item fails, the component is not ready. Fix before merging.

## 10. Implementation handoff

For developers and Claude Code instances:

- **Preserve the include order.** `colors_and_type.css` first, then kit `tokens.css`,
  then kit JSX files in the order listed in the kit README.
- **Preserve the mode wrapper.** `<div class="sokrat" data-sokrat-mode="…">` on every
  page-level surface. This is not stylistic — the foundations CSS keys off it.
- **Copy kit files verbatim.** Do not port them to a different styling system (Tailwind,
  MUI, styled-components) in a one-shot rewrite. Tailwind already underlies the
  codebase; the `sokrat-*` tokens already map into it.
- **Use CSS variables, not copied hex values.** `var(--sokrat-green-600)`, not
  `#1B6B4A`.
- **Russian copy is canonical.** Do not rewrite copy for clarity without the
  founder's sign-off — tone is part of the brand.
- **Math goes through KaTeX + the FormulaBlock wrapper.** Never render raw LaTeX into
  sans-body text.
- **Assets are PNGs.** `sokrat-logo.png` and `sokrat-chat-icon.png` are bitmap by
  design — do not redraw as SVG.

### Claude Code handoff (repo integration)

When porting this system into the Vite + React + Tailwind + shadcn app
(`github.com/Vladimir03/sokratai`):

- **Copy into the app:** `colors_and_type.css`, `fonts/` (all six Golos Text weights),
  and `assets/` (logos, chat icon, banner). Place `colors_and_type.css` alongside
  the app's `src/index.css` and import it before the Tailwind layers.
- **Reference-only, do not drop in:** `ui_kits/tutor/*.jsx` and `ui_kits/student/*.jsx`
  are **design references**, not a runtime component library. Re-implement the
  components in the app's existing conventions (shadcn primitives + Tailwind classes
  consuming the `--sokrat-*` tokens). Keep names and prop shapes parallel so the
  design reference stays readable.
- **Token mapping.** Map `--sokrat-*` variables into the application styling layer:
  - `--sokrat-green-700` → `--primary` / `socrat.primary`
  - `--sokrat-ochre-500` → `--accent` / `socrat.accent`
  - `--sokrat-fg1/2/3` → `--foreground` scale
  - `--sokrat-surface` / `--sokrat-card` → `--background` / `--card`
  - `--sokrat-state-*` → `--success` / `--warning` / `--destructive` / `--info`
  - `--sokrat-border*` → `--border`, `--input`
  - Integration template: the imported repo's `src/index.css` and
    `tailwind.config.ts` under `src/` in this project show the existing HSL/CSS-var
    wiring — follow that pattern, overriding only the values that drifted (see the
    palette caveat in the root README).
- **Mode wrapper in app code.** Wrap each route under the correct mode — tutor
  routes under `data-sokrat-mode="tutor"`, student routes under
  `data-sokrat-mode="student"`, the parent progress view under
  `data-sokrat-mode="parent"`. Parent enforcement (learning-CTA inertness,
  gamification hiding) is handled entirely by foundations CSS — no parent-specific
  component branches needed.

## 11. Pre-flight checks (must-pass before PR)

Literal checklist to run on every new surface:

- [ ] Wrapped in `.sokrat[data-sokrat-mode="tutor|student|parent"]`.
- [ ] Loads `colors_and_type.css` before any kit CSS.
- [ ] No hex values outside foundations.
- [ ] No new font families.
- [ ] Hit targets meet the mode minimum.
- [ ] Exactly one primary CTA per screen (where applicable). Ghost / icon-only /
      secondary actions sitting next to the primary do **not** count as competing
      primaries.
- [ ] Parent mode: learning CTAs inert, gamification hidden, parent actions active.
- [ ] Math rendered through KaTeX inside a `FormulaBlock` / `SFormulaBlock` /
      `InlineMath` / `SInlineMath`.
- [ ] No ochre outside celebration/streak/XP/milestone contexts.
- [ ] No "show the answer" state in student surfaces.
- [ ] Russian copy uses «ты» to students, «вы» to tutors and parents.
- [ ] Tabular-lining numerals on any number that can change.

---

**North stars (non-negotiable):**
- Warm, judgement-free tone. Patient tutor, not a cool AI product.
- Never a direct answer when a hint would teach more.
- Deep-green primary + ochre CTA/celebration. Never swap the hierarchy.
- Cyrillic first in all product copy.
- No bluish-purple gradients, no AI-slop "shiny" aesthetics. Earthy, book-ish, human.
