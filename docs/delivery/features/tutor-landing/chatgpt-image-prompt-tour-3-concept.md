# ChatGPT Image 2.0 prompt — Tour #3 «Отчёт родителю» premium mockup

**Цель:** получить более polished версию того же макета, что выдал Pillow-генератор. Тот же контент, та же структура, но с premium-glow, лучшей типографикой, фотореалистичной глубиной — то, что Pillow физически не умеет.

**Что отдать ChatGPT:**
1. Reference image: текущий Pillow-мокап `tour-3-concept.png` (1920×1200) — приложить как input image
2. Prompt-блок ниже (copy-paste)

**Ожидаемый output:** PNG 1920×1200 (или переразмерится), с теми же 13 содержательными зонами, но «как будто это скриншот из реального премиум-SaaS-продукта 2026 года».

---

## Промпт для копирования в ChatGPT Image 2.0

```
Recreate this exact dashboard mockup with significantly higher polish and premium SaaS-product feel. The reference image shows the layout, content, and exact text I need — preserve ALL of it precisely. Elevate ONLY the visual craft.

ASPECT RATIO: 16:10 (1920×1200), landscape orientation.

PRESERVE EXACTLY (do not change a single character):

Russian text content — copy these strings verbatim into the appropriate zones:
• Brand: «Сократ AI»
• Subtitle: «Еженедельный отчёт родителю»
• Date pill: «12 — 18 мая 2026»
• Status chip (top-right corner of report card): «В РАЗРАБОТКЕ»
• Big headline: «Иван П., 11 класс — физика ЕГЭ»
• Tutor line: «Репетитор: Егор Блинов»
• KPI labels (uppercase tracking): «ТЕКУЩИЙ БАЛЛ», «ЗА 6 НЕДЕЛЬ», «ПРОГНОЗ ЕГЭ»
• KPI values: «74», «+9», «80–85»
• KPI sublabels: «из 100», «темп +1,5/нед.», «при текущем темпе»
• Section header: «КАРТА ТЕМ» followed by «по статусу освоения»
• Three zone cards:
  — «Зелёная зона», «освоено · 4 темы»: Кинематика, Статика, Механические колебания, Гидростатика
  — «Жёлтая зона», «в работе · 3 темы»: Динамика — З. Ньютона, Электростатика, Постоянный ток
  — «Красная зона», «требует внимания · 2 темы»: Магнитное поле, Оптика — линзы
• Chart section header: «ДИНАМИКА БАЛЛА» «6 недель · ось 0—100»
• Chart trend annotation: «+9 баллов · темп +1,5/неделю»
• Y-axis labels: 100, 75, 50, 25, 0
• X-axis labels: «Нед. 7», «Нед. 8», «Нед. 9», «Нед. 10», «Нед. 11», «Нед. 12»
• Score values plotted on the line: 65, 67, 69, 71, 72, 74 (rising trend)
• Target band label inside chart: «цель ЕГЭ 80–85»
• Last-point pill on chart: «74 баллов»
• HW section header: «ПОСЛЕДНИЕ ДЗ» «за неделю»
• Four homework rows:
  — «Электростатика — №18 ЕГЭ» / «Сдал · 4 задачи» / 85% (green pill)
  — «Постоянный ток — закон Ома» / «Сдал · 5 задач» / 72% (green pill)
  — «Магнитное поле — соленоид» / «В процессе · 3 из 6» / «—» (amber pill)
  — «Оптика — тонкая линза» / «Не приступал» / «—» (gray pill)
• Footer: «Сгенерировано Сократ AI · отправляется в Telegram, email или push» (left) and «sokratai.ru» (right)

CRITICAL TYPOGRAPHY RULES:
• ALL letters must be properly Cyrillic. Do not substitute Latin lookalikes.
  Specifically: use Cyrillic «С» (not Latin «C») in «Сократ», use Cyrillic «р»
  (not Latin «p») in «Репетитор», use Cyrillic «у» (not Latin «y») in
  «статусу», etc. Verify every glyph is from the Cyrillic Unicode block.
• Use Golos Text font (Russian-designed, modern geometric sans). If
  unavailable, fall back to Inter, IBM Plex Sans, or Manrope —
  any clean modern sans with proper Cyrillic support.
• Hierarchy: 34px bold for the big student headline, 24px bold for brand,
  28px bold for KPI values, 13–15px for body and labels, 11px for axis labels.

DESIGN SYSTEM TOKENS (use these exact hex values):
• Primary green: #1B6B4A (forest green) — logo, CTAs, primary KPI values, line chart
• Mid green: #2E8C66 — accent stripes, chart point outlines
• Light green tint: #F0FDF4 — green zone card background
• Pill green: #DCFCE7 — percentage pills for completed
• Ochre: #E8913A — «В РАЗРАБОТКЕ» chip, target band on chart, prognosis accent
• Light ochre: #FEF3E2 — target zone band fill
• Amber: #F59E0B — yellow zone stripe, in-progress indicators
• Light amber: #FEFCE8 — yellow zone card background
• Red: #EF4444 — red zone stripe and dots
• Light red: #FEF2F2 — red zone card background
• Slate-900: #0F172A — primary headlines
• Slate-700: #334155 — body text on light backgrounds
• Slate-500: #64748B — secondary text
• Slate-200: #E2E8F0 — card borders, hairlines
• Slate-100: #F1F5F9 — date pill background
• White: #FFFFFF — card surface
• Background: #F4F2EE (warm off-white, very subtle dot grid texture)

WHAT TO ELEVATE (this is what makes it premium vs the reference):

1. Outer report card:
   - Generous rounded corners (radius 28–32px)
   - Multi-layer soft drop shadow with subtle blur (Y-offset 16, blur 36, opacity 8%)
   - Faint inner highlight at the top edge (1px white line at top, 30% opacity)
   - Crisp 1px slate-200 border

2. Inner panels (KPI tiles, topic zones, chart panel, HW panel):
   - Rounded 18–20px
   - Subtle elevation shadow (offset 6, blur 16, opacity 6%)
   - Each card slightly lifted from the page

3. KPI tiles — make them feel premium:
   - Glass-card aesthetic with very subtle gradient (white at top → 99% white at bottom)
   - Render the icons (Trophy, TrendingUp, Target) as crisp Lucide-style line glyphs in the accent color, top-right corner of each tile
   - 4px vertical accent stripe on the left edge in the accent color

4. Topic map zone cards:
   - Top stripe in accent color (4px solid bar across the top of each card)
   - Card background fill in the very pale tint of the zone color
   - Bullet dots crisp circles in the accent color, slightly larger than the reference (12px)
   - Subtle hover-state shadow even though it's static

5. Line chart:
   - Smooth Bézier curve (not straight segments) connecting the 6 score points
   - Beautiful gradient fill area beneath the line: solid green at the top fading to transparent at the bottom (linear gradient, 30% opacity max)
   - Data point dots: white core with 3px green ring, positioned cleanly on the line
   - Soft glow under the curve and around each data point (very subtle, 4–6px blur)
   - Y-axis gridlines hairline, slate-100, dashed alternating with solid
   - The «цель ЕГЭ 80–85» band is rendered as a soft horizontal stripe in pale ochre, with the label in ochre-700 right-aligned inside the band
   - Last-point label («74 баллов») rendered as a green pill with shadow, attached to the data point with a tiny diagonal connector line

6. HW table:
   - Each row has crisp typography with bold task title and lighter descriptor below
   - Percentage pills are perfect rounded rectangles with the right color contrast (green pills for completed, amber for in-progress, gray for not started)
   - Hairline divider between rows in slate-100
   - The «—» dashes for non-numeric pills are em-dashes («—»), centered

7. Header strip:
   - Logo: green circle with «С» in white. Add a subtle inner highlight ellipse top-left (suggesting depth).
   - Date pill: pill-shaped slate-100 background with slate-700 text
   - «В РАЗРАБОТКЕ» chip: ochre-500 background, white bold text, with its own subtle drop shadow that signals «active status indicator»
   - Faint gradient on the header band (white at bottom → slate-50 at top)

8. Background context:
   - Very subtle dot-grid pattern outside the report card (1.5px dots, 32px spacing, opacity 6%, slate color) — gives premium-paper feel without distracting
   - Card sits on this textured background with its multi-layer shadow

9. Overall composition:
   - Generous whitespace around every element
   - Pixel-perfect alignment (everything snaps to a 4px grid)
   - All text crisp and rendered at native pixel density
   - No JPEG compression artifacts, no blurry edges

10. Final aesthetic:
   - Like a screenshot from a 2026 premium SaaS product (think Linear, Notion AI, Stripe Dashboard) — clean, calm, high-trust
   - Russian-language UI executed by a top-tier design team that ships in production
   - The «В РАЗРАБОТКЕ» chip should be the only sign that this is conceptual, not real

ANTI-REQUIREMENTS — do NOT do these:
• Do NOT add new content, sections, or text not in the list above
• Do NOT translate Russian to English anywhere
• Do NOT add corporate clichés (no «$1M raised», «10× growth», «AI-powered» badges)
• Do NOT add stock photos, illustrations, gradients with rainbow effects, or 3D renders
• Do NOT add a sidebar, navigation menu, or chrome — this is a standalone report sheet
• Do NOT add login buttons, search bars, or interactive UI elements
• Do NOT make the «В РАЗРАБОТКЕ» chip fill the whole card or dominate the design — it's a small status indicator in the top-right corner
• Do NOT add other people's names, fictional testimonials, or brand logos
• Do NOT change the numerical data (74, 80–85, +9, +1,5, 85%, 72%, 65→74 trend, etc.)

OUTPUT: a single PNG, 1920×1200 pixels, optimized for landing page placement.
```

---

## Tactical советы по использованию

### Перед отправкой
1. Открой `https://chat.openai.com` или ChatGPT Plus с image-gen
2. Прикрепи `tour-3-concept.png` из `public/marketing/tutor-landing/` как input image
3. Вставь промпт выше как сообщение
4. Получи output → скачай → положи рядом с оригиналом для сравнения

### Если первый result разочаровал
Типичные failure modes ChatGPT Image 2.0 на cyrillic-heavy SaaS-моках и как их корректировать одним фолоу-апом:

| Проблема | Follow-up reply (русским «no need to redo from scratch») |
|---|---|
| Какие-то русские слова кириллицу не доскрутили — латинская С в «Сократ» или подобное | «Найди все места где используется латинская буква в русском слове и замени на кириллическую. Особенно проверь: «Сократ» (С — кириллица), «Егор Блинов» (Е, г, о, р — кириллица), «КАРТА ТЕМ» (все буквы — кириллица). Перерисуй только эти участки.» |
| Цифры не совпадают с reference (74 → 75, 85% → 87%) | «Цифры на графике и в KPI-плитках должны быть точно: 74 (текущий балл), +9 (за 6 недель), 80–85 (прогноз), 85% и 72% (для двух сданных ДЗ), линия графика 65→67→69→71→72→74. Перерисуй только эти числа.» |
| Layout «поплыл» — chip не в углу или зоны не в строку | «Сохрани layout reference image: header в верхней полосе, KPI-плитки справа сверху, три зоны (зелёная/жёлтая/красная) одной строкой ниже, график слева внизу, ДЗ-таблица справа внизу. Не меняй позиции элементов.» |
| Всё photo-realistic но контент перевернут | «Это должен быть UI screenshot, не stock photo. Никакого боке, никакого глубинного блюра, никаких перспективных искажений. Plain front-on screenshot of a SaaS dashboard.» |
| Слишком много декоративных элементов | «Убери все добавленные иконки, бейджи, статусы и декоративные элементы, которых нет в reference image. Оставь только то, что я перечислил в content list.» |

### Если хочешь несколько вариантов
Скажи: `«Сгенерируй 3 варианта — каждый с разной интенсивностью visual polish. V1: minimal premium, V2: balanced (текущий target), V3: maximum design flourish. Я выберу лучший для дальнейшей итерации.»`

### Финальная проверка перед использованием на лендинге
Чек-лист, который проверяешь визуально по output:
- [ ] Все 13 содержательных блоков на месте (header, brand, date, chip, headline, 3 KPI, 3 zones, chart, HW, footer)
- [ ] Каждое русское слово — настоящая кириллица (не латинские look-alike). Особое внимание: «Сократ», «Электростатика», «Гидростатика», «Магнитное поле»
- [ ] Цифры точно: 74, +9, 80–85, 85%, 72%, +1,5/нед., 12 — 18 мая 2026
- [ ] «В РАЗРАБОТКЕ» chip в правом верхнем углу report card, ochre-цвета
- [ ] Aspect ratio 16:10 (1920×1200) или близко к нему
- [ ] Размер файла ≤ 500 KB (если больше — пережми через TinyPNG или squoosh.app)

### Если результат всё-таки плох
Fallback: оставайся на Pillow-мокапе. Он работает 100% репродюсибельно. Для премиум-фактора можно ещё:
- Заменить background pattern на тонкую paper-texture (через Pillow `Image.new` + Perlin noise или просто overlay существующего paper.png ассета)
- Добавить ещё один уровень shadow/glow на KPI-плитки
- Использовать proper Golos Text TTF (нужно положить в `/sessions/.../mnt/outputs/fonts/` и пропатчить F_BOLD/F_REG paths) вместо DejaVu Sans Bold

---

## Что делать с финальным image

1. Сохранить как `public/marketing/tutor-landing/tour-3-concept.png` (overwrite Pillow-версию)
2. **Не менять** компонент `Tour3ConceptMockup.tsx` — он смотрит на тот же путь
3. Re-deploy через `deploy-sokratai` (см. правило 95-production-deploy.md)
4. Сравнить на проде Tour #3 секцию с предыдущей версией → если ChatGPT Image 2.0 выдал лучше, оставляем; если хуже, `git checkout` PNG обратно

## Backup plan

Pillow-мокап в `outputs/generate_tour3_mockup.py` остаётся source-of-truth для промежуточных правок (поменять имя репетитора, поменять числа, поменять список тем). Если ChatGPT-версия пойдёт в прод, скрипт всё равно держим — он позволяет за 30 секунд создать новую версию с другими данными для будущих pricing/onboarding/case-study нужд.
