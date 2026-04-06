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

### iOS-специфичные проблемы
- **`position: fixed`** + клавиатура iOS — элемент "прыгает". Используй `position: sticky`
- **Safe Area Insets** — `env(safe-area-inset-*)` для iPhone с нотчем/Dynamic Island
- **Touch events** — 300ms delay на tap. `touch-action: manipulation` решает
- **Auto-zoom на input** — Safari iOS зумит если `font-size < 16px`. **ВСЕГДА** `font-size: 16px`+ на `<input>`, `<textarea>`, `<select>`

## Правила при написании кода
1. **Перед использованием нового Web API** — проверь поддержку на caniuse.com для Safari 15+
2. **Для дат** — всегда `date-fns` (`parseISO`) вместо нативного `Date` парсинга. Используй `src/lib/formatters.ts`
3. **CSS анимации** — предпочитай `transform` и `opacity` (GPU-ускорены)
4. **Тестируй в Safari** — при изменениях CSS layout, scroll-поведения или форм
