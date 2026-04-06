# PRD: AI-помощник репетитора (MVP)

## One-liner

Jobs-first AI workspace для репетитора: создать похожую задачу, решить/объяснить задачу, собрать ДЗ по теме.

---

## Problem

Репетитор тратит 30-60 минут на подготовку к каждому уроку: ищет задачи в сборниках, адаптирует под уровень ученика, составляет ДЗ. AI может сократить это до 5-10 минут — но только если интерфейс предлагает конкретные сценарии, а не пустой чат.

## User

Репетитор по математике/физике, готовит учеников к ЕГЭ/ОГЭ. Работает с 5-15 учениками. Основной паттерн: "мне нужно 3 похожие задачи к завтрашнему уроку".

## Entry point

Top nav → "Помощник" (`/tutor/assistant`)

## Model of trust

AI = черновик. Репетитор всегда ревьюит и может отредактировать результат.

---

## 3 Jobs (MVP scope)

### Job 1: Создать похожие задачи

**Trigger:** "Мне нужно ещё 3 задачи как эта"

**Input:**
- Источник задачи: вставить текст ИЛИ выбрать из Базы знаний
- Экзамен: ЕГЭ / ОГЭ (chips)
- Количество: 1-10 (default 3)

**Quick chips (prompt helpers):**
- `+ проще` / `+ сложнее`
- `+ с ответами`
- `+ того же формата`

**Output:** Карточки задач, каждая содержит:
- Условие задачи
- Краткий ответ (если запрошен)
- Actions: `В ДЗ` | `В мою базу` | `Редактировать` | `Удалить`

**Primary CTA:** "Добавить все в ДЗ" (если > 1 задачи)

---

### Job 2: Решить / объяснить задачу

**Trigger:** "Как решить эту задачу?" / "Как объяснить ученику?"

**Input:**
- Задача: вставить текст ИЛИ выбрать из Базы знаний

**Output (3 блока):**
1. **Краткий ответ** — число/формула/значение
2. **Решение по шагам** — черновик для репетитора
3. **Объяснение для ученика** — упрощённая версия

**Action chips:**
- `Сделать короче` | `Сделать подробнее`
- `Упростить для ученика`
- `Создать похожую` (→ переход в Job 1)
- `Сохранить в базу`

---

### Job 3: Собрать ДЗ по теме

**Trigger:** "Нужно ДЗ по кинематике на 5 задач"

**Input:**
- Тема урока (текст)
- Экзамен: ЕГЭ / ОГЭ
- Количество задач: 3-10 (default 5)

**Output:** Список карточек задач (как в Job 1)

**Primary CTA:** "Добавить всё в ДЗ"
**Secondary:** `Заменить задачу` | `Проще` | `Сложнее` | `Сохранить черновик`

---

## Screen States

### State 1: Landing (default)

```
┌─────────────────────────────────────────────┐
│  AI-помощник репетитора                      │
│  Помогает готовить задачи, решения и домашки │
│                                              │
│  ┌─────────────┐ ┌──────────────┐ ┌────────┐│
│  │  🔄 Создать │ │ 💡 Решить / │ │ 📋 Со- ││
│  │  похожую    │ │  объяснить  │ │  брать ││
│  │  задачу     │ │  задачу     │ │  ДЗ    ││
│  └─────────────┘ └──────────────┘ └────────┘│
│                                              │
│  Последние сессии                            │
│  ├─ Похожие задачи: Кинематика    2 мин назад│
│  ├─ Разбор: Динамика              вчера      │
│  └─ ДЗ: Законы сохранения         3 дня      │
│                                              │
│  ┌─────────────────────────────────────────┐ │
│  │ Опиши, что нужно...            [Enter]  │ │
│  └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

**Mobile:** cards stack vertically, sessions collapse to 2 items.

### State 2: Job workspace (example: Job 1)

```
┌─────────────────────────────────────────────┐
│  ← Назад    Похожие задачи                  │
│                                              │
│  ┌─ INPUT ────────────────────────────────┐ │
│  │ Условие задачи:                        │ │
│  │ [Вставьте текст или выберите из базы]  │ │
│  │                                        │ │
│  │ Экзамен: [ЕГЭ] [ОГЭ]                 │ │
│  │ Количество: [3]                        │ │
│  │                                        │ │
│  │ [+ проще] [+ сложнее] [+ с ответами]  │ │
│  │                                        │ │
│  │           [Создать задачи]             │ │
│  └────────────────────────────────────────┘ │
│                                              │
│  ┌─ OUTPUT (после генерации) ─────────────┐ │
│  │ Задача 1                               │ │
│  │ Тело задачи...                         │ │
│  │ Ответ: 42                              │ │
│  │ [В ДЗ] [В базу] [Редакт.] [Удалить]   │ │
│  │                                        │ │
│  │ Задача 2                               │ │
│  │ Тело задачи...                         │ │
│  │ Ответ: 17                              │ │
│  │ [В ДЗ] [В базу] [Редакт.] [Удалить]   │ │
│  │                                        │ │
│  │        [Добавить все в ДЗ]             │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

**Mobile:** single column, input collapses after generation, output scrollable.

### State 3: Job workspace (example: Job 2)

```
┌─────────────────────────────────────────────┐
│  ← Назад    Решение и объяснение             │
│                                              │
│  ┌─ INPUT ────────────────────────────────┐ │
│  │ [Вставьте задачу или выберите из базы] │ │
│  │                                        │ │
│  │           [Решить задачу]              │ │
│  └────────────────────────────────────────┘ │
│                                              │
│  ┌─ OUTPUT ───────────────────────────────┐ │
│  │ ✅ Краткий ответ                       │ │
│  │ 42 м/с                                 │ │
│  │                                        │ │
│  │ 📝 Решение по шагам                   │ │
│  │ 1. Записываем данные...                │ │
│  │ 2. Применяем формулу...                │ │
│  │ 3. Подставляем значения...             │ │
│  │                                        │ │
│  │ 💬 Объяснение для ученика              │ │
│  │ "Представь, что мяч летит..."          │ │
│  │                                        │ │
│  │ [Короче] [Подробнее] [Упростить]       │ │
│  │ [Создать похожую] [В базу]             │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

---

## Integration points

### Помощник → База знаний
- "В мою базу" на карточке задачи → создаёт `kb_tasks` с `owner_id`
- "Выбрать из базы" в input → открывает picker (existing KB browse UI)

### Помощник → Домашки
- "В ДЗ" / "Добавить все в ДЗ" → добавляет в `hwDraftStore` (Zustand cart)
- Badge на "Домашки" обновляется автоматически

### База знаний → Помощник
- На карточке задачи в KB добавить actions: `AI-похожая` | `Решить`
- Клик → переход на `/tutor/assistant?job=similar&taskId=xxx`

---

## Data model (MVP)

### Sessions (new table: `ai_assistant_sessions`)

```sql
CREATE TABLE ai_assistant_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id UUID NOT NULL REFERENCES auth.users(id),
  job_type TEXT NOT NULL CHECK (job_type IN ('similar', 'solve', 'homework')),
  title TEXT,              -- auto-generated from input
  input_data JSONB,        -- { sourceText, exam, count, chips[] }
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### Generated tasks (new table: `ai_assistant_results`)

```sql
CREATE TABLE ai_assistant_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES ai_assistant_sessions(id) ON DELETE CASCADE,
  result_type TEXT NOT NULL CHECK (result_type IN ('task', 'solution', 'explanation')),
  content JSONB,           -- { text, answer, steps[], explanation }
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

RLS: tutor sees only own sessions.

### AI backend (DECISION: separate function)

- Edge function: `ai-assistant` (single endpoint, job_type routing)
- NOT reusing `chat` function — separate prompts, separate concerns
- Uses Gemini (existing AI gateway pattern)
- Prompt templates per job type, stored in function code
- Streaming response for solve/explain (long output)

### Input method (DECISION: text only in MVP)

- MVP: text input only (paste task text)
- KB picker ("выбрать из базы") deferred to Phase 6 — **РЕАЛИЗОВАНО** (2026-03-14) в `TutorHomeworkCreate.tsx` через `KBPickerSheet`. См. `docs/features/specs/tutor-kb-picker-drawer.md`
- Photo/screenshot upload deferred post-MVP

---

## NOT in MVP

- Персонализация под конкретного ученика
- Загрузка фото/скриншотов задач
- Агентные цепочки (multi-step)
- Memory / CRM логика
- Больше 3 job types
- Вкладка "Чат" (свободный диалог)
- Интеграция с конкретным учеником при создании ДЗ

---

## Implementation phases

### Phase 1: Navigation + placeholder
- Restructure nav (see `tutor-nav-restructure.md`)
- Create empty TutorAssistant page
- Add route

### Phase 2: Landing + Job selection
- Landing page with 3 action cards
- Job workspace shell (input panel + output area)
- "Последние сессии" list (read from `ai_assistant_sessions`)

### Phase 3: Job 1 — Похожие задачи
- Input: text area + exam selector + count + chips
- AI generation (Gemini)
- Output: task cards with actions
- "В ДЗ" → hwDraftStore integration
- "В базу" → kb_tasks creation

### Phase 4: Job 2 — Решить / объяснить
- Input: text area
- AI generation with structured output (answer + steps + explanation)
- Action chips for refinement
- "Создать похожую" → navigate to Job 1

### Phase 5: Job 3 — Собрать ДЗ
- Input: topic + exam + count
- AI generation (batch tasks)
- "Добавить всё в ДЗ"

### Phase 6: Cross-integration
- KB task cards → "AI-похожая" / "Решить" buttons
- Deep links with query params
- **KB picker в визарде ДЗ** — ✅ реализовано (KBPickerSheet, 2026-03-14). См. `docs/features/specs/tutor-kb-picker-drawer.md`

---

## Success metrics (post-MVP)

- % of tutors who use Помощник at least 1x/week
- Average tasks generated per session
- % of generated tasks added to ДЗ or База
- Time from opening Помощник to "В ДЗ" click
