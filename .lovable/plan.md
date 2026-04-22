

## Анализ

### Почему скрин 3 (автопроверка не сработала) всё ещё есть

Логи (timestamp `2026-04-22T04:00:42Z`) подтверждают: gateway отвечает **HTTP 400 «Unsupported MIME type: image/svg+xml»**. Прошлый фикс SVG-skip был добавлен в `inlinePromptImageUrl` (`guided_ai.ts`), но реальный путь, который используется в `evaluateStudentAnswer`/`generateHint`, — это **другая функция**: `resolveTaskImageUrlForAI` в `homework-api/index.ts` (строки 3711–3770). Она:
1. Парсит `storage://kb-attachments/demidova2025/z1_25.svg`
2. Делает `db.storage.from('kb-attachments').download('demidova2025/z1_25.svg')`
3. Берёт `blob.type` (= `image/svg+xml`)
4. Без проверки склеивает `data:image/svg+xml;base64,...` и шлёт в gateway → 400

То есть **прошлый PR трогал не тот путь**. Чёрный путь без SVG-skip остаётся.

### Почему скрин 2 (AI отвечает не по графику в режиме «Обсудить»)

В `chat/index.ts` SVG-skip есть и работает корректно: `fetchImageAsBase64DataUrl` дропает SVG и возвращает `null`. Это значит, что в режиме «Обсудить» **AI вообще не получает картинку графика**. Он генерирует объяснение на основе только текста условия («модуль перемещения за время от t₁=0 до t₂=6»), фантазирует фигуры («треугольник с 0 до 4 секунд») и даёт неверный план разбора.

### Масштаб: 56 SVG-задач в KB

Это не единичный баг, а целый класс контента (Демидова 2025 — 56 SVG в KB, 7 уже в активных ДЗ). Ответ на вопрос 3 определяет архитектуру: **stable raster путь обязателен**.

### Ответ на вопрос 3 (что выбрать стратегически)

Multimodal Gemini-flash для физических графиков на словах звучит круто, на деле для SVG ломается на уровне gateway, для растровых картинок в 30–40% случаев галлюцинирует значения по осям (см. правило `guided-chat-vision-logic` в .claude/rules — мы уже наступали на это). Для **репетиторского пилота** (job: «утром получить чёткий разбор где вмешаться») стабильность важнее.

**Рекомендация: гибрид с приоритетом на rasterization + tutor-side OCR/text.**
1. **Server-side**: `kb-attachments` SVG → растрировать в PNG один раз при upload или lazy on-demand, кэшировать. AI всегда видит PNG, multimodal работает как ожидается.
2. **Tutor-side**: добавить колонку «текст с картинки» (OCR/ручной перенос — чисел с осей, подписей) в KB-задаче и в `homework_tutor_tasks.ocr_text`. Этот текст уходит в промпт как «опора» (паттерн `buildGraphGroundingGuidance` уже есть). Для критичных ЕГЭ-задач это убирает галлюцинации.
3. Multimodal-картинку оставляем как complement, не основной канал.

Для **первого шага сейчас** делаем минимум: фикс SVG-skip на верном пути + ручное rerasterization 56 SVG в PNG как один-time backfill. План tutor-side OCR-поля — в отдельную итерацию.

---

## Что меняем сейчас

### 1. Real fix: SVG-skip в `resolveTaskImageUrlForAI` (`homework-api/index.ts`, ~3711)

После `db.storage.download()` — **до** того как склеивать data-URL, проверить:
- `blob.type` matches `image/svg+xml`
- расширение objectPath `.svg`
- magic bytes (`<?xml` / `<svg`)

При срабатывании логировать `homework_api_inline_image_skipped { reason: "unsupported_svg" }` и возвращать `null`. Auto-check тогда падает не в gateway 400, а отрабатывает на `correct_answer` через deterministic short-answer match (для `15 м` vs `30` правильно вернёт INCORRECT с осмысленным фидбеком).

### 2. Backfill: rasterize 56 SVG → PNG

Один-time скрипт через `code--exec`:
1. Скачивает все 56 SVG из bucket `kb-attachments`
2. Растрирует через `nix run nixpkgs#librsvg -- rsvg-convert` (или resvg) → PNG @ 1200×800, белый фон
3. Загружает PNG обратно как `demidova2025/z1_25.png` рядом
4. Обновляет `kb_tasks.attachment_url` и **уже скопированные** `homework_tutor_tasks.task_image_url` (UPDATE по join)

После backfill автопроверка для 7 ДЗ-задач + любые новые копии работают через нормальный multimodal.

### 3. Tutor-side контракт «PNG only» для KB-аплоада

В `KBPickerSheet`/upload path — когда репетитор загружает SVG, рендерим тёплый toast «SVG не поддерживается AI-проверкой, конвертируйте в PNG/JPG». Не блокируем, но предупреждаем. Это additive UX-валидация, чтобы новые SVG не появлялись.

### 4. Telemetry / лог-улучшение

`resolveTaskImageUrlForAI` сейчас не логирует успешный путь. Добавить `console.info('homework_api_inline_image_resolved', { mime, bytes, source })` для будущей диагностики.

---

## Что НЕ меняем

- `inlinePromptImageUrl` в `guided_ai.ts` уже защищена — оставляем (дублирующая защита для редких HTTP-веток).
- `chat/index.ts::fetchImageAsBase64DataUrl` уже корректно дропает SVG — поведение «AI без картинки» правильное для текущего стека; после backfill PNG картинка вернётся в чат.
- Не делаем live SVG→PNG конверсию в edge function (Deno без `resvg-wasm` пакета — это отдельная инфраструктура; backfill+upload-validation покрывают 99%).
- Не вводим OCR-поле в этой итерации (отдельная плановая работа на tutor side).

---

## Файлы

**Изменяются:**
- `supabase/functions/homework-api/index.ts` — SVG-skip + лог в `resolveTaskImageUrlForAI` (~30 строк additive).
- `src/components/kb/...` — toast-предупреждение при upload SVG (точное место найду в default mode; кандидат — `KBTaskForm` или соответствующий drawer).

**Один-time скрипты (не коммитятся):**
- `/tmp/rasterize_svg.sh` — bash + rsvg-convert для backfill 56 файлов.
- SQL-миграция rename atttachment_url для затронутых записей (`UPDATE kb_tasks SET attachment_url = REPLACE(attachment_url, '.svg', '.png') WHERE attachment_url LIKE '%.svg'` после успешного upload PNG).

---

## Валидация

1. После SVG-skip фикса: повторить «Ответ к задаче: 30» в `/homework/41b09b81-bbff-454c-b5c8-b4c56dff9299` → автопроверка вернёт **INCORRECT** с осмысленным фидбеком (не «не сработала»).
2. После backfill: режим «Обсудить» → AI описывает реальный график (ступенька 10 → −5, не «треугольник»).
3. `npm run lint && npm run build && npm run smoke-check`.
4. Лог `homework_api_inline_image_skipped { reason: "unsupported_svg" }` появляется ровно на тех задачах, где SVG ещё не растрирован.

## Стратегический ответ (вопрос 3)

**Самое стабильное:** server-side rasterization + опциональный tutor-side OCR-текст ключевых данных + multimodal как дополнительный канал. Ставка только на multimodal без растеризации = ловим SVG-400, ловим галлюцинации по осям, ловим скрытые форматы. Ставка только на tutor-side OCR = много ручной работы и исключает задачи, где визуал важнее чисел (схемы, векторы). Гибрид даёт максимум и закрывает edge-cases.

