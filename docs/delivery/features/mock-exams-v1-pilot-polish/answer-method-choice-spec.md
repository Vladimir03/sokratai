# Mock Exams v1 — Student Answer Method Choice (TASK-10 polish)

**Author:** Vladimir + Claude Code
**Created:** 2026-05-14
**Status:** In progress
**Scope:** Pilot-polish Phase 2 (после TASK-1..7 + review fix)

## 0. Job Context

- **Job:** S2-1 (ученик проходит пробник в комфортном режиме), R4-2 (репетитор получает корректные данные для проверки)
- **Wedge alignment:** ученик пилота должен сам выбирать формат ответа — нельзя заставлять заполнять «бланк + цифровой ввод одновременно» как делает текущий `mode='blank'`. Это снижает comfort и пугает пилотных учеников.

## 1. Problem

Текущий taking page (`StudentMockExam.tsx`) рендерит интерфейс на основе `mock_exam_assignments.mode`, выбираемого репетитором при создании:

- `mode='blank'` → желтый `BlankModeBanner` («Распечатай PDF, заполни ручкой, потом сфотографируй») **+** все 20 Часть 1 inputs **+** 6 photo slots Часть 2 — **ученик заполняет ОБА**
- `mode='form'` → inputs + photos Часть 2 (без блока бланка)
- `mode='manual_entry'` → tutor-only flow

**Vladimir's feedback (2026-05-14):**
1. Принудительное дублирование «бланк + inputs» в `blank`-режиме — antipattern. Тренировка как на реальном ЕГЭ — это бланк ОТ РУКИ; ученик не должен дублировать ответы цифрами «на всякий случай»
2. **Кто решает способ** — ученик, не tutor. Tutor создаёт пробник нейтральным, ученик на taking page выбирает: бланк ИЛИ цифровой
3. Нет PDF самих **задач** варианта (только бланк ФИПИ есть). Ученик не может скачать условия чтобы решать «как на ЕГЭ»
4. Загрузка Части 2 — есть только per-task (6 фото по задаче). Ученики часто фотографируют один лист с несколькими задачами или 7+ фото общим pack'ом. Нужен дополнительный bulk slot
5. Загрузка фото Части 1 — только через ФИПИ-бланк. Нужен fallback «загрузил фото своих ответов Часть 1 в свободной форме» (черновик, тетрадь и т.д.)

## 2. Solution

### 2.1 Per-attempt answer method choice

`mock_exam_attempts.answer_method TEXT NULL CHECK IN ('blank', 'form')` — ученик выбирает, не tutor. NULL = ещё не выбрал (modal появится).

Tutor `assignment.mode` **остаётся** (для tutor-info + `'manual_entry'` flow), **но не определяет** UI ученика. На пилоте миграция backfill'ит из `assignment.mode` в `attempts.answer_method`.

### 2.2 Modal на первом open'е

При mount taking page если `attempt.answer_method === null` → AlertDialog «Как будешь отвечать?» с двумя карточками:

- **Бланк ФИПИ от руки (рекомендуем)** — explicit hint про ЕГЭ
- **Цифровой ввод**

После выбора → POST `/attempts/:id/set-answer-method` → modal закрывается → conditional render.

В шапке таking page — small switcher «Способ: Бланк | Цифровой» с confirm dialog при смене (если есть partial answers). Permissive — переключение в любой момент разрешено, оба набора данных хранятся параллельно, submit берёт по текущему `answer_method`.

### 2.3 Conditional render

| `answer_method` | BlankModeBanner | Часть 1 inputs | Часть 2 per-task slots | Часть 2 bulk slot |
|---|---|---|---|---|
| `'blank'` | visible (без «введи ниже» текста) | **скрыты** | visible | visible |
| `'form'` | hidden | visible | visible | visible |

Часть 2 одинакова в обоих режимах. Bulk slot — additive, не заменяет per-task.

### 2.4 Fallback Часть 1 photo

В конце Часть 1 (внутри обоих режимов) — collapsible «Загрузить фото Части 1 отдельно» (для ситуаций «не на ФИПИ-бланке, на черновике»). Поле: `attempts.part1_blank_photo_url TEXT NULL` (single ref).

В режиме `blank` основной upload — ФИПИ бланк (`blank_photo_url` existing). Если ученик загружает дополнительно через fallback — это попадает в `part1_blank_photo_url` (разные поля чтобы tutor мог разделить).

### 2.5 Bulk Часть 2 photos

`attempts.part2_bulk_photo_urls TEXT NULL` — dual-format (single ref OR JSON array, как `task_image_url`). Лимит 7 фото (≥ 6 per-task slots + 1 для подстраховки на случай дополнительного листа решения).

Tutor review surface показывает оба пути:
- Per-task photos (existing `mock_exam_attempt_part2_solutions.photo_url`) — primary
- Bulk pack — рядом, с counter «1/7, 2/7 …» — tutor вручную сопоставляет задачи

### 2.6 PDF задач варианта

`mock_exam_variants.variant_pdf_url TEXT NULL` — URL на bucket `mock-exam-variant-pdfs` (public). Variant 1: `Тр_вариант 1.pdf` (конвертация из `.docx` через Word COM). Кнопка «📥 Скачать задачи (PDF)» в шапке taking page.

## 3. AC

- **AC-AMC-1 (modal):** Ученик открывает taking page с `answer_method=null`. AlertDialog с двумя карточками появляется. Выбор персистится в БД через `POST /set-answer-method`. Modal не повторяется при reopen page.
- **AC-AMC-2 (conditional):** `answer_method='blank'` → BlankModeBanner viewed без текста «введи ниже»; Часть 1 inputs **отсутствуют** в DOM. `answer_method='form'` → BlankModeBanner отсутствует, inputs Часть 1 viewed.
- **AC-AMC-3 (switcher):** Header «Способ: …» — клик открывает confirm dialog «Сменить способ? Данные обоих режимов сохраняются». Подтверждение → `POST /set-answer-method` + re-render.
- **AC-AMC-4 (fallback Part 1):** Под Часть 1 — collapsible «📷 Загрузить фото Части 1 отдельно» с одним image slot. Upload пишет в `attempts.part1_blank_photo_url`.
- **AC-AMC-5 (bulk Part 2):** Под Часть 2 — pulse card «Или загрузи все решения одним пакетом до 7 фото». Загрузка → `attempts.part2_bulk_photo_urls`.
- **AC-AMC-6 (PDF):** В шапке кнопка «📥 Скачать задачи (PDF)» открывает `variant.variant_pdf_url` в новой вкладке. Если null — кнопка hidden.
- **AC-AMC-7 (migration backfill):** Existing pilot attempts с `assignment.mode='blank'` или `'form'` мигрируют на соответствующий `answer_method`. Existing Egor's attempt не теряет данные.
- **AC-AMC-8 (tutor review):** TutorMockExamReview surface показывает `answer_method`, `part1_blank_photo_url`, `part2_bulk_photo_urls` если они заданы.

## 4. Out of scope

- Multi-variant PDF support (Variant 2..N) — generic backend готов (`variant_pdf_url` per row), но конверсия других вариантов = отдельная задача
- AI OCR бланков ФИПИ — Phase 3 (не блокирует пилот; tutor проверяет фото бланка вручную)
- iOS native «Files» picker integration для PDF download — браузер handles (target="_blank")
- Удаление `mock_exam_assignments.mode` — оставляем для tutor info + `'manual_entry'` flow

## 5. Files

### DB migrations
- `supabase/migrations/20260514130000_attempt_answer_method.sql` — 3 колонки в `mock_exam_attempts` + backfill
- `supabase/migrations/20260514130100_mock_exam_variant_pdf.sql` — `variant_pdf_url` + bucket `mock-exam-variant-pdfs`
- `supabase/migrations/20260514130200_variant1_pdf_backfill.sql` — UPDATE variant_1 с URL после storage upload (Vladimir заливает PDF)

### Backend
- `supabase/functions/mock-exam-student-api/index.ts`:
  - Extend SELECT for `answer_method`, `part1_blank_photo_url`, `part2_bulk_photo_urls`, `variant_pdf_url`
  - New route `POST /attempts/:id/set-answer-method` body `{ method: 'blank' | 'form' }`
  - Submit validation согласно `answer_method`

### Frontend
- `src/types/mockExam.ts` — `MockExamAnswerMethod` type + extend `StudentMockExamView`
- `src/lib/studentMockExamApi.ts` — extend response types + `setMockExamAnswerMethod()` API
- `src/components/student/mock-exam/AnswerMethodSelectModal.tsx` — **новый** modal
- `src/components/student/mock-exam/AnswerMethodSwitcher.tsx` — **новый** header pill switcher с confirm
- `src/pages/student/StudentMockExam.tsx`:
  - Mount modal logic + switcher integration
  - Conditional Часть 1 inputs render
  - Fallback Часть 1 photo collapsible
  - Bulk Часть 2 photo upload section
  - PDF download button в шапке

### Conversion artifacts
- `docs/delivery/features/mock-exams-v1/source/variant1-tasks.pdf` — конвертация (gitignored / committed?)

## 6. Validation

- `npm run build` clean
- `npm run smoke-check` clean
- Lovable Cloud applies migrations; Vladimir uploads PDF to storage; manual UPDATE for variant_pdf_url
- Live preview check: open taking page, modal appears; choose «бланк», banner without «введи ниже» text; Часть 1 inputs gone; download PDF works

## 7. Rollout

1. Конверсия PDF (Claude, локально через Word COM) ✅ done
2. Spec ландинг (текущий файл) ← we are here
3. Миграции + backend + frontend в один коммит → push
4. Lovable Cloud auto-deploy:
   - Migrations apply ~1-2 min
   - Frontend rebuild для `sokratai.lovable.app`
5. **Vladimir uploads PDF** в storage через Lovable Studio (bucket `mock-exam-variant-pdfs`, path `variant1/variant1.pdf`, public-read)
6. **Vladimir runs UPDATE** в Lovable SQL editor:
   ```sql
   UPDATE public.mock_exam_variants
   SET variant_pdf_url = 'https://vrsseotrfmsxpbciyqzc.supabase.co/storage/v1/object/public/mock-exam-variant-pdfs/variant1/variant1.pdf'
   WHERE id = '36cebc45-e2e8-5603-a753-01c818bba131';
   ```
   (или эквивалент через `api.sokratai.ru` proxy host — оба работают для public bucket)
7. Production: `deploy-sokratai` после verification в preview
