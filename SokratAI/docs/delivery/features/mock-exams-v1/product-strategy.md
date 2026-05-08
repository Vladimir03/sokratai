# Mock Exams ЕГЭ — Product Strategy (3 фазы)

**Author:** Claude + Vladimir
**Дата:** 7 мая 2026
**Status:** v0.3 — включены решения Vladimir (lead-gen в Phase 1, бланк-режим default, 4 tutors параллельно с дня 3)
**Связанные файлы:** `mockup.html` (clickable preview)

---

## Decisions log (от Vladimir, 7 мая 2026)

| Развилка | Решение | Последствие |
|---|---|---|
| Money model Phase 1 | **Lead-gen с дня 1.** Public mock exam без регистрации → результат с задержкой (после tutor approval) → CTA «получить разбор от репетитора Х». SokratAI берёт % с первого платежа лида. | +1 день на Phase 1: public route, anonymous flow, tutor profile page, lead capture |
| Бланк-режим default | **«С бланком» по умолчанию.** Tutor может переключить на «Стандартный» осознанно. | Часть 1 в default — manual tutor check, AI auto-check только в опциональном режиме |
| Pilot tutors timing | **Все 4 параллельно с дня 3.** | Marketing materials и onboarding обязательны до запуска; нет права на критичный баг |
| Phase 1 success metrics | (1) ≥1 пробник назначен и сдан, (2) ≥1 родитель открыл share-link, (3) tutor говорит «я могу это продавать». **«Сэкономило время» — не главная метрика.** | Distribution и sellability важнее tutor productivity → lead-gen layer must, не nice-to-have |

### Timing reality check

С добавлением lead-gen и 4 tutors параллельно — реалистичный диапазон **3-4 дня до пилота, не 2-3**. Я держу амбицию 3 дня как цель, но честно проговариваю риск: если AI Vision Phase 1 даст плохое качество на первых тестах, lead-gen придётся вырезать в день 2 и фокусировать на tutor-side flow. Trade-offs описаны ниже.

---

## 0. Executive recommendation

До ЕГЭ-2026 остался месяц. Репетиторы могут зарабатывать на пробниках сейчас. Значит мы работаем в трёх горизонтах:

- **Phase 1 (2-3 дня) — Sellable MVP.** Ребрендинг подмножества существующего homework workflow в «Пробник». Репетитор может назначить готовый вариант от Егора 5 ученикам и получить AI-проверку Части 2. Marketing-ready вид (вкладка «Пробники», готовый вариант в библиотеке, результат «как у пробника», ссылка для родителя). Делаем максимально reuse существующей инфраструктуры — нулевой green-field.
- **Phase 2 (1 неделя) — Strong tutor product.** Полноценный отдельный flow с двухпанельным review surface, детальные критерии I-IV из методички, 4 варианта Егора + ФИПИ demo, parent reports со сравнением между пробниками.
- **Phase 3 (2 недели от старта) — Полированный продукт.** Lead-gen flow (бесплатный пробник для лидов с конверсией в платных), ОГЭ, бланк-режим с OCR (если данные пилота покажут, что нужно), cohort-аналитика.

**Главное архитектурное решение Phase 1:** не строим новые таблицы. Расширяем `homework_tutor_assignments` флагами и переиспользуем 80% UI. В Phase 2 уже отделяем как настоящий продукт.

**Бланки:** оба режима с первого дня. Tutor при назначении выбирает: «Стандартный (форма + AI Part 1)» или «С бланком (PDF к скачиванию + фото бланка для архива, Part 1 проверяет tutor)». Решает «40% не могут печатать» **и** уважает желание репетиторов учить ребят настоящему процессу.

**Монетизация Phase 1:** репетиторы получают фичу бесплатно и используют её как lead-gen + value-add. Платный SaaS-режим — Phase 3, после валидации.

---

## 1. Three phases at a glance

| | Phase 1 (2-3 дня) | Phase 2 (1 неделя) | Phase 3 (2 недели) |
|---|---|---|---|
| **Цель** | Sellable MVP, репетитор продаёт сейчас | Strong tutor product | Public-facing продукт |
| **Сущность** | Special homework (флаг `is_mock_exam`) | Отдельная таблица `mock_exams` | + lead-gen + cohort |
| **Контент** | 1 вариант Егора | 4 Егора + 1 ФИПИ | 5+ + ОГЭ |
| **Часть 1 проверка** | Auto (форма) или manual tutor (бланк) | + бланк OCR fallback (опц.) | + бланк OCR full |
| **Часть 2 проверка** | AI draft (простой prompt) | AI draft по критериям I-IV из методички | + confidence tuning |
| **Tutor review UX** | Existing TutorHomeworkDetail + mock-specific section | Dedicated split-view surface | + bulk operations |
| **Student report** | Inline на странице homework + после approval | Dedicated `/student/mock-exams/:id/result` | + сравнение с прошлым |
| **Parent** | Share-link (existing pattern) | Dedicated public mock report | + PDF + email |
| **ОГЭ** | Нет | Нет | Да |
| **Lead-gen** | Нет (только для своих учеников) | Нет | Да (public mock без аккаунта) |

---

## 2. Phase 1 — 2-3 дня — детально (это главный раздел)

### 2.1 Что в скоупе

**Backend (минимум):**
- Расширение `homework_tutor_assignments`: `is_mock_exam BOOLEAN DEFAULT false`, `exam_type TEXT NULL` (`'ege_physics'`), `mock_exam_mode TEXT NULL` (`'form'` | `'blank_paper'`), `mock_exam_blank_pdf_url TEXT NULL`
- Расширение `homework_tutor_tasks`: `kim_number INTEGER NULL`, `part INTEGER NULL` (1 или 2), `check_mode TEXT NULL` (`'strict'`, `'ordered'`, `'unordered'`, `'multi_choice'`, `'task20'`, `'pair'`, `'detailed'`)
- Seed: Тренировочный вариант 1 от Егора как `homework_tutor_templates` row + 26 attached tasks (3-4 часа моей работы по подготовке)
- Расширение `handleCheckAnswer` в `homework-api`: при `is_mock_exam=true` — детерминированная Part 1 проверка по `check_mode`, AI-draft с mock prompt для Part 2

**Frontend (минимум):**
- Sidebar: новый пункт «Пробники» (заглушка ведёт на `/tutor/mock-exams`)
- Route `/tutor/mock-exams` — список (одна карточка после assign), CTA «Назначить пробник»
- Кликнул «Назначить пробник» → existing TutorHomeworkCreate с pre-filled `is_mock_exam=true` + selected template `Тренировочный 1` + selector «Стандартный режим / С бланком»
- Student-side: при открытии homework с `is_mock_exam=true` — отдельный layout (NOT guided chat), линейный список 26 задач, form Part 1 / photo Part 2, single submit
- Tutor results: existing TutorHomeworkDetail, но если `is_mock_exam=true` — добавить mock-specific section «Часть 2: AI-черновик» с approve buttons
- Parent-link: existing share-link pattern с расширенным content для mock exams

**Lead-gen layer (must в Phase 1 по решению Vladimir):**
- Tutor может сгенерировать **invite-link для лида** из своего dashboard: `/p/mock-invite/:slug` с pre-filled tutor identity
- Анонимный родитель/ученик открывает invite-link → видит описание варианта и tutor card → нажимает «Сдать пробник» → проходит как любой student (form/photo)
- После submit: «Работа отправлена. Репетитор Иван Иванов проверит и пришлёт результат в течение 24 часов. Введите имя и контакт, чтобы получить разбор:» — собираем lead (имя, Telegram/email)
- Tutor получает push «новый лид от анонимного пробника, имя X, контакт Y, ждёт проверки»
- После approve — родителю/ученику высылается результат в Telegram/email + CTA «получить персональный разбор от Ивана Ивановича» (link на Telegram/WhatsApp tutor)
- В DB: `mock_exam_anonymous_attempts` с `lead_name`, `lead_contact`, `tutor_id`, `attempt_data`

**Контент:**
- Тренировочный вариант 1 от Егора в seed (моими руками, ~4 часа)
- PDF бланка из загрузок Vladimir (`Бланк_заполнения_ЕГЭ-2025.pdf`) — кладём в Storage, ссылку даём при выборе bланк-режима
- Простой AI prompt для Part 2 (без полного разбора 208-стр методички):
  ```
  Ты эксперт ЕГЭ по физике. Проверь решение по критериям ФИПИ.
  Критерии (упрощённо): I. Записан закон. II. Введены обозначения.
  III. Расчёт. IV. Ответ с единицами.
  Дай suggested_score 0..max_score, comment, confidence.
  ```

### 2.2 Что НЕ в скоупе Phase 1 (явно отрезано)

- Отдельные таблицы `mock_exams`, `mock_exam_attempts` — не делаем (всё через `homework_tutor_*`)
- Полный prompt по 208-стр методичке — простой prompt сейчас, детальный в Phase 2
- Detailed split-view review surface — используем существующий TutorHomeworkDetail
- Бланк OCR — только в Phase 3 (если данные покажут спрос)
- Parent dashboard — только share-link, без отдельного полированного отчёта (Phase 2)
- ОГЭ — Phase 3
- ~~Lead-gen — Phase 3~~ → **перенесено в Phase 1 (см. lead-gen layer)**
- Cohort analytics — Phase 3
- Variants library с 4+ вариантами — только 1 в Phase 1, остальные в Phase 2
- Strict timer enforcement — только visual
- Auto secondary score — только primary в Phase 1, lookup-таблица в Phase 2

### 2.3 Бланки — оба режима в Phase 1

**Tutor выбирает при назначении. Default = «С бланком»** (по решению Vladimir, соответствует ожиданиям репетиторов):

```
Режим прохождения:
(•) С бланком ЕГЭ ← по умолчанию
    Ученик распечатывает официальный бланк (мы дадим PDF),
    пишет ручкой, фотографирует и загружает.
    Часть 1 ты проверяешь сам по фото бланка (быстрее, чем
    проверять решения). Часть 2 AI всё равно делает черновик.
    Подходит, если хочешь, чтобы ученик тренировал заполнение
    как на реальном экзамене.

( ) Стандартный — ученик заполняет ответы в форме на сайте,
    AI автоматически проверит Часть 1.
    Подходит, если ученик не может распечатать бланк.
```

**В режиме «С бланком»:**
- Student скачивает PDF бланка (link на нашем `Бланк_заполнения_ЕГЭ-2025.pdf` через Storage)
- Решает на бумаге
- Загружает 2-3 фото: бланк Часть 1, бланк Часть 2 (или по-задачно)
- AI делает draft Часть 2 как обычно
- Tutor видит фото бланка Часть 1 + manually вводит баллы за каждую из 20 задач (быстрая форма с radiobuttons)
- Tutor видит фото Части 2 + AI draft, как в стандартном режиме

**В режиме «Стандартный»:**
- Student вводит ответы в форму (типизированные поля по check_mode)
- Загружает фото только Части 2 (по задаче)
- AI auto-grades Часть 1 + draft Часть 2
- Tutor только approves всё

**Trade-off режимов честный:**
- Стандартный: быстрее для ученика, мгновенный auto-check Части 1, минимум фото
- С бланком: реалистичная тренировка переноса ответов на бланк, чувствует ЕГЭ, но требует распечатки и tutor manual check Части 1

Это разумная поляризация — Егор может выбирать какому ученику какой режим.

### 2.4 Day-by-day breakdown (3-4 дня с lead-gen)

**День 1 (8 часов) — Foundation:**
- Утром (4ч): миграция (расширение homework_tutor_*) + seed (Тренировочный 1 от Егора в template, моими руками включая 26 задач, эталоны, check_mode)
- Днём (3ч): sidebar «Пробники», route `/tutor/mock-exams`, расширение wizard `TutorHomeworkCreate` для mock режима + selector бланк/форма (default «С бланком»)
- Вечером (1ч): PDF бланка в Storage, signed URL helper, smoke test wizard

**День 2 (8 часов) — Student + AI:**
- Утром (4ч): student-side alternative render если `is_mock_exam=true` (linear, form Part 1 / photo бланка, photo Part 2, single submit)
- Днём (3ч): backend — det Part 1 checker (5 типов в стандартном режиме), AI Part 2 prompt + edge function trigger
- Вечером (1ч): state machine (`submitted → ai_checking → awaiting_review → approved`), push notifications

**День 3 (8 часов) — Tutor review + lead-gen layer:**
- Утром (3ч): tutor-side mock-specific section в TutorHomeworkDetail (Part 2 cards с approve, Part 1 manual-input если бланк-режим)
- Днём (4ч): **lead-gen layer** — public route `/p/mock-invite/:slug`, anonymous attempt schema, tutor profile public card, lead capture flow, post-approval delivery в Telegram/email
- Вечером (1ч): smoke test всего flow

**День 4 (8 часов) — Polish + параллельный запуск 4 tutors:**
- Утром (2ч): hot-fix критичных багов после внутреннего теста
- Днём (3ч): onboarding-материалы — 1-page для каждого из 4 tutors (скриншоты, текст для рассылки своим ученикам, текст для лидов), invite-link генератор
- Pарал­лельная встреча с 4 tutors (1.5ч): live demo, дать access, ответить на вопросы
- Day-end: telemetry monitoring, capture первого реального submit

**Buffer day 5:** если хоть один из критичных flows ломается у одного из 4 tutors — резервируем день на hot-fix. Sellable concept стоит к концу недели.

### Реалистичная оценка timeline

| Скоуп | Дни до пилота |
|---|---|
| Только tutor-side (existing students), без lead-gen | 2 дня + день polish = 3 |
| + lead-gen layer | +1 день = **4 дня минимум** |
| + 4 tutors параллельный onboarding | +0.5 дня (можно совместить с polish) |

**Жёсткое решение:** если до конца дня 2 видно, что AI Vision Part 2 даёт плохое качество — режем lead-gen и фокусируемся на tutor-side, потому что lead-gen с нерабочим AI = катастрофа для бренда. Делать только в случае, если AI работает достаточно хорошо.

### 2.5 Phase 1 success criteria (через 7 дней после запуска)

**Жёсткие метрики (по решению Vladimir, все три должны выполниться):**

1. **≥1 пробник реально назначен и сдан** — базовый технический порог: один реальный flow от назначения до результата без сбоев у одного из 4 tutors.
2. **≥1 родитель открыл share-link** — distribution signal: parent-link виральный или нет, родитель реально открывает.
3. **≥1 tutor говорит «я могу это продавать ученикам»** — sellable signal: tutor видит маркетинговую ценность или retention рычаг.

**Стрейч-цели (если есть):**
- ≥1 анонимный лид зашёл через invite-link и оставил контакт
- ≥1 tutor показал результат своему текущему ученику и получил позитивную реакцию

**Что мы НЕ делаем главной метрикой:** «сэкономило tutor время». Мотив Phase 1 — distribution и sellability, не tutor productivity. Productivity — Phase 2.

**Marketing readiness checklist (день 4):**
- Sidebar tab «Пробники» — выглядит как полноценная фича
- Готовый вариант в библиотеке — «вы получаете контент бесплатно»
- AI-черновик с лейблом «ты подтверждаешь» — снижает страх делегации
- Parent share-link с CTA «получить разбор от репетитора» — готовый тул маркетинга
- Public invite-link `/p/mock-invite/:slug` — tutor может постить в свой Telegram-канал/Instagram

---

## 3. Phase 2 — 1 неделя — расширение

После пилота Phase 1 у нас есть конкретные сигналы, что улучшать. Базовый план:

**День 4-7:**
- Создаём отдельные таблицы `mock_exams`, `mock_exam_attempts` (миграция данных из homework — minimal, только Егоровские записи)
- Отдельные routes `/tutor/mock-exams/...` без reuse homework UI
- Двухпанельный review surface (split фото / draft, как в макете)
- Полный AI prompt по 208-стр методичке: блок-схема №21, критерии I-IV для 22-26, edge cases (правильный ответ без обоснования, нестандартный метод)
- Confidence flags (high/medium/low) с amber/red бэйджами в очереди
- Bulk approve high-confidence

**День 8-10:**
- 3 оставшихся варианта Егора в seed
- 1 demo ФИПИ-2026 (если опубликован) — я переношу руками
- Detailed parent report (`/p/mock-result/:slug`): сравнение с прошлым, 2-3 темы «над чем работать», AI-summary с tutor approval
- Lookup-таблица primary→test score 2026

### 3.1 Что Phase 2 добавляет к Phase 1

- Полный criteria breakdown в review (I/II/III/IV галочки)
- Confidence-based queue (важно для tutor scaling — Егор может проверять 30+ учеников)
- Library с 5 вариантами
- Polished parent experience

### 3.2 Что Phase 2 НЕ добавляет

- Lead-gen
- ОГЭ
- Бланк OCR
- Cohort

---

## 4. Phase 3 — 2 недели от старта — публичный продукт

После Phase 2 у нас есть:
- Working product у Егора + 3 других пилотных репетиторов
- Реальные данные про что ценят, что не ценят
- Понимание, готов ли продукт для public lead-gen

**Phase 3 фичи (приоритезированы after data):**

- **Lead-gen flow:** public link `/p/mock-exam-invite/:slug` → анонимный пользователь сдаёт пробник → видит свой результат → CTA «получить персональный разбор от репетитора Егора» → tutor получает контакт. Это и есть монетизация.
- **ОГЭ.** Отдельный exam_type, другая структура (24 задания, другие критерии).
- **Бланк OCR (если данные Phase 1-2 показали реальный спрос).** Tesseract или Yandex OCR на фото бланка → авто-парсинг ответов Часть 1 → сравнение с эталоном. Отказ от ручной проверки Части 1 даже в бланк-режиме.
- **Cohort analytics:** какие темы провалила группа (не один ученик).
- **Paid tier для tutors.** SaaS-модель. Per-tutor monthly или per-active-student. До этого Phase 1-2 — бесплатно для пилотных tutors.
- **Дополнительные варианты от Егора + других репетиторов** (контент-маркетплейс).

Phase 3 в плане ВНЕ обязательного жёсткого скоупа, потому что зависит от обратной связи Phase 1+2.

---

## 5. AI workflow (Phase 1 минимум)

### Часть 1 (deterministic)

В режиме «Стандартный»: form input → check по `check_mode` каждой задачи. Уже описано в существующих ДЗ-механиках, переиспользуем + добавляем 5 типов проверки:

```ts
function checkPart1Answer(studentAnswer, correctAnswer, checkMode) {
  switch (checkMode) {
    case 'strict':       return normalizeNumber(studentAnswer) === normalizeNumber(correctAnswer);
    case 'ordered':      return studentAnswer.replace(/\D/g, '') === correctAnswer;
    case 'unordered':    return sortDigits(studentAnswer) === sortDigits(correctAnswer);
    case 'multi_choice': return computePartialMultiChoice(studentAnswer, correctAnswer);  // 0/1/2 баллов
    case 'task20':       return sortDigits(studentAnswer) === sortDigits(correctAnswer) ? 1 : 0;  // any error = 0
    case 'pair':         return studentAnswerArray.length === 2 && match(studentAnswer, correctAnswer);
  }
}
```

В режиме «С бланком»: tutor вводит руками за каждую задачу через radio buttons (0/1/2), без auto.

### Часть 2 (AI Vision draft) — Phase 1 простой prompt

```
Ты эксперт ЕГЭ по физике. Проверь решение ученика по критериям ФИПИ.

Задача №{kim_number}, максимум {max_score} баллов.
Условие: {task_text}
Эталонное решение: {solution_text}

Решение ученика — на фото. Распознай его. Если фото неразборчиво — confidence='low', suggested_score=null.

Оцени по 4 элементам:
I. Записан закон/положение теории, нужное для решения.
II. Введены все буквенные обозначения новых величин.
III. Математические преобразования и расчёты с подстановкой.
IV. Правильный ответ с единицами измерения.

Спец-правило для №21: качественная задача, 0-3 балла по полноте объяснения.

Верни JSON:
{
  "suggested_score": int 0..max_score,
  "confidence": "high" | "medium" | "low",
  "comment_for_tutor": "1-2 предложения почему",
  "elements_check": {"I": bool, "II": bool, "III": bool, "IV": bool}
}

ВАЖНО: ты создаёшь черновик, не финальную оценку. Будь честен про сомнения.
```

В Phase 2 prompt дорабатывается на основе детального изучения 208-стр методички (раздел 2.2 + блок-схема №21). Phase 1 — простой prompt «достаточно хорошо».

---

## 6. Tutor review UX (Phase 1 минимум)

Используем существующий `TutorHomeworkDetail`. Добавляем conditional render если `assignment.is_mock_exam=true`:

- В шапке: badge «Пробник ЕГЭ-2026 · Демо от Егора»
- В блоке учеников: для каждого — статус (отдельный enum для mock: `awaiting_review`, `approved`)
- Раскрытый ученик: 
  - Часть 1: таблица 20 строк с auto-graded ответами (или manual-input если бланк-режим)
  - Часть 2: 6 карточек с фото слева и AI-draft справа (на одной странице, не split layout — это для Phase 2)
  - Approve buttons: «Подтвердить балл [N]» на каждой задаче, plus «Подтвердить и отправить» внизу

Это **не идеальный UX**, но это **рабочий и понятный** для Егора в Phase 1. В Phase 2 делаем dedicated split-view.

---

## 7. Reports (Phase 1 минимум)

### Student report
Inline на странице assignment после approval:
- Header: «Пробник ЕГЭ-2026 · Часть 1: 23/25 · Часть 2: 18/29 · Итого: 41/54»
- Часть 1 table: задание, ответ, эталон, балл (с tooltip на check_mode)
- Часть 2 cards: условие + фото решения + balanced AI comment

### Parent share-link
Через existing share-link pattern:
- Опубликовать через кнопку «Поделиться с родителем» в TutorHomeworkDetail
- Slug-based public URL (паттерн existing public-homework-share)
- Render: краткий summary, big balls, CTA «Связаться с репетитором»
- Без AI parent comment (Phase 2)

---

## 8. Risks & simplifications (focused on Phase 1)

### Phase 1 risks

1. **AI Vision на handwriting может быть слабым** — простой prompt без detailed criteria study плюс шумные фото = более низкая точность. Mitigation: tutor approve mandatory, фото всегда виден, при low-confidence AI явно говорит «не уверен — проверь сам».

2. **Reuse homework UI создаст confusion** — ученик увидит ту же страницу что для ДЗ, но с другим UX. Mitigation: явный header «Это пробник ЕГЭ, не обычное ДЗ», отдельная иконка, conditional render с заметными отличиями.

3. **Контент Егора .docx → seed: я могу ошибиться** — 26 задач × ответы × check_modes × max_scores. Mitigation: Егор валидирует seed file перед запуском (1 час его времени), записываем его как provenance.

4. **PDF бланка нужно положить в Storage и убедиться что доступен через RU прокси** — если не дойдёт до ученика, бланк-режим сломан. Mitigation: я тестирую download flow на день 1.

5. **Parent share-link без OAuth — security?** — slug 8 символов, через existing public-homework-share паттерн. Это уже работает в проде с homework, риск принят.

### Phase 1 simplifications (явно выбранные)

- Reuse homework_tutor_assignments — нет новых таблиц
- Reuse существующий wizard TutorHomeworkCreate — нет нового
- Reuse существующий TutorHomeworkDetail — нет нового
- Простой AI prompt — детальный позже
- 1 вариант — больше позже
- Без отдельного Student `/student/mock-exams/:id/result` — inline на homework page
- Без AI parent summary — Phase 2

---

## 9. Что строим в next 2-3 дня — exact recommendation

### Day 1 (must)
- [ ] Migration: `is_mock_exam`, `exam_type`, `mock_exam_mode`, `mock_exam_blank_pdf_url` + `kim_number`, `part`, `check_mode` (5 новых значений)
- [ ] Seed: Тренировочный вариант 1 от Егора в `homework_tutor_templates` + 26 attached `homework_tutor_tasks` (моими руками, 4 часа)
- [ ] PDF бланка в Storage (`mock-exam-blanks/blank_2025_v1.pdf`), generate signed URL helper
- [ ] Sidebar entry «Пробники» (заглушка → `/tutor/mock-exams`)
- [ ] Route `/tutor/mock-exams` (list) + кнопка «Назначить»
- [ ] Расширение `TutorHomeworkCreate`: при `?mode=mock_exam` — pre-fill template, селектор бланк/форма

### Day 2 (must)
- [ ] Student-side: alternative render если `is_mock_exam=true`
  - Linear list 26 задач (no guided chat)
  - Form Part 1 (5 типов input под check_mode)
  - Photo Part 2 (1 фото на задачу)
  - Visual timer (just countdown, no enforce)
  - Single submit
- [ ] Backend: `handleCheckAnswer` extension для mock — det Part 1 check + mock AI prompt для Part 2
- [ ] State machine: `submitted → ai_checking → awaiting_review → approved`

### Day 3 (must)
- [ ] Tutor-side: TutorHomeworkDetail mock-specific section (Part 2 cards с approve, Part 1 manual-input для бланк-режима)
- [ ] Approve action → push student через existing cascade
- [ ] Existing share-link для родителя — minimal mock-specific render
- [ ] **Lead-gen layer:** `/p/mock-invite/:slug`, anonymous attempt flow, lead capture, post-approval delivery
- [ ] Tutor profile public card (минимальный — name, avatar, contact CTA)

### Day 4 (must)
- [ ] Hot-fix critical issues
- [ ] Onboarding 1-pagers для всех 4 tutors (text + screenshots)
- [ ] Invite-link генератор для tutors
- [ ] **Параллельный запуск всех 4 пилотных tutors (live demo + access)**
- [ ] Telemetry monitoring

### Out of scope Phase 1 (для 3-4 дней — НЕ ДЕЛАЕМ)
- Отдельные таблицы mock_exam_*
- Полный split-view review (используем existing TutorHomeworkDetail)
- Полный criteria breakdown UI (I/II/III/IV галочки) — Phase 2
- Detailed AI prompt с 208-страничной методичкой — Phase 2
- Confidence flags визуально (high/medium/low бэйджи)
- AI parent summary (текст комментария от AI)
- Bulk approve high-confidence
- Manual lookup primary→test score
- Detailed standalone student report page
- ОГЭ
- 4 варианта (только 1, остальные в Phase 2)
- ФИПИ demo (Phase 2)
- Бланк OCR (Phase 3)
- Strict timer enforcement
- Cohort analytics

---

## 10. Open questions (для решения вместе)

Эти вопросы определяют последние развилки Phase 1. Жду твои ответы — после них я начинаю писать tasks.md.

1. **Монетизация Phase 1** — что значит «зарабатывать через 2-3 дня»?
2. **Pricing** — кто кому платит и сколько?
3. **Бланки UX по умолчанию** — какой режим default?
4. **Параллельно или последовательно** другие 3 репетитора в пилоте?

(Полный список с вариантами ответов — в моём следующем сообщении через AskUserQuestion.)

---

**Итого:** sellable MVP за 2-3 дня = расширение homework workflow с переименованием в «Пробники». Polishing в Phase 2. Public-facing продукт в Phase 3. Это позволяет Егору и его коллегам **сегодня** продавать новую ценность их ученикам.
