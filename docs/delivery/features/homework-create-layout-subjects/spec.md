# Feature Spec: Homework Create — L0 Layout Reshuffle + Subjects Unification

**Версия:** v0.1
**Дата:** 2026-04-14
**Автор:** Vladimir
**Статус:** draft

---

## 0. Job Context

### Какую работу закрывает эта фича?

| Участник | Core Job | Sub-job | Ссылка на Граф |
|---|---|---|---|
| Репетитор (B2B) | R4: Контроль и качество на масштабе | R4-1: Быстро собрать ДЗ под конкретного ученика/группу | job-graph.md#R4 |
| Школьник (B2C) | S1: Сдать ЕГЭ/ОГЭ на целевой балл | S1-3: Получить задание от репетитора и начать решение вовремя | job-graph.md#S1 |

> Не закрывает работу родителя (P) — фича про внутренний конструктор репетитора.

### Wedge-связка

- **B2B-сегмент:** B2B-1 (репетиторы физики ЕГЭ/ОГЭ, hourly rate 3000-4000₽)
- **B2C-сегмент:** B2C-1 (школьники 16-18 лет под экзамен)
- **Score матрицы:** high (R4-1 — ключевой job недели по объёму)

### Pilot impact

Сейчас репетитор теряет минуту на заполнение «Темы», которое не связано ни с одним downstream-флоу (AI не использует поле, уведомления не включают), а при выборе «не физика/математика» создание ДЗ падает с 400 VALIDATION на backend — ученик вообще не получает уведомление. Починка убирает шум в основном job-flow репетитора и закрывает silent failure на 9 предметах из 14 списка, что напрямую поддерживает пилотных репетиторов-нефизиков (русский, биология, история) и снимает блок на масштабирование.

---

## 1. Summary

Перестроить L0-блок конструктора ДЗ (`/tutor/homework/create`) — убрать поле «Тема», перенести «Название» и «Дедлайн» из расширенных параметров в L0, сделать «Название» обязательным. Параллельно — привести список `VALID_SUBJECTS` в edge function `homework-api` в соответствие со списком `SUBJECTS` во фронтенде, чтобы создание ДЗ работало для всех 14 предметов, а не только для 5 пересекающихся.

Это две небольшие, связанные по scope правки: перестановка полей формы и устранение silent failure при создании/обновлении ДЗ по non-math/physics/chemistry/history/social/english предметам. Multi-photo upload вынесен в отдельную спеку `homework-multi-photo`.

---

## 2. Problem

### Текущее поведение

**Layout (L0/L1):**
- L0 содержит поле «Тема» (свободный текст, опционально), `HWAssignSection` (кому), `HWTasksSection` (задачи).
- L1 («Расширенные параметры») содержит «Название» (опционально, fallback на auto-title из темы/предмета), «Предмет», «Дедлайн», AI-bootstrap toggle.
- Dot indicator на кнопке L1 зажигается если `title`, `subject !== 'physics'`, `deadline` или `materials.length > 0`.

**Subjects (backend/frontend gap):**
- Фронтенд (`src/types/homework.ts` → `SUBJECTS`) определяет **14 предметов**: maths, physics, informatics, russian, literature, history, social, english, french, chemistry, biology, geography, spanish, other.
- Backend (`supabase/functions/homework-api/index.ts:23`) валидирует через `VALID_SUBJECTS = ["math", "physics", "history", "social", "english", "cs", "french", "chemistry"]` — **8 предметов, 5 пересекаются с фронтом** (`physics`, `history`, `social`, `english`, `french`, `chemistry`).
- Легаси-значения `math` и `cs` не появляются в dropdown'е фронта — там `maths` (новый id, не равен legacy `math`) и `informatics`.
- Валидация срабатывает в 4 местах: create (347, 860), update (2587), duplicate (2636).

### Боль

**Layout:**
- Поле «Тема» не используется ни в одном downstream-флоу: AI-чат читает `task_text`, уведомления берут title, отчёт по ученикам — тоже title. Тема — мёртвый ввод, который репетитор всё равно заполняет (UX-habit «первое поле — нужно»), теряя ~30 сек на каждом ДЗ. А из-за auto-title механики репетитор иногда вообще не замечает, что «Название» пустое, и ДЗ улетает с сгенерированным `${subject} — ${deadline}` вместо человеческого заголовка.
- Дедлайн спрятан в L1 — при массовом создании ДЗ репетитор забывает его выставить и получает «прошлое ДЗ» через день у ученика.

**Subjects:**
- Репетитор выбирает в дропдауне `Математика` (id `maths`) или `Испанский` (`spanish`), нажимает «Создать», получает тост «Не удалось сохранить» (UI не раскрывает `400 VALIDATION`, выглядит как сетевой глитч). Assignment в БД не создан → ученик не получает уведомление. Репетитор пробует ещё раз, получает тот же error, жалуется в поддержку. Первичный заказчик интерпретирует это как «уведомления не работают для не-физики/математики», хотя корневая причина — validation на create.
- Эмодзи в `SUBJECTS` (📈 📐 ⚛️ 💻 …) в dropdown нарушают design-system rule anti-pattern #1 (emoji в UI chrome запрещены), но убирать их из той же спеки — вынести за кадр subjects-unification нельзя, поэтому делаем в одном проходе.

### Текущие «нанятые» решения

- Репетитор дублирует информацию: пишет «Тема» и «Название» одинаково, чтобы AI-чат «понял контекст» (AI не читает ни одно, ни другое).
- Для не-физики/математики репетитор выбирает «Физика» или «Математика» и руками правит title — так ДЗ хотя бы создаётся.
- Внешнее решение: отправка задания в мессенджере вручную, в обход платформы.

---

## 3. Solution

### Описание

**L0 после правки (5 секций, сверху вниз):**
1. **«Название»** (обязательное, required) — перенесено из L1 на место «Темы». Placeholder: `Например: Кинематика — контрольная 15.04`. Ошибка «Укажите название» при пустом save.
2. **«Предмет» + «Тип экзамена»** (grid на 2 колонки, md+). Предмет: обязательный, default `physics`, native `<select>` с 14 предметами без эмодзи. Тип экзамена: `ege | oge`, default `ege`, native `<select>`. Причина grid-размещения: оба поля — decision-at-start (репетитор-нефизик меняет default предмета; репетитор ОГЭ-класса меняет тип экзамена сразу, чтобы AI-чат использовал корректные формулировки). Причина L0-placement для Subject: предмет — high-frequency решение на старте сборки ДЗ, поле влияет на downstream-флоу (AI-контекст задач, subject label в уведомлениях и карточках), скрывать за disclosure = silent failure для 9 из 14 предметов. Exam type попадает в L0 по той же логике: влияет на AI-контекст и формулировки, скрывать за L1 создаёт риск «выбран ЕГЭ-формат, а ученик готовится к ОГЭ».
3. **«Дедлайн»** (опциональный) — перенесено из L1. Тот же `<input type="datetime-local">`, тот же formatter.
4. `HWAssignSection` (кому) — без изменений.
5. `HWTasksSection` (задачи) — без изменений.

**L1 после правки (2 блока):**
- **AI-bootstrap toggle** («AI-вступление к задачам» ON/OFF) — остаётся.
- **`HWMaterialsSection`** (Материалы) — остаётся.
- **«Название»**, **«Предмет»**, **«Дедлайн»**, auto-title hint, **`_topicHint`** logic — **удалены из L1**.
- Dot indicator: перепривязываем к `disable_ai_bootstrap !== default || materials.length > 0`. «Название», «Предмет», «Дедлайн» теперь всегда видны на L0 — они не участвуют в dot (точка перестала быть «предмет отличается от физики», потому что предмет виден всегда).

**Subjects backend unification:**
- `VALID_SUBJECTS` в `homework-api/index.ts` расширяется до 14 значений, совпадающих с `SUBJECTS` во фронтенде: `maths, physics, informatics, russian, literature, history, social, english, french, chemistry, biology, geography, spanish, other`.
- Легаси-значения (`math`, `cs`, `rus`, `algebra`, `geometry`) **остаются разрешёнными в UPDATE path** (чтобы не блокировать сохранение старых ДЗ, в т.ч. с предыдущей итерации, где использовались `algebra`/`geometry`), но **запрещены в CREATE/DUPLICATE** — так мы не плодим новые записи с устаревшими id. На практике: `VALID_SUBJECTS_CREATE` и `VALID_SUBJECTS_UPDATE` — два набора. Второй = первый ∪ {`math`, `cs`, `rus`, `algebra`, `geometry`}.
- `getSubjectLabel` уже обрабатывает легаси через `LEGACY_SUBJECT_LABELS` — не трогаем.

**Subjects frontend: убрать emoji:**
- `SUBJECTS` в `src/types/homework.ts` теряет поле `emoji`. Оставляем `id`, `name`, `category`.
- Dropdown предметов в `HWExpandedParams.tsx` рендерит `name` без эмодзи.
- `SUBJECT_NAME_MAP` не меняется по структуре (derived из `SUBJECTS`), только значения (без эмодзи в `name`).
- Никакие Lucide-иконки вместо эмодзи **не добавляются** — мотивировка: в `<select>` native element'е Lucide-SVG не рендерится, а кастомный dropdown = вне скоупа (parking lot).

### Ключевые решения

1. **«Название» становится обязательным** (решение Vladimir в Q1): убираем auto-title fallback полностью. Валидация `title.trim().length > 0` блокирует save; ошибка под полем + scroll-to-error. Mock-текст (placeholder) остаётся, но не подменяет значение.
2. **`_topicHint` soft warning удаляется** вместе с полем «Тема». Validator упрощается.
3. **Дополнительный `VALID_SUBJECTS_UPDATE`** (не ломает legacy assignments): редактирование старого ДЗ с `subject: 'math'` не падает. Create — только современные id.
4. **Emoji из `SUBJECTS` убираем в этой же спеке** (design-system compliance). Расширять до Lucide-based custom dropdown — вне scope.
5. **Dot indicator логика упрощается** — `title`/`deadline` больше не drivers, только `subject`, `materials`, `disable_ai_bootstrap`.

### Scope

**In scope:**
- Убрать поле «Тема» из L0 (визуально и из state `meta.topic`).
- Перенести «Название» из `HWExpandedParams` в L0, сделать required, валидация на save.
- **«Тип экзамена» (`exam_type: 'ege' | 'oge'`) остаётся в L0 как вторая колонка к «Предмет»** (2026-04-14 resolution). Нативный `<select>`, default `ege`. Логика и `meta.exam_type` shape не меняются — только визуальное расположение фиксируется на L0.
- Перенести «Дедлайн» из `HWExpandedParams` в L0 под «Название».
- Удалить auto-title механику (`autoTitle` prop из `HWExpandedParams`, `AUTO_TITLE_FROM_TOPIC` генератор, соответствующий hint-текст).
- Удалить `_topicHint` логику в `validateAll()`.
- Обновить dot indicator L1-кнопки (только `subject/materials/disable_ai_bootstrap`).
- `VALID_SUBJECTS_CREATE` / `VALID_SUBJECTS_UPDATE` в backend: 14 + 5 legacy (`math`, `cs`, `rus`, `algebra`, `geometry`).
- Удалить `emoji` field из `SUBJECTS`, обновить `SUBJECT_NAME_MAP`.
- Смоук-тест: создать ДЗ по каждому из 14 предметов, проверить что уведомление доставлено хотя бы одному assigned ученику.

**Out of scope:**
- Multi-photo upload (задачи и критерии) — отдельная спека `homework-multi-photo`.
- Замена native `<select>` на Lucide-иконочный dropdown — tech-debt в parking lot.
- Миграция старых ДЗ с `subject: 'math' | 'algebra' | 'geometry'` → `subject: 'maths'` — не нужна, `getSubjectLabel` (с `LEGACY_SUBJECT_LABELS`) и `VALID_SUBJECTS_UPDATE` справляются. При желании репетитор пересохранит ДЗ с новым id вручную.
- Изменения в KB subject dropdown — KB использует отдельный topic/section набор, не `SUBJECTS`.
- Telegram-бот интерфейс — не касается.

---

## 4. User Stories

### Репетитор
> Когда я создаю ДЗ по русскому языку для группы 10-го класса, я хочу чтобы форма не требовала от меня заполнять «Тему», и чтобы «Название» + «Дедлайн» были видны сразу на L0 без раскрытия «Расширенных параметров», чтобы я успел собрать 4 ДЗ за 10 минут между уроками.

> Когда я выбираю в dropdown'е «Биология» и жму «Создать», я хочу чтобы ДЗ сохранилось и ученик получил уведомление — как это работает для физики.

### Школьник
> Когда репетитор отправляет мне ДЗ, я хочу получить push/Telegram/email нотификацию независимо от того, какой предмет выбран — чтобы не пропустить дедлайн из-за тихого сбоя создания ДЗ.

---

## 5. Technical Design

### Затрагиваемые файлы

**Frontend:**
- `src/pages/tutor/TutorHomeworkCreate.tsx` — рендер L0: убрать блок «Тема», вставить Title → Subject → Deadline между верхом формы и `HWAssignSection`; обновить `validateAll()` и `HWDraftMeta` shape (убрать `topic`). Subject-change больше не триггерит auto-open L1.
- `src/components/tutor/homework-create/HWExpandedParams.tsx` — удалить Title + Subject + Deadline + `autoTitle` prop + auto-title hint. Остаётся только AI-bootstrap toggle (`disable_ai_bootstrap`). Компонент ужимается до single-purpose и, возможно, переименовывается в `HWAdvancedToggles` на последующей итерации (вне scope этой спеки — оставить текущее имя).
- `src/components/tutor/homework-create/HWTopicSection.tsx` (если существует) — удалить компонент, заменить на inline Input в L0. Если это inline-JSX в `TutorHomeworkCreate.tsx` — просто вырезать блок.
- `src/types/homework.ts` — убрать `emoji` из `SUBJECTS`, `HWDraftMeta.topic` field, `_topicHint` из `ValidationErrors`.

**Backend:**
- `supabase/functions/homework-api/index.ts`:
  - `VALID_SUBJECTS` (23) заменить на `VALID_SUBJECTS_CREATE` (14 современных) + `VALID_SUBJECTS_UPDATE` (14 + 5 legacy: `math`, `cs`, `rus`, `algebra`, `geometry`).
  - В create handler (347) и duplicate handler (2636) — проверять `VALID_SUBJECTS_CREATE`.
  - В update handler (2587) и secondary create-like path (860) — проверять `VALID_SUBJECTS_UPDATE`.
  - Сообщение ошибки: `subject must be one of: ${list.join(", ")}` — без изменений формы.

### Data Model

Миграций БД нет. Колонка `homework_tutor_assignments.subject` — свободный text, уже хранит значения типа `algebra`, backend просто перестаёт их блокировать.

### API

Без изменений endpoint'ов. Request body `{ subject }` теперь принимает все 14 id. UPDATE дополнительно принимает 5 legacy.

### Миграции

SQL-миграций нет — только правки edge function + frontend.

---

## 6. UX / UI

### Wireframe

```
[L0]
┌───────────────────────────────────────────────┐
│ Название *                                    │
│ [Например: Кинематика — контрольная 15.04]    │
├───────────────────────────────────────────────┤
│ Предмет *         │  Тип экзамена             │
│ [Физика ▾]        │  [ЕГЭ ▾]                  │
├───────────────────────────────────────────────┤
│ Дедлайн (необязательно)                       │
│ [📅 datetime-local]                           │
├───────────────────────────────────────────────┤
│ Кому (HWAssignSection)                        │
├───────────────────────────────────────────────┤
│ Задачи (HWTasksSection)                       │
└───────────────────────────────────────────────┘
[ ▸ Расширенные параметры (•) ]  ← dot = materials/ai_bootstrap changed
[L1 — collapsible]
┌──────────────────────────────────────────┐
│ AI-вступление к задачам  [ON/OFF]        │
│ Материалы (HWMaterialsSection)           │
└──────────────────────────────────────────┘
[HWActionBar: Сохранить черновик | Отправить]
```

### UX-принципы (из doc 16)

- **Принцип экономии клика:** частоиспользуемые поля (Title, Deadline) вытащены на L0. Advanced (Subject, AI toggle) — скрыты за disclosure.
- **AI = draft + action:** фича не добавляет AI-уровня, только убирает шум из конструктора.

### UI-паттерны (из doc 17)

- **Progressive disclosure L0/L1** — сохраняется.
- **Required-field indicator:** `*` после label у «Название», сообщение об ошибке `text-sm text-red-500` под input'ом. Согласно design-system `border-red-500` при ошибке.
- **16px font-size на input** (iOS Safari auto-zoom prevention) — сохраняется на обоих полях.
- **Нет emoji в dropdown'е Предмет** — design-system anti-pattern #1.

---

## 7. Validation

### Как проверяем успех?

- **AC-1 (layout):** на `/tutor/homework/create` в свежей форме L0 содержит ровно 5 секций в строгом порядке: Название, Предмет + Тип экзамена (2-колоночный grid на md+), Дедлайн (необязательно), Кому, Задачи. «Тема» отсутствует. Предмет рендерится как native `<select>`; Тип экзамена — тоже native `<select>` c опциями `ЕГЭ / ОГЭ` (default `ЕГЭ`).
- **AC-2 (required title):** попытка сохранить ДЗ с пустым `title.trim()` показывает ошибку «Укажите название» под полем, save не происходит, запрос на backend не уходит.
- **AC-3 (L1 reduced):** кликнув «Расширенные параметры», репетитор видит ровно 2 блока: AI-вступление к задачам, Материалы. «Название», «Предмет» и «Дедлайн» в L1 отсутствуют.
- **AC-4 (subjects create):** создание ДЗ по каждому из 14 предметов возвращает 201 и создаёт запись в `homework_tutor_assignments`. В таблице `delivery_status` хотя бы один `delivered_*` для назначенного ученика с привязанным каналом.
- **AC-5 (legacy update):** редактирование существующего ДЗ с `subject: 'math'` (или `'algebra'` / `'geometry'` из предыдущей итерации) не падает (200 ответ, записывает новые task fields, `subject` остаётся legacy или меняется на `'maths'` по выбору репетитора).
- **AC-6 (no emoji):** в dropdown'е Subject нет символов вне базовой кириллицы/латиницы (grep `SUBJECTS` на emoji pattern возвращает 0).
- **AC-7 (dot indicator):** в draft-state без materials и с дефолтным `disable_ai_bootstrap` точка на кнопке L1 не показывается. Изменение title / subject / deadline (всё на L0) точку **не зажигает** — её включает только изменение на L1 (materials или AI-bootstrap).

### Связь с pilot KPI

- **KPI «Среднее время сборки ДЗ» (pilot-playbook doc 18):** ожидаем -20-30 секунд за счёт удаления «Темы» и вытаскивания Deadline.
- **KPI «Доля доставленных уведомлений»:** ожидаем рост с ~40% (только 5/14 предметов работают end-to-end) до ~95% (все 14 предметов создаются успешно).

### Smoke check

```bash
npm run lint && npm run build && npm run smoke-check
```

Дополнительно вручную: создать ДЗ по каждому предмету, прогнать через `handleNotifyStudents` минимум для одного ученика на каждом.

---

## 8. Risks & Open Questions

| Риск | Вероятность | Митигация |
|---|---|---|
| Существующие черновики с заполненной «Темой» — потеряют её при загрузке | Средняя | `HWDraftMeta.topic` становится deprecated read-only: если приходит с backend → просто игнорируем, при save не отправляем. Backend колонки `topic` нет (поле было frontend-only через `autoTitle`). |
| Репетитор привык к auto-title — пустое ДЗ уйдёт с generic названием | Низкая | Required-validation блокирует save. Сообщение об ошибке явное. |
| Legacy subject `math` — репетитор с 100 старыми ДЗ не может обновить ни одно | Средняя | `VALID_SUBJECTS_UPDATE` включает legacy значения. |
| UPDATE handler на строке 860 — это не тот же что на 2587 (дублирование?) | Низкая (tech-debt) | Оба path'а прикрыть `VALID_SUBJECTS_UPDATE`. Проверить, что 860 именно update (Q1 ниже). |
| Удаление `emoji` field сломает downstream потребителей | Низкая | Grep `SUBJECTS.*emoji` — подтвердить, что использования нет (кроме самой карты). Если есть — добавить стаб `emoji: ''` или обновить потребителей. |

### Открытые вопросы

1. ✅ **RESOLVED** — grep по `VALID_SUBJECTS.includes` в `supabase/functions/homework-api/index.ts` показал 4 call sites:
   - **line 347** — `handleCreateAssignment`, strict guard `!isNonEmptyString(b.subject) || !VALID_SUBJECTS.includes(...)` → **CREATE path**
   - **line 860** — второй create-like path (duplicate/clone из шаблона), тот же strict guard что и на 347 → **CREATE path, не update**
   - **line 2587** — `handleUpdateAssignment`, conditional guard `if (subject !== undefined && !VALID_SUBJECTS.includes(...))` → **UPDATE path**
   - **line 2636** — strict duplicate (= insert новой строки), тот же strict guard что и на 347 → **CREATE path**

   **Применяем:** `VALID_SUBJECTS_CREATE` (14 modern) на строках **347 / 860 / 2636**; `VALID_SUBJECTS_UPDATE` (14 + 5 legacy: `math`, `cs`, `rus`, `algebra`, `geometry`) только на **2587** — единственный path, который должен принимать legacy значения для backward-compat уже существующих ДЗ.
2. Нужен ли Lucide-иконочный dropdown для предметов вместо native `<select>`? (**Решение:** нет, custom dropdown — в parking lot, native `<select>` + text-only остаётся как sufficient baseline.)
3. Фиксируем ли auto-title поведение (subject + deadline → title) в backend как дефолт для API-клиентов, которые пошлют пустой title? (**Решение:** нет, backend просто валидирует `title.trim().length > 0` и возвращает 400 VALIDATION. Frontend блокирует до save.)

---

## 9. Implementation Tasks

> Переносятся в `homework-create-layout-subjects-tasks.md` после approve спека.

- [ ] TASK-1: Удалить поле «Тема» из L0 (TutorHomeworkCreate.tsx + `HWDraftMeta.topic` field + validator + `_topicHint` логика).
- [ ] TASK-2: Перенести «Название», «Предмет» и «Дедлайн» из `HWExpandedParams` в L0 (в порядке Название → Предмет → Дедлайн, между заголовком страницы и `HWAssignSection`); сделать Title required (`title.trim().length > 0`); Subject остаётся native `<select>` с 14 предметами и дефолтом `physics`.
- [ ] TASK-3: Удалить auto-title механику (`autoTitle` prop, generator-хелпер, hint-text под полем названия).
- [ ] TASK-4: Сузить dot indicator логику L1 — показывать только при `materials.length > 0` или `disable_ai_bootstrap !== false` (title/subject/deadline ушли в L0 и в индикаторе больше не участвуют). Убрать auto-expand L1 при ошибке subject — валидация теперь работает на L0.
- [ ] TASK-5: Backend `supabase/functions/homework-api/index.ts` — разделить `VALID_SUBJECTS` на два набора:
  - `VALID_SUBJECTS_CREATE` (14 modern) — применить на строках **347** (`handleCreateAssignment`), **860** (второй create-like path), **2636** (strict duplicate / template clone).
  - `VALID_SUBJECTS_UPDATE` (14 modern + 3 legacy: `math`, `cs`, `rus`) — применить только на строке **2587** (`handleUpdateAssignment`, conditional guard).
- [ ] TASK-6: Убрать `emoji` поле из `SUBJECTS` массива в `src/types/homework.ts`; удалить `emoji` из `HomeworkSubjectConfig` типа; обновить все usages (grep `SUBJECTS.*emoji` + `subject.emoji`).
- [ ] TASK-7: QA-smoke — создать ДЗ по каждому из 14 предметов (maths, physics, informatics, russian, literature, history, social, english, french, chemistry, biology, geography, spanish, other), проверить:
  - create path 200 OK;
  - subject сохраняется в `homework_tutor_assignments.subject`;
  - карточка в `TutorHomework.tsx` показывает корректный label через `getSubjectLabel()`;
  - уведомление ученику (Telegram/Email) содержит правильное название предмета.
- [ ] TASK-8: Регрессия iOS Safari — на iPhone проверить, что Title / Subject `<select>` / Deadline inputs не вызывают auto-zoom (16px font-size), focus-ring не конфликтует с sticky-элементами, Enter в Title не сабмитит форму.

---

## Parking Lot (вне scope текущей спеки)

- Lucide-иконочный кастомный dropdown предметов вместо native `<select>`.
- Миграция `UPDATE homework_tutor_assignments SET subject = 'maths' WHERE subject IN ('math', 'algebra', 'geometry') AND ...` — только по запросу при аудите.
- Single source of truth для `VALID_SUBJECTS` (shared между frontend `SUBJECTS` и backend) — сейчас два независимых списка, риск дрейфа остаётся.

---

## Checklist перед approve

- [x] Job Context заполнен (секция 0)
- [x] Привязка к Core Job (R4-1, S1-3)
- [x] Scope чётко определён (in/out)
- [x] UX-принципы doc 16 учтены (экономия клика, progressive disclosure)
- [x] UI-паттерны doc 17 учтены (required indicator, 16px input, native select)
- [x] Pilot impact описан (−20-30s сборка, +уведомления по non-core предметам)
- [x] Метрики успеха определены (7 AC, 2 KPI)
- [x] High-risk файлы не затрагиваются (`Chat.tsx`, `AuthGuard`, `TutorGuard`, `TutorSchedule`, `telegram-bot/index.ts` не трогаются)
- [x] Student/Tutor изоляция не нарушена (изменения только в tutor-домене + общий `types/homework.ts`, который уже shared)
