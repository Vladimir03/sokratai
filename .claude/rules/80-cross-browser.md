# Cross-Browser Compatibility (КРИТИЧНО)

Продукт используется на Safari (macOS/iOS) — это главный источник багов. **Все правила ниже обязательны.**

## Build targets
- В `vite.config.ts` установлен `build.target: ['es2020', 'safari15', 'chrome90']`
- В `package.json` есть `browserslist` — используется autoprefixer для CSS
- **НЕ МЕНЯТЬ** эти настройки без веской причины

## Запрещённые паттерны (ломают Safari/iOS)

### JavaScript / TypeScript
- **`RegExp` lookbehind** (`(?<=...)`) — Safari < 16.4 НЕ поддерживает. Используй capturing groups
- **`structuredClone()`** — Safari < 15.4. Используй `JSON.parse(JSON.stringify(obj))` или lodash `cloneDeep`
- **`Array.at()`** — Safari < 15.4. Используй `arr[arr.length - 1]` вместо `arr.at(-1)`
- **`Object.hasOwn()`** — Safari < 15.4. Используй `Object.prototype.hasOwnProperty.call()`
- **`crypto.randomUUID()`** — только HTTPS + Safari 15.4+. В dev-окружении может не работать
- **`Date` парсинг** — Safari **строг** к формату. `new Date("2024-01-15 10:30:00")` **СЛОМАЕТСЯ**. Всегда используй ISO: `new Date("2024-01-15T10:30:00")` или `date-fns`
- **`AbortSignal.timeout()`** — Safari < 16. Создавай `AbortController` с `setTimeout` вручную

### CSS
- **`100vh`** на iOS — НЕ учитывает адресную строку Safari. Используй `100dvh` или `min-height: -webkit-fill-available`
- **`overflow: clip`** — Safari < 16. Используй `overflow: hidden`
- **`scrollbar-gutter`** — Safari НЕ поддерживает
- **`:has()` селектор** — Safari 15.4+, нестабильно. В Tailwind: `group/peer` утилиты
- **`backdrop-filter`** — нужен `-webkit-backdrop-filter` (autoprefixer добавит, но проверяй)
- **CSS `@layer`** — Safari 15.4+. Осторожно
- **`position: sticky` на `<th>` / `<td>` + `border-collapse: collapse`** — **СЛОМАНО** в Safari/iOS WebKit. Sticky-колонка/строка в таблице просто не липнет. Фикс: использовать `border-separate border-spacing-0` (Tailwind) — sticky тогда работает корректно. См. `HeatmapGrid.tsx`
- **`<table className="w-full">` + `min-w-[Npx]` на `<td>`** — table layout алгоритм игнорирует `min-width` на ячейках и сжимает столбцы под container. `overflow-x-auto` родителя в этом случае **никогда** не активируется. Фикс: `<colgroup>` с `<col style={{ width: 'Npx' }}>` + `table-layout: fixed` + inline `width: max-content` (или `auto`) на table

### iOS-специфичные проблемы
- **`position: fixed`** + клавиатура iOS — элемент "прыгает". Используй `position: sticky`
- **Safe Area Insets** — `env(safe-area-inset-*)` для iPhone с нотчем/Dynamic Island
- **Touch events** — 300ms delay на tap. `touch-action: manipulation` решает
- **Auto-zoom на input** — Safari iOS зумит если `font-size < 16px`. **ВСЕГДА** `font-size: 16px`+ на `<input>`, `<textarea>`, `<select>`
- **`overflow-x-auto` контейнер с кликабельными child-элементами** — на iOS Safari row-onClick может съесть `touchstart` и заблокировать horizontal swipe. Фикс: `touch-action: pan-x` (Tailwind `touch-pan-x`) на скроллящем `<div>`. Применяй ВСЕГДА, когда внутри scrollable области есть row/cell с onClick handler-ом

## Правила при написании кода
1. **Перед использованием нового Web API** — проверь поддержку на caniuse.com для Safari 15+
2. **Для дат** — всегда `date-fns` (`parseISO`) вместо нативного `Date` парсинга. Используй `src/lib/formatters.ts`
3. **CSS анимации** — предпочитай `transform` и `opacity` (GPU-ускорены)
4. **Тестируй в Safari** — при изменениях CSS layout, scroll-поведения или форм
