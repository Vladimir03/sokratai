# Feature Spec: «Занятия» — материалы в расписании (schedule-materials)

**Версия:** v1.0
**Дата:** 2026-06-02
**Автор:** Vladimir Kamchatkin × Claude (Cowork)
**Статус:** in-review
**Канон:** PRD `02-prd-ajtbd.md` (v1.2) · конкурентный разбор `03-competitive-ux.md` · pipeline шаг 4. Нотация: Job-коды графа = `R#/S#/P#`; метки требований = `R-N` (Requirement-N).

---

## 0. Job Context (обязательная секция)

### Какую работу закрывает фича

| Участник | Core Job | Sub-job | Граф |
|---|---|---|---|
| Репетитор (B2B) | **R4** — контроль качества при масштабировании (перевёрнутый класс) | R4-2 доставка через единый канал; R4-3 база материалов | job-graph#R4 |
| Школьник (B2C) | **S3** — удобство «всё в одном» | S3-1 получить в привычном месте; S3-2 не переключаться | job-graph#S3 |
| Родитель (B2C) | **P3** — ROI / «солидность пакета» | P3-1 между уроками есть система | job-graph#P3 |

**Кандидат в новый Core Job (LEARN, шаг 8):** **R5 — LMS: хранение и доставка материалов урока** (R5-1 хранить записи/конспекты; R5-2 доставлять в одном месте; R5-3 *[LATER]* мини-комьюнити группы). Фиксируется как обновление графа, не натягивается на R4.

### Wedge-связка
- **B2B:** репетиторы физики ЕГЭ/ОГЭ (primary buyer). Killer-job Вадима — **хранение и доставка**, не проверка `[L1603]`.
- **B2C:** ученики 16-18 (mobile-first) + родители (ROI).
- **Score матрицы:** RICE #8 (Impact 3, личный P0 Вадима, **блок-фактор миграции реального ученика** `[L2214-2216]`). Точный score матрицы — TBD (свериться с `SokratAI_AJTBD_b2b2c-cross-segmentation-matrix.md`).

### Pilot impact
Снимает прямой блок-фактор миграции: «есть ученик для переноса, но пока некуда» `[L2214-2216]`. Делает Сократ единой платформой для ученика (вместо Drive+Telegram), что напрямую усиливает удержание пилота и аргумент «солидность пакета» для родителя.

---

## 1. Summary

Репетитор прикрепляет к занятию в расписании три типа материалов — **ссылку на запись** (любой URL: Drive/Яндекс.Диск/VK Video/YouTube), **PDF-конспект** и **связь с существующим ДЗ**. Ученик получает новую вкладку **«Занятия»** (стартовый экран) — компактную ленту своих занятий в стиле существующей «Домашки» (группы по датам, чипы материалов, статус ДЗ), откуда **в один клик** проваливается в запись, конспект или гайд-чат домашки. Старая вкладка «Домашка» остаётся как есть; «Занятия» и «Домашка» кросс-линкуются, ДЗ — единый источник правды.

---

## 2. Problem

### Текущее поведение
Записи уроков лежат на Google Drive, материалы репетитор шлёт ученикам через Telegram — «так себе», без структуры `[L1541]`. Ученик **не видит своего расписания** в Сократе — этой поверхности нет вообще (подтверждено: нет student-route расписания; `StudentHomework.tsx` — плоская сетка ДЗ).

### Боль
- **Репетитор (R4):** нет единого места для доставки записи+конспекта+ДЗ → дублирует в Telegram, теряет структуру, не может масштабировать перевёрнутый класс.
- **Ученик (S3):** переключается между Telegram, Drive и Сократом; «где запись прошлого урока?».
- **Родитель (P3):** не видит «системы между уроками» → слабее аргумент абонемента `[L1563]`.

### Текущие «нанятые» решения
Google Drive (хранение) + Telegram (доставка) + почта. Конкурентный разбор (`03-competitive-ux.md`): **никто на рынке РФ не делает связку {запись+конспект+ДЗ на занятии в student-ленте}** end-to-end; ближайший — Repetitor.tech.

---

## 3. Solution

### Описание
Новая сущность `tutor_lesson_materials`, привязанная к `tutor_lessons` (мягко — к занятию или к `group_session_id`). Репетитор управляет материалами через **drawer «Материалы занятия»**, открываемый из существующего `LessonDetailsDialog` (НЕ из формы создания урока). Ученик читает материалы через новую вкладку **«Занятия»** (лента + деталка занятия), данные отдаёт service_role edge-эндпоинт с column-whitelist.

### Ключевые решения (с обоснованием)
1. **Запись = generic URL**, не Drive-специфично — РФ-риск блокировки Drive/Telegram (`03-competitive-ux.md` §3). Просто ссылка-кнопка, без OAuth/embed.
2. **Крепление из `LessonDetailsDialog`, отдельным компонентом-drawer** — не трогаем хрупкую create-форму урока (`TutorSchedule.tsx` 4100 строк, rule 10). Минимальная поверхность в high-risk файле: кнопка + state, вся логика в новом `LessonMaterialsDrawer.tsx`.
3. **ДЗ = ссылка на существующее `homework_tutor_assignments`** (`material_kind='homework_ref'`) — полное переиспользование guided-homework, единый источник правды с прогрессом, без дублей.
4. **Видимость на уровне занятия/сессии** — материалы видны всем ученикам, привязанным к занятию (или к `group_session_id`). Нет per-student матрицы. `tutor_lessons.notes` НЕ светить.
5. **«Занятия» — отдельная вкладка, НЕ сегмент-контрол** — «Домашка» reuse 1:1, кросс-линк. IA подтверждена 2026-06-02.
6. **Один клик занятие→ДЗ** — чип ДЗ ведёт прямо на guided-homework entry route (авто-резолв задачи), без промежуточных экранов.
7. **Student-чтение через service_role edge** (не голый PostgREST с RLS) — паттерн rule 40 (draft-tolerant, column-whitelist, anti-leak).

### Scope

**In scope (Phase 1, v1):**
- Tutor: drawer «Материалы занятия» — добавить запись (URL), загрузить PDF, выбрать существующее ДЗ; список + удаление.
- Student: вкладка «Занятия» (лента, группы по датам, чипы материалов + статус ДЗ) + деталка занятия + one-click переход в ДЗ.
- Уведомление-дайджест ученику при сохранении материалов.
- Нудж «Добавить запись?» после «Отметить проведённым».

**Out of scope (v1):**
- Google Drive API/OAuth, embed-превью, синк (только URL).
- Видеохостинг (только ссылка).
- Per-student индивидуальный доступ внутри группы.
- Сохранение прогресса ДЗ при паузе (Cloud.Text-баг `[L1660]`).
- Billing/абонементы.

**LATER:** мини-комьюнити группы (R5-3); cross-group видимость/join `[L1686]`; общий каталог записей; reorder; Drive-превью.

---

## 4. User Stories

### Репетитор
> Когда я провёл урок и залил запись на Drive, я хочу за ~15 секунд прикрепить к этому занятию ссылку на запись, PDF-конспект и домашку, чтобы ученик нашёл всё в одном месте, а не в переписке Telegram.

### Школьник
> Когда мне нужно повторить тему или сделать домашку, я хочу открыть «Занятия», увидеть последний урок с записью и конспектом и в один клик перейти к домашке, чтобы не искать по Telegram и Drive.

### Родитель
> Когда я плачу за абонемент, я хочу видеть, что между уроками есть система (записи, конспекты, домашки в одном месте), чтобы понимать ценность.

---

## 5. Technical Design

### 5.1 Затрагиваемые файлы

**DB / backend:**
- `supabase/migrations/{ts}_tutor_lesson_materials.sql` — новая таблица + индексы + RLS + GRANT-whitelist.
- `supabase/migrations/{ts}_lesson_materials_bucket.sql` — Storage bucket `lesson-materials` + policies.
- `supabase/functions/lesson-materials-api/index.ts` — **новый** edge (verify_jwt=true): tutor CRUD материалов + notify cascade. Регистрация в `supabase/config.toml` + deploy workflow (rule 96 #11).
- `supabase/functions/student-lessons-api/index.ts` — **новый** edge (service_role): student чтение ленты + деталки (column-whitelist, signed PDF URL). Альтернатива — добавить роуты в существующий student API; решить на этапе TASKS.
- `supabase/functions/_shared/transactional-email-templates/lesson-materials-notification.ts` — **новый** email-шаблон (mirror `homework-notification.ts`).
- Reuse: `supabase/functions/_shared/attachment-refs.ts`, `_shared/push-sender.ts`, `_shared/email-sender.ts`, паттерн каскада из `homework-api::handleNotifyStudents` / `homework-reminder`.

**Frontend (student):**
- `src/pages/StudentSchedule.tsx` — **новая** вкладка «Занятия» (lazy), с `<Navigation/>` chrome.
- `src/pages/student/LessonDetail.tsx` (route `/student/schedule/:lessonId`) — деталка занятия (mobile-first, может быть `AuthGuard fullBleed="below-xl"`).
- `src/components/student/schedule/LessonFeedItem.tsx`, `LessonGroupHeader.tsx`, `MaterialChips.tsx` — `React.memo`, reuse `Badge`, `MathText`, статус-хелперы «Домашки».
- `src/components/Navigation.tsx` — добавить `{ path: "/student/schedule", icon: Calendar, label: "Занятия" }` (leftmost); пост-логин лендинг → `/student/schedule`.
- `src/App.tsx` — роуты `/student/schedule`, `/student/schedule/:lessonId` (lazy + Suspense).
- `src/lib/studentScheduleApi.ts` — **новый** API-клиент (через `requestStudentHomeworkApi`-паттерн с 401-refresh, rule «Phase 3.1»).

**Frontend (tutor):**
- `src/components/tutor/schedule/LessonMaterialsDrawer.tsx` — **новый** drawer (Radix Dialog/Sheet): запись/PDF/ДЗ.
- `src/pages/tutor/TutorSchedule.tsx` — **минимальная** правка: кнопка «Материалы» в `LessonDetailsDialog` (~line 4054) + state открытия drawer; нудж в `handleCompleteLesson` (~line 3608) toast→drawer. Логику завершения/создания НЕ трогаем (rule 10).
- `src/lib/lessonMaterialsApi.ts` — **новый** tutor API-клиент (через `extractEdgeFunctionError`, rule 97).

### 5.2 Data Model

```sql
CREATE TABLE public.tutor_lesson_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id uuid NOT NULL REFERENCES public.tutors(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES public.tutor_lessons(id) ON DELETE CASCADE,
  group_session_id uuid NULL,                       -- групповое занятие: видно всем участникам сессии
  material_kind text NOT NULL CHECK (material_kind IN ('recording','pdf','homework_ref')),
  url text NULL,                                    -- recording: generic URL; pdf: dual-format storage:// ref
  homework_assignment_id uuid NULL REFERENCES public.homework_tutor_assignments(id) ON DELETE SET NULL,
  title text NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  CONSTRAINT chk_kind_payload CHECK (
    (material_kind = 'recording' AND url IS NOT NULL) OR
    (material_kind = 'pdf'       AND url IS NOT NULL) OR
    (material_kind = 'homework_ref' AND homework_assignment_id IS NOT NULL)
  )
);
CREATE INDEX idx_tlm_lesson  ON public.tutor_lesson_materials(lesson_id);
CREATE INDEX idx_tlm_session ON public.tutor_lesson_materials(group_session_id) WHERE group_session_id IS NOT NULL;
CREATE INDEX idx_tlm_tutor   ON public.tutor_lesson_materials(tutor_id);
```

**RLS (defense-in-depth; основной read-path — service_role edge):**
- Tutor SELECT: `tutor_id IN (SELECT id FROM public.tutors WHERE user_id = auth.uid())`.
- Tutor write — **только через edge (service_role)**; клиентских write-policy нет (без обоснования).
- Student SELECT: материал виден, если ученик привязан к его занятию — `lesson_id IN (SELECT id FROM public.tutor_lessons WHERE student_id = auth.uid())` **OR** `group_session_id IN (SELECT group_session_id FROM public.tutor_lessons WHERE student_id = auth.uid() AND group_session_id IS NOT NULL)`.

**GRANT-whitelist:** после REVOKE — GRANT SELECT только safe-колонок authenticated; `created_by` / `tutor_id` — не критичны, но `created_by` не нужен ученику. Финальный whitelist — в миграции (mirror rule 40 GRANT-паттерн).

**Storage bucket `lesson-materials`:** путь `tutor/{auth.uid()}/{lessonId}/{uuid}.pdf`. Policy: tutor upload/read/delete own folder; student — НЕ прямой read, PDF отдаётся **signed URL** из `student-lessons-api` (TTL ~3600s, mirror `public-homework-share`). Recording — generic URL, не подписывается. Storage-protection trigger (rule 50) — рассмотреть при cleanup-флоу.

**Лимиты (resolved):** PDF ≤ **20 МБ** (`MAX_LESSON_PDF_BYTES`); на занятие — **recording ≤ 3**, **pdf ≤ 5**, **homework_ref = 1** (1:1). Валидируются и на клиенте (drawer), и в edge (`lesson-materials-api` POST).

**Удаление (resolved, rule 50 order ref → blob):** `lesson-materials-api` DELETE: ownership → DELETE row `tutor_lesson_materials` → `storage.remove()` (только `kind='pdf'`; recording = URL, нечего удалять; homework_ref = ДЗ НЕ трогаем). Orphan-blob при удалении самого занятия — известный долг v1.

### 5.3 API

**Tutor (`lesson-materials-api`, verify_jwt=true, ownership через `resolveTutorPkId` → `tutors.id`):**
- `GET /lessons/:lessonId/materials` — список материалов занятия.
- `POST /lessons/:lessonId/materials` — body `{ kind, url?, homework_assignment_id?, title? }`. Валидация по `material_kind`; PDF-upload отдельным storage-путём, в body — `storage://` ref.
- `DELETE /materials/:id`.
- `POST /lessons/:lessonId/materials/notify` — дайджест-уведомление (push→telegram→email), один на вызов.
- **Ownership homework_ref (FK-дрейф!):** `tutor_lessons.tutor_id → tutors.id`, а `homework_tutor_assignments.tutor_id → auth.users.id`. Проверка: assignment принадлежит тому же тьютору — `assignment.tutor_id = (SELECT user_id FROM tutors WHERE id = lesson.tutor_id)` **и** assignment назначено ученику этого занятия (anti cross-student leak).
- Ошибки — flat `{ error: <рус>, code }` (rule 97).

**Student (`student-lessons-api`, service_role, ownership по `tutor_lessons.student_id = jwt.uid` / group membership):**
- `GET /student/lessons` — лента: занятия ученика + их материалы (recording URL, pdf → signed URL, homework_ref → `{assignment_id, title, status}`), **column-whitelist** (никогда `notes`, `tutor_id`-внутренности).
- `GET /student/lessons/:id` — деталка.
- 401 → refresh+retry (rule Phase 3.1). 404 (не 403) для не-привязанных.

### 5.4 Миграции
1. `{ts}_tutor_lesson_materials.sql` — таблица + индексы + RLS + GRANT.
2. `{ts}_lesson_materials_bucket.sql` — bucket + policies.

---

## 6. UX / UI

**Wireframe:** интерактивные макеты в чате Cowork (2026-06-02): drawer «Материалы занятия» + лента «Занятия» в стиле «Домашки» (две версии). Финальный `design-handoff/` бандл — опционально на деталку занятия (см. Parking Lot).

**UX-принципы (doc 16) + design-system (rule 90):**
- **Reuse, не перерисовка** — лента «Занятия» наследует грамматику строк/групп/чипов «Домашки» (компактный список, как Asana/Linear). Текущая `StudentHomework.tsx` — плоская сетка; группированный компактный список = дизайн-референс из мокапа.
- **Один primary CTA** на экран; в drawer — «Готово».
- **Якорь «сегодня»** + секции Сегодня / На этой неделе / Прошедшие (killer-job — найти запись последнего урока).
- **Чипы материалов** (Запись/Конспект) + статус ДЗ (Назначено→Сдано→Проверено) — Lucide-иконки, без эмодзи (rule 90).
- **Пустые состояния:** занятие без материалов показывается приглушённо («материалов пока нет») — расписание = ось; «Занятия» пусто → подсказка «появятся, когда репетитор добавит».
- **Один клик** занятие→ДЗ (P0).

**UI-паттерны (doc 17) + Safari (rule 80):** `font-size:16px` на inputs/select; `touch-action: manipulation`; 100dvh / `--vv-h`; list-item в `React.memo`; lazy + Suspense на новых страницах; нет `framer-motion` (performance.md); токены `bg-accent`/socrat green, не hardcode hex.

**Cross-browser:** drawer на Radix (focus-trap/scroll-lock); карточки `animate={false}` в гридах; sticky/таблиц нет (лента — flex-колонки).

---

## 7. Validation

### Acceptance Criteria (Given/When/Then)

**P0 (must, ship-1):**
- **AC-1 (R-1 DB):** Given миграция применена — When `\d tutor_lesson_materials` — Then таблица есть с CHECK `chk_kind_payload`, FK на `tutor_lessons`/`homework_tutor_assignments`, индексами; `smoke-check` зелёный.
- **AC-2 (R-2 attach):** Given репетитор открыл занятие в «Расписании» → «Материалы» — When вставил URL записи и нажал «Добавить» — Then в `tutor_lesson_materials` строка `kind='recording'`, drawer показывает её; create-форма урока не затронута.
- **AC-3 (R-2 PDF):** Given drawer — When загрузил PDF — Then файл в bucket `lesson-materials` по пути `tutor/{uid}/{lessonId}/...`, строка `kind='pdf'` с `storage://` ref.
- **AC-4 (R-2 select ДЗ):** Given drawer — When выбрал существующее ДЗ — Then строка `kind='homework_ref'` с `homework_assignment_id`; запрещено выбрать ДЗ чужого тьютора/не этого ученика (403 `INVALID_HOMEWORK_REF`).
- **AC-5 (R-3 feed):** Given ученик с занятиями — When открывает «Занятия» — Then видит ленту, сгруппированную Сегодня/На этой неделе/Прошедшие, у занятий с материалами — чипы Запись/Конспект и статус ДЗ; занятие без материалов — «материалов пока нет».
- **AC-6 (R-4 one-click):** Given карточка занятия с чипом ДЗ — When ученик кликает чип ДЗ — Then **за один переход** открывается guided-homework problem screen этого ДЗ (без промежуточной страницы).
- **AC-7 (anti-leak):** Given `tutor_lessons.notes` заполнено — When ученик грузит `/student/lessons` — Then в ответе **нет** `notes` и tutor-only полей (проверка ответа edge-функции).

**P1 (fast-follow, 1-2 дня, всё ещё v1):**
- **AC-8 (R-6 create ДЗ):** Given drawer → «Создать ДЗ» — When сохранил в конструкторе — Then ДЗ создано prefilled (предмет+получатели занятия) и авто-привязано к занятию (`kind='homework_ref'`).
- **AC-9 (R-7 notify):** Given добавил 3 материала и нажал «Готово» — When срабатывает notify — Then ученику уходит **одно** уведомление (push→telegram→email) с deep-link на занятие, не три.
- **AC-10 (R-8 nudge):** Given «Отметить проведённым» — When урок закрыт — Then non-blocking подсказка «Добавить запись?» → открывает тот же drawer; логика завершения не изменена.

### Связь с pilot KPI
Leading (3-7 дней): % прошедших занятий с ≥1 материалом; время крепления; % учеников, открывших «Занятия». Lagging (2-4 недели): миграция реального ученика Вадима; падение отправок через Telegram (doc 18).

### Smoke check
```bash
npm run lint && npm run build && npm run smoke-check
```

---

## 8. Cross-cutting invariants (не requirements — обязательны во всех задачах)

- **Anti-leak:** `tutor_lessons.notes` и tutor-only поля НИКОГДА не отдаются ученику; student edge — column-whitelist, не `SELECT *`. (Mirror rule 40.)
- **FK-дрейф ownership:** `tutor_lessons.tutor_id → tutors.id`; `homework_tutor_assignments.tutor_id → auth.users.id` → ownership через `resolveTutorPkId` + 3-part join (rule 40 R2).
- **Safari/iOS (rule 80):** 16px inputs, `touch-action: manipulation`, 100dvh, без `Array.at`/lookbehind/`structuredClone`.
- **Edge error contract (rule 97):** flat `{error, code}`, русские фразы, client через `extractEdgeFunctionError`.
- **Уведомления (rule 70):** reuse каскад push→telegram→email; Telegram не единственный канал (web-push/email fallback, РФ-throttling).
- **High-risk (rule 10):** `TutorSchedule.tsx` — только добавление точки входа (кнопка+state), вся логика — в новом компоненте.
- **Deploy (rule 95):** фронтовые правки → блок «🚀 Deploy needed» (`deploy-sokratai`).

---

## 9. Risks & Open Questions

| Риск | Вероятность | Митигация |
|---|---|---|
| Регрессия расписания (правка `TutorSchedule.tsx` 4100 строк) | Средняя | Новый `LessonMaterialsDrawer.tsx`; в high-risk файле только кнопка+state; plan mode; smoke + ручная QA расписания |
| Утечка `notes`/tutor-only ученику | Средняя | service_role edge + column-whitelist + AC-7; RLS как defense-in-depth |
| Блокировка Google Drive в РФ | Средняя | Запись = generic URL (Drive/Яндекс.Диск/VK/YouTube), без зависимости от Drive |
| FK-дрейф → неверная ownership homework_ref | Средняя | 3-part join + тест cross-tutor/cross-student (AC-4) |
| Смена пост-логин лендинга на «Занятия» влияет на всех учеников | Низкая | Пилот-скоуп; легко откатить (Navigation/redirect) |
| Telegram throttling → недоставка | Средняя | Каскад с web-push/email fallback (rule 70) |

### Открытые вопросы — RESOLVED (2026-06-02)
1. ✅ **Новый `student-lessons-api`** (service_role), не роуты в homework-api — разделение доменов + чистый column-whitelist; статус ДЗ для чипа берём из shared `_shared/score-compute.ts` (без дублей); клиент reuse транспорт `requestStudentHomeworkApi` (401-refresh).
2. ✅ **Лимиты:** PDF ≤ **20 МБ**; на занятие — **запись ≤ 3**, **PDF ≤ 5**, **ДЗ = 1** (1:1, см. §3). Суммарного лимита нет — потолок на тип.
3. ✅ **Деталка — отдельный route `/student/schedule/:lessonId`** (deep-link из уведомления приземляется на route; back-nav; консистентно с `/student/homework/...`). Чипы на строке ленты при этом кликабельны напрямую.
4. ✅ **Удаление PDF чистит blob, порядок ref → blob** (rule 50): DELETE row → `storage.remove()` (только `kind='pdf'`). Orphan при удалении самого занятия (FK cascade не трогает Storage) — известный долг v1; защитный storage-триггер → Parking Lot / P1-hardening.

---

## 10. Implementation Tasks (краткий план → `tasks.md`)

- [ ] TASK-1 (P0): миграция `tutor_lesson_materials` + bucket + RLS + GRANT.
- [ ] TASK-2 (P0): `lesson-materials-api` (tutor CRUD + ownership FK-дрейф) + config/deploy.
- [ ] TASK-3 (P0): `LessonMaterialsDrawer.tsx` + точка входа в `LessonDetailsDialog` (минимальная правка).
- [ ] TASK-4 (P0): `student-lessons-api` (service_role, whitelist, signed PDF).
- [ ] TASK-5 (P0): вкладка «Занятия» (`StudentSchedule.tsx` + feed-компоненты) + Navigation + роуты + лендинг.
- [ ] TASK-6 (P0): деталка занятия + **one-click** deep-link в ДЗ.
- [ ] TASK-7 (P1): notify-дайджест + email-шаблон.
- [ ] TASK-8 (P1): «Создать ДЗ» из drawer (конструктор prefilled + авто-привязка).
- [ ] TASK-9 (P1): нудж после «Отметить проведённым».
- [ ] TASK-10: верификация (Codex чистой сессией) + ручная QA (Safari, anti-leak, one-click).

---

## 11. Phasing

- **Phase 1 (эта SPEC):** P0 (TASK-1..6) — крепление + лента + деталка + one-click. P1 (TASK-7..9) — notify, create-ДЗ-inline, нудж — **fast-follow в течение 1-2 дней, всё ещё v1** (приоритет Вадима, не вырезаются).
- **Phase 2 (LATER, отдельная SPEC, старт после feedback Вадима):** habit weekly-streak + нудж непросмотренной записи; tutor-вкладка «Занятия/Материалы» на `/tutor/students/:id`; reorder; Drive-превью.
- **Phase 3 (LATER):** мини-комьюнити группы (R5-3); cross-group видимость/join `[L1686]`; общий каталог записей.

---

## Parking Lot
- **Бэк-порт компактного группированного списка в «Домашку»** — контекст: «Занятия» строят его первыми; revisit: если ученики оценят плотный список — заменить плоскую сетку `StudentHomework.tsx`.
- **Tutor-вкладка «Занятия/Материалы» на `/tutor/students/:id`** — контекст: Q4-решение Владимира reuse surfaces; revisit: Phase 2 (после shell от `student-progress`).
- **«Создать ДЗ» → полный встроенный конструктор в drawer** — контекст: сейчас навигация в конструктор + return; revisit: если переход ощущается тяжёлым.
- **Голосовой/текстовый коммент репетитора к занятию** — контекст: всплыло как «о занятии»; revisit: после R5 LMS.
- **Drive/VK embed-превью записи** — контекст: сейчас generic-ссылка в новой вкладке; revisit: если ученики просят inline-плеер и РФ-доступ стабилен.
- **Мини-комьюнити группы (R5-3)** — контекст: материалы видны всем участникам = фундамент; revisit: отдельная большая фича.

---

## Checklist перед approve
- [x] Job Context заполнен (секция 0) + R5-кандидат
- [x] Привязка к Core Job (R4/S3/P3)
- [x] Scope чётко (in/out/later)
- [x] UX-принципы (doc 16) + design-system (rule 90) учтены
- [x] UI-паттерны (doc 17) + Safari (rule 80) учтены
- [x] Pilot impact описан
- [x] Метрики (leading/lagging) определены
- [x] High-risk `TutorSchedule.tsx` — минимальная правка обоснована
- [x] Student/Tutor изоляция + anti-leak зашиты как инварианты
