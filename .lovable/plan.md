## Plan: Tour #2 video + copy fix

### 1. Copy uploaded assets to public folder
- `user-uploads://tour-2-builder.mp4` → `public/marketing/tutor-landing/tour-2-builder.mp4`
- `user-uploads://tour-2-poster.jpg` → `public/marketing/tutor-landing/tour-2-poster.jpg`

### 2. Create `src/components/sections/tutor/Tour2Video.tsx`
Parallel to existing `Tour1Video.tsx` (keep Tour #1 untouched per request — no extraction refactor). Identical visual treatment with different src/poster/caption/aria-label/alt:
- Container `aspect-video` (16:9) instead of `1920/1030`
- Caption: «Смотреть как собрать ДЗ за 5 минут — 25 сек»
- aria-label: «Воспроизвести видео: Конструктор ДЗ»
- alt: «Превью: Конструктор ДЗ — задачи + AI-генерация за 5 минут»
- Click-to-play, `preload="none"` (only mounted after click), poster `loading="lazy"` + `decoding="async"`
- Tokens: `var(--sokrat-shadow-md)`, `var(--sokrat-radius-xl)`, `var(--sokrat-green-700)`

### 3. Edit `src/components/sections/tutor/ProductTour2.tsx`
- Import `Tour2Video`
- Add `videoSlot={<Tour2Video />}` to `<ProductTour ...>` props (mirrors how `ProductTour1` wires `Tour1Video`)
- Keep all existing copy (headline, badge, bullets) — except bullet edit below
- In bullet "База задач + ваш архив": remove «Решу-ЕГЭ,» from the body text. New body:
  > «Задачи из сборников Демидовой, ФИПИ-демоверсий. Плюс ваш архив — импортируем из папок на диске. Все задачи с тегами: тема, номер задания ЕГЭ/ОГЭ, сложность.»

### 4. No other changes
- `Tour1Video.tsx`, `ProductTour.tsx`, `tourData.ts` untouched
- No new shared `LazyVideo` extraction (per "do NOT change Tour #1" guidance)

### Validation
- Network tab: first load fetches `tour-2-poster.jpg` only; MP4 only after click
- Tour #1 continues to work unchanged

### Deploy note
🚀 Deploy needed — frontend changes to `src/**` and `public/**`. After merge, run `deploy-sokratai` on the Selectel VPS so production `sokratai.ru` picks up the new video, poster, and copy edit. Lovable preview will reflect changes immediately.
