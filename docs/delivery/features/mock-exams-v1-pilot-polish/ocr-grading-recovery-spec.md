# OCR & AI Grading Recovery — Mock Exams v1 (TASK-OCR-1, 2026-05-21)

**Status:** Implementation
**Trigger:** Vladimir 2026-05-21 — репетитор Егор не получает AI-черновик проверки пробников. Часть 1 OCR не запускается, Часть 2 в `ai_checking` зависает.

---

## Section 0 — Job Context (AJTBD traceability)

Job: **R-2 «Получить готовый разбор пробника через 30 минут, а не за вечер»** (см. `docs/discovery/product/tutor-ai-agents/15-backlog-of-jtbd-scenarios-sokrat.md`).

Repaired primary CTA: «Подтвердить и отправить ученику» в `TutorMockExamReview` снова работает с реальным AI draft вместо пустых fallback-карточек.

---

## Section 1 — Requirements

### Problem (наблюдаемое)

1. **Egor's pilot screenshot, 2026-05-21:** ученик загрузил фото бланка + фото Часть 2, нажал submit. В `TutorMockExamReview` Часть 1 пуста («AI ещё не распознал»), Часть 2 показывает «AI не успел» для всех 6 KIM. Egor: «AI же должен помочь — а не помогает».
2. **Egor:** «Часть 1 ответы могут быть на любых фото — не только на бланке ФИПИ. У моего ученика они на обычном тетрадном листе».
3. **Vladimir:** «Это блокер. В пилоте сейчас 5-6 фото в неделю — качество важнее цены. Можем добавить OPENROUTER_API_KEY если нужно».

### Root cause (P0)

CAS-race между `mock-exam-student-api::handleSubmitAttempt` и `mock-exam-grade::handleGrade`.

1. Submit handler делает `UPDATE mock_exam_attempts SET status='ai_checking', submitted_at=now()`. Trigger `BEFORE UPDATE` (миграция `20260515130000_attempt_updated_at.sql`) обновляет `updated_at = now()`.
2. Submit handler fire-and-forget зовёт `mock-exam-grade::handleGrade`.
3. Grader SELECT'ит attempt → status='ai_checking', updated_at = ~50ms назад.
4. Grader pre-flight (line 1242): `status === 'submitted'`? **Нет** → skip CAS claim path.
5. Grader fallback (line 1282): `status === 'ai_checking'`? **Да** → проверяет `ageMs < STALE_LOCK_AGE_MS (120s)` → **TRUE** → возвращает 202 ALREADY_GRADING.
6. **Grading никогда не запускается.** Attempt остаётся в `ai_checking` навсегда.

### Secondary issues

- **S1 — OCR scope:** `runPart1OCR` срабатывает только когда `attempt.answer_method='blank' AND attempt.blank_photo_url IS NOT NULL`. Если ученик загрузил фото в `part1_blank_photo_url` (fallback path «решал не на ФИПИ бланке») — OCR не запускается, репетитор должен вводить вручную.
- **S2 — Prompt rigidity:** `buildPart1BlankOCRPrompt` написан под официальный ФИПИ-бланк (grid cells 1-20). Для произвольного фото («тетрадный лист с ответами 1. … 2. …») точность падает.
- **S3 — Retry endpoint требует blank_photo_url:** `handleRetryPart1OCR` отвергает запросы без `blank_photo_url` (line 1938). Если ученик загрузил только `part1_blank_photo_url` — repeat невозможен.
- **S4 — Image cap rigidity:** `MAX_PROMPT_IMAGE_BYTES = 5MB`. Upload разрешает до 10MB. HEIC photos с iPhone типично 2-4MB после `compressForUpload`, но legacy / большие фото отвергаются с `image_inline_failed` flag без понятной диагностики для tutor.
- **S5 — `__meta` беден:** не отражает `prompt_mode` (blank | freeform), не отражает provider chain, не отражает fallback path если использован.

### Acceptance criteria

**AC-OCR-1 (P0 race):** Ученик загружает фото бланка + 7 фото Часть 2 в bulk → нажимает submit → через ≤ 90 сек репетитор открывает `TutorMockExamReview` и видит:
- Часть 1: AI-recognized cells в `Part1BlankReviewPanel` (даже если confidence='low' на части клеток).
- Часть 2: 6 AI draft cards (даже если confidence='low' для photo_unreadable cases).

**AC-OCR-2 (freeform):** Ученик загружает фото ответов Часть 1 на тетрадном листе через `kind='part1_fallback'` → submit → OCR извлекает значения (без grid-assumption) → tutor видит pre-filled inputs.

**AC-OCR-3 (retry parity):** `POST /attempts/:id/retry-part1-ocr` принимает оба пути: attempt.blank_photo_url OR attempt.part1_blank_photo_url. Выбор пути → выбор prompt mode.

**AC-OCR-4 (diagnostics):** При failure tutor видит в `ai_part1_ocr_json.__meta` поля `status`, `prompt_mode`, `gemini_model`, `error`, `raw_response` (truncated). Frontend banner показывает actionable message.

**AC-OCR-5 (no anti-leak regression):** `solution_text` / `correct_answer` / `rubric_*` НЕ leak student-у; `ai_draft_json` НЕ leak student-у; OCR-result tutor-only до approval. Все state-aware reveal contracts сохранены.

---

## Section 2 — Design

### D-1: P0 race fix — submit keeps `submitted` status

Перенести state-transition `submitted → ai_checking` **исключительно** в `mock-exam-grade::handleGrade::CAS claim path`. `handleSubmitAttempt` оставляет status='submitted' (это и есть «queued for AI»).

**Изменения в `mock-exam-student-api/index.ts::handleSubmitAttempt`:**

```ts
// Before:
.update({ status: "ai_checking", submitted_at: now, ... })
return jsonOk(cors, { ..., status: "ai_checking" });

// After:
.update({ status: "submitted", submitted_at: now, ... })
return jsonOk(cors, { ..., status: "submitted" });
```

Frontend (`StudentMockExam.tsx::handleSubmit`) после submit делает `navigate(/result)` → result page (`handleGetResult`) принимает `submitted` как валидный статус (line 442). Никаких frontend changes.

Grader (`mock-exam-grade::handleGrade`) видит status='submitted' → CAS claim submitted → ai_checking → AI работа → status='awaiting_review'.

### D-2: Freeform OCR mode

Расширить `_shared/mock-exam-part1-ocr.ts`:
- Новый `buildPart1FreeformOCRPrompt(tasksMeta, photoDataUrl)` — prompt для произвольного фото (тетрадный лист, скан, schwer-структурированный).
- Существующий `buildPart1BlankOCRPrompt` сохраняется (FIPI grid prompt).

**Freeform prompt key differences:**
- Не упоминает «бланк ФИПИ» / «клетки 1-20».
- Объясняет AI что ответы могут быть в произвольной локации: «1) 12 2) 234 ...» или строкой, или таблицей.
- Просит AI извлечь номера задач (1-20) и соответствующие ответы.
- Same JSON output shape: `{ "1": {value, confidence}, ..., "20": {...} }`.

**Trigger logic** в `mock-exam-grade::handleGrade`:

```ts
const blankRef = attemptRow.blank_photo_url ?? null;
const fallbackRef = attemptRow.part1_blank_photo_url ?? null;

const ocrPath: { ref: string; mode: "blank" | "freeform" } | null =
  blankRef ? { ref: blankRef, mode: "blank" } :
  fallbackRef ? { ref: fallbackRef, mode: "freeform" } :
  null;

const shouldRunPart1OCR = attemptRow.answer_method === "blank"
  && ocrPath !== null
  && (options?.forceRetryOCR === true || !attemptRow.ai_part1_ocr_json);
```

### D-3: Retry endpoint parity

`mock-exam-tutor-api::handleRetryPart1OCR` accepts both paths:

```ts
if (!attempt.blank_photo_url && !attempt.part1_blank_photo_url) {
  return jsonError(cors, 400, "NO_PART1_PHOTO",
    "Attempt has no Part 1 photo to OCR (neither ФИПИ blank nor freeform fallback)");
}
```

### D-4: Larger image cap

`MAX_PROMPT_IMAGE_BYTES`: 5MB → 8MB (matches upload limit 10MB - margin для JSON overhead). HEIC / large originals идут к Gemini без silent rejection. Backed by Gemini Vision API limit (20MB per image, https://ai.google.dev/gemini-api/docs/vision).

### D-5: Richer `__meta`

OCR success snapshot:
```ts
__meta: {
  status: "success",
  prompt_mode: "blank" | "freeform",        // NEW
  gemini_model: "google/gemini-2.5-pro",
  recognized_cells: 14,
  raw_length: 1200,
  generated_at: "2026-05-21T..."
}
```

OCR failure snapshot:
```ts
__meta: {
  status: "failed",
  prompt_mode: "blank" | "freeform",        // NEW
  gemini_model: "google/gemini-2.5-pro",
  error: "Gateway timeout",
  raw_response: "...",                       // truncated to 4000 chars
  failed_at: "...",
  generated_at: "..."
}
```

Frontend type `MockExamPart1OCRMetaSuccess` / `MockExamPart1OCRMetaFailed` extended with `prompt_mode?: 'blank' | 'freeform'` (optional для backward compat с pilot attempts).

### D-6: Out of scope (deferred)

- **`mock_exam_grading_jobs` table + queue**: текущий fire-and-forget pattern adequate для пилот scale (5-6 фото / неделя). Queue добавляется когда / если будут blowouts.
- **OpenRouter integration**: Lovable Gateway уже даёт `google/gemini-2.5-pro` (фактически использован сейчас). Достаточно для пилота. `OPENROUTER_API_KEY` оставлено как env opt-in для будущей model ladder (`anthropic/claude-sonnet-4.5` fallback), не wired в этом fix.
- **`EdgeRuntime.waitUntil`**: Supabase Edge Functions API — не публичное. Текущий fire-and-forget с `.catch()` handler работает для < 1s overhead enqueue; grader сам владеет своим event loop через `Deno.serve`.

---

## Section 3 — Tasks

### TASK-OCR-1 (P0 race fix) — mock-exam-student-api

Файл: `supabase/functions/mock-exam-student-api/index.ts`

- Change line ~1225: `status: "ai_checking"` → `status: "submitted"` в UPDATE.
- Change line ~1259: response `status: "ai_checking"` → `status: "submitted"`.
- Add code comment explaining grader will CAS-claim.

### TASK-OCR-2 (Freeform prompt) — _shared/mock-exam-part1-ocr.ts

Файл: `supabase/functions/_shared/mock-exam-part1-ocr.ts`

- Add exported function `buildPart1FreeformOCRPrompt(tasksMeta, photoDataUrl)`.
- Sanitize function `sanitizePart1OCRResult` reused (same output shape).

### TASK-OCR-3 (Grader OCR path selection) — mock-exam-grade

Файл: `supabase/functions/mock-exam-grade/index.ts`

- `runPart1OCR` signature расширяется: дополнительный param `promptMode: "blank" | "freeform"`. По нему выбирается `buildPart1BlankOCRPrompt` или `buildPart1FreeformOCRPrompt`.
- `handleGrade::shouldRunPart1OCR` derives `ocrPath` из `blank_photo_url || part1_blank_photo_url`.
- `runPart1OCR` записывает `prompt_mode` в `__meta` (success and failure).
- `MAX_PROMPT_IMAGE_BYTES`: 5MB → 8MB.

### TASK-OCR-4 (Retry endpoint parity) — mock-exam-tutor-api

Файл: `supabase/functions/mock-exam-tutor-api/index.ts`

- `handleRetryPart1OCR` accepts both `blank_photo_url` OR `part1_blank_photo_url` (либо).
- Error code if neither: `"NO_PART1_PHOTO"`.

### TASK-OCR-5 (Frontend types) — src/types/mockExam.ts

Файл: `src/types/mockExam.ts`

- Add optional `prompt_mode?: 'blank' | 'freeform'` to `MockExamPart1OCRMetaSuccess` and `MockExamPart1OCRMetaFailed`.

### TASK-OCR-6 (Validation)

```sh
npm run build         # clean
npm run smoke-check   # clean
```

Manual smoke (Vladimir, after deploy + Lovable preview):
1. Pilot student submits blank-mode attempt (ФИПИ бланк + bulk Part 2 фото) → wait 60s → tutor opens review → AI cards visible, OCR cells pre-filled.
2. Pilot student submits with `part1_fallback` photo (тетрадный лист) → wait 60s → tutor sees Часть 1 OCR cells extracted via freeform prompt.
3. Tutor clicks «Перезапустить AI OCR» на attempt с only `part1_blank_photo_url` → endpoint принимает, не возвращает 400.

---

## Files

| File | Change | Type |
|---|---|---|
| `supabase/functions/mock-exam-student-api/index.ts` | submit оставляет `status='submitted'` | MODIFY |
| `supabase/functions/_shared/mock-exam-part1-ocr.ts` | add freeform prompt builder | MODIFY |
| `supabase/functions/mock-exam-grade/index.ts` | OCR path selection (blank vs fallback) + 8MB cap + prompt_mode в __meta | MODIFY |
| `supabase/functions/mock-exam-tutor-api/index.ts` | retry endpoint accepts both photo paths | MODIFY |
| `src/types/mockExam.ts` | additive `prompt_mode?` in OCR meta types | MODIFY |
| `CLAUDE.md` | add §30 OCR & Grading Recovery hard rules | MODIFY |
| `docs/delivery/features/mock-exams-v1-pilot-polish/ocr-grading-recovery-spec.md` | NEW spec | NEW |

---

## Hard invariants (cross-merge)

1. **No DB migrations.** Existing schema (`mock_exam_attempts.status` enum, `ai_part1_ocr_json` JSONB, `blank_photo_url` / `part1_blank_photo_url`) sufficient.
2. **Anti-leak preserved** (mock-exams §10, §12, §15): `solution_text`, `correct_answer` (Часть 2), `rubric_*`, `ai_draft_json` НЕ leak до approval. `ai_part1_ocr_json` tutor-only артефакт.
3. **State machine canonical sequence** restored: `in_progress → submitted → ai_checking → awaiting_review → approved`. `manually_entered` остаётся отдельной веткой.
4. **`score_source` invariant preserved** (CLAUDE.md §25): OCR upserts `score_source='ocr'`; tutor manual edits (`score_source='tutor'`) НЕ overwritten при retry. Form-mode submit `score_source='student_form'`.
5. **MAX_PROMPT_IMAGE_BYTES = 8MB** matches existing upload cap (`MAX_PHOTO_BYTES = 10MB`) с 2MB margin для JSON / base64 overhead.
6. **Backward compat for pilot attempts**: existing `ai_part1_ocr_json` rows без `prompt_mode` поле (Phase 6 OCR runs) остаются валидными — type field optional.
7. **Future model ladder hook**: `LOVABLE_MODEL_OCR` const остаётся configurable, future env var `OCR_MODEL_OVERRIDE` или `OPENROUTER_API_KEY` могут добавиться без structural change.

---

## Rollback

- Frontend: `git revert <hash> && deploy-sokratai`.
- Backend edge functions: Lovable Studio → rollback prior deployment.
- Никаких migrations → нет destructive rollback.
