

## План: чинить автопроверку для SVG-картинок задач

### Root cause
Задача `4ecabcb1-25bd-4b55-9438-e695286fe9d8` (`z1_25.svg`, Демидова 2025) имеет `task_image_url` в формате SVG. `inlinePromptImageUrl` скачивает файл, делает `data:image/svg+xml;base64,...` и отправляет в Lovable AI Gateway. **Gemini multimodal не поддерживает SVG** → HTTP 400 → `evaluateStudentAnswer` возвращает `CHECK_FALLBACK` с `failure_reason: "gateway_error"` → ученик видит «Автопроверка сейчас не сработала».

Тоже самое произойдёт в `generateHint` (тот же `inlinePromptImageUrls`) и в `chat` edge function (тот же паттерн attach).

Бонус-проблема: `responseText` от gateway никогда не логируется, поэтому реальный JSON-ответ Gemini с конкретной причиной 400 не попадает в telemetry.

### Цель
Сделать автопроверку устойчивой к SVG-задачам **без изменения схемы и без ломки existing flows**:
1. Не отправлять SVG в multimodal endpoint.
2. Заменить SVG на rasterized PNG там, где это возможно.
3. Логировать причину 400 от gateway, чтобы будущие multimodal-проблемы было видно.

### Решение

**1. SVG-фильтр в `inlinePromptImageUrl` (`supabase/functions/homework-api/guided_ai.ts`, ~514–556).**

После `fetch(trimmed)` смотрим:
- `content-type` ответа,
- расширение в URL (`.svg`),
- первые байты buffer'а (`<?xml` / `<svg`).

Если хоть один маркер указывает на SVG — **возвращаем `null`** и логируем `guided_ai_inline_image_skipped` с `reason: "unsupported_svg"`. Возврат `null` — то же поведение, что и для оверсайз/недоступных картинок: AI работает по тексту задачи (`task_text` уже есть, для z1_25 он содержательный).

Пилотный выигрыш: проверка перестаёт падать с 400, AI получает только текст условия и оценивает короткий ответ (`15 м`) по smarts модели + `correctAnswer`. Для z1_25 это нормально: задача читается из текста, график лишь иллюстрирует.

**2. Логировать `responseText` при HTTP-ошибке gateway (`supabase/functions/homework-api/ai_shared.ts`, ~186–200).**

В `catch` внутри `callLovableJson` — если ошибка `HttpStatusError`, дополнительно логировать `responseText.slice(0, 500)` через `console.warn(${telemetryTag}_http_error, { status, body_preview })`. Это additive, не меняет retry-логику.

Ничего секретного в payload Gemini нет — это публичный gateway error. 500-символьный slice достаточно для диагностики и не раздувает логи.

**3. Параллельно — то же самое в `generateHint` path.**

`inlinePromptImageUrl` уже общий для check / hint / chat (`/chat` edge function использует свой код, но фикс в `homework-api` покрывает оба горячих guided-пути). Никаких отдельных правок не нужно — фикс в `inlinePromptImageUrl` автоматически защитит hint.

**4. Аналогичная защита в `supabase/functions/chat/index.ts`.**

Там есть свой server-side fetch эталонного решения. Найду место, где attaching task images, и добавлю тот же SVG-skip + лог.

### Файлы

**Изменяются (минимально, additive):**
- `supabase/functions/homework-api/guided_ai.ts` — SVG-detection в `inlinePromptImageUrl`.
- `supabase/functions/homework-api/ai_shared.ts` — лог `responseText` при HTTP-ошибке.
- `supabase/functions/chat/index.ts` — SVG-skip в attaching path (если есть).

**Не трогаем:**
- Схему БД, миграции.
- `vision_checker.ts` (отдельный OCR pipeline; SVG там тоже не работает, но для z1_25 ocr_text пуст и без OCR — фикс в multimodal этого достаточно).
- Frontend — UX «Автопроверка не сработала» останется, но триггериться будет реже.

### Out of scope (явно)
- **Реальный SVG → PNG rasterization.** Deno в edge functions без headless Chrome это сложно и требует cross-cutting инфраструктуру (resvg-wasm / sharp + canvas). Для пилота достаточно skip + лог; репетитор/моделератор позже сможет загрузить PNG-версию в KB.
- **Backfill OCR для задач с SVG.** Отдельная задача moderation-pipeline.
- **Retry HTTP 400.** Не имеет смысла — это валидационная ошибка gateway, ретрай не поможет.
- **Изменение `correctAnswer`/scoring логики.** Бизнес-логика проверки правильная; падает только multimodal.

### Валидация
- `npm run lint && npm run build && npm run smoke-check`.
- Manual smoke на той же задаче (thread `3759350f-...`): отправить ответ `15 м` → автопроверка должна пройти (CORRECT) или хотя бы вернуть содержательный INCORRECT/ON_TRACK без `gateway_error`.
- В edge function logs появится одна строка `guided_ai_inline_image_skipped { reason: "unsupported_svg" }` вместо `guided_check_error { failure_reason: "gateway_error" }`.

### Риски
- **Risk:** AI без графика может оценить ответ менее точно для задач, где текст условия слабее графика. **Mitigation:** для z1_25 текст содержит достаточно («модуль перемещения от t1=0 до t2=6», correct=15 м) — short_answer match по числу+единицам сработает в 80% случаев. Для задач, где это не так, нужна отдельная инициатива по rasterization (out of scope).
- **Risk:** HTTP-error лог может содержать длинный JSON. **Mitigation:** обрезаем до 500 символов.

