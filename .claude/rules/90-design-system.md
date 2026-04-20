# Design System — SokratAI tactical guidance

## Authority hierarchy (read first)

Cross-kit canonical design system лежит в корне репо, пришёл из Claude Design handoff (Phase 1 landed 2026-04-20, commit `d2d2834`; palette sync 2026-04-20, commit `0879563`):

1. **`/SKILL.md`** — **authoritative source** для любого **нового** UI-решения. System purpose, mode contract (`data-sokrat-mode`), token hierarchy, anti-drift ten laws, extension checklist, pre-flight checks. **Читать первым** перед любой UI-работой.
2. **`src/styles/colors_and_type.css`** — single source of truth для tokens (`--sokrat-*`), `@font-face` Golos Text, mode rules, parent overlay. Foundations frozen.
3. **`docs/design-system/README.md`** — folder map + completion status handoff.
4. **Этот файл (`.claude/rules/90-design-system.md`)** — **tactical guidance** для SokratAI-specific use cases: как применять handoff в существующих компонентах, какие Tailwind-токены (`bg-accent`, `socrat.*`) mapped к brand green сейчас (compatibility bridge β), anti-patterns, цветовые/типографические гайды для конкретного продукта. **Не источник для новых архитектурных решений.**

### При конфликте

Если гайд в этом файле противоречит SKILL.md — **SKILL.md выигрывает.** Гайд этого файла описывает текущее состояние runtime (Phase 2 compatibility bridge — `bg-accent` остаётся зелёным), которое со временем будет приведено к полной handoff-модели через semantic cleanup passes. Пока такой переход не выполнен, tactical guide остаётся актуален для работы с **существующим** кодом.

Пример активного gap между SKILL.md и этим файлом (2026-04-20):
- **SKILL.md §10:** `--sokrat-ochre-500 → --accent` (в `colors_and_type.css`)
- **Этот файл + runtime:** `--accent` остаётся `#1B6B4A` (green) как compatibility bridge; ochre доступен через `bg-socrat-accent` или `var(--sokrat-ochre-500)`
- **Resolution:** bridge уберётся в Phase 4 semantic cleanup pass (`bg-accent → bg-primary` codemod + swap `--accent` на ochre). До того — следуйте tactical guidance ниже

## Context documents

- Полный UX-аудит: `docs/delivery/features/ux-audit/ux-audit-2026-04-02.md`
- Анализ конкурентов: `docs/discovery/research/конкуренты/edtech_competitors_analysis.md`
- Cross-kit handoff manifesto: `/SKILL.md`
- Foundation tokens: `src/styles/colors_and_type.css`

## Визуальная идентичность

Сократ AI — **рабочее место экзаменного репетитора**, не игрушка и не generic AI-чат.
Тон: серьёзный помощник с характером. Ближе к Brilliant.org / Khan Academy, чем к Duolingo.
Целевая аудитория: репетиторы физики ЕГЭ/ОГЭ (primary buyer, hourly rate 3000-4000₽), ученики 16-18 лет (mobile-first), родители.

## Цветовая палитра

```
Primary:    #1E293B  (slate-800)   — кнопки, заголовки, nav active
Accent:     #1B6B4A  (socrat green) — CTA, прогресс, success, primary action buttons
Accent-lt:  #DCFCE7  (green-100)   — фоны success-блоков
Warning:    #F59E0B  (amber-500)   — дедлайны, "требует внимания"
Danger:     #EF4444  (red-500)     — просрочено, ошибки
Surface:    #FFFFFF               — карточки
Background: #F8FAFC  (slate-50)    — фон страниц
Text-1:     #0F172A  (slate-900)   — заголовки
Text-2:     #64748B  (slate-500)   — body text, подписи
Border:     #E2E8F0  (slate-200)   — границы карточек, разделители
```

**Tailwind-токены (используй вместо hex):**
- `bg-accent` / `text-accent` / `fill-accent` — socrat green (#1B6B4A)
- `bg-socrat-telegram` / `hover:bg-socrat-telegram-dark` — Telegram blue (#0088cc / #006699)
- `bg-socrat-surface` — warm surface (#F7F6F3), для hover-состояний KB-карточек
- Полный список: `tailwind.config.ts` → `colors.socrat`

**ЗАПРЕЩЕНЫ:**
- Hard-coded hex `bg-[#1B6B4A]` — используй `bg-accent`
- Hard-coded hex `text-[#0088cc]` — используй `text-socrat-telegram`
- Фиолетовый градиент (legacy лендинг)
- Ярко-зелёный #22C55E (слишком кислотный)
- Бежевый/кремовый фон (legacy KB header)
- Случайные цвета, не входящие в палитру выше

## Типографика

```
Font family: 'Golos Text', system-ui, -apple-system, sans-serif
```

Golos Text — российский бесплатный шрифт с хорошими кириллическими начертаниями.
Google Fonts: https://fonts.google.com/specimen/Golos+Text

**Размеры:**
- 12px (0.75rem) — captions, timestamps
- 14px (0.875rem) — secondary text, table cells
- 16px (1rem) — body, inputs (ОБЯЗАТЕЛЬНО для iOS Safari — иначе auto-zoom)
- 18px (1.125rem) — card titles
- 20px (1.25rem) — section headers
- 24px (1.5rem) — page titles
- 30px (1.875rem) — hero headline (только лендинг)

**Weights:** 400 (body), 500 (emphasis), 600 (headings), 700 (hero)

**ЗАПРЕЩЕНЫ:** Inter, Roboto, Arial, Space Grotesk — это маркеры AI-слопа.

## Иконки

Используй **Lucide React** (уже в проекте). НЕ используй emoji в:
- Навигации (tabs, sidebar)
- Заголовках страниц и секций
- Кнопках и badge
- Карточках (homework cards, student cards, KB cards)

Emoji допустимы ТОЛЬКО в:
- Пользовательском контенте (сообщения в чате, отзывы)
- Onboarding/welcome текстах (но не в heading, а в body)

## Spacing

```
4px  (space-1)  — inline padding
8px  (space-2)  — gap между элементами в строке
12px (space-3)  — padding внутри badge/chip
16px (space-4)  — padding карточек, gap в grid
24px (space-6)  — margin между секциями
32px (space-8)  — margin между блоками на странице
```

## Border Radius

```
6px  (rounded-md)   — inputs, selects
8px  (rounded-lg)   — cards
12px (rounded-xl)   — modals, sheets
9999px (rounded-full) — pills, avatars, badge
```

## Компоненты — правила консистентности

### Навигация
- Tutor и Student nav ДОЛЖНЫ использовать один visual frame (высота h-14, один ряд)
- Lucide icons вместо emoji в tabs
- Active tab: `bg-accent text-white`, не purple/blue
- Logo: «Сократ» (текст, font-weight 600) — позже заменить на SVG-логотип

### Карточки (homework, student, KB)
- Белый фон (#FFFFFF), border slate-200, rounded-lg (8px)
- Нет карточек внутри карточек (anti-pattern AI slop)
- Status badge: colored dot + text, не colored pill с текстом
- На hover: `shadow-md transition-shadow` (не border change)

### Кнопки
- Primary: `bg-accent text-white` — для главного действия на странице
- Secondary: bg-white border-slate-200 text-slate-700 — для вторичных
- Destructive: bg-red-500 text-white — только для удаления
- Ghost: text-slate-500 hover:text-slate-700 — для tertiary actions
- ОДНА primary кнопка на экране (если несколько — остальные secondary)

### Формы
- Label: text-sm font-medium text-slate-700
- Input: border-slate-200 rounded-md text-base (16px!)
- Focus ring: `ring-2 ring-accent/20 border-accent`
- Error: border-red-500 + text-sm text-red-500 под input

## Конкурентные референсы (вдохновение)

- **Brilliant.org** — streaks, visual learning paths, dark accents
- **Khan Academy / Khanmigo** — socratic AI chat UI, clean task layout
- **Умскул** — role toggle (Ученики/Родители), orange accent for energy
- **Teachworks** — tutor dashboard metrics, professional feel
- **neofamily.ru** — task bank navigation, auto-check UX

Подробный анализ: `docs/discovery/research/конкуренты/edtech_competitors_analysis.md`

## Anti-patterns (ЗАПРЕЩЕНО)

1. **Emoji в UI chrome** — навигация, кнопки, заголовки, badge
2. **Cards inside cards** — вложенные карточки с border
3. **Gradient hero** — фиолетовый/зелёный градиент = legacy, убрать
4. **Inter/system font** — заменить на Golos Text
5. **Debug info в production** — метрики скорости, «Раздел в разработке»
6. **Multiple primary CTA** — один primary per screen
7. **Inconsistent nav** — разный стиль nav для tutor и student
