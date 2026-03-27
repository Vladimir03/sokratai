

## Diagnosis: AI hallucinating task conditions from images

### What's happening

When the student opens task 2 (or any task with an image-only condition), the AI bootstrap reads the task image but **generates a plausible but WRONG physics problem description** instead of accurately reading the text on the image. For example:

- **Actual image** (screenshot 3): "Плоский воздушный конденсатор **с диэлектриком** между пластинами **подключён к аккумулятору**..."
- **AI's hallucination** (screenshot 2): "Плоский воздушный конденсатор **зарядили и отключили** от источника тока..."

These are two different electrostatics problems. The model (Gemini 3 Flash) sees a physics problem about capacitors and generates a similar-sounding but incorrect description.

Once the bootstrap message is persisted with wrong text, **all subsequent messages inherit this error** — the hallucinated content sits in `contextMessages` and the AI keeps repeating it.

### Root cause

The system relies entirely on the vision model to interpret the task image on-the-fly during every chat call. For dense physics text (small font, tables, formulas), Gemini Flash makes OCR errors. There is no verification step.

### Proposed fix: Pre-OCR task images at bootstrap time

**Approach**: Before the bootstrap AI call, run a dedicated OCR pass on the task image using `recognizeHomeworkPhoto` (which already exists in `homework-api/vision_checker.ts`). Store the recognized text and inject it into `taskContext` as ground truth.

This gives the AI **two sources** — the image AND the extracted text — making hallucination much less likely.

### Implementation

**1. New backend endpoint in `homework-api/index.ts`**
- `POST /tasks/:taskId/ocr` — accepts `assignmentId`, resolves the task image, calls `recognizeHomeworkPhoto`, returns `{ recognized_text, confidence, has_formulas }`
- Caches result in a new column `homework_tutor_tasks.ocr_text` (nullable text) so OCR runs only once per task
- Falls back gracefully if OCR fails

**2. Database migration**
- Add `ocr_text TEXT DEFAULT NULL` to `homework_tutor_tasks`
- No RLS changes needed (column inherits existing policies)

**3. Frontend: pre-OCR before bootstrap (`GuidedHomeworkWorkspace.tsx`)**
- Before `runBootstrap()`, if `currentTask.task_image_url` exists and `currentTask.ocr_text` is null, call the new OCR endpoint
- Store the result in local state (and it gets cached in DB for future visits)
- Pass `ocrText` into `buildTaskContext()` as a new parameter

**4. Enhanced `buildTaskContext()` with OCR text**
- When `ocrText` is available, add it to the context:
  ```
  РАСПОЗНАННЫЙ ТЕКСТ С ИЗОБРАЖЕНИЯ (используй как эталон):
  {ocrText}
  ```
- This gives the model explicit ground truth, preventing hallucination

**5. Pass OCR text for all modes (not just bootstrap)**
- `sendUserMessage` and `handleHint` also call `requestAssistantReply` — pass the cached `ocrText` through `buildTaskContext` in all cases
- Store `ocrTextByTask` ref (Map<number, string>) to avoid re-fetching

### Why this works

- `recognizeHomeworkPhoto` uses a focused OCR prompt ("return only JSON with recognized_text") which is more accurate than a general chat model interpreting an image
- The extracted text acts as anchor — even if the model misreads the image, the explicit text overrides hallucination
- OCR runs once per task (cached in DB), no latency penalty on subsequent messages
- Graceful degradation: if OCR fails, the flow works exactly as before

### Files to modify
- `supabase/functions/homework-api/index.ts` — new OCR route + caching
- `supabase/migrations/XXXXXXXX_add_task_ocr_text.sql` — new column
- `src/components/homework/GuidedHomeworkWorkspace.tsx` — pre-OCR call, `buildTaskContext` update
- `src/lib/studentHomeworkApi.ts` — new `ocrTaskImage()` API function
- `src/types/homework.ts` — add `ocr_text` to task type (if not auto-generated)

### Not changing
- `vision_checker.ts` — already has the right OCR logic
- `streamChat.ts` — no changes needed (taskContext handles this)
- `chat/index.ts` — no changes needed

