

## Problem

The AI **does** receive the task image (confirmed via network logs — signed URL is passed and the chat function processes it). However, the AI model (Gemini 3 Flash Preview) **misreads the graph** — it says "ускорение от 8 до 10 секунд" when the actual task is about "скорость от 1 до 3 секунд."

Root causes:
1. **The bootstrap intro message is never persisted to the DB** — it regenerates on every page load, each time potentially getting a different (wrong) interpretation.
2. **The task text is just "Реши"** — the AI must rely entirely on the image to understand the task, and the model misinterprets the graph.
3. **No logging in the chat function** confirms whether the image was actually injected as base64 into the AI request (the `📷 Injected` log is absent from captured logs).

## Fix

### 1. Persist the bootstrap intro message to the DB (GuidedHomeworkWorkspace.tsx, ~line 862-880)

After generating the intro text, save it via `persistMessage()` (or `saveThreadMessage`) so it's stored permanently. This prevents re-generation on every page load.

### 2. Add diagnostic logging in the chat function (chat/index.ts, ~line 719)

Add a `console.log` before the `isValidImageUrl` check to confirm `taskImageUrl` presence, and log the result of `fetchImageAsBase64DataUrl` to diagnose silent failures.

### 3. Improve the system prompt for image-based tasks (GuidedHomeworkWorkspace.tsx, `buildTaskContext`)

When `task_text` is very short (e.g. "Реши") and an image is attached, add explicit instructions: "Условие задачи полностью содержится на изображении. Внимательно прочитай текст и данные на изображении. НЕ придумывай условие — используй ТОЛЬКО то, что написано на картинке."

This is the most impactful fix — telling the model explicitly that the task text IS the image prevents hallucination.

