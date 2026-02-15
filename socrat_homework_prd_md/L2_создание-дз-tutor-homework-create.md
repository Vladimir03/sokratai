## L2 Создание ДЗ (/tutor/homework/create)
**Цель**: мастер создания домашки (3 шага).

### UI
Шаг 1: Title, Subject (6), Topic, Deadline
Шаг 2: Tasks (динамический список): условие/фото, эталон, решение, балл, кнопка `🎲 Вариации`
Шаг 3: Назначить ученикам (чеклист + `Все`)

### Flow submit
- `POST /assignments` → `POST /assign/:id` → `POST /notify/:id` → redirect + toast

### Приёмка
- Созданное ДЗ появляется в L1.
- Назначения и уведомления работают.

### Инструкция для Codex/Claude
Сделай wizard с сохранением черновика в local state, валидацией на каждом шаге, и итоговым submit chain.

---
