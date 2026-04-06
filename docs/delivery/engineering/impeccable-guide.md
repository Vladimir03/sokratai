# Impeccable — руководство по использованию в Claude Code

## Что это

Impeccable (impeccable.style) — набор из 1 skill + 20 design-команд для Claude Code (и Cursor/Gemini CLI/Codex). Добавляет "дизайнерский словарь" в AI — вместо "поправь UI" ты говоришь `/audit`, `/colorize`, `/typeset` и получаешь точечные, осмысленные правки.

## Установка

Открой терминал в папке проекта (`C:\Users\kamch\sokratai`) и выполни:

```bash
npx skills add pbakaus/impeccable
```

Это автоматически создаст файлы в `.claude/` (для Claude Code), `.cursor/` (для Cursor) и т.д.

**Альтернатива — через Claude Code plugin marketplace:**

```
/plugin marketplace add pbakaus/impeccable
```

## Обновление

```bash
npx skills update
```

Файл `.impeccable.md` (твой design context) сохраняется при обновлении.

## Подготовка проекта (УЖЕ СДЕЛАНО)

Impeccable автоматически читает `.claude/rules/` — мы уже создали:

- `.claude/rules/90-design-system.md` — цветовая палитра, типографика (Golos Text), spacing, компоненты, anti-patterns
- `docs/delivery/features/ux-audit/ux-audit-2026-04-02.md` — полный UX-аудит 10 экранов
- `docs/discovery/research/конкуренты/edtech_competitors_analysis.md` — анализ конкурентов

Impeccable подхватит design tokens из `90-design-system.md` и будет применять их при каждой команде.

## Команды — полный список (20 штук)

Команды можно вызывать как `/command` или `/i-command` (с префиксом, если конфликт с встроенными).

### Диагностика

| Команда | Что делает |
|---------|-----------|
| `/audit` | Находит UI-проблемы, выставляет severity P0-P3. Оценивает 5 измерений. Начни с этого |
| `/critique` | Оценивает по 10 эвристикам Нильсена (usability heuristics) |

### Качество

| Команда | Что делает |
|---------|-----------|
| `/normalize` | Выравнивает spacing, padding, margins по системе |
| `/polish` | Общая полировка — финальный проход по всему |
| `/optimize` | Оптимизация производительности UI (bundle, lazy loading) |
| `/harden` | Укрепляет edge cases — ошибки, пустые состояния, loading states |

### Интенсивность

| Команда | Что делает |
|---------|-----------|
| `/quieter` | Делает тише — убирает визуальный шум, упрощает |
| `/bolder` | Делает смелее — усиливает контраст, акценты, CTA |

### Адаптация

| Команда | Что делает |
|---------|-----------|
| `/clarify` | Улучшает ясность — labels, hierarchy, affordances |
| `/distill` | Упрощает — убирает лишнее, оставляет суть |
| `/adapt` | Адаптирует под контекст (мобайл, доступность и т.д.) |

### Улучшения

| Команда | Что делает |
|---------|-----------|
| `/animate` | Добавляет осмысленные анимации и transitions |
| `/colorize` | Фиксит цвета — приводит к палитре из design system |
| `/delight` | Добавляет "вау" моменты — micro-interactions, polish |
| `/onboard` | Улучшает онбординг и first-time UX |
| `/typeset` | Фиксит типографику — размеры, weights, line-height |
| `/arrange` | Фиксит layout и расположение элементов |
| `/overdrive` | Продвинутые визуальные эффекты (BETA) |

### Системные

| Команда | Что делает |
|---------|-----------|
| `/teach-impeccable` | Обучает Impeccable твоему design context |
| `/extract` | Извлекает design tokens из существующего кода |

## Рекомендованный порядок для SokratAI

### Шаг 1: Диагностика
```
/audit
```
Покажет все проблемы с severity. Наш `90-design-system.md` задаст контекст.

### Шаг 2: Цвета
```
/colorize
```
Приведёт все цвета к нашей палитре (#1B6B4A accent, #1E293B primary, #F8FAFC background и т.д.). Это самый массовый фикс — затронет ~30+ файлов.

### Шаг 3: Типографика
```
/typeset
```
Убедится что Golos Text используется везде, размеры соответствуют системе.

### Шаг 4: Layout
```
/arrange
```
Выровняет spacing и layout по нашим токенам (4/8/12/16/24/32px).

### Шаг 5: Нормализация
```
/normalize
```
Приведёт всё к единому стилю — padding, margins, border-radius.

### Шаг 6: Полировка
```
/polish
```
Финальный проход — подчищает мелочи.

### Бонус: Edge cases
```
/harden
```
Проверит пустые состояния, loading, error states.

## Связки команд

Impeccable команды хорошо работают в цепочках:

- `audit` → `normalize` → `polish` (стандартный cleanup)
- `audit` → `colorize` → `typeset` → `polish` (полный design system apply)
- `critique` → `clarify` → `distill` (UX улучшение)
- `quieter` ↔ `bolder` (парные — если перестарался в одну сторону)

## Важно

- Impeccable работает **файл за файлом** или **компонент за компонентом** — не пытается переписать всё сразу
- После каждой команды проверяй diff и при необходимости откатывай
- `90-design-system.md` — твой главный рычаг. Если Impeccable делает что-то не так — уточни правила в этом файле
- Команды идемпотентны — можно запускать повторно
