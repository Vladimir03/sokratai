# Discovery Signals — Feedback Loop из пилота

## Зачем

Наблюдения из пилота остаются в голове или в Telegram saved messages. Discovery-документы устаревают, фичи строятся на допущениях двухмесячной давности.

**Signals** — максимально лёгкий формат для фиксации наблюдений за 2 минуты. Каждый signal — один файл. Накапливаются, потом агент обрабатывает их и обновляет Discovery-документы.

## Как записать signal (2 минуты)

1. Создай файл: `{YYYY-MM-DD}-{короткое-описание}.md`
2. Скопируй шаблон из `_SIGNAL-TEMPLATE.md`
3. Заполни 4 поля. Всё.

Пример: `2026-03-31-egor-ne-ispolzuet-guided-chat.md`

## Формат файла

```markdown
---
date: 2026-03-31
source: pilot / interview / analytics / support / observation
participant: B2B-1 / B2C-1 / B2C-4 (сегмент из Матрицы)
job_ref: R1 / P2 / S1 (Core Job из Графа работ, если применимо)
strength: strong / medium / weak
type: confirms / contradicts / new_insight
---

{Что наблюдал — 1-3 предложения. Конкретика: кто, что сделал/сказал, в каком контексте.}

**Импликация для продукта:** {Что это значит — 1 предложение.}
```

## Типы signals

- **confirms** — подтверждает гипотезу из Discovery (усиливает уверенность)
- **contradicts** — противоречит гипотезе (нужно пересмотреть)
- **new_insight** — новая информация, не покрытая текущими документами

## Workflow обработки

Раз в 1-2 недели (или по накоплению 5+ signals):

1. Агент читает все signals с последней обработки
2. Группирует по Core Job
3. Обновляет релевантные Discovery-документы (01–10)
4. Помечает обработанные signals (переносит в `_processed/`)

## Связь с Discovery-документами

| Signal type | Какой документ обновлять |
|---|---|
| Новый job / sub-job | 03-high-level-jobs-inventory, 04-jobs-graph |
| WTP-сигнал | 09-wtp-pricing-memo |
| Новое «нанятое» решение | 06-current-solutions-hiring-matrix |
| Подтверждение/опровержение wedge | 08-wedge-decision-memo |
| Новый сегмент / пересечение | Сегментация (SokratAI_AJTBD_Сегментация/) |

## Интеграция с Telegram

Ты пишешь заметки в Telegram saved messages. Workflow:

1. Пишешь в Telegram как обычно
2. Раз в неделю: копируешь заметки сюда в формате signal
3. Или: просишь агента «обработай мои заметки» — вставляешь текст, агент создаёт signal-файлы

Автоматизация через Telegram-бот (future): бот принимает голосовое/текст → создаёт signal-файл автоматически.
