# Домашки — UX/UI аудит и рекомендации по всему флоу

**Дата:** 2026-03-17
**Роль:** Senior UX/UI Designer (EduTech)
**Скоуп:** Полный flow: База знаний → Создание ДЗ → Прорешивание учениками с AI → Результаты

---

## Часть 1. Диагностика текущих проблем

### 1.1 Список ДЗ — плоский flat list без структуры

**Проблема:** Страница `/tutor/homework` показывает все ДЗ плоским списком (grid 3×N) с тремя фильтрами: Все / Активные / Завершённые. У репетитора с 10+ учениками и 5+ уроками в неделю за месяц накапливается 20–40 ДЗ. Flat list становится бесполезным — нельзя быстро найти нужное ДЗ.

**Что не хватает:**
- Группировки (по ученику, по теме, по дате)
- Поиска / фильтра по названию
- Сортировки (дедлайн, дата создания, % выполнения)
- Визуальной индикации срочности (дедлайн сегодня/просрочен)
- Kanban-вида по статусам (черновик → активное → на проверке → завершено)

**Что делают конкуренты:**
- **Google Classroom** — assignment list + calendar view с due dates, группировка по Topics
- **Canvas LMS** — SpeedGrader + assignment groups с весами, Kanban-like "To Do" dashboard
- **DIDAK** — фильтр по ученикам, группы (классы), отображение времени выполнения
- **Stepik** — группировка по модулям, прогресс-бары по группам

---

### 1.2 Редактирование ДЗ — минимальная модалка vs полный конструктор

**Проблема:** При нажатии "Редактировать" открывается модалка с 4 полями: Название, Предмет, Тема, Дедлайн. Нельзя:
- Добавить/удалить задачи
- Поменять порядок задач
- Изменить текст задач
- Добавить/удалить учеников
- Изменить баллы

Это критически ограничивает Job B2 (собрать релевантное ДЗ) — если репетитор допустил ошибку или хочет обновить ДЗ после урока, ему нужно создавать новое.

**Что делают конкуренты:**
- **Google Classroom** — полное inline-редактирование задания (все поля, включая прикреплённые файлы, учеников, deadline)
- **Canvas** — переход на полную форму редактирования, идентичную форме создания
- **DIDAK** — редактирование теста: можно менять задания, добавлять новые, менять порядок

**Best practice:** Форма редактирования = форма создания с pre-filled данными.

---

### 1.3 Нет единого пайплайна KB → ДЗ → Результаты

**Проблема:** Три экрана (KB, Create HW, HW Results) существуют изолированно. Нет навигационной связки:
- Из результатов ДЗ нельзя перейти к похожим задачам в KB
- Из KB нельзя увидеть, в каких ДЗ задача использовалась
- Из детали ДЗ нельзя быстро собрать "повторное ДЗ" по тем же темам

---

## Часть 2. Анализ конкурентов по всему flow

### 2.1 Сводная таблица конкурентов

| Этап flow | Google Classroom | Canvas LMS | DIDAK | Stepik | Khan (Khanmigo) | Сократ (текущий) |
|-----------|-----------------|------------|-------|--------|-----------------|------------------|
| **Хранение задач** | Google Drive вложения | Question Banks | Банк заданий | Шаги / уроки | Библиотека упражнений | KB (Каталог + Моя база) |
| **Создание ДЗ** | Assignment form | Assignment + Rubric | Тест-конструктор | Module editor | Автоподбор | 1 большое окно |
| **Группировка ДЗ** | Topics | Assignment Groups | Группы (классы) | Модули | По курсу | Только 3 фильтра |
| **Назначение** | Класс / группа / индивид | Sections / индивид | Группы / индивид | Класс | Класс | Ученик / группа |
| **Прорешивание** | Google Forms / Docs | SpeedGrader inline | Авто (ч.1) + ручная (ч.2) | Интерактив | AI-guided | Classic + Guided Chat |
| **Результаты** | Оценки в таблице | Gradebook + Analytics | Аналитика + время | Прогресс-бар | Прогресс | Summary + bar chart |
| **Обратная связь** | Комментарии | Rubric + speedgrader | Аудио-комментарии | — | AI-guided | AI feedback + tutor override |
| **Связь с банком** | Нет | Question Bank → Quiz | Банк → ДЗ | Step bank → Module | Авто | KB → HW (через picker) |

### 2.2 Best practices, которые стоит перенять

**От Google Classroom:**
- Calendar view для ДЗ с дедлайнами — репетитор видит нагрузку учеников
- Topic grouping — группировка по темам, а не flat list
- Full edit mode — форма редактирования = форма создания

**От Canvas:**
- Assignment Groups с drag-and-drop порядком
- SpeedGrader — быстрая проверка прямо в потоке, без перехода между страницами
- Gradebook — единая таблица "ученик × задание" для обзора

**От DIDAK:**
- Фильтр по ученику — "показать ДЗ только для Иванова"
- Аудио-комментарии к решениям — быстрее текста
- Время выполнения — сколько минут ученик потратил на ДЗ

**От Stepik:**
- Модули / секции для иерархии
- Прогресс-бар по каждому ученику на каждый модуль

---

## Часть 3. Рекомендации по улучшению

### Категория A: Quick Wins (1–3 дня)

#### A1. Quick Edit модалка → Full Edit page
**Job:** B2 — собрать релевантное ДЗ, B5 — выдать в понятном порядке

Вместо модалки с 4 полями → переход на `/tutor/homework/:id/edit` — полная форма, идентичная `TutorHomeworkCreate.tsx`, но pre-filled данными. Конкретно:

**Кнопку "Редактировать" → заменить** на переход к полной форме.

**Effort:** 3–5 дней | **Impact:** высокий (устраняет critical friction)

#### A2. Сортировка списка ДЗ
**Job:** E4 — чувствовать системность

Добавить dropdown сортировки на страницу списка:
- По дате создания (новые первыми) — default
- По дедлайну (ближайшие первыми)
- По % выполнения (меньше — первыми, для attention management)

**Effort:** 0.5 дня | **Impact:** средний

#### A3. Индикация срочности дедлайна
**Job:** B5 — выдать ДЗ в понятном порядке

На карточке ДЗ в списке добавить визуальную индикацию:
- Дедлайн сегодня → amber badge "Сегодня"
- Дедлайн просрочен → red badge "Просрочено"
- Дедлайн через 1–2 дня → subtle amber border

**Effort:** 0.5 дня | **Impact:** средний

---

### Категория B: Medium-term (1–2 недели)

#### B1. Группировка ДЗ по ученику/теме
**Job:** E3 — не терять качество при 10+ учениках, E4 — системность

Добавить tabs-переключатель вида:
- **Все** (текущий flat list) — для общего обзора
- **По ученикам** — ДЗ сгруппированы по ученику, collapsed accordion
- **По темам** — ДЗ сгруппированы по topic field

В режиме "По ученикам" карточка показывает: имя ученика → список его ДЗ с progress bar.

**Effort:** 1 неделя | **Impact:** высокий (scalability для 10+ учеников)

#### B2. Поиск по ДЗ
**Job:** E2 — переиспользовать, E4 — системность

Search bar вверху списка ДЗ: поиск по title, topic, student name.

**Effort:** 2–3 дня | **Impact:** средний-высокий

#### B3. "Повторное ДЗ" из результатов
**Job:** C1 — создать похожие задачи, B2 — собрать ДЗ

На странице результатов ДЗ → кнопка "Создать повторное ДЗ":
- Предзаполняет тему и предмет из текущего ДЗ
- Переходит в конструктор с теми же задачами (или предлагает AI-generated задачи по той же теме)
- Исключает задачи, которые ученик решил правильно

**Effort:** 3–5 дней | **Impact:** высокий (retention, wedge acceleration)

#### B4. Inline task editing на странице детали ДЗ
**Job:** B2, B4 — не повторять задачи

Вместо перехода в полный конструктор для мелких правок:
- Клик по тексту задачи → inline textarea
- Изменение ответа, баллов → inline input
- Drag-and-drop порядка задач

**Effort:** 1 неделя | **Impact:** средний

#### B5. Progress dashboard — единая таблица "Ученик × ДЗ"
**Job:** E3 — контроль при 10+ учениках

Новая вкладка или view на странице списка ДЗ:
- Таблица: строки = ученики, столбцы = ДЗ
- Ячейка: цветной индикатор (зелёный = сдал, жёлтый = в процессе, красный = просрочено, серый = не начал)
- Клик по ячейке → переход к деталям submission

Аналог: Canvas Gradebook, Google Classroom Grading.

**Effort:** 1.5 недели | **Impact:** очень высокий для сегмента 10+ учеников

---

### Категория C: Strategic features (2–4 недели)

#### C1. Calendar view для ДЗ
**Job:** E4 — системность, B1 — понять что было на уроке

Переключатель вида: List / Calendar. Calendar view:
- Месячный/недельный вид
- ДЗ отображаются на дате дедлайна
- Drag-and-drop для переноса дедлайнов
- Клик → быстрый просмотр

Аналог: Google Classroom Calendar, Notion Calendar.

**Effort:** 2 недели | **Impact:** высокий (системность и планирование)

#### C2. Аналитика по ученику (Student Profile)
**Job:** E3, E4

Страница ученика с агрегированной статистикой:
- Все ДЗ ученика с scores
- Тренд по темам (сильные/слабые стороны)
- Рекомендации AI: "Ученику стоит подтянуть кинематику (avg 45%)"

**Effort:** 3 недели | **Impact:** высокий (retention, дифференциация от конкурентов)

#### C3. AI-summary по результатам ДЗ
**Job:** D3 — объяснить ученику, E3 — качество при масштабе

На странице результатов → кнопка "AI-сводка":
- Генерирует краткое summary: "5 из 7 учеников справились. Основная ошибка — неправильное применение второго закона Ньютона в задаче 3. Рекомендация: дать дополнительную практику на динамику."
- Action layer: "Создать ДЗ по слабым темам" → переход в конструктор

**Effort:** 1.5 недели | **Impact:** высокий (AI value prop, wedge)

#### C4. Связка KB ↔ ДЗ ↔ Результаты (deep linking)
**Job:** E2 — переиспользование

Навигационные связки между модулями:
- В KB карточке задачи → badge "Использована в 3 ДЗ" + ссылка
- В результатах ДЗ → по каждой задаче ссылка "Похожие задачи в KB"
- В результатах → "Задачи на закрепление" → KB filtered view

**Effort:** 2 недели | **Impact:** средний-высокий (retention, bundle value)

---

## Часть 4. Рекомендация по редактированию ДЗ (подробно)

### Текущий UX vs. Целевой UX

| Аспект | Текущий | Целевой |
|--------|---------|---------|
| Точка входа | Кнопка "Редактировать" → модалка | Кнопка "Редактировать" → полная страница |
| Доступные поля | Title, Subject, Topic, Deadline | Все поля из конструктора |
| Задачи | Нельзя менять | Добавление, удаление, правка текста, порядок |
| Ученики | Нельзя менять | Добавление / удаление |
| Материалы | Нельзя менять | Добавление / удаление |

### Рекомендуемый подход: "Edit"

**Full Edit (полная форма):**
- Для значительных правок: задачи, ученики, материалы
- Открывается по кнопке "Редактировать" (primary action)
- Переиспользует `TutorHomeworkCreate.tsx` в режиме edit
- Pre-fills все данные из API
- При сохранении: обновляет существующее ДЗ (PUT), а не создаёт новое

**Реализация Full Edit:**
```
Route: /tutor/homework/:id/edit
Component: TutorHomeworkCreate.tsx + editMode prop

Отличия от create mode:
- Загрузка данных из API при mount (useQuery)
- Pre-fill всех полей
- Кнопка "Сохранить изменения" вместо "Создать ДЗ"
- Не пересоздавать assignment — PUT update
- Если status = 'active': warning "ДЗ уже отправлено. Изменения увидят все ученики."
- Если добавлены новые ученики: опция "Уведомить новых учеников"
```

### UX considerations для edit mode

1. **Destructive actions protection:** Удаление задачи из активного ДЗ → confirmation dialog: "Ученики, уже начавшие решение, потеряют свой прогресс по этой задаче."
2. **Concurrent edit warning:** Если ученик уже решает guided chat → нельзя менять задачи mid-session. Warning + disable editing для задач "в процессе решения".
3. **Version history (future):** Сохранять diff при каждом edit. Репетитор видит "Изменено 15 мар → добавлена задача 4".

---

## Часть 5. Соответствие UX-принципам (doc 16)

| Принцип | Текущее | После улучшений |
|---------|---------|-----------------|
| #1 Jobs-first | Список ДЗ есть, но без structure | Группировка + search = быстрый доступ |
| #2 Один экран = одна работа | ДЗ Detail page = view + results + edit | Разделение: Detail (view), Results, Edit |
| #3 Recognition over recall | Flat list — нужно помнить что ищешь | Группировка + фильтры + search |
| #5 AI output → действие | AI feedback есть, но нет "next action" | C3: AI-summary → "Создать ДЗ по слабым темам" |
| #6 Прозрачный статус | Status badges есть (draft/active/closed) | + Индикация дедлайна + прогресс по ученикам |
| #7 Progressive disclosure | Создание = 3-step wizard ✓ | Edit = та же форма + quick edit модалка |
| #8 Частые сценарии на виду | "Создать ДЗ" видно ✓ | + "Повторное ДЗ" на results page |

---

## Часть 6. Рекомендуемый план реализации

### Sprint 1 (неделя 1): P0 Quick Wins
1. **Сортировка списка ДЗ** — dropdown на `TutorHomework.tsx`
2. **Deadline urgency badges** — amber/red на карточках в списке

### Sprint 2 (неделя 2–3): P0 Full Edit
3. **Full Edit page** — переиспользование `TutorHomeworkCreate.tsx` в edit mode

### Sprint 3 (неделя 3–4): P1 Structure
4. **Группировка по ученику/теме** — tabs на списке ДЗ
5. **Поиск по ДЗ** — search bar
6. **"Повторное ДЗ"** — кнопка на results page

### Sprint 4 (неделя 5–6): P1 Dashboard
7. **Progress dashboard** — таблица "ученик × ДЗ" с цветными ячейками

### Sprint 5 (неделя 7–8): P2 AI & Calendar
8. **AI-summary по результатам** — генерация + action "Создать ДЗ по слабым темам"
9. **Calendar view** — переключатель List / Calendar

---

## Часть 8. Промпт для Claude Code

### Sprint 1: LaTeX + Sort + Deadline (Паттерн 3, UX Polish) — IMPLEMENTED

> **Student-side Sprint S1** (MathText + Bootstrap + Input Safety) реализован 2026-03-19.
> См. `docs/features/specs/student-homework-sprint-s1-spec.md`.

```text
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Нужно реализовать UX polish для Домашек.

Контекст:
- сегмент: репетиторы по физике ЕГЭ/ОГЭ
- wedge: быстро собрать ДЗ и новую практику по теме урока
- продукт = workspace / bundle: AI + база + домашки + материалы

Прочитай документы:
1. docs/product/specs/tutor_ai_agents/16-ux-principles-for-tutor-product-sokrat.md
2. docs/product/specs/tutor_ai_agents/17-ui-patterns-and-component-rules-sokrat.md
3. docs/features/specs/homework-ux-audit-and-improvements.md
4. CLAUDE.md

Реализуй Sprint 1 (3 задачи):

1. MathText в TutorHomeworkDetail.tsx:
   - task_text → <MathText text={task.task_text} />
   - correct_answer → <MathText text={task.correct_answer} />
   - Также в TutorHomeworkResults.tsx: task_text, AI feedback

2. Сортировка списка ДЗ в TutorHomework.tsx:
   - Dropdown: "По дате" (default), "По дедлайну", "По выполнению"
   - Сортировка client-side (данные уже загружены)

3. Deadline urgency badges в TutorHomework.tsx:
   - Дедлайн сегодня → amber "Сегодня"
   - Просрочен → red "Просрочено"
   - parseISO из date-fns (CLAUDE.md: Safari compatibility)

Важно:
- MathText уже существует: src/components/kb/ui/MathText.tsx
- Не трогать high-risk files
- md: для structural breakpoints
- Нет framer-motion в ui/*

В конце обязательно:
1. changed files
2. summary
3. validation results
4. docs-to-update checklist
```

### Sprint 2: Full Edit (Паттерн 2, Рефакторинг)

```text
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Нужно добавить Full Edit mode для ДЗ.

Прочитай docs 16, 17 + docs/features/specs/homework-ux-audit-and-improvements.md + CLAUDE.md.

Сначала сделай audit:
1. Как TutorHomeworkCreate.tsx может быть переиспользован для edit
2. Какие API-эндпоинты нужны для update assignment + tasks + students
3. Какие edge cases: edit active HW, guided chat in progress

Потом план:
1. Route: /tutor/homework/:id/edit
2. Переиспользование TutorHomeworkCreate с editMode prop
3. Pre-fill из API
4. PUT update вместо POST create
5. Warnings для active assignments

Формат: audit → plan → одобрение → реализация по фазам.
```

---

*Документ подготовлен на основе анализа кода (TutorHomework.tsx, TutorHomeworkDetail.tsx, TutorHomeworkResults.tsx, TutorHomeworkCreate.tsx), продуктовых спецификаций (Jobs Graph, Opportunity Map, UX Principles, UI Patterns), скриншотов текущего UI и исследования конкурентов (Google Classroom, Canvas LMS, DIDAK, Stepik, Khan Academy).*
