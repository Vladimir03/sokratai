# Feature Spec: Tutor Dashboard v2 (Кабинет репетитора · Phase 1)

**Версия:** v0.1
**Дата:** 2026-04-21
**Автор:** Vladimir Kamchatkin
**Статус:** approved

**Источник дизайна:** Claude Design handoff · `docs/design-system/handoff-dashboard/tutor-cabinet.html` + `tutor-kit/*`
**Tech stack:** Vite + React + TypeScript + Tailwind + shadcn/ui + Supabase
**Phase:** Phase 1 (Dashboard content only; chrome — в Phase 2)

---

## 0. Job Context

### Какую работу закрывает фича

| Участник | Core Job | Sub-job | Ссылка |
|---|---|---|---|
| Репетитор (B2B) | **R4** — Сохранение контроля и качества при масштабировании | R4-1 (быстрая оценка состояния учеников), R4-2 (реагировать на проблемы проактивно) | [job-graph](../../../discovery/research/SokratAI_AJTBD_job-graphs/) |
| Репетитор (B2B) | **R3** — Рутина ведения (расписание, оплаты, чаты) | R3-1 (проверить что сегодня) | — |

### Wedge-связка

- **B2B-сегмент:** B2B-1 (репетиторы физики ЕГЭ/ОГЭ)
- **B2C-сегмент:** — (это tutor-facing surface)
- **Wedge:** ДЗ-assembly workflow (главный wedge пилота). Dashboard — вход в workflow. Без него репетитор попадает сразу в общий список ДЗ и не видит триажа.

### Pilot impact

Dashboard — это **первый экран** каждой рабочей сессии репетитора. Сейчас он показывает 3 статистические карточки и список неактивных учеников — **нулевая сигнальная ценность для R4** (ничего про тренды и последние диалоги). Phase 1 добавляет триаж-виджет: кому падает балл, у кого просрочки, кто написал в чат. Это прямой driver R4-2 (reactive → proactive) — ключевой для pilot renewal («Егор выдаёт ≥3 guided ДЗ в неделю на 4-й неделе пилота» становится наблюдаемым вместо «надо листать каждого ученика»).

---

## 1. Summary

Заменяем текущий `/tutor/dashboard` на новый `/tutor/home` — триаж-виджет по шаблону `TplDashboardV2` из design handoff. Главный экран отвечает на 3 вопроса репетитора в первые 10 секунд входа:

1. **Что у меня сегодня?** (4 занятия, 4 работы на проверке, 2 ученика требуют внимания, 5 последних диалогов)
2. **Кому плохо на этой неделе?** (таблица «Активность учеников» с weekly strip, трендом балла и сигналами)
3. **Что делать сейчас?** (2 CTA-карточки: «Назначить ДЗ» и «Выставить счёт» + 2 кнопки в шапке: «Новое занятие» и «Добавить ученика»)

**Текущий TutorLayout (top-bar navigation) не меняем.** Новый chrome (AppFrame + SideNav + TopBar из handoff) — в Phase 2.

---

## 2. Problem

### Текущее поведение
- `/tutor/dashboard` содержит 3 сводные карточки (Ученики / Ожидается к оплате / Получено), список «Требуют внимания» (только по критерию `>7 дней без активности`) и приветствие.
- Нет тренда балла, weekly-strip, сигналов per-student, списка последних диалогов, расписания на сегодня, очереди «требует проверки».
- Репетитор не видит **что делать сейчас** — нужно кликать в каждую вкладку (Ученики → Фильтры → ДЗ → Чаты) и собирать картину руками. На 14 учениках это ~3–5 минут триажа.

### Боль
- **R4-2 невозможен:** нельзя проактивно заметить падение балла → ученик уходит в просрочку → родитель пишет «почему неэффективно?» → renewal под угрозой.
- **R3-1 плохо покрыт:** сегодняшние занятия и последние сообщения от учеников разбросаны (Расписание + Чат на каждом студенте).
- **Pilot friction:** Егор в feedback (chat1.md, 2026-04) говорит прямо: «нужна динамика ученика из недели в неделю + на каких учеников нужно обратить внимание».

### Текущие «нанятые» решения

- Google Calendar для сегодняшнего расписания.
- Excel для тренда балла по ученику.
- Telegram-чат для реакции на вопросы учеников.
- Личный блокнот для «надо разобрать с Артёмом».

Цель Phase 1 — сложить всё это в один экран и убить нужду в Excel/блокноте.

---

## 3. Solution

### Описание

Одна страница, 6 блоков сверху вниз (desktop-first, 13–16″):

1. **Home header** — приветствие + daily meta-line + 2 действия (`Новое занятие` outline, `Добавить ученика` primary).
2. **HomeCTAs (2 карточки)** — `Назначить ДЗ` (sub: «Из базы или по теме») · `Выставить счёт` (sub: «N ждёт оплаты · M долг»).
   > ⚠ Третья карточка «Добавить ученика» с подписью «Ссылка-приглашение в Telegram» из HTML-прототипа **удалена** (per ответ заказчика); эта функция остаётся primary-кнопкой в header.
3. **Stat strip (`t-stats` × 4)** — Активных учеников · Требуют внимания · Ø балл за неделю · К оплате.
4. **Two-column grid:** `Сегодня` (4 SessionBlock) · `Требует проверки` (4 SubmissionRow).
5. **Последние диалоги** (5 chat-rows) — **перемещено из низа HTML-прототипа наверх**, сразу под `Сегодня/Требует проверки`, per ответ заказчика.
6. **Активность учеников** — полноширинная таблица: Ученик / Последние 5 недель / Ø балл ДЗ / Тренд (sparkline) / Пробник / Сигнал / Actions. Segment-сортировка ⚠ attention / По тренду / А→Я.

### Ключевые решения

**КР-1. Chrome: keep existing TutorLayout.**
Не трогаем `src/components/tutor/TutorLayout.tsx`. Логотип «Сократ AI» в top-bar остаётся, horizontal nav tabs остаются. Причины: (a) Variant 1 (узкий) минимизирует blast radius; (b) без AppFrame/SideNav все остальные 12 tutor-страниц рассогласуются визуально; (c) Phase 2 сможет выполнить миграцию chrome за один coherent заход.

**КР-2. Design tokens: hybrid helper-CSS + shadcn.**
Создаём `src/styles/tutor-dashboard.css` с namespace-классами из handoff (`.t-stats`, `.t-section`, `.t-table-wrap`, `.home-cta`, `.home-ctas`, `.chat-row`, `.home-activity-table`, `.t-session`, `.home-header`). Каждое правило читает **только** `var(--sokrat-*)` из уже подключённого `src/styles/colors_and_type.css`. Новых CSS-переменных не вводим. Импорт файла — строкой ниже `colors_and_type.css` в `src/index.css`.

Обёртка страницы — `<div className="sokrat" data-sokrat-mode="tutor">`. Kit опирается на этот атрибут для density/hit-targets.

**КР-3. Кнопки primary-green на Dashboard.**
CLAUDE.md фиксирует Phase 2 compatibility bridge: `--primary` пока slate, `--accent` пока green. В дизайне CTA везде `var(--sokrat-green-700)`. Пока не сделан semantic cleanup (Phase 2), используем **явный green** через inline token reference: `className="bg-[var(--sokrat-green-700)] hover:bg-[var(--sokrat-green-800)] text-white"` либо через новый вариант `Button` — `variant="primaryGreen"` (если решим добавить в `src/components/ui/button.tsx`). **Не использовать `bg-accent` / `bg-primary`** на Dashboard — это создаст долг при Phase 2 swap.

**КР-4. Новый route `/tutor/home`.**
Старый `/tutor/dashboard` → **redirect to `/tutor/home`** через `<Navigate replace>` в `App.tsx` (как уже сделано для `homework/:id/results`). Файл `src/pages/tutor/TutorDashboard.tsx` → **удаляется** вместе со старым route. Текущая warmup-список в `TutorLayout.tsx` получает `TutorHome` вместо `TutorDashboard`.

**КР-5. Data layer: один composable hook `useTutorHomeData`.**
Вместо N отдельных useQuery в компонентах — **один hook** `src/hooks/useTutorHomeData.ts`, который через `useQueries()` batch-ит:
- `useTutor()` (существует) — для имени («Добро пожаловать, Владимир»)
- `useTutorStudents()` (существует) — для stats + строк активности
- `useTutorPayments()` (существует) — для «К оплате»
- `useTutorTodayLessons()` (new) — sessions today
- `useTutorReviewQueue()` (new) — completed threads требующие проверки
- `useTutorRecentDialogs()` (new) — последние 5 сообщений
- `useTutorStudentActivity()` (new) — weekly strips + hwTrend + attention для ≤20 учеников

Все новые query keys строго по конвенции `['tutor', 'home', entity]` (см. `.claude/rules/performance.md` §2c).

**КР-6. Sparkline, weekly strip, delta-pill — локальные компоненты.**
Не зависим от внешних chart-библиотек (см. `.claude/rules/performance.md`: recharts запрещён в shared). `<Sparkline>` — inline SVG polyline (стиль из handoff `students-split.jsx`). `<WeeklyStrip>` — 5 flex-span блоков. `<DeltaPill>` — span с `↑` / `↓` + число. Reuse из `tutor-kit/students-split.jsx` как референс.

### Scope

**In scope (P0 — Must-Have):**
1. Новая страница `src/pages/tutor/TutorHome.tsx` по route `/tutor/home` (с redirect со старого `/tutor/dashboard`).
2. Файл `src/styles/tutor-dashboard.css` + импорт в `src/index.css`.
3. Home header (приветствие + daily meta + 2 кнопки).
4. HomeCTAs — **2 карточки** (Назначить ДЗ, Выставить счёт).
5. Stat strip (4 ячейки) — Активные / Требуют внимания / Ø балл / К оплате.
6. `Сегодня` + `Требует проверки` (двухколонка).
7. `Последние диалоги` — 5 строк (moved up per заказчика).
8. `Активность учеников` — таблица с weekly strip + trend sparkline + attention signal + Segment-сортировка.
9. Mode wrapper `data-sokrat-mode="tutor"`.
10. Data hooks: `useTutorTodayLessons`, `useTutorReviewQueue`, `useTutorRecentDialogs`, `useTutorStudentActivity`.

**In scope (P1 — Nice-to-have, деплоим как follow-up 1–2 дня спустя):**
- Segment-сортировка в «Активность учеников» (⚠ attention / По тренду / А→Я). Если не успеваем в P0 — дефолт «⚠ attention» и убрать segment UI.
- Клик по строке в таблице «Активность учеников» → open student profile (`/tutor/students/:id`).
- Клик по chat-row → open homework detail с thread viewer раскрытым для того ученика.
- Delta-pill в «Пробник» при наличии данных — пока что просто «—» placeholder.

**Out of scope (Parking Lot / Phase 2+):**
- AppFrame + SideNav + TopBar (новый chrome).
- Global search (top-bar input) — из HTML убран per заказчика.
- Command palette (⌘K / «/» shortcut).
- Avatar в top-bar, notifications bell.
- Brand mark «Сократ · Тьютор» (оставляем «Сократ AI»).
- Большая primary-green CTA «Добавить ученика» с подписью «Ссылка-приглашение в Telegram» (удалена per заказчика).
- Группы, Мои задачи, Тарифы — отдельные tutor-pages, не относятся к Dashboard.
- Пробник — реальный источник данных (нет такого entity в БД; placeholder «—» в v1).

---

## 4. User Stories

### Репетитор

**US-R1.** Когда я захожу на `/tutor/home` утром, я хочу за 10 секунд увидеть сколько уроков сегодня, сколько работ на проверке и кого нужно потрогать — чтобы спланировать день, не открывая 4 вкладки.

**US-R2.** Когда я вижу ⚠ на ученике в «Активности», я хочу открыть его профиль одним кликом и сразу увидеть — в какой задаче он застрял — чтобы ответить ему целенаправленно.

**US-R3.** Когда я вижу новое сообщение от ученика в «Последних диалогах», я хочу перейти в ДЗ с раскрытым чатом этого ученика, чтобы не искать вручную через Ученики → Профиль → ДЗ → Guided.

**US-R4.** Когда у меня 2 ученика в долгу, я хочу нажать «Выставить счёт» и попасть в форму, уже предфильтрованную по должникам — чтобы не листать 14 записей.

**US-R5.** Когда я вижу weekly-strip «5 серых клеток подряд» у ученика, я понимаю, что ДЗ ему давно не назначалось — это сигнал для R4-1, не требующий AI.

---

## 5. Technical Design

### Затрагиваемые файлы

**Новые:**
- `src/pages/tutor/TutorHome.tsx` — страница
- `src/styles/tutor-dashboard.css` — helper-классы из handoff (scope `[data-sokrat-mode="tutor"]`)
- `src/hooks/useTutorHomeData.ts` — аггрегатор (использует composable hooks ниже)
- `src/hooks/useTutorTodayLessons.ts` — сегодняшние уроки
- `src/hooks/useTutorReviewQueue.ts` — требует проверки
- `src/hooks/useTutorRecentDialogs.ts` — последние диалоги
- `src/hooks/useTutorStudentActivity.ts` — weekly strip + hwTrend + attention
- `src/components/tutor/home/HomeHeader.tsx` — greeting + actions
- `src/components/tutor/home/HomeCTAs.tsx` — 2 CTA-карточки
- `src/components/tutor/home/StatStrip.tsx` — 4 ячейки
- `src/components/tutor/home/TodayBlock.tsx` — сегодня + SessionBlock
- `src/components/tutor/home/ReviewQueueBlock.tsx` — требует проверки + SubmissionRow
- `src/components/tutor/home/RecentDialogsBlock.tsx` — последние диалоги + ChatRow
- `src/components/tutor/home/StudentsActivityBlock.tsx` — таблица + Segment sort + Sparkline + WeeklyStrip + DeltaPill

**Изменяем:**
- `src/App.tsx` — добавить route `/tutor/home` → `TutorHome`, redirect `/tutor/dashboard` → `/tutor/home` через `<Navigate replace>`
- `src/components/tutor/TutorLayout.tsx` — обновить warmup chunk: `TutorDashboard` → `TutorHome` и добавить link «Главная» указывающий на `/tutor/home`
- `src/index.css` — добавить `@import './styles/tutor-dashboard.css'` **после** `./styles/colors_and_type.css`

**Удаляем:**
- `src/pages/tutor/TutorDashboard.tsx` — заменён `TutorHome.tsx`

**Не трогаем:**
- `src/styles/colors_and_type.css` — single source of truth, новых токенов не вводим
- `tailwind.config.ts` — ок, если используем `bg-[var(--sokrat-green-700)]`; добавление нового color-токена опционально (в следующей итерации)
- Все остальные tutor pages и hooks

### Data Model

**Новые таблицы/колонки:** нет. Используем существующие:
- `tutor_lessons` — сегодняшние занятия
- `tutor_students` — список учеников + `status` + `created_at` (+7d)
- `tutor_payments` — pending + overdue
- `homework_tutor_assignments` + `homework_tutor_student_assignments` — дедлайны + submitted_at
- `homework_tutor_threads` (status='completed') + `homework_tutor_thread_messages` — очередь проверки + последние диалоги

### API / data contracts

#### `useTutorTodayLessons()`

```ts
type TodaySession = {
  id: string;
  time: string;           // "10:00"
  studentName: string;    // "Маша К." — short name
  topic: string;          // "Кинематика · разбор ДЗ"
  stream: "ЕГЭ" | "ОГЭ";
  lessonId: string;       // FK → tutor_lessons.id (для навигации)
};
```

Query: `SELECT ... FROM tutor_lessons WHERE tutor_id=:me AND start_at::date = CURRENT_DATE ORDER BY start_at`. Клиент форматирует `time` локально (`date-fns` с `parseISO`, формат `HH:mm`).

Query key: `['tutor', 'home', 'today-lessons']`. `staleTime: 60_000`.

#### `useTutorReviewQueue()`

```ts
type ReviewItem = {
  id: string;                 // student_assignment_id
  name: string;               // "Маша Коротаева"
  stream: "ЕГЭ" | "ОГЭ";
  submittedAt: string;        // "21.04 09:14"
  score: number;              // 8
  total: number;              // 8
  answers: ("ok" | "part" | "miss")[];  // per-task
  aiFlag: "ok" | "warn" | "unclear";
  aiWarnCount?: number;       // only when aiFlag==='warn'
  assignmentId: string;       // для навигации
};
```

Источник: `homework_tutor_student_assignments WHERE status='completed' AND tutor_viewed_at IS NULL` + JOIN `homework_tutor_threads`. Если нет колонки `tutor_viewed_at` — использовать `needs_attention` из `handleGetResults` + fallback «completed за последние 48h». Ограничиваем до 5 строк; при >5 показываем «Все ДЗ» ghost-кнопку в header.

**Open Q (non-blocking, discovery in Tasks):** существует ли `tutor_viewed_at` в репо? Если нет — создать **в Phase 2** (additive migration), в Phase 1 fallback на «completed < 48h AND needs_attention OR aiFlag='warn'».

Query key: `['tutor', 'home', 'review-queue']`. `staleTime: 30_000`.

#### `useTutorRecentDialogs()`

```ts
type DialogItem = {
  studentId: string;          // tutor_students.id
  name: string;               // full display name
  stream: "ЕГЭ" | "ОГЭ";
  from: "me" | "student";
  preview: string;            // first ~80 chars of latest message
  at: string;                 // relative time: "14 мин" / "1 ч" / "вчера 21:40"
  hwId: string;               // FK assignment
  hwTitle: string;
};
```

Query: `SELECT DISTINCT ON (sender_student_id) ... FROM homework_tutor_thread_messages JOIN homework_tutor_threads ... WHERE role='user' AND tutor_id=:me ORDER BY sender_student_id, created_at DESC LIMIT 5`. Relative time — `formatDistanceToNow` из `date-fns` (`ru` locale).

Query key: `['tutor', 'home', 'recent-dialogs']`. `staleTime: 30_000`.

#### `useTutorStudentActivity()`

```ts
type StudentActivity = {
  id: string;
  name: string;
  stream: "ЕГЭ" | "ОГЭ";
  weekly: ("ok" | "late" | "part" | "miss" | "none")[];  // length 5, latest last
  hwAvg: number | null;       // 4.3 (avg % last 6 HW / 20 → scale to 5)
  hwTrend: number[];          // length ≤ 6, for sparkline
  hwAvgDelta: number;         // +0.1 / -0.2 for color
  mockLast: null;             // v1: always null (Parking Lot)
  mockDelta: null;            // v1: always null
  attention: boolean;
  attentionReason: string | null;  // "Просрочено ДЗ «X»" | "Падает балл" | "Неактивен 9 дней"
};
```

**Weekly strip логика (B1, согласовано):**
- Для каждой из 5 календарных недель (пн-вс, последняя = текущая):
  - Берём все `homework_tutor_student_assignments` ученика, у которых deadline попадает в неделю.
  - `ok` = все из них `status='completed'` AND `submitted_at ≤ deadline`.
  - `late` = есть completed, но с `submitted_at > deadline`.
  - `part` = есть in_progress threads (partial task_states).
  - `miss` = есть назначения, deadline прошёл, нет submitted.
  - `none` = нет назначений на эту неделю.
- Приоритет при множестве ДЗ в неделе: `miss > late > part > ok > none`.

**hwTrend логика (B2):**
- Последние 6 completed ДЗ ученика (по `submitted_at` desc, потом reverse).
- `final_score / total_max` через существующий `handleGetResults.per_student[*]` → кэшируется.
- `hwAvg` = среднее последних 6 точек (ratio → отформатирован в 5-балльную шкалу: `ratio * 5`, `toFixed(1)`).
- `hwAvgDelta` = `avg(last 3) − avg(previous 3)` на той же шкале.

**Attention логика (B4, согласовано с 3 триггерами):**
- `hasOverdue` = есть ≥1 `homework_tutor_student_assignments` с `deadline < now AND status != 'completed'` → reason = `«Просрочено ДЗ «{title}»»`.
- `scoreDropping` = `hwAvgDelta < -0.5` (в 5-балльной шкале, ~10% снижение) → reason = `«Падает балл»`.
- `inactive` = нет активности (submitted_at / message) за последние 7 дней → reason = `«Неактивен {N} дней»`.
- Приоритет reason: `hasOverdue > scoreDropping > inactive`.
- `attention = hasOverdue || scoreDropping || inactive`.

Query key: `['tutor', 'home', 'student-activity']`. `staleTime: 60_000`. Ограничение: первые **20 учеников** (top-15 по `attention` + top-5 по recency). Если `tutor_students.length > 20` — секция показывает счётчик «отображается 20 из N».

**Performance guard:** не делать N+1. Один RPC `tutor_home_student_activity()` (`SECURITY DEFINER`) возвращает JSON-агрегат. Phase 1 приемлемо сделать на фронте через `useQueries` (существующий паттерн), **если** latency ≤ 1.5 сек на 20 учениках. Если нет — RPC-миграция в P0. См. Risks.

#### Stat strip derivation

Все 4 значения строятся **на клиенте** из уже-существующих hooks:

```ts
{
  activeStudents: students.filter(s => s.status==='active').length,
  activeWeekDelta: students.filter(s => s.status==='active' && parseISO(s.created_at) > sub(now,{days:7})).length,
  attentionCount: studentActivity.filter(s => s.attention).length,
  avgScoreWeek: round(mean(studentActivity.map(s => s.hwAvg).filter(Boolean)), 1),
  avgScoreDelta: round(mean(studentActivity.map(s => s.hwAvgDelta).filter(Boolean)), 1),
  toPay: payments.filter(p => ['pending','overdue'].includes(p.status)).reduce((sum,p)=>sum+p.amount,0),
  pendingCount: payments.filter(p=>p.status==='pending').length,
  overdueCount: payments.filter(p=>p.status==='overdue').length,
}
```

### Миграции

**Phase 1: нет миграций.** Вся логика строится на существующих таблицах.

**Phase 2 (deferred): `tutor_viewed_at`** в `homework_tutor_student_assignments` — чтобы Review Queue не зависел от временного 48h-окна. Отдельная spec.

### Вёрстка / breakpoints

- **≥1024px (desktop):** полная раскладка per HTML-прототип.
- **768–1023px (tablet):** stat-strip → 2×2 grid. `Сегодня`/`Требует проверки` → 2-col остаётся. Таблица «Активность» — `overflow-x-auto touch-pan-x` (как HeatmapGrid per `.claude/rules/80-cross-browser.md`).
- **<768px (mobile):** всё — 1 колонка. Stat-strip → 4×1 вертикально. SessionBlock и SubmissionRow — full-width. Текущий `TutorLayout` уже переключает nav на bottom bar.

---

## 6. UX / UI

### UX-принципы (из doc 16)

- **P1 — Job-first above the fold.** Первые 3 блока (header, CTAs, stat-strip) отвечают на «что у меня сегодня?» в 1 взгляд.
- **P3 — AI = draft + action.** Review Queue показывает AI verdict chip (`ok` / `warn`) + count — репетитор видит где AI сомневается и сразу идёт туда.
- **P5 — Tutor-first.** Весь экран про R4 (контроль). Никакого gamification, никакого ochre.

### UI-паттерны (из doc 17)

- **One primary action per screen.** Primary = `Добавить ученика` (green) в header. Вторичное `Новое занятие` — outline.
- **No cards inside cards.** HomeCTAs — плиточная сетка (3 карточки без внешнего контейнера-card). `StatStrip` — single card с hairline-cells. Таблица внутри `t-section`, без вложенной Card.
- **Numbers are tabular.** Все числовые колонки + stat-values: `font-variant-numeric: tabular-nums lining-nums`.
- **Math in Socratic path only.** На Dashboard нет формул → `KaTeX` не подгружаем.
- **Стрим-идентификация:** ЕГЭ = `--sokrat-green-*`, ОГЭ = `--sokrat-oge` (indigo) — только как chip text.

### Визуальные constant-ы

| Элемент | Token |
|---|---|
| Primary CTA bg | `var(--sokrat-green-700)` + hover `--sokrat-green-800` |
| Warning value (⚠) | `var(--sokrat-state-warning-fg)` |
| Success delta («+2 за неделю», «+0,1») | `var(--sokrat-state-success-fg)` |
| Muted meta-line | `var(--sokrat-fg3)` |
| Card bg | `var(--sokrat-card)` |
| Page surface | `var(--sokrat-surface)` |
| Hairline | `var(--sokrat-border-light)` |
| Row hit-target | 40–44 px (tutor mode) |
| Stat value | 22 / 600 |
| Section H2 | 15 / 600 |
| Meta | 13 / muted |
| Weekly strip cell | 14×20 rounded-3px |
| Sparkline width × height | 80×24 stroke 1.5 |

### Copy (verbatim)

Все строки копируются **дословно** из `dashboard-home.jsx`. Изменять текст без согласования — нельзя.

---

## 7. Acceptance Criteria (testable, P0 минимум)

**AC-1.** `GET /tutor/home` рендерит 6 блоков в порядке: home-header → HomeCTAs (2 tiles) → t-stats (4 cells) → 2-col (Сегодня + Требует проверки) → Последние диалоги → Активность учеников. Visual regression — сравнить с `docs/design-system/handoff-dashboard/tutor-cabinet.html` при viewport 1280×800, допуск по пикселям ≤ 4px (шрифт hinting). Pixel-diff обязателен для CI только при условии staging-environment.

**AC-2.** `GET /tutor/dashboard` отдаёт HTTP redirect на `/tutor/home` (через React-router `<Navigate replace>` без регрессий для user, уже находящегося на старом URL из закладок Telegram-бота).

**AC-3.** При пустом состоянии (0 учеников, 0 ДЗ, 0 платежей) страница НЕ падает: `t-stats` показывает «0», блоки «Сегодня» / «Требует проверки» / «Последние диалоги» показывают `EmptyState` с CTA `Добавить ученика`. Таблица «Активность учеников» скрыта.

**AC-4.** Home header показывает **ровно 2 кнопки** (`Новое занятие` outline + `Добавить ученика` primary green). **Карточка `Добавить ученика` с подписью `Ссылка-приглашение в Telegram` отсутствует в HomeCTAs.**

**AC-5.** HomeCTAs содержит **ровно 2 tiles**: `Назначить ДЗ` + `Выставить счёт`. Обе — не primary-цвет (carded, border-light bg).

**AC-6.** «Последние диалоги» рендерится **над** «Активность учеников» (DOM-order), не под — per ответ заказчика.

**AC-7.** Обёртка страницы: outer DOM `<div class="sokrat" data-sokrat-mode="tutor">` → проверяется через e2e DOM assertion.

**AC-8.** В «Активность учеников» weekly-strip рендерит 5 цветных блоков per student. При `attention=true` — слева от имени рендерится жёлтая точка (`--sokrat-state-warning-fg`, 6×6).

**AC-9.** Data integrity: `useTutorStudentActivity` возвращает stable sort по `attention desc → hwAvgDelta desc → name asc`. Первые N учеников (attention=true) всегда идут вверху при default-сортировке.

**AC-10.** Accessibility:
- Клик на row таблицы или chat-row запускается Enter/Space (role="button" + tabIndex=0).
- Все interactive цели ≥ 40px high (tutor hit-md minimum).
- Focus-visible ring: `outline: 2px solid var(--sokrat-green-700)` (уже в tokens.css).
- В Segment sort + Все ghost-buttons — `aria-label` на русском.

**AC-11.** Performance: TTI `/tutor/home` ≤ 2 сек на prod-chrome при 14 учениках (7 composable queries с `staleTime` 30–60 сек). React Query prefetch через warmup в `TutorLayout`.

**AC-12.** Mobile: при <768px stat-strip стакается в вертикаль. Таблица «Активность» имеет horizontal scroll с `touch-pan-x`. SessionBlock и ChatRow не ломаются по overflow.

---

## 8. Validation

### Метрики успеха

**Leading (3–7 дней):**
- **Engagement:** ≥ 80% открытий tutor-сессии начинаются с `/tutor/home` (был `/tutor/dashboard`, данные остаются сопоставимыми после redirect).
- **Triage-клики:** ≥ 40% сессий, где есть `attention=true`, содержат клик на строку таблицы «Активность учеников».
- **Dialog-клики:** ≥ 30% сессий с ≥ 1 сообщением ученика за 24h содержат клик в «Последних диалогах».

**Lagging (2–4 недели):**
- **R4 satisfaction:** Егор и Женя оценивают «понимаю куда смотреть сразу» ≥ 4/5 в weekly check-in (doc 18 pilot rhythm).
- **ДЗ velocity:** репетитор назначает ≥ 3 новых ДЗ в неделю на ≥ 70% учеников с `attention=true` в течение 48h после отметки (сейчас латентность ~3–5 дней).

### Связь с pilot KPI (doc 18)

- KPI «≥ 3 guided ДЗ / неделя на пилотного ученика» — directly accelerated by attention triage.
- KPI «tutor renewal week 4» — Dashboard даёт Егору explicit proof-of-value (`я вижу где проблема в 10 сек`).

### Smoke check

```bash
npm run lint && npm run build && npm run smoke-check
```

E2E-проверка (вручную в Phase 1, Playwright опционально в Phase 2):
1. `/tutor/dashboard` → redirect to `/tutor/home` ✓
2. 6 блоков в правильном порядке ✓
3. 2 CTA в HomeCTAs ✓
4. Пустое состояние: 0 учеников → EmptyState с CTA ✓
5. Viewport 375×812 (iPhone 13) → все блоки не overflow-рвутся ✓
6. Safari iOS: `position: sticky` на thead НЕ требуется (таблица <200 строк) ✓

---

## 9. Risks & Open Questions

| Риск | Вероятность | Митигация |
|---|---|---|
| Latency N+1 в `useTutorStudentActivity` на 20 учениках | Средняя | Замер в P0. Если > 1.5 сек — RPC-миграция (additive) `tutor_home_student_activity()` как follow-up |
| `tutor_viewed_at` колонки нет — Review Queue неточный | Средняя | Fallback на 48h-окно + `needs_attention`. Migration (Phase 2) убирает хак |
| `ai_flag` колонки в `homework_tutor_threads` тоже нет (TASK-2 discovery, 2026-04-21) — «aiFlag = warn» невозможно получить напрямую | Низкая | В Phase 1 `ReviewItem.aiFlag` выводится эвристикой из `handleGetResults.per_student[].needs_attention` (true → `warn`, иначе `ok`). `aiWarnCount` = число task_scores ниже 0.8·max. Добавить настоящий `ai_flag` — отдельная discovery в Phase 2 |
| iOS Safari ломает `overflow-x-auto` на таблице активности | Низкая | Re-use паттерна HeatmapGrid (rule 80 + rule 40 §HeatmapGrid) |
| Conflict helper-классов из `tutor-dashboard.css` с shadcn (например `.t-section` vs чьё-то `.section`) | Низкая | Всё с префиксом `t-*` / `home-*` / `chat-row` — namespace защищён |
| Weekly-strip data-derivation тяжёлая → блокирует render | Низкая | `useMemo` на tuple, Suspense fallback skeleton, не блокирует initial paint остальных блоков |
| Phase 2 swap `--primary` на ochre сломает CTA если мы юзаем `bg-primary` | Высокая | **КР-3**: использовать `bg-[var(--sokrat-green-700)]` либо явный `variant="primaryGreen"` |

### Открытые вопросы (non-blocking, решаем в Tasks)

| Вопрос | Кто решает | Блокирует? |
|---|---|---|
| Добавить ли `variant="primaryGreen"` в `src/components/ui/button.tsx` или всегда inline-классами? | engineering | нет — inline ок для Phase 1 |
| Нужен ли intersection-observer для lazy-load «Активность учеников» когда >20 учеников? | engineering | нет — ограничение 20 достаточно для пилота (максимум 28 учеников) |
| Куда вести клик по row таблицы активности — `/tutor/students/:id` существующий или новый split-view из Phase 2? | product (Vladimir) | нет — P1, default: текущий `/tutor/students/:id` |
| Какая формула конвертации `hwAvg` в 5-балльную шкалу? (`ratio * 5` или stepwise) | product (Vladimir) | нет — default `ratio * 5` |
| Когда промоутим `tutor-dashboard.css` → `tutor-kit.css` (shared)? | engineering | нет — Phase 2 |

---

## 10. Implementation Tasks (краткий план, детализация в `tasks.md`)

- [ ] **TASK-1** · Инфраструктура CSS-слоя: создать `src/styles/tutor-dashboard.css`, portion helper-классов из handoff, импортировать в `src/index.css`. Проверить что `--sokrat-*` токены доступны.
- [ ] **TASK-2** · Data hooks: `useTutorTodayLessons`, `useTutorReviewQueue`, `useTutorRecentDialogs`, `useTutorStudentActivity` + общий `useTutorHomeData`.
- [ ] **TASK-3** · Primitives: `<Sparkline>`, `<WeeklyStrip>`, `<DeltaPill>`, `<SessionBlock>`, `<ChatRow>`, `<SubmissionRowLite>`.
- [ ] **TASK-4** · Compose components: `HomeHeader`, `HomeCTAs`, `StatStrip`, `TodayBlock`, `ReviewQueueBlock`, `RecentDialogsBlock`, `StudentsActivityBlock`.
- [ ] **TASK-5** · Page: `TutorHome.tsx` — mode wrapper, все блоки в правильном порядке (Последние диалоги над Активностью).
- [ ] **TASK-6** · Routing: `/tutor/home` + `Navigate replace` со старого `/tutor/dashboard`. `TutorLayout.tsx` warmup + link update. Удалить `TutorDashboard.tsx`.
- [ ] **TASK-7** · Empty states + attention sorting + Segment filter (P1).
- [ ] **TASK-8** · Responsive breakpoints + iOS Safari cross-browser pass.
- [ ] **TASK-9** · Smoke check + Codex review + pilot deploy.

---

## 11. Parking Lot

Идеи, всплывшие во время spec, но не в scope Phase 1. Ревью при следующей итерации:

- **Chrome redesign (AppFrame + SideNav + TopBar).** Полный port handoff-layout — Phase 2. Затрагивает все 13 tutor-страниц → отдельная SPEC.
- **Global search + command palette (⌘K).** Убрано из header per заказчика. Kit-дизайн уже показывает placeholder + `/` shortcut — ok revisit когда будет >100 tutor-surfaces.
- **Пробник (mock score + delta-pill).** Требует нового entity `tutor_student_mock_scores` (или hijack `formula_round_results` с `round_type='mock'`). Отдельная spec после первого platform feedback.
- **Delta-pill component.** Готов для пробника; пока дремлет в кодовой базе без caller.
- **Bulk actions на таблице активности.** «Напомнить всем с ⚠» — вероятный next step после telemetry показывает 40%+ triage-кликов.
- **Group attention indicators.** В handoff есть GroupPanel, но Группы — отдельная tutor-page. Когда landed — подмешать в StatStrip «Групп: 3 · требует внимания: 1».
- **Notifications bell + unread badge.** Нет infra; после Realtime thread viewer (E9) можно добавить на top-bar → отдельная spec.
- **Drag-to-reorder разделов на Dashboard.** Personalisation — только после 2+ месяцев pilot feedback.
- **Sparkline tooltip (per-week score on hover).** Мини-UX лифт, не блокирует value.
- **Server-side aggregation RPC** `tutor_home_student_activity()` — если latency не держит Phase 1 target ≤ 1.5s.
- **`tutor_viewed_at` колонка** в `homework_tutor_student_assignments` для точной Review Queue. Additive, Phase 2.

---

## Checklist перед approve

- [x] Job Context заполнен (Section 0)
- [x] Привязка к Core Job (R4, R3) из Графа работ
- [x] Scope чётко определён (P0 / P1 / Out-of-scope / Parking Lot)
- [x] UX-принципы из doc 16 учтены
- [x] UI-паттерны из doc 17 учтены
- [x] Pilot impact описан (R4-2, renewal, 4-week KPI)
- [x] Метрики успеха (leading + lagging)
- [x] AC testable, ≥3 (всего 12)
- [x] P0 ≤ 5 (всего 10 P0 — на грани; если разбивать, отделить P1 Segment sort + row-клики в **Phase 1b**)
- [x] High-risk файлы (AuthGuard/TutorGuard/Chat.tsx) не затрагиваются
- [x] Student/Tutor изоляция не нарушена — файл живёт в `src/pages/tutor/` и `src/components/tutor/home/`
- [x] Design system hard rules (SKILL.md) соблюдены: mode wrapper, token hierarchy, no hex, Golos only, no ochre в tutor, one primary per screen
- [x] Phase-нарезка: Phase 1 = Dashboard content. Phase 2 = новый chrome (AppFrame/SideNav/TopBar + global search + brand mark «Сократ · Тьютор»). Phase 3 = пробник entity.
- [ ] Approve от Vladimir перед переходом к `tasks.md`
