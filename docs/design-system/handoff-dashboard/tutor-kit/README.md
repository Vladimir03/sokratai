# Tutor Workplace UI Kit

Desktop-first UI kit for the tutor-facing product of Сократ AI. Builds on the brand
tokens in `../../colors_and_type.css` with `data-sokrat-mode="tutor"` — no new tokens
introduced here, only helper classes and React components.

## What this kit is for

One surface: a private **tutor workplace**, used 30+ minutes at a time, usually on a
13–16" laptop. Key properties:

- **Dense but legible.** 14 px body, 36–40 px hit targets, tabular-nums on every number.
- **Data-first.** Tables, list rows and stat strips outnumber cards. Cards only for
  primary entities (a student profile header, a task card with math, a submission).
- **Quiet chrome.** The rail and top bar stay out of the way. Green is the ONLY
  accent — no ochre, no gradients, no decorative surfaces.
- **Mathematically honest.** KaTeX for any rendered formula; tabular-nums + the math
  font for any answer, tolerance or unit; never sans for inline math.

The student and parent products use different shells — do **not** copy chrome from this
kit into those surfaces. Tokens stay shared; density and temperature do not.

## Files

| File | Role |
|---|---|
| `tokens.css` | Helper classes for this kit only. Layered on top of `colors_and_type.css`. No new CSS variables. |
| `primitives.jsx` | Button, Input, Chip, StatusDot, Avatar, Tabs, Segment, Tooltip, KbdHint, Progress, Difficulty, Icon (Lucide), InlineMath / FormulaBlock (KaTeX), AnswerInput, EmptyState. |
| `chrome.jsx` | AppFrame, SideNav, TopBar, PageHeader, Toolbar, BulkActionBar. Shell elements. |
| `workplace.jsx` | Entity components: RosterTable, StudentRow, StudentCard, HomeworkListRow, HomeworkSetCard, TaskCard, TaskBankRow, SubmissionRow, SubmissionReview, AICheckBlock, SessionBlock, WeekGrid, PaymentRow, GroupPanel. |
| `templates.jsx` | Five full page templates composed from the above. |
| `index.html` | Master preview. Mounts the full shell and routes across templates via the SideNav. |

Load order is `tokens.css` after `colors_and_type.css`, then the JSX files in the same
order as the table above (each later file consumes components exported to `window` by
earlier files).

## Mode contract

Every surface in this kit is wrapped in

```html
<body class="sokrat" data-sokrat-mode="tutor">
```

`data-sokrat-mode="tutor"` flips `colors_and_type.css` to the tutor density profile —
14 px body, 36/40 px hit defaults, compact typography scale, sticky table headers.
Drop the attribute and the CSS falls back to the student shell.

## Templates included

| Template | Purpose |
|---|---|
| `TplDashboard` | Landing page. Sticky stat strip, today's schedule, submissions to review, roster activity. |
| `TplHomeworkList` | Index of homework sets. Tabs (active / review / archive), toolbar (search + filters + view switch), table view with a grid fallback, bulk-action bar. |
| `TplHomeworkDetail` | A single homework set. Tasks with rendered formulas, answer keys and tolerances; results tab with per-question answer strips, AI verdict chips and a two-pane review drawer. |
| `TplStudentProfile` | Student header card, stats, tabs across recent homework, sessions (week grid), payments and notes. |
| `TplTaskBank` | Reusable task library. Master table on the left, formula + answer detail on the right, "add to homework" action. |

Three additional stub templates live in `index.html` so the SideNav doesn't dead-end
(`Расписание`, `Ученики`, `Группы`, `Мои задачи`, `Платежи`, `Тарифы`). They reuse the
same workplace components and can be promoted to full templates when those flows land.

## Component vocabulary

### Shell

- **`AppFrame`** — fixed 240 × rail + 56 × top bar + scrollable main grid. Do not nest
  frames; a template is the main content.
- **`SideNav`** — grouped (`Работа`, `Ученики`, `Материалы`, `Финансы`). Active item
  uses `green-100` bg + `green-800` fg; counts sit right-aligned in the same row.
- **`TopBar`** — breadcrumb on the left, centered global search with a `/` kbd hint,
  command-palette button + avatar on the right. No titles in the top bar — titles
  belong to `PageHeader`.
- **`PageHeader`** — single H1 (24 / 600), 13 px meta line, one primary action. Never
  two primaries. Never a subtitle disguised as H2.
- **`Toolbar`** — sticky above a table or list. Search + filter chips + view switch.
  Actions that scope to selected rows belong on the `BulkActionBar`, not the toolbar.

### Data surfaces

- **`t-stats`** — a single card with hairline-divided cells. Use once per page at most.
  `t-stats__value` is 22 / 600 with tabular-nums; `t-stats__label` is 11 / 600 uppercase
  in `fg3`.
- **`t-section`** — a generic card-section: header row with title + optional meta +
  right-aligned action slot, hairline divider, body. The standard container for any
  list of rows.
- **`RosterTable` / `.t-table`** — 32 px row height, sticky headers, right-aligned
  numbers with tabular-nums, row actions hidden until hover/focus. Selected rows get
  `green-100` background + a 2 px green left-inset shadow.
- **`t-listrow`** — compact inline row (hw list, student rows inside a group). Use
  instead of a card when the row has no imagery and fewer than ~6 fields.
- **`t-session` / `WeekGrid`** — schedule blocks. ЕГЭ uses the brand-green treatment,
  ОГЭ uses the indigo ОГЭ token. Past sessions get 0.55 opacity.

### Tutor-specific primitives

- **`Chip`** — three flavors: stream (`ege` / `oge`), state (`success` / `warning` /
  `danger` / `info` / `neutral`), and `filter` (a pressable button-chip used on
  toolbars). Count chips (`variant="count"`) sit inside `Tabs`.
- **`StatusDot`** — label + 6 px colored dot. The tutor substitute for a state chip
  when the row is already dense. Use chips in toolbars and card headers; status dots
  in table rows.
- **`Difficulty`** — 1–3 filled dots on a 6 px grid. Always labeled aria-wise.
- **`AnswerInput`** — right-aligned tabular-nums input with optional unit suffix and a
  `±tolerance` divider. The only valid input for a numeric answer in the product.
- **`FormulaBlock` / `InlineMath`** — KaTeX wrappers. Always rendered in the math font;
  the `t-formula-block` container adds a surface-tinted background at 14 px of padding.
- **`AICheckBlock`** — AI verdict chip (`ok` / `warn` / `unclear`) + confidence bar +
  short rationale + an override action. The AI chip also appears inline on submission
  rows (`t-aicheck__ai-chip`).
- **`KbdHint`** — platform-aware; uses `⌘` on macOS, `Ctrl` elsewhere. `["Mod","K"]`
  is the canonical pairing.

### Entity cards

- **`StudentCard`** — profile header. Avatar (56 px, ringed by stream), name, class +
  stream + subjects line, tutor + since line, optional primary action. Not a featured
  card — no gradient, no stats, no illustrations.
- **`TaskCard`** — left-aligned ordinal, statement, optional formula, right-aligned
  row-actions. Meta line packs answer / tolerance / code / difficulty into one row.
- **`HomeworkSetCard`** — grid-view fallback for the homework list. Stream + state
  on top, title + 13 px meta, footer with due date and chevron.
- **`SubmissionRow`** — expandable row. Collapsed shows name, submitted-at, score,
  per-question answer strip and AI chip. Expanded drops into the two-pane
  `SubmissionReview`.
- **`GroupPanel`** — a single card with dividers separating participants and shared
  homework. No nested cards — inset surfaces only.

## Anti-drift rules specific to this kit

These carry over from the master anti-drift list but matter most here:

- **No cards inside cards.** `GroupPanel` and `StudentCard` never wrap their children
  in another bordered card — use `t-group__inset` or dividers.
- **One primary action per screen.** Every `PageHeader` has one filled green button.
  Everything else is outline, ghost or chip.
- **Ochre stays out.** This kit never references `--sokrat-ochre-*`. Ochre is for
  marketing and student celebration only.
- **Brand green ≠ success.** StatusDot / Chip / Progress use `--sokrat-state-*`
  tokens, not the brand green scale. The two colors are close — treating them as
  interchangeable is how drift starts.
- **Numbers are tabular.** Every numeric cell, stat value, schedule time, answer,
  progress label and currency sum opts into `font-variant-numeric: tabular-nums
  lining-nums`.
- **Math never renders in the sans body font.** `InlineMath` and `FormulaBlock` are
  the only valid surfaces for a rendered formula. For un-rendered tokens (a code like
  `1.1.4`), use `.t-num` on the span.
- **No zebra striping.** Tables use hairline row dividers and a hover wash.

## Density reference

| Hit target | Token | Used for |
|---|---|---|
| 32 px | `--sokrat-hit-xs` | Icon-only ghost buttons inside dense table rows |
| 36 px | `--sokrat-hit-sm` | Toolbar search, filter chips, small buttons, field controls |
| 40 px | `--sokrat-hit-md` | Default button, tab items, nav items |

Table rows are 32 px tall. Stat-strip cells are 14 × 16 px of padding. The AppFrame
padding is 20 × 24 px. Section card-to-section spacing is 16 px.

## Adding a new template

1. Compose it from `workplace.jsx` components first. A page made of 3–4 `t-section`
   cards, a `t-stats` strip and a `PageHeader` is usually the right shape.
2. Add it to `templates.jsx` as `Tpl<Name>` and export via `Object.assign(window, …)`.
3. Register it in `index.html`'s `ROUTES` map and, if it should appear in the side
   nav, add an entry to `chrome.jsx`'s `SideNav` groups with a matching `NAV_KEY_FOR`
   entry.
4. Use sample data for preview only — the component signature is the API.

## Known gaps (next passes)

- **Command palette.** Ghost button exists on the top bar; the overlay is not yet
  wired. Should reuse `Tabs` + `t-table` for recent items.
- **Notifications.** No bell/badge yet. When it lands, reuse `t-chip--count` and the
  `t-status` dots for severity.
- **Drawer / dialog primitives.** The submission review is inlined inside the
  results tab; a real overlay drawer is next.
- **Empty-state illustrations.** `EmptyState` is text-only by design; illustrations
  should come from `assets/illustrations/` when that folder exists.
- **Density toggle.** The current pass locks tutor to 14 px body / 32 px rows.
  A comfortable sub-mode for long review sessions is a candidate for v2.
