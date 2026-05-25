## Цель

Дать тебе как админу два новых среза:
1. **Пробники ЕГЭ** — отдельная вкладка с тремя подвкладками (Список / Воронка / Качество AI), drill-down в read-only tutor surface + raw-data view.
2. **Per-tutor продуктовая аналитика** по расписанию и оплатам — прямо в карточки во вкладке «ДЗ» (она станет hub'ом «Репетиторы»).

Период всех метрик берётся из верхнего date-range picker'а (`startDate`, `endDate`).

---

## Часть 1 — Вкладка «Пробники»

### Новая вкладка в `src/pages/Admin.tsx`
Добавить `<TabsTrigger value="mock-exams">` между «ДЗ» и «Платежи» с иконкой `ClipboardCheck`. Внутри — `<AdminMockExams />` с собственным `Tabs` (3 sub-tabs).

### Новый компонент `src/components/admin/mock-exams/AdminMockExams.tsx`

**Sub-tab 1: «Список»** (`AdminMockExamList`)
- Breadcrumb-навигация (как в `AdminHomeworkChats`): Репетиторы → Пробники → Попытки → Detail/Review.
- Уровень 1: список tutors с числами «N пробников · M активных attempts · K ждут проверки».
- Уровень 2: список пробников tutor'а (`mock_exam_assignments`): title, variant, mode, status, counters по attempts.
- Уровень 3: список attempts с фильтрами по статусу (multi-select).
- Уровень 4: две кнопки рядом — **«Открыть как репетитор»** (read-only iframe/route на `/tutor/mock-exams/:id/review/:studentId` с админ-маркером) + **«Raw data»** (наш компонент с `ai_draft_json` per kim, `ai_part1_ocr_json`, `score_source`, flags, latency, timestamps).

**Sub-tab 2: «Воронка»** (`AdminMockExamFunnel`)
- 6 stat-карточек в ряд: Создано пробников → Назначено учеников → Начали → Сдали → AI-проверены → Approved tutor'ом.
- % drop-off между шагами.
- Bar-chart распределения attempts по статусам.
- Фильтр по периоду из верхнего picker'а + multi-select по tutor'ам.

**Sub-tab 3: «Качество AI»** (`AdminMockExamAIQuality`)
- KPI: avg(tutor_score − ai_suggested_score) по Часть 2; % low-confidence drafts; % override rate; частоты flags (photo_missing / image_inline_failed / awaiting_regrade / kim21_qualitative); avg latency grading.
- Heatmap «KIM × confidence» — где AI чаще ошибается.
- «Проблемные кейсы» список: stuck в `ai_checking >2 min` / OCR failed / photo_unreadable / high override delta (>3 баллов).

### Фильтры (top-bar внутри вкладки)
- Search/select по tutor (re-use паттерна из `AdminTutorList`).
- Multi-select по `mock_exam_attempts.status`.
- Date-range из верхнего picker'а Admin.tsx (передаётся пропом).
- «Проблемные кейсы» — toggle-чекбокс, фильтрует список и подсвечивает alarm-cards.

### Backend
Использовать существующий tool **`supabase--read_query`** (admin читает напрямую через service-role-grade RLS — у админа уже есть policy `has_role(auth.uid(),'admin')` на mock-exam таблицах через миграцию).

Если нужны агрегаты с join'ами, тяжёлыми для клиента — создать **1 новую edge function** `admin-mock-exams-analytics` (mirror `admin-homework-analytics` если такая есть, иначе с нуля): принимает `{ start, end, tutor_id?, status[]? }`, возвращает payload для всех 3 sub-tabs одним запросом.

### Anti-leak / read-only invariants
- Drill-down «Открыть как репетитор» рендерит обычный `TutorMockExamReview` за `AdminGuard`, но компонент получает prop `readOnly={true}` — скрыть approve/edit-score/regrade actions.
- `ai_draft_json` / `ai_part1_ocr_json` админу показываются полностью (он *должен* видеть raw — это диагностика).
- Никаких mutation endpoint'ов из этой вкладки.

---

## Часть 2 — Per-tutor метрики расписания и оплат (inline во вкладке «ДЗ»)

Вкладка «ДЗ» становится hub'ом «Репетиторы». Расширяем `AdminTutorList` (`src/components/admin/homework/AdminTutorList.tsx`) — каждая карточка tutor'а получает **две новые строки чипов** под существующими «ДЗ: X · Y акт.» и «N учеников».

### Расписание (новая строка чипов)
- **Adoption бейдж**: «Расписание: использует» (emerald) / «не использует» (slate, dim) — derived из `EXISTS(tutor_lessons WHERE tutor_id=X AND start_at BETWEEN start AND end)`.
- **Intensity**: «12 уроков · 8 done · 1 cancelled» за период (chip с разбивкой по `status`).
- **Recurrences**: иконка `Repeat` + «3 recurring», если есть `tutor_lessons.recurrence_rule IS NOT NULL` (если такого поля нет — посчитать по `series_id`/`source_lesson_id` если есть).

### Оплаты (новая строка чипов)
- **Adoption бейдж**: «Оплаты: ведёт» / «не ведёт» — `EXISTS(tutor_payments)`.
- **GMV**: «GMV: 24 500 ₽» — `SUM(amount) WHERE status='paid' AND created_at BETWEEN ...`.
- **Pending**: «Pending: 5 200 ₽» (amber chip если > 0) — `SUM(amount) WHERE status='pending'`.
- **Долги**: «Долг: 8 000 ₽ · 3 ученика» — aggregated overdue/pending по `tutor_student_id` (re-use существующего debt aggregation из `useTutorPayments`).

### Header вкладки «Репетиторы» (sticky KPI bar)
Над списком — 4 summary cards с totals за период:
- Tutors с расписанием: `X из Y (Z%)`
- Tutors с оплатами: `X из Y (Z%)`
- **Schedule → Payment funnel**: % tutors-у-которых-есть-И-расписание-И-оплаты за период (cross-product adoption — главная метрика что фичи работают вместе).
- Total GMV за период.

### Сортировка списка
Добавить selector «Сортировать»: Last activity (default) / GMV / Lessons / DZ count. Чтобы топ-tutors выплывали наверх.

### Top-N tutors (новый блок)
Под списком — collapsed accordion «Топ-5 по урокам / Топ-5 по GMV» с компактной таблицей. Чтобы быстро видеть power-users без скролла.

### Backend
Расширить существующий `adminHomeworkApi.ts` → `getAdminTutorOverview()` (или создать `adminTutorsOverview` если такой логики ещё нет):
- Один запрос, возвращает per-tutor агрегаты: `lessons_count`, `lessons_by_status`, `recurring_count`, `gmv_paid`, `gmv_pending`, `debt_amount`, `debt_students`, `dz_count`, `mock_exam_count` (бонус — увидим cross-feature adoption).
- Использовать GROUP BY по `tutor_id` с CTE для оплат и уроков, чтобы один round-trip.

---

## Файлы (новые / изменения)

**Новые:**
- `src/components/admin/mock-exams/AdminMockExams.tsx` (sub-tab wrapper)
- `src/components/admin/mock-exams/AdminMockExamList.tsx`
- `src/components/admin/mock-exams/AdminMockExamFunnel.tsx`
- `src/components/admin/mock-exams/AdminMockExamAIQuality.tsx`
- `src/components/admin/mock-exams/AdminMockExamAttemptRaw.tsx` (raw-data view)
- `src/lib/adminMockExamsApi.ts`
- `supabase/functions/admin-mock-exams-analytics/index.ts` (optional, если read_query будет тормозить)
- `src/components/admin/homework/AdminTutorScheduleChips.tsx`
- `src/components/admin/homework/AdminTutorPaymentChips.tsx`
- `src/components/admin/homework/AdminTutorsKPIBar.tsx`
- `src/components/admin/homework/AdminTopTutors.tsx`

**Изменения:**
- `src/pages/Admin.tsx` — новый TabsTrigger + TabsContent для mock-exams.
- `src/components/admin/homework/AdminTutorList.tsx` — две новые строки чипов на карточке + KPI bar сверху + sort selector + top-N accordion.
- `src/lib/adminHomeworkApi.ts` — расширение overview-запроса агрегатами по расписанию/оплатам.
- Read-only режим в `src/pages/tutor/mock-exams/TutorMockExamReview.tsx` через optional prop `readOnly` + guard на admin (NavLink в drill-down).

**Без миграций.** Все данные есть в существующих таблицах (`tutor_lessons`, `tutor_payments`, `mock_exam_*`).

---

## Technical notes (для разработчика)

- **RLS**: у админа уже есть `has_role(auth.uid(),'admin')` policy на `mock_exam_attempts` / `homework_tutor_assignments` / etc. Для `tutor_lessons` и `tutor_payments` проверить и добавить admin SELECT policy через миграцию, если её нет (одна миграция, RLS-only, additive).
- **Read-only `TutorMockExamReview`**: добавить prop `readOnly?: boolean`. По нему скрыть `ApproveFooter`, кнопки `Edit score` / `Regrade AI` / `Retry OCR`. Не убирать сами карточки и raw-показатели.
- **Caching**: все запросы через React Query с keys `['admin','mock-exams',sub-tab, filters]` и `['admin','tutors-overview', dateRange]`. `staleTime: 60_000`.
- **Период**: пробросить `startDate`/`endDate` из `Admin.tsx` через props во все новые компоненты — НЕ читать из URL/localStorage (single source of truth).
- **Performance**: для funnel/quality агрегатов — желателен edge function (избежать N+1 SELECT'ов). Для inline tutor chips — один CTE-запрос на overview достаточно (≤ 100 tutors).

---

## Out of scope (не делаем сейчас)

- Mutation actions из админки (force-approve / cancel attempt) — только read.
- Export to CSV — добавим если попросишь после первой итерации.
- Per-student deep dive внутри пробника — только attempt-level (если нужен student-level — открываем review).
- Email leg для проблемных кейсов — только UI alert.
