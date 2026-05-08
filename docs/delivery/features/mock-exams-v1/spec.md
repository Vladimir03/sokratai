# Feature Spec: Mock Exams v1 — пробники ЕГЭ по физике

**Версия:** v0.2
**Дата:** 2026-05-07
**Автор:** Vladimir Kamchatkin × Claude
**Статус:** draft → ready (после tasks.md)

---

## Decisions log (после ответов Vladimir, 2026-05-07)

| Развилка | Решение |
|---|---|
| Naming сущности | `mock_exam_assignments` (новая), старая `MockExam` deprecated |
| Old MockExam | **Удаляем UI** (`MockExamCard`, `AddMockExamDialog` в `TutorStudentProfile.tsx`), не мигрируем данные. Новая сущность поддерживает **manual_entry mode** — tutor может вписать результат прошлого пробника (вне Сократа) в новую систему. Все результаты в одном месте. |
| PDF бланка | `Бланк_заполнения_ЕГЭ-2025.pdf` (загружен Vladimir, кладём в Storage) |
| Wedge numbers | Primary: **B2B-1 × B2C-1 (Score 125)**, Secondary: B2B-1 × B2C-4 (Score 125, через lead-gen), Tertiary: B2B-2 × B2C-1 (Score 80). См. секцию 0. |
| Lead контакт-канал | Поддерживаем оба (Telegram + email), tutor видит в notification |
| AI prompt complexity | Упрощённый в Phase 1, расширим до полной 208-стр методички в Phase 2 |

> Эта спека специфицирует **Phase 1 (3-4 дня) — Sellable MVP** полностью. Phase 2 и 3 описаны кратко в секции [Phases](#phases) — спецификация для них пишется отдельно после feedback от Phase 1.
>
> Связанные документы (workspace):
> - [Product strategy с 3 фазами](../../../../SokratAI/docs/delivery/features/mock-exams-v1/product-strategy.md)
> - [Product nuances (12 пунктов)](../../../../SokratAI/docs/delivery/features/mock-exams-v1/product-nuances.md)
> - [Кликабельный mockup.html](../../../../SokratAI/docs/delivery/features/mock-exams-v1/mockup.html)

---

## Phase 1 pilot scope addendum (2026-05-07)

> **Контекст:** code review за TASK-1..15 поднял scope-drift против канонического PRD #14 (`docs/discovery/product/tutor-ai-agents/14-ajtbd-product-prd-sokrat.md`), который явно исключает «родительские отчёты» и «OCR / решение по фото» из v1 wedge. Mock Exams делает оба: parent share-link (`PublicMockResult`) + AI Vision на photos Часть 2.

**Decision:** Mock Exams v1 — **диагностический wedge параллельно** PRD #14 «ДЗ-wedge», не его расширение. Phase 1 pilot — это **time-boxed эксперимент** на 4 пилотных tutors с feature flag `tutors.feature_mock_exams_enabled`, изолированный от основного flow (отдельные routes `/tutor/mock-exams/*`, отдельные таблицы `mock_exam_*`, отдельный edge function set).

**Justification (в обход PRD #14 §9.2):**

1. **Диагностический wedge** — отдельный Job: «провести пробник + получить разбор за 30 минут вместо 3 часов рукописного». Не overlap с PRD #14 «собрать ДЗ за 5–10 минут».
2. **Cross-effect 125-Score** на двух cells сегментации (B2B-1 × B2C-1 retention + B2B-1 × B2C-4 lead-gen). Self-funding pilot = retention оплачивает acquisition.
3. **Architectural isolation** = низкая стоимость отката: если пилот провалится, удалить можно без trace в основном продукте (mock_exam_* таблицы DROP, feature_flag column NULLABLE из коробки, routes удаляются с одного PR).
4. **Founder-level decision** Vladimir не формализован обновлением PRD #14, потому что:
   - PRD #14 v0.2 заморожен под B2B-1 × B2C-1 sweet spot
   - Расширение PRD под cross-cell wedge требует явного pivot документа («диагностический wedge addendum to PRD #14»), который не блокирует имплементацию
   - 4-tutor pilot короткий и обратимый — обновление PRD откладывается до Phase 2 commit

**Constraints honored despite scope expansion:**
- AI = draft + action layer (не auto-publish). Tutor approval — formal product invariant (TASK-11).
- Anti-leak whitelist строже homework: `correct_answer` + `solution_text` reveal только post-approval (TASK-13 student / TASK-15 parent).
- Per-tutor feature flag gate (404, не 403) — изоляция от не-пилотных tutors.
- One primary CTA на screen, naming dictionary, workspace-not-chat — UX Principles 2/4/10 соблюдены.

**Phase 2 commit gate:** перед расширением на > 4 tutors или добавлением новых exam types — обновить PRD #14 либо отдельным addendum документом, либо v0.3 update самого PRD. До тех пор Mock Exams v1 — **pilot-only experiment вне канонического PRD scope**, документировано через эту секцию + project memory `project_mock_exams_v1.md`.

**Risk acknowledgement (PRD #14 §16 «Risk 3 — слишком широкий scope»):** этот риск активно материализован. Mitigation = isolation (см. п.3 выше) + time-box (4 tutors, 1 sprint Phase 1). Если NPS < 7/10 у пилотных tutors или conversion < 10% от leads — Mock Exams v1 откатывается, retention и lead-gen ищут другие wedges.

---

## 0. Job Context (обязательная секция)

### Какую работу закрывает эта фича?

| Участник | Core Job | Sub-job | Pilot impact |
|---|---|---|---|
| Репетитор (B2B) | R1 — проверка работ учеников | R1-1 быстрая проверка пробников; R1-2 структурированная оценка по критериям ФИПИ | Высокий — экономит 1-1.5ч на проверке per ученик |
| Репетитор (B2B) | R3 — привлечение и удержание учеников | R3-1 lead-gen через бесплатный пробник; R3-2 retention за счёт новой ценности существующим | Высокий — двойной рычаг до ЕГЭ |
| Репетитор (B2B) | R4 — контроль качества при делегации AI | R4-1 controlled approval AI draft; R4-2 audit trail | Высокий — без approval нельзя публиковать |
| Школьник (B2C) | S1 — диагностика готовности к экзамену | S1-1 понять текущий балл; S1-2 узнать слабые темы | Средний — уровень понятен сразу после Части 1 |
| Родитель (B2C) | P1 — мониторинг прогресса ребёнка | P1-1 простой и понятный отчёт; P1-2 связь с репетитором | Высокий — share-link без регистрации |

> Numero конкретных Core Job (R1, R3, R4, S1, P1) уточняется по `docs/discovery/research/SokratAI_AJTBD_job-graphs/` — оставляю как best-guess based on segments в CLAUDE.md.

### Wedge-связка

(из `docs/discovery/research/SokratAI_AJTBD_Сегментация/SokratAI_AJTBD_b2b2c-cross-segmentation-matrix.md`)

| Wedge | B2B | B2C | Score | Роль в фиче |
|---|---|---|---|---|
| **Primary** | B2B-1 (Премиальные мини-группы Физика ЕГЭ/ДВИ, 2100-4000 ₽/час) | B2C-1 (Физика ЕГЭ: финишная прямая, 2 мес до ЕГЭ) | **125 (max)** | Retention существующих учеников Егора + 3 пилотных tutors |
| **Secondary** | B2B-1 (те же tutors) | B2C-4 (Премиальные тревожные родители Москвы/СПб) | **125 (max)** | Acquisition через lead-gen invite-link → достаёт B2C-4 родителей |
| Tertiary | B2B-2 (Выгоревшие индивидуальные ОГЭ/ЕГЭ) | B2C-1 (та же финишная прямая) | 80 | Поддержка индивидуальных tutors среди пилотных |

**Cross-effect:** Mock Exams бьёт обе клетки **125-Score одновременно** (retention + acquisition) — редкий double-wedge feature. Особенно ценный в финишной прямой 2026.

### Pilot impact

4 пилотных репетитора (Егор + 3) получают за 3-4 дня sellable feature, которая (а) экономит им 1-1.5ч на проверке пробника, (б) создаёт public lead-link для привлечения родителей-лидов, (в) даёт parent share-link для retention существующих платящих учеников. Лиды конвертируются → пилот становится self-funding.

---

## 1. Summary

Mock Exams v1 — отдельная продуктовая сущность для прохождения и проверки пробных ЕГЭ по физике. Репетитор назначает готовый вариант ученикам, ученик проходит экзамен (с бланком ЕГЭ или формой), AI автоматически оценивает Часть 1 (детерминированно по типу проверки) и делает черновик Части 2 по критериям ФИПИ I-IV, репетитор approves/корректирует в review surface, ученик и родитель видят финальный результат с разбором. Дополнительно — публичные lead-link'и: anonymous родитель проходит бесплатный пробник от tutor → результат → CTA «связаться с репетитором» → конверсия.

**Контракт:** AI создаёт черновик, **только tutor approval публикует результат ученику и родителю**. AI никогда не видим конечному пользователю до подтверждения tutor.

---

## 2. Problem

### Текущее поведение

Сейчас репетиторы за месяц до ЕГЭ массово прорешивают со своими учениками пробные варианты вручную:
1. Tutor распечатывает PDF варианта, отправляет ученику.
2. Ученик решает 4 часа, фотографирует все листы, шлёт в Telegram.
3. Tutor вручную проверяет каждый из 26 ответов: 20 в Части 1 по эталону + 6 развёрнутых решений Части 2 по критериям ФИПИ (4 элемента I-IV + блок-схема для №21).
4. Tutor считает первичный балл, конвертирует в тестовый, пишет ученику + родителю отдельно.

**Время per ученик:** 1.5-2 часа. На группу 5 учеников = 7-10 часов работы. Большинство репетиторов проводят пробник 2-3 раза в месяц на финале подготовки.

### Боль

- **Tutor productivity:** механическая проверка съедает время на обучение
- **Acquisition gap:** tutor хочет привлекать через бесплатные пробники, но без автоматизации — это 1-2 раза в год, не масштабируется
- **Контроль:** tutor боится делегировать AI без verification — репутация на кону у платящих родителей
- **Distribution:** родитель не знает уровень ребёнка; нет простого способа показать результат «между занятиями»

### Текущие нанятые решения

PDF + Telegram + Excel-таблица для подсчёта баллов. Часть пробует ChatGPT/Алису для проверки, но без интеграции с экзаменной структурой и без контроля качества.

---

## 3. Solution

### Описание

Параллельная сущность **«Пробник»** (не extension `homework_tutor_assignments`). Reuse существующей инфраструктуры (auth, push, storage, design system, AppFrame), но отдельные таблицы, роуты и UX. Жёсткая state machine `submitted → ai_checking → awaiting_review → approved` с tutor approval мандатом.

### Ключевые решения

**1. Бланк-режим default + auto-check Часть 1 через гибрид (без OCR)**
Ученик распечатывает PDF бланка ЕГЭ, заполняет ручкой (real exam practice). Параллельно вводит ответы Части 1 в форму на сайте — AI проверяет форму. Фото бланка хранится как proof, tutor может визуально сверить. Trade-off: двойной ввод Части 1 для ученика, но получаем real practice + reliable auto-check без OCR. OCR — Phase 3.

**2. Часть 1 immediate / Часть 2 after approval (контракт)**
После Submit ученик видит баллы Части 1 сразу (auto-check) + сообщение «Часть 2 в обработке у репетитора, придёт в течение 24ч». После tutor approval — приходит push с финальным результатом. Anonymous лиды — тот же контракт. Снижает риск repuation damage от AI ошибки, сохраняет «wow» Части 1.

**3. Lead-gen в Phase 1 (minimal viable)**
Tutor генерирует public invite-link `/p/mock-invite/:slug` со своего dashboard. Anonymous пользователь проходит, оставляет lead (имя + Telegram/email + consent). После approval — лид получает результат + CTA «связаться с репетитором X». Phase 3 — payment integration с %-share SokratAI.

**4. Tutor approval mandatory, **per-task** + global**
AI создаёт черновик. Tutor approves per-task (с inline override) ИЛИ bulk для high-confidence batches. Глобальный «Подтвердить и отправить» disabled, пока не закрыты все задачи. Anonymous лиды — без bulk approve, обязательная ручная проверка каждого пункта.

**5. Per-tutor feature flag для безопасного roll-out**
Колонка `tutors.feature_mock_exams_enabled` controls visibility. Day 3 утром — только Егор. Если первые 3-4 часа без критичных багов — включаем остальных 3 tutors к концу дня. Защита от «4 первых впечатления одновременно проваливаются».

**6. Параллельная сущность, не extension**
Mock exam ≠ homework. Diagnostic vs learning, разные visibility contracts (immediate vs gated), разные UX surfaces. Reuse инфраструктуры, но отдельная state machine.

**7. Все результаты пробников в одном месте + manual_entry mode**
Старая `MockExam` сущность (manual entry на странице ученика) **удаляется**: код в `TutorStudentProfile.tsx`, `useMockExams` hook, функции в `tutors.ts`, типы `MockExam` / `CreateMockExamInput` / `UpdateMockExamInput` в `types/tutor.ts`. Старые DB-записи **не мигрируем** (Vladimir подтвердил, что репетиторы пока не использовали).

Новая сущность `mock_exam_assignments` поддерживает **2 режима**:
- **`auto`** — стандартный flow (ученик проходит на сайте, AI проверяет, tutor approves).
- **`manual_entry`** — tutor через кнопку «Добавить результат прошлого пробника» создаёт запись с произвольным variant title (свободный текст «Демо ФИПИ 2024», «Сборник Демидовой 2025»), баллом, датой, комментарием. Без AI flow. Создаётся attempt сразу со статусом `manually_entered`/`approved`.

Обе разновидности видны в **общей истории пробников ученика** (на `/tutor/students/:tutorStudentId` секция «История пробников» заменяет старый `MockExamCard`).

Решает запрос Vladimir «результаты Пробников все в одном месте» + позволяет бэкфилл прошлых пробников вне Сократа.

### Scope

**In scope (Phase 1, P0 = must):**
- [P0] Tutor wizard: вариант → режим (бланк/форма, default бланк) → ученики/группы → дедлайн → invite-link option
- [P0] 1 готовый вариант (Тренировочный 1 от Егора) в seed
- [P0] Student exam screen: form Часть 1 + photo бланка (бланк-режим) + photo Части 2
- [P0] Auto-save state на каждое изменение (защита от 4-часовой потери)
- [P0] Part 1 deterministic checker (5 типов: strict, ordered, unordered, multi_choice, task20, pair)
- [P0] Part 2 AI Vision draft с упрощённым prompt'ом по критериям I-IV
- [P0] Tutor review surface: per-task approve + global approve, low-confidence flags
- [P0] State machine: in_progress → submitted → ai_checking → awaiting_review → approved
- [P0] Student result page: Часть 1 immediate, Часть 2 after approval
- [P0] Parent share-link `/p/mock-result/:slug` (mobile-first, no auth)
- [P0] Public lead-gen invite-link `/p/mock-invite/:slug` (anonymous + lead capture + consent)
- [P0] Per-tutor feature flag (allowlist из 4 tutors)
- [P0] Push уведомления через existing cascade (tutor / student / lead)

**In scope (Phase 1, P1 = nice-to-have, deploy +1-2 дня после P0):**
- [P1] **Manual entry mode**: tutor вписывает результат прошлого пробника (вне Сократа) в новую систему через диалог «Добавить результат прошлого пробника» на `/tutor/mock-exams` или на странице ученика
- [P1] **Удаление старой `MockExam`**: убираем `MockExamCard`, `AddMockExamDialog` из `TutorStudentProfile.tsx`; удаляем `useMockExams`, `createMockExam`, `updateMockExam`, `deleteMockExam` из `tutors.ts`; удаляем типы `MockExam` / `CreateMockExamInput` / `UpdateMockExamInput` из `types/tutor.ts`. Старая таблица БД не мигрируется (Vladimir подтвердил, что репетиторы её не использовали)
- [P1] **Секция «История пробников»** на `TutorStudentProfile.tsx` — заменяет старый `MockExamCard`, показывает все attempts (auto + manual) этого ученика
- [P1] Photo rotation hint client-side
- [P1] 1-pager onboarding для каждого из 4 пилотных tutors
- [P1] Privacy policy update (lead capture clause)
- [P1] Tutor lead notification badge на dashboard

**Out of scope (Phase 2-3):**
- ОГЭ
- Бланк OCR (full automation)
- Дополнительные варианты (только 1 в Phase 1; +3 Егор + 1 ФИПИ в Phase 2)
- Detailed AI prompt по полной 208-стр методичке (Phase 2)
- Confidence flags визуально как chips (Phase 2)
- AI-generated parent comments (Phase 2 с approval flow)
- Auto-conversion первичный → тестовый балл (Phase 2 lookup table)
- Cohort analytics (Phase 2-3)
- Strict timer enforcement (отложено бессрочно)
- Payment integration для lead-gen %-share (Phase 3)
- Tutor reputation badges (Phase 3)

---

## 4. User Stories

### Репетитор

> Когда я готовлю учеников к ЕГЭ за месяц до экзамена, я хочу за 5 минут назначить пробник всей группе и потратить ≤30 мин на проверку результатов с AI-помощью, чтобы тратить больше времени на обучение.

> Когда я хочу привлечь новых платных учеников, я хочу одной кнопкой создать публичную ссылку на бесплатный пробник со своей идентичностью, чтобы поделиться в соцсетях/мессенджерах и получать тёплых лидов с готовой диагностикой.

### Школьник

> Когда я готовлюсь к ЕГЭ, я хочу пройти пробник в условиях близких к экзаменационным (бланк, время) и сразу узнать результат Части 1 с разбором, чтобы понять свой уровень и куда двигаться.

### Родитель

> Когда мой ребёнок готовится к ЕГЭ и я плачу репетитору, я хочу понять текущий уровень и динамику без необходимости разбираться в физике, чтобы видеть отдачу от занятий.

### Anonymous родитель-лид

> Когда я ищу репетитора по физике и не уверен в его подходе, я хочу бесплатно проверить уровень своего ребёнка и получить разбор от конкретного человека, чтобы решить — стоит ли начинать платное обучение.

---

## 5. Technical Design

### Затрагиваемые файлы

**Backend (новое):**
- `supabase/migrations/{date}_mock_exams_v1_schema.sql` — single migration, 8 tables
- `supabase/functions/mock-exam-grade/index.ts` — AI Part 2 grader edge function
- `supabase/functions/mock-exam-public/index.ts` — anonymous public flows (invite + result)
- `supabase/seed/mock-exams-variant-1.sql` — Тренировочный 1 от Егора (~4ч ручного переноса)

**Frontend tutor (новое):**
- `src/pages/tutor/mock-exams/TutorMockExams.tsx` — list page
- `src/pages/tutor/mock-exams/TutorMockExamCreate.tsx` — wizard
- `src/pages/tutor/mock-exams/TutorMockExamDetail.tsx` — heatmap dashboard
- `src/pages/tutor/mock-exams/TutorMockExamReview.tsx` — review surface

**Frontend student (новое):**
- `src/pages/student/StudentMockExam.tsx` — taking surface
- `src/pages/student/StudentMockExamResult.tsx` — result (Часть 1 immediate, Часть 2 after approval)

**Frontend public (новое):**
- `src/pages/PublicMockInvite.tsx` — anonymous invite + lead capture
- `src/pages/PublicMockResult.tsx` — parent share-link result

**Frontend shared (новое):**
- `src/lib/mockExamApi.ts` — API client
- `src/types/mockExam.ts` — types (избегаем конфликта с existing `MockExam`)

**Frontend modifications:**
- `src/App.tsx` — add 8 lazy imports + 8 routes
- `src/components/tutor/chrome/SideNav.tsx` — add «Пробники» entry с feature-flag

**Не затрагиваем (per .claude/rules/10-safe-change-policy.md):**
- `AuthGuard.tsx`, `TutorGuard.tsx`, `Chat.tsx`, `TutorSchedule.tsx`, `telegram-bot/index.ts`
- Existing `MockExam` entity (manual entry в `TutorStudentProfile.tsx`) — оставляем как есть, разрешаем naming конфликт через нейминг новой сущности

### Data Model

8 новых таблиц + 1 column на existing:

```sql
-- 1. Каталог вариантов
mock_exam_variants (
  id UUID PK, title TEXT, exam_type TEXT,
  source TEXT ('tutor'|'fipi'), source_attribution TEXT,
  duration_minutes INT, total_max_score INT,
  part1_max INT, part2_max INT, task_count INT,
  created_by UUID FK auth.users, created_at TIMESTAMPTZ
)

-- 2. Задачи варианта
mock_exam_variant_tasks (
  id UUID PK, variant_id UUID FK, kim_number INT, part INT (1|2),
  order_num INT, task_text TEXT, task_image_url TEXT,
  correct_answer TEXT, check_mode TEXT, max_score INT,
  solution_text TEXT, topic TEXT
)

-- 3. Назначенный пробник (canonical entity)
mock_exam_assignments (
  id UUID PK,
  variant_id UUID FK NULL,  -- NULL для manual_entry с произвольным variant_title
  variant_title TEXT NULL,  -- non-NULL только для manual_entry: "Демо ФИПИ 2024"
  tutor_id UUID FK,
  title TEXT,
  mode TEXT ('blank'|'form'|'manual_entry'),
  deadline TIMESTAMPTZ NULL,  -- NULL для manual_entry
  status TEXT, created_at TIMESTAMPTZ,
  CHECK (
    (mode = 'manual_entry' AND variant_id IS NULL AND variant_title IS NOT NULL)
    OR (mode IN ('blank','form') AND variant_id IS NOT NULL)
  )
)

-- 4. Попытка ученика
mock_exam_attempts (
  id UUID PK, assignment_id UUID FK mock_exam_assignments,
  student_id UUID FK auth.users NULL,  -- NULL для anonymous
  anonymous_id UUID NULL,                -- non-NULL для anonymous
  status TEXT,                           -- 'in_progress'|'submitted'|'ai_checking'|'awaiting_review'|'approved'|'manually_entered'
  started_at TIMESTAMPTZ NULL,           -- NULL для manually_entered
  submitted_at TIMESTAMPTZ NULL,
  total_time_minutes INT NULL,
  blank_photo_url TEXT NULL,
  total_part1_score INT NULL, total_part2_score INT NULL,
  total_score INT NULL,                  -- для manually_entered tutor вводит сразу
  manual_entered_date DATE NULL,         -- дата прошлого пробника (для manual_entry)
  manual_comment TEXT NULL,              -- комментарий tutor для manual_entry
  CHECK ((student_id IS NOT NULL) <> (anonymous_id IS NOT NULL))
)

-- 5. Ответы Части 1
mock_exam_attempt_part1_answers (
  attempt_id UUID FK, kim_number INT,
  student_answer TEXT, earned_score INT,
  PRIMARY KEY (attempt_id, kim_number)
)

-- 6. Решения Части 2 + AI draft + tutor approval
mock_exam_attempt_part2_solutions (
  attempt_id UUID FK, kim_number INT,
  photo_url TEXT,
  ai_draft_json JSONB,  -- {suggested_score, confidence, elements_check, comment_for_tutor, flags}
  tutor_score INT NULL, tutor_comment TEXT,
  status TEXT ('awaiting_review'|'tutor_approved'|'tutor_modified'),
  PRIMARY KEY (attempt_id, kim_number)
)

-- 7. Anonymous лиды
mock_exam_anonymous_leads (
  id UUID PK, attempt_id UUID FK,
  lead_name TEXT, lead_contact TEXT,
  contact_type TEXT ('telegram'|'email'),
  tutor_id UUID FK, consent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)

-- 8. Public links
mock_exam_public_links (
  slug TEXT PK,  -- 8-char random
  scope TEXT ('invite'|'parent_result'),
  attempt_id UUID FK NULL,  -- для invite — NULL, для parent_result — non-NULL
  mock_exam_id UUID FK NULL,  -- для invite — non-NULL
  tutor_id UUID FK,
  created_at TIMESTAMPTZ, expires_at TIMESTAMPTZ
)

-- 9. Per-tutor feature flag
ALTER TABLE tutors ADD COLUMN feature_mock_exams_enabled BOOLEAN DEFAULT false;
```

**RLS policies:** student видит только свои attempts; tutor видит только свои mock_exams + связанные attempts; anonymous endpoints используют `service_role` через edge functions, не PostgREST.

### API

**Tutor endpoints** (через edge function или PostgREST):
- `POST /mock-exams/assignments` — create
- `GET /mock-exams/assignments` — list
- `GET /mock-exams/assignments/:id` — detail with attempts
- `GET /mock-exams/attempts/:id` — single attempt with AI draft
- `POST /mock-exams/attempts/:id/approve-task` — per-task approve { kim_number, score, comment? }
- `POST /mock-exams/attempts/:id/approve-all` — global approve (all tasks must be closed)
- `POST /mock-exams/assignments/:id/invite-link` — generate public invite link

**Student endpoints:**
- `GET /mock-exams/student/:id` — get assignment with variant
- `POST /mock-exams/attempts/:id/start` — start attempt
- `PATCH /mock-exams/attempts/:id/answer` — auto-save part1 { kim_number, answer }
- `POST /mock-exams/attempts/:id/photo` — upload part2 photo
- `POST /mock-exams/attempts/:id/submit` — submit final → triggers AI grading

**Public (anonymous, service_role):**
- `GET /p/mock-invite/:slug` — read invite metadata + tutor card
- `POST /p/mock-invite/:slug/start` — anonymous attempt start (lead capture + consent)
- `GET /p/mock-result/:slug` — read approved result (parent or lead)

### Миграции

Single migration `20260508120000_mock_exams_v1_schema.sql` — все 8 таблиц + indexes + RLS policies + tutors flag column.

---

## 6. UX / UI

### Wireframe / Mockup

[mockup.html](../../../../SokratAI/docs/delivery/features/mock-exams-v1/mockup.html) — 8 кликабельных экранов (workspace folder, не репо). После approve будет перенесён в репо как reference artifact.

### UX-принципы (применяются)

- **AI = draft + action.** AI создаёт черновик, tutor подтверждает кнопкой. Никаких чат-режимов «согласен ли ты».
- **Tutor approval mandatory.** Контракт «AI never publishes to student» — формальное product invariant.
- **Pareto-первое.** 1 вариант, упрощённый prompt, 1 готовый PDF бланка, без OCR.
- **Уважение к exam realism.** Бланк по умолчанию (real practice), таймер визуальный (не enforce — диагностически избыточно).
- **Распределение брендов в lead-gen.** Tutor identity primary, SokratAI «через платформу».

### UI-паттерны (применяются)

- AppFrame для tutor mock-exam routes (внутри `<Route path="/tutor">`)
- shadcn Card / Button / Dialog как в TutorHomework
- Heatmap pattern (как в TutorHomeworkDetail) — sticky-первая колонка, `border-separate border-spacing-0`, `overflow-x-auto touch-pan-x`
- Form input типизация под `check_mode` (5 вариантов)
- Public share-link паттерн (как `PublicHomeworkShare` для homework)
- Per-task approve = Lucide CheckCircle2 + кнопка «Подтвердить: N/M»

---

## Acceptance Criteria (testable)

Минимум 3 testable AC, привязанных к P0:

- **AC-1: Tutor может назначить пробник за <2 минуты.** Tutor нажимает «Назначить пробник» → выбирает Тренировочный 1 → выбирает 5 учеников → нажимает «Назначить» → видит запись в `mock_exams` с `status=active` и записи в `mock_exam_attempts` со `status=not_started` для каждого ученика.

- **AC-2: Student exam state восстанавливается после reload.** Ученик открывает `/student/mock-exams/:id`, заполняет 10 ответов Части 1 + 2 фото Части 2, закрывает вкладку, открывает заново — все данные восстановлены из `localStorage` + БД.

- **AC-3: Part 1 deterministic checker возвращает корректные баллы.** Submit с известным набором ответов → значения в `mock_exam_attempt_part1_answers.earned_score` совпадают с эталонной таблицей для всех 5 типов проверки.

- **AC-4: AI grading edge function вызывается после submit.** Submit attempt → background job вызывает edge function → ai_draft_json populated в `mock_exam_attempt_part2_solutions` для всех 6 задач Части 2 → status=`awaiting_review`.

- **AC-5: Tutor approval публикует Часть 2 ученику.** Tutor открывает review surface, approves все 6 задач, нажимает «Подтвердить и отправить» → status=`approved` → student видит финальный балл в результатах.

- **AC-6: Anonymous lead flow.** Открыть `/p/mock-invite/:slug` без auth → заполнить имя + Telegram + consent → submit attempt → запись в `mock_exam_anonymous_leads` создана + tutor получает push. **Implementation (2026-05-07):** push leg — `notifyTutorOfNewLead()` в `mock-exam-public::handleInviteStart`, best-effort, retry-once на 5xx, cleanup 410 Gone, PII-free payload. Telegram leg cascade — fast follow-up (требует resolution `tutor.telegram_user_id` через profiles+sessions). Post-submit UX: inline success-state «Спасибо, {имя}! Репетитор получил уведомление и свяжется в {Telegram|email}» — НЕ redirect (anonymous taking flow self-serve = отдельный follow-up).

- **AC-7: Parent share-link открывается без regex.** GET `/p/mock-result/:slug` без cookies/JWT возвращает 200 с mobile-friendly страницей (если status=approved) или 403 (если still awaiting_review).

- **AC-8: Per-tutor feature flag.** Tutor с `feature_mock_exams_enabled=false` не видит «Пробники» в SideNav и не получает доступ к `/tutor/mock-exams`. TASK-7 frontend guard redirects such tutors to `/tutor/home`; если product owner потребует literal 404, меняется только route gate, не модель флага.

---

## 7. Validation

### Как проверяем успех (Phase 1)?

**Leading (через 3-7 дней после запуска):**
- ≥1 пробник реально назначен и сдан хотя бы 1 учеником
- ≥1 родитель открыл share-link
- ≥1 anonymous lead зашёл через invite-link и оставил контакт

**Lagging (через 2-4 недели):**
- ≥3 из 4 пилотных tutors провели реальный пробник
- Tutor говорит «я могу это продавать ученикам» (qualitative)
- ≥1 lead → платящий ученик (proof of monetization)

### Связь с pilot KPI

Усиливает retention pilot KPI (tutor использует Сократ для большего числа задач) + добавляет acquisition pilot KPI (lead-gen funnel measurable).

### Smoke check

```bash
npm run lint && npm run build && npm run smoke-check
```

Дополнительно для Mock Exams:
- Migration applies cleanly: `supabase db reset && supabase db push`
- Seed Тренировочный 1: GET `mock_exam_variants` returns 1 row + 26 task rows
- Edge function deploys: `supabase functions deploy mock-exam-grade`

---

## 8. Risks & Open Questions

| Риск | Вероятность | Митигация |
|---|---|---|
| AI Vision плохо читает handwriting | Высокая | Tutor approve mandatory, фото всегда виден, low-conf flag, упрощённый prompt в Phase 1 |
| Tutor review backlog (5 учеников × 6 задач = 30 actions) | Средняя | Sort by confidence, bulk approve high-conf, per-task UI с минимумом кликов |
| State loss во время 4-час экзамена | Средняя | Auto-save localStorage + DB на каждое изменение (debounced) |
| Photo quality в реальных условиях | Средняя | Client-side guidance, retry button, low-conf flag для tutor |
| Naming конфликт с существующей `MockExam` сущностью | Средняя | См. Open Question #1 ниже — называем «MockExamAssignment» или «PracticeExam» |
| 4 tutors параллельно встречают критичный баг | Средняя | Per-tutor feature flag, staggered roll-out (Егор первый, 3 остальных через 4 часа) |
| Lead consent — юридический риск | Низкая | Чекбокс consent + privacy policy update в P1 |
| Бланк PDF (2025) использует устаревший формат | Низкая | Tutor может загрузить свой PDF в Storage, fallback в seed |

### Открытые вопросы (все resolved 2026-05-07)

| Вопрос | Решение | Резолвер |
|---|---|---|
| Naming сущности | ✅ `mock_exam_assignments`. Старая `MockExam` deprecated и удаляется (UI + код). | Vladimir |
| Manual_entry mode | ✅ Включён в P1: tutor может бэкфилл прошлых пробников вне Сократа. Новая сущность — единое место всех результатов. | Vladimir |
| PDF бланка | ✅ `Бланк_заполнения_ЕГЭ-2025.pdf` (загружен), кладём в Storage `mock-exam-blanks/`. | Vladimir |
| Wedge-номера | ✅ Primary B2B-1×B2C-1 (125), Secondary B2B-1×B2C-4 (125), Tertiary B2B-2×B2C-1 (80). | Claude рекомендация → Vladimir подтверждает |
| Lead контакт-канал default | ✅ Поддерживаем оба (Telegram + email). Tutor выбирает в notification. | Vladimir |
| AI prompt для Части 2 | ✅ Упрощённый в Phase 1 (4 элемента I-IV без deep parsing методички). Полный в Phase 2. | Vladimir |

---

## 9. Implementation Tasks

> Перенесутся в `tasks.md` после approve. Группировка: backend, tutor-side, student-side, public-side, polish. P0 деплоится первым релизом, P1 — fast follow-up.

**Backend (P0):**
- TASK-1: Schema migration (8 таблиц + indexes + RLS + tutor feature flag column) — ✅ Done (2026-05-07)
- TASK-2: Seed Тренировочный 1 от Егора (3-4ч ручного переноса с валидацией Егором) — ⏳ pending Егор review
- TASK-3: Tutor API endpoints (PostgREST + per-task approve edge function) — ✅ Done (2026-05-07)
- TASK-4: Student API endpoints (с auto-save attempt state) — ✅ Done (2026-05-07)
- TASK-5: AI Part 2 grader edge function (mock-exam-grade) — ✅ Done (2026-05-07). Phase 1 simplified ФИПИ prompt + спец-правило №21. Anti-leak: response никогда не содержит `ai_draft_json`. См. CLAUDE.md §12.
- TASK-6: Public anonymous endpoints (mock-exam-public — invite + result) — ✅ Done (2026-05-07)

**Tutor-side (P0):**
- TASK-7: Routes + sidebar entry с per-tutor feature flag (App.tsx + SideNav.tsx) — ✅ Done (2026-05-07)
- TASK-8: TutorMockExams (list page) — ✅ Done (2026-05-07)
- TASK-9: TutorMockExamCreate (wizard с режимом бланк/форма) — ✅ Done (2026-05-07)
- TASK-10: TutorMockExamDetail (results dashboard with heatmap) — ✅ Done (2026-05-07). Header + 5 KPI + heatmap students × 26 tasks (Часть 1 / spacer / Часть 2 / 3 totals) + AI-черновик amber banner. Phase 1 ограничение: per-task hydration не реализована (все task-клетки cell-empty), Часть 2 для `awaiting_review`/`submitted` форсится в `cell-draft`. См. CLAUDE.md §13.
- TASK-11: TutorMockExamReview (review surface с per-task approve + global approve) — ✅ Done (2026-05-07). Per-task approve через `POST /approve-task` + global approve через `POST /approve-all` с AlertDialog confirmation. Anonymous lead → no bulk shortcut (nuance #2). Low-confidence rose border + alert (nuance #5). Score override read-only через explicit modal (nuance #3). LaTeX через lazy MathText. См. CLAUDE.md §14.

**Student-side (P0):**
- TASK-12: StudentMockExam (taking surface — form Часть 1 + photo бланка + photo Части 2 + auto-save + visual timer)
- TASK-13: StudentMockExamResult (Часть 1 immediate, Часть 2 pending → after approval) — ✅ Done (2026-05-07). Backend `GET /student/:assignmentId/result` (state-aware reveal); frontend page + `useStudentMockExamResult` hook. AI draft никогда не возвращается; `tutor_score`/`tutor_comment`/`solution_text` gated к `status === 'approved'`. 409 NOT_SUBMITTED → redirect обратно на taking surface. См. CLAUDE.md §13 (mock exams student result).

**Public-side (P0):**
- TASK-14: PublicMockInvite (anonymous start с lead capture + consent + tutor card) — ✅ Done (2026-05-07). `src/pages/PublicMockInvite.tsx` + `src/lib/mockExamPublicApi.ts::fetchPublicMockInvite/startPublicMockInvite`. Tutor card + offer (3 metrics) + lead form (имя + Telegram/email auto-detect + consent + privacy link). POST → `mock_exam_anonymous_leads` row (AC-6) + `notifyTutorOfNewLead()` push leg. Post-submit UX: inline success-state «Спасибо, {имя}! Репетитор получил уведомление и свяжется в {Telegram|email}» (review fix 2026-05-07 — НЕ redirect; anonymous taking self-serve = follow-up). Mobile-first 16px inputs.
- TASK-15: PublicMockResult (parent share-link, mobile-first) — ✅ Done (2026-05-07). `src/pages/PublicMockResult.tsx` + `mockExamPublicApi.ts::fetchPublicMockResult`. Big primary score / preliminary test score / progress bar (canonical 22/36/54 thresholds для `exam_type='ege_physics'`) / Часть 1 + Часть 2 split / опц. manual_comment / collapsible per-task drill-down / tutor CTA Telegram link с graceful degradation (нет `telegram_username` в payload по anti-leak whitelist → fallback reassurance). 6 status states (loading/error/invalid/not_found/expired/**not_ready**=AC-7/ok). Mobile 375px verified.

**Manual_entry + cleanup (P1):**
- TASK-16: Manual entry dialog «Добавить результат прошлого пробника» (на `/tutor/mock-exams` и `/tutor/students/:id`)
- TASK-17: Удаление старой `MockExam`: `MockExamCard` + `AddMockExamDialog` из `TutorStudentProfile.tsx`, `useMockExams` из `useTutor.ts`, `getMockExams`/`createMockExam`/`updateMockExam`/`deleteMockExam` из `tutors.ts`, типы `MockExam` / `CreateMockExamInput` / `UpdateMockExamInput` из `types/tutor.ts`
- TASK-18: Секция «История пробников» на `TutorStudentProfile.tsx` (заменяет старый блок MockExamCard)

**Polish (P1):**
- TASK-19: Photo rotation hint client-side
- TASK-20: 1-pager onboarding для каждого из 4 пилотных tutors
- TASK-21: Privacy policy update for lead capture
- TASK-22: Tutor lead notification badge на dashboard
- TASK-23: Empty / loading / error states polish

**Total estimate:** P0 = 3-4 дня для одного разработчика. P1 = +1-2 дня после P0.

---

## Phases

### Phase 1 — Sellable MVP (3-4 дня) — **ЭТА СПЕКА**

Цель: 4 пилотных tutor параллельно начинают использовать пробники со своими учениками + создают lead-link'и.

Triggers старт Phase 2:
- ≥3 из 4 tutors провели хотя бы 1 пробник
- ≥1 lead через invite-link
- AI accuracy на handwriting acceptable (override rate <30%)

### Phase 2 — Strong tutor product (1 неделя после Phase 1)

Кратко (отдельная спека пишется после Phase 1 feedback):
- 3 оставшихся варианта Егора + 1 ФИПИ demo в seed
- Detailed criteria UI (I/II/III/IV галочки) и detailed AI prompt по 208-стр методичке ФИПИ
- Confidence flags визуально (high/medium/low chips)
- Polished parent dashboard с сравнением между пробниками
- Manual lookup primary → test score 2026

### Phase 3 — Public-facing продукт (2 недели от старта Phase 1)

Кратко:
- Lead-gen payment integration (% от первого платежа)
- ОГЭ
- Бланк OCR (full automation)
- Cohort analytics
- AI parent summary с approval flow
- More variants library

---

## Parking Lot

Хорошие идеи, всплывшие при написании спеки, но не вошедшие в scope Phase 1:

- **Бланк OCR** — революция для UX (no double entry), но требует Vision OCR + error handling. Phase 3.
- **Tutor profile public page** — расширение invite-link с photo + bio + reviews. Phase 3.
- **Detailed criteria breakdown UI с подсветкой строк решения** — где именно AI увидел элемент I/II/III/IV. Phase 2.
- **Cohort analytics: «эта группа провалила тему N»** — сильный сигнал для tutor. Phase 2-3.
- **AI-generated parent comment с approval flow** — Phase 2 с отдельным approve step.
- **Auto secondary score conversion table 2026** — Phase 2 (после публикации шкалы ФИПИ в июне).
- **Strict timer enforcement** — диагностически избыточно, отложено бессрочно.
- **Tutor reputation badge** на share-link («15 учеников сдали ЕГЭ 80+») — Phase 3.
- **Re-grading flow** — tutor хочет переоценить через 7 дней. Phase 2.
- **Photo retake request** — tutor запрашивает у ученика переснимку фото. Phase 2.
- **«Подозрительно быстро» cheating signal** — Phase 2 с visual flag.
- **Variant authoring UI** — tutor создаёт свой вариант из задач KB. Phase 3.

---

## Anti-scope-creep правило

После approve этой спеки scope Phase 1 фиксируется. Изменения требуют либо удаления другого requirement такого же приоритета, либо создания новой фазы. Если Егор/Vladimir пишут «а ещё бы...» во время реализации:
1. Записать в backlog.md (5 минут)
2. НЕ добавлять в текущую SPEC
3. Если pilot blocker — отдельная hotfix SPEC

---

## Checklist перед approve

- [x] Job Context заполнен (секция 0)
- [x] Привязка к Core Job из Графа работ + wedge-номера из cross-segmentation matrix
- [x] Scope чётко определён (in/out/parking lot)
- [x] UX-принципы из doc 16 учтены (AI = draft + action, tutor approval mandatory)
- [x] UI-паттерны из doc 17 учтены (AppFrame, shadcn, heatmap pattern, public share)
- [x] Pilot impact описан
- [x] Метрики успеха определены (leading + lagging)
- [x] AC testable, ≥3 (8 штук)
- [x] Requirements priorit­ized P0/P1 (~13 P0, ~7 P1 включая manual_entry + cleanup)
- [x] Phasing описано (Phase 1 полностью, Phase 2-3 кратко)
- [x] Parking Lot заполнен
- [x] High-risk файлы НЕ затрагиваются (Chat, AuthGuard, TutorGuard, TutorSchedule, telegram-bot)
- [x] Student/Tutor изоляция не нарушена (отдельные routes, отдельные API, no cross-imports)
- [x] **Все Open Questions закрыты** (см. секцию Decisions log в начале)

---

**Готово к Step 5: TASKS.** Все blocking-вопросы решены. Следующий шаг — нарезка на TASK-1..N с copy-paste промптами для агентов (по dev-pipeline шаг 5).
