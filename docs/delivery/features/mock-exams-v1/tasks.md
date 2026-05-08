# Implementation Tasks: Mock Exams v1

**Spec:** [spec.md](./spec.md)
**Связанные документы:** [product-strategy.md](../../../../SokratAI/docs/delivery/features/mock-exams-v1/product-strategy.md), [product-nuances.md](../../../../SokratAI/docs/delivery/features/mock-exams-v1/product-nuances.md), [mockup.html](../../../../SokratAI/docs/delivery/features/mock-exams-v1/mockup.html)

**Канонические промпт-патерны:** `docs/discovery/product/tutor-ai-agents/20-claude-code-prompt-patterns-sokrat.md`

---

## Краткий план (3-4 дня + 1-2 дня P1)

| Day | Задачи | Группа |
|---|---|---|
| **Day 1** | TASK-1, TASK-2, TASK-7 | Schema + seed + routing skeleton |
| **Day 2** | TASK-3, TASK-4, TASK-12, TASK-13 | Backend API + student-side UI |
| **Day 3** | TASK-5, TASK-8, TASK-9, TASK-10, TASK-11 | AI grader + tutor UI (list/wizard/detail/review) |
| **Day 4** | TASK-6, TASK-14, TASK-15 | Public lead-gen layer |
| **Day 5+ (P1)** | TASK-16..TASK-23 | Manual entry, cleanup старого MockExam, polish |

## Dependency graph

```
TASK-1 (migration)
  ├──> TASK-2 (seed) ──┐
  ├──> TASK-3 (tutor API)
  ├──> TASK-4 (student API)
  ├──> TASK-5 (AI grader)
  └──> TASK-6 (public API)
                       │
TASK-7 (routes+sidebar)─┤
                       │
                       ▼
TASK-8 (list) ──> TASK-9 (wizard)
TASK-10 (heatmap) ──> TASK-11 (review surface)
TASK-12 (student exam) ──> TASK-13 (student result)
TASK-14 (public invite) ──> TASK-15 (parent share)

P1: TASK-16 (manual entry), TASK-17 (cleanup), TASK-18 (история пробников),
    TASK-19 (rotate hint), TASK-20-23 (polish)
```

Параллелизм: задачи в одной строке dependency могут идти параллельно.

---

# Phase 1 — P0 (Day 1-4)

## TASK-1: Миграция БД — 8 таблиц mock_exams

**Job:** R1, R3, R4 (foundation для всех)
**Agent:** Claude Code
**Files:**
- `supabase/migrations/20260508120000_mock_exams_v1_schema.sql` (новый)
- `src/integrations/supabase/types.ts` (auto-regenerated)

**AC:** AC-1, AC-2 (schema основа), AC-8 (per-tutor flag)

**Depends on:** —

**Шаги:**
1. Создать миграцию с 8 таблицами по спеке (раздел Data Model): `mock_exam_variants`, `mock_exam_variant_tasks`, `mock_exam_assignments`, `mock_exam_attempts`, `mock_exam_attempt_part1_answers`, `mock_exam_attempt_part2_solutions`, `mock_exam_anonymous_leads`, `mock_exam_public_links`
2. Все CHECK constraints из спеки (mode/variant_id mutually exclusive, student_id XOR anonymous_id)
3. Indexes: `mock_exam_attempts(assignment_id, status)`, `mock_exam_attempts(student_id)`, `mock_exam_public_links(slug)` UNIQUE, `mock_exam_anonymous_leads(tutor_id, created_at DESC)`
4. RLS policies: tutor видит свои `mock_exam_assignments` через `auth.uid() = tutor_id`. Student видит свои `mock_exam_attempts` через `auth.uid() = student_id`. Anonymous endpoints НЕ через RLS — service_role в edge functions.
5. ALTER TABLE tutors ADD COLUMN `feature_mock_exams_enabled BOOLEAN DEFAULT false`
6. Применить миграцию: `supabase db push` локально

**Guardrails:** НЕ трогать существующую `MockExam` table — она deprecates в TASK-17, не сейчас.

---

## TASK-2: Seed Тренировочного варианта 1 от Егора — 🟢 Content reviewed (2026-05-07)

**Job:** R1, S1 (контент для пилота)
**Agent:** Claude Code (parsing + generation done) → Egor (content review) → Vladimir (Storage upload + commit)

**AC:** AC-3 (deterministic checker корректно проверяет seeded ответы)

**Depends on:** TASK-1 ✅

### Что сделано

- ✅ `scripts/parse-mock-exam-docx.py` — разворачивает docx, парсит paragraphs/tables/relationships
- ✅ `scripts/structure-mock-exam.py` — extractor с anomaly fix (kim 4 и 7, маркер после тела), извлечение answer-key (20 строк) и Part 2 solutions (6 «Возможное решение» секций)
- ✅ `scripts/build-mock-exam-seed.py` — детерминированный seed-generator (uuid5, dual-format storage refs, instruction stripping, score totals from reviewed tasks)
- ✅ `docs/delivery/features/mock-exams-v1/source/variant1-tasks.json` — Codex review 2026-05-07: task_text/correct_answer/solution_text сверены с docx, inline-формулы перенесены в LaTeX, KIM 17 исправлен на α-распад
- ✅ `supabase/seed/mock_exams_variant_1.sql` — 27 INSERT'ов (1 variant + 26 tasks), idempotent, пересобран после content review
- ✅ `supabase/migrations/20260508120100_mock_exams_storage_buckets.sql` — 4 bucket'а (variant-tasks, blanks, part2-photos, blank-templates) + RLS policies
- ✅ `docs/delivery/features/mock-exams-v1/source/variant1-review.md` — verified Markdown review с исправленными формулами и final_answer для Part 2
- ✅ `docs/delivery/features/mock-exams-v1/source/storage-upload-checklist.md` — инструкция Vladimir
- ✅ `docs/delivery/features/mock-exams-v1/source/raw-images/` — 20 extracted candidates из docx; upload whitelist после review = 13 task images

### Что блокирует apply

| Action | Owner | Estimate |
|---|---|---|
| Конвертировать 11 WMF/EMF → PNG (LibreOffice / cloudconvert) | Vladimir | ~10 мин |
| Загрузить 13 PNG в Storage `mock-exam-variant-tasks/variant1/` по `storage-upload-checklist.md` | Vladimir | ~10 мин |
| Загрузить `Бланк_заполнения_ЕГЭ-2025.pdf` в `mock-exam-blank-templates/ege-physics-2025.pdf` | Vladimir | ~2 мин |
| Заменить `created_by` placeholder в seed на UUID Егора | Vladimir | ~5 мин |
| Push в main → Lovable Cloud apply | Vladimir | auto |
| `UPDATE tutors SET feature_mock_exams_enabled = true WHERE user_id = '<egor>'` | Vladimir | ~1 мин |

### Operational tail — пошаговая инструкция (Lovable Cloud Studio)

Полный workflow для Vladimir, разбитый на 5 этапов. Каждый — самостоятельный, можно прервать и продолжить позже.

#### 0. Prerequisites — что должно быть готово

- ✅ Миграции `20260508120000_mock_exams_v1_schema.sql` + `20260508120100_mock_exams_storage_buckets.sql` уже применены при предыдущих push (или применятся автоматически на следующий push)
- ✅ `supabase/seed/mock_exams_variant_1.sql` уже регенерирован после Codex content review
- ✅ `docs/delivery/features/mock-exams-v1/source/raw-images/` содержит 20 файлов из docx (whitelist на upload — 13)

Проверка что миграции применены — в Lovable Cloud Studio → Database → Tables. Должны быть таблицы `mock_exam_variants`, `mock_exam_variant_tasks`, `mock_exam_assignments`, `mock_exam_attempts`, `mock_exam_attempt_part1_answers`, `mock_exam_attempt_part2_solutions`, `mock_exam_anonymous_leads`, `mock_exam_public_links`. И в Storage → buckets: `mock-exam-variant-tasks`, `mock-exam-blanks`, `mock-exam-part2-photos`, `mock-exam-blank-templates`.

#### 1. Конвертация WMF/EMF → PNG (локально, до Lovable)

Это **локальный шаг** — Lovable Studio не умеет конвертировать. Выполняется на Windows-машине Vladimir один раз.

**Что конвертировать (11 файлов):**

```
docs/delivery/features/mock-exams-v1/source/raw-images/
  image6.emf  → image6.png    (KIM 1)
  image7.emf  → image7.png    (KIM 5)
  image9.emf  → image9.png    (KIM 9)
  image10.emf → image10.png   (KIM 11)
  image11.emf → image11.png   (KIM 13)
  image16.emf → image16.png   (KIM 20)
  image17.emf → image17.png   (KIM 20)
  image18.emf → image18.png   (KIM 20)
  image19.emf → image19.png   (KIM 20)
  image20.emf → image20.png   (KIM 20)
  image22.emf → image22.png   (KIM 21)
```

**Не конвертировать** (как есть, уже PNG/JPEG):
```
image8.png   (KIM 7)
image15.png  (KIM 19)
image25.jpeg (KIM 26)  — но переименовать в .jpeg → .png? Нет, оставить .jpeg, frontend поддерживает оба
```

**Команда конвертации** (LibreOffice, рекомендую):

```powershell
cd docs/delivery/features/mock-exams-v1/source/raw-images/
soffice --headless --convert-to png image6.emf image7.emf image9.emf image10.emf image11.emf image16.emf image17.emf image18.emf image19.emf image20.emf image22.emf
# Результат: image6.png, image7.png, ... в той же папке
```

**Если LibreOffice нет** — https://cloudconvert.com/wmf-to-png drag-and-drop по одному файлу.

**Quality check:** открой каждый PNG — должны быть читаемые графики/диаграммы. Если плохо — повтори с DPI 300.

#### 2. Storage upload (Lovable Cloud Studio UI)

Открыть: **Lovable project → Storage tab**.

##### 2a. Bucket `mock-exam-variant-tasks` → folder `variant1/` (13 PNG)

Имена в bucket'е должны совпадать буква-в-букву с тем, что в seed.sql.

| Загрузить файл | Целевой path |
|---|---|
| `image6.png` | `variant1/image6.png` |
| `image7.png` | `variant1/image7.png` |
| `image8.png` | `variant1/image8.png` |
| `image9.png` | `variant1/image9.png` |
| `image10.png` | `variant1/image10.png` |
| `image11.png` | `variant1/image11.png` |
| `image15.png` | `variant1/image15.png` |
| `image16.png` | `variant1/image16.png` |
| `image17.png` | `variant1/image17.png` |
| `image18.png` | `variant1/image18.png` |
| `image19.png` | `variant1/image19.png` |
| `image20.png` | `variant1/image20.png` |
| `image22.png` | `variant1/image22.png` |

(итого **13 файлов**, все PNG. Исключены из upload: `image25.jpeg` — Vladimir после content review убрал ref на image25 из kim 26 в seed; inline-formula images `image5/12/13/14/23/24` — формулы перенесены в LaTeX в `task_text` напрямую)

**Verify:**
```sql
-- Lovable Studio → SQL Editor
SELECT name FROM storage.objects
WHERE bucket_id = 'mock-exam-variant-tasks' AND name LIKE 'variant1/%'
ORDER BY name;
-- Expected: 13 rows
```

##### 2b. Bucket `mock-exam-blank-templates` → 1 PDF

Загрузить `C:\Users\kamch\Downloads\Telegram Desktop\Бланк_заполнения_ЕГЭ-2025__4j4x5.pdf` как `ege-physics-2025.pdf`.

```sql
SELECT name FROM storage.objects WHERE bucket_id = 'mock-exam-blank-templates';
-- Expected: 1 row, name = 'ege-physics-2025.pdf'
```

Проверить публичную ссылку (должна открыться без auth):
`https://vrsseotrfmsxpbciyqzc.supabase.co/storage/v1/object/public/mock-exam-blank-templates/ege-physics-2025.pdf`

##### 2c. Buckets `mock-exam-blanks` + `mock-exam-part2-photos`

**Не трогать** — они для student photo uploads через TASK-12 frontend. На этапе TASK-2 должны быть пустыми.

#### 3. Replace `created_by` placeholder в seed.sql

Перед push в main: заменить fallback subquery на конкретный UUID Егора. Это нужно потому что seed apply под service_role обходит RLS, но FK на `auth.users(id)` остаётся обязательным.

##### 3a. Найти UUID Егора

В Lovable Studio → SQL Editor:

```sql
-- Поиск по email (если знаешь)
SELECT id, email, created_at FROM auth.users WHERE email = '<egor-email>';

-- ИЛИ поиск через профиль/связку tutor
SELECT u.id, u.email, t.name
FROM auth.users u
JOIN public.tutors t ON t.user_id = u.id
WHERE t.name ILIKE '%Егор%' OR t.name ILIKE '%Egor%';
```

Скопировать `id` (UUID вида `12345678-1234-1234-1234-123456789abc`).

##### 3b. Отредактировать seed.sql

Файл: `supabase/seed/mock_exams_variant_1.sql`. В блоке `INSERT INTO public.mock_exam_variants ... VALUES (...)` найти строку (~line 50):

```sql
  (SELECT id FROM auth.users ORDER BY created_at LIMIT 1)
```

Заменить на:

```sql
  '<egor-uuid-here>'::uuid
```

⚠️ Это **единственная** ручная правка seed.sql. Не трогать ни одну другую строку.

##### 3c. Если у Егора ещё нет аккаунта в проде

Оставить fallback `(SELECT id FROM auth.users ORDER BY created_at LIMIT 1)` как есть. Seed применится с UUID первого пользователя. Позже отдельной миграцией:

```sql
-- supabase/migrations/<date>_mock_exam_variant_1_set_created_by_egor.sql
UPDATE public.mock_exam_variants
SET created_by = '<egor-uuid>'::uuid
WHERE id = '36cebc45-e2e8-5603-a753-01c818bba131';
```

#### 4. Push в main → Lovable Cloud auto-apply

```bash
git add supabase/seed/mock_exams_variant_1.sql
git commit -m "TASK-2: replace created_by placeholder with Egor's UUID"
git push origin main
```

Lovable Cloud сам применит seed после deploy миграций. Время — 1-3 мин.

##### Validation после deploy

Lovable Studio → SQL Editor:

```sql
-- AC-3: 26 задач в варианте
SELECT COUNT(*) FROM public.mock_exam_variant_tasks
WHERE variant_id = '36cebc45-e2e8-5603-a753-01c818bba131';
-- Expected: 26

-- Все 20 ответов Части 1
SELECT COUNT(*) FROM public.mock_exam_variant_tasks
WHERE variant_id = '36cebc45-e2e8-5603-a753-01c818bba131'
  AND part = 1 AND correct_answer IS NOT NULL;
-- Expected: 20

-- Все 6 решений Части 2
SELECT COUNT(*) FROM public.mock_exam_variant_tasks
WHERE variant_id = '36cebc45-e2e8-5603-a753-01c818bba131'
  AND part = 2 AND solution_text IS NOT NULL;
-- Expected: 6

-- Score totals
SELECT total_max_score, part1_max, part2_max, task_count
FROM public.mock_exam_variants
WHERE id = '36cebc45-e2e8-5603-a753-01c818bba131';
-- Expected: 45 | 28 | 17 | 26
```

#### 5. Включить feature flag для Егора

Lovable Studio → SQL Editor:

```sql
UPDATE public.tutors
SET feature_mock_exams_enabled = true
WHERE user_id = '<egor-uuid-here>';

-- Verify
SELECT t.name, t.feature_mock_exams_enabled
FROM public.tutors t
WHERE t.feature_mock_exams_enabled = true;
-- Expected: 1 row, Егор
```

После этого Егор увидит «Пробники» в SideNav на `/tutor/*` routes (frontend deploy через Lovable preview уже произошёл при предыдущих push). На `sokratai.ru` Егор увидит фичу только после `deploy-sokratai`, **но** этот deploy не нужен для TASK-2 — нужен будет когда landed TASK-7..15 frontend (если ещё не задеплоен).

После 3-4 часов QA Егора без багов — повторить step 5 для остальных 3 пилотных tutors:

```sql
UPDATE public.tutors
SET feature_mock_exams_enabled = true
WHERE user_id IN ('<tutor-2-uuid>', '<tutor-3-uuid>', '<tutor-4-uuid>');
```

### Promo template для Lovable Cloud chat (если хочешь делегировать AI агенту в Lovable)

Если в Lovable Cloud Studio есть AI-чат для управления Storage/SQL — следующий промпт можно вставить туда. Прикрепить файлы из «Files to attach» секции ниже.

```text
Я выполняю operational tail для TASK-2 mock-exams-v1. Schema migrations
20260508120000 + 20260508120100 уже применены, seed
supabase/seed/mock_exams_variant_1.sql готов к apply (созданное content
review 2026-05-07 — 26 задач, score totals 45=28+17).

Что нужно сделать:

1. Проверить что в Storage есть 4 buckets:
   mock-exam-variant-tasks (private), mock-exam-blanks (private),
   mock-exam-part2-photos (private), mock-exam-blank-templates (public).
   Если нет — создать с правильным public флагом.

2. Я загружу через UI 13 PNG в mock-exam-variant-tasks/variant1/
   (после моей локальной WMF→PNG конвертации 11 файлов из raw-images/;
   image8 и image15 уже PNG — заливать как есть) и 1 PDF
   (Бланк_заполнения_ЕГЭ-2025.pdf) в
   mock-exam-blank-templates/ege-physics-2025.pdf.

3. Найти Egor's auth.users.id по email <egor-email> и подсказать
   мне как заменить (SELECT id FROM auth.users ORDER BY created_at LIMIT 1)
   placeholder в supabase/seed/mock_exams_variant_1.sql на этот UUID.

4. После моего push в main и apply seed через Lovable auto-deploy —
   запустить validation queries из storage-upload-checklist.md §6
   (count = 26, part1_max = 28, part2_max = 17, total_max_score = 45).

5. UPDATE tutors SET feature_mock_exams_enabled = true WHERE user_id = '<egor-uuid>'.
   Подтвердить что только 1 строка обновилась.

Источники правды:
- supabase/seed/mock_exams_variant_1.sql — что заинсертится
- docs/delivery/features/mock-exams-v1/source/storage-upload-checklist.md
  — детальная инструкция со списком файлов
- docs/delivery/features/mock-exams-v1/source/variant1-tasks.json —
  manually reviewed source of truth по содержанию

Не трогай существующую table tutor_student_mock_exams (старая
MockExam, deprecated по TASK-17). Не редактируй variant1-tasks.json —
он уже выверен. Не запускай scripts/enhance-mock-exam-with-latex.py —
он deprecated.
```

#### Files to attach к Lovable AI prompt

Если AI-агент в Lovable принимает file attachments — прикрепи следующее:

| Файл | Зачем |
|---|---|
| `supabase/seed/mock_exams_variant_1.sql` | Сам seed; AI должен видеть что заинсертится + где placeholder |
| `supabase/migrations/20260508120000_mock_exams_v1_schema.sql` | Схема таблиц и RLS — AI поймёт контракт |
| `supabase/migrations/20260508120100_mock_exams_storage_buckets.sql` | Bucket setup — AI поймёт какие buckets ожидаются |
| `docs/delivery/features/mock-exams-v1/source/storage-upload-checklist.md` | Полный пошаговый чеклист (§3 список файлов, §6 validation queries) |
| `docs/delivery/features/mock-exams-v1/source/variant1-tasks.json` | Source of truth для содержания (на случай если AI спросит про content) |
| `docs/delivery/features/mock-exams-v1/source/raw-images/` (папка) | Если AI поддерживает folder upload — Vladimir заливает после локальной WMF→PNG конвертации |
| `Бланк_заполнения_ЕГЭ-2025__4j4x5.pdf` (из Downloads) | Файл бланка — Vladimir прикрепляет напрямую для upload в bucket |

**Не прикреплять:**
- `scripts/enhance-mock-exam-with-latex.py` — deprecated, может сбить с толку
- `Тр_вариант 1.docx` — Egor's IP, не нужен для apply (только для re-parse)
- raw-images WMF/EMF — нужны только PNG-конвертированные

#### Rollback (если seed apply пошёл не так)

Если seed применился с ошибкой (FK violation на `created_by`, нарушение CHECK constraints, etc.):

```sql
-- В Lovable Studio SQL Editor:
DELETE FROM public.mock_exam_variant_tasks
WHERE variant_id = '36cebc45-e2e8-5603-a753-01c818bba131';

DELETE FROM public.mock_exam_variants
WHERE id = '36cebc45-e2e8-5603-a753-01c818bba131';

-- После — поправить seed.sql, push в main снова. Idempotent INSERT'ы
-- (ON CONFLICT DO NOTHING) сами обработают повторный apply.
```

Storage uploads — НЕ откатывать; они referenced только в seed строках, удалить можно отдельно через UI если нужно.

### Известные limitations парсинга (флагнуты в review.md + README)

- ~~OMML/WMF math теряется~~ **Закрыто:** Codex вручную сверил docx и дописал LaTeX в `variant1-tasks.json` / `variant1-review.md` для KIM 1, 12, 14, 16, 17, 21–26
- Layout anomaly tasks 4/7 (маркер kim ПОСЛЕ тела задачи в docx) — подтверждено, source-привязка корректна
- WMF/EMF не рендерятся в браузере — 11 из 13 upload-файлов требуют PNG-конвертации; inline formula images и warning icons не загружаются как task images
- Part 2 max_score из docx criteria: 21=3, 22=2, 23=2, 24=3, 25=3, 26=4; variant total = 45 (28 + 17)
- `created_by` placeholder в seed.sql `(SELECT id FROM auth.users ORDER BY created_at LIMIT 1)` — заменить на UUID Егора

### Validation после apply

```sql
SELECT COUNT(*) FROM public.mock_exam_variant_tasks
WHERE variant_id = '36cebc45-e2e8-5603-a753-01c818bba131';
-- Expected: 26
```

Полный validation block — в `docs/delivery/features/mock-exams-v1/source/storage-upload-checklist.md` §6.

**Guardrails:** не редактировать `supabase/seed/mock_exams_variant_1.sql` напрямую — это generated artifact. При правках содержания → править `variant1-tasks.json`, пересобирать через build-mock-exam-seed.py. Bucket `mock-exam-variant-tasks` = default fallback в `parseStorageRef` (TASK-6, см. CLAUDE.md §10/§11). Не путать с `mock-exam-blanks` (private, фото бланков от ученика — TASK-12) и с `mock-exam-blank-templates` (public, PDF templates).

---

## TASK-3: Tutor API endpoints — ✅ Done (2026-05-07)

**Job:** R1, R4
**Agent:** Claude Code
**Files:**
- `supabase/functions/mock-exam-tutor-api/index.ts` (новый)
- `src/lib/mockExamApi.ts` (новый client)
- `src/types/mockExam.ts` (новый, **не путать** с existing `types/tutor.ts::MockExam`)

**AC:** AC-1 ✓, AC-5 ✓

**Depends on:** TASK-1

**Шаги:**
1. Endpoints: `POST /assignments` (create), `GET /assignments` (list), `GET /assignments/:id` (detail с attempts), `GET /attempts/:id`, `POST /attempts/:id/approve-task`, `POST /attempts/:id/approve-all`, `POST /assignments/:id/invite-link`
2. Auth: JWT-required, ownership checks через `tutor_id = auth.uid()`
3. Approve-all: enforce «все 6 задач Части 2 закрыты + Part 1 завершён» перед status → `approved`
4. Invite-link: генерирует 8-char slug, INSERT в `mock_exam_public_links` со scope=`invite`
5. TS-клиент в `src/lib/mockExamApi.ts` (типизирован, без `any`)

**Guardrails:** НЕ запутывать с existing `tutorHomeworkApi.ts` — отдельный файл `mockExamApi.ts`. Hardcoded URL `https://api.sokratai.ru` (см. CLAUDE.md «Network & Infrastructure»).

### Implementation notes (для TASK-8/9/10/11 frontend и follow-up agents)

**Wire-level routing:** Entrypoint Supabase — `/functions/v1/mock-exam-tutor-api/...`. Полный URL: `https://api.sokratai.ru/functions/v1/mock-exam-tutor-api/{path}`.

**Per-tutor feature flag (AC-8):** Каждый запрос проходит `ensureMockExamFlagEnabled()`. Tutor с `feature_mock_exams_enabled=false` получает **404 NOT_FOUND**, не 403 — намеренно, чтобы не утечь существование фичи. SideNav (TASK-7) самостоятельно прячет entry на основе того же поля. При расширении фичи сохранять этот контракт.

**Имена типов (анти-конфликт):** Все экспорты из `src/types/mockExam.ts` начинаются с `MockExamAssignment*` / `MockExamAttempt*` / `MockExamPart2Draft` — НЕ просто `MockExam` (этот идентификатор занят `types/tutor.ts::MockExam`, который удалится только в TASK-17). Не трогать legacy тип до TASK-17.

**Approve-task семантика:** `status` определяется так:
- `tutor_modified` если `tutor_score !== ai_draft.suggested_score` ИЛИ непустой `comment` — фиксируем «правка»
- `tutor_approved` иначе — «согласен с AI»

При отсутствии `ai_draft_json` (AI не отработал / упал) tutor может всё равно approve — `aiSuggested === null` → попадаем в `tutor_modified` если comment непустой, иначе `tutor_approved`. Frontend (TASK-11) **не должен** блокировать approve по отсутствию AI draft.

**Approve-all enforcement:** возвращает 400 `TASKS_NOT_READY` с `details.missing_kim_numbers` + `details.not_approved_kim_numbers`. Frontend (TASK-11) рендерит inline список «не закрыты: 22, 24» как actionable list, не toast. Approve-all дополнительно блокируется при `attempt.status === 'in_progress'` (NOT_SUBMITTED 400) — ученик ещё решает.

**Cascade delivery (best-effort):** `notifyStudentApproved` идёт push → telegram, **email не реализован** в этом таске (placeholder `failed_reason: 'no_channels_available'` если оба канала пусты). Email cascade — отдельный follow-up. Отсутствие email канала **НЕ** блокирует approve-all — операция всегда успешна, delivery summary информационный.

**Anonymous attempts** возвращают `failed_reason: 'anonymous_attempt'` — публичные lead'ы получают результат через `mock-exam-public::GET /share/mock-result/:slug` (TASK-6 завершён), не push.

**Manual_entry create:** при failure attempt insert происходит rollback assignment'а (best-effort `delete .eq('id', ...)`). При параллельных collision на UNIQUE `(assignment_id, student_id)` — 500 DB_ERROR с `details.detail` от Postgres. Frontend (TASK-9 wizard) валидирует student_id одного на manual_entry.

**Variant lookup:** `getOwnedAttemptOrThrow` возвращает `{attempt, assignment}`. Variant'ы загружаются отдельным roundtrip — не пытайся объединить через PostgREST embed (assignment.variant_id может быть NULL для manual_entry, embed-syntax с FK создаёт проблемы).

**Invite-link создаётся с `scope='invite'`** в `mock_exam_public_links` — public endpoint `mock-exam-public` уже его читает (TASK-6). При расширении на `parent_result` создавать отдельный handler — см. TASK-6 implementation notes «Parent_result link creation endpoint — пока не существует».

---

## TASK-4: Student API endpoints + auto-save — ✅ Done (2026-05-07)

**Job:** S1, R4
**Agent:** Claude Code
**Files:**
- `supabase/functions/mock-exam-student-api/index.ts` (новый, отдельный от tutor-api — feature flag не применяется к ученикам)
- `src/lib/mockExamPart1Checker.ts` (новый, pure functions)
- `src/lib/studentMockExamApi.ts` (новый client)
- `src/components/student/useMockExamAutoSave.ts` (новый hook)
- `scripts/test-mockexam-checker.mjs` (node:test runner через esbuild)

**AC:** AC-2 ✓ (state persistence), AC-3 ✓ (Part 1 deterministic check), AC-4 partial (submit enqueues mock-exam-grade — TASK-5 сам ещё не реализован)

**Depends on:** TASK-1

**Шаги:**
1. Endpoints: `GET /student/:id` (assignment + variant), `POST /attempts/:id/start`, `PATCH /attempts/:id/answer` (auto-save Part 1, debounced на client side), `POST /attempts/:id/photo` (Part 2 photo upload to Storage), `POST /attempts/:id/submit` (final, triggers AI grading)
2. Submit logic: подсчёт `total_part1_score` через deterministic checker (5 типов), создание pending записей в `mock_exam_attempt_part2_solutions` со status=`awaiting_review` (без AI draft), enqueue background job для AI grader
3. Deterministic checker: `src/lib/mockExamPart1Checker.ts` — pure functions для 5 check_mode типов (strict, ordered, unordered, multi_choice, task20, pair). Покрыть unit-тестами против seeded variant.
4. State персистенс: каждое изменение answer → debounced 500ms `PATCH` в DB + localStorage backup на client

**Guardrails:** auto-save должен NEVER потерять данные ученика во время 4-час экзамена — это #1 риск из nuances doc. localStorage backup обязателен.

### Implementation notes (для TASK-5 grader, TASK-12 student exam page, follow-up agents)

**Anti-leak invariant (КРИТИЧНО, mirror TASK-6 contract):** `GET /student/:id` SELECT'ит `id, kim_number, part, order_num, task_text, task_image_url, check_mode, max_score, topic`. **Никогда** не добавлять `correct_answer`, `solution_text`, `rubric_text`, `rubric_image_urls`, `ai_draft_json`. Тип `StudentMockExamVariantTask` в `studentMockExamApi.ts` это compile-time enforce'ит. При расширении endpoint'а: новое поле — explicit decision, default tutor-only.

**Deterministic checker — single source of truth:** `src/lib/mockExamPart1Checker.ts` для browser preview + Deno-mirror inline в `supabase/functions/mock-exam-student-api/index.ts` (Deno edge functions не могут импортировать `../../src/`). Любое изменение логики ОБЯЗАНО править оба файла синхронно. Unit-тесты `scripts/test-mockexam-checker.mjs` покрывают только `.ts` версию — Deno mirror проверяется ручным smoke на реальном seed.

**Test harness:** `node scripts/test-mockexam-checker.mjs` использует `esbuild.transformSync` + `data:` URL import + `node:test` (built-in). Не требует vitest / jest. При расширении checker'а — добавить test в тот же файл, формат `test("description", () => {...})` с `assert.equal(...)`.

**Check modes — фактическая семантика (расходится с упрощённой spec):**
- `strict` — числовое сравнение first (запятая ↔ точка, trailing zeros, fp tolerance `max(0.01, |expected|*0.01)`); fallback на case-insensitive string match.
- `ordered` — `split(',')` + точный порядок.
- `unordered` — multiset equality после сортировки.
- `multi_choice` — set equality, ученик может ввести "13" / "1,3" / "1 3" / "31" — все эквивалентны (digit-string → split per char, иначе split по `,;`).
- `task20` — digits-only after strip whitespace/punctuation; точный матч строки.
- `pair` — value+unit через `;` или whitespace; numeric tolerance к value, normalized whitespace+lowercase к unit.
- `manual` — Часть 2, всегда возвращает `{earned: 0, correct: false}` при попытке прохода через checker (defensive).

**Auto-save hybrid (AC-2):**
- Каждый keystroke → IMMEDIATELY sync write в `localStorage:sokrat-mock-exam-autosave:{attemptId}` (JSON map kim → `{answer, queuedAt}`). Это hard requirement: если браузер упадёт через 1ms, ответ уже на диске.
- Затем дебаунс 500ms → `PATCH /attempts/:id/answer`. На успех — `delete queue[kim]` и обновление `localStorage`.
- На failure (network) → keep in queue, `setIsOffline(true)`. На `online` event — `flushAllInternal()` после 200ms задержки.
- Race guard: если новый keystroke пришёл во время in-flight save (queuedAt поменялся) — после save schedule немедленный re-save, **не** удалять queue entry.
- На mount: `serverKnownRef = fromDb`, merge с localStorage queue (queue wins для unsaved). Если есть un-flushed drafts — async flush через 200ms после first paint.
- Cycle break: `persistKim ↔ scheduleSave` развязаны через `persistRef` (mutable ref, обновляется на каждом render'е где `persistKim` пересоздаётся). Без этого — eslint react-hooks warning + unbounded re-render risk.

**`flush()` exposed для pre-submit sync** — TASK-12 frontend ОБЯЗАН вызвать `await flush()` перед `submitMockExamAttempt()`, иначе in-flight debounce может не успеть и Submit запустит checker по stale data в БД. Возвращает `{ flushed, failed }`.

**Photo upload contract:**
- `multipart/form-data` с полями `file` (File), `kind` (`'part2'|'blank'`), `kim_number` (только для `part2`).
- Лимит 10 МБ, MIME whitelist: `image/jpeg|jpg|png|webp|heic|heif`.
- Storage path `part2`: `{studentId}/{attemptId}/{kim}/{uuid}.{ext}` в bucket `mock-exam-part2-photos`. Storage path `blank`: `{studentId}/{attemptId}/blank-{uuid}.{ext}` в bucket `mock-exam-blanks`.
- Response содержит **proxy-rewritten** signed URL (RU bypass) — frontend может сразу `<img src>`. Storage ref сохраняется в БД (`photo_url` для part2, `blank_photo_url` для blank).
- НЕТ delete endpoint'а в этом таске — повторный upload upsert'ит row, старый blob становится orphan. Cleanup отложен; для пилота допустимо.

**Submit semantics:**
- Read all variant tasks server-side (с `correct_answer` через service_role — RLS обходит).
- Run deterministic checker для каждой Часть-1 задачи; bulk upsert `mock_exam_attempt_part1_answers` с `earned_score`. Это **single source of truth** для Part 1 score. Auto-save endpoint оставляет `earned_score = NULL` намеренно — score рассчитывается только на submit.
- Для каждого Часть-2 KIM, у которого нет row в `mock_exam_attempt_part2_solutions` (фото не загружено), INSERT placeholder со status='awaiting_review' + photo_url=NULL — чтобы AI grader (TASK-5) увидел всю шестёрку. Existing rows (с фото) не трогаем.
- `total_time_minutes` = `Math.max(1, round((now - started_at) / 60000))` — целые минуты, минимум 1.
- Status flips `in_progress → ai_checking`. Submit идемпотентен только для `in_progress`; повторный вызов на `ai_checking|awaiting_review|approved` → 409 NOT_IN_PROGRESS.
- Fire-and-forget call `mock-exam-grade` (TASK-5) с `Authorization: Bearer ${SERVICE_ROLE}`. Если функция не задеплоена — silent fail; tutor может вручную re-trigger через TASK-11 review surface (когда тот будет умет).

**`PATCH /answer` валидация:**
- `answer` принимает string (включая пустую — для clearing) или null.
- Лимит длины 5000 символов — защита от вставки PDF-text.
- 409 `NOT_IN_PROGRESS` если attempt уже submitted — frontend (TASK-12) должен disable input после `submit_at !== null`.

**Storage buckets** (требуют отдельной миграции / руками в Supabase Dashboard, **в данном TASK не создавались**):
- `mock-exam-part2-photos` — public-read OFF, write через service_role.
- `mock-exam-blanks` — public-read OFF, write через service_role.
- TASK-1 миграция `20260508120000_mock_exams_v1_schema.sql` создаёт только таблицы, **не** buckets. Перед smoke-тестом TASK-12 убедиться что buckets созданы.

**Wire-level routing:** Entrypoint Supabase — `/functions/v1/mock-exam-student-api/...`. Полный URL: `https://api.sokratai.ru/functions/v1/mock-exam-student-api/{path}`.

---

## TASK-5: AI Part 2 grader edge function — ✅ Done (2026-05-07)

**Job:** R1 (AI помогает, не финализирует)
**Agent:** Claude Code (с тщательным prompt engineering)
**Files:**
- `supabase/functions/mock-exam-grade/index.ts` (новый)
- `supabase/functions/_shared/mock-exam-prompts.ts` (новый, prompt каркас)

**AC:** AC-4

**Depends on:** TASK-1, TASK-2 (seed нужен для тестов)

**Шаги:**
1. Background job triggered after submit: для каждого из 6 задач Части 2 → call multimodal AI (gemini-2.5-pro или gpt-4o) с prompt из `mock-exam-prompts.ts`
2. **Упрощённый prompt** (Phase 1, по решению Vladimir): 4 элемента I/II/III/IV без deep parsing 208-стр методички. Спец-правило для №21 (3-балльная блок-схема).
3. Structured JSON output: `{suggested_score, confidence: 'high'|'medium'|'low', elements_check: {I,II,III,IV: bool}, comment_for_tutor, flags: ['photo_unreadable'|...]}`
4. Сохранение в `mock_exam_attempt_part2_solutions.ai_draft_json`, status=`awaiting_review`
5. Push tutor (через existing cascade): «AI готов проверять Анну К.»

**Guardrails:** AI **никогда** не публикует ученику. Если photo unreadable / confidence='low' → suggested_score=null, flags заполнены, tutor видит «AI не смог». Не tutor approval = не публикуется. Использовать существующий `_shared/proxy-url.ts` для signed URL'ов фото.

### Implementation notes (для TASK-11 review surface и follow-up agents)

**Canonical contract** см. `CLAUDE.md` §12 «Mock Exams v1 — AI Part 2 grader». Здесь — quick reference для downstream tasks.

**Wire-level invocation:**
- Edge: `POST https://api.sokratai.ru/functions/v1/mock-exam-grade`
- Body: `{ "attempt_id": "<uuid>" }`
- Auth: либо `Bearer <SERVICE_ROLE>` (fire-and-forget из `mock-exam-student-api/handleSubmit`, уже работает после TASK-4), либо user JWT (student of attempt OR tutor of assignment) — для manual re-trigger из TASK-11.

**Response shape (frozen — counters only, NO draft contents):**
```json
{
  "attempt_id": "<uuid>",
  "status": "awaiting_review",
  "part2_task_count": 6,
  "drafts_persisted": 6,
  "drafts_failed": 0,
  "fallback_count": 1,
  "total_latency_ms": 28734,
  "tutor_notified": true
}
```

**JSON output shape для `ai_draft_json` в БД (frozen):**
```ts
{
  suggested_score: number | null,    // null когда photo missing/unreadable
  confidence: 'low' | 'medium' | 'high',
  elements_check: { I: bool, II: bool, III: bool, IV: bool },  // all-false для №21
  comment_for_tutor: string,         // ≤ 600 chars, tutor-only
  flags: string[]                    // ≤ 6, snake_case, ≤ 32 chars each
}
```
TypeScript mirror: `MockExamPart2Draft` в `src/types/mockExam.ts`.

**Hard anti-leak invariants:**
1. Endpoint response **никогда** не возвращает `ai_draft_json` / `suggested_score` / draft contents — только counters. TASK-11 (`TutorMockExamReview`) читает draft через `mock-exam-tutor-api::handleGetAttempt`. TASK-13 (`StudentMockExamResult`) **обязан** фильтровать `ai_draft_json` из student response (RLS allows SELECT, но product invariant запрещает leak до tutor approval).
2. `solution_text` из `mock_exam_variant_tasks` — **только** в system prompt server-side. Никогда в response.
3. AI **никогда** не публикует ученику — это product invariant. Tutor approval через `mock-exam-tutor-api::approve-task`/`approve-all` остаётся mandatory.

**State machine guards:**
- `submitted` → CAS-update в `ai_checking` (CAS guard `WHERE status='submitted'` от concurrent runners)
- `ai_checking` → process → CAS-update в `awaiting_review` (только из `ai_checking`/`submitted` чтобы не клобберить tutor approve)
- `approved`/`manually_entered` → 409
- `in_progress` → 400 NOT_SUBMITTED
- Re-run на `awaiting_review` идемпотентен; tutor-approved строки **не перезаписываются** (только `ai_draft_json` field обновляется).

**Phase 1 promprt simplification:**
- 4 элемента ФИПИ I-IV для №22-26: I (закон), II (обозначения), III (расчёт + подстановка), IV (ответ + единицы). Score = число выполненных элементов 0..max_score.
- Спец-правило для №21: 3-балльная qualitative rubric (см. `buildCriteriaBlock` в `_shared/mock-exam-prompts.ts`). Sanitizer форсит `elements_check = all-false` + flag `kim21_qualitative`. Tutor UI должен скрывать I-IV чекбоксы для №21.
- **Полный 208-стр разбор — Phase 2.** Phase 1 простой, ловит базовые ошибки + флагует unreadable photos.

**Photo handling:**
- `photo_url` в `mock_exam_attempt_part2_solutions` парсится через локальный `parsePhotoUrls` (dual-format: single ref OR JSON array).
- Server-to-server fetch обёрнут в `rewriteToDirect()` — US→US без Selectel proxy roundtrip (-200..400ms).
- `photo_url IS NULL` → fallback `no_photo`, score=null. Все inline failed → fallback `image_inline_failed`, score=null. AI returns `photo_*` flag → sanitizer форсит score=null, confidence=low.

**Latency budget:** 6 задач параллельно через `Promise.all`. Lovable timeout 35s + 1 retry на 5xx → bound ≈ 35s typical, 70s worst-case. Под AC-4 90s порог.

**Tutor notify:** best-effort Web Push на `assignment.tutor_id`. VAPID env missing → silent skip; не блокирует response.

**Validation:** smoke `curl -X POST $SUPABASE_URL/functions/v1/mock-exam-grade -H "Authorization: Bearer $SERVICE_ROLE_KEY" -d '{"attempt_id":"<uuid>"}'` → ожидаем `{ part2_task_count: 6, drafts_persisted: 6, total_latency_ms: <90000 }` + `ai_draft_json` populated для всех 6 строк в `mock_exam_attempt_part2_solutions`. Полная валидация требует TASK-2 seed apply + TASK-12 frontend (тестовый submit).

---

## TASK-6: Public anonymous endpoints (invite + result) — ✅ Done (2026-05-07)

**Job:** R3 (lead-gen), P1
**Agent:** Claude Code
**Files:**
- `supabase/functions/mock-exam-public/index.ts` (новый, паттерн как `public-homework-share`)

**AC:** AC-6, AC-7

**Depends on:** TASK-1

**Шаги:**
1. Endpoints (NO JWT, service_role): `GET /share/mock-invite/:slug` → tutor card + variant metadata; `POST /share/mock-invite/:slug/start` → создаёт anonymous attempt + lead capture (имя, контакт, consent_at); `GET /share/mock-result/:slug` → возвращает approved результат для parent или lead
2. Slug regex `/^[a-z0-9]{8}$/i` валидируется до DB query (см. паттерн в `public-homework-share`)
3. Expiry check: если `expires_at < now` → 410 expired
4. CORS `*`, OPTIONS preflight
5. Telemetry: `console.warn(JSON.stringify({event: 'mock_exam_invite_visited', slug, timestamp}))` — без PII

**Guardrails:** Anti-leak invariant как у `public-homework-share`: column whitelist на SELECT, никогда `select("*")`. Anonymous endpoint use service_role, обходит RLS — это намеренно.

### Implementation notes (для TASK-14/15 frontend и follow-up agents)

**Wire-level routing:** Edge function entrypoint у Supabase — `/functions/v1/mock-exam-public/share/...`. Полный URL для frontend клиента: `https://api.sokratai.ru/functions/v1/mock-exam-public/share/mock-invite/:slug`. Frontend route `/p/mock-invite/:slug` (см. spec §5) — это страница в `src/pages/PublicMockInvite.tsx` (TASK-14), **не** часть API path.

**Response shape contract** (заморожен — фронт TASK-14/15 строится поверх):

`GET /share/mock-invite/:slug` (200):
```ts
{
  expired: false,
  assignment: { id, title, mode },
  tutor: { name, avatar_url, bio, subjects } | null,
  variant: { title, exam_type, source, source_attribution,
             duration_minutes, total_max_score,
             part1_max, part2_max, task_count } | null,
  tasks: Array<{ id, kim_number, part, order_num, task_text,
                 task_image_url, check_mode, max_score }>,
  expires_at: string | null,
}
```
Поле `tasks[*].correct_answer` и `tasks[*].solution_text` **отсутствуют by design** — anonymous student не видит ответы до прохождения.

`POST /share/mock-invite/:slug/start` body:
```ts
{ lead_name: string, lead_contact: string,
  contact_type: 'telegram' | 'email',
  consent: true /* или consent_at: true | ISO-string */ }
```
Response 201: `{ attempt_id, anonymous_id }`.

`GET /share/mock-result/:slug`:
- 200 если `attempt.status ∈ {approved, manually_entered}` — payload содержит `tutor`, `assignment`, `variant`, `attempt`, `part1_answers`, `part2_solutions`. Для `manually_entered` массивы `part1_answers` / `part2_solutions` пустые by design (нет per-task разбора).
- 403 `{error: 'not_ready', status: <текущий>}` если status ≠ approved/manually_entered (AC-7).
- 410 `{expired: true, error: 'expired'}` если link просрочен.
- 404 `{error: 'not_found'}` если slug не найден / вне scope='parent_result'.

**Tutor card whitelist (HARD):** только `name, avatar_url, bio, subjects`. `loadTutorCard()` — single chokepoint. **Никогда** не добавлять `telegram_id`, `telegram_username`, `booking_link`, `id`, `user_id`, `email` в публичный payload — это leak. Если в будущем понадобится контакт tutor'а для CTA «связаться» — отдельный server-side notification flow (push/telegram tutor'у), не client-side raw поле.

**Storage buckets** (все созданы миграцией `20260508120100_mock_exams_storage_buckets.sql`, TASK-2):
- `mock-exam-variant-tasks` (private, variant task images, default fallback в parseStorageRef)
- `mock-exam-part2-photos` (private, Part 2 student photos)
- `mock-exam-blanks` (private, фото заполненного бланка от ученика — бланк-режим)
- `mock-exam-blank-templates` (public, PDF templates бланка ФИПИ для скачивания)

Если seed (TASK-2) использует другой bucket для variant task images — `parseStorageRef` извлекает bucket из `storage://bucket/path` ref, default используется только для bare paths.

**Parent_result link creation endpoint — пока не существует.** TASK-3 `mock-exam-tutor-api` создаёт только `scope='invite'` ссылки. Когда понадобится parent share после approval — добавлять отдельный handler `POST /attempts/:id/parent-share-link` в `mock-exam-tutor-api` (та же 8-char slug logic + retry-on-collision). Endpoint `mock-exam-public` уже умеет читать `scope='parent_result'`, ждёт producer'а.

**Telemetry events** (server-side `console.warn` JSON):
- `mock_exam_invite_visited` / `mock_exam_invite_visited_expired`
- `mock_exam_invite_started` (с `contact_type` only)
- `mock_exam_invite_start_expired`
- `mock_exam_result_visited` (с `status`)
- `mock_exam_result_visited_not_ready` (с `status`)
- `mock_exam_result_visited_expired`

Slug — единственный correlation key. **Никогда** не логировать `lead_name`, `lead_contact`, IP, user_id.

---

## TASK-7: Routes + sidebar entry с per-tutor feature flag — ✅ Done (2026-05-07)

**Job:** R1
**Agent:** Claude Code
**Files:**
- `src/App.tsx` (8 lazy imports + 8 routes)
- `src/components/tutor/chrome/SideNav.tsx` (вкладка «Пробники» с conditional render)

**AC:** AC-8

**Depends on:** TASK-1 (для feature flag column в БД)

**Шаги:**
1. App.tsx: добавить routes `/tutor/mock-exams`, `/tutor/mock-exams/new`, `/tutor/mock-exams/:id`, `/tutor/mock-exams/:id/review/:studentId`, `/student/mock-exams/:id`, `/student/mock-exams/:id/result`, `/p/mock-invite/:slug`, `/p/mock-result/:slug`
2. Stub-страницы возвращают `<div>Mock Exams (preview)</div>` пока — реализация в TASK-8..15
3. SideNav.tsx: hook `useTutorMockExamsFeatureFlag()` читает `tutors.feature_mock_exams_enabled` через React Query; если true — добавляем `{ href: '/tutor/mock-exams', icon: ClipboardCheck, label: 'Пробники' }` в группу «Работа»
4. Пометить allowlist 4 пилотных tutors через UPDATE в SQL после миграции (manual step)

**Guardrails:** **Не использовать env-flag** как раньше (был VITE_FEATURE_MOCK_EXAMS_PREVIEW). Per-tutor flag в БД даёт granular control + защиту от «4 разом ловят баг» (см. nuances #6).

### Implementation notes (для TASK-8..15 frontend и follow-up agents)

**Changed files:**
- `src/App.tsx`
- `src/components/tutor/chrome/SideNav.tsx`
- `src/hooks/useTutorMockExamsFeatureFlag.ts`
- `src/pages/tutor/mock-exams/MockExamFeatureGate.tsx`
- `src/pages/tutor/mock-exams/TutorMockExams.tsx`
- `src/pages/tutor/mock-exams/TutorMockExamCreate.tsx`
- `src/pages/tutor/mock-exams/TutorMockExamDetail.tsx`
- `src/pages/tutor/mock-exams/TutorMockExamReview.tsx`
- `src/pages/student/StudentMockExam.tsx`
- `src/pages/student/StudentMockExamResult.tsx`
- `src/pages/PublicMockInvite.tsx`
- `src/pages/PublicMockResult.tsx`
- `scripts/smoke-check.mjs` (только smoke guardrail: regex вместо brittle exact string для `intended_role: "tutor"`)

**Route skeleton landed:**
- Tutor nested inside AppFrame: `/tutor/mock-exams`, `/tutor/mock-exams/new`, `/tutor/mock-exams/:id`, `/tutor/mock-exams/:id/review/:studentId`
- Student top-level: `/student/mock-exams/:id`, `/student/mock-exams/:id/result`
- Public top-level: `/p/mock-invite/:slug`, `/p/mock-result/:slug`

**Feature flag contract:** `useTutorMockExamsFeatureFlag()` uses React Query key `['tutor', 'feature-flags']` and reads only `tutors.feature_mock_exams_enabled` for the current `user_id`. `SideNav` appends `Пробники` with `ClipboardCheck` to group `Работа` only when the flag is `true`.

**Direct URL behavior:** tutor mock-exam stubs are wrapped in `MockExamFeatureGate`. When `feature_mock_exams_enabled !== true`, the page redirects to `/tutor/home` per TASK-7 page-guardrail. This satisfies the security intent of AC-8 (no visible nav + no direct access). If product later requires a literal 404 instead of redirect, change `MockExamFeatureGate` only.

**Validation:**
- `npm run build` — passed.
- `npm run smoke-check` — passed. Existing non-blocking warnings remain: `100vh` in `src/styles/tutor-chrome.css`, and legacy small input font-size warnings in older files.

**Intentionally not modified:** `AuthGuard.tsx`, `TutorGuard.tsx`, `Chat.tsx`, `TutorSchedule.tsx`, `supabase/functions/telegram-bot/**`, and TASK-8..15 real page implementations.

---

## TASK-8: TutorMockExams (list page) — ✅ Done (2026-05-07)

**Job:** R1
**Agent:** Claude Code
**Files:**
- `src/pages/tutor/mock-exams/TutorMockExams.tsx` (rewritten from 11-line stub → marketing-ready 376 lines)
- `src/hooks/useMockExamAssignments.ts` (new — React Query hook со стандартными `tutorQueryOptions`)

**AC:** AC-1 ✓ (entry point — tutor видит список mock-exams со статистикой)

**Depends on:** TASK-3 ✓, TASK-7 ✓

**Шаги:**
1. Точка входа `/tutor/mock-exams`: header «Пробники» с `ClipboardCheck` icon + subtitle + CTA `+ Назначить пробник` → `/tutor/mock-exams/new`
2. Бета-баннер амбер с `Info` icon: «Часть 1 (1–20) — автопроверка ФИПИ. Часть 2 (21–26) — AI-черновик с tutor approval. ОГЭ и доп. варианты — следующая итерация»
3. Список assignments через `useMockExamAssignments()` (query key `['tutor', 'mock-exams', 'assignments']`); AssignmentCard `React.memo`
4. KPI per card: Учеников · Сдали (accent при > 0) · В процессе (amber) · Требует проверки (amber). 4 cells вместо 5 — backend list endpoint не возвращает `avg_score`
5. Empty state с `ClipboardCheck` icon + CTA «Назначь первый пробник»
6. Library section «Готовые варианты в библиотеке» — Тренировочный 1 (active, accent border, link → `/tutor/mock-exams/new`) + ФИПИ-2026 (disabled placeholder)

**Implementation notes:**
- AssignmentCard mode badges: `blank` → «С бланком», `form` → «Форма», `manual_entry` → «Внесён вручную»
- Status config (draft/active/closed → Черновик/Активное/Завершено) с slate/emerald/slate palette
- Variant library hardcoded в файле (Phase 1 = 1 variant). При расширении — заменить на API fetch (требует нового endpoint `GET /variants`)
- Mobile-responsive: KPI grid `grid-cols-2 sm:grid-cols-3 md:grid-cols-4`, library `grid-cols-1 md:grid-cols-2`, header `flex-col sm:flex-row`

**Guardrails:** Lucide icons only (`ClipboardCheck`, `Plus`, `Clock`, `Info`, `ChevronRight`, `GraduationCap`, `FileText`, `Sparkles`). shadcn Card/Button/Badge/Skeleton. `transition-[box-shadow,border-color]` (не transition-all). `animate={false}` на Card в grid. `tabular-nums` на числах. Никаких emoji.

---

## TASK-9: TutorMockExamCreate (wizard) — ✅ Done (2026-05-07)

**Job:** R1, R3
**Agent:** Claude Code
**Files:** `src/pages/tutor/mock-exams/TutorMockExamCreate.tsx` (rewritten from 11-line stub → 599 lines, single-page wizard)

**AC:** AC-1 ✓ (assignment + N attempts created в БД через `createMockExamAssignment`)

**Depends on:** TASK-3 ✓, TASK-7 ✓

**Шаги:**
1. Single-page wizard, 4 секции с `StepSection` wrapper (eyebrow «Шаг N · Title»)
2. Шаг 1 «Вариант» — `VariantCard` для Тренировочный 1 (selected, accent border + accent/5 bg) + ФИПИ-2026 (disabled, opacity-60). Phase 2 note внизу
3. Шаг 2 «Режим» — 2 `ModeRadio`: `blank` default с «по умолчанию» badge / `form`. Description per option
4. Шаг 3 «Кому»: Groups секция (только при `mini_groups_enabled`) + Individuals scrollable list (`max-h-72 overflow-y-auto`). Group toggle расширяет/схлопывает active members в `selectedStudentIds`. Counter «Выбрано: N учеников» с pluralStudents helper
5. Шаг 4 «Название и дедлайн» — `Input` title (text-base, maxLength 200) + `Input type="datetime-local"` deadline (native picker, ISO output)
6. Опц. lead-link — dashed-border Card с Checkbox + Link2 icon: при `createLeadLink=true` после submit вызывает `createMockExamInviteLink` + clipboard copy с execCommand fallback (rule 80)
7. Action bar — Sticky bottom on mobile (`sticky bottom-0 -mx-4 sm:mx-0`), `flex-col-reverse sm:flex-row`. Dynamic CTA: «Выбери учеников» (disabled) / «Назначить пробник N ученикам» / `Loader2` + «Назначаем…»

**Implementation notes:**
- Variant catalogue hardcoded (Phase 1 = 1 variant). При расширении — заменить на API fetch.
- Submit pipeline:
  1. `parseDeadlineInput()` валидирует через `parseISO` + `isValid` + проверка не в прошлом → throws human-readable Error → toast.error
  2. `createMockExamAssignment({ variant_id, title, mode, deadline, student_ids })` → `assignment_id`
  3. Если `createLeadLink`: `createMockExamInviteLink(assignmentId, {})` → `tryCopyLink(url)` → toast с url
  4. `navigate('/tutor/mock-exams/:id', { replace: true })` — replace чтобы back button не возвращал в wizard
- Group → student_id resolution через `studentIdByTutorStudentId` Map (тип-safe, активные members only)
- `pluralStudents()` helper для русского склонения (1 ученику / 2-4 ученикам / 5+ учеников)
- `tryCopyLink()` mirror`ит pattern из `HWAssignSection.handleCopyInviteLink` (Async Clipboard primary + execCommand fallback)
- `isValidForSubmit` derived: `!isSubmitting && trimmedTitle.length > 0 && studentIds.length > 0 && Boolean(variantId)`

**Guardrails:**
- Lucide icons only (`ArrowLeft`, `Check`, `GraduationCap`, `Link2`, `Loader2`, `Users` — 6 штук)
- shadcn Card/Button/Badge/Input/Label/Checkbox/Skeleton
- `text-base` (16px) на title и deadline inputs (iOS Safari auto-zoom prevention, rule 80)
- `parseISO` из date-fns (не нативный `new Date(string)`)
- `accent-accent` на native `<input type="radio">` для Sokrat green
- `React.memo` на VariantCard / ModeRadio / RecipientRow
- Mobile-responsive: `max-w-4xl mx-auto`, sticky action bar, scrollable recipients list

**Deviations от mockup (осознанные):**
- Title input не показан в mockup, но требуется API → добавлен в Step 4 рядом с deadline
- Deadline через `<input type="datetime-local">` вместо текстового поля «14 мая 2026, 23:59» — native picker UX + ISO-output совместимый с parseISO
- Lead-link реализован как checkbox внутри wizard вместо отдельной button («Сгенерировать lead-link →» из mockup) — потому что invite-link требует assignment_id (которого ещё нет до submit). Checkbox создаёт ссылку синхронно с assignment

---

## TASK-10: TutorMockExamDetail (results dashboard with heatmap) — ✅ Done (2026-05-07)

**Job:** R1, R4
**Agent:** Claude Code
**Files:**
- `src/pages/tutor/mock-exams/TutorMockExamDetail.tsx` (новый)
- `src/components/tutor/mock-exams/MockExamHeatmap.tsx` (новый, паттерн из `HeatmapGrid`)

**AC:** AC-5

**Depends on:** TASK-3, TASK-7, TASK-8

**Шаги:**
1. Header с название + status badge + действия (напомнить всем, ссылка для родителей, экспорт)
2. KPI cards (5): Сдали, В процессе, Не приступали, Средний балл, Требует AI-проверки
3. Heatmap-table 5×26: students × tasks, sticky-первая колонка имени, разделитель Часть 1 / Часть 2, итоговые колонки
4. Cell colors по типу: `cell-correct` (полный балл), `cell-partial`, `cell-wrong`, `cell-empty`, `cell-draft` (AI-черновик неподтверждён), `cell-low-conf`
5. Click row → navigate в `/tutor/mock-exams/:id/review/:studentId`
6. AI-черновик амбер банер внизу: «оценки скрыты от учеников до approval»

**Guardrails:** **Critical**: используй `border-separate border-spacing-0` + `<colgroup>` + `width: max-content` для горизонтального скролла (см. cross-browser rule про sticky+border-collapse). `touch-pan-x` на wrapping div. `React.memo` на row компоненты (260 ячеек = lag без memo).

**Implementation notes (2026-05-07):**
- Делегирована canonical палитра в `src/components/tutor/mock-exams/mockHeatmapStyles.ts` (single source of truth для 6 cell kinds + totals colors). Не дублировать в TASK-11.
- Heatmap layout: 220px sticky name + 20×34px (Часть 1) + 12px spacer + 6×46px (Часть 2) + 80px×3 (Часть 1 итого / Часть 2 итого / Итого), grand total ≈ 1428px.
- **Phase 1 ограничение:** `handleGetAssignment` возвращает только attempt-level totals — per-task scores (cell-by-cell) не hydrate'ятся. Все 26 task-клеток рендерятся как `cell-empty`; Часть 2 для `awaiting_review`/`submitted` форсится в `cell-draft` для визуального сигнала. Полная per-task hydration — Phase 2 (потребует extension `handleGetAssignment` или batch-endpoint).
- `part1_max` / `part2_max` hardcoded = 28/17 (ЕГЭ физика). Когда backend начнёт возвращать explicit поля — заменить.
- Sort priority: `awaiting_review (0) → submitted (1) → in_progress (2) → approved (3) → manually_entered (4) → not_started (5)`, alphabetical fallback.
- Anonymous attempts: row clickable, navigate'ит на `:studentId = anonymous_id` — review surface (TASK-11) ресолвит через тот же match.

См. CLAUDE.md §13 для полного контракта.

---

## TASK-11: TutorMockExamReview (review surface с per-task approve) — ✅ Done (2026-05-07)

**Job:** R4
**Agent:** Claude Code
**Files:** `src/pages/tutor/mock-exams/TutorMockExamReview.tsx` (новый)

**AC:** AC-5

**Depends on:** TASK-3, TASK-7, TASK-10

**Шаги:**
1. Header: ученик + время сдачи + первичный балл (черновик)
2. Часть 1 summary card (auto-graded, не редактируется в Phase 1)
3. Часть 2 cards (6 шт): для каждого — условие, фото решения, AI-draft с 4 элементами I-IV галочки/крестики, suggested score, confidence chip, comment AI, кнопки «Изменить балл / Подтвердить»
4. Per-task approve через `POST /attempts/:id/approve-task`, обновляет status задачи `tutor_approved`
5. Sticky-feel footer: counter «Подтверждено N/6» + global «Подтвердить и отправить ученику» (disabled пока не закрыты все)
6. Anonymous attempts (lead) — без bulk approve кнопки (см. nuances #2)
7. Low-confidence карточки имеют `border-rose-300` + явный alert «AI не смог распознать»

**Guardrails:** Score override — read-only с явным «Изменить» (см. nuances #3). Approve modal с подтверждением «после этого ученик и родители получат результат». No emoji. Reuse `MathText` для condition + comment если есть LaTeX.

**Implementation notes (2026-05-07):**
- Files: `src/pages/tutor/mock-exams/TutorMockExamReview.tsx`, `src/hooks/useMockExamAttempt.ts` (new).
- Resolution `:studentId` → attemptId: page сначала загружает assignment через `useMockExamAssignment`, затем match'ит attempt по `student_id === param || anonymous_id === param`. Mismatch → empty-state «Попытка не найдена».
- Per-task approve: quick-approve preselect AI suggestion («Подтвердить: {ai}/{max}») + «Изменить балл» (Pencil → modal с input 0..max + comment textarea, 16px font). Backend ставит `tutor_modified` если score != suggested ИЛИ comment, иначе `tutor_approved`.
- Global approve: AlertDialog confirmation перед `POST /approve-all`. Disabled пока N !== 6. На success — invalidate assignment + assignments list, toast с delivery channel, navigate back через 800ms.
- Anonymous lead (nuance #2): footer показывает amber «Анонимный лид» chip + «Bulk-approve недоступен. Проверь каждый пункт вручную.» Per-task approve работает как обычно — UI не предоставляет shortcut'ов.
- Reasoning visibility (nuance #1): 4 чипса I/II/III/IV из `ai_draft.elements_check` через Lucide Check/X. Confidence chip: high → emerald, medium → amber, low → rose.
- №21 (kim21_qualitative): UI скрывает I-IV чипсы, рендерит amber hint про 0..3 рубрику ФИПИ.
- Low-confidence (nuance #5): `confidence==='low'` или `ai_draft===null` → `border-2 border-rose-300` + rose alert «AI не смог распознать». `photo_url===null` → отдельный alert «Запроси переснимку у ученика».
- Read-only states: `attempt.status === 'approved' || 'manually_entered'` → footer заменяется на emerald «Работа подтверждена и отправлена», action row скрыт.
- LaTeX: `MathText` через `React.lazy()` + Suspense fallback для condition / AI comment / tutor comment.

См. CLAUDE.md §14 для полного контракта.

---

## TASK-12: StudentMockExam (taking surface) — ✅ Done (authenticated only, 2026-05-07)

**Job:** S1
**Agent:** Claude Code
**Files:** `src/pages/student/StudentMockExam.tsx` (1006 lines, mounted внутри `<AuthGuard>`)

**AC:** AC-2 (state persistence) — implementation complete, requires Vladimir smoke verify with seeded student.

**Depends on:** TASK-4, TASK-7

**Шаги:**
1. ✅ Layout: header с название + visual timer (countdown 3:55:00, не enforce); справочные данные (collapsible, sticky слева на desktop); список 26 задач
2. ✅ Бланк-режим (default): instruction banner «Распечатай PDF бланка» + публичная ссылка на `mock-exam-blank-templates/ege-physics-2025.pdf` (public bucket, anonymous read OK) + photo upload в `mock-exam-blanks/{studentId}/{attemptId}/blank-{uuid}.{ext}`
3. ✅ Form Часть 1 (1-20): поле ввода под `check_mode` каждой задачи (5 типов: number / pattern / 2 числа / etc.). `text-base` (16px) для iOS Safari.
4. ✅ Photo Часть 2 (21-26): 1 photo на задачу, retry кнопка, preview thumbnail
5. ✅ Auto-save: каждое изменение → debounced 500ms `PATCH /attempts/:id/answer` + localStorage backup (`useMockExamAutoSave` hook)
6. ✅ Submit: confirmation modal «время потрачено: Xмин» → `POST /attempts/:id/submit` → redirect /student/mock-exams/:id/result (TASK-13 surface)

**Authenticated-only caveat (review blocker #4):** page wrapped в `<AuthGuard>` — anonymous leads (через TASK-14 `PublicMockInvite`) НЕ могут попасть на эту surface. Anonymous taking flow остаётся **открытым follow-up** (см. project_mock_exams_v1.md known follow-ups). Phase 1 pilot работает только с invited authenticated students репетитора + manual entry для прошлых пробников. После TASK-14 review-fix (success-state вместо 404) anonymous lead передаёт контакт → tutor получает push (AC-6) → связывается напрямую — без захода ученика в taking surface. Полноценный anonymous taking flow — отдельный follow-up TASK когда будет нужен.

**Guardrails honored:** State loss защищён hybrid auto-save (localStorage write синхронно + debounced PATCH). Restore on mount: merge DB + queue (queue wins для unsaved). `flush()` перед submit предотвращает race с in-flight debounce. `React.lazy` MathText для KaTeX bundle.

**Pending Vladimir validation:** smoke test с seeded student после applies seed (`supabase/seed/mock_exams_variant_1.sql`) + 13 image uploads.

---

## TASK-13: StudentMockExamResult (Часть 1 immediate, Часть 2 after approval) — ✅ Done (2026-05-07)

**Job:** S1
**Agent:** Claude Code
**Files:**
- `src/pages/student/StudentMockExamResult.tsx` (новый)
- `src/hooks/useStudentMockExamResult.ts` (новый)
- `src/lib/studentMockExamApi.ts` (extended — `getStudentMockExamResult` + result types)
- `supabase/functions/mock-exam-student-api/index.ts` (extended — `handleGetResult` + new route `GET /student/:assignmentId/result`)

**AC:** AC-5 ✅

**Depends on:** TASK-4, TASK-7, TASK-12

**Шаги:**
1. Header: вариант + дата сдачи + время + tutor name ✅
2. Часть 1 card (always visible after submit): большой балл XX/28 + «показать таблицу 20 задач» (collapsible с CheckCircle2/XCircle per row, tabular-nums) ✅
3. Часть 2 card: state-driven рендер ✅
   - status `submitted` / `ai_checking` / `awaiting_review` → амбер карточка «Репетитор Х сейчас проверяет — результат придёт в Telegram в течение 24ч»
   - status `approved` → большой балл + per-task cards с условием + фото ученика + tutor comment + collapsible эталон
4. Финальный summary: первичный балл (когда approved) + бенчмарк-полоса по `variant.total_max_score` (anchors 40% порог / 66% хорошо) ✅
5. Manual entry mode: только totals + manual_comment ✅

**Guardrails (соблюдены):**
- AI never shown to student — `ai_draft_json` НИКОГДА не возвращается endpoint'ом, ни в одной стадии
- Status-driven гейтинг колоночного SELECT в backend: `correct_answer` revealed только post-submit; `tutor_score` / `tutor_comment` / `solution_text` revealed только при `status === 'approved'`
- React Query stale time 30s + `refetchOnWindowFocus`/`refetchOnReconnect: true` — push deep-link wakes the page → query refetches и approval surface'ится без race
- 409 NOT_SUBMITTED при `in_progress` → frontend redirect обратно на `/student/mock-exams/:id` (taking surface)
- Tutor card whitelist (`name`, `avatar_url`) — никаких telegram_id / telegram_username / booking_link / email
- Mobile-first `max-w-3xl`, touch-targets ≥ 44px, `MathText` lazy-loaded, images `loading="lazy"`

**Validation:** typecheck ✅ build ✅ smoke-check ✅ (без новых warnings).

---

## TASK-14: PublicMockInvite (anonymous start с lead capture) — ✅ Done (2026-05-07)

**Job:** R3, P1
**Agent:** Claude Code
**Files:**
- `src/pages/PublicMockInvite.tsx` (заменил 3-строчный stub)
- `src/lib/mockExamPublicApi.ts` (новый — anonymous API client с `fetchPublicMockInvite` + `startPublicMockInvite`)

**AC:** AC-6 ✅

**Depends on:** TASK-6, TASK-7

**Шаги:**
1. ✅ NO auth, NO TutorGuard — публичный route `/p/mock-invite/:slug` (App.tsx был уже wired)
2. ✅ Tutor card (`UserAvatar` + name + bio fallback на subjects); anti-leak whitelist уже в edge function
3. ✅ Offer block: variant title + 3 metrics grid (Время / Заданий / Стоимость=Бесплатно) + контракт «Часть 1 сразу, Часть 2 в 24ч»
4. ✅ Lead form: имя ребёнка + Telegram/email (`detectContactType` auto: содержит `@` → email, иначе telegram) + consent checkbox с ссылкой `/privacy-policy` (target=_blank)
5. ✅ POST → `mock_exam_anonymous_leads` row создан (AC-6 ✓); `attempt_id` + `anonymous_id` в `sessionStorage` под key `mock-exam-anon:<attempt_id>`; navigate → `/p/mock-attempt/:attempt_id` (placeholder route; TASK-12 anonymous mode wires up later)
6. ✅ Mobile-first: max-w-[640px], 16px text-base на inputs, min-h 48px CTA, min-h 44px checkbox label, `touch-action: manipulation`

**Guardrails honored:** branding tutor primary + «Через платформу Сократ AI» small print в footer (#11); privacy link `target="_blank" rel="noopener noreferrer"` (#7); 16px на inputs (iOS Safari auto-zoom prevention); discriminated-union API result type — graceful degrade на `expired` / `not_available` / `validation` / `error`.

**Validation:** lint clean; tsc clean; build green (`PublicMockInvite-DEPEFK6g.js` chunk emitted); browser-preview verified — POST hit правильный endpoint с правильным body, sessionStorage записан, redirect выполнен.

---

## TASK-15: PublicMockResult (parent share-link) — ✅ Done (2026-05-07)

**Job:** P1
**Agent:** Claude Code
**Files:**
- `src/pages/PublicMockResult.tsx` (заменил stub)
- `src/lib/mockExamPublicApi.ts` (расширен `fetchPublicMockResult` + типы `PublicMockResultData`/`PublicMockResultTutor`/`PublicMockResultPart1Answer`/`PublicMockResultPart2Solution`)

**AC:** AC-7 ✅

**Depends on:** TASK-6, TASK-7

**Шаги:**
1. ✅ Public route `/p/mock-result/:slug` без auth (App.tsx был уже wired)
2. ✅ Mobile-first 375px verified (no horizontal overflow; panel 343px; CTA min-h 48px; big number 48px → 60px on sm:)
3. ✅ Big primary score (`text-5xl sm:text-6xl`, aria-label) + preliminary test score (only `exam_type='ege_physics'` + `total_max_score===54` через `buildScaleConfig` helper — Phase 2 заменит lookup table) + `<div role="progressbar">` с canonical 0/22/36/54 thresholds (red < 22 → amber 22-36 → emerald ≥ 36)
4. ✅ Часть 1 / Часть 2 split (totals only)
5. ✅ Опц. tutor comment block (manual_entry → `attempt.manual_comment`); per-task drill-down `<details>` свёрнутый по умолчанию для approved (Часть 1 list с verdict-точками + Часть 2 cards с tutor_comment)
6. ✅ CTA «Написать репетитору в Telegram» — markdown link `<a href="https://t.me/${username}" target="_blank" rel="noopener noreferrer">` если backend выдал `tutor.telegram_username`. Иначе fallback ladder: booking_link → reassurance text. Имя в CTA не используется (избегаем русского genitive case)
7. ✅ Footer: «Через платформу **Сократ AI** · тестовый балл предварительный, окончательная шкала — после ЕГЭ-2026»

**Status states (AC-7):** 6 mutually exclusive — loading / error / invalid_slug / not_found / expired / **not_ready** (403 awaiting_review/submitted/ai_checking) / ok. Belt-and-suspenders client-side guard на `attempt.status not in {approved, manually_entered}` defense-in-depth.

**Guardrails honored:**
- Anti-leak (CLAUDE.md §10): `tutor.telegram_username` помечено optional в типе — backend не возвращает его сейчас (whitelist `name, avatar_url, bio, subjects`). UI gracefully degrades — будущая extension `loadTutorCard` для `scope='parent_result'` подключится без UI changes.
- Tutor comment heading намеренно без имени (русский genitive case 'Егора' / 'Анны' не reliably инфлектится из nominative)
- `parseISO` + `format(..., 'd MMMM yyyy', { locale: ru })` — Safari-safe per .claude/rules/80-cross-browser.md
- KaTeX lazy через `React.lazy` + Suspense (родители обычно не expand drill-down)

**Validation:** lint clean; tsc clean; build green (`PublicMockResult-FmsWEvTz.js` chunk emitted); browser-preview verified — approved physics result рендерится со всеми элементами; `not_ready` 403 mock → корректный UI «Результат ещё проверяется. Репетитор завершит проверку Части 2 в течение 24 часов»; mobile 375px без overflow.

---

# Phase 1 — P1 (Day 5+)

## TASK-16: Manual entry dialog «Добавить результат прошлого пробника»

**Job:** R1, R4 (бэкфилл истории)
**Agent:** Claude Code
**Files:**
- `src/components/tutor/mock-exams/AddManualMockExamDialog.tsx` (новый)
- `src/pages/tutor/mock-exams/TutorMockExams.tsx` (добавить кнопку)

**AC:** новый AC: «Tutor создаёт `mock_exam_assignments` с mode=`manual_entry` через диалог: ученик + вариант (free text) + дата + балл первичный → запись попадает в общую историю».

**Depends on:** TASK-3, TASK-8

**Шаги:**
1. Диалог: студент-селектор (reuse `useTutorStudents`), text input для variant_title, date picker, число первичного балла, опц. comment
2. `POST /assignments` с `mode='manual_entry'`, без deadline, без variant_id; backend создаёт сразу `attempt` со status='manually_entered', total_score=введённый балл
3. Кнопка «Добавить результат прошлого пробника» на `/tutor/mock-exams` (после wizard CTA) и на странице ученика

---

## TASK-17: Удаление старой `MockExam` сущности

**Job:** R1 (cleanup)
**Agent:** Claude Code
**Files:**
- `src/pages/tutor/TutorStudentProfile.tsx` (удалить блок `MockExamCard` + `AddMockExamDialog` + state + queries)
- `src/hooks/useTutor.ts` (удалить `useMockExams`)
- `src/lib/tutors.ts` (удалить `getMockExams`, `createMockExam`, `updateMockExam`, `deleteMockExam`)
- `src/types/tutor.ts` (удалить типы `MockExam`, `CreateMockExamInput`, `UpdateMockExamInput`)
- (опц) `supabase/migrations/{date}_drop_legacy_mock_exam.sql` — DROP TABLE `mock_exams` старая (если есть)

**AC:** новый AC: «после деплоя `npm run build && npm run smoke-check` проходит без TS-ошибок; на странице ученика блок MockExamCard отсутствует; новая секция История пробников видна (TASK-18)».

**Depends on:** TASK-16, TASK-18 (чтобы tutor не остался без UI вписать манул)

**Шаги:**
1. Grep по проекту: `grep -rn "MockExam" src/` → перечислить все references
2. Удалить блок в TutorStudentProfile.tsx (около `<MockExamCard ... onDelete=... />`)
3. Удалить `useMockExams` hook + связанные функции из tutors.ts + типы
4. Migration drop старой таблицы (опционально, не блокирует — таблица просто стоит пустая)
5. `grep -rn "MockExam"` после ≥0 совпадений ≠ типы/hook'и старой системы (новые `MockExamAssignment` etc допустимы)

**Guardrails:** Перед удалением grep, чтобы убедиться что новый код использует другое namespace (`MockExamAssignment` / `MockExamAttempt` etc.). Не сломать TutorStudentProfile.

---

## TASK-18: Секция «История пробников» на TutorStudentProfile

**Job:** R1, R4
**Agent:** Claude Code
**Files:** `src/pages/tutor/TutorStudentProfile.tsx`

**AC:** новый AC: «На `/tutor/students/:tutorStudentId` секция История пробников показывает все `mock_exam_attempts` (auto + manual_entry) этого ученика, сортировка по дате DESC».

**Depends on:** TASK-3, TASK-16

**Шаги:**
1. Заменить старый `MockExamCard` на `<StudentMockExamHistory studentId={...} />`
2. Hook `useStudentMockExamHistory(studentId)` — `GET /students/:id/mock-exam-attempts` (новый endpoint в TASK-3)
3. Список карточек: каждая — вариант, дата, балл, status (auto/manual), кнопка перейти в `TutorMockExamReview` (для auto) или открыть details modal (для manual)
4. CTA «+ Добавить прошлый пробник» в верху секции — открывает диалог из TASK-16

---

## TASK-19: Photo rotation hint client-side

**Job:** S1
**Agent:** Claude Code
**Files:** `src/pages/student/StudentMockExam.tsx` + (опц) `src/components/student/PhotoUploadHint.tsx`

**AC:** новый AC: «При hover/focus на photo upload area показывается hint о вертикальном фото при дневном свете».

**Depends on:** TASK-12

**Шаги:**
1. CSS-only hint поверх drag-drop area: «📱 Фотографируй вертикально, при дневном свете»
2. Read EXIF через `exif-js` (опц., если доступно) — если photo landscape → toast warning «Лучше переснять вертикально»

---

## TASK-20: 1-pager onboarding для 4 пилотных tutors

**Job:** R3
**Agent:** Vladimir + Claude Cowork (контент)
**Files:**
- `SokratAI/docs/delivery/features/mock-exams-v1/tutor-onboarding-1pager.md` (workspace artifact)

**Шаги:**
1. Скриншоты 8 экранов из mockup.html
2. Объяснение: как назначить, как проверять, как делиться lead-link, что говорить родителям
3. Блок «Что делать если AI ошибся» (1-2 примера)

---

## TASK-21: Privacy policy update for lead capture

**Job:** R3 (юридическая защита)
**Agent:** Claude Code
**Files:** `src/pages/PrivacyPolicy.tsx` (или соответствующий .md)

**AC:** новый AC: «privacy policy содержит explicit пункт о хранении lead-данных в `mock_exam_anonymous_leads`».

**Шаги:**
1. Добавить секцию «Сбор данных через бесплатные пробники» — что собираем (имя, контакт), для чего (передать репетитору), сколько храним, как удалить.

---

## TASK-22: Tutor lead notification badge на dashboard

**Job:** R3
**Agent:** Claude Code
**Files:** `src/components/tutor/chrome/SideNav.tsx` (badge на «Пробники» entry), `src/hooks/useTutorChromeCounters.ts` (новый counter `unreviewed_leads`)

**Шаги:**
1. Counter unreviewed_mock_attempts: COUNT(*) FROM mock_exam_attempts WHERE assignment.tutor_id = auth.uid() AND status = 'awaiting_review'
2. Badge на «Пробники» если counter > 0 (зелёный 1-9, красный 10+)

---

## TASK-23: Empty / loading / error states polish

**Job:** R1, S1
**Agent:** Claude Code
**Files:** все 8 новых страниц

**Шаги:**
1. Skeleton loaders на queries
2. Empty states с CTA (например, «Назначь первый пробник» на /tutor/mock-exams)
3. Error states с retry
4. Mobile responsive проверка (Chrome DevTools 375px / 414px)

---

## Validation после каждой задачи

```bash
npm run lint && npm run build && npm run smoke-check
```

Дополнительно для backend задач:
- TASK-1: `supabase db reset && supabase db push` cleanly applies
- TASK-2: `psql -c "SELECT COUNT(*) FROM mock_exam_variant_tasks"` returns 26
- TASK-5: тестовый submit → AI draft populated < 90 секунд

---

## Codex review после каждой группы (Day 1, Day 2, Day 3, Day 4)

Использовать ревью-промпт из dev-pipeline.md шаг 6 / playbook Appendix.

---

# Copy-paste промпты для агентов

> Каждый промпт — plain text, можно скопировать в Claude Code / Codex / Lovable. Промпты ниже не используют blockquote — они в fenced code blocks для удобства копирования.

## Промпт для TASK-1 (Schema migration)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: репетиторы физики ЕГЭ за месяц до экзамена. Wedge: B2B-1 × B2C-1 (Score 125). AI = draft + action, tutor approval mandatory. Mock exam — отдельная сущность от homework.

Прочитай в таком порядке:
1. docs/delivery/features/mock-exams-v1/spec.md (полная спека, особенно раздел 5 Data Model)
2. CLAUDE.md (Network & Infrastructure, Hard rules)
3. .claude/rules/40-homework-system.md (паттерн dual-format attachments, RLS pattern)

Задача: создать миграцию `supabase/migrations/20260508120000_mock_exams_v1_schema.sql` с 8 новыми таблицами (mock_exam_variants, mock_exam_variant_tasks, mock_exam_assignments, mock_exam_attempts, mock_exam_attempt_part1_answers, mock_exam_attempt_part2_solutions, mock_exam_anonymous_leads, mock_exam_public_links) + ALTER tutors ADD COLUMN feature_mock_exams_enabled BOOLEAN DEFAULT false.

Шаги:
1. Прочитай раздел 5 Data Model в spec.md — там точные DDL с CHECK constraints
2. Создай миграцию с этими 8 tables, всеми CHECK constraints (mode/variant_id mutually exclusive, student_id XOR anonymous_id), RLS policies для tutor self-read и student self-read
3. Indexes: mock_exam_attempts(assignment_id, status), mock_exam_attempts(student_id), UNIQUE on mock_exam_public_links(slug), mock_exam_anonymous_leads(tutor_id, created_at DESC)
4. ALTER tutors ADD COLUMN feature_mock_exams_enabled BOOLEAN DEFAULT false
5. Apply: supabase db push локально, проверь types.ts auto-regenerated

Acceptance Criteria:
- AC-1: tutor назначает через wizard → запись в mock_exam_assignments + mock_exam_attempts
- AC-8: per-tutor feature flag column добавлен

Guardrails:
- НЕ трогай существующую таблицу mock_exams (старая MockExam) — она deprecates в TASK-17, не сейчас
- RLS для anonymous endpoints отсутствует — service_role обходит RLS в edge functions, это намеренно
- Нейминг: новая сущность mock_exam_assignments (НЕ путать с старой MockExam в types/tutor.ts)

В конце:
1. changed files (миграция + types.ts auto-regen)
2. summary что сделано
3. validation: supabase db reset && supabase db push successful
4. self-check: миграция aplyies cleanly, RLS policies работают для tutor/student/anonymous flows
```

## Промпт для TASK-2 (Seed Тренировочный 1)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: пилот пробников ЕГЭ. Тренировочный 1 — единственный готовый вариант для Phase 1, источник Егор Иванов.

Прочитай:
1. docs/delivery/features/mock-exams-v1/spec.md
2. uploads/Тр_вариант 1.docx (исходник Егора)
3. uploads/Бланк_заполнения_ЕГЭ-2025.pdf (для Storage bucket)

Задача: создать seed-файл `supabase/seed/mock_exams_variant_1.sql` с 1 вариантом + 26 задачами + загрузить PDF бланка в Storage.

Шаги:
1. Распаковать .docx (через unzip word/document.xml + python parser)
2. Создать INSERT mock_exam_variants для Тренировочного 1: id (фикс UUID для воспроизводимости), title="Тренировочный вариант 1 (физика ЕГЭ-2026)", source='tutor', source_attribution='Источник: репетитор Егор Иванов', exam_type='ege_physics', duration_minutes=235, total_max_score=45, part1_max=28, part2_max=17, task_count=26
3. Для каждого из 26 заданий: kim_number (1..26), part (1 или 2), task_text, correct_answer (для Part 1), check_mode (5 типов по правилам ФИПИ — см. screenshot 3 в первоначальной discovery), max_score, solution_text (для Part 2)
4. Картинки задач загрузить в Storage bucket `mock-exam-variant-tasks` (private, default fallback в parseStorageRef), ссылки в task_image_url через формат `storage://mock-exam-variant-tasks/variant1/<filename>`
5. PDF бланка загрузить в Storage bucket `mock-exam-blank-templates` (public-read, путь `ege-physics-2025.pdf`)
6. Apply seed: supabase db reset && supabase db push && psql < seed.sql

Acceptance Criteria:
- AC-3: deterministic checker возвращает корректные баллы для seed ответов

Guardrails:
- LaTeX в task_text сохрани (используется MathText для рендера)
- Не пропускай задачи с картинками — обрабатывай Storage upload отдельно
- check_mode mapping проверь по методичке: задания 1-4, 7, 8, 11-13, 16 = strict; 5, 9, 14, 18 = multi_choice; 6, 10, 15, 17 = ordered; 19 = pair; 20 = task20; 21-26 = detailed
- Перед коммитом — ручная валидация Vladimir + Егор (~1ч), запиши provenance в SQL комментариях

В конце:
1. changed files (seed.sql + Storage uploads)
2. summary
3. validation: SELECT COUNT(*) FROM mock_exam_variant_tasks WHERE variant_id = '...' = 26
4. что осталось: ручная валидация Егора
```

## Промпт для TASK-3 (Tutor API endpoints)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: tutor side of Mock Exams. Reuse infrastructure (auth via JWT, RU proxy через api.sokratai.ru).

Прочитай:
1. docs/delivery/features/mock-exams-v1/spec.md (раздел 5 API)
2. CLAUDE.md (Hard rules для нового кода: hardcoded URL, supabaseClient)
3. supabase/functions/homework-api/index.ts (паттерн edge function structure)
4. .claude/rules/40-homework-system.md (RLS / ownership patterns)

Задача:
1. Создать edge function `supabase/functions/mock-exam-tutor-api/index.ts` (или extend existing) с endpoints:
   - POST /assignments (create)
   - GET /assignments (list по tutor_id)
   - GET /assignments/:id (detail с attempts + ученики)
   - GET /attempts/:id (single attempt + AI draft + photos signed URLs)
   - POST /attempts/:id/approve-task { kim_number, score, comment? }
   - POST /attempts/:id/approve-all (все 6 закрыты + status → approved)
   - POST /assignments/:id/invite-link (8-char slug → mock_exam_public_links)
2. TS-клиент `src/lib/mockExamApi.ts` (типизирован, без any)
3. Типы `src/types/mockExam.ts` — namespace `MockExamAssignment` / `MockExamAttempt` / `MockExamPart2Draft` (НЕ `MockExam` — конфликт с types/tutor.ts)

Acceptance Criteria:
- AC-1: tutor назначает через wizard → запись в mock_exam_assignments + N mock_exam_attempts created
- AC-5: approve-all → status=approved, push student через existing cascade

Guardrails:
- Hardcoded URL `https://api.sokratai.ru` в client (см. CLAUDE.md), `rewriteToProxy()` для signed URLs (см. .claude/rules/40)
- НЕ хардкод vrsseotrfmsxpbciyqzc.supabase.co (запрещено)
- Ownership через .eq('tutor_id', auth.uid()), не USING (true) policies
- approve-all enforce: все 6 part-2 задач status='tutor_approved' OR 'tutor_modified' + part-1 завершён, иначе 400

В конце:
1. changed files
2. summary
3. validation: smoke test create→list→detail→approve flow
4. self-check против UX principles (action-first, не chat)
```

## Промпт для TASK-4 (Student API + auto-save)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: student side. Auto-save — критично, ученик решает 4 часа, нельзя терять данные.

Прочитай:
1. docs/delivery/features/mock-exams-v1/spec.md
2. SokratAI/docs/delivery/features/mock-exams-v1/product-nuances.md (особенно #3 State persistence — это #1 риск)
3. CLAUDE.md
4. supabase/functions/homework-api/index.ts (auto-save паттерн)

Задача:
1. Endpoints:
   - GET /student/:id (assignment + variant)
   - POST /attempts/:id/start
   - PATCH /attempts/:id/answer { kim_number, answer } — auto-save Part 1
   - POST /attempts/:id/photo (Part 2 photo upload)
   - POST /attempts/:id/submit (final → triggers AI grading)
2. Submit logic: deterministic checker для Part 1, INSERT 6 pending записей в mock_exam_attempt_part2_solutions, enqueue AI grading job
3. Deterministic checker `src/lib/mockExamPart1Checker.ts`: 5 pure functions (strict, ordered, unordered, multi_choice, task20, pair). Unit tests против seeded variant.
4. Client side: `src/components/student/useMockExamAutoSave.ts` hook — debounced 500ms + localStorage backup + sync after reconnect

Acceptance Criteria:
- AC-2: state восстанавливается после reload (localStorage + DB hybrid)
- AC-3: deterministic checker корректно проверяет seed ответы

Guardrails:
- Auto-save NEVER потеряет данные — это hard requirement
- localStorage backup активируется если DB save fails (offline mode)
- На reload: read from DB, merge с localStorage (localStorage wins для unsaved drafts)
- При submit — enforce минимум 50% задач заполнено, иначе confirmation modal

В конце:
1. changed files
2. summary
3. validation: smoke test reload-during-exam preserves state
4. unit tests: 5 check_mode functions с известными inputs
```

## Промпт для TASK-5 (AI Part 2 grader)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: AI делает черновик оценки Части 2 по критериям ФИПИ I-IV. Phase 1 = упрощённый prompt (без deep parsing 208-стр методички). Tutor approval mandatory — AI никогда не публикует ученику.

Прочитай:
1. docs/delivery/features/mock-exams-v1/spec.md (раздел 5 AI workflow)
2. SokratAI/docs/delivery/features/mock-exams-v1/product-strategy.md (Phase 1 AI prompt)
3. CLAUDE.md (raoxy URL правила для signed URL в AI)
4. supabase/functions/homework-api/guided_ai.ts (паттерн multimodal AI call)

Задача:
1. Edge function `supabase/functions/mock-exam-grade/index.ts` — background job triggered after submit
2. Prompt в `supabase/functions/_shared/mock-exam-prompts.ts`:
   - 4 элемента I-IV (закон, обозначения, расчёт, ответ + единицы)
   - Спец-правило для №21 (3-балльная блок-схема)
   - Structured JSON output: {suggested_score, confidence, elements_check, comment_for_tutor, flags}
3. Iterate over 6 part2 задач attempt'а, save в mock_exam_attempt_part2_solutions.ai_draft_json
4. Status → awaiting_review, push tutor

Acceptance Criteria:
- AC-4: после submit → ai_draft_json populated для всех 6 задач < 90 секунд

Guardrails:
- AI **никогда** не публикует ученику — это product invariant
- При photo unreadable → confidence='low', suggested_score=null, flags=['photo_unreadable']
- Используй existing rewriteToDirect() из _shared/proxy-url.ts для server-to-server signed URL fetch (экономия ms)
- Anti-leak invariant как в guided_ai: solution_text может попасть в prompt только tutor side, никогда student side

В конце:
1. changed files
2. summary
3. validation: тестовый submit → 6 ai_draft_json populated, latency < 90s
```

## Промпт для TASK-6 (Public anonymous endpoints)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: anonymous lead-gen flow. Родитель/ученик заходит без аккаунта, проходит пробник, оставляет контакт, получает результат после tutor approval.

Прочитай:
1. docs/delivery/features/mock-exams-v1/spec.md (Section 3 + раздел 5 API public)
2. supabase/functions/public-homework-share/index.ts (паттерн public endpoint)
3. .claude/rules/40-homework-system.md (anti-leak invariant, slug regex)

Задача: edge function `supabase/functions/mock-exam-public/index.ts`:
1. GET /share/mock-invite/:slug → tutor card + variant metadata (column whitelist!)
2. POST /share/mock-invite/:slug/start → создаёт anonymous attempt + lead capture (имя, контакт, contact_type, consent_at)
3. GET /share/mock-result/:slug → approved результат для parent или lead (только status='approved')
4. Slug regex /^[a-z0-9]{8}$/i до DB query
5. Telemetry server-side: console.warn JSON {event, slug, timestamp} (без PII)

Acceptance Criteria:
- AC-6: anonymous flow создаёт mock_exam_anonymous_leads запись + attempt
- AC-7: parent share-link 200 OK без auth, 403 если status != approved

Guardrails:
- service_role client (auth.persistSession: false), обходит RLS — намеренно
- Anti-leak: column whitelist на SELECT, никогда select("*"). НЕ возвращать tutor email, tutor_telegram_id
- CORS *, OPTIONS preflight
- expires_at check → 410 если expired

В конце:
1. changed files
2. summary
3. validation: anonymous curl flow OK, security проверка (нет утечек)
```

## Промпт для TASK-7 (Routes + sidebar entry)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: добавляем 8 routes для Mock Exams + вкладку «Пробники» в SideNav, всё gated per-tutor flag (НЕ env flag).

Прочитай:
1. docs/delivery/features/mock-exams-v1/spec.md
2. src/App.tsx (current routes structure)
3. src/components/tutor/chrome/SideNav.tsx (NAV_GROUPS pattern)

Задача:
1. App.tsx: добавить 8 lazy imports + 8 routes:
   - 4 nested внутри <Route path="/tutor"> AppFrame: mock-exams, mock-exams/new, mock-exams/:id, mock-exams/:id/review/:studentId
   - 2 student top-level: /student/mock-exams/:id, /student/mock-exams/:id/result
   - 2 public top-level: /p/mock-invite/:slug, /p/mock-result/:slug
2. Stub-страницы (placeholder <div>) — реализация в TASK-8..15
3. SideNav.tsx: добавить hook `useTutorMockExamsFeatureFlag()` — fetch tutors.feature_mock_exams_enabled через React Query, query key ['tutor', 'feature-flags']
4. Если flag=true → добавить NavItem «Пробники» с ClipboardCheck icon в группу «Работа»
5. Prefetch entry для маршрута

Acceptance Criteria:
- AC-8: tutor с feature_mock_exams_enabled=false НЕ видит Пробники и не получает доступ к /tutor/mock-exams; текущий frontend guard редиректит на /tutor/home

Guardrails:
- НЕ использовать VITE_FEATURE_MOCK_EXAMS_PREVIEW env flag (старый paradigm)
- Per-tutor flag в БД через React Query
- Pages должны самостоятельно проверять flag (через hook) и редиректить на /tutor/home если false (защита от direct URL access)

В конце:
1. changed files
2. summary
3. validation: build clean, smoke test routes
```

## Промпт для TASK-8 (TutorMockExams list page)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: точка входа в Mock Exams для tutor. Должна выглядеть как полноценная фича (marketing-ready), не stub.

Прочитай:
1. docs/delivery/features/mock-exams-v1/spec.md
2. SokratAI/docs/delivery/features/mock-exams-v1/mockup.html (Screen 1 ## SCREEN 1: LIST)
3. src/pages/tutor/TutorHomework.tsx (паттерн list page)
4. .claude/rules/90-design-system.md

Задача: `src/pages/tutor/mock-exams/TutorMockExams.tsx`
1. Header «Пробники» + CTA «Назначить пробник» → /tutor/mock-exams/new
2. Бета-баннер амбер с объяснением контракта Phase 1
3. Список mock_exam_assignments через useMockExamAssignments() React Query hook
4. Card per assignment: title, status badge, KPI (5 учеников, 3 сдали, 2 нужна проверка, средний балл), click → /tutor/mock-exams/:id
5. Empty state если 0 assignments — CTA «Назначь первый пробник»
6. Секция «Готовые варианты в библиотеке» — Тренировочный 1 (clickable → wizard)

Acceptance Criteria:
- AC-1: tutor видит список своих mock-exams со статистикой

Guardrails:
- React.memo на Card компоненты (см. .claude/rules/performance.md)
- НЕ emoji в chrome (Lucide icons only)
- shadcn Card / Button / Badge
- Mobile responsive (Chrome DevTools 375px проверь)
- transition-shadow not transition-all

В конце:
1. changed files
2. summary
3. validation: lint + build + smoke check + manual click через mockup-эквивалент
```

## Промпт для TASK-9 (TutorMockExamCreate wizard)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Прочитай:
1. docs/delivery/features/mock-exams-v1/spec.md
2. SokratAI/docs/delivery/features/mock-exams-v1/mockup.html (Screen 2 ## SCREEN 2: WIZARD)
3. src/pages/tutor/TutorHomeworkCreate.tsx (паттерн wizard)

Задача: `src/pages/tutor/mock-exams/TutorMockExamCreate.tsx`
Single-page wizard 4 шага:
1. Шаг 1 — выбор варианта (Тренировочный 1 selected by default, остальные disabled «скоро»)
2. Шаг 2 — режим: «С бланком» default + «Стандартный» alt (radio with bg-sokrat-accent-light для selected)
3. Шаг 3 — ученики (reuse useTutorStudents(), groups + individuals, чекбоксы)
4. Шаг 4 — дедлайн text input + опц. «Создать lead-link» отдельная кнопка
5. Submit → POST /assignments (mockExamApi) → redirect /tutor/mock-exams/:id

Acceptance Criteria:
- AC-1: assignment + N attempts created в БД

Guardrails:
- Дедлайн через native text input + date-fns parseISO (не нативный Date string)
- text-base 16px на all inputs (iOS Safari)
- Mobile responsive (375px)
- Default mode 'blank_paper' (см. spec.md «Бланки» секция)

В конце: changed files, summary, validation, self-check 16/17.
```

## Промпт для TASK-10 (TutorMockExamDetail heatmap)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Прочитай:
1. docs/delivery/features/mock-exams-v1/spec.md
2. SokratAI/docs/delivery/features/mock-exams-v1/mockup.html (Screen 3 ## SCREEN 3: RESULTS)
3. src/components/tutor/results/HeatmapGrid.tsx (canonical heatmap паттерн)
4. .claude/rules/80-cross-browser.md (sticky+border-collapse баг)

Задача:
1. `src/pages/tutor/mock-exams/TutorMockExamDetail.tsx` — header, KPI cards, heatmap section, AI-черновик банер
2. `src/components/tutor/mock-exams/MockExamHeatmap.tsx` — таблица 5×26 students × tasks + Часть 1/2 разделитель + 3 итоговые колонки
3. Click row → navigate /tutor/mock-exams/:id/review/:studentId
4. Cell colors: cell-correct, cell-partial, cell-wrong, cell-empty, cell-draft, cell-low-conf

Acceptance Criteria:
- AC-5: tutor видит overview + drill-down

Guardrails:
- CRITICAL: border-separate border-spacing-0 + <colgroup> + width: max-content (sticky+border-collapse в Safari СЛОМАНО)
- touch-pan-x на wrapping div (iOS swipe)
- React.memo на Row + Cell компоненты (260 ячеек = lag без memo)
- Single source of truth для cell color helper в shared file (heatmapStyles.ts pattern)

В конце: changed files, summary, validation, проверка iOS Safari sticky.
```

## Промпт для TASK-11 (TutorMockExamReview surface)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: главное место value proposition — tutor approves/корректирует AI draft. Должно быть быстро и безопасно.

Прочитай:
1. docs/delivery/features/mock-exams-v1/spec.md
2. SokratAI/docs/delivery/features/mock-exams-v1/mockup.html (Screen 4 ## SCREEN 4: REVIEW)
3. SokratAI/docs/delivery/features/mock-exams-v1/product-nuances.md (особенно #1 reasoning visibility, #2 anonymous bar quality, #9 approve granularity)

Задача: `src/pages/tutor/mock-exams/TutorMockExamReview.tsx`
1. Header (имя ученика, время сдачи)
2. Часть 1 summary card (auto-graded, не редактируется)
3. Часть 2 cards (6): condition + photo + 4 элементов I-IV (галочки/крестики из ai_draft_json) + suggested_score + confidence chip + comment + Approve buttons
4. Per-task approve через POST /attempts/:id/approve-task
5. Sticky-feel footer: counter + global approve (disabled пока не закрыты все 6)
6. Anonymous attempts (lead) — без bulk approve кнопки, только per-task
7. Low-confidence cards: red border + явный alert «AI не смог распознать»

Acceptance Criteria:
- AC-5: tutor approves → status=approved → push student

Guardrails:
- Score override read-only с явным «Изменить» (см. nuances #3)
- Approve modal: «после этого ученик и родители получат результат, перепроверка возможна»
- No emoji
- MathText для condition/comment если LaTeX

В конце: changed files, summary, validation, self-check 16/17 (action-first, не chat).
```

## Промпт для TASK-12 (StudentMockExam taking)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: ученик решает 4 часа. State loss = главный риск. Auto-save обязателен.

Прочитай:
1. docs/delivery/features/mock-exams-v1/spec.md
2. SokratAI/docs/delivery/features/mock-exams-v1/mockup.html (Screen 5)
3. SokratAI/docs/delivery/features/mock-exams-v1/product-nuances.md (#3 State persistence)
4. .claude/rules/80-cross-browser.md (iOS auto-zoom, touch-action)

Задача: `src/pages/student/StudentMockExam.tsx`
1. Layout: timer (visual, не enforce), справочные данные (collapsible), список 26 задач
2. Бланк-режим (default): instruction banner + ссылка на PDF + photo upload бланка
3. Form Часть 1 (1-20): поля под check_mode (5 типов)
4. Photo Часть 2 (21-26): 1 photo per task, retry, preview
5. Auto-save через `useMockExamAutoSave` hook (TASK-4): debounced 500ms PATCH + localStorage backup
6. Submit confirmation modal → POST /submit → redirect /result

Acceptance Criteria:
- AC-2: state восстанавливается после reload через localStorage + DB

Guardrails:
- text-base 16px на inputs (iOS auto-zoom prevention)
- touch-action: manipulation на interactive
- Auto-save NEVER теряет данные (hard requirement)
- Restore: DB load + localStorage merge (localStorage wins для unsaved)
- React.lazy для MathText subcomponent

В конце: changed files, summary, validation, smoke test reload mid-exam.
```

## Промпт для TASK-13 (StudentMockExamResult)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: контракт «Часть 1 immediate, Часть 2 only after tutor approval». State-driven UI.

Прочитай:
1. docs/delivery/features/mock-exams-v1/spec.md
2. SokratAI/docs/delivery/features/mock-exams-v1/mockup.html (Screen 6)

Задача: `src/pages/student/StudentMockExamResult.tsx`
1. Header (вариант, дата, время)
2. Часть 1 card (always): большой балл из `part1_score/variant.part1_max` + collapsible таблица 20 задач
3. Часть 2 card state-driven:
   - awaiting_review → амбер «Репетитор Х проверяет, придёт в 24ч»
   - approved → большой балл + cards 6 заданий с tutor comments
4. Финальный summary (когда approved): первичный + тестовый + бенчмарк-полоса по `variant.total_max_score`

Acceptance Criteria:
- AC-5: после approve student видит финальный балл

Guardrails:
- AI never shown to student — render строго по status (awaiting_review HIDES ai_draft_json)
- React Query stale time + invalidation на push trigger
- Mobile-first

В конце: changed files, summary, validation.
```

## Промпт для TASK-14 (PublicMockInvite anonymous)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: lead-gen flow для tutors. Anonymous родитель/ученик заходит без аккаунта.

Прочитай:
1. docs/delivery/features/mock-exams-v1/spec.md
2. SokratAI/docs/delivery/features/mock-exams-v1/mockup.html (Screen 7)
3. src/pages/PublicHomeworkShare.tsx (паттерн public route)

Задача: `src/pages/PublicMockInvite.tsx`
1. NO auth, NO TutorGuard — public route /p/mock-invite/:slug
2. Layout: tutor card сверху (имя, опыт, аватар) — fetched через GET /share/mock-invite/:slug
3. Offer: вариант + 3 метрики (время, заданий, бесплатно) + контракт «Часть 1 сразу, Часть 2 в 24ч»
4. Lead capture form: имя ребёнка + Telegram/email + consent + privacy ссылка
5. Submit → POST /share/mock-invite/:slug/start → redirect в exam-taking flow (anonymous mode)
6. Mobile-first

Acceptance Criteria:
- AC-6: lead capture создаёт mock_exam_anonymous_leads запись

Guardrails:
- Branding: tutor primary, «через Сократ AI» small print (nuances #11)
- Privacy policy link обязательна (юридический риск, nuances #7)
- text-base 16px на inputs

В конце: changed files, summary, validation.
```

## Промпт для TASK-15 (PublicMockResult parent)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Прочитай:
1. docs/delivery/features/mock-exams-v1/spec.md
2. SokratAI/docs/delivery/features/mock-exams-v1/mockup.html (Screen 8)

Задача: `src/pages/PublicMockResult.tsx`
1. Public route /p/mock-result/:slug, без auth
2. Mobile-first
3. Big number + тестовый + прогресс-бар по шкале ЕГЭ через `variant.total_max_score`
4. Часть 1 / Часть 2 раскладка (баллы)
5. Опц. tutor comment
6. CTA «Связаться с репетитором X в Telegram»
7. Footer «Через Сократ AI · тестовый балл предварительный»

Acceptance Criteria:
- AC-7: public link без auth, 403 если awaiting_review

Guardrails:
- Только status='approved' OR 'manually_entered'
- Mobile-first (родители на телефонах)
- Markdown link в Telegram tutor

В конце: changed files, summary, validation, проверка mobile 375px.
```

## Промпт для TASK-16..23 (P1 batch)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: Phase 1 P1 — manual entry mode + cleanup старого MockExam + polish.

Прочитай:
1. docs/delivery/features/mock-exams-v1/spec.md (раздел 9 Implementation Tasks → Manual_entry + cleanup)
2. SokratAI/docs/delivery/features/mock-exams-v1/product-strategy.md (раздел про unified место)

Задачи (последовательность):
1. TASK-16: AddManualMockExamDialog — student select + variant_title + date + score + comment → POST /assignments mode='manual_entry'
2. TASK-18: StudentMockExamHistory секция на TutorStudentProfile — список всех attempts (auto + manual) для ученика
3. TASK-17: УДАЛИТЬ старую MockExam: MockExamCard + AddMockExamDialog в TutorStudentProfile.tsx, useMockExams в useTutor.ts, getMockExams/createMockExam/updateMockExam/deleteMockExam в tutors.ts, типы MockExam/CreateMockExamInput/UpdateMockExamInput в types/tutor.ts
   ВАЖНО: TASK-18 должен быть готов ДО TASK-17 (чтобы tutor не остался без UI)
4. TASK-19: photo rotation hint
5. TASK-22: lead notification badge на SideNav
6. TASK-23: empty / loading / error polish

Guardrails:
- Перед TASK-17: grep -rn "MockExam" src/ — перечислить все references
- НЕ удалять до завершения TASK-16 + TASK-18
- Manual entry attempt: status='manually_entered', total_score введён tutor, не AI flow
- React.memo на History list cards

В конце: changed files (по каждой подзадаче), summary, validation: grep -rn "MockExamCard\|useMockExams" src/ должен возвращать 0.
```

---

# Validation после Phase 1 деплоя

```bash
# Backend
supabase db reset && supabase db push  # Apply все миграции
psql -c "SELECT COUNT(*) FROM mock_exam_variants WHERE source='tutor';"  # = 1
psql -c "SELECT COUNT(*) FROM mock_exam_variant_tasks;"  # = 26

# Frontend
npm run lint && npm run build && npm run smoke-check

# Manual smoke
1. Tutor назначает пробник 1 ученику
2. Ученик открывает /student/mock-exams/:id, заполняет форму, перезагружает — данные восстановлены
3. Ученик submit → видит Часть 1 immediate
4. Tutor видит push → открывает review surface → approves все 6 задач
5. Ученик получает push → открывает /result → видит финальный балл
6. Tutor открывает share-link → копирует → открывает в incognito → результат виден без auth
7. Tutor создаёт lead-link → открывает в incognito → проходит anonymously → lead появляется в tutor inbox
```

---

# Codex review

После каждой группы (Day 1, 2, 3, 4) — отдельная Codex сессия с промптом из dev-pipeline.md шаг 6:

```
Ты — независимый ревьюер SokratAI. Контекст первого агента тебе недоступен.

ПОРЯДОК (строго):
1. Прочитай docs/discovery/product/tutor-ai-agents/14-ajtbd-product-prd-sokrat.md
2. Прочитай docs 16, 17
3. Прочитай docs/delivery/features/mock-exams-v1/spec.md
4. Прочитай AC из спеки
5. Посмотри git diff

ВОПРОСЫ: Job alignment? UX drift? Scope creep? AC выполнены?
ФОРМАТ: PASS / CONDITIONAL PASS / FAIL
```
