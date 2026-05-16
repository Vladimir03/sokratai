# Mock Exams v1 — Taking page content fixes (TASK-12)

**Created:** 2026-05-14
**Status:** ✅ Landed
**Trigger:** Vladimir QA after TASK-11 (tutor cabinet bugs fix) — 6 student-side bugs.

## 0. Job Context

- **Job:** S2-1 (ученик может комфортно решать пробник без ошибочного содержимого), wedge: pilot retention
- **Wedge alignment:** ученик пилота не может правильно решать задачи если condition text ломаный, hint противоречит инструкции, PDF leaked answers. Все 6 багов блокируют trust в продукт.

## 1. Problem

После landing TASK-10 (per-attempt answer_method) и TASK-11 (tutor cabinet fixes) Vladimir прошёл taking page как ученик и обнаружил **6 связанных багов**:

1. **KIM 5, 9, 14, 18** (multiple choice): пустые строки между «1)» и текстом утверждения в task_text. Источник — docx-парсер сохранял `1)\n\nText` вместо `1) Text`.

2. **KIM 19** (динамометр + погрешность): hint справа от input «Число и единица: 12,5 м/с или 12,5;м/с» — generic pair-hint противоречит инструкции варианта.

3. **KIM 20** (выбор схем): orphaned «1)/4)/2)/5)/3)» маркеры после удаления `[РИСУНОК]` artefacts. Картинки идут отдельной gallery без подписей.

4. **Часть 2 в taking page** (form mode): ученик не видит условий задач KIM 21-26. Commit `907257c` (Phase 5 UX simplification) удалил `part2Tasks.map(<Part2TaskCard>)` — но условия остались нужны (ученик должен видеть что решать).

5. **PDF leak в storage**: `variant1-tasks.pdf` (27 страниц) содержит «Систему оценивания» с таблицей правильных ответов Часть 1 на странице 14. Ученик скачивает PDF → видит ответы. **Критичный security leak**.

6. **KIM 14** (колебательный контур): inline pseudo-table `$t, 10^{-6}$ c: 0, 1, …` рендерится как обычный текст вместо 2×11 таблицы — не GFM формат.

## 2. Solution

### 2.1 Content — `variant1-tasks.json` (5 KIMs)

- **KIM 5, 9, 14, 18**: `1)\n\nText` → `1) Text` (single space, double `\n\n` сохранён между опциями).
- **KIM 14 (additional)**: inline `$t, 10^{-6}$ c: 0, 1, …` → markdown GFM table 2×11 (один header row + один data row). `MARKDOWN_TABLE_RE` в `MathBlock` матчит → `MarkdownTaskText` lazy-loadит ReactMarkdown.
- **KIM 20**: убраны orphan'ы «1)/4)/2)/5)/3)». Финальный task_text оставляет только условие + final phrase «Запишите в ответ номера выбранных схем (схемы 1–5 приведены ниже)».

### 2.2 Migration — idempotent UPDATE'ы

`supabase/migrations/20260514150000_resync_variant_1_kim_5_9_14_18_20.sql` — 5 UPDATE by `id` (uuid5 детерминированный). Pattern mirror'ит `20260514120000_resync_mock_exam_variant_1_content.sql` (TASK-6). Без `updated_at` (колонка отсутствует в схеме `mock_exam_variant_tasks`).

### 2.3 Frontend `StudentMockExam.tsx`

**`getAnswerHint(mode, kimNumber?)` per-kim override**:
- `kimNumber === 19` → «Два числа слитно: значение и погрешность, например 2,70,1»
- Иначе — generic check_mode hint как раньше
- Caller в `Part1TaskCard` передаёт `task.kim_number` как 2-й аргумент

**KIM 20 gallery captions** (Part1TaskCard image render):
- Wrap images в `<figure>` с `<figcaption>Схема N</figcaption>` для `task.kim_number === 20`
- Для остальных KIMs — img без figcaption (как было)
- Caption берётся из позиции в `imageUrls[]` массиве (canonical scheme order = task_image_url[] order)
- Также `loading="lazy"` добавлен ко всем картинкам

**Part 2 read-only preview cards** (новый компонент `Part2TaskPreviewCard`):
- Рендерится в секции «Часть 2» **перед** bulk upload block
- Показывает: `№{kim} · {max_score} баллов · развёрнутое решение` + `task_text` через `MathBlock` + image gallery
- **БЕЗ** `PhotoUploadBox` per-task (Phase 5 решение consolidate в bulk остаётся)
- Bulk upload UI ниже без изменений

**Subtitle секции Часть 2** обновлён: «Прочитай условия задач № 21–26 ниже и реши их на бумаге. Затем загрузи фото решений одним пакетом…» — ясно отделяет «читай условия» от «загружай фото».

### 2.4 PDF slice — `scripts/slice-variant-pdf.py`

One-off script через `pypdf`:
- Reads `docs/delivery/features/mock-exams-v1/source/variant1/variant1-tasks.pdf` (27 pages)
- Writes first 24 pages back in-place
- Vladimir **manually** загружает sliced PDF в Lovable Studio (storage bucket `mock-exam-variant-pdfs`, path `variant1/variant1.pdf`)
- URL не меняется → `variant_pdf_url` UPDATE не нужен

## 3. Acceptance Criteria

- **AC-T12-1 (multiple choice clean)**: KIM 5, 9, 14, 18 — пустых строк между «1)» и текстом утверждения нет. Опции разделены `\n\n` между собой (между ними blank line остаётся).
- **AC-T12-2 (KIM 19 hint)**: `/student/mock-exams/:id` taking page для KIM 19 показывает hint «Два числа слитно: значение и погрешность, например 2,70,1» справа от input.
- **AC-T12-3 (KIM 20 captions)**: gallery картинок KIM 20 рендерит 5 figures с figcaption «Схема 1», «Схема 2»…«Схема 5». task_text не содержит orphan «1)/4)/2)/5)/3)».
- **AC-T12-4 (Часть 2 read-only)**: На taking page после Часть 1 секции отображены 6 read-only карточек KIM 21–26 (текст + картинки). Ниже — bulk photo uploader для всех 6 задач разом. Per-task photo upload отсутствует (Phase 5 invariant).
- **AC-T12-5 (PDF без ответов)**: после Vladimir's manual re-upload sliced PDF в storage, ученик скачивает PDF → 24 страницы, страница 14 НЕ содержит таблицу с правильными ответами.
- **AC-T12-6 (KIM 14 table)**: KIM 14 condition содержит 2-row × 11-col markdown table вместо inline pseudo-table. ReactMarkdown lazy-loadится только когда `MARKDOWN_TABLE_RE` matches.

## 4. Out of scope (deferred)

- AI OCR ФИПИ-бланка (Phase 3)
- Полный refactor docx-парсинга (`build-mock-exam-seed.py` regex'ы) — KIM 20 в этой задаче пере-typed manually
- Multi-variant PDF support — generic slicing script готов, но variants 2..N не имеют PDF yet
- `taskImageCaptions` поле в БД-схеме — KIM 20 hardcoded check, multi-variant generic путь отложен
- `mock_exam_variant_pdfs` access policy refinement (сейчас public-read; long-term: signed URL per attempt с TTL)

## 5. Files (landed)

| File | Type | Change |
|---|---|---|
| `docs/delivery/features/mock-exams-v1/source/variant1-tasks.json` | MODIFY | task_text для KIM 5/9/14/18/20 |
| `supabase/seed/mock_exams_variant_1.sql` | MODIFY (regen) | детерминированная regen (только task_text для 5 KIMs) |
| `supabase/migrations/20260514150000_resync_variant_1_kim_5_9_14_18_20.sql` | NEW | 5 idempotent UPDATE'ов |
| `src/pages/student/StudentMockExam.tsx` | MODIFY | getAnswerHint kim=19 override; Part2TaskPreviewCard компонент; KIM 20 gallery figcaption; Часть 2 subtitle update |
| `scripts/slice-variant-pdf.py` | NEW | one-off PDF slicing CLI |
| `docs/delivery/features/mock-exams-v1/source/variant1/variant1-tasks.pdf` | REPLACE | sliced 24 pages (was 27, 953 KB → 695 KB) |
| `docs/delivery/features/mock-exams-v1-pilot-polish/taking-page-content-fixes-spec.md` | NEW | этот документ |

## 6. Reused utilities

- `parseTaskImageRefs` ([src/pages/student/StudentMockExam.tsx](src/pages/student/StudentMockExam.tsx)) — image refs dual-format parser
- `useSignedTaskImages` ([src/pages/student/StudentMockExam.tsx](src/pages/student/StudentMockExam.tsx)) — batch signed URL resolution
- `MarkdownTaskText` ([src/components/student/mock-exam/MarkdownTaskText.tsx](src/components/student/mock-exam/MarkdownTaskText.tsx)) — markdown table rendering (auto-loaded by MathBlock when GFM table detected)
- `MathBlock` ([src/pages/student/StudentMockExam.tsx](src/pages/student/StudentMockExam.tsx)) — MarkdownTableRenderer vs MathText routing
- `build-mock-exam-seed.py` ([scripts/build-mock-exam-seed.py](scripts/build-mock-exam-seed.py)) — canonical generator
- `pypdf` (installed) — PDF slicing

## 7. Verification

1. **JSON edits** — `cat variant1-tasks.json | python -m json.tool > /dev/null` (валидность); grep на `"1)\\n\\n"` в KIM 5/9/18 → 0 matches.
2. **Regen seed** — `git diff supabase/seed/mock_exams_variant_1.sql` показывает только task_text changes для 5 KIMs, UUIDs unchanged.
3. **`npm run build`** — clean, no new TS errors.
4. **`npm run smoke-check`** — all assertions OK.
5. **Lovable Cloud auto-applies миграцию** ~1-2 минуты после push.
6. **Lovable preview** (~3 мин после push):
   - KIM 5/9/14/18 — пустых строк между «1)» и текстом нет.
   - KIM 14 — markdown таблица 2×11 рендерится (header `t, ·10⁻⁶ с` + values).
   - KIM 19 — hint «Два числа слитно: значение и погрешность, например 2,70,1» справа от input.
   - KIM 20 — orphan «1)/4)/2)/5)/3)» нет; gallery с подписями «Схема 1..5».
   - Часть 2 KIM 21-26 read-only карточки видны (текст + картинки); bulk upload ниже.
7. **PDF slice** — `python scripts/slice-variant-pdf.py` → 24 pages, 695 KB. Verify: открыть страницу 14 — НЕ содержит answer table.
8. **Storage re-upload (Vladimir manual)** — заменить `variant1/variant1.pdf` в bucket `mock-exam-variant-pdfs` через Lovable Studio. URL unchanged. Hard-reload taking page чтобы bust browser cache.
9. **Production deploy** — `deploy-sokratai` после Lovable preview verification.

## 8. Rollback

- **JSON / seed / migration** — git revert; миграция idempotent, prod БД легко вернуть.
- **PDF storage** — Vladimir заливает обратно prior 27-page version (доступна из git history `git show 7025fdc:docs/delivery/features/mock-exams-v1/source/variant1-tasks.pdf`).
- **Frontend** — `git revert <hash> && deploy-sokratai`.
