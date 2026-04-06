# Feature Spec: Условие задачи в GuidedThreadViewer

**Версия:** v0.1
**Дата:** 2026-04-06
**Автор:** Vladimir
**Статус:** draft

**Тикет:** Е8 (P2) — `docs/discovery/tickets/2026-04-01-egor-batch.md` Ticket #8
**Источник:** Егор: «В просмотре переписки ученика с AI в ДЗ были видны условия задач. Преподаватель не помнит все задачи по номерам, а их может быть 15. Неудобно листать наверх».

---

## 0. Job Context

### Какую работу закрывает фича?

| Участник | Core Job | Sub-job | Ссылка |
|---|---|---|---|
| Репетитор (B2B) | R1 — Автоматическая проверка ДЗ | R1-4 — давать персональную обратную связь | job-graph.md#R1 |
| Репетитор (B2B) | R2 — Контроль прогресса учеников | R2-3 — утренний обзор AI-сессий | job-graph.md#R2 |

- **B2B-сегмент:** репетиторы физики ЕГЭ/ОГЭ (primary buyer)
- **Wedge alignment:** Косвенно — ускоряет review guided-чатов, повышает доверие к AI-фидбеку
- **Pilot impact:** Убирает frictiona при просмотре переписки ученика. Репетитор видит условие задачи рядом с обсуждением — не нужно держать в голове 15 номеров и листать наверх. Усиливает «утренний обзор» — главный сценарий R2-3 в пилоте.

---

## 1. Summary

В `GuidedThreadViewer` (просмотр guided-чата ученика со стороны репетитора) добавляется блок с условием текущей выбранной задачи. Когда репетитор кликает на фильтр `#1 / #2 / …`, над лентой сообщений показывается collapsible-блок с `task_text` и (если есть) изображением условия. В режиме `Все задачи` блок свёрнут / скрыт.

---

## 2. Problem

### Текущее поведение
В `GuidedThreadViewer.tsx` есть фильтры по задачам (`#1 #2 …`) и лента сообщений. Условие задачи нигде не отображается — репетитор видит только номер. Чтобы понять, о чём идёт речь, надо вспомнить задачу или открыть `TutorHomeworkDetail` в соседней вкладке.

### Боль
- Репетитор у которого 10–15 учеников × 15 задач в ДЗ не помнит конкретные формулировки
- При утреннем review (R2-3) каждое переключение задачи требует контекст-свитча
- AI-фидбек без условия не интерпретируется — теряется ценность guided-чата

### Текущие «нанятые» решения
Открывают `TutorHomeworkDetail` в соседней вкладке и вручную сопоставляют номера.

---

## 3. Solution

### Описание
Над лентой сообщений (под рядом фильтров `#1 #2 …`) рендерится блок «Условие задачи» с `task_text` выбранной задачи и изображением (если `task_image_url` есть). Блок появляется только когда `taskFilter !== 'all'`. По умолчанию раскрыт, есть toggle «Свернуть».

### Ключевые решения

1. **Reuse существующих данных.** `threadQuery.data.tasks` уже содержит `task_text`, `order_num`, `task_image_url` — backend менять не нужно. Если каких-то полей нет в SELECT — расширить SELECT в `handleGetThread` (`homework-api/index.ts`).
2. **Только при выбранной задаче.** В режиме `'all'` блок скрыт — иначе теряет смысл (сообщения от разных задач, какое условие показывать неясно).
3. **LaTeX через `MathText`.** Условие может содержать формулы. Используем уже импортированный в файле `MathText`.
4. **Изображение через `ThreadAttachments`.** Тот же helper, что используется для `image_url` сообщений (резолвит `storage://` через signed URL). Compact-вариант.
5. **Collapsible, по умолчанию раскрыт.** Локальный `useState(true)`. Сбрасывается на `true` при смене `taskFilter`.
6. **Никакого нового state в backend, никаких миграций.** Чистый UI-патч.

### Scope

**In scope:**
- Блок «Условие задачи» в `GuidedThreadViewer.tsx`
- Рендер `task_text` через `MathText`
- Рендер `task_image_url` через `ThreadAttachments` (если поле есть в `tasks` payload)
- Collapsible-toggle (свернуть/раскрыть)
- Расширение SELECT в `handleGetThread`, если `task_text` / `task_image_url` сейчас не возвращаются

**Out of scope:**
- Sticky-sidebar layout (требует более крупного рефакторинга viewer)
- Inline edit условия задачи из viewer
- Отображение `correct_answer` / `solution` (это уже есть в `TutorHomeworkDetail` и не относится к данному тикету)
- Изменения student-side guided chat

---

## 4. User Stories

### Репетитор
> Когда я открываю переписку ученика по конкретной задаче в guided-чате, я хочу видеть условие этой задачи прямо над сообщениями, чтобы не переключаться между вкладками и быстро понимать, о чём идёт обсуждение.

---

## 5. Technical Design

### Затрагиваемые файлы
- `src/components/tutor/GuidedThreadViewer.tsx` — добавить блок «Условие задачи» между рядом фильтров и контейнером сообщений; локальный state `isTaskContextExpanded`
- `supabase/functions/homework-api/index.ts` — `handleGetThread`: убедиться, что в payload `tasks[*]` возвращаются `task_text` и `task_image_url`; при необходимости расширить SELECT (минимальный диф)
- `src/lib/tutorHomeworkApi.ts` — при необходимости расширить тип `ThreadTask` полями `task_text: string`, `task_image_url: string | null`

### Data Model
Без изменений. Поля уже есть в `homework_tutor_tasks`.

### API
Расширение существующего ответа `GET /threads/:id` (если поля сейчас не отдаются). Контракт: `tasks[*]` дополнительно содержит:
```ts
task_text: string
task_image_url: string | null
```

### Миграции
Нет.

---

## 6. UX / UI

### Структура (текстовый mockup)

```
[ Все задачи ] [ #1 active ] [ #2 done ] [ #3 locked ] ...
┌──────────────────────────────────────────────────────┐
│ Условие задачи #1                       [ Свернуть ] │
│ ─────────────────────────────────────────────────── │
│  Тело груза массой m = 2 кг скользит по наклонной…  │
│  (рендер MathText, формулы $$F = ma$$)              │
│  [миниатюра изображения, если есть]                  │
└──────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────┐
│ Лента сообщений (как сейчас)                         │
└──────────────────────────────────────────────────────┘
```

### UX-принципы (doc 16)
- **AI = draft + action**: репетитор должен видеть контекст AI-обсуждения целиком, без переключения экранов
- **Минимизация контекст-свитча**: одно окно, один взгляд
- **Информация рядом с действием** — условие рядом с перепиской, а не в отдельном экране

### UI-паттерны (doc 17)
- Карточка-обёртка: `rounded-md border bg-background p-3 text-xs space-y-2` — консистентно с лентой сообщений
- Без вложенных карточек с border внутри (anti-pattern из 90-design-system)
- Иконка toggle: `ChevronDown` / `ChevronUp` из `lucide-react`. Никаких emoji
- LaTeX: `MathText` (lazy KaTeX, уже импортирован в файле)
- Изображение: `ThreadAttachments` `compact`-вариант, `loading="lazy"` (соблюдается helper-ом)
- Цвета строго из дизайн-системы (`bg-background`, `border`, `text-muted-foreground`)

### Cross-browser
- Никаких `:has()`, `Array.at()`, `crypto.randomUUID()`, framer-motion. Только tailwindcss-animate
- Изображения через `ThreadAttachments` (уже Safari-safe)

---

## 7. Validation

### Acceptance Criteria (testable)

- **AC-1:** Открыть `TutorHomeworkResults` → раскрыть карточку ученика → дождаться загрузки `GuidedThreadViewer` → кликнуть фильтр `#2`. **PASS:** над лентой сообщений появился блок «Условие задачи #2» с текстом задачи. **FAIL:** блок отсутствует или содержит текст другой задачи.
- **AC-2:** В блоке «Условие задачи» нажать «Свернуть». **PASS:** body блока скрывается, заголовок и кнопка остаются; повторное нажатие раскрывает. Изменение `taskFilter` сбрасывает state в раскрытый.
- **AC-3:** Кликнуть фильтр `Все задачи`. **PASS:** блок «Условие задачи» полностью скрыт.
- **AC-4:** Открыть задачу с LaTeX (`$$F = ma$$`) и изображением условия. **PASS:** формулы рендерятся через KaTeX, миниатюра изображения отображается через `ThreadAttachments`. **FAIL:** raw `$$...$$` в тексте или broken `storage://` ссылка.
- **AC-5:** `npm run lint && npm run build && npm run smoke-check` проходят без новых ошибок.
- **AC-6:** В Safari (desktop + iOS) блок не ломает layout viewer (нет горизонтального скролла, нет auto-zoom при тапе).

### Метрики успеха
- Качественная: Егор подтверждает в feedback-чате, что больше не открывает соседнюю вкладку при review
- Количественная (если будет инструментирование позже): среднее время review одного guided-чата ↓

### Связь с pilot KPI
R2-3 «утренний обзор AI-сессий» — ключевой scenario пилота. Ускоряем этот flow → больше шансов на конверсию пилота в платный (15 апреля).

### Smoke check
```bash
npm run lint && npm run build && npm run smoke-check
```

---

## 8. Risks & Open Questions

| Риск | Вероятность | Митигация |
|---|---|---|
| `tasks[*]` в ответе `handleGetThread` не содержит `task_text` / `task_image_url` | Средняя | Расширить SELECT в `handleGetThread` (минимальный диф, не трогая RLS) и тип `ThreadTask` |
| Очень длинное условие ломает layout viewer | Низкая | `max-h-[200px] overflow-y-auto` в expanded state, `break-words` |
| `task_image_url` хранится как `storage://...` и не разрешается на клиенте | Низкая | Использовать `getHomeworkImageSignedUrl` (тот же resolver, что для `message.image_url` уже в файле) |
| Регрессия в realtime-merge (Е9) | Низкая | Не трогаем `mergeThreadMessage`. Только UI |

### Открытые вопросы
1. Нужно ли отображать condition-блок на `TutorHomeworkDetail` так же, как на `TutorHomeworkResults`? — **Предложение:** да, единообразно, т.к. это один и тот же компонент `GuidedThreadViewer`. По умолчанию реализуется во всех использованиях.
2. Показывать `correct_answer` под условием? — **Нет,** out of scope (есть в Detail-странице). Можно в Parking Lot.

---

## 9. Implementation Tasks (краткий план)

> Полная нарезка → `tasks.md` после approve

- [ ] TASK-1: Backend — расширить SELECT/тип `ThreadTask` полями `task_text`, `task_image_url` (если отсутствуют). Файлы: `supabase/functions/homework-api/index.ts`, `src/lib/tutorHomeworkApi.ts`
- [ ] TASK-2: Frontend — добавить блок «Условие задачи» в `GuidedThreadViewer.tsx` с `MathText` + collapsible toggle + reset on `taskFilter` change
- [ ] TASK-3: Frontend — интеграция `ThreadAttachments` (compact) для `task_image_url`
- [ ] TASK-4: Manual QA по AC-1…AC-6 в Chrome desktop + Safari iOS
- [ ] TASK-5: Прогнать `npm run lint && npm run build && npm run smoke-check`

---

## Parking Lot

- **Sticky-sidebar layout**: условие задачи как боковая колонка, всегда видимая. Контекст: более амбициозный layout, требует рефакторинга viewer. Revisit: после feedback по collapsible-варианту.
- **Inline correct_answer / solution в блоке условия.** Контекст: всплыло при обсуждении AC-2. Revisit: если репетиторы попросят явно.
- **Inline edit условия из viewer.** Контекст: «раз уж вижу — хочу поправить опечатку». Revisit: вместе с E5 (KB editor improvements).
- **Метка КИМ-номера / max_score рядом с условием.** Контекст: связано с Ж2 (статистика ЕГЭ). Revisit: после Ж2.

---

## Checklist перед approve

- [x] Job Context заполнен
- [x] Привязка к R1-4, R2-3
- [x] Scope чётко определён (in/out)
- [x] UX-принципы из doc 16 учтены
- [x] UI-паттерны из doc 17 учтены
- [x] Pilot impact описан
- [x] Метрики успеха определены
- [x] High-risk файлы не затрагиваются (`GuidedThreadViewer.tsx` не входит в high-risk список)
- [x] Student/Tutor изоляция не нарушена (правки только в tutor-домене)
