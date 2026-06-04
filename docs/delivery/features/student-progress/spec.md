# Spec — Прогресс по ученикам + галочка «проверено»
### Техническая спецификация · v0.1 (черновик для разработки) · 2026-06-02

> **Связанные документы:** [`01-custdev-extract.md`](./01-custdev-extract.md) · [`02-prd-ajtbd.md`](./02-prd-ajtbd.md) · [`03-design-brief.md`](./03-design-brief.md) · [`04-score-scales.md`](./04-score-scales.md). Макеты: Claude Design v2 (hero · успеваемость · проверка · отчёт `/p/:slug`).
> **Канон репо:** читать `.claude/rules/40-homework-system.md` (task_states, dual write-path, anti-leak), `45-mock-exams.md` (approve state machine, share-leak модель), `50-kb-module.md`, `80-cross-browser.md`, `90-design-system.md`, `95-production-deploy.md`, `97-edge-function-error-contract.md`.
> **Принцип:** максимум переиспользования существующих сущностей. Новое — только там, где модели нет.

---

## Section 0 · Job Context (трассировка к AJTBD Job Graph)

> Граф работ: `docs/discovery/research/SokratAI_AJTBD_job-graphs/SokratAI_AJTBD_elite-physics-finish-sprint-job-graph.md`.

**Какую работу закрывает (B2B2C-overlap = сильный сигнал приоритета):**

| Участник | Core Job | Sub-job(s) | Как закрываем |
|---|---|---|---|
| Репетитор (B2B-1) | R1 — Автопроверка ДЗ | **R1-5** финализировать/одобрить фидбек | галочка «проверено» = одобрение AI-черновика до показа ученику |
| Репетитор | R3 — Отчёты родителям | **R3-1** агрегация прогресса, **R3-2** визуальный отчёт, **R3-3** отправка | страница ученика + отчёт `/p/:slug` |
| Репетитор | R4 — Контроль качества при масштабировании | **R4-4** единый стандарт фидбека | «не держать в голове, что проверил» + обзор «Успеваемость» |
| Родитель (B2C-1) | P1 — Максимизация балла | **P1-2** карта проблемных тем | зелёный/жёлтый/красный карта тем в отчёте |
| Родитель | P3 — ROI | **P3-1** система 24/7, **P3-2** ROI в баллах | прогноз/динамика/цель в отчёте |
| Школьник (B2C-1) | S2 — Быстрый фидбек | **S2-4** увидеть свой прогресс | **ОТЛОЖЕНО (P2)** — ученик-зеркало вырезано из v1 |

**Job Statement:** когда у меня много активных работ одновременно, я хочу одним взглядом видеть, кто что сдал, что я уже проверил и какие баллы, и одним движением собрать отчёт родителю — чтобы не держать всё в голове, не обходить каждую домашку и иметь «прикрытие результата».

**Wedge:** не сам wedge (ядро = R4-1 конструктор ДЗ), а **R1-5 + R3 слой** поверх него; закрывает работы репетитора (R1-5, R3-1..3, R4-4) И родителя (P1-2, P3-1/2) одновременно.

**Pilot impact:** Елена (P0-владелец запроса) перестаёт обходить 15 домашек и слать отчёты вручную; прямо усиливает удержание (сценарий оттока «результата не видим» `[L873]`).

**Сегменты-пользователи:** репетитор (покупатель+юзер) · родитель (потребляет `/p/:slug`, без логина) · ученик (источник данных; зеркало прогресса — P2).
**Источник:** кастдев 3/3 (Елена P0 `[L856,L1183,L1187]`, Вадим `[L1752]`, Эмилия `[L185,L35]`).

> **NB по нотации:** Job-коды (`R1-5`, `R3-1`, `P1-2`…) — из Графа работ. В §7 ниже «R1/R2/R3» = **требования фичи** (Requirements), не путать с Job-кодами графа.

---

## 1 · Обзор и границы

**Что строим.** Агрегат успеваемости «по ученику» (а не «по ДЗ») во вкладке «Ученики»: подвкладка «Успеваемость» (кросс-ученический список) → страница ученика `/tutor/students/:id` (вкладки «Прогресс» / «Отчёт»). Плюс tutor-подтверждение «проверено» внутри работ (паритет с approve пробника) и публичный отчёт родителю `/p/:slug`.

**Анти-скоуп (Non-Goals, жёстко):** НЕ billing/баланс/оплаты/тарифы; НЕ воронка лидов/CRM продаж; НЕ родительский логин-кабинет; НЕ авто-постинг по cron (v1); НЕ новая модель оценивания (берём `computeFinalScore`); НЕ показ посещаемости (не наша данные).

**Три шкалы (см. `04-score-scales.md`):** задачные баллы — универсальная истина (хранятся); rollup работы — в родной единице (`score_kind`); цвет ячеек везде = % от max. Не усреднять разные шкалы в одно число.

---

## 2 · Модель данных (миграции)

> Все миграции — additive (`ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`). Соблюдать column-GRANT whitelist на `homework_tutor_task_states` (rule 40 / migration `20260516120100` паттерн).

### 2.1 Галочка «проверено» — расширение `homework_tutor_task_states`
Миграция `..._add_tutor_reviewed_to_task_states.sql`:
- `tutor_reviewed_at TIMESTAMPTZ NULL` — «проверено репетитором». **Видна ученику** (бейдж «Проверено») → **GRANT** SELECT на authenticated.
- `tutor_reviewed_by UUID NULL` — audit, **tutor-only**: НЕ GRANT'ить authenticated + добавить в `stripStudentSensitiveTaskStateFields` (mirror `tutor_force_completed_by`).

**Семантика (ортогонально `status`!):**
- `tutor_reviewed_at != NULL` = задача проверена → итоговый балл залочен для агрегата/отчёта; «возвращаться не надо».
- Отлична от `tutor_force_completed_at` («закрыто без AI») и от AI-вердикта CORRECT (`status='completed'`). Задача может быть `completed` (AI CORRECT) но ещё `reviewed_at IS NULL` (тьютор не подтвердил).
- **Reopen review** = `tutor_reviewed_at = NULL` (mirror reopen force-complete).

**Пробники (mock-exam):** «проверено» = существующий `attempt.status='approved'` (rule 45). НЕ добавлять `tutor_reviewed_at` в `mock_exam_*` — переиспользуем approve state machine.

### 2.2 Цель ученика — `tutor_student_targets`

> **⚠️ РЕШЕНИЕ v1 (Vladimir, 2026-06-02): цель ПЕРЕИСПОЛЬЗУЕТ `tutor_students`, новая таблица НЕ создаётся.** `tutor_students` уже имеет `target_score INT (0–100)` + `exam_type ('ege'|'oge')` + `subject` + `current_score`. `PATCH /students/:id/target` пишет `target_score`+`exam_type`. Следует принципу спеки «максимум переиспользования». **Отложено до P2** (вместе с multi-subject): отдельная `tutor_student_targets`, `track='school'` target, `scale_year` (v1 неявно 2026 в `_shared/score-scales.ts`). `current_level` — НЕ из `tutor_students.current_score` (legacy/manual), а вычисляется из последнего подтверждённого пробника (Q2). Схема ниже — справка для P2.

Миграция `..._create_tutor_student_targets.sql` (P2, НЕ в v1):
```
tutor_student_targets(
  id uuid pk,
  tutor_student_id uuid not null references tutor_students(id) on delete cascade,
  track text not null check (track in ('ege','oge','school')),
  subject text null,                 -- physics/maths/... (future multi-subject)
  target_score numeric null,         -- ЕГЭ: 0–100; ОГЭ/школа: 2–5
  target_scale_year int not null default 2026,
  updated_by uuid not null,
  updated_at timestamptz not null default now(),
  unique (tutor_student_id, subject)
)
```
RLS: tutor управляет строками своих `tutor_students` (JOIN-chain `tutor_students.tutor_id = auth.uid()`). v1 — одна строка на ученика (subject NULL); таблица future-proof под multi-subject.

### 2.3 Ручные активности + заметки — `tutor_manual_activities` (R4, v1.1)
Миграция `..._create_tutor_manual_activities.sql`:
```
tutor_manual_activities(
  id uuid pk,
  tutor_student_id uuid not null references tutor_students(id) on delete cascade,
  title text not null,
  score_kind text not null check (score_kind in ('primary','ege_scaled','oge_grade','school_grade')),
  primary_score numeric null, primary_max numeric null,   -- score_kind='primary'
  grade numeric null,                                      -- school_grade/oge_grade (2–5)
  scale_year int null,
  activity_date date not null,
  tutor_note text null,             -- «знания теории, проблемы с урока» (Вадим)
  reviewed_at timestamptz null,     -- ручные сразу считаются проверенными при создании
  created_by uuid not null,
  created_at timestamptz not null default now()
)
```
RLS: tutor-only (через `tutor_students`). **Никогда** не публикуется ученику/родителю кроме явного включения в отчёт (R3 settings).

### 2.4 Публичный отчёт — `student_report_share_links`
Миграция `..._create_student_report_share_links.sql` (mirror `homework_share_links` + `public-homework-share`, rule 45 share-leak модель):
```
student_report_share_links(
  id uuid pk,
  slug text not null unique,                 -- crypto.randomUUID().replace(/-/g,'').slice(0,8).toLowerCase()
  tutor_student_id uuid not null references tutor_students(id) on delete cascade,
  period_kind text not null check (period_kind in ('week','4weeks','custom')),
  period_start date null, period_end date null,
  include_tutor_comment boolean not null default true,
  expires_at timestamptz null,
  created_by uuid not null,
  created_at timestamptz not null default now()
)
```
- Slug regex `^[a-z0-9]{8}$` (синхронно tutor-side и public endpoint, как rule 45).
- RLS: `Tutors manage own report links` (через `tutor_students.tutor_id = auth.uid()`). Публичное чтение — **НЕ** через RLS, отдельный service_role edge (см. §3.4).
- Множественные ссылки на одного ученика **разрешены** (родителю / себе) — не дедуплицировать.

---

## 3 · Backend (edge functions)

> Новый домен → новый edge function **`tutor-progress-api`** (verify_jwt=true) для tutor-операций + новый публичный **`public-student-report`** (verify_jwt=false). Регистрировать в `supabase/config.toml` + deploy workflow + `scripts/supabase-drift-check.mjs` (rule 96 #11). Контракт ошибок — rule 97 (русские фразы, `{error, code}`, `extractEdgeFunctionError` на клиенте).

### 3.1 Подтверждение «проверено» — атомарные RPC (mirror force-complete)
Миграции RPC (SECURITY DEFINER, `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO service_role`, race-guard как `hw_tutor_force_complete_task`):
- `hw_tutor_review_task(assignment, student, task, tutor, score?, comment?)` — ставит `tutor_reviewed_at=now()`, `tutor_reviewed_by=tutor`; опц. `tutor_score_override`+comment (вариант «изменить балл и подтвердить»). **AI-балл не перезаписывается.** Race-guard: повторное подтверждение already-reviewed → `409 ALREADY_REVIEWED`.
- `hw_tutor_review_all_ai(assignment, student, tutor)` — bulk: `tutor_reviewed_at=now()` для всех task_states где `ai_score IS NOT NULL AND tutor_reviewed_at IS NULL`. **Баллы не трогает.** Возвращает `{reviewed_count}`.
- `hw_tutor_reopen_review(assignment, student, task, tutor)` — `tutor_reviewed_at=NULL` (+ clear reviewed_by). 409 если уже не reviewed.

Edge endpoints (`tutor-progress-api`) — тонкие обёртки над RPC + ownership (`assignment.tutor_id=auth.uid()`):
`POST /assignments/:id/students/:sid/review-task` · `/review-all-ai` · `/reopen-review`.
Пробник: «проверено» идёт через существующий `mock-exam-tutor-api` approve (не дублировать).

### 3.2 Агрегат по ученику — `GET /students/:studentId/progress`
Single round-trip `{ student, target, works[], summary }`.
- Ownership: `tutor_students.tutor_id = auth.uid()` (404 если не его ученик).
- `works[]` = объединение: (a) `homework_tutor_assignments` ученика + per-task `homework_tutor_task_states` → `final_score` через **`computeFinalScore`** (не дублировать формулу) + `reviewed = (tutor_reviewed_at != null)`; (b) `mock_exam_attempts` ученика → primary + scaled (через таблицу `04-score-scales`) + `reviewed = (status='approved')`; (c) `tutor_manual_activities` (v1.1).
- Каждый `work`: `{ id, kind: 'homework'|'mock'|'manual', title, date, score_kind, primary_score, primary_max, scaled?, grade?, reviewed, status, cells[]:{score,max} }`.
- `summary`: `{ done, total, reviewed_pct, needs_attention, current_level, target, trend[] }`.
- **Column whitelist:** НЕ селектить `solution_*`, `rubric_*`, `ai_score_comment`, hints в ответ. `cells` = только score/max (для heatmap).

### 3.3 Обзор «Успеваемость» — `GET /students/progress-overview`
`{ items[]: { student_id, name, avatar, track, grade_class, group_id, pct_to_goal, reviewed_pct, attention } }`.
- `pct_to_goal` = **нормализованный** `current_level / target_score` (cap 0–100), по треку — единственная кросс-ученическая сравнимая метрика (родную шкалу между учениками не сравнивать).
- `attention` = **разведено на два типа** (фикс из дизайн-ревью): `{ review_backlog: N, overdue: M }` (моя проверка) и `{ behind_goal: bool, declining: bool }` (риск ученика — далеко от цели / падающая динамика; ловит сценарий оттока `[L873]`). UI рендерит раздельно.
- Группы — через `tutor_group_memberships` (reuse паттерн `StudentsActivityBlock`, rule «Group-by-group»). Prefetch без N+1, агрегация в Deno, сортировка/группировка на сервере или клиенте по существующему паттерну.
- Масштаб: 100+ учеников (Эмилия) — пагинация/limit, без лагов.

### 3.4 Публичный отчёт — `public-student-report` (`GET /report/:slug`)
Mirror `public-homework-share` (rule 45). Без JWT, service_role, CORS `*`.
- Slug regex до DB-запроса → 400 `invalid_slug`.
- Expiry: `expires_at < now()` → `{expired:true}` 200 (не 404). Not-found → 404.
- **Anti-leak column whitelist (КРИТИЧНО):** возвращает только агрегат подтверждённого: `{ student_first_name, track, grade_class, tutor_name, period, current_level, target, forecast, trend[], topic_zones{green,yellow,red}, recent_works[]:{title, status, pct?}, tutor_comment? }`.
  - `pct` у работы — **только если `reviewed=true`**; иначе только `status` («на проверке»/«не сдано»), без числа.
  - **Никогда:** `solution_*`, `rubric_*`, hints, `ai_score_comment`, AI-вердикты, имена других учеников, telegram/email/booking тьютора.
  - `tutor_comment` — только если `include_tutor_comment=true`.
- Forecast — детерминированный линейный темп (наклон ряда `trend` × недель до экзамена), помечен «≈». AI-саммари = P2.
- Telemetry server-side, PII-free: `{event:'student_report_visited', slug, ts}` (без user_id/IP/UA).
- `escapeHtml` на весь user-input (tutor_comment, имена) если рендерится в HTML.

---

## 4 · Frontend (поверхности)

> React Query keys: `['tutor','students','overview', ...]`, `['tutor','students','progress', studentId]`, `['tutor','students','report-links', studentId]` (конвенция `['tutor', entity, ...]`, rule performance.md 2c). Все новые write-form `useQuery` → `refetchOnWindowFocus:false, staleTime:10*60*1000` (rule 40 QA — tab-switch регрессия).

### 4.0 Точки входа в «Успеваемость» (hub-and-spoke)
Три согласованные точки, не дублируют друг друга — у каждой своя задача:
- **Главная — триаж «что важно сейчас» (push):** блок «Требует проверки · N работ» (уже на дашборде) → клик в экран подтверждения (№3, R1); блок «Ученики отстают / требуют внимания» → клик на страницу ученика; CTA «Успеваемость» → обзор. Главная **НЕ дублирует полный ростер** — только actionable-подмножество на сегодня. Снимает боль «обойти 15 домашек» `[L1183]`: дашборд сам выталкивает непроверенное и отстающих.
- **Левая вкладка «Ученики» → подвкладка «Успеваемость» (pull):** полный ростер, фильтр/группы/сортировка. Для «покажи мне всех».
- **Per-student deep-link:** имя ученика где угодно (RecentDialogs, homework detail) → страница ученика.
Принцип: Главная = «что нужно мне сегодня», Успеваемость = «все ученики», страница ученика = «всё про одного». Тьютор не охотится за данными.

### 4.1 Вкладка «Ученики» → подвкладка «Успеваемость» (`StudentsProgressOverview`)
- Строка на ученика (на ≤768px → карточки-строки): `% к цели` (нормализ.) · `% проверено` · «требует внимания» (раздельно «моя проверка» vs «ученик отстаёт» — фикс ревью). Клик → страница ученика.
- Фильтр «есть непроверенное» + сегмент-сортировка (Внимание/Группы/%-к-цели/А→Я) + группировка по группам (reuse `StudentsActivityBlock` паттерн).
- **Два бара различать визуально** (`% к цели` акцентный, `% проверено` тише). Трек-чип нейтральный (не зелёный — коллизия с success/heatmap, rule 90).

### 4.2 Страница ученика `/tutor/students/:studentId`

> **⚠️ РЕАЛИЗАЦИЯ (2026-06-04, UX-fix по фидбэку Эмилии): «Прогресс» встроен ПЕРВОЙ вкладкой (default) прямо в КАРТОЧКУ ученика `TutorStudentProfile` (`/tutor/students/:id`)** рядом с Профиль/Заметки/Пробники/AI-диалоги — НЕ отдельная `StudentProgressPage`. Причина: репетитор кликал ученика → попадал в профиль-редактор → не находил задания. Контент вынесен в `StudentProgressPanel`; сверху панели — actionable «**Требует моей проверки сейчас**» (фикс приоритета). Старый `/tutor/students/:id/progress` → redirect на карточку. «Отчёт» — вкладка-плейсхолдер (R3/v1.1).

- Вкладки «Прогресс» (hero) + «Отчёт».
- **Прогресс:** шапка (фото/имя/группа/«Отчёт родителю») → карточка «Прогресс к цели» (родная шкала по треку + спарклайн в родной шкале + редактируемая цель, карандаш → `tutor_student_targets`) → метрики (Сдано/Проверено/Внимание) → bulk-бар «Подтвердить всё, что AI проверил (N)» → список работ-карточек (родной rollup + мини-карта задач, цвет=%, статус/«Подтвердить»).
- Клик по работе → drill-down: переиспользовать **`HeatmapGrid` / `StudentDrillDown` / `TaskMiniCard` / `heatmapStyles`** (Results v2), НЕ перерисовывать.

### 4.3 Подтверждение в работе (R1, паритет с пробником)
- `EditScoreDialog` (`src/components/tutor/results/EditScoreDialog.tsx`) — **расширить**: чекбокс «Подтвердить задачу» (default ON при `status='active'`), кнопка «Сохранить и подтвердить» / «Сохранить балл» (mirror force-complete CTA-контракт, rule «Tutor force-complete»). Инпут ≥16px (Safari).
- Per-task «Подтвердить» + bulk «Подтвердить всё, что AI проверил (N)» с AlertDialog («AI-баллы остаются как есть»). reopen «Открыть обратно».
- **Anti-leak плашка** обязательна: «Ученик видит только итоговый балл и "проверено". AI-рубрика, подсказки и решение не раскрываются.»
- Без AI-вердикта (фото не распознано / не-физика) → «Поставить балл и подтвердить» (manual), паритет с force-complete.

### 4.4 Отчёт родителю (R3, v1.1) — builder + публичная `/p/:slug`
- Builder (вкладка «Отчёт»): период (Неделя/4 недели/Произвольный, default 4 недели — Вадим) → предпросмотр (трек-aware, только подтверждённое) → редактируемый «Комментарий репетитора» → выходы (primary → secondary): **`Открыть отчёт`** (большая чистая страница `/p/:slug` под скриншот в Telegram/VK) · `Скопировать ссылку` · `Скопировать текст` · `Скачать PDF/картинку` (вторично, v1.1). Server-side рендер картинки в v1 не нужен — см. Resolved Q4.
- Публичная страница `src/pages/StudentReportPublic.tsx` на route `/p/:slug` **вне AppFrame** (sibling `PublicHomeworkShare`). Построена на лендинг-концепте отчёта (карта тем · динамика · прогноз · последние работы). `MathText` lazy, `<img loading="lazy">`, clipboard primary+fallback (не удалять).
- **Mobile-critical** (родитель в Telegram/VK WebView): рендер без логина/тяжёлого JS; PDF-кнопка деградирует gracefully (WebView часто блокирует download → «Скопировать текст» + «открыть в браузере» рядом); above-the-fold = результат; карта тем 3→стек; график без горизонтального скролла; состояние «ссылка истекла».

---

## 5 · Anti-leak инварианты (КРИТИЧНО — проверять на ревью)

1. **Ученику** (через `homework_tutor_task_states` / thread): видны `tutor_reviewed_at` (бейдж), `tutor_score_override`, финальный балл. НЕ видны: `tutor_reviewed_by`, `ai_score_comment`, `solution_*`, `rubric_*`, hints. `stripStudentSensitiveTaskStateFields` обновить (+`tutor_reviewed_by`).
2. **Родителю** (`/p/:slug`): только агрегат подтверждённого. `pct` работы — только при `reviewed=true`. Никаких решений/рубрик/подсказок/AI-вердиктов/чужих учеников/контактов тьютора. Column-whitelisted SELECT, никогда `SELECT *`.
3. **Column GRANT** на `homework_tutor_task_states`: `tutor_reviewed_at` → grant authenticated; `tutor_reviewed_by` → service_role only (новая миграция расширяет whitelist, rule 40).
4. **Manual activities / tutor notes** — tutor-only; в отчёт попадают только через явный `include_tutor_comment`.
5. Любой новый student-facing/parent-facing SELECT → явное решение по каждому полю (default tutor-only).

---

## 6 · Cross-browser / Safari инварианты (rule 80)

- Heatmap/drill-down таблицы — `border-separate border-spacing-0` + `<colgroup>` фикс-ширины (НЕ `border-collapse`, НЕ `w-full`+`min-w` на `<td>`). Переиспользуем `HeatmapGrid` — он уже соблюдает.
- Все инпуты (EditScoreDialog, цель, комментарий, период) `font-size ≥16px`.
- `touch-action: manipulation` на кликабельных карточках/кнопках; `touch-pan-x` на горизонтальных скроллах с onClick-строками.
- `100dvh` (fallback `100vh` для Safari 15.0–15.3) на full-bleed экранах; bottom-sheet модалки (mobile) — `position: sticky`, не `fixed`.
- Никаких `RegExp` lookbehind в client-коде; `crypto.randomUUID` только server-side (slug). Даты — `parseISO`/`date-fns`.
- Спарклайн/график отчёта — без горизонтального скролла на 390px.

---

## 7 · Телеметрия (PII-free, `console.warn(JSON.stringify(...))`)

`task_reviewed` (`{assignmentId, studentId, taskId, source:'single'|'bulk'|'dialog', hadOverride}`) · `task_review_reopened` · `student_progress_opened` (`{studentId, track}`) · `progress_overview_opened` · `student_report_created` (`{studentId, periodKind, hasComment}`, без slug/url) · `student_report_visited` (server-side, без PII). Никаких имён/баллов/текста.

---

## 8 · Acceptance Criteria (Given/When/Then)

**R1 — галочка «проверено»**
- Given задача сдана и `tutor_reviewed_at IS NULL`, When репетитор жмёт «Подтвердить», Then `tutor_reviewed_at=now()`, балл залочен, задача исчезает из «требует моей проверки», ученик видит «Проверено».
- Given AI поставил CORRECT на N задач, When «Подтвердить всё, что AI проверил (N)», Then все N помечены reviewed, **баллы не изменены**.
- Given задача уже reviewed, When второй параллельный запрос подтверждения, Then `409 ALREADY_REVIEWED` (race-guard), без двойной записи.
- Given не-физика без AI-вердикта, When «Поставить балл и подтвердить», Then `tutor_score_override`+`tutor_reviewed_at` ставятся вместе.
- Given reviewed, When «Открыть обратно», Then `tutor_reviewed_at=NULL`, задача снова в очереди.
- Given подтверждение, Then ученик/родитель НЕ получают рубрику/решение/подсказки/AI-коммент.

**R2 — успеваемость + страница ученика**
- Given у ученика 5 ДЗ + 1 пробник, When открываю страницу, Then вижу rollup каждой работы в родной единице + цвет ячеек=%, и сводку (сделано/проверено/внимание/прогресс-к-цели), без захода в каждую работу.
- Given смешанные треки у разных учеников, When открываю «Успеваемость», Then колонки только scale-agnostic (% к цели/% проверено/внимание), сырого балла в общем списке нет.
- Given ученик далеко от цели но всё проверено, Then он помечен «отстаёт» (не только «на проверке») — два типа внимания разведены.
- Given 100+ учеников, Then список не лагает.

**R3 — отчёт родителю (v1.1)**
- Given открыта вкладка «Отчёт», период «4 недели», When «Создать ссылку», Then `/p/:slug` открывается без логина, показывает агрегат подтверждённого за период, трек-aware шкалу, прогноз «≈».
- Given работа «на проверке»/«не сдано», Then в отчёте — только статус, без числа.
- Given `expires_at` в прошлом, Then страница «срок истёк» (не 404).
- Given родитель в Telegram WebView, When жмёт PDF и download заблокирован, Then доступны «Скопировать текст» + «открыть в браузере».
- Given отчёт, Then ни решений/рубрик/подсказок/AI-вердиктов/чужих учеников/контактов тьютора.

---

## 9 · Фазинг и оценка

- **v1.0 (~2.5–3 нед):** R1 (галочка-паритет, RPC + EditScoreDialog + bulk + reopen) + R2 (успеваемость overview + страница ученика, агрегат ДЗ+пробники) + `tutor_student_targets` + цель/прогресс. Десктоп + батч mobile/состояния. → пилот на Елене.
- **v1.1 (~1.5–2 нед):** R3 (отчёт `/p/:slug` + `student_report_share_links` + `public-student-report` + PDF/картинка/текст) + R4 (`tutor_manual_activities` + заметки/кастомные поля Вадима + школьный трек ручного ввода).
- **P2 (future):** AI-саммари отчёта; авто-дайджест по cron к оплате; multi-subject targets; нормализ.% в кросс-обзоре с трендом; точные ОГЭ-таблицы per-subject (`04-score-scales` §4).

---

## 10 · QA-чеклист перед merge (зона риска — task_states + конструктор)

- [ ] Dual write-path: грепнуть все write-sites `homework_tutor_task_states` — `tutor_reviewed_*` пишутся консистентно; `stripStudentSensitiveTaskStateFields` содержит `tutor_reviewed_by`; column-GRANT whitelist расширен миграцией.
- [ ] `computeFinalScore` НЕ продублирован — агрегат и отчёт читают одну функцию.
- [ ] `THREAD_SELECT` / student-facing SELECT не тянут `solution_*`/`rubric_*`/`ai_score_comment`/`tutor_reviewed_by`.
- [ ] `public-student-report` — column-whitelist, slug-regex до DB, expiry≠404, PII-free telemetry, escapeHtml.
- [ ] Новые edge functions в `supabase/config.toml` + deploy workflow + `supabase-drift-check.mjs` (rule 96 #11).
- [ ] Новые `useQuery` в write-form: `refetchOnWindowFocus:false` (rule 40 tab-switch регрессия).
- [ ] Safari: border-separate таблицы, инпуты ≥16px, touch-action, 100dvh, без lookbehind.
- [ ] RPC: `REVOKE FROM PUBLIC` + `GRANT service_role`, race-guard 409 на reviewed/review-all.
- [ ] Ошибки edge — русские `{error,code}`, клиент через `extractEdgeFunctionError` (rule 97).

---

## 11 · Resolved decisions (зафиксировано 2026-06-02, Владимир)

- **Q1 — уровень «проверено»:** per-task `tutor_reviewed_at` = **атомарная истина** (нужна для частичной проверки — AI подтвердил 6/8, 2 вручную — и для per-task правки балла). Бейдж/CTA на **уровне РАБОТЫ** = primary UX: «ДЗ проверено целиком» = derived `reviewed_count == total`; пока не все → «На проверке · N». Bulk «Подтвердить всё, что AI проверил» даёт «подтвердить ДЗ в один клик» без потери гранулярности. **НЕ схлопывать** в один work-флаг.
- **Q2 — `current_level` для «% к цели»:** scaled-балл **последнего подтверждённого пробника** трека (ege/oge → approved `mock_exam` → scaled через `04-score-scales`; school → последняя подтверждённая `school_grade` активность). Нет подтверждённого пробника → `current_level=null` → «% к цели» = «—» + «нужен пробник». **НЕ выводить из ДЗ** (ДЗ ≠ экзаменационный срез). Тренд/прогноз — по ряду подтверждённых пробников.
- **Q3 — ОГЭ-таблицы:** v1 = **только физика-ЕГЭ** (пилот Елена/Вадим). ОГЭ/школа-треки в UI присутствуют (переключатель), но конверсия ОГЭ-пробника отложена; до загрузки таблиц ОГЭ-пробник показывает первичные без grade-прогноза. Не блокер.
- **Q4 — отчёт = большая read-only страница под скриншот:** отдельная чистая страница (`/p/:slug`) без app-chrome, комфортная фикс-ширина (~760–820px, центр), выглядит чисто на скриншоте. Репетитор открывает вкладку → скриншотит → Telegram/VK; родитель открывает ту же ссылку. Скачивание картинки/PDF — вторично (v1.1, client html-to-image / print-CSS). **Server-side рендер картинки в v1 НЕ нужен.**
- **Q5 — ученик-зеркало прогресса: ВЫРЕЗАНО из scope → P2.** Прямого запроса в кастдеве нет (гипотеза мотивации, не голос клиента — `01-custdev-extract §4.2`). Ученик уже видит задачные результаты в guided-флоу. Сначала валидировать потребность (Елена/Вадим), затем — при подтверждении — P2.

### Оставшиеся к фиксации по ходу (не блокеры)
- Точная ОГЭ-таблица первичный→оценка per-subject (`04-score-scales §4`) — до ОГЭ-релиза.
- PDF/картинка как download (v1.1): client html-to-image vs print-CSS — решить при реализации экспорта.

---

## 🚀 Deploy needed (когда дойдёт до реализации)

Эта спека — только документ (deploy не нужен). **При реализации** фича затронет frontend (`src/...`) → после мерджа нужен ручной деплой на VPS (`deploy-sokratai`, rule 95). Backend (миграции + edge functions) Lovable Cloud применит автоматически после push; frontend (`sokratai.ru`) — только через `deploy-sokratai`.
