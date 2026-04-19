---
name: sokratai-formula-loader
description: Loads a new physics section into the SokratAI formula trainer at `/trainer` from raw materials (textbook screenshots, tutor Excel, methodology notes). Use whenever Vladimir says "загружаем раздел X в тренажёр", "добавь формулы по Электродинамике / Оптике / МКТ / ОГЭ", "вот скриншоты Мякишева / Excel от репетитора — оформи в тренажёр", or provides physics screenshots + spreadsheets for trainer integration. Triggers on any SokratAI formula trainer content expansion. Walks an 8-step pipeline (inventory → IDs → formulas.ts → BUILD_RECIPES → mutations → situations → UI → validation) with three mandatory stop points, strict anti-spoiler and anti-ID-leak rules, and a parallel ОГЭ track. Canonical reference is the v1 Egor section (10 formulas, «Вращение по окружности») shipped in `src/lib/formulaEngine/egorFormulas.ts`.
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# SokratAI Formula Loader (v1 — Механика_v1 as default)

Загружает новый физический раздел в standalone-тренажёр `/trainer` из
сырых материалов репетитора (скриншоты Мякишева, Excel Егора, методички).

**Начиная с 2026-04-19 default-сценарий = вкладка `Механика_v1`** в
гугл-таблице `1XZ7YY25VjUifwyzndjifKAiTw78-3nR21sSxsmUjswg` (gid 324880709).
Старая вкладка `Механика` остаётся **read-only legacy** для v2-каталога
(40 формул, `formulas.generated.ts`) — её не трогаем.

## Ключевые изменения по сравнению с v2

- **Все новые формулы идут в v1-формат** (ID-суффикс `_e`).
- **Parallel branch:** `egorFormulas.ts` (и его будущие collateral-файлы
  для новых разделов) **не импортируется в `mechanicsFormulas`** —
  иначе v2-раунды подхватят дубликаты.
- **Relations только внутри v1:** `relatedFormulas` для `_e`-формулы
  может указывать только на другую `_e`-формулу. Cross-reference в v2
  запрещён.
- **Новая колонка «Запомни»** в гугл-таблице → поле `memoryHook?: string`
  на `Formula` → используется в блоке «Запомни:» в FeedbackOverlay.
- **Новая колонка «Для сборки/не для сборки»** (dropdown значения
  `для сборки` / `не для сборки`) → поле `buildable?: boolean` на
  `Formula`. `не для сборки` = формула идёт только в TrueOrFalseCard
  **без мутации** (утверждение целиком верно/неверно).
- **Теоретические утверждения** включаются в таблицу как обычные
  формулы с LaTeX `formula` + `buildable: false`. Например, «угол
  между вектором скорости и радиус-вектором при равномерном вращении
  равен 90°» — формула в LaTeX, `buildable: false`, оставлена только
  в TF.

## Pipeline (8 шагов)

### Stop Point 1 — Inventory
1. Прочитать переданные материалы (скриншоты, CSV, Excel).
2. Прочитать текущее состояние гугл-таблицы через Drive MCP
   (`mcp__e9c13a9c-*__read_file_content`) — **вкладка `Механика_v1`**,
   gid 324880709. Искать колонки: Раздел, Тема, Подтема, Формула,
   formula_plain, Переменные, Запомни, Для сборки/не для сборки, Экзамен,
   Связанные формулы, Сложность, Статус.
3. Сопоставить сырые формулы со строками таблицы. Если репетитор дал
   новые — подготовить строки для вставки (отдельным сообщением для
   Vladimir, у нас read-only доступ).
4. **STOP POINT 1:** показать inventory диаграмму (раздел / кол-во
   формул / какие `buildable: true/false`) + список того, что нужно
   вписать репетитору в таблицу. Ждать `применять`/`давай дальше`.

### ID allocation
5. Присвоить каждой формуле ID формата `<section>.<NN>_e` (для v1).
   `section` использует существующие префиксы: `kin.*` кинематика,
   `dyn.*` динамика, `cons.*` законы сохранения, `stat.*` статика,
   `hydro.*` гидростатика, `ed.*` электродинамика, `opt.*` оптика,
   `mkt.*` МКТ, `oge.*` ОГЭ-специфика. Номер — продолжение уже
   существующего v1 каталога (не v2!).

### formulas.ts
6. Hand-craft добавить в `src/lib/formulaEngine/egorFormulas.ts` (для
   Механика_v1) или — если это новый раздел за пределами механики —
   создать `<section>V1Formulas.ts` и внести в `formulas.ts` aggregator
   по образцу egorFormulas. Все поля `Formula` обязательны кроме
   optional `exam`, `memoryHook`, `buildable`.

### BUILD_RECIPES (только для buildable: true)
7. Для каждой `buildable: true` формулы — запись в `EGOR_BUILD_RECIPES`
   (или аналогичной карте для нового раздела): `displayFormula`,
   `numeratorTokens`, `denominatorTokens`. Токены — LaTeX escape форма
   (`\\omega`, `\\phi`, `2\\pi`), **не Unicode**. Unicode токены после
   commit 0871673 автоматически канонизируются в LaTeX, но лучше
   сразу писать в canonical форме.

### MUTATION_LIBRARY (только для buildable: true)
8. 2 мутации на формулу. Типы — `swap_fraction`, `drop_coefficient`,
   `wrong_power`, `swap_variable`. Hint формулируется от лица
   «Сократа» — короткая педагогическая подсказка.
9. **STOP POINT 2:** показать 3 первые формулы (типичные) +
   Formula entries + recipe + 2 мутации каждой. Ждать
   `применять ко всем`.

### Situations — SKIPPED для v1
В v1 раунде Layer 1 (SituationCard) **отключён** — раунды состоят
только из BuildFormula + TrueOrFalse. Ничего генерить не нужно.

### UI wire-up
10. Если это **новый раздел**, не Механика — расширить `SectionType`
    и `SECTION_POOLS` в `TrainerPage.tsx`, добавить соответствующий
    `SectionKey` в `trainerGamificationStore.ts`, добавить label в
    `BestScoreCard` selector. Pool: `mode: 'v1'` обязательно.
11. Если это дополнение к существующему разделу Механика_v1 —
    ничего в UI не меняется, формулы автоматически попадают в пул
    `egorFormulas`.

### Validation
12. `npx tsc --noEmit` — ноль ошибок.
13. Preview round: запустить раунд на новом разделе, пройти 2-3
    вопроса, убедиться что:
    - Нет дубликата токенов в BuildFormula pool (ожидается после
      `canonicalizeToken`);
    - Блок «Запомни:» показывает `memoryHook`, не generic hardcoded
      trigger;
    - Для `buildable: false` формул раунд не пытается собирать
      BuildFormula-карточку;
    - Если в пуле T и t (или другая case-collision) — плашка легенды
      под пулом со списком `символ — имя (единица)`.
14. **STOP POINT 3:** предложить commit + push. Текст коммита должен
    начинаться с `feat(trainer-v1): ...` или `feat(trainer-<section>):`.

## Критические инварианты (v1)

- **`_e` suffix mandatory** для всех v1 ID, даже если v2 не имеет такого ID.
- **`relatedFormulas` не пересекают v1/v2 границу.**
- **Токены в recipes — LaTeX escape**, не Unicode. `canonicalizeToken`
  в `questionGenerator.ts` нормализует source, но писать всё равно в
  canonical форме.
- **`buildable: false` + мутации — запрещено.** `generateTrueOrFalse`
  игнорирует `MUTATION_LIBRARY[id]` когда `formula.buildable === false`.
- **`memoryHook` — короткий.** 1-2 предложения, до ~200 символов.
  Длиннее не влезет в FeedbackOverlay.

## Anti-spoiler правила

1. **Не показывать ID учёным-ученику.** RoundResultScreen рендерит
   `formula.formula` через MathText, fallback на `buildTitle || name`.
   ID как текст — только внутри dev-консоли и telemetry.
2. **Не вставлять содержание `whenToUse[0]` в prompt карточки без
   санитизации** — иначе в SituationCard (v2) можно выдать текст с
   явным упоминанием конкретной формулы.
3. **Не раскрывать `correctAnswer` в explanation до того, как
   `FeedbackOverlay` зафиксировал `isCorrect`.**

## Parallel ОГЭ track

ОГЭ-версии формул (если репетитор делает подмножество для ОГЭ) живут
в колонке `Экзамен` со значениями `ЕГЭ` / `ОГЭ` / `ЕГЭ+ОГЭ`. В UI
фильтрация по экзамену пока не реализована, но поле в типе есть —
при появлении ОГЭ-режима в `/trainer` оно будет consumed без
миграций данных.

## Канонический пример

**v1 Механика_v1 — Вращение по окружности (10 формул).**
Файлы-образцы:
- `src/lib/formulaEngine/egorFormulas.ts` — Formula entries + recipes + мутации
- `src/lib/formulaEngine/questionGenerator.ts` — v1 distribution + canonicalization
- `src/pages/TrainerPage.tsx` — section `'egor-v1'` + pool `egorFormulas`
- `src/stores/trainerGamificationStore.ts` — `SectionKey = 'egor-v1'`
- `src/components/homework/formula-round/BuildFormulaCard.tsx` — legend render
- `src/components/homework/formula-round/RoundResultScreen.tsx` — formulaMap
  объединяет mechanicsFormulas + egorFormulas для weak-formulas render

Все референсы обновляй синхронно при добавлении нового раздела.
