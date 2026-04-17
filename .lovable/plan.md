

## Plan: импорт каталога формул механики из Google Sheet

### Что меняется и почему
Источник истины — лист «Механика» Google Sheet. В нём 40 строк со статусами `ready`/`review` (включая новые **kin.13–kin.22** — вращение по окружности). Код сейчас содержит 35 формул, причём у части `ready`-строк рецепты/мутации в коде и в таблице **расходятся** (например `dyn.01`, `hydro.04`). По п.3 ТЗ таблица побеждает — мы перегенерируем каталог из CSV, а не дописываем вручную.

### Подход: одноразовый build-time импорт, без runtime-зависимости от Google
Не делаем live-fetch из Google в runtime (это дополнительная failure-зона и нарушение существующей архитектуры). Делаем so:

1. Скачиваем CSV листа «Механика» через `?format=csv&gid=1229966212`.
2. Запускаем одноразовый Node-скрипт `scripts/import-formula-sheet.mjs`, который:
   - фильтрует строки по статусу `ready` / `review`;
   - парсит все 17 продуктовых колонок;
   - снимает **только** внешние `$…$` у `Формула (LaTeX)`, не трогая внутренний LaTeX;
   - генерирует три файла:
     - `src/lib/formulaEngine/formulas.generated.ts` — массивы `Formula[]` по разделам;
     - `src/lib/formulaEngine/recipes.generated.ts` — `BUILD_RECIPES` + `SUPPORTED_BUILD_FORMULA_IDS`;
     - `src/lib/formulaEngine/mutations.generated.ts` — `MUTATION_LIBRARY`.
3. Скрипт коммитим вместе со сгенерированными файлами. Пересборка тренажёра при будущих обновлениях таблицы = `node scripts/import-formula-sheet.mjs`.

Каталог формул в `formulas.ts` заменяем на re-export из `formulas.generated.ts`, разбитый по существующим экспортам (`kinematicsFormulas`, `dynamicsFormulas`, `conservationFormulas`, `staticsFormulas`, `hydrostaticsFormulas`, `mechanicsFormulas`). Сигнатуры `Formula`, `BuildRecipe`, `Mutation` **не меняем** — UI тренажёра ничего не замечает.

### Минимальное расширение типа `Formula`
В таблице есть колонка «Экзамен» (`ЕГЭ` / `ОГЭ` / `ЕГЭ+ОГЭ`). По п.10 ТЗ — добавляем ровно одно опциональное поле:

```ts
exam?: 'ЕГЭ' | 'ОГЭ' | 'ЕГЭ+ОГЭ';
```

Это уважает «ID → exam tag/filter metadata» из маппинга, не ломает существующий код (поле опциональное), и оставляет дверь для будущего фильтра ЕГЭ/ОГЭ в `TrainerPage` без новой архитектуры. **Никаких других новых полей не добавляем.**

### Маппинг колонок (ровно как в ТЗ)

| Sheet | Code |
|---|---|
| `ID` | `formula.id` |
| `Экзамен` | `formula.exam` (новое опциональное) |
| `Раздел` | (используется для bucketing по массивам) |
| `Тема` (+`Подтема`) | `formula.section` = «Кинематика»/…; `formula.topic` = `Тема — Подтема` |
| `Название формулы` | `formula.name` |
| `Подсказка для сборки` | `formula.buildTitle` |
| `Формула (LaTeX)` | `formula.formula` (с снятыми внешними `$`) |
| `Формула (текст)` | `formula.formulaPlain` |
| `Переменные` | `formula.variables[]` (parser: `symbol — name (unit)` построчно) |
| `Физический смысл` | `formula.physicalMeaning` |
| `Зависимости` | `formula.proportionality.{direct,inverse}` (parser: `прямая:`/`обратная:`) |
| `Размерности` | `formula.dimensions` |
| `Откуда выводится` | `formula.derivedFrom` |
| `Когда применять` | `formula.whenToUse[]` (split по `\n`, strip `•`) |
| `Частые ошибки` | `formula.commonMistakes[]` |
| `Связанные формулы` | `formula.relatedFormulas[]` (split по `,`) |
| `Сложность` | `formula.difficulty` (1/2/3) |
| `Мутации Layer 3` | `MUTATION_LIBRARY[id]` (parser: построчно `type; latex; hint`) |
| `Рецепт сборки` | `BUILD_RECIPES[id]` (parser: `numerator: … \| denominator: …`) |

Раздел в `formula.section` нормализуем по карте `{Кинематика, Динамика, Законы сохранения, Статика, Гидростатика}` — ровно как сейчас в коде, чтобы `getEligiblePool` и `TrainerPage` фильтры продолжали работать.

`SUPPORTED_BUILD_FORMULA_IDS` собираем автоматически: ID попадает в set, если в его строке заполнена колонка «Рецепт сборки». Это снимает ручную поддержку списка.

### KaTeX и кириллица — без регрессий
- Рендер уже идёт через `MathText` (KaTeX + remark-math, `throwOnError: false`, lazy-load). Кириллица в индексах нормализуется существующей `normalizeMathToken` (`v_{\\text{ср}}` и т.д.) — **сохраняем эту нормализацию**, применяем её и к токенам новых формул при импорте.
- Внешние `$…$` снимаем только если строка одновременно начинается на `$` и заканчивается на `$` (regex с anchors); внутренние `$` и сам LaTeX не трогаем.
- Поддержку `___LINEBREAK___` placeholder добавляем как helper в `MathText` **только для полей, где есть `\n`** (физический смысл / частые ошибки / when-to-use). Сами LaTeX-строки в листе однострочные, переносы там не встречаются — гарантия не ломаемости подтверждена. Но helper будет на случай будущих многострочных пояснений.

### Файлы

**Новые:**
- `scripts/import-formula-sheet.mjs` — Node-скрипт импорта (CSV-парсер на стандартной библиотеке, никаких новых deps).
- `scripts/data/mechanika-source.csv` — снапшот листа на момент импорта (для воспроизводимости и ревью diff'ов).
- `src/lib/formulaEngine/formulas.generated.ts` — авто-сгенерированный каталог.
- `src/lib/formulaEngine/recipes.generated.ts` — авто-сгенерированные `BUILD_RECIPES` + `SUPPORTED_BUILD_FORMULA_IDS`.
- `src/lib/formulaEngine/mutations.generated.ts` — авто-сгенерированный `MUTATION_LIBRARY`.

**Изменяются (минимально):**
- `src/lib/formulaEngine/formulas.ts` — заменяем длинные литералы на re-export из `formulas.generated.ts`. Карта `formulasById` и `getFormulaById`/`getRelatedFormulas` остаются.
- `src/lib/formulaEngine/types.ts` — добавляется одно опциональное поле `exam?: 'ЕГЭ' | 'ОГЭ' | 'ЕГЭ+ОГЭ'`.
- `src/lib/formulaEngine/questionGenerator.ts` — `BUILD_RECIPES`, `MUTATION_LIBRARY`, `SUPPORTED_BUILD_FORMULA_IDS` импортируются из generated-файлов вместо литералов. Логика `generateBuildFormula` / `generateTrueOrFalse` / `generateSituationToFormula` **не меняется**.
- `src/components/kb/ui/MathText.tsx` — добавляется небольшой preprocess `\n → <br>` через `___LINEBREAK___` placeholder, чтобы не интерферировать с remark-math.

**Не трогаем:**
- Игровая механика: `FormulaRoundScreen`, `RoundResultScreen`, `BuildFormulaCard`, `SituationCard`, `TrueOrFalseCard` — без правок (контракт `Formula`/`FormulaQuestion` сохраняется).
- `TrainerPage.tsx` — секции/раунды/жизни/распределение карточек остаются как есть; новые формулы автоматически попадают в `kinematicsFormulas` / `mechanicsFormulas`.
- Никаких изменений в `formulaEngine/index.ts` (он реэкспортирует те же массивы).

### Что подтверждаем после имплементации
- 40 формул в каталоге (12 + 10 + 6 + 7 + 1 + 4 = 40), `kin.13`–`kin.22` появились в `kinematicsFormulas`.
- Расхождения `ready`-строк (`dyn.01`, `hydro.04` рецепты) теперь соответствуют таблице.
- `npm run lint && npm run build && npm run smoke-check` зелёные.
- Ручной smoke `/trainer` → раздел «Кинематика»: попадаются вопросы по новым формулам вращения, build/true-false/situation карточки рендерятся, кириллица в `v_{ср}` и `a_{цс}` корректна.

### Что остаётся за рамками
- Не делаем live-pull из Google в runtime — только build-time снапшот.
- Не подключаем новый UI-фильтр «ЕГЭ/ОГЭ»: поле `exam` пишется, но фильтр в `TrainerPage` появится отдельной задачей.
- Не трогаем `draft`-строки (145 шт) — по ТЗ берём только `ready`/`review`.
- Не меняем форматы `BuildRecipe`/`Mutation`/`Formula` сверх одного опционального `exam`.

